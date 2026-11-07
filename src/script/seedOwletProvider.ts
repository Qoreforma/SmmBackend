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
import { Service } from "../models/reference/Service";
import { ServiceTypeProvider } from "../models/reference/ServiceTypeProvider";
import { SMM_PLATFORMS } from "../types/smm";

async function seedOwletProvider() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for Owlet provider seed...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Ensure ServiceType "smm"
    // -----------------------------------------------------------------------
    let serviceType = await ServiceType.findOne({ code: "smm" });
    if (!serviceType) {
      serviceType = await ServiceType.create({
        name: "Social Media Marketing",
        code: "smm",
        description: "Social media engagement services (followers, likes, etc.)",
        icon: "FaShareAlt",
        status: "active",
      });
      logger.info('Created "smm" ServiceType.', { id: serviceType._id });
    } else {
      serviceType.status = "active";
      await serviceType.save();
      logger.info('Ensured "smm" ServiceType is active.', { id: serviceType._id });
    }

    // Also check other Owlet service types if they exist in DB
    const otherCodes = ["number_rental", "proxy", "game_topup"];
    const otherTypes = await ServiceType.find({ code: { $in: otherCodes } });
    const allAssociatedServiceTypeIds = [
      serviceType._id,
      ...otherTypes.map((st) => st._id),
    ];

    // -----------------------------------------------------------------------
    // 2. Ensure Provider "owlet" (single canonical record)
    // -----------------------------------------------------------------------
    let provider = await Provider.findOne({ code: "owlet" });
    if (!provider) {
      provider = await Provider.create({
        name: "Owlet",
        code: "owlet",
        serviceType: allAssociatedServiceTypeIds,
        isActive: true,
        hasSync: true,
      });
      logger.info('Created single canonical "owlet" Provider.', { id: provider._id });
    } else {
      provider.name = "Owlet";
      provider.hasSync = true;
      provider.isActive = true;
      for (const stId of allAssociatedServiceTypeIds) {
        if (!provider.serviceType.some((st) => st.toString() === stId.toString())) {
          provider.serviceType.push(stId);
        }
      }
      await provider.save();
      logger.info('Updated "owlet" Provider with hasSync: true, isActive: true.', { id: provider._id });
    }

    // -----------------------------------------------------------------------
    // 3. Upsert ServiceTypeProvider mapping for each service type
    // -----------------------------------------------------------------------
    for (const stId of allAssociatedServiceTypeIds) {
      let stp = await ServiceTypeProvider.findOne({
        serviceTypeId: stId,
        providerId: provider._id,
      });

      if (!stp) {
        stp = await ServiceTypeProvider.create({
          serviceTypeId: stId,
          providerId: provider._id,
          isActive: true,
          priority: 1,
        });
        logger.info(`Created ServiceTypeProvider mapping for ${stId} <-> owlet`, { id: stp._id });
      } else {
        stp.isActive = true;
        stp.deletedAt = undefined;
        await stp.save();
        logger.info(`Updated ServiceTypeProvider mapping for ${stId} <-> owlet`, { id: stp._id });
      }
    }

    // -----------------------------------------------------------------------
    // 4. Ensure Platform Services (Instagram, Facebook, Threads, etc.) exist
    // -----------------------------------------------------------------------
    for (const p of SMM_PLATFORMS) {
      let service = await Service.findOne({
        code: p.code,
        serviceTypeId: serviceType._id,
      });

      if (!service) {
        service = await Service.create({
          code: p.code,
          name: p.name,
          logo: p.logo,
          displayOrder: p.displayOrder,
          serviceTypeId: serviceType._id,
          isActive: true,
        });
        logger.info(`Created platform Service: "${p.name}" (${p.code})`, { id: service._id });
      } else {
        if (!service.logo || service.logo.includes(".svg")) {
          service.logo = p.logo;
        }
        service.displayOrder = p.displayOrder;
        service.isActive = true;
        await service.save();
      }
    }

    console.log("\n==================================================");
    console.log("             OWLET PROVIDER SEED SUMMARY          ");
    console.log("==================================================");
    console.log(`Provider:    "${provider.name}" (${provider.code})`);
    console.log(`ServiceTypes linked: ${allAssociatedServiceTypeIds.length}`);
    console.log("Platforms:   Ensured all SMM canonical platform services exist");
    console.log("==================================================\n");

    process.exit(0);
  } catch (err: any) {
    logger.error("seedOwletProvider failed:", err);
    process.exit(1);
  }
}

seedOwletProvider();
