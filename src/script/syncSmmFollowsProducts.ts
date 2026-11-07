import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_) {}

const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

import logger from "../logger";
import { Provider } from "../models/reference/Provider";
import { ProductSyncService } from "../services/sync/ProductSyncService";

async function runSmmFollowsSync() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for SMMFollows product sync...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    const provider = await Provider.findOne({ code: "smmfollows" });
    if (!provider) {
      logger.error('Provider "smmfollows" not found. Please run seedSmmFollowsProvider.ts first.');
      process.exit(1);
    }

    const syncService = new ProductSyncService();
    logger.info("Starting SMMFollows catalog sync...");
    const result = await syncService.syncSmmFollowsProducts(provider._id.toString());

    console.log("\n==================================================");
    console.log("          SMMFOLLOWS CATALOG SYNC COMPLETE        ");
    console.log("==================================================");
    console.log(`Created: ${result.created}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Failed:  ${result.failed}`);
    console.log(`Total:   ${result.total}`);
    console.log("==================================================\n");

    process.exit(0);
  } catch (error) {
    logger.error("Error during SMMFollows sync:", error);
    process.exit(1);
  }
}

runSmmFollowsSync();
