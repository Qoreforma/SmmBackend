// @/script/backfillSafeHavenAutoSweep.ts
//
// One-off fix: sub-accounts created before this fix were created with
// autoSweep: false (see SaveHavenService.createSubAccount). This script
// turns autoSweep ON for every existing active SafeHaven sub-account via
// PUT /accounts/{id}/subaccount, and stores SafeHaven's internal _id into
// VirtualAccount.meta so we never have to re-derive it again.
//
// Does NOT move any money. Only changes account settings. The separate
// recoverTrappedFunds.ts script handles moving currently-stuck balances.
//
// Safety: defaults to DRY RUN. Set LIVE=true to actually call SafeHaven.
//
// Run with:  npx ts-node src/script/backfillSafeHavenAutoSweep.ts
//            LIVE=true npx ts-node src/script/backfillSafeHavenAutoSweep.ts

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { User } from "@/models/core/User";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";

const LIVE = process.env.LIVE === "true";
const DELAY_MS = 300; // basic rate limiting between provider calls

async function connectDB() {
  const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/your_database";
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(LIVE ? "🔴 LIVE MODE — will call SafeHaven" : "🟡 DRY RUN — no calls will be made (set LIVE=true to execute)");

  const saveHavenService = new SaveHavenService();

  // 1. Pull SafeHaven's full account list ONCE — gives us accountNumber -> _id
  //    for every sub-account, since we never stored that _id historically.
  console.log("\n📡 Fetching full account list from SafeHaven (GET /accounts)...");
  const providerAccounts = await saveHavenService.getAllAccounts();
  const byAccountNumber = new Map(
    providerAccounts.map((a) => [a.accountNumber, a]),
  );
  console.log(`   Found ${providerAccounts.length} accounts on SafeHaven's side.`);

  // 2. Pull our local record of every active SafeHaven sub-account.
  const localAccounts = await VirtualAccount.find({
    provider: "saveHaven",
    isActive: true,
    deletedAt: null,
  });
  console.log(`   Found ${localAccounts.length} active SafeHaven accounts in our DB.\n`);

  const stats = {
    alreadyDone: 0,
    updated: 0,
    notFoundOnProvider: 0,
    noIdentityOnFile: 0,
    failed: 0,
  };
  const needsManualReview: string[] = [];

  for (const account of localAccounts) {
    const label = `${account.accountNumber} (user ${account.userId})`;

    // Idempotency — skip accounts we've already backfilled on a prior run.
    if (account.meta?.autoSweep === true && account.meta?.providerAccountId) {
      stats.alreadyDone++;
      continue;
    }

    const providerMatch = byAccountNumber.get(account.accountNumber);
    if (!providerMatch) {
      console.warn(`⚠️  ${label}: not found in SafeHaven's account list — skipping`);
      stats.notFoundOnProvider++;
      needsManualReview.push(`${label}: not found on provider side`);
      continue;
    }

    const user = await User.findById(account.userId);
    if (!user) {
      console.warn(`⚠️  ${label}: owning user not found — skipping`);
      stats.notFoundOnProvider++;
      needsManualReview.push(`${label}: owning user record missing`);
      continue;
    }

    // Prefer BVN, fall back to NIN. Skip (don't guess) if neither is on file —
    // the update endpoint requires identityType + identityNumber for BVN/NIN.
    let identityType: "BVN" | "NIN" | null = null;
    let identityNumber: string | undefined;
    if (user.bvn) {
      identityType = "BVN";
      identityNumber = user.bvn;
    } else if (user.nin) {
      identityType = "NIN";
      identityNumber = user.nin;
    }

    if (!identityType) {
      console.warn(`⚠️  ${label}: no BVN/NIN on file — needs manual handling`);
      stats.noIdentityOnFile++;
      needsManualReview.push(`${label}: no BVN/NIN on file`);
      continue;
    }

    console.log(
      `${LIVE ? "📝" : "👀"} ${label}: turning autoSweep ON (identityType=${identityType})`,
    );

    if (!LIVE) {
      stats.updated++;
      continue;
    }

    try {
      const result = await saveHavenService.updateSubAccount(
        providerMatch._id,
        {
          phoneNumber: user.phone?.startsWith("234")
            ? user.phone
            : `234${user.phone}`,
          emailAddress: user.email,
          externalReference: account.orderReference || account.accountNumber,
          identityType,
          identityNumber,
          autoSweep: true,
          autoSweepDetails: {
            schedule: "Instant",
            accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
            bankCode: "090286",
          },
        },
      );

      account.meta = {
        ...(account.meta || {}),
        providerAccountId: result.provider_account_id,
        autoSweep: true,
        autoSweepAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
        backfilledAt: new Date(),
      };
      await account.save();

      stats.updated++;
      console.log(`   ✅ done`);
    } catch (error: any) {
      console.error(`   ❌ ${label}: update failed — ${error.message}`);
      stats.failed++;
      needsManualReview.push(`${label}: update call failed (${error.message})`);
    }

    await sleep(DELAY_MS);
  }

  console.log("\n📊 Summary:");
  console.log(`   Already done:          ${stats.alreadyDone}`);
  console.log(`   Updated${LIVE ? "" : " (would update)"}:               ${stats.updated}`);
  console.log(`   Not found on provider: ${stats.notFoundOnProvider}`);
  console.log(`   No BVN/NIN on file:    ${stats.noIdentityOnFile}`);
  console.log(`   Failed:                ${stats.failed}`);

  if (needsManualReview.length > 0) {
    console.log("\n🔎 Needs manual review:");
    needsManualReview.forEach((line) => console.log(`   - ${line}`));
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