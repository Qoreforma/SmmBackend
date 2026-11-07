import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import logger from "@/logger";
import { ServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { STAMP_DUTY } from "@/utils/constants";

const seedWithdrawalStampDuty = async () => {
  try {
    logger.info("🚀 Seeding withdrawal stamp duty service charge...");

    await mongoose.connect(process.env.MONGODB_URI!);
    logger.info("✅ Connected to database");

    const existing = await ServiceCharge.findOne({
      code: STAMP_DUTY.SERVICE_CHARGE_CODE,
    });

    if (existing) {
      logger.info("⚠️  Withdrawal stamp duty charge already exists, skipping", {
        id: existing.id.toString(),
        code: existing.code,
        type: existing.type,
        value: existing.value,
      });
      return;
    }

    const serviceCharge = await ServiceCharge.create({
      name: "Withdrawal Stamp Duty",
      code: STAMP_DUTY.SERVICE_CHARGE_CODE,
      details: `Flat stamp duty charged on withdrawals of ₦${STAMP_DUTY.WITHDRAWAL_THRESHOLD.toLocaleString()} and above (CBN/FIRS EMTL)`,
      type: "flat",
      value: STAMP_DUTY.DEFAULT_AMOUNT,
    });

    logger.info("✅ Withdrawal stamp duty charge created successfully", {
      id: serviceCharge.id.toString(),
      code: serviceCharge.code,
      type: serviceCharge.type,
      value: serviceCharge.value,
    });
  } catch (error) {
    logger.error("Failed to seed withdrawal stamp duty charge", {
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

seedWithdrawalStampDuty();
