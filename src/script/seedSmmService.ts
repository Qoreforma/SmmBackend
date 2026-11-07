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
import { Service } from "../models/reference/Service";
import { Product } from "../models/reference/Product";
import {
  SMM_PLATFORMS,
  resolveSmmPlatformCode,
  resolveSmmProductType,
} from "../types/smm";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  logger.error("Error: MONGODB_URI is not defined in the environment.");
  process.exit(1);
}

async function seedAndMigrateSmm() {
  try {
    logger.info("Connecting to MongoDB for SMM seed...");
    await mongoose.connect(MONGODB_URI || "", { serverSelectionTimeoutMS: 5000 });
    logger.info("Connected to MongoDB successfully.");

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

    // -----------------------------------------------------------------------
    // 2. Ensure Provider "nigeriasmm"
    // -----------------------------------------------------------------------
    let provider = await Provider.findOne({ code: "nigeriasmm" });
    if (!provider) {
      provider = await Provider.create({
        name: "Nigeria SMM",
        code: "nigeriasmm",
        type: "bill_provider",
        isActive: true,
        hasSync: true,
      });
      logger.info('Created "nigeriasmm" Provider.', { id: provider._id });
    } else {
      provider.hasSync = true;
      provider.isActive = true;
      await provider.save();
      logger.info('Updated "nigeriasmm" Provider with hasSync: true.', { id: provider._id });
    }

    // -----------------------------------------------------------------------
    // 3. Ensure Clean Platform Services (Instagram, Facebook, Threads, etc.)
    // -----------------------------------------------------------------------
    const platformMap = new Map<string, any>(); // code -> Service doc

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
        service.name = p.name;
        if (!service.logo || service.logo.includes(".svg")) {
          service.logo = p.logo;
        }
        service.displayOrder = p.displayOrder;
        service.isActive = true;
        await service.save();
        logger.info(`Updated platform Service: "${p.name}" (${p.code})`, { id: service._id });
      }

      platformMap.set(p.code, service);
    }

    const canonicalCodes = new Set(SMM_PLATFORMS.map((p) => p.code));

    // -----------------------------------------------------------------------
    // 4. Migrate Products from old fragmented services to platform services (if any)
    // -----------------------------------------------------------------------
    const allSmmServices = await Service.find({ serviceTypeId: serviceType._id });
    const allSmmServiceIds = allSmmServices.map((s) => s._id);
    const serviceNameById = new Map<string, string>(
      allSmmServices.map((s) => [s._id.toString(), s.name]),
    );

    const existingProducts = await Product.find({
      $or: [
        { serviceId: { $in: allSmmServiceIds } },
        { providerId: provider._id },
      ],
    });

    logger.info(`Found ${existingProducts.length} SMM products to evaluate/migrate.`);

    let migratedProductsCount = 0;
    for (const product of existingProducts) {
      const oldServiceName = serviceNameById.get(product.serviceId?.toString()) || "";
      const targetPlatformCode = resolveSmmPlatformCode(oldServiceName, product.name);
      const targetService = platformMap.get(targetPlatformCode) || platformMap.get("smm-instagram");

      if (!targetService) continue;

      const productType = resolveSmmProductType(oldServiceName, product.name);

      const needsUpdate =
        product.serviceId?.toString() !== targetService._id.toString() ||
        product.productType !== productType ||
        product.attributes?.productType !== productType ||
        product.attributes?.platform !== targetPlatformCode;

      if (needsUpdate) {
        product.serviceId = targetService._id;
        product.productType = productType;
        product.attributes = {
          ...(product.attributes || {}),
          productType,
          platform: targetPlatformCode,
          originalCategory: oldServiceName || product.attributes?.originalCategory || "",
        };
        await product.save();
        migratedProductsCount++;
      }
    }

    logger.info(`Product migration complete. ${migratedProductsCount} products updated with clean platform and productType.`);

    // -----------------------------------------------------------------------
    // 5. Clean up old fragmented services (safe cleanup)
    // -----------------------------------------------------------------------
    const oldFragmentedServices = allSmmServices.filter(
      (s) => !canonicalCodes.has(s.code),
    );

    let deletedServicesCount = 0;
    for (const oldSvc of oldFragmentedServices) {
      const remainingProducts = await Product.countDocuments({ serviceId: oldSvc._id });
      if (remainingProducts === 0) {
        await Service.findByIdAndDelete(oldSvc._id);
        deletedServicesCount++;
        logger.info(`Deleted obsolete fragmented Service: "${oldSvc.name}" (${oldSvc.code})`);
      } else {
        logger.warn(
          `Service "${oldSvc.name}" (${oldSvc.code}) still has ${remainingProducts} products — skipping deletion.`,
        );
      }
    }

    logger.info(`Cleaned up ${deletedServicesCount} obsolete fragmented Services.`);

    // -----------------------------------------------------------------------
    // 6. Print summary of final state
    // -----------------------------------------------------------------------
    console.log("\n==================================================");
    console.log("             SMM SEED & MIGRATION SUMMARY         ");
    console.log("==================================================");
    console.log(`ServiceType: "${serviceType.name}" (${serviceType.code}) - Status: ${serviceType.status}`);
    console.log(`Provider:    "${provider.name}" (${provider.code}) - Sync: ${provider.hasSync}`);
    console.log("\nActive Platform Services:");
    for (const p of SMM_PLATFORMS) {
      const svc = platformMap.get(p.code);
      if (!svc) continue;
      const count = await Product.countDocuments({ serviceId: svc._id, isActive: true });
      const types = await Product.distinct("productType", { serviceId: svc._id, isActive: true });
      console.log(`- [${svc.name}] (code: ${svc.code}): ${count} active products across types [${types.join(", ")}]`);
    }
    console.log("==================================================\n");

    logger.info("SMM seeding & migration completed successfully.");
    process.exit(0);
  } catch (error) {
    logger.error("Error during SMM seeding/migration:", error);
    process.exit(1);
  }
}

seedAndMigrateSmm();
