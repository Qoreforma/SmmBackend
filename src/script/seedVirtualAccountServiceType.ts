import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

// Ensure DNS servers resolve SRV records on all networks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_) { }

// Load environment variables
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

import logger from "../logger";
import { Provider } from "../models/reference/Provider";
import { ServiceType } from "../models/reference/ServiceType";
import { ServiceTypeProvider } from "../models/reference/ServiceTypeProvider";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  logger.error("Error: MONGODB_URI is not defined in the environment.");
  process.exit(1);
}

async function seedVirtualAccountServiceType() {
  try {
    logger.info("Connecting to MongoDB for Virtual Account ServiceType seed...");
    await mongoose.connect(MONGODB_URI || "", { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");

    // -----------------------------------------------------------------------
    // 1. Ensure ServiceType "virtual_account"
    // -----------------------------------------------------------------------
    let serviceType = await ServiceType.findOne({ code: "virtual_account" });
    if (!serviceType) {
      serviceType = await ServiceType.create({
        name: "Virtual Account",
        code: "virtual_account",
        description: "Static virtual account creation service provider (SafeHaven, Xixapay)",
        icon: "FaUniversity",
        status: "active",
      });
      logger.info('Created "virtual_account" ServiceType.', { id: serviceType._id });
    } else {
      serviceType.status = "active";
      serviceType.name = "Virtual Account";
      await serviceType.save();
      logger.info('Ensured "virtual_account" ServiceType is active.', { id: serviceType._id });
    }

    // -----------------------------------------------------------------------
    // 2. Link SafeHaven Provider
    // -----------------------------------------------------------------------
    const safeHavenProvider = await Provider.findOne({
      code: { $regex: /^savehaven$/i },
      deletedAt: null,
    });

    if (safeHavenProvider) {
      // Add serviceType to provider's serviceType array if missing
      const hasSt = safeHavenProvider.serviceType?.some(
        (id: any) => id.toString() === serviceType._id.toString(),
      );
      if (!hasSt) {
        safeHavenProvider.serviceType = [
          ...(safeHavenProvider.serviceType || []),
          serviceType._id as Types.ObjectId,
        ];
        await safeHavenProvider.save();
        logger.info("Added virtual_account to SafeHaven provider serviceTypes.");
      }

      // Upsert ServiceTypeProvider mapping (Priority 1, Active)
      let stp = await ServiceTypeProvider.findOne({
        serviceTypeId: serviceType._id,
        providerId: safeHavenProvider._id,
      });

      if (!stp) {
        stp = await ServiceTypeProvider.create({
          serviceTypeId: serviceType._id,
          providerId: safeHavenProvider._id,
          isActive: true,
          priority: 1,
        });
        logger.info("Created ServiceTypeProvider for SafeHaven (Priority 1, Active).");
      } else {
        stp.isActive = true;
        stp.priority = 1;
        await stp.save();
        logger.info("Updated ServiceTypeProvider for SafeHaven (Priority 1, Active).");
      }
    } else {
      logger.warn("SafeHaven provider not found in database.");
    }

    // -----------------------------------------------------------------------
    // 3. Link Xixapay Provider
    // -----------------------------------------------------------------------
    const xixapayProvider = await Provider.findOne({
      code: { $regex: /^xixapay$/i },
      deletedAt: null,
    });

    if (xixapayProvider) {
      // Add serviceType to provider's serviceType array if missing
      const hasSt = xixapayProvider.serviceType?.some(
        (id: any) => id.toString() === serviceType._id.toString(),
      );
      if (!hasSt) {
        xixapayProvider.serviceType = [
          ...(xixapayProvider.serviceType || []),
          serviceType._id as Types.ObjectId,
        ];
        await xixapayProvider.save();
        logger.info("Added virtual_account to Xixapay provider serviceTypes.");
      }

      // Upsert ServiceTypeProvider mapping (Priority 2, Active)
      let stp = await ServiceTypeProvider.findOne({
        serviceTypeId: serviceType._id,
        providerId: xixapayProvider._id,
      });

      if (!stp) {
        stp = await ServiceTypeProvider.create({
          serviceTypeId: serviceType._id,
          providerId: xixapayProvider._id,
          isActive: false, // Default to SafeHaven primary, Xixapay available to toggle
          priority: 2,
        });
        logger.info("Created ServiceTypeProvider for Xixapay (Priority 2, Inactive).");
      } else {
        stp.priority = 2;
        await stp.save();
        logger.info("Updated ServiceTypeProvider for Xixapay (Priority 2).");
      }
    } else {
      logger.warn("Xixapay provider not found in database.");
    }

    logger.info("✅ Virtual Account ServiceType seeding completed successfully.");
  } catch (error) {
    logger.error("Failed to seed Virtual Account ServiceType:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info("Disconnected from MongoDB.");
  }
}

seedVirtualAccountServiceType();
