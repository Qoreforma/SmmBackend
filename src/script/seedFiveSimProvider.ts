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

async function seedFiveSimProvider() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for 5SIM provider seed...");
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
    let serviceType = await ServiceType.findOne({ code: "number_rental" });
    if (!serviceType) {
      serviceType = await ServiceType.create({
        name: "Virtual Number Rental",
        code: "number_rental",
        description: "Temporary virtual phone numbers for receiving SMS verification codes",
        icon: "FaPhoneAlt",
        status: "active",
      });
      logger.info('Created "number_rental" ServiceType.', { id: serviceType._id });
    } else {
      serviceType.status = "active";
      await serviceType.save();
      logger.info('Ensured "number_rental" ServiceType is active.', { id: serviceType._id });
    }

    // -----------------------------------------------------------------------
    // 2. Ensure Provider "fivesim"
    // -----------------------------------------------------------------------
    let provider = await Provider.findOne({ code: "fivesim" });

    if (!provider) {
      provider = await Provider.create({
        name: "5SIM",
        code: "fivesim",
        serviceType: [serviceType._id],
        isActive: true,
        hasSync: false,
        usdNgnRate: 1500,
        usd_ngn_rate: 1500,
        markupPercent: 20,
        markup_percent: 20,
      });
      logger.info('Created canonical "fivesim" Provider.', { id: provider._id });
    } else {
      provider.name = "5SIM";
      provider.isActive = true;
      if (provider.usdNgnRate === undefined) provider.usdNgnRate = 1500;
      if (provider.usd_ngn_rate === undefined) provider.usd_ngn_rate = 1500;
      if (provider.markupPercent === undefined) provider.markupPercent = 20;
      if (provider.markup_percent === undefined) provider.markup_percent = 20;
      if (!provider.serviceType.some((st) => st.toString() === serviceType!._id.toString())) {
        provider.serviceType.push(serviceType._id);
      }
      await provider.save();
      logger.info('Updated "fivesim" Provider with active status.', { id: provider._id });
    }

    // -----------------------------------------------------------------------
    // 3. Upsert ServiceTypeProvider mapping with priority 1 for 5SIM
    // -----------------------------------------------------------------------
    let stp = await ServiceTypeProvider.findOne({
      serviceTypeId: serviceType._id,
      providerId: provider._id,
    });

    if (!stp) {
      stp = await ServiceTypeProvider.create({
        serviceTypeId: serviceType._id,
        providerId: provider._id,
        isActive: true,
        priority: 1,
      });
      logger.info('Created ServiceTypeProvider mapping for number_rental <-> fivesim (priority: 1)', {
        id: stp._id,
      });
    } else {
      stp.isActive = true;
      stp.priority = 1;
      stp.deletedAt = undefined;
      await stp.save();
      logger.info('Updated ServiceTypeProvider mapping for number_rental <-> fivesim (priority: 1)', {
        id: stp._id,
      });
    }

    // -----------------------------------------------------------------------
    // 4. Update Owlet mapping priority to 2 for number_rental (if it exists)
    // -----------------------------------------------------------------------
    const owletProvider = await Provider.findOne({ code: "owlet" });
    if (owletProvider) {
      const owletStp = await ServiceTypeProvider.findOne({
        serviceTypeId: serviceType._id,
        providerId: owletProvider._id,
      });
      if (owletStp && owletStp.priority === 1) {
        owletStp.priority = 2;
        await owletStp.save();
        logger.info('Updated Owlet mapping priority to 2 for number_rental', { id: owletStp._id });
      }
    }

    logger.info("5SIM provider seeded successfully.");
  } catch (error: any) {
    logger.error("Error seeding 5SIM provider:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info("Disconnected from MongoDB.");
  }
}

// Execute if run directly
if (require.main === module) {
  seedFiveSimProvider()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("Fatal error:", err);
      process.exit(1);
    });
}

export default seedFiveSimProvider;
