import { BaseSyncService } from "./BaseSyncService";
import { Product } from "@/models/reference/Product";
import { Provider } from "@/models/reference/Provider";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
} from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";
import ServiceContainer from "../client/container";
import { NigeriaSmmService } from "../client/providers/smm/NigeriaSmmService";
import {
  SMM_PLATFORMS,
  resolveSmmPlatformCode,
  resolveSmmProductType,
} from "@/types/smm";

interface SyncResult {
  success: boolean;
  provider: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  created: number;
  updated: number;
  deleted: number;
  total: number;
  failed: number;
  errors: string[];
}

export class ProductSyncService extends BaseSyncService {
  private nigeriaSmmService = ServiceContainer.getNigeriaSmmService();
  private owletService = ServiceContainer.getOwletService();
  private smmFollowsService = ServiceContainer.getSmmFollowsService();
  private smmResellerPanelService = ServiceContainer.getSmmResellerPanelService();

  async syncProviderProducts(
    providerId: string,
    options?: {
      serviceTypeId?: string;
      forceUpdate?: boolean;
    },
  ): Promise<SyncResult> {
    const startTime = new Date();

    return await this.executeSyncOperation(
      "Provider Product Sync",
      async () => {
        const provider = await Provider.findById(providerId);
        if (!provider) {
          throw new AppError(
            "Provider not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        if (!provider.isActive) {
          throw new AppError(
            "Cannot sync inactive provider",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        if (!provider.hasSync) {
          throw new AppError(
            `Provider ${provider.name} does not support automatic syncing`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        switch (provider.code.toLowerCase()) {
          case "nigeriasmm":
            logger.info(
              `Provider "${provider.name}" is an SMM panel. Running Nigeria SMM sync...`,
            );
            try {
              const smmSyncResult = await this.syncNigeriaSmmProducts(providerId);

              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              return this.buildSyncResult(provider.name, startTime, {
                created: smmSyncResult.created,
                updated: smmSyncResult.updated,
                deleted: 0,
                total: smmSyncResult.total,
                failed: smmSyncResult.failed,
              });
            } catch (err: any) {
              logger.error("Nigeria SMM sync failed in ProductSyncService", {
                error: err.message,
              });
              throw err;
            }

          case "owlet":
          case "owlet_smm":
            logger.info(
              `Provider "${provider.name}" is Owlet. Running Owlet SMM sync...`,
            );
            try {
              const smmSyncResult = await this.syncOwletSmmProducts(providerId);

              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              return this.buildSyncResult(provider.name, startTime, {
                created: smmSyncResult.created,
                updated: smmSyncResult.updated,
                deleted: 0,
                total: smmSyncResult.total,
                failed: smmSyncResult.failed,
              });
            } catch (err: any) {
              logger.error("Owlet SMM sync failed in ProductSyncService", {
                error: err.message,
              });
              throw err;
            }

          case "smmfollows":
          case "smm_follows":
            logger.info(
              `Provider "${provider.name}" is SMMFollows. Running SMMFollows sync...`,
            );
            try {
              const smmSyncResult = await this.syncSmmFollowsProducts(providerId);

              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              return this.buildSyncResult(provider.name, startTime, {
                created: smmSyncResult.created,
                updated: smmSyncResult.updated,
                deleted: 0,
                total: smmSyncResult.total,
                failed: smmSyncResult.failed,
              });
            } catch (err: any) {
              logger.error("SMMFollows sync failed in ProductSyncService", {
                error: err.message,
              });
              throw err;
            }

          case "smmresellerpanel":
          case "smm_reseller_panel":
            logger.info(
              `Provider "${provider.name}" is SMMResellerPanel. Running SMMResellerPanel sync...`,
            );
            try {
              const smmSyncResult = await this.syncSmmResellerPanelProducts(providerId);

              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              return this.buildSyncResult(provider.name, startTime, {
                created: smmSyncResult.created,
                updated: smmSyncResult.updated,
                deleted: 0,
                total: smmSyncResult.total,
                failed: smmSyncResult.failed,
              });
            } catch (err: any) {
              logger.error("SMMResellerPanel sync failed in ProductSyncService", {
                error: err.message,
              });
              throw err;
            }

          default:
            throw new AppError(
              `Sync not implemented for provider: ${provider.name}`,
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
        }
      },
      { providerId, options },
    );
  }

  // -------------------------------------------------------------------------
  // SMM SYNC CONFIGURATION
  // All canonical social media platforms and supported service types.
  // -------------------------------------------------------------------------
  private readonly SMM_STARTER_CATEGORIES = [
    "Instagram",
    "Facebook",
    "Threads",
    "TikTok",
    "Twitter",
    "X",
    "YouTube",
    "Telegram",
    "Spotify",
    "LinkedIn",
  ];

  private readonly SUPPORTED_SMM_TYPES = [
    "Default",
    "Package",
    "Custom Comments",
    "Custom Comments Package",
    "Mentions",
    "Mentions with Hashtags",
    "Mentions Custom List",
    "Mentions User Followers",
    "Poll",
    "Subscriptions",
    "Comment Likes",
  ];

  async syncNigeriaSmmProducts(providerId: string): Promise<{
    created: number;
    updated: number;
    total: number;
    failed: number;
  }> {
    let created = 0;
    let updated = 0;
    let failed = 0;

    // 1. Find the smm ServiceType
    const serviceType = await ServiceType.findOne({ code: "smm" });
    if (!serviceType) {
      throw new AppError(
        "SMM ServiceType not found — run seed script first",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    // 2. Fetch all services from Nigeria SMM
    const allServices = await this.nigeriaSmmService.getServices();
    logger.info(`Nigeria SMM: fetched ${allServices.length} services from API`);

    // 3. Filter to starter categories only (v1 scope)
    const filtered = allServices.filter((s) =>
      s.category &&
      this.SMM_STARTER_CATEGORIES.some(
        (cat) => s.category.toLowerCase().includes(cat.toLowerCase()),
      ),
    );
    logger.info(
      `Nigeria SMM: ${filtered.length} services in starter categories`,
      { categories: this.SMM_STARTER_CATEGORIES },
    );

    // 4. Markup percentage from Provider model — fail loudly if not set
    const provider = await Provider.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    const rawMarkup = provider.markupPercent ?? provider.markup_percent;
    if (rawMarkup === undefined || rawMarkup === null || isNaN(Number(rawMarkup)) || Number(rawMarkup) < 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have markup_percent configured in Provider model. Please set markup_percent via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const markupPercent = Number(rawMarkup) / 100;

    // 5. Determine Provider Currency (USD vs NGN)
    let providerCurrency = (process.env.NIGERIASMM_CURRENCY || "").toUpperCase();
    if (!providerCurrency) {
      try {
        const balanceData = await this.nigeriaSmmService.getBalance();
        if (balanceData?.currency) {
          providerCurrency = balanceData.currency.toUpperCase();
        }
      } catch (balErr: any) {
        logger.warn("Nigeria SMM sync: Failed to fetch balance currency, defaulting to NGN", {
          error: balErr.message,
        });
        providerCurrency = "NGN";
      }
    }
    if (!providerCurrency) providerCurrency = "NGN";

    let usdToNgnRate = 1;
    if (providerCurrency === "USD") {
      const rawRate = provider.usdNgnRate ?? provider.usd_ngn_rate;
      if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
        throw new AppError(
          `Provider "${provider.name}" (${provider.code}) does not have usd_ngn_rate configured in Provider model. Please set usd_ngn_rate via the admin provider update endpoint before syncing.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      usdToNgnRate = Number(rawRate);
      logger.info(`Nigeria SMM sync: Provider currency is USD. USD→NGN rate = ${usdToNgnRate}, markup = ${markupPercent * 100}%`);
    } else {
      logger.info(`Nigeria SMM sync: Provider currency is ${providerCurrency}. Native rates used (no FX conversion required), markup = ${markupPercent * 100}%`);
    }

    // 6. Ensure Platform Services (Instagram, Facebook, Threads, etc.) exist
    const platformServiceMap = new Map<string, any>(); // code -> Service doc

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
        logger.info(`Nigeria SMM sync: created platform Service "${p.name}" (${p.code})`);
      } else if (!service.logo || service.logo.includes(".svg")) {
        service.logo = p.logo;
        await service.save();
      }

      platformServiceMap.set(p.code, service);
    }

    // 7. Upsert Products
    for (const item of filtered) {
      try {
        const platformCode = resolveSmmPlatformCode(item.category, item.name);
        const service = platformServiceMap.get(platformCode) || platformServiceMap.get("smm-instagram");
        if (!service) continue;

        const productType = resolveSmmProductType(item.category, item.name);

        const isSupportedType =
          !item.type ||
          this.SUPPORTED_SMM_TYPES.some(
            (t) => t.toLowerCase() === (item.type || "").toLowerCase(),
          );

        // amount = NGN cost per 1,000 units (including markup)
        const ratePer1k = item.rate || item.rateUsd || 0;
        const baseNgnPer1k = providerCurrency === "USD" ? ratePer1k * usdToNgnRate : ratePer1k;
        const amountPer1k = Math.ceil(baseNgnPer1k * (1 + markupPercent));

        const productCode = String(item.id);

        const existing = await Product.findOne({
          code: productCode,
          providerId: new Types.ObjectId(providerId),
          serviceId: service._id,
        });

        const productData = {
          name: item.name,
          code: productCode,
          legacyProductId: productCode,
          serviceId: service._id,
          providerId: new Types.ObjectId(providerId),
          amount: amountPer1k,
          providerAmount: Math.ceil(baseNgnPer1k),
          productType,
          isActive: isSupportedType,
          attributes: {
            type: item.type,
            productType,
            platform: platformCode,
            originalCategory: item.category,
            rate: ratePer1k,
            rateUsd: item.rateUsd,
            providerCurrency,
            min: item.min,
            max: item.max,
          },
        };

        if (existing) {
          await Product.findByIdAndUpdate(existing._id, productData);
          updated++;
        } else {
          await Product.create(productData);
          created++;
        }
      } catch (err: any) {
        logger.error(`Nigeria SMM sync: failed to upsert product ${item.id}`, {
          error: err.message,
          item,
        });
        failed++;
      }
    }

    logger.info("Nigeria SMM sync complete", { created, updated, failed, total: filtered.length });
    return { created, updated, total: filtered.length, failed };
  }

  // -------------------------------------------------------------------------
  // OWLET SMM SYNC
  // Rates are natively NGN — no USD conversion required.
  // Preserves SABI engagement fields (mode, proof, targetable) in attributes.
  // -------------------------------------------------------------------------
  async syncOwletSmmProducts(providerId: string): Promise<{
    created: number;
    updated: number;
    total: number;
    failed: number;
  }> {
    let created = 0;
    let updated = 0;
    let failed = 0;

    // 1. Find the smm ServiceType
    const serviceType = await ServiceType.findOne({ code: "smm" });
    if (!serviceType) {
      throw new AppError(
        "SMM ServiceType not found — run seed script first",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    // 2. Fetch all services from Owlet SMM
    const allServices = await this.owletService.getServices();
    logger.info(`Owlet SMM: fetched ${allServices.length} services from API`);

    // 3. Filter to starter categories
    const filtered = allServices.filter((s) =>
      s.category &&
      this.SMM_STARTER_CATEGORIES.some(
        (cat) => s.category.toLowerCase().includes(cat.toLowerCase()),
      ),
    );
    logger.info(
      `Owlet SMM: ${filtered.length} services in starter categories`,
      { categories: this.SMM_STARTER_CATEGORIES },
    );

    // 4. Markup percentage from Provider model — fail loudly if not set
    const provider = await Provider.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    const rawMarkup = provider.markupPercent ?? provider.markup_percent;
    if (rawMarkup === undefined || rawMarkup === null || isNaN(Number(rawMarkup)) || Number(rawMarkup) < 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have markup_percent configured in Provider model. Please set markup_percent via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const markupPercent = Number(rawMarkup) / 100;

    // 5. Ensure Platform Services exist
    const platformServiceMap = new Map<string, any>();

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
        logger.info(`Owlet SMM sync: created platform Service "${p.name}" (${p.code})`);
      } else if (!service.logo || service.logo.includes(".svg")) {
        service.logo = p.logo;
        await service.save();
      }

      platformServiceMap.set(p.code, service);
    }

    // 6. Upsert Products
    for (const item of filtered) {
      try {
        const platformCode = resolveSmmPlatformCode(item.category, item.name);
        const service = platformServiceMap.get(platformCode) || platformServiceMap.get("smm-instagram");
        if (!service) continue;

        const productType = resolveSmmProductType(item.category, item.name);
        const isSupportedType =
          !item.type ||
          this.SUPPORTED_SMM_TYPES.some(
            (t) => t.toLowerCase() === (item.type || "").toLowerCase(),
          );

        // amount = NGN cost per 1,000 units (Owlet rates are natively NGN)
        const ratePer1k = item.rate || item.rateNgn || 0;
        const providerAmount = Math.ceil(ratePer1k);
        const amountPer1k = Math.ceil(providerAmount * (1 + markupPercent));

        const productCode = `owlet_${item.id}`;

        const existing = await Product.findOne({
          code: productCode,
          providerId: new Types.ObjectId(providerId),
          serviceId: service._id,
        });

        const productData = {
          name: item.name,
          code: productCode,
          legacyProductId: productCode,
          serviceId: service._id,
          providerId: new Types.ObjectId(providerId),
          amount: amountPer1k,
          providerAmount,
          productType,
          isActive: isSupportedType,
          attributes: {
            type: item.type,
            productType,
            platform: platformCode,
            originalCategory: item.category,
            rate: ratePer1k,
            providerCurrency: "NGN",
            min: item.min,
            max: item.max,
            mode: item.mode,
            proof: item.proof,
            targetable: item.targetable,
          },
        };

        if (existing) {
          await Product.findByIdAndUpdate(existing._id, productData);
          updated++;
        } else {
          await Product.create(productData);
          created++;
        }
      } catch (err: any) {
        logger.error(`Owlet SMM sync: failed to upsert product ${item.id}`, {
          error: err.message,
          item,
        });
        failed++;
      }
    }

    logger.info("Owlet SMM sync complete", { created, updated, failed, total: filtered.length });
    return { created, updated, total: filtered.length, failed };
  }

  // -------------------------------------------------------------------------
  // SMMFOLLOWS SYNC
  // Rates are in USD — converted to NGN via SMMFOLLOWS_USD_NGN_RATE.
  // -------------------------------------------------------------------------
  async syncSmmFollowsProducts(providerId: string): Promise<{
    created: number;
    updated: number;
    total: number;
    failed: number;
  }> {
    let created = 0;
    let updated = 0;
    let failed = 0;

    // 1. Find the smm ServiceType
    const serviceType = await ServiceType.findOne({ code: "smm" });
    if (!serviceType) {
      throw new AppError(
        "SMM ServiceType not found — run seed script first",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    // 2. Fetch all services from SMMFollows
    const allServices = await this.smmFollowsService.getServices();
    logger.info(`SMMFollows: fetched ${allServices.length} services from API`);

    // 3. Filter to starter categories
    const filtered = allServices.filter((s) =>
      s.category &&
      this.SMM_STARTER_CATEGORIES.some(
        (cat) => s.category.toLowerCase().includes(cat.toLowerCase()),
      ),
    );
    logger.info(
      `SMMFollows: ${filtered.length} services in starter categories`,
      { categories: this.SMM_STARTER_CATEGORIES },
    );

    // 4. Markup percentage from Provider model — fail loudly if not set
    const provider = await Provider.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    const rawMarkup = provider.markupPercent ?? provider.markup_percent;
    if (rawMarkup === undefined || rawMarkup === null || isNaN(Number(rawMarkup)) || Number(rawMarkup) < 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have markup_percent configured in Provider model. Please set markup_percent via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const markupPercent = Number(rawMarkup) / 100;

    // 5. USD to NGN Rate from Provider model — fail loudly if not set (no env, no fallback)
    const rawRate = provider.usdNgnRate ?? provider.usd_ngn_rate;
    if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have usd_ngn_rate configured in Provider model. Please set usd_ngn_rate via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const usdToNgnRate = Number(rawRate);
    logger.info(`SMMFollows sync: USD→NGN rate = ${usdToNgnRate}, markup = ${markupPercent * 100}%`);

    // 6. Ensure Platform Services exist
    const platformServiceMap = new Map<string, any>();

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
        logger.info(`SMMFollows sync: created platform Service "${p.name}" (${p.code})`);
      } else if (!service.logo || service.logo.includes(".svg")) {
        service.logo = p.logo;
        await service.save();
      }

      platformServiceMap.set(p.code, service);
    }

    // 7. Upsert Products
    for (const item of filtered) {
      try {
        const platformCode = resolveSmmPlatformCode(item.category, item.name);
        const service = platformServiceMap.get(platformCode) || platformServiceMap.get("smm-instagram");
        if (!service) continue;

        const productType = resolveSmmProductType(item.category, item.name);
        const isSupportedType =
          !item.type ||
          this.SUPPORTED_SMM_TYPES.some(
            (t) => t.toLowerCase() === (item.type || "").toLowerCase(),
          );

        // amount = NGN cost per 1,000 units (converted from USD rate)
        const ratePer1k = item.rate || item.rateUsd || 0;
        const baseNgnPer1k = ratePer1k * usdToNgnRate;
        const amountPer1k = Math.ceil(baseNgnPer1k * (1 + markupPercent));

        const productCode = `smmfollows_${item.id}`;

        const existing = await Product.findOne({
          code: productCode,
          providerId: new Types.ObjectId(providerId),
          serviceId: service._id,
        });

        const productData = {
          name: item.name,
          code: productCode,
          legacyProductId: String(item.id),
          serviceId: service._id,
          providerId: new Types.ObjectId(providerId),
          amount: amountPer1k,
          providerAmount: Math.ceil(baseNgnPer1k),
          productType,
          isActive: isSupportedType,
          attributes: {
            type: item.type,
            productType,
            platform: platformCode,
            originalCategory: item.category,
            rate: ratePer1k,
            rateUsd: ratePer1k,
            providerCurrency: "USD",
            min: item.min,
            max: item.max,
            refill: item.refill,
            cancel: item.cancel,
          },
        };

        if (existing) {
          await Product.findByIdAndUpdate(existing._id, productData);
          updated++;
        } else {
          await Product.create(productData);
          created++;
        }
      } catch (err: any) {
        logger.error(`SMMFollows sync: failed to upsert product ${item.id}`, {
          error: err.message,
          item,
        });
        failed++;
      }
    }

    logger.info("SMMFollows sync complete", { created, updated, failed, total: filtered.length });
    return { created, updated, total: filtered.length, failed };
  }

  // -------------------------------------------------------------------------
  // SMMRESELLERPANEL SYNC
  // Rates are in USD — converted to NGN via SMMRESELLERPANEL_USD_NGN_RATE.
  // -------------------------------------------------------------------------
  async syncSmmResellerPanelProducts(providerId: string): Promise<{
    created: number;
    updated: number;
    total: number;
    failed: number;
  }> {
    let created = 0;
    let updated = 0;
    let failed = 0;

    // 1. Find the smm ServiceType
    const serviceType = await ServiceType.findOne({ code: "smm" });
    if (!serviceType) {
      throw new AppError(
        "SMM ServiceType not found — run seed script first",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    // 2. Fetch all services from SMMResellerPanel
    const allServices = await this.smmResellerPanelService.getServices();
    logger.info(`SMMResellerPanel: fetched ${allServices.length} services from API`);

    // 3. Filter to starter categories
    const filtered = allServices.filter((s) =>
      s.category &&
      this.SMM_STARTER_CATEGORIES.some(
        (cat) => s.category.toLowerCase().includes(cat.toLowerCase()),
      ),
    );
    logger.info(
      `SMMResellerPanel: ${filtered.length} services in starter categories`,
      { categories: this.SMM_STARTER_CATEGORIES },
    );

    // 4. Markup percentage from Provider model — fail loudly if not set
    const provider = await Provider.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    const rawMarkup = provider.markupPercent ?? provider.markup_percent;
    if (rawMarkup === undefined || rawMarkup === null || isNaN(Number(rawMarkup)) || Number(rawMarkup) < 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have markup_percent configured in Provider model. Please set markup_percent via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const markupPercent = Number(rawMarkup) / 100;

    // 5. USD to NGN Rate from Provider model — fail loudly if not set (no env, no fallback)
    const rawRate = provider.usdNgnRate ?? provider.usd_ngn_rate;
    if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
      throw new AppError(
        `Provider "${provider.name}" (${provider.code}) does not have usd_ngn_rate configured in Provider model. Please set usd_ngn_rate via the admin provider update endpoint before syncing.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const usdToNgnRate = Number(rawRate);
    logger.info(`SMMResellerPanel sync: USD→NGN rate = ${usdToNgnRate}, markup = ${markupPercent * 100}%`);

    // 6. Ensure Platform Services exist
    const platformServiceMap = new Map<string, any>();

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
        logger.info(`SMMResellerPanel sync: created platform Service "${p.name}" (${p.code})`);
      } else if (!service.logo || service.logo.includes(".svg")) {
        service.logo = p.logo;
        await service.save();
      }

      platformServiceMap.set(p.code, service);
    }

    // 7. Upsert Products
    for (const item of filtered) {
      try {
        const platformCode = resolveSmmPlatformCode(item.category, item.name);
        const service = platformServiceMap.get(platformCode) || platformServiceMap.get("smm-instagram");
        if (!service) continue;

        const productType = resolveSmmProductType(item.category, item.name);
        const isSupportedType =
          !item.type ||
          this.SUPPORTED_SMM_TYPES.some(
            (t) => t.toLowerCase() === (item.type || "").toLowerCase(),
          );

        // amount = NGN cost per 1,000 units (converted from USD rate)
        const ratePer1k = item.rate || item.rateUsd || 0;
        const baseNgnPer1k = ratePer1k * usdToNgnRate;
        const amountPer1k = Math.ceil(baseNgnPer1k * (1 + markupPercent));

        const productCode = `smmresellerpanel_${item.id}`;

        const existing = await Product.findOne({
          code: productCode,
          providerId: new Types.ObjectId(providerId),
          serviceId: service._id,
        });

        const productData = {
          name: item.name,
          code: productCode,
          legacyProductId: String(item.id),
          serviceId: service._id,
          providerId: new Types.ObjectId(providerId),
          amount: amountPer1k,
          providerAmount: Math.ceil(baseNgnPer1k),
          productType,
          isActive: isSupportedType,
          attributes: {
            type: item.type,
            productType,
            platform: platformCode,
            originalCategory: item.category,
            rate: ratePer1k,
            rateUsd: ratePer1k,
            providerCurrency: "USD",
            min: item.min,
            max: item.max,
            refill: item.refill,
            cancel: item.cancel,
          },
        };

        if (existing) {
          await Product.findByIdAndUpdate(existing._id, productData);
          updated++;
        } else {
          await Product.create(productData);
          created++;
        }
      } catch (err: any) {
        logger.error(`SMMResellerPanel sync: failed to upsert product ${item.id}`, {
          error: err.message,
          item,
        });
        failed++;
      }
    }

    logger.info("SMMResellerPanel sync complete", { created, updated, failed, total: filtered.length });
    return { created, updated, total: filtered.length, failed };
  }
}