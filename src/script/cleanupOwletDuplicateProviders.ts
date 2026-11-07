import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

// Ensure DNS servers resolve SRV records on all networks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_) {}

const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

import logger from "../logger";
import { Provider } from "../models/reference/Provider";
import { ServiceType } from "../models/reference/ServiceType";
import { ServiceTypeProvider } from "../models/reference/ServiceTypeProvider";
import { Product } from "../models/reference/Product";
import { Service } from "../models/reference/Service";

const DUPLICATE_CODES = [
  "owlet_comfort",
  "owlet_nyra",
  "owlet_gamerzone",
  "owlet_talktiyu",
  "owlet_rhombus",
  "owlet_smm",
];

async function cleanupOwletDuplicateProviders() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error("MONGODB_URI is not defined in the environment. Exiting.");
    process.exit(1);
  }

  try {
    logger.info("Connecting to MongoDB for Owlet cleanup...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");
  } catch (err: any) {
    logger.error("MongoDB connection failed:", err);
    process.exit(1);
  }

  try {
    console.log("\n========================================================");
    console.log("   CLEANUP OWLET DUPLICATE PROVIDERS & CONSOLIDATE      ");
    console.log("========================================================\n");

    // 1. Locate canonical "owlet" provider
    let canonicalOwlet = await Provider.findOne({ code: "owlet" });
    if (!canonicalOwlet) {
      logger.info("Canonical Owlet provider not found. Creating canonical record...");
      canonicalOwlet = await Provider.create({
        name: "Owlet",
        code: "owlet",
        isActive: true,
        hasSync: true,
        serviceType: [],
      });
      logger.info(`Created canonical Owlet provider: ${canonicalOwlet._id}`);
    } else {
      logger.info(`Found canonical Owlet provider: ${canonicalOwlet._id} (code: "owlet")`);
    }

    // 2. Find duplicate providers
    const duplicateProviders = await Provider.find({
      code: { $in: DUPLICATE_CODES },
    });

    if (duplicateProviders.length === 0) {
      console.log("No duplicate Owlet provider records found in database.");
    } else {
      console.log(`Found ${duplicateProviders.length} duplicate Owlet provider records:`);
      for (const dup of duplicateProviders) {
        console.log(`  - ${dup.name} (code: "${dup.code}", id: ${dup._id})`);
      }

      const duplicateIds = duplicateProviders.map((d) => d._id);

      // Remap Products
      const productUpdateResult = await Product.updateMany(
        { providerId: { $in: duplicateIds } },
        { $set: { providerId: canonicalOwlet._id } }
      );
      console.log(`\nRemapped ${productUpdateResult.modifiedCount} Product documents to canonical Owlet.`);

      // Remap Services (supportedProviders array)
      const affectedServices = await Service.find({
        supportedProviders: { $in: duplicateIds },
      });
      let servicesUpdated = 0;
      for (const service of affectedServices) {
        const updatedProviders = service.supportedProviders
          .map((id) => (duplicateIds.some((dupId) => dupId.equals(id)) ? canonicalOwlet!._id : id))
          .filter((id, idx, arr) => arr.findIndex((x) => x.equals(id)) === idx);

        service.supportedProviders = updatedProviders;
        await service.save();
        servicesUpdated++;
      }
      console.log(`Updated ${servicesUpdated} Service documents to include canonical Owlet.`);

      // Remap/Consolidate ServiceTypeProvider mappings
      for (const dup of duplicateProviders) {
        const stps = await ServiceTypeProvider.find({ providerId: dup._id });
        for (const stp of stps) {
          // Check if canonical mapping already exists
          const existingCanonicalStp = await ServiceTypeProvider.findOne({
            serviceTypeId: stp.serviceTypeId,
            providerId: canonicalOwlet._id,
          });

          if (existingCanonicalStp) {
            // Remove redundant mapping
            await ServiceTypeProvider.findByIdAndDelete(stp._id);
            logger.info(
              `Deleted redundant ServiceTypeProvider mapping for serviceTypeId: ${stp.serviceTypeId}`
            );
          } else {
            // Re-point mapping to canonical provider
            stp.providerId = canonicalOwlet._id as any;
            stp.isActive = true;
            stp.deletedAt = undefined;
            await stp.save();
            logger.info(
              `Re-pointed ServiceTypeProvider mapping for serviceTypeId: ${stp.serviceTypeId} to canonical Owlet`
            );
          }
        }
      }

      // Collect any serviceTypes attached to duplicates into canonical
      for (const dup of duplicateProviders) {
        for (const stId of dup.serviceType || []) {
          if (!canonicalOwlet.serviceType.some((id: any) => id.toString() === stId.toString())) {
            canonicalOwlet.serviceType.push(stId);
          }
        }
      }

      // Delete the duplicate Provider records
      const deleteResult = await Provider.deleteMany({
        _id: { $in: duplicateIds },
      });
      console.log(`Deleted ${deleteResult.deletedCount} duplicate Provider records from database.`);
    }

    // 3. Ensure all active Owlet service types are mapped
    const allServiceCodes = [
      "smm",
      "game_topup",
      "number_rental",
      "proxy",
    ];
    for (const code of allServiceCodes) {
      const st = await ServiceType.findOne({ code });
      if (st) {
        if (!canonicalOwlet.serviceType.some((id: any) => id.toString() === st._id.toString())) {
          canonicalOwlet.serviceType.push(st._id as any);
        }

        let stp = await ServiceTypeProvider.findOne({
          serviceTypeId: st._id,
          providerId: canonicalOwlet._id,
        });

        if (!stp) {
          await ServiceTypeProvider.create({
            serviceTypeId: st._id,
            providerId: canonicalOwlet._id,
            isActive: true,
            priority: 1,
          });
          logger.info(`Created canonical ServiceTypeProvider mapping for ${code}`);
        } else {
          stp.isActive = true;
          stp.deletedAt = undefined;
          await stp.save();
        }
      }
    }

    canonicalOwlet.isActive = true;
    canonicalOwlet.hasSync = true;
    await canonicalOwlet.save();
    logger.info("Canonical Owlet provider updated and saved successfully.");

    console.log("\n========================================================");
    console.log("   OWLET CONSOLIDATION COMPLETED SUCCESSFULLY!          ");
    console.log("========================================================\n");
    process.exit(0);
  } catch (error: any) {
    logger.error("Error during Owlet cleanup:", error);
    process.exit(1);
  }
}

cleanupOwletDuplicateProviders();
