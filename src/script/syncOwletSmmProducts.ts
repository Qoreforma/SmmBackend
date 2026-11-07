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

async function runOwletSync() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for Owlet SMM sync...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    const provider = await Provider.findOne({ code: "owlet" });
    if (!provider) {
      logger.error('Provider "owlet" not found. Please run seedOwletProvider.ts first.');
      process.exit(1);
    }

    const syncService = new ProductSyncService();
    logger.info("Starting Owlet SMM catalog sync...");
    const result = await syncService.syncOwletSmmProducts(provider._id.toString());

    console.log("\n==================================================");
    console.log("             OWLET SMM SYNC COMPLETE              ");
    console.log("==================================================");
    console.log(`Created: ${result.created}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Failed:  ${result.failed}`);
    console.log(`Total:   ${result.total}`);
    console.log("==================================================\n");

    process.exit(0);
  } catch (error) {
    logger.error("Error during Owlet SMM sync:", error);
    process.exit(1);
  }
}

runOwletSync();
