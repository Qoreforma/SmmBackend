import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import { ServiceType } from "@/models/reference/ServiceType";
import { Service } from "@/models/reference/Service";
import { Product } from "@/models/reference/Product";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  CACHE_KEYS,
  CACHE_TTL,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import { Types } from "mongoose";
import { ProductSyncService } from "../../sync/ProductSyncService";
import { CacheService } from "@/services/core/CacheService";
import logger from "@/logger";

interface ProductTypeAggregation {
  name: string;
  type: string;
  productType: string;
  status: "active" | "inactive";
  productCount: number;
  activeProductCount: number;
  serviceId: string;
  serviceName: string;
  serviceTypeCode: string;
}

export class ProviderManagementService {
  constructor(
    private providerRepository: ProviderRepository,
    private productRepository: ProductRepository,
    private serviceTypeRepository: ServiceTypeRepository,
    private syncService: ProductSyncService,
    private cacheService: CacheService,
  ) {}

  // PROVIDER MANAGEMENT METHODS

  async listProviders(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
    includeProductCounts: boolean = false,
  ) {
    const query: any = {};

    if (filters.status) {
      query.isActive = filters.status === "true";
    }

    if (filters.search) {
      query.name = { $regex: filters.search, $options: "i" };
    }

    const result = await this.providerRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      [{ path: "serviceType", select: "name code description" }],
    );

    let providersWithCounts = result.data;

    if (includeProductCounts) {
      providersWithCounts = await Promise.all(
        result.data.map(async (provider) => {
          const productCounts = await this.getProviderProductCounts(
            provider.id.toString(),
          );

          const serviceTypesWithStatus =
            await this.getServiceTypesWithActiveStatus(
              provider.id.toString(),
              provider.serviceType,
            );

          return {
            ...provider.toObject(),
            serviceType: serviceTypesWithStatus,
            supportsDataService: serviceTypesWithStatus.some(
              (st: any) => st.code === "data",
            ),
            productCounts,
          };
        }),
      );
    } else {
      providersWithCounts = await Promise.all(
        result.data.map(async (provider) => {
          const serviceTypesWithStatus =
            await this.getServiceTypesWithActiveStatus(
              provider.id.toString(),
              provider.serviceType,
            );

          return {
            ...provider.toObject(),
            serviceType: serviceTypesWithStatus,
            supportsDataService: serviceTypesWithStatus.some(
              (st: any) => st.code === "data",
            ),
          };
        }),
      );
    }

