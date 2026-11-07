import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import logger from "../logger";
import { User } from "../models/core/User";
import { Wallet } from "../models/wallet/Wallet";
import bcrypt from "bcrypt";

const createSystemUser = async () => {
  try {
    logger.info("🚀 Starting System User & Wallet creation...");

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI!);
    logger.info("✅ Connected to database");

    // Check if system user already exists
    const existingSystemUser = await User.findOne({
      isSystemUser: true,
    });

    if (existingSystemUser) {
      logger.info("⚠️  System user already exists");
      logger.info("System User Details:", {
        userId: existingSystemUser.id.toString(),
        email: existingSystemUser.email,
        firstname: existingSystemUser.firstname,
        lastname: existingSystemUser.lastname,
      });

      // Check if wallet exists
      const existingWallet = await Wallet.findOne({
        userId: existingSystemUser._id,
        type: "main",
      });

      if (existingWallet) {
        logger.info("✅ System wallet already exists");
        logger.info("Wallet Details:", {
          walletId: existingWallet.id.toString(),
          userId: existingWallet.userId.toString(),
          balance: existingWallet.balance,
          bonusBalance: existingWallet.bonusBalance,
          commissionBalance: existingWallet.commissionBalance,
        });
        return;
      } else {
        logger.info("❌ System user exists but wallet is missing. Creating wallet...");
        // Create wallet for existing system user
        const wallet = await Wallet.create({
          userId: existingSystemUser._id,
          type: "main",
          balance: 0,
          bonusBalance: 0,
          commissionBalance: 0,
        });

        logger.info("✅ System wallet created successfully");
        logger.info("Wallet Details:", {
          walletId: wallet.id.toString(),
          userId: wallet.userId.toString(),
          balance: wallet.balance,
        });
        return;
      }
    }

    // Get credentials from environment or use defaults
    const email = process.env.SYSTEM_USER_EMAIL || "system@paymint.com.ng";
    const password = process.env.SYSTEM_USER_PASSWORD || "itnostjkrst";
    const firstName = process.env.SYSTEM_USER_FIRST_NAME || "Paymint";
    const lastName = process.env.SYSTEM_USER_LAST_NAME || "Admin";

    // Validate required fields
    if (!email || !password) {
      throw new Error(
        "SYSTEM_USER_EMAIL and SYSTEM_USER_PASSWORD must be provided"
      );
    }

    logger.info("Creating system user with credentials...");

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create system user data
    const systemUserData = {
      firstname: firstName,
      lastname: lastName,
      email: email.toLowerCase(),
      password: hashedPassword,
      isSystemUser: true,
      status: "active" as const,
      bvnVerified: false,
      bvnValidated: false,
      fcmTokens: [],
      authType: "password" as const,
      userType: "regular" as const,
      dateOfBirth: new Date("2020-01-01"),
    };

    // Create and save system user
    const systemUser = await User.create(systemUserData);
    logger.info("✅ System user created successfully");
    logger.info("System User Details:", {
      userId: systemUser.id.toString(),
      email: systemUser.email,
      firstname: systemUser.firstname,
      lastname: systemUser.lastname,
      isSystemUser: systemUser.isSystemUser,
    });

    // Create wallet for system user
    logger.info("Creating system wallet...");
    const wallet = await Wallet.create({
      userId: systemUser._id,
      type: "main",
      balance: 0,
      bonusBalance: 0,
      commissionBalance: 0,
    });

    logger.info("✅ System wallet created successfully");
    logger.info("Wallet Details:", {
      walletId: wallet.id.toString(),
      userId: wallet.userId.toString(),
      balance: wallet.balance,
      bonusBalance: wallet.bonusBalance,
      commissionBalance: wallet.commissionBalance,
    });

    // Display constants to add to .env or config file
    logger.info("\n📋 Add these to your constants/config file:");
    logger.info(`SYSTEM_USER_ID=${systemUser.id.toString()}`);
    logger.info(`SYSTEM_WALLET_ID=${wallet.id.toString()}`);

  } catch (error) {
    logger.error("Failed to create system user and wallet", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info("🔌 Disconnected from database");
    process.exit(0);
  }
};

createSystemUser();