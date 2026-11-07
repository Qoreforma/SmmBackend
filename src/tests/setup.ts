import mongoose from "mongoose";
import { User } from "@/models/core/User";
import { Wallet } from "@/models/wallet/Wallet";
import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcrypt";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
process.env.NODE_ENV = "development";

/**
 * Connect to the GLOBAL replica set instance
 * This runs ONCE per test file (via setupFilesAfterEnv)
 */
beforeAll(async () => {
  // Get URI from global setup
  const mongoUri = process.env.__MONGO_URI__ || (global as any).__MONGO_URI__;

  if (!mongoUri) {
    throw new Error("MongoDB URI not found. Global setup may have failed.");
  }

  // Connect to the shared replica set
  await mongoose.connect(mongoUri, {
    directConnection: true, // Important for replica sets in tests
  });

  await mongoose.connection.db?.admin().command({
    setParameter: 1,
    transactionLifetimeLimitSeconds: 30, // ← Increase from default
  });
  console.log("✅ Connected to test replica set");

  // Ensure system user exists
  await createSystemUserForTests();
});

/**
 * Clean up after ALL tests in this file
 */
afterAll(async () => {
  await clearTestDB();
  await mongoose.connection.close();
  console.log("✅ Disconnected from test database");
});

/**
 * Clear data between individual tests
 */
afterEach(async () => {
  await clearTestDB();
});

/**
 * Create system user for tests
 */
const createSystemUserForTests = async () => {
  try {
    const existingSystemUser = await User.findOne({ isSystemUser: true });

    if (existingSystemUser) {
      console.log("✅ System user already exists");
      return;
    }

    const hashedPassword = await bcrypt.hash("SystemTest@123", 10);

    const systemUser = await User.create({
      firstname: "System",
      lastname: "Admin",
      email: "system@platform.local",
      password: hashedPassword,
      isSystemUser: true,
      status: "active",
      bvnVerified: false,
      bvnValidated: false,
      fcmTokens: [],
      authType: "password",
      userType: "regular",
      dateOfBirth: new Date("2020-01-01"),
    });

    await Wallet.create({
      userId: systemUser._id,
      type: "main",
      balance: 0,
      bonusBalance: 0,
      commissionBalance: 0,
    });

    console.log("✅ System user created:", systemUser._id.toString());
  } catch (error: any) {
    console.error("❌ Failed to create system user:", error.message);
    throw error;
  }
};

/**
 * Clear all collections EXCEPT system user/wallet
 */
export const clearTestDB = async () => {
  const collections = mongoose.connection.collections;

  for (const key in collections) {
    if (key === "users") {
      await collections[key].deleteMany({ isSystemUser: { $ne: true } });
    } else if (key === "wallets") {
      const systemUser = await User.findOne({ isSystemUser: true });
      if (systemUser) {
        await collections[key].deleteMany({ userId: { $ne: systemUser._id } });
      } else {
        await collections[key].deleteMany({});
      }
    } else {
      await collections[key].deleteMany({});
    }
  }
};

// Export helpers for tests that need manual control
export const getTestConnection = () => mongoose.connection;
export const getTestSession = () => mongoose.startSession();
