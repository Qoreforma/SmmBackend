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

async function seedTextverifiedProvider() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for Textverified provider seed...");
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
    // 2. Ensure Provider "textverified"
    // -----------------------------------------------------------------------
    let provider = await Provider.findOne({ code: "textverified" });
    if (!provider) {
      provider = await Provider.create({
        name: "Textverified",
        code: "textverified",
        serviceType: [numberRentalType._id],
        isActive: true,
        hasSync: false,
        usdNgnRate: 1550,
        usd_ngn_rate: 1550,
        markupPercent: 20,
        markup_percent: 20,
      });
      logger.info('Created "textverified" Provider document.', { id: provider._id });
    } else {
      provider.name = "Textverified";
      provider.isActive = true;
      if (provider.usdNgnRate === undefined) provider.usdNgnRate = 1550;
      if (provider.usd_ngn_rate === undefined) provider.usd_ngn_rate = 1550;
      if (provider.markupPercent === undefined) provider.markupPercent = 20;
      if (provider.markup_percent === undefined) provider.markup_percent = 20;
      if (!provider.serviceType.some((st) => st.toString() === numberRentalType!._id.toString())) {
        provider.serviceType.push(numberRentalType._id);
      }
      await provider.save();
      logger.info('Updated "textverified" Provider document.', { id: provider._id });
    }

    // -----------------------------------------------------------------------
    // 3. Upsert ServiceTypeProvider for "number_rental" -> Textverified (Priority 2)
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
    logger.info('Upserted ServiceTypeProvider mapping for number_rental -> textverified (priority 2).', {
      id: numberMapping._id,
    });

    logger.info("Textverified Provider and ServiceType mappings seeded successfully.");
    process.exit(0);
  } catch (error: any) {
    logger.error("Failed to seed Textverified provider:", error);
    process.exit(1);
  }
}

seedTextverifiedProvider();
