import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { ProductManagementService } from "@/services/admin/products/ProductManagementService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { CACHE_KEYS, HTTP_STATUS } from "@/utils/constants";
import { Types } from "mongoose";
import { CacheService } from "@/services/core/CacheService";
import logger from "@/logger";

export class ServiceManagementService {
  constructor(
    private serviceRepository: ServiceRepository,
    private serviceTypeRepository: ServiceTypeRepository,
    private productService: ProductManagementService,
    private cacheService: CacheService,
  ) {}

  // CACHE INVALIDATION METHODS

  // Invalidates cache for a specific service
  // Call when: Creating, updating, or deleting a service
  private async invalidateServiceCache(serviceId: string): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.SERVICE_BY_ID(serviceId),
        CACHE_KEYS.SERVICE_WITH_TYPE(serviceId),
      ];

      await Promise.all(cacheKeys.map((key) => this.cacheService.delete(key)));

      logger.debug(`Service cache invalidated for ID: ${serviceId}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.warn(`Error invalidating service cache for ${serviceId}:`, error);
    }
  }

  // Invalidates all services related to a service type
  // Call when: Creating, updating, or deleting a service under a service type
  private async invalidateServicesByTypeCache(
    serviceTypeCode: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.SERVICES_BY_TYPE(serviceTypeCode),
        CACHE_KEYS.SERVICES_BY_TYPE_PROVIDER("*", serviceTypeCode), // Clear all provider variants
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        // Delete all provider-specific variants for this service type
        this.cacheService.deletePattern(
          `services:type:${serviceTypeCode}:provider:*`,
        ),
      ]);

      logger.debug(
        `Services cache invalidated for service type: ${serviceTypeCode}`,
        {
          keys: cacheKeys,
        },
      );
    } catch (error) {
      logger.warn(
        `Error invalidating services cache for type ${serviceTypeCode}:`,
        error,
      );
    }
  }

  // Invalidates all products related to a service
  // Call when: Service is created, deleted, or status changes
  // Note: ProductManagementService handles this internally, but we ensure it here
  private async invalidateProductsForServiceCache(
    serviceId: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS_BY_SERVICE(serviceId),
        CACHE_KEYS.DATA_PRODUCTS_ALL_ACTIVE(serviceId),
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        // Delete all data type variants
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

  // Invalidates general service lists and reference data
  // Call when: Major changes that affect the service catalog
  private async invalidateGeneralServiceCaches(): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.SERVICES,
        CACHE_KEYS.PRODUCTS,
        CACHE_KEYS.DATA_TYPES,
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug("General service caches invalidated");
    } catch (error) {
      logger.warn("Error invalidating general service caches:", error);
    }
  }

  // Comprehensive cache invalidation for service-related operations
  // Handles cascading invalidations for service type, services, and products
  private async invalidateServiceRelatedCaches(
    serviceId: string,
    serviceTypeCode: string,
  ): Promise<void> {
    try {
      await Promise.all([
        this.invalidateServiceCache(serviceId),
        this.invalidateServicesByTypeCache(serviceTypeCode),
        this.invalidateProductsForServiceCache(serviceId),
      ]);

      logger.info(
        `Comprehensive cache invalidation completed for service ${serviceId}`,
        {
          serviceTypeCode,
        },
      );
    } catch (error) {
      logger.error("Error in comprehensive service cache invalidation:", error);
    }
  }

  // ============================================================================
  // SERVICE MANAGEMENT METHODS
  // ============================================================================

  async listServices(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = { deletedAt: null };

    if (filters.status) {
      query.isActive = filters.status === "true";
    }

    if (filters.serviceTypeId) {
      query.serviceTypeId = new Types.ObjectId(filters.serviceTypeId);
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const result = await this.serviceRepository.findWithPagination(
      query,
      page,
      limit,
      { displayOrder: 1, name: 1 },
      [{ path: "serviceTypeId", select: "name code description icon status" }],
    );

    return {
      services: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async createService(
    name: string,
    code: string,
    logo: string,
    serviceTypeId: Types.ObjectId,
    isActive: boolean,
    displayOrder: number,
  ) {
    const serviceType = await this.serviceTypeRepository.findById(
      serviceTypeId.toString(),
    );

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    if (serviceType.status !== "active") {
      throw new AppError(
        "Cannot create service under an inactive service type",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existingService = await this.serviceRepository.findByCode(code);
    if (existingService) {
      throw new AppError(
        "Service with this code already exists",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const service = await this.serviceRepository.create({
      name,
      code: code.toLowerCase().trim(),
      logo,
      serviceTypeId,
      isActive,
      displayOrder,
    });

    await service.populate(
      "serviceTypeId",
      "name code description icon status",
    );

    // Invalidate caches after creation
    const serviceTypeCode = (serviceType as any).code;
    await Promise.all([
      this.invalidateServiceCache(service._id.toString()),
      this.invalidateServicesByTypeCache(serviceTypeCode),
      this.invalidateGeneralServiceCaches(),
    ]);

    return { message: "Service created successfully", service };
  }

  async getServiceDetails(serviceId: string) {
    const service = await this.serviceRepository.findById(serviceId);

    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    await service.populate(
      "serviceTypeId",
      "name code description icon status",
    );

    return service;
  }

  async updateService(
    serviceId: string,
    data: {
      name: string;
      logo: string;
      isActive: boolean;
      displayOrder: number;
    },
  ) {
    const service = await this.serviceRepository.findById(serviceId);

    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const serviceType = await this.serviceTypeRepository.findById(
      service.serviceTypeId.toString(),
    );

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    if (serviceType.status !== "active") {
      throw new AppError(
        "Cannot update service under an inactive service type",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const updatedService = await this.serviceRepository.update(serviceId, data);

    if (!updatedService) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    await updatedService.populate(
      "serviceTypeId",
      "name code description icon status",
    );

    // Invalidate caches after update
    const serviceTypeCode = (serviceType as any).code;
    await Promise.all([
      this.invalidateServiceCache(serviceId),
      this.invalidateServicesByTypeCache(serviceTypeCode),
    ]);

    return { message: "Service updated successfully", updatedService };
  }

  async updateServiceStatus(serviceId: string, isActive: boolean) {
    const service = await this.serviceRepository.findById(serviceId);

    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const oldStatus = service.isActive;

    if (isActive) {
      const serviceType = await this.serviceTypeRepository.findById(
        service.serviceTypeId.toString(),
      );

      if (!serviceType) {
        throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
      }

      if (serviceType.status !== "active") {
        throw new AppError(
          "Cannot activate service. Parent service type is not active",
          HTTP_STATUS.BAD_REQUEST,
        );
      }
    }

    service.isActive = isActive;
    await service.save();

    // Cascade to products
    const cascadedProducts = await this.productService.toggleProductsByService(
      serviceId,
      isActive,
    );

    // Only invalidate if status actually changed
    if (oldStatus !== isActive) {
      const serviceType = await this.serviceTypeRepository.findById(
        service.serviceTypeId.toString(),
      );
      const serviceTypeCode = (serviceType as any).code;

      await this.invalidateServiceRelatedCaches(serviceId, serviceTypeCode);
    }

    let message = "Service status updated successfully";
    if (cascadedProducts > 0) {
      message += `. ${cascadedProducts} product(s) ${
        isActive ? "activated" : "deactivated"
      }`;
    }

    return {
      message,
      isActive: service.isActive,
      cascadedProducts,
    };
  }

  async getServiceProducts(
    serviceId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const service = await this.serviceRepository.findById(serviceId);

    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    return await this.productService.getProductsByService(
      serviceId,
      page,
      limit,
      {},
    );
  }
}
