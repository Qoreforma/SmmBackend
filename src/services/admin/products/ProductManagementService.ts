import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { AppError } from "@/middlewares/shared/errorHandler";
import { CACHE_KEYS, HTTP_STATUS, PRODUCT_ATTRIBUTES } from "@/utils/constants";
import { Types } from "mongoose";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { Product } from "@/models/reference/Product";

export class ProductManagementService {
  constructor(
    private productRepository: ProductRepository,
    private cacheService: CacheService,
  ) { }

  // Invalidates cache for a specific product

  private async invalidateProductCache(productId: string): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCT_BY_ID(productId),
        CACHE_KEYS.PRODUCT_WITH_SERVICE(productId),
      ];

      await Promise.all(cacheKeys.map((key) => this.cacheService.delete(key)));

      logger.debug(`Product cache invalidated for ID: ${productId}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.warn(`Error invalidating product cache for ${productId}:`, error);
      // Don't throw - cache invalidation shouldn't break the request
    }
  }

  // Invalidates all products related to a service

  private async invalidateProductsByServiceCache(
    serviceId: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS_BY_SERVICE(serviceId),
        // Include data type variant if applicable
        CACHE_KEYS.DATA_PRODUCTS_ALL_ACTIVE(serviceId),
      ];

      // Also invalidate pattern-based caches
      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        // Delete all data type variants for this service
        this.cacheService.deletePattern(`products:service:${serviceId}:*`),
        this.cacheService.deletePattern(
          `products:data:all-active:${serviceId}:*`,
        ),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug(`Products cache invalidated for service: ${serviceId}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for service ${serviceId}:`,
        error,
      );
    }
  }

  // Invalidates all products related to a service type

  private async invalidateProductsByServiceTypeCache(
    serviceTypeCode: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS_BY_TYPE(serviceTypeCode),
        CACHE_KEYS.DATA_TYPES,
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug(
        `Products cache invalidated for service type: ${serviceTypeCode}`,
        {
          keys: cacheKeys,
        },
      );
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for service type ${serviceTypeCode}:`,
        error,
      );
    }
  }

  // Invalidates all products related to a provider

  private async invalidateProductsByProviderCache(
    providerId: string,
  ): Promise<void> {
    try {
      // Invalidate all products associated with this provider using pattern matching
      await this.cacheService.deletePattern(
        `products:provider:${providerId}:*`,
      );

      logger.debug(`Products cache invalidated for provider: ${providerId}`);
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for provider ${providerId}:`,
        error,
      );
    }
  }

  // Invalidates general product lists and related data

  private async invalidateGeneralProductCaches(): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS,
        CACHE_KEYS.DATA_TYPES,
        CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS,
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug("General product caches invalidated");
    } catch (error) {
      logger.warn("Error invalidating general product caches:", error);
    }
  }

  // Comprehensive cache invalidation for product updates

  private async invalidateProductRelatedCaches(
    productId: string,
    serviceId: string,
    providerId: string,
    serviceTypeCode?: string,
  ): Promise<void> {
    try {
      await Promise.all([
        this.invalidateProductCache(productId),
        this.invalidateProductsByServiceCache(serviceId),
        this.invalidateProductsByProviderCache(providerId),
        ...(serviceTypeCode
          ? [this.invalidateProductsByServiceTypeCache(serviceTypeCode)]
          : []),
      ]);

      logger.info(
        `Comprehensive cache invalidation completed for product ${productId}`,
        {
          serviceId,
          providerId,
          serviceTypeCode,
        },
      );
    } catch (error) {
      logger.error("Error in comprehensive cache invalidation:", error);
    }
  }

  // Helper to parse data size string into MB
  private parseDataSizeInMB(text: string): { sizeInMB: number; displaySize: string } {
    if (!text) return { sizeInMB: 0, displaySize: "" };

    const mbpsMatch = text.match(/(\d+(?:\.\d+)?)\s*MBPS/i);
    if (mbpsMatch) {
      const mbps = parseFloat(mbpsMatch[1]);
      return { sizeInMB: mbps, displaySize: `${mbps}MBPS` };
    }

    const gbpsMatch = text.match(/(\d+(?:\.\d+)?)\s*GBPS/i);
    if (gbpsMatch) {
      const gbps = parseFloat(gbpsMatch[1]);
      return { sizeInMB: gbps * 1024, displaySize: `${gbps}GBPS` };
    }

    const kbpsMatch = text.match(/(\d+(?:\.\d+)?)\s*KBPS/i);
    if (kbpsMatch) {
      const kbps = parseFloat(kbpsMatch[1]);
      return { sizeInMB: Math.round((kbps / 1024) * 100) / 100, displaySize: `${kbps}KBPS` };
    }

    const tbMatch = text.match(/(\d+(?:\.\d+)?)\s*TB(?![A-Z])/i);
    if (tbMatch) {
      const tb = parseFloat(tbMatch[1]);
      return { sizeInMB: tb * 1024 * 1024, displaySize: `${tb}TB` };
    }

    const gbMatch = text.match(/(\d+(?:\.\d+)?)\s*GB(?![A-Z])/i);
    if (gbMatch) {
      const gb = parseFloat(gbMatch[1]);
      return { sizeInMB: gb * 1024, displaySize: `${gb}GB` };
    }

    const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*MB(?![A-Z])/i);
    if (mbMatch) {
      const mb = parseFloat(mbMatch[1]);
      return { sizeInMB: mb, displaySize: `${mb}MB` };
    }

    const kbMatch = text.match(/(\d+(?:\.\d+)?)\s*KB(?![A-Z])/i);
    if (kbMatch) {
      const kb = parseFloat(kbMatch[1]);
      return { sizeInMB: Math.round((kb / 1024) * 100) / 100, displaySize: `${kb}KB` };
    }

    return { sizeInMB: 0, displaySize: "" };
  }

  async getProductAttributes() {
    // Try fetching dataSizes from cache
    const cacheKey = "products:data_sizes";
    let dataSizes = await this.cacheService.get<string[]>(cacheKey);
    
    if (!dataSizes) {
      const distinctSizes = await Product.distinct("dataSizeDisplay", { dataSizeDisplay: { $ne: "" } });
      dataSizes = distinctSizes.filter(Boolean).sort((a, b) => {
         const parsedA = this.parseDataSizeInMB(a).sizeInMB;
         const parsedB = this.parseDataSizeInMB(b).sizeInMB;
         return parsedA - parsedB;
      });
      await this.cacheService.set(cacheKey, dataSizes, 3600); // 1 hour TTL
    }

    return {
      dataTypes: PRODUCT_ATTRIBUTES.DATA_TYPES,
      categories: PRODUCT_ATTRIBUTES.DATA_CATEGORIES,
      validityPeriods: [...PRODUCT_ATTRIBUTES.VALIDITY_PERIOD_NAMES, ...PRODUCT_ATTRIBUTES.VALIDITY_PERIOD_DAYS],
      meterTypes: PRODUCT_ATTRIBUTES.METER_TYPES,
      dataSizes,
    };
  }

  async listProducts(page: number = 1, limit: number = 100, filters: any = {}) {
    const query: any = {};

    // Status / isActive filter
    if (filters.status !== undefined && filters.status !== "" && filters.status !== "all") {
      query.isActive = filters.status === "true" || filters.status === true;
    } else if (filters.isActive !== undefined && filters.isActive !== "" && filters.isActive !== "all") {
      query.isActive = filters.isActive === "true" || filters.isActive === true;
    }

    // isHot filter
    if (filters.isHot !== undefined && filters.isHot !== "" && filters.isHot !== "all") {
      query.isHot = filters.isHot === "true" || filters.isHot === true;
    }

    // allowBelowCost filter
    if (filters.allowBelowCost !== undefined && filters.allowBelowCost !== "" && filters.allowBelowCost !== "all") {
      query.allowBelowCost = filters.allowBelowCost === "true" || filters.allowBelowCost === true;
    }

    // Service & ServiceType filter
    if (filters.serviceId) {
      query.serviceId = new Types.ObjectId(filters.serviceId);
    } else if (filters.serviceTypeId) {
      const services = await Service.find({
        serviceTypeId: new Types.ObjectId(filters.serviceTypeId),
      }).select("_id");
      const serviceIds = services.map((s) => s._id);
      query.serviceId = { $in: serviceIds };
    }

    // Provider filter (supports single ID, array of IDs, or comma-separated IDs)
    const providerFilter = filters.providerId || filters.providerIds || filters.providers;
    if (providerFilter) {
      const rawIds = (Array.isArray(providerFilter) ? providerFilter : String(providerFilter).split(","))
        .map((id: any) => String(id).trim())
        .filter((id: string) => Types.ObjectId.isValid(id))
        .map((id: string) => new Types.ObjectId(id));

      if (rawIds.length === 1) {
        query.providerId = rawIds[0];
      } else if (rawIds.length > 1) {
        query.providerId = { $in: rawIds };
      }
    }

    // Data Type filter
    if (filters.dataType) {
      query.$or = [
        { "attributes.dataType": { $regex: new RegExp(`^${filters.dataType}$`, "i") } },
        { productType: { $regex: new RegExp(`^${filters.dataType}$`, "i") } },
      ];
    }

    // Category filter
    if (filters.category) {
      const catRegex = new RegExp(`^${filters.category}$`, "i");
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: [{ category: catRegex }, { "attributes.category": catRegex }] },
        ];
        delete query.$or;
      } else {
        query.$or = [
          { category: catRegex },
          { "attributes.category": catRegex },
        ];
      }
    }

    // Validity / Duration filter
    if (filters.validity) {
      const validityTerms = [filters.validity];
      const normalizedValidity = filters.validity.toLowerCase().trim();
      
      // Add synonyms
      if (normalizedValidity.includes("7 days")) {
        validityTerms.push("1 week", "weekly");
      } else if (normalizedValidity.includes("1 week") || normalizedValidity.includes("weekly")) {
        validityTerms.push("7 days");
      } else if (normalizedValidity.includes("30 days")) {
        validityTerms.push("1 month", "monthly");
      } else if (normalizedValidity.includes("1 month") || normalizedValidity.includes("monthly")) {
        validityTerms.push("30 days");
      } else if (normalizedValidity.includes("24 hours") || normalizedValidity.includes("1 day") || normalizedValidity.includes("daily")) {
        validityTerms.push("24 hours", "1 day", "daily", "24hrs");
      } else if (normalizedValidity.includes("14 days")) {
        validityTerms.push("2 weeks", "bi-weekly", "biweekly");
      } else if (normalizedValidity.includes("2 weeks") || normalizedValidity.includes("bi-weekly") || normalizedValidity.includes("biweekly")) {
        validityTerms.push("14 days");
      } else if (normalizedValidity.includes("60 days")) {
        validityTerms.push("2 months", "bimonthly", "bi-monthly");
      } else if (normalizedValidity.includes("2 months") || normalizedValidity.includes("bimonthly") || normalizedValidity.includes("bi-monthly")) {
        validityTerms.push("60 days");
      } else if (normalizedValidity.includes("90 days")) {
        validityTerms.push("3 months", "quarterly");
      } else if (normalizedValidity.includes("3 months") || normalizedValidity.includes("quarterly")) {
        validityTerms.push("90 days");
      } else if (normalizedValidity.includes("365 days")) {
        validityTerms.push("1 year", "yearly", "annual", "annually");
      } else if (normalizedValidity.includes("1 year") || normalizedValidity.includes("yearly") || normalizedValidity.includes("annual") || normalizedValidity.includes("annually")) {
        validityTerms.push("365 days");
      }

      const validityCondition = [];
      for (const term of validityTerms) {
        // We use exact matches (case-insensitive) when possible to avoid matching "7 days" with "27 days" etc,
        // but $regex with word boundaries works well.
        validityCondition.push({ validity: { $regex: `^${term}$`, $options: "i" } });
        validityCondition.push({ "attributes.validityPeriod": { $regex: `^${term}$`, $options: "i" } });
      }

      // If user typed something like "7" that didn't hit our exact synonym matches, also include original regex
      validityCondition.push({ validity: { $regex: filters.validity, $options: "i" } });
      validityCondition.push({ "attributes.validityPeriod": { $regex: filters.validity, $options: "i" } });

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: validityCondition }];
        delete query.$or;
      } else {
        query.$or = validityCondition;
      }
    }

    // Data Size filter (exact size like 1GB, 500MB, 2GB, or numeric)
    if (filters.dataSize) {
      const trimmedSize = String(filters.dataSize).trim();
      const escapedSize = trimmedSize.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const parsed = this.parseDataSizeInMB(trimmedSize);

      // Exact match on dataSizeDisplay: e.g. "^1GB$"
      const exactDisplayRegex = new RegExp(`^\\s*${escapedSize}\\s*$`, "i");
      const sizeConditions: any[] = [
        { dataSizeDisplay: { $regex: exactDisplayRegex } },
      ];

      if (parsed.sizeInMB > 0) {
        sizeConditions.push({ dataSize: parsed.sizeInMB });
        // Handle common MB conversions (e.g., 500MB vs 512MB, 1000MB vs 1024MB)
        if (parsed.sizeInMB === 500) sizeConditions.push({ dataSize: 512 });
        if (parsed.sizeInMB === 512) sizeConditions.push({ dataSize: 500 });
        if (parsed.sizeInMB === 1000) sizeConditions.push({ dataSize: 1024 });
      }

      // If document doesn't have dataSize or dataSizeDisplay, match name safely:
      // Must NOT be preceded or followed by digits or decimal points (e.g. not 5.1GB or 11GB or 1GB2)
      sizeConditions.push({
        $and: [
          {
            $or: [
              { dataSize: null },
              { dataSize: { $exists: false } },
              { dataSize: 0 },
            ],
          },
          {
            $or: [
              { dataSizeDisplay: null },
              { dataSizeDisplay: { $exists: false } },
              { dataSizeDisplay: "" },
            ],
          },
          {
            name: {
              $regex: new RegExp(`(?:^|[^\\d.])${escapedSize}(?:$|[^\\d.a-zA-Z])`, "i"),
            },
          },
        ],
      });

      if (query.$or) {
        query.$and = query.$and || [];
        query.$and.push({ $or: query.$or }, { $or: sizeConditions });
        delete query.$or;
      } else if (query.$and) {
        query.$and.push({ $or: sizeConditions });
      } else {
        query.$or = sizeConditions;
      }
    }

    // Amount Range
    if (filters.minAmount !== undefined && filters.minAmount !== "") {
      query.amount = query.amount || {};
      query.amount.$gte = Number(filters.minAmount);
    }
    if (filters.maxAmount !== undefined && filters.maxAmount !== "") {
      query.amount = query.amount || {};
      query.amount.$lte = Number(filters.maxAmount);
    }

    // Search filter
    if (filters.search) {
      const searchRegex = { $regex: filters.search, $options: "i" };
      const searchCondition = [
        { name: searchRegex },
        { code: searchRegex },
        { description: searchRegex },
        { dataSizeDisplay: searchRegex },
      ];
      if (query.$or) {
        query.$and = query.$and || [];
        query.$and.push({ $or: query.$or }, { $or: searchCondition });
        delete query.$or;
      } else if (query.$and) {
        query.$and.push({ $or: searchCondition });
      } else {
        query.$or = searchCondition;
      }
    }

    const populate = [
      {
        path: "serviceId",
        select: "name code logo serviceTypeId",
        populate: { path: "serviceTypeId", select: "name code icon status" },
      },
      { path: "providerId", select: "name code logo hasSync isActive" },
    ];

    let isDataService = false;
    if (filters.serviceType === "data") {
      isDataService = true;
    } else if (filters.serviceTypeId && Types.ObjectId.isValid(filters.serviceTypeId)) {
      const st = await ServiceType.findById(filters.serviceTypeId).select("code");
      if (st?.code === "data") isDataService = true;
    } else if (filters.serviceId && Types.ObjectId.isValid(filters.serviceId)) {
      const svc = await Service.findById(filters.serviceId).populate("serviceTypeId", "code");
      if ((svc?.serviceTypeId as any)?.code === "data" || svc?.code?.toLowerCase().includes("data")) {
        isDataService = true;
      }
    }

    const sortBy = filters.sortBy || (isDataService ? "dataSize" : "createdAt");
    const sortOrder = filters.sortOrder
      ? ((filters.sortOrder === "asc" || filters.sortOrder === "1" || filters.sortOrder === 1) ? 1 : -1)
      : (isDataService ? 1 : -1);

    // Handle smart validity duration or dataSize sorting via aggregation pipeline
    if (sortBy === "validity" || sortBy === "validityPeriod" || sortBy === "dataSize") {
      const skip = (page - 1) * limit;

      const validityPipeline: any[] = [
        { $match: query },
        {
          $addFields: {
            validityDurationDays: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /1\s*(?:day|d)|daily|24\s*(?:hour|hr|hrs)/i } }, then: 1 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /2\s*(?:day|d|days)/i } }, then: 2 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /3\s*(?:day|d|days)/i } }, then: 3 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /4\s*(?:day|d|days)/i } }, then: 4 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /5\s*(?:day|d|days)/i } }, then: 5 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /7\s*(?:day|d|days)|1\s*week|weekly/i } }, then: 7 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /14\s*(?:day|d|days)|2\s*week/i } }, then: 14 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /30\s*(?:day|d|days)|1\s*month|monthly/i } }, then: 30 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /60\s*(?:day|d|days)|2\s*month/i } }, then: 60 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /90\s*(?:day|d|days)|3\s*month/i } }, then: 90 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /180\s*(?:day|d|days)|6\s*month/i } }, then: 180 },
                  { case: { $regexMatch: { input: { $ifNull: ["$validity", ""] }, regex: /365\s*(?:day|d|days)|1\s*year|yearly/i } }, then: 365 },
                  { case: { $eq: [{ $toLower: { $ifNull: ["$attributes.validityPeriod", ""] } }, "daily"] }, then: 1 },
                  { case: { $eq: [{ $toLower: { $ifNull: ["$attributes.validityPeriod", ""] } }, "weekly"] }, then: 7 },
                  { case: { $eq: [{ $toLower: { $ifNull: ["$attributes.validityPeriod", ""] } }, "monthly"] }, then: 30 },
                  { case: { $eq: [{ $toLower: { $ifNull: ["$attributes.validityPeriod", ""] } }, "yearly"] }, then: 365 },
                ],
                default: (sortBy === "validity" || sortBy === "validityPeriod") ? (sortOrder === 1 ? 99999 : -1) : 0,
              },
            },
            computedDataSizeMB: {
              $let: {
                vars: {
                  nameStr: { $toLower: { $ifNull: ["$dataSizeDisplay", "$name"] } },
                },
                in: {
                  $cond: [
                    { $and: [{ $ne: ["$dataSize", null] }, { $isNumber: "$dataSize" }, { $gt: ["$dataSize", 0] }] },
                    "$dataSize",
                    {
                      $let: {
                        vars: {
                          match: { $regexFind: { input: "$$nameStr", regex: /([0-9.]+)\s*(gb|mb|tb)/ } }
                        },
                        in: {
                          $cond: [
                            { $ne: ["$$match", null] },
                            {
                              $multiply: [
                                { $toDouble: { $arrayElemAt: ["$$match.captures", 0] } },
                                {
                                  $switch: {
                                    branches: [
                                      { case: { $eq: [{ $arrayElemAt: ["$$match.captures", 1] }, "gb"] }, then: 1024 },
                                      { case: { $eq: [{ $arrayElemAt: ["$$match.captures", 1] }, "tb"] }, then: 1048576 },
                                    ],
                                    default: 1
                                  }
                                }
                              ]
                            },
                            sortBy === "dataSize" ? (sortOrder === 1 ? 999999 : -1) : 0
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            }
          },
        },
        { 
          $sort: sortBy === "dataSize" 
            ? { computedDataSizeMB: sortOrder, amount: sortOrder, name: 1 } 
            : { validityDurationDays: sortOrder, dataSize: 1, amount: 1 } 
        },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: "services",
                  localField: "serviceId",
                  foreignField: "_id",
                  as: "serviceId",
                  pipeline: [
                    {
                      $lookup: {
                        from: "servicetypes",
                        localField: "serviceTypeId",
                        foreignField: "_id",
                        as: "serviceTypeId",
                        pipeline: [
                          {
                            $project: {
                              name: 1,
                              code: 1,
                              icon: 1,
                              status: 1,
                            },
                          },
                        ],
                      },
                    },
                    {
                      $unwind: {
                        path: "$serviceTypeId",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $project: {
                        name: 1,
                        code: 1,
                        logo: 1,
                        serviceTypeId: 1,
                      },
                    },
                  ],
                },
              },
              {
                $unwind: {
                  path: "$serviceId",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "providers",
                  localField: "providerId",
                  foreignField: "_id",
                  as: "providerId",
                  pipeline: [
                    {
                      $project: {
                        name: 1,
                        code: 1,
                        logo: 1,
                        hasSync: 1,
                        isActive: 1,
                      },
                    },
                  ],
                },
              },
              {
                $unwind: {
                  path: "$providerId",
                  preserveNullAndEmptyArrays: true,
                },
              },
            ],
            total: [{ $count: "count" }],
          },
        },
      ];

      const [facetResult, statsResult] = await Promise.all([
        Product.aggregate(validityPipeline),
        Product.aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
              inactive: { $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] } },
              hot: { $sum: { $cond: [{ $eq: ["$isHot", true] }, 1, 0] } },
            },
          },
        ]),
      ]);

      const facet = facetResult[0] || { data: [], total: [] };
      const total = facet.total[0]?.count || 0;
      const stats = statsResult[0] || { total: 0, active: 0, inactive: 0, hot: 0 };

      return {
        products: facet.data,
        stats: {
          total: stats.total || 0,
          active: stats.active || 0,
          inactive: stats.inactive || 0,
          hot: stats.hot || 0,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Standard sorting
    let sortObj: any = { createdAt: -1 };
    switch (sortBy) {
      case "dataSize":
        // Should be handled by pipeline above, but fallback just in case
        sortObj = { dataSize: sortOrder, amount: sortOrder, name: 1 };
        break;
      case "name":
        sortObj = { name: sortOrder };
        break;
      case "amount":
      case "price":
        sortObj = { amount: sortOrder };
        break;
      case "providerAmount":
      case "cost":
        sortObj = { providerAmount: sortOrder };
        break;
      case "isHot":
        sortObj = { isHot: sortOrder, createdAt: -1 };
        break;
      case "status":
      case "isActive":
        sortObj = { isActive: sortOrder, createdAt: -1 };
        break;
      case "createdAt":
      case "date":
      default:
        sortObj = { createdAt: sortOrder };
        break;
    }

    const [result, statsResult] = await Promise.all([
      this.productRepository.findWithPagination(
        query,
        page,
        limit,
        sortObj,
        populate,
      ),
      Product.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] } },
            hot: { $sum: { $cond: [{ $eq: ["$isHot", true] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = statsResult[0] || { total: 0, active: 0, inactive: 0, hot: 0 };

    return {
      products: result.data,
      stats: {
        total: stats.total || 0,
        active: stats.active || 0,
        inactive: stats.inactive || 0,
        hot: stats.hot || 0,
      },
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async createProduct(data: any) {
    const service = await Service.findById(data.serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    if (!data.dataSize && (data.dataSizeDisplay || data.name)) {
      const parsed = this.parseDataSizeInMB(data.dataSizeDisplay || data.name);
      if (parsed.sizeInMB > 0) {
        data.dataSize = parsed.sizeInMB;
        if (!data.dataSizeDisplay) {
          data.dataSizeDisplay = parsed.displaySize;
        }
      }
    }

    const product = await this.productRepository.create(data);

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    // Invalidate caches after creation
    const serviceTypeCode = (service as any).serviceTypeId?.code;
    await this.invalidateProductRelatedCaches(
      product._id.toString(),
      data.serviceId,
      data.providerId,
      serviceTypeCode,
    );

    // Also invalidate general product list
    await this.invalidateGeneralProductCaches();

    return { message: "Product created successfully", product };
  }

  async getProductDetails(productId: string) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    return product;
  }

  async updateProduct(productId: string, data: any) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const targetProviderAmount =
      data.providerAmount !== undefined
        ? Number(data.providerAmount)
        : product.providerAmount;

    const targetAllowBelowCost =
      data.allowBelowCost !== undefined
        ? Boolean(data.allowBelowCost)
        : Boolean(product.allowBelowCost);

    if (
      data.amount !== undefined &&
      targetProviderAmount !== undefined &&
      !isNaN(targetProviderAmount)
    ) {
      const amountNum = Number(data.amount);
      if (amountNum < targetProviderAmount) {
        if (!targetAllowBelowCost) {
          throw new AppError(
            "Selling amount cannot be less than provider cost unless 'allowBelowCost' is enabled",
            HTTP_STATUS.BAD_REQUEST,
          );
        }
        const minAllowed = Math.floor(targetProviderAmount * 0.97 * 100) / 100;
        if (amountNum < minAllowed) {
          throw new AppError(
            `Selling amount cannot be more than 3% below provider cost (minimum ₦${minAllowed.toLocaleString()})`,
            HTTP_STATUS.BAD_REQUEST,
          );
        }
      }
    }

    const oldServiceId = product.serviceId.toString();
    const oldProviderId = product.providerId.toString();

    if (data.serviceId && data.serviceId !== oldServiceId) {
      const service = await Service.findById(data.serviceId);
      if (!service) {
        throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
      }
    }

    if (data.dataSizeDisplay || data.name) {
      const parsed = this.parseDataSizeInMB(data.dataSizeDisplay || data.name);
      if (parsed.sizeInMB > 0) {
        data.dataSize = parsed.sizeInMB;
        if (!data.dataSizeDisplay) {
          data.dataSizeDisplay = parsed.displaySize;
        }
      }
    }

    if (data.category && (!data.attributes || !data.attributes.category)) {
      data.attributes = { ...(product.attributes || {}), ...(data.attributes || {}), category: data.category };
    } else if (data.attributes?.category && !data.category) {
      data.category = data.attributes.category;
    }

    if (data.productType && (!data.attributes || !data.attributes.dataType)) {
      data.attributes = { ...(product.attributes || {}), ...(data.attributes || {}), dataType: data.productType };
    } else if (data.attributes?.dataType && !data.productType) {
      data.productType = data.attributes.dataType;
    }

    if (data.attributes) {
      data.attributes = { ...(product.attributes || {}), ...data.attributes };
    }

    Object.assign(product, data);
    await product.save();

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    // Invalidate caches after update
    const newServiceId = data.serviceId || oldServiceId;
    const newProviderId = data.providerId || oldProviderId;

    await Promise.all([
      this.invalidateProductCache(productId),
      this.invalidateProductsByServiceCache(oldServiceId),
      ...(data.serviceId !== oldServiceId
        ? [this.invalidateProductsByServiceCache(newServiceId)]
        : []),
      this.invalidateProductsByProviderCache(oldProviderId),
      ...(data.providerId !== oldProviderId
        ? [this.invalidateProductsByProviderCache(newProviderId)]
        : []),
    ]);

    return { message: "Product updated successfully", product };
  }

  async updateProductStatus(productId: string, isActive: boolean) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const oldStatus = product.isActive;
    product.isActive = isActive;
    await product.save();

    // Only invalidate if status actually changed
    if (oldStatus !== isActive) {
      await this.invalidateProductCache(productId);
      await this.invalidateProductsByServiceCache(product.serviceId.toString());
    }

    return {
      message: "Product status updated successfully",
      isActive: product.isActive,
    };
  }

  async updateProductHotStatus(productId: string, isHot: boolean) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const oldHot = product.isHot;
    product.isHot = isHot;
    await product.save();

    await product.populate([
      {
        path: "serviceId",
        select: "name code logo serviceTypeId",
        populate: { path: "serviceTypeId", select: "name code icon status" },
      },
      { path: "providerId", select: "name code logo hasSync isActive" },
    ]);

    // Invalidate caches if hot status changed
    if (oldHot !== isHot) {
      const sId = (product.serviceId as any)?._id
        ? (product.serviceId as any)._id.toString()
        : product.serviceId.toString();
      await this.invalidateProductCache(productId);
      await this.invalidateProductsByServiceCache(sId);
      await this.invalidateGeneralProductCaches();
    }

    return {
      message: `Product ${isHot ? "marked as hot" : "removed from hot"} successfully`,
      isHot: product.isHot,
      product,
    };
  }

  async bulkUpdateProductStatus(productIds: string[], isActive: boolean) {
    if (!productIds || !productIds.length) {
      throw new AppError("No product IDs provided", HTTP_STATUS.BAD_REQUEST);
    }

    const objectIds = productIds.map((id) => new Types.ObjectId(id));
    const products = await Product.find({ _id: { $in: objectIds } });

    await Product.updateMany(
      { _id: { $in: objectIds } },
      { $set: { isActive } }
    );

    // Invalidate caches
    const serviceIds = [...new Set(products.map((p) => p.serviceId.toString()))];
    await Promise.all([
      ...productIds.map((id) => this.invalidateProductCache(id)),
      ...serviceIds.map((sId) => this.invalidateProductsByServiceCache(sId)),
      this.invalidateGeneralProductCaches(),
    ]);

    return {
      message: `${products.length} product(s) ${isActive ? "activated" : "deactivated"} successfully`,
      updatedCount: products.length,
      isActive,
    };
  }

  async bulkUpdateProductHotStatus(productIds: string[], isHot: boolean) {
    if (!productIds || !productIds.length) {
      throw new AppError("No product IDs provided", HTTP_STATUS.BAD_REQUEST);
    }

    const objectIds = productIds.map((id) => new Types.ObjectId(id));
    const products = await Product.find({ _id: { $in: objectIds } });

    await Product.updateMany(
      { _id: { $in: objectIds } },
      { $set: { isHot } }
    );

    // Invalidate caches
    const serviceIds = [...new Set(products.map((p) => p.serviceId.toString()))];
    await Promise.all([
      ...productIds.map((id) => this.invalidateProductCache(id)),
      ...serviceIds.map((sId) => this.invalidateProductsByServiceCache(sId)),
      this.invalidateGeneralProductCaches(),
    ]);

    return {
      message: `${products.length} product(s) ${isHot ? "marked as hot" : "removed from hot"} successfully`,
      updatedCount: products.length,
      isHot,
    };
  }

  async deleteProduct(productId: string) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const serviceId = product.serviceId.toString();
    const providerId = product.providerId.toString();

    await this.productRepository.delete(productId);

    // Invalidate caches after deletion
    await this.invalidateProductRelatedCaches(productId, serviceId, providerId);

    return { message: "Product deleted successfully" };
  }

  async getProductsByServiceType(
    serviceTypeId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const services = await Service.find({
      serviceTypeId: new Types.ObjectId(serviceTypeId),
    }).select("_id");

    if (services.length === 0) {
      return {
        products: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const serviceIds = services.map((s) => s._id);

    const query: any = {
      serviceId: { $in: serviceIds },
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
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

  async getProductsByService(
    serviceId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const query: any = {
      serviceId: new Types.ObjectId(serviceId),
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      service: {
        id: service._id,
        name: service.name,
        code: service.code,
        logo: service.logo,
      },
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getProductsByProvider(
    providerId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = {
      providerId: new Types.ObjectId(providerId),
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.serviceId) {
      query.serviceId = filters.serviceId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
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

  async fetchProviderProducts(providerId: string, serviceId: string) {
    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    // TODO: Implement provider-specific product fetching logic
    throw new AppError(
      "Product fetching from provider is not yet implemented",
      HTTP_STATUS.NOT_IMPLEMENTED,
    );
  }

  // Toggle products by service (used for cascading)
  async toggleProductsByService(
    serviceId: string,
    isActive: boolean,
  ): Promise<number> {
    const products = await this.productRepository.find({
      serviceId: new Types.ObjectId(serviceId),
    });

    let toggledCount = 0;
    for (const product of products) {
      if (product.isActive !== isActive) {
        product.isActive = isActive;
        await product.save();
        toggledCount++;
      }
    }

    // Invalidate all products for this service after bulk toggle
    if (toggledCount > 0) {
      await this.invalidateProductsByServiceCache(serviceId);
    }

    return toggledCount;
  }
}
