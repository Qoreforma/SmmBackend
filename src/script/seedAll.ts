import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

// Ensure DNS servers resolve SRV records across networks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_) {}

const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

import logger from "../logger";
import { Role } from "../models/admin/Role";
import { ADMIN_PERMISSIONS } from "../utils/admin-permissions";
import { ServiceType } from "../models/reference/ServiceType";
import { Provider } from "../models/reference/Provider";
import { ServiceTypeProvider } from "../models/reference/ServiceTypeProvider";
import { Service } from "../models/reference/Service";
import { ServiceCharge } from "../models/billing/fees/ServiceCharge";
import { STAMP_DUTY } from "../utils/constants";
import { UserTier } from "../models/billing/fees/UserTier";
import { TelegramBotSetting } from "../models/system/TelegramBotSetting";
import { DailyStreakSetting } from "../models/system/DailyStreakSetting";
import { SMM_PLATFORMS } from "../types/smm";

export async function runAllSeeders() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("❌ MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  const isConnected = mongoose.connection.readyState === 1;
  if (!isConnected) {
    try {
      logger.info("🔌 Connecting to MongoDB for Master Seed...");
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      logger.info("✅ Connected to MongoDB successfully.");
    } catch (err) {
      logger.error("❌ MongoDB connection failed:", err);
      process.exit(1);
    }
  }

  try {
    logger.info("========================================================");
    logger.info("🌱 STARTING MASTER SEED RUNNER (UPSERT IDEMPOTENT MODE)");
    logger.info("========================================================");

    // -----------------------------------------------------------------------
    // STEP 1: Super Admin Role & Permissions
    // -----------------------------------------------------------------------
    logger.info("\n[1/8] 🛡️  Seeding Super Admin Role & Permissions...");
    const allPermissions = Object.values(ADMIN_PERMISSIONS).flatMap((category) =>
      Object.values(category),
    );

    const superAdminRole = await Role.findOneAndUpdate(
      { name: "super_admin" },
      {
        $set: {
          name: "super_admin",
          description: "Super administrator with full system access and all permissions",
          permissions: allPermissions,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info(`✓ Role 'super_admin' upserted with ${superAdminRole.permissions.length} permissions.`);

    // -----------------------------------------------------------------------
    // STEP 2: Service Types
    // -----------------------------------------------------------------------
    logger.info("\n[2/8] 📂 Seeding Core Service Types...");
    const serviceTypesData = [
      {
        code: "virtual_account",
        name: "Virtual Account",
        description: "Static virtual account creation service provider (SafeHaven, Xixapay)",
        icon: "FaUniversity",
        status: "active" as const,
        displayOrder: 1,
      },
      {
        code: "smm",
        name: "Social Media Marketing",
        description: "Social media engagement services (followers, likes, views, comments)",
        icon: "FaShareAlt",
        status: "active" as const,
        displayOrder: 2,
      },
      {
        code: "number_rental",
        name: "Virtual Number Rental",
        description: "Temporary virtual phone numbers for receiving SMS verification codes",
        icon: "FaPhoneAlt",
        status: "active" as const,
        displayOrder: 3,
      },
      {
        code: "email_otp",
        name: "Email OTP Verification",
        description: "Disposable temporary email addresses for receiving email OTP verification codes",
        icon: "FaEnvelope",
        status: "active" as const,
        displayOrder: 4,
      },
    ];

    const serviceTypeMap: Record<string, any> = {};
    for (const st of serviceTypesData) {
      const doc = await ServiceType.findOneAndUpdate(
        { code: st.code },
        {
          $set: {
            name: st.name,
            code: st.code,
            description: st.description,
            icon: st.icon,
            status: st.status,
            displayOrder: st.displayOrder,
            deletedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      serviceTypeMap[st.code] = doc;
      logger.info(`✓ ServiceType '${st.code}' (${doc.name}) upserted.`);
    }

    // -----------------------------------------------------------------------
    // STEP 3: Providers & Mappings
    // -----------------------------------------------------------------------
    logger.info("\n[3/8] 🏢 Seeding All Providers & Service Type Mappings...");

    // Helper for upserting ServiceTypeProvider
    const upsertMapping = async (
      serviceTypeId: Types.ObjectId,
      providerId: Types.ObjectId,
      priority: number,
      nameLabel: string,
    ) => {
      await ServiceTypeProvider.findOneAndUpdate(
        { serviceTypeId, providerId },
        {
          $set: {
            serviceTypeId,
            providerId,
            priority,
            isActive: true,
            deletedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      logger.info(`  ↳ Mapped '${nameLabel}' (Priority: ${priority})`);
    };

    // A. Virtual Account Providers
    const savehaven = await Provider.findOneAndUpdate(
      { code: { $regex: /^savehaven$/i } },
      {
        $set: {
          name: "SafeHaven",
          code: "savehaven",
          isActive: true,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.virtual_account._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.virtual_account._id, savehaven._id as Types.ObjectId, 1, "virtual_account <-> savehaven");

    const xixapay = await Provider.findOneAndUpdate(
      { code: { $regex: /^xixapay$/i } },
      {
        $set: {
          name: "Xixapay",
          code: "xixapay",
          isActive: true,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.virtual_account._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.virtual_account._id, xixapay._id as Types.ObjectId, 2, "virtual_account <-> xixapay");

    // B. SMM Providers
    const nigeriasmm = await Provider.findOneAndUpdate(
      { code: "nigeriasmm" },
      {
        $set: {
          name: "Nigeria SMM",
          code: "nigeriasmm",
          isActive: true,
          hasSync: true,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.smm._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.smm._id, nigeriasmm._id as Types.ObjectId, 1, "smm <-> nigeriasmm");

    const owlet = await Provider.findOneAndUpdate(
      { code: "owlet" },
      {
        $set: {
          name: "Owlet",
          code: "owlet",
          isActive: true,
          hasSync: true,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.smm._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.smm._id, owlet._id as Types.ObjectId, 2, "smm <-> owlet");

    const smmfollows = await Provider.findOneAndUpdate(
      { code: "smmfollows" },
      {
        $set: {
          name: "SMMFollows",
          code: "smmfollows",
          isActive: true,
          hasSync: true,
          usdNgnRate: 1550,
          usd_ngn_rate: 1550,
          markupPercent: 20,
          markup_percent: 20,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.smm._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.smm._id, smmfollows._id as Types.ObjectId, 3, "smm <-> smmfollows");

    const smmresellerpanel = await Provider.findOneAndUpdate(
      { code: "smmresellerpanel" },
      {
        $set: {
          name: "SMM Reseller Panel",
          code: "smmresellerpanel",
          isActive: true,
          hasSync: true,
          usdNgnRate: 1550,
          usd_ngn_rate: 1550,
          markupPercent: 20,
          markup_percent: 20,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.smm._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.smm._id, smmresellerpanel._id as Types.ObjectId, 4, "smm <-> smmresellerpanel");

    // C. Virtual Number Rental & Email OTP Providers
    const fivesim = await Provider.findOneAndUpdate(
      { code: "fivesim" },
      {
        $set: {
          name: "5SIM",
          code: "fivesim",
          isActive: true,
          hasSync: false,
          usdNgnRate: 1500,
          usd_ngn_rate: 1500,
          markupPercent: 20,
          markup_percent: 20,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.number_rental._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.number_rental._id, fivesim._id as Types.ObjectId, 1, "number_rental <-> fivesim");

    const fleexa = await Provider.findOneAndUpdate(
      { code: "fleexa" },
      {
        $set: {
          name: "Fleexa",
          code: "fleexa",
          isActive: true,
          hasSync: false,
          markupPercent: 20,
          markup_percent: 20,
          deletedAt: null,
        },
        $addToSet: {
          serviceType: {
            $each: [serviceTypeMap.number_rental._id, serviceTypeMap.email_otp._id],
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.number_rental._id, fleexa._id as Types.ObjectId, 2, "number_rental <-> fleexa");
    await upsertMapping(serviceTypeMap.email_otp._id, fleexa._id as Types.ObjectId, 1, "email_otp <-> fleexa");

    const textverified = await Provider.findOneAndUpdate(
      { code: "textverified" },
      {
        $set: {
          name: "Textverified",
          code: "textverified",
          isActive: true,
          hasSync: false,
          usdNgnRate: 1550,
          usd_ngn_rate: 1550,
          markupPercent: 25,
          markup_percent: 25,
          deletedAt: null,
        },
        $addToSet: { serviceType: serviceTypeMap.number_rental._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await upsertMapping(serviceTypeMap.number_rental._id, textverified._id as Types.ObjectId, 3, "number_rental <-> textverified");

    // -----------------------------------------------------------------------
    // STEP 4: Baseline SMM Service Categories
    // -----------------------------------------------------------------------
    logger.info("\n[4/8] 📱 Seeding Baseline SMM Platform Categories...");
    const smmProviderIds = [nigeriasmm._id, owlet._id, smmfollows._id, smmresellerpanel._id];

    for (const platform of SMM_PLATFORMS) {
      const serviceDoc = await Service.findOneAndUpdate(
        { code: platform.code },
        {
          $set: {
            name: platform.name,
            code: platform.code,
            logo: platform.logo,
            serviceTypeId: serviceTypeMap.smm._id,
            isActive: true,
            status: "active",
            displayOrder: platform.displayOrder,
            deletedAt: null,
          },
          $addToSet: { supportedProviders: { $each: smmProviderIds } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      logger.info(`✓ SMM Platform '${platform.name}' (${platform.code}) upserted.`);
    }

    // -----------------------------------------------------------------------
    // STEP 5: Service Charges & Fee Rules
    // -----------------------------------------------------------------------
    logger.info("\n[5/8] 💳 Seeding Service Charges (Stamp Duty)...");
    const stampDuty = await ServiceCharge.findOneAndUpdate(
      { code: STAMP_DUTY.SERVICE_CHARGE_CODE },
      {
        $set: {
          name: "Withdrawal Stamp Duty",
          code: STAMP_DUTY.SERVICE_CHARGE_CODE,
          details: `Flat stamp duty charged on withdrawals of ₦${STAMP_DUTY.WITHDRAWAL_THRESHOLD.toLocaleString()} and above (CBN/FIRS EMTL)`,
          type: "flat",
          value: STAMP_DUTY.DEFAULT_AMOUNT,
          cap: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info(`✓ ServiceCharge '${stampDuty.name}' (₦${stampDuty.value}) upserted.`);

    // -----------------------------------------------------------------------
    // STEP 6: VIP & Reseller Tiers
    // -----------------------------------------------------------------------
    logger.info("\n[6/8] 👑 Seeding VIP / Reseller Tiers...");
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
      const tierDoc = await UserTier.findOneAndUpdate(
        { code: tierData.code },
        { $set: tierData },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      logger.info(`✓ User Tier '${tierDoc.name}' (Min Spend: ₦${tierDoc.minMonthlySpend.toLocaleString()}, Discount: ${tierDoc.discountPercentage}%) upserted.`);
    }

    // -----------------------------------------------------------------------
    // STEP 7: System Settings (Telegram Bot & Daily Streaks)
    // -----------------------------------------------------------------------
    logger.info("\n[7/8] ⚙️  Ensuring System Default Configurations...");
    const tgSetting = await TelegramBotSetting.findOneAndUpdate(
      {},
      {
        $setOnInsert: {
          welcomeMessage:
            "👋 Welcome to *Paymint*!\n\nYour #1 hub for Social Media Marketing, Virtual Phone Numbers, and Instant SMS OTP verifications.\n\nTap the button below to launch the app directly inside Telegram!",
          helpMessage:
            "💡 *Paymint Bot Commands*:\n\n• /start — Launch or link your Paymint account\n• /balance — Check your active wallet balance\n• /help — Show support and command list\n\nNeed support? Contact @paymint_support",
          isEnabled: true,
          miniAppUrl: process.env.FRONTEND_URL || "https://app.paymint.com",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info(`✓ TelegramBotSetting ensured (Enabled: ${tgSetting.isEnabled}).`);

    const streakSetting = await DailyStreakSetting.findOneAndUpdate(
      {},
      {
        $setOnInsert: {
          isEnabled: false,
          rewardAmount: 0,
          cooldownHours: 24,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info(`✓ DailyStreakSetting ensured (Enabled: ${streakSetting.isEnabled}, Amount: ₦${streakSetting.rewardAmount}).`);

    // -----------------------------------------------------------------------
    // STEP 8: Done
    // -----------------------------------------------------------------------
    logger.info("\n========================================================");
    logger.info("🎉 MASTER SEEDING COMPLETED WITH ZERO ERRORS!");
    logger.info("========================================================\n");
  } catch (error) {
    logger.error("❌ Master Seeding failed with error:", error);
    throw error;
  }
}

// Auto-run if executed directly via CLI
if (require.main === module) {
  runAllSeeders()
    .then(async () => {
      await mongoose.disconnect();
      logger.info("🔌 Disconnected from MongoDB.");
      process.exit(0);
    })
    .catch(async (err) => {
      await mongoose.disconnect();
      process.exit(1);
    });
}
