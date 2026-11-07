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
import { UserTier } from "../models/billing/fees/UserTier";

async function seedUserTiers() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for VIP User Tiers seed...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    const defaultTiers = [
      {
        name: "Regular",
        code: "regular",
        badge: "Bronze",
        description: "Standard member pricing with zero markup discounts.",
        minMonthlySpend: 0,
        discountPercentage: 0,
        priority: 1,
        isActive: true,
      },
      {
        name: "Silver Reseller",
        code: "silver",
        badge: "Silver",
        description: "Active reseller tier with 3% discount on all service markups.",
        minMonthlySpend: 50000,
        discountPercentage: 3,
        priority: 2,
        isActive: true,
      },
      {
        name: "Gold Reseller",
        code: "gold",
        badge: "Gold",
        description: "High-volume reseller tier with 6% discount on all service markups.",
        minMonthlySpend: 150000,
        discountPercentage: 6,
        priority: 3,
        isActive: true,
      },
      {
        name: "VIP / Elite Reseller",
        code: "vip",
        badge: "Diamond",
        description: "Top-tier reseller with maximum 10% discount on all service markups.",
        minMonthlySpend: 500000,
        discountPercentage: 10,
        priority: 4,
        isActive: true,
      },
    ];

    for (const tierData of defaultTiers) {
      const existing = await UserTier.findOne({ code: tierData.code });
      if (!existing) {
        await UserTier.create(tierData);
        logger.info(`Created User Tier: ${tierData.name} (${tierData.code})`);
      } else {
        logger.info(`User Tier '${tierData.code}' already exists — skipping.`);
      }
    }

    logger.info("✅ User Tiers seeding completed successfully!");
  } catch (err) {
    logger.error("Failed to seed User Tiers:", err);
  } finally {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected.");
  }
}

seedUserTiers();
