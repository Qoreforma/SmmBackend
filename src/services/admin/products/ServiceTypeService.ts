import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { Service } from "@/models/reference/Service";
import { ProductManagementService } from "@/services/admin/products/ProductManagementService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS } from "@/utils/constants";
import { Types } from "mongoose";

export class ServiceTypeService {
  constructor(
    private serviceTypeRepository: ServiceTypeRepository,
    private serviceRepository: ServiceRepository,
    private productService: ProductManagementService
  ) {}

  async listServiceTypes(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
    includeServices: boolean = false
  ) {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = includeServices
      ? [
          {
            path: "services",
            select: "name code logo isActive displayOrder",
            match: { isActive: true },
          },
        ]
      : [];

    const result = await this.serviceTypeRepository.findWithPagination(
      query,
      page,
      limit,
      { displayOrder: 1, name: 1 },
      populate
    );

    return {
      serviceTypes: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async createServiceType(
    name: string,
    code: string,
    description: string,
    icon: string,
    status: "active" | "coming-soon" | "deactivated" | "temporary-deactivated",
    displayOrder: number
  ) {
    const existing = await this.serviceTypeRepository.findByCode(code);

    if (existing) {
      throw new AppError(
        "Service type with this code already exists",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const serviceType = await this.serviceTypeRepository.create({
      name,
      code: code.toLowerCase().trim(),
      description,
      icon,
      status,
      displayOrder,
    });

    return {
      message: "Service type created successfully",
      serviceType,
    };
  }

  async getServiceTypeDetails(id: string, includeServices: boolean = false) {
    const serviceType = await this.serviceTypeRepository.findById(id);

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    if (includeServices) {
      await serviceType.populate({
        path: "services",
        select: "name code logo isActive displayOrder",
        match: { isActive: true },
        options: { sort: { displayOrder: 1, name: 1 } },
      });
    }

    return serviceType;
  }

  async updateServiceType(
    data: {
      name: string;
      description: string;
      icon: string;
      status:
        | "active"
        | "coming-soon"
        | "deactivated"
        | "temporary-deactivated";
      displayOrder: number;
    },
    id: string
  ) {
    const serviceType = await this.serviceTypeRepository.findById(id);

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    const updatedServiceType = await this.serviceTypeRepository.update(
      serviceType.id,
      { ...data }
    );

    return {
      message: "Service type updated successfully",
      updatedServiceType,
    };
  }

  async updateServiceTypeStatus(
    serviceTypeId: string,
    status: "active" | "coming-soon" | "deactivated" | "temporary-deactivated"
  ) {
    const serviceType = await this.serviceTypeRepository.findById(
      serviceTypeId
    );

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    const isActivating = status === "active";
    const wasActive = serviceType.status === "active";

    serviceType.status = status;
    await serviceType.save();

    // Cascade to services and products
    const services = await Service.find({
      serviceTypeId: new Types.ObjectId(serviceTypeId),
    });

    let cascadedServices = 0;
    let cascadedProducts = 0;

    for (const service of services) {
      const shouldActivate = isActivating;
      const shouldDeactivate = !isActivating;

      if (shouldActivate && !service.isActive) {
        service.isActive = true;
        await service.save();
        cascadedServices++;

        const activatedProducts =
          await this.productService.toggleProductsByService(
            service.id.toString(),
            true
          );
        cascadedProducts += activatedProducts;
      } else if (shouldDeactivate && service.isActive) {
        service.isActive = false;
        await service.save();
        cascadedServices++;

        const deactivatedProducts =
          await this.productService.toggleProductsByService(
            service.id.toString(),
            false
          );
        cascadedProducts += deactivatedProducts;
      }
    }

    let message = "Service type status updated successfully";
    if (cascadedServices > 0) {
      message += `. ${cascadedServices} service(s) ${
        isActivating ? "activated" : "deactivated"
      }`;
    }
    if (cascadedProducts > 0) {
      message += `. ${cascadedProducts} product(s) ${
        isActivating ? "activated" : "deactivated"
      }`;
    }

    return {
      message,
      status: serviceType.status,
      cascadedServices,
      cascadedProducts,
    };
  }

  async getServiceTypeServices(
    serviceTypeId: string,
    page: number = 1,
    limit: number = 20,
    activeOnly: boolean = true
  ) {
    const serviceType = await this.serviceTypeRepository.findById(
      serviceTypeId
    );

    if (!serviceType) {
      throw new AppError("Service type not found", HTTP_STATUS.NOT_FOUND);
    }

    const filters: any = {
      serviceTypeId,
      isActive: activeOnly ? true : undefined,
    };

    const result = await this.serviceRepository.findWithFilters(
      filters,
      page,
      limit
    );

    return {
      serviceType: {
        id: serviceType._id,
        name: serviceType.name,
        code: serviceType.code,
        description: serviceType.description,
        icon: serviceType.icon,
      },
      services: result.data,
      pagination: {
        page: result.page,
        limit,
        total: result.total,
        totalPages: result.pages,
      },
    };
  }
}