    return {
      providers: providersWithCounts,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async createProvider(
    name: string,
    code: string,
    logo: string,
    isActive: boolean,
    serviceType: Types.ObjectId[],
    hasSync: boolean = false,
    rates?: {
      usdNgnRate?: number | null;
      markupPercent?: number | null;
    },
  ) {
    const providerData: any = {
      name,
      code,
      logo,
      isActive,
      serviceType,
      hasSync,
    };

    if (rates?.usdNgnRate !== undefined) {
      providerData.usdNgnRate = rates.usdNgnRate;
      providerData.usd_ngn_rate = rates.usdNgnRate;
    }
    if (rates?.markupPercent !== undefined) {
      providerData.markupPercent = rates.markupPercent;
      providerData.markup_percent = rates.markupPercent;
    }

    const provider = await this.providerRepository.create(providerData);

    // Invalidate cache for newly associated service types
    await this.invalidateCacheForServiceTypes(serviceType);

    return { message: "Provider created successfully", provider };
  }

  async getProviderDetails(
    providerId: string,
    includeProductCounts: boolean = false,
  ) {
    const provider = await this.providerRepository.findById(providerId, {
      path: "serviceType",
      select: "name code description",
    });

    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const serviceTypesWithStatus = await this.getServiceTypesWithActiveStatus(
      providerId,
      provider.serviceType,
    );

    const providerObj = {
      ...provider.toObject(),
      serviceType: serviceTypesWithStatus,
    };

    if (includeProductCounts) {
      const productCounts = await this.getProviderProductCounts(providerId);
      return {
        ...providerObj,
        productCounts,
      };
    }

    return providerObj;
  }

  async updateProvider(
    providerId: string,
    name: string,
    logo: string,
    isActive: boolean,
    serviceTypes: Types.ObjectId[],
    hasSync?: boolean,
    rates?: {
      usdNgnRate?: number | null;
      markupPercent?: number | null;
    },
  ) {
    const provider = await this.providerRepository.findById(providerId);

    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    // Store old service types to invalidate their cache
    const oldServiceTypeIds = provider.serviceType;

    const updateData: any = {
      name,
      logo,
      isActive,
    };

    if (hasSync !== undefined) {
      updateData.hasSync = hasSync;
    }
    if (serviceTypes !== undefined) {
      updateData.serviceType = serviceTypes;
    }
    if (rates?.usdNgnRate !== undefined) {
      updateData.usdNgnRate = rates.usdNgnRate;
      updateData.usd_ngn_rate = rates.usdNgnRate;
    }
    if (rates?.markupPercent !== undefined) {
      updateData.markupPercent = rates.markupPercent;
      updateData.markup_percent = rates.markupPercent;
    }
    // Update the provider
    const updatedProvider = await this.providerRepository.update(
      providerId,
      updateData,
    );

    if (!updatedProvider) {
      throw new AppError("Failed to update provider", HTTP_STATUS.BAD_REQUEST);
    }

    // Invalidate cache for BOTH old and new service types
    let allServiceTypeIds: Types.ObjectId[] = [];

    if (serviceTypes !== undefined) {
      const safeOld = Array.isArray(oldServiceTypeIds) ? oldServiceTypeIds : [];

      allServiceTypeIds = [
        ...new Set([
          ...safeOld.map((id) => id.toString()),
          ...serviceTypes.map((id) => id.toString()),
        ]),
      ].map((id) => new Types.ObjectId(id));

      await this.invalidateCacheForServiceTypes(allServiceTypeIds);
    }

    const populatedProvider = await this.providerRepository.findById(
      providerId,
      {
        path: "serviceType",
        select: "name code description",
      },
    );

    return {
      message: "Provider updated successfully",
      provider: populatedProvider,
    };
  }

  async updateProviderStatus(providerId: string, isActive: boolean) {
    const provider = await this.providerRepository.findById(providerId);

    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const updatedProvider = await this.providerRepository.update(providerId, {
      isActive,
    });

    if (!updatedProvider) {
      throw new AppError(
        "Failed to update provider status",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const MULTI_PROVIDER_SERVICE_TYPES = [
      TRANSACTION_TYPES.WITHDRAWAL,
      TRANSACTION_TYPES.DEPOSIT,
      TRANSACTION_TYPES.SMM,
      TRANSACTION_TYPES.VIRTUAL_ACCOUNT,
    ];

    if (!isActive) {
      // Provider is being turned OFF - deactivate all its service types
      const activeServiceTypes = await ServiceTypeProvider.find({
        providerId: new Types.ObjectId(providerId),
        isActive: true,
      });

      const affectedServiceTypeCodes: string[] = [];

      for (const serviceTypeProvider of activeServiceTypes) {
        await ServiceTypeProvider.findByIdAndUpdate(serviceTypeProvider._id, {
          isActive: false,
        });
        const serviceType = await ServiceType.findById(
          serviceTypeProvider.serviceTypeId,
        );
        if (!serviceType) continue;
        affectedServiceTypeCodes.push(serviceType.code);
      }

      const uniqueCodes = [...new Set(affectedServiceTypeCodes)];
      await Promise.all(
        uniqueCodes.map((code) =>
          this.invalidateProviderRelatedCaches(code).catch((err) =>
            logger.error(
              `Cache invalidation failed for service type ${code}:`,
              err,
            ),
          ),
        ),
      );
    } else {
      // Provider is being turned ON - intelligently reactivate service types
      const providerServiceTypes = await ServiceType.find({
        _id: { $in: provider.serviceType },
      });

      const affectedServiceTypeCodes: string[] = [];

      for (const serviceType of providerServiceTypes) {
        const allowsMultipleProviders = MULTI_PROVIDER_SERVICE_TYPES.includes(
          serviceType.code as (typeof MULTI_PROVIDER_SERVICE_TYPES)[number],
        );

        // Check if another provider has this service type active
        const otherActiveProvider = await ServiceTypeProvider.findOne({
          serviceTypeId: new Types.ObjectId(serviceType._id),
          providerId: { $ne: new Types.ObjectId(providerId) },
          isActive: true,
        });

        const shouldActivate =
          allowsMultipleProviders || // Always activate for multi-provider types
          !otherActiveProvider; // Only activate for single-provider types if no one else has it active

        if (shouldActivate) {
          // Find or create the relationship and activate it
          let relationship = await ServiceTypeProvider.findOne({
            serviceTypeId: new Types.ObjectId(serviceType._id),
            providerId: new Types.ObjectId(providerId),
          });

          if (relationship) {
            relationship.isActive = true;
            await relationship.save();
          } else {
            await ServiceTypeProvider.create({
              serviceTypeId: new Types.ObjectId(serviceType._id),
              providerId: new Types.ObjectId(providerId),
              isActive: true,
            });
          }

          affectedServiceTypeCodes.push(serviceType.code);
        }
      }

      const uniqueCodes = [...new Set(affectedServiceTypeCodes)];
      await Promise.all(
        uniqueCodes.map((code) =>
          this.invalidateProviderRelatedCaches(code).catch((err) =>
            logger.error(
              `Cache invalidation failed for service type ${code}:`,
              err,
            ),
          ),
        ),
      );
    }

    // cahce invalidation.
    await this.invalidateCacheForServiceTypes(provider.serviceType);

    return {
      message: "Provider status updated successfully",
      isActive: updatedProvider.isActive,
    };
  }

  async getProviderProducts(
    providerId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const result = await this.productRepository.findWithPagination(
      { providerId },
      page,
      limit,
    );

    return {
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async toggleProviderServiceType(
    providerId: string,
    serviceTypeId: string,
    isActive: boolean,
  ) {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const serviceType =
      await this.serviceTypeRepository.findById(serviceTypeId);
    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    const supportsServiceType = provider.serviceType.some(
      (st) => st.toString() === serviceTypeId,
    );

    if (!supportsServiceType) {
      throw new AppError(
        "Provider does not support this service type",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existingRelationship = await ServiceTypeProvider.findOne({
      serviceTypeId: new Types.ObjectId(serviceTypeId),
      providerId: new Types.ObjectId(providerId),
    });

    const MULTI_PROVIDER_SERVICE_TYPES = [
      TRANSACTION_TYPES.WITHDRAWAL,
      TRANSACTION_TYPES.DEPOSIT,
      TRANSACTION_TYPES.SMM,
      TRANSACTION_TYPES.VIRTUAL_ACCOUNT,
    ];

    // Check if this service type allows multiple active providers
    const allowsMultipleProviders = MULTI_PROVIDER_SERVICE_TYPES.includes(
      serviceType.code as (typeof MULTI_PROVIDER_SERVICE_TYPES)[number],
    );

    if (isActive) {
      // Only enforce single active provider for non-multi-provider service types
      if (!allowsMultipleProviders) {
        const activeProvider = await ServiceTypeProvider.findOne({
          serviceTypeId: new Types.ObjectId(serviceTypeId),
          isActive: true,
          providerId: { $ne: new Types.ObjectId(providerId) },
        }).populate<{ providerId: { name: string; code: string } }>(
          "providerId",
          "name code",
        );

        if (activeProvider) {
          throw new AppError(
            `Cannot activate provider for this service type. Provider "${activeProvider.providerId.name}" (${activeProvider.providerId.code}) is already active. Please deactivate it first.`,
            HTTP_STATUS.BAD_REQUEST,
          );
        }
      }

      if (existingRelationship) {
        existingRelationship.isActive = true;
        await existingRelationship.save();

        this.invalidateProviderRelatedCaches(serviceType.code).catch((err) => {
          logger.error(
            `Cache invalidation failed for service type ${serviceType.code}:`,
            err,
          );
        });

        return {
          message: "Provider service type relationship activated successfully",
          relationship: existingRelationship,
        };
      } else {
        const newRelationship = await ServiceTypeProvider.create({
          serviceTypeId: new Types.ObjectId(serviceTypeId),
          providerId: new Types.ObjectId(providerId),
          isActive: true,
        });

        this.invalidateProviderRelatedCaches(serviceType.code).catch((err) => {
          logger.error(
            `Cache invalidation failed for service type ${serviceType.code}:`,
            err,
          );
        });

        return {
          message:
            "Provider service type relationship created and activated successfully",
          relationship: newRelationship,
        };
      }
    } else {
      if (!existingRelationship) {
        const newRelationship = await ServiceTypeProvider.create({
          serviceTypeId: new Types.ObjectId(serviceTypeId),
          providerId: new Types.ObjectId(providerId),
          isActive: false,
        });

        this.invalidateProviderRelatedCaches(serviceType.code).catch((err) => {
          logger.error(
            `Cache invalidation failed for service type ${serviceType.code}:`,
            err,
          );
        });

        return {
          message: "Provider service type relationship created as inactive",
          relationship: newRelationship,
        };
      }

      existingRelationship.isActive = false;
      await existingRelationship.save();

      this.invalidateProviderRelatedCaches(serviceType.code).catch((err) => {
        logger.error(
          `Cache invalidation failed for service type ${serviceType.code}:`,
          err,
        );
      });

      return {
        message: "Provider service type relationship deactivated successfully",
        relationship: existingRelationship,
      };
    }
  }

  private async invalidateProviderRelatedCaches(
    serviceTypeCode: string,
  ): Promise<void> {
    try {
      const cachesToDelete = [
        `provider:active:${serviceTypeCode}`,
        `services:type:${serviceTypeCode}`,
        `products:type:${serviceTypeCode}`,
        CACHE_KEYS.SERVICE_BY_CODE(serviceTypeCode), // service:code:${code} — used in checkServiceAvailability
        CACHE_KEYS.SERVICE_BY_STATUS(serviceTypeCode), // service:status:${code} — used in checkServiceTypeStatus
        CACHE_KEYS.PROVIDERS_BY_TYPE(serviceTypeCode), // providers:type:${code} — was missing entirely
        CACHE_KEYS.ACTIVE_PROVIDERS_BY_SERVICE_TYPE(serviceTypeCode),
        CACHE_KEYS.PROVIDERS, // providers:all — stale provider list
        CACHE_KEYS.SERVICES, // services:all — stale service list
        CACHE_KEYS.PRODUCTS, // products:all — stale product list
        CACHE_KEYS.DATA_TYPES, // products:data_types — if data service changed
      ];

      await Promise.all([
        this.cacheService.deletePattern(`products:service:*`),
        this.cacheService.deletePattern(`products:data:all-active:*`),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
        this.cacheService.deletePattern(
          `services:type:${serviceTypeCode}:provider:*`,
        ), // SERVICES_BY_TYPE_PROVIDER pattern
        this.cacheService.delete(CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS),
        ...cachesToDelete.map((key) => this.cacheService.delete(key)),
      ]);
    } catch (error) {
      logger.error(
        `Error invalidating caches for service type ${serviceTypeCode}:`,
        error,
      );
    }
  }

  // Invalidates all cache keys related to provider-service type mappings
  // Clears: provider:active:{serviceTypeCode} and services:type:{serviceTypeCode}
  private async invalidateCacheForServiceTypes(
    serviceTypeIds: Types.ObjectId[],
  ): Promise<void> {
    if (!serviceTypeIds || serviceTypeIds.length === 0) {
      logger.debug("No service types to invalidate cache for");
      return;
    }

    try {
      // Get service type codes for the cache keys
      const serviceTypes = await this.serviceTypeRepository.find({
        _id: { $in: serviceTypeIds },
      });

      const cacheKeys: string[] = [];

      serviceTypes.forEach((st) => {
        cacheKeys.push(CACHE_KEYS.PROVIDER_ACTIVE(st.code));
        cacheKeys.push(CACHE_KEYS.PROVIDERS_BY_TYPE(st.code));
        cacheKeys.push(CACHE_KEYS.SERVICES_BY_TYPE(st.code));
      });

      // Delete all cache keys
      await Promise.all(cacheKeys.map((key) => this.cacheService.delete(key)));

      logger.info(`Cache invalidated for ${cacheKeys.length} keys`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.error("Error invalidating cache for service types", error);
      // Don't throw - cache invalidation shouldn't break the request
    }
  }

  // Invalidates cache for a specific service type by code
  private async invalidateCacheByServiceTypeCode(code: string): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PROVIDER_ACTIVE(code),
        CACHE_KEYS.SERVICES_BY_TYPE(code),
      ];

      await Promise.all(cacheKeys.map((key) => this.cacheService.delete(key)));

      logger.info(`Cache invalidated for service type: ${code}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.error(`Error invalidating cache for service type ${code}`, error);
    }
  }

  async getProviderServiceTypes(providerId: string) {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const relationships = await ServiceTypeProvider.find({
      providerId: new Types.ObjectId(providerId),
    }).populate<{
      serviceTypeId: {
        _id: Types.ObjectId;
        name: string;
        code: string;
        status: string;
      };
    }>("serviceTypeId", "name code description icon status");

    return {
      provider: {
        id: provider._id,
        name: provider.name,
        code: provider.code,
      },
      serviceTypes: relationships.map((rel) => ({
        serviceTypeId: rel.serviceTypeId._id,
        name: rel.serviceTypeId.name,
        code: rel.serviceTypeId.code,
        status: rel.serviceTypeId.status,
        isActive: rel.isActive,
        priority: rel.priority,
      })),
    };
  }

  async syncProviderProducts(
    providerId: string,
    options?: {
      serviceTypeId?: string;
      forceUpdate?: boolean;
    },
  ) {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    // Perform the sync
    const result = await this.syncService.syncProviderProducts(
      providerId,
      options,
    );

    // Invalidate cache for all service types this provider supports
    await this.invalidateCacheForServiceTypes(provider.serviceType);

    return result;
  }

  async deleteProviderProducts(providerId: string) {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    await Product.deleteMany({ providerId: new Types.ObjectId(providerId) });

    // Invalidate caches
    await this.invalidateCacheForServiceTypes(provider.serviceType);
    await this.cacheService.delete(CACHE_KEYS.PRODUCTS);
    await this.cacheService.deletePattern(`products:service:*`);

    return { message: "All products for provider deleted successfully" };
  }

  async getProviderProductAggregations(
    providerId: string,
  ): Promise<ProductTypeAggregation[]> {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const allowedServiceTypeCodes = ["data"];

    // Get all service types (for future use/extensibility)
    // const allServiceTypes = await ServiceType.find({
    //   deletedAt: null,
    //   status: "active",
    // }).sort({ displayOrder: 1 });

    const aggregations = await Service.aggregate([
      {
        $match: {
          supportedProviders: new Types.ObjectId(providerId),
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: "servicetypes",
          localField: "serviceTypeId",
          foreignField: "_id",
          as: "serviceType",
        },
      },
      {
        $unwind: "$serviceType",
      },
      {
        $match: {
          "serviceType.code": { $in: allowedServiceTypeCodes },
        },
      },
      {
        $lookup: {
          from: "products",
          let: { serviceId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$serviceId", "$$serviceId"] },
                    { $eq: ["$providerId", new Types.ObjectId(providerId)] },
                  ],
                },
              },
            },
          ],
          as: "products",
        },
      },
      {
        $facet: {
          withProducts: [
            { $match: { "products.0": { $exists: true } } },
            { $unwind: "$products" },
            {
              $group: {
                _id: {
                  serviceId: "$_id",
                  serviceName: "$name",
                  serviceLogo: "$logo",
                  serviceTypeCode: "$serviceType.code",
                  serviceTypeDisplayOrder: "$serviceType.displayOrder",
                  isActive: "$isActive",
                  productType: { $ifNull: ["$products.productType", "DIRECT"] },
                },
                productCount: { $sum: 1 },
                activeProductCount: {
                  $sum: {
                    $cond: [{ $eq: ["$products.isActive", true] }, 1, 0],
                  },
                },
              },
            },
          ],
          withoutProducts: [
            { $match: { "products.0": { $exists: false } } },
            {
              $project: {
                _id: {
                  serviceId: "$_id",
                  serviceName: "$name",
                  serviceLogo: "$logo",
                  serviceTypeCode: "$serviceType.code",
                  serviceTypeDisplayOrder: "$serviceType.displayOrder",
                  isActive: "$isActive",
                  productType: "DIRECT",
                },
                productCount: { $literal: 0 },
                activeProductCount: { $literal: 0 },
              },
            },
          ],
        },
      },
      {
        $project: {
          all: { $concatArrays: ["$withProducts", "$withoutProducts"] },
        },
      },
      { $unwind: "$all" },
      { $replaceRoot: { newRoot: "$all" } },
      {
        $sort: {
          "_id.serviceTypeCode": 1,
          "_id.serviceName": 1,
          "_id.productType": 1,
        },
      },
    ]);

    return aggregations.map((agg) => {
      const networkName = agg._id.serviceName.split(" ")[0];
      const hasProducts = agg.productCount > 0;
      const status = hasProducts
        ? agg.activeProductCount > 0
          ? "active"
          : "inactive"
        : agg._id.isActive
          ? "active"
          : "inactive";

      return {
        name: `${networkName} ${agg._id.productType}`,
        type: agg._id.serviceTypeCode,
        productType: agg._id.productType,
        status,
        productCount: agg.productCount,
        activeProductCount: agg.activeProductCount,
        serviceId: agg._id.serviceId.toString(),
        serviceName: agg._id.serviceName,
        serviceTypeCode: agg._id.serviceTypeCode,
        logo: agg._id.serviceLogo ?? null,
      };
    });
  }

  async getProductsByServiceAndType(
    providerId: string,
    serviceId: string,
    productType: string,
    page: number = 1,
    limit: number = 20,
    filters?: {
      isActive?: boolean;
      search?: string;
    },
  ) {
    const query: any = {
      providerId: new Types.ObjectId(providerId),
      serviceId: new Types.ObjectId(serviceId),
    };

    if (productType) {
      query.productType = productType;
    }

    if (filters?.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    if (filters?.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } },
      ];
    }

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { amount: 1 },
      [
        { path: "serviceId", select: "name code logo" },
        { path: "providerId", select: "name code" },
      ],
    );

    return {
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async toggleProductsByServiceAndType(
    providerId: string,
    serviceId: string,
    productType: string,
    isActive: boolean,
  ) {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found", HTTP_STATUS.NOT_FOUND);
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const result = await Product.updateMany(
      {
        providerId: new Types.ObjectId(providerId),
        serviceId: new Types.ObjectId(serviceId),
        productType: productType,
      },
      {
        $set: { isActive },
      },
    );

    // Note: No cache invalidation needed here because products aren't cached
    // at the service layer. Individual product changes don't affect the
    // provider:active or services:type cache keys.

    return {
      message: `Successfully ${isActive ? "activated" : "deactivated"} ${
        result.modifiedCount
      } products`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    };
  }

  private async getProviderProductCounts(providerId: string) {
    const totalCount = await Product.countDocuments({
      providerId: new Types.ObjectId(providerId),
    });

    const activeCount = await Product.countDocuments({
      providerId: new Types.ObjectId(providerId),
      isActive: true,
    });

    const byServiceType = await Product.aggregate([
      {
        $match: {
          providerId: new Types.ObjectId(providerId),
        },
      },
      {
        $lookup: {
          from: "services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
        },
      },
      {
        $unwind: "$service",
      },
      {
        $lookup: {
          from: "servicetypes",
          localField: "service.serviceTypeId",
          foreignField: "_id",
          as: "serviceType",
        },
      },
      {
        $unwind: "$serviceType",
      },
      {
        $group: {
          _id: {
            serviceTypeId: "$serviceType._id",
            serviceTypeName: "$serviceType.name",
          },
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          serviceTypeName: "$_id.serviceTypeName",
          total: 1,
          active: 1,
        },
      },
    ]);

    const byServiceTypeMap: {
      [key: string]: { total: number; active: number };
    } = {};

    byServiceType.forEach((item) => {
      byServiceTypeMap[item.serviceTypeName] = {
        total: item.total,
        active: item.active,
      };
    });

    return {
      total: totalCount,
      active: activeCount,
      inactive: totalCount - activeCount,
      byServiceType: byServiceTypeMap,
    };
  }

  private async getServiceTypesWithActiveStatus(
    providerId: string,
    serviceTypes: any[],
  ) {
    const activeRelationships = await ServiceTypeProvider.find({
      providerId: new Types.ObjectId(providerId),
      isActive: true,
    }).select("serviceTypeId");

    const activeServiceTypeIds = new Set(
      activeRelationships.map((rel) => rel.serviceTypeId.toString()),
    );

    return serviceTypes.map((st) => {
      const serviceTypeObj = st.toObject ? st.toObject() : st;
      return {
        ...serviceTypeObj,
        isActiveProvider: activeServiceTypeIds.has(
          serviceTypeObj._id.toString(),
        ),
      };
    });
  }
}
