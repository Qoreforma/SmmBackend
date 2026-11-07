import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { VirtualAccount } from "@/models/banking/VirtualAccount";

const LIVE = process.env.LIVE === "true";

async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/your_database";
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");
}

async function run() {
  console.log(LIVE ? "🔴 LIVE MODE — will write to DB" : "🟡 DRY RUN — no writes will be made (set LIVE=true to execute)");

  const candidates = await VirtualAccount.find({
    provider: "saveHaven",
    isActive: true,
    deletedAt: null,
    "meta.autoSweep": { $ne: true },
  });

  console.log(`Found ${candidates.length} active SafeHaven accounts without native autoSweep.\n`);

  for (const account of candidates) {
    console.log(
      `${LIVE ? "📝" : "👀"} ${account.accountNumber} (user ${account.userId}): ${
        account.meta?.manualSweepRequired ? "already flagged — skipping" : "flagging manualSweepRequired = true"
      }`,
    );
    if (!LIVE || account.meta?.manualSweepRequired) continue;

    account.meta = { ...(account.meta || {}), manualSweepRequired: true, manualSweepFlaggedAt: new Date() };
    await account.save();
  }
  console.log("\n✅ Done.");
}

async function main() {
  try {
    await connectDB();
    await run();
    process.exit(0);
  } catch (error) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});

main();