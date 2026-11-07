// @/script/recoverTrappedSafeHavenFunds.ts
//
// One-off recovery: moves any balance currently sitting in a SafeHaven
// sub-account (trapped there because autoSweep was off) into the
// master/pool account (SAFEHAVEN_SWEEP_ACCOUNT), via the normal
// /transfers endpoint — SafeHaven has no separate "sweep" endpoint.
//
// This does NOT touch wallet balances or create Transaction records —
// user wallets were already credited correctly when the deposit webhook
// fired. This script only moves the underlying cash to match what the
// ledger already says. Per confirmation: no backend record of this
// movement is required.
//
// Safety: defaults to DRY RUN. Set LIVE=true to actually move money.
//
// Run with:  npx ts-node src/script/recoverTrappedSafeHavenFunds.ts
//            LIVE=true npx ts-node src/script/recoverTrappedSafeHavenFunds.ts

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { generateReference } from "@/utils/helpers";

const LIVE = process.env.LIVE === "true";
const DELAY_MS = 500; // rate limiting — this one moves real money, be gentle
const MASTER_ACCOUNT = process.env.SAFEHAVEN_SWEEP_ACCOUNT || "";
const SAFEHAVEN_BANK_CODE = "090286";

async function connectDB() {
  const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/your_database";
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(LIVE ? "🔴 LIVE MODE — will move real money" : "🟡 DRY RUN — no transfers will be made (set LIVE=true to execute)");

  if (!MASTER_ACCOUNT) {
    throw new Error("SAFEHAVEN_SWEEP_ACCOUNT is not set — refusing to run without a master account destination");
  }

  const saveHavenService = new SaveHavenService();

  // Single call gets us live balances for every account under the client,
  // matched against our own account list by accountNumber.
  console.log("\n📡 Fetching live balances from SafeHaven (GET /accounts)...");
  const providerAccounts = await saveHavenService.getAllAccounts();
  const byAccountNumber = new Map(
    providerAccounts.map((a) => [a.accountNumber, a]),
  );

  const localAccounts = await VirtualAccount.find({
    provider: "saveHaven",
    isActive: true,
    deletedAt: null,
    accountNumber: { $ne: MASTER_ACCOUNT }, // never try to sweep the master account into itself
  });

  console.log(`   Checking ${localAccounts.length} sub-accounts for trapped balances...\n`);

  const results: Array<{
    accountNumber: string;
    userId: string;
    balance: number;
    status: "swept" | "would_sweep" | "failed" | "skipped_zero";
    reference?: string;
    error?: string;
  }> = [];

  for (const account of localAccounts) {
    const providerMatch = byAccountNumber.get(account.accountNumber);
    if (!providerMatch) {
      console.warn(`⚠️  ${account.accountNumber}: not found in SafeHaven's account list — skipping`);
      continue;
    }

    const balance = providerMatch.accountBalance || 0;

    if (balance <= 0) {
      results.push({
        accountNumber: account.accountNumber,
        userId: String(account.userId),
        balance,
        status: "skipped_zero",
      });
      continue;
    }

    console.log(`💰 ${account.accountNumber} (user ${account.userId}): trapped balance = ${balance}`);

    if (!LIVE) {
      results.push({
        accountNumber: account.accountNumber,
        userId: String(account.userId),
        balance,
        status: "would_sweep",
      });
      continue;
    }

    const MAX_CHUNK = 1000000;
    let remaining = balance;
    let sweptAmount = 0;
    let hasError = false;
    let lastError = "";

    while (remaining > 0) {
      const chunkAmount = Math.min(remaining, MAX_CHUNK);
      const reference = generateReference("SWP"); // shortened to ensure it doesn't exceed length limits

      try {
        await saveHavenService.initiateTransfer({
          amount: chunkAmount,
          account_number: MASTER_ACCOUNT,
          bank_code: SAFEHAVEN_BANK_CODE,
          narration: "Recovery sweep - trapped funds",
          reference,
          debitAccountNumber: account.accountNumber,
        });

        console.log(`   ✅ swept chunk of ${chunkAmount} -> master (ref ${reference})`);
        remaining -= chunkAmount;
        sweptAmount += chunkAmount;
        await sleep(DELAY_MS); // small delay between chunks
      } catch (error: any) {
        console.error(`   ❌ sweep chunk failed: ${error.message}`);
        hasError = true;
        lastError = error.message;
        break; // stop chunking on error
      }
    }

    if (sweptAmount > 0) {
      results.push({
        accountNumber: account.accountNumber,
        userId: String(account.userId),
        balance: sweptAmount,
        status: "swept",
        reference: "MULTIPLE_CHUNKS",
      });
    }

    if (hasError) {
      results.push({
        accountNumber: account.accountNumber,
        userId: String(account.userId),
        balance: remaining, // the unswept remainder
        status: "failed",
        error: lastError,
      });
    }

    await sleep(DELAY_MS);
  }

  const swept = results.filter((r) => r.status === "swept");
  const wouldSweep = results.filter((r) => r.status === "would_sweep");
  const failed = results.filter((r) => r.status === "failed");
  const totalAmount = [...swept, ...wouldSweep].reduce((sum, r) => sum + r.balance, 0);

  console.log("\n📊 Summary:");
  console.log(`   Accounts checked:        ${localAccounts.length}`);
  console.log(`   ${LIVE ? "Swept" : "Would sweep"}:                  ${LIVE ? swept.length : wouldSweep.length}`);
  console.log(`   Failed:                  ${failed.length}`);
  console.log(`   Zero balance:            ${results.filter((r) => r.status === "skipped_zero").length}`);
  console.log(`   Total amount ${LIVE ? "moved" : "identified"}:  ${totalAmount}`);

  if (failed.length > 0) {
    console.log("\n🔎 Failed — needs manual follow-up:");
    failed.forEach((r) =>
      console.log(`   - ${r.accountNumber} (user ${r.userId}): ${r.balance} — ${r.error}`),
    );
  }
}

async function main() {
  try {
    await connectDB();
    await run();
    console.log("\n✅ Done.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("\n👋 Database connection closed");
  process.exit(0);
});

main();