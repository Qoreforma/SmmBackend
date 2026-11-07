import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

// Ensure DNS servers resolve SRV records on all networks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_) {}

// Load environment variables
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

import logger from "../logger";
import { Provider } from "../models/reference/Provider";
import { ServiceType } from "../models/reference/ServiceType";
import { ServiceTypeProvider } from "../models/reference/ServiceTypeProvider";

async function seedFleexaProvider() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for Fleexa provider seed...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Ensure ServiceType "number_rental"
    // -----------------------------------------------------------------------
    let numberRentalType = await ServiceType.findOne({ code: "number_rental" });
    if (!numberRentalType) {
      numberRentalType = await ServiceType.create({
        name: "Virtual Number Rental",
        code: "number_rental",
        description: "Temporary virtual phone numbers for receiving SMS verification codes",
        icon: "FaPhoneAlt",
        status: "active",
      });
      logger.info('Created "number_rental" ServiceType.', { id: numberRentalType._id });
    } else {
      numberRentalType.status = "active";
      await numberRentalType.save();
      logger.info('Ensured "number_rental" ServiceType is active.', { id: numberRentalType._id });
    }

    // -----------------------------------------------------------------------
    // 2. Ensure ServiceType "email_otp"
    // -----------------------------------------------------------------------
    let emailOtpType = await ServiceType.findOne({ code: "email_otp" });
    if (!emailOtpType) {
      emailOtpType = await ServiceType.create({
        name: "Email OTP",
        code: "email_otp",
        description: "Temporary disposable email addresses for receiving OTP verification codes",
        icon: "FaEnvelope",
        status: "active",
      });
      logger.info('Created "email_otp" ServiceType.', { id: emailOtpType._id });
    } else {
      emailOtpType.status = "active";
      await emailOtpType.save();
      logger.info('Ensured "email_otp" ServiceType is active.', { id: emailOtpType._id });
    }

    // -----------------------------------------------------------------------
    // 3. Ensure Provider "fleexa"
    // -----------------------------------------------------------------------
    let provider = await Provider.findOne({ code: "fleexa" });
    if (!provider) {
      provider = await Provider.create({
        name: "Fleexa",
        code: "fleexa",
        serviceType: [numberRentalType._id, emailOtpType._id],
        isActive: true,
        hasSync: false,
        markupPercent: 0,
        markup_percent: 0,
      });
      logger.info('Created "fleexa" Provider document.', { id: provider._id });
    } else {
      provider.name = "Fleexa";
      provider.isActive = true;
      if (provider.markupPercent === undefined) provider.markupPercent = 0;
      if (provider.markup_percent === undefined) provider.markup_percent = 0;
      if (!provider.serviceType.some((st) => st.toString() === numberRentalType!._id.toString())) {
        provider.serviceType.push(numberRentalType._id);
      }
      if (!provider.serviceType.some((st) => st.toString() === emailOtpType!._id.toString())) {
        provider.serviceType.push(emailOtpType._id);
      }
      await provider.save();
      logger.info('Updated "fleexa" Provider document.', { id: provider._id });
    }

    // -----------------------------------------------------------------------
    // 4. Upsert ServiceTypeProvider for "email_otp" -> Fleexa (Priority 1)
    // -----------------------------------------------------------------------
    const emailMapping = await ServiceTypeProvider.findOneAndUpdate(
      {
        serviceTypeId: emailOtpType._id,
        providerId: provider._id,
      },
      {
        serviceTypeId: emailOtpType._id,
        providerId: provider._id,
        priority: 1,
        isActive: true,
        deletedAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info('Upserted ServiceTypeProvider mapping for email_otp -> fleexa (priority 1).', {
      id: emailMapping._id,
    });

    // -----------------------------------------------------------------------
    // 5. Upsert ServiceTypeProvider for "number_rental" -> Fleexa (Priority 2)
    // -----------------------------------------------------------------------
    const numberMapping = await ServiceTypeProvider.findOneAndUpdate(
      {
        serviceTypeId: numberRentalType._id,
        providerId: provider._id,
      },
      {
        serviceTypeId: numberRentalType._id,
        providerId: provider._id,
        priority: 2,
        isActive: true,
        deletedAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info('Upserted ServiceTypeProvider mapping for number_rental -> fleexa (priority 2).', {
      id: numberMapping._id,
    });

    logger.info("Fleexa Provider and ServiceType mappings seeded successfully.");
    process.exit(0);
  } catch (error: any) {
    logger.error("Failed to seed Fleexa provider:", error);
    process.exit(1);
  }
}

seedFleexaProvider();
