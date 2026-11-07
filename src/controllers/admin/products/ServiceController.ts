import { NextFunction, Request, Response } from "express";
import { ServiceManagementService } from "@/services/admin/products/ServiceManagementService";
import {
  sendSuccessResponse,
  sendPaginatedResponse,
} from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class ServiceController {
  private serviceService: ServiceManagementService;

  constructor() {
    this.serviceService = AdminServiceContainer.getServiceManagementService();
  }

  listServices = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.serviceService.listServices(
        Number(page),
        Number(limit),
        filters
      );

      return sendPaginatedResponse(
        res,
        result.services,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Services retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };

  createService = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, logo, serviceTypeId, isActive, displayOrder } = req.body;
      const code = name.replace(/\s+/g, "-").toLowerCase();
      const result = await this.serviceService.createService(
        name,
        code,
        logo,
        serviceTypeId,
        isActive ?? true,
        displayOrder ?? 0
      );
      return sendSuccessResponse(
        res,
        result.service,
        result.message,
        HTTP_STATUS.CREATED
      );
    } catch (error: any) {
      next(error);
    }
  };

  getServiceDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await this.serviceService.getServiceDetails(id);
      return sendSuccessResponse(res, result, "Service details retrieved");
    } catch (error: any) {
      next(error);
    }
  };

  updateService = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.serviceService.updateService(id, req.body);
      return sendSuccessResponse(res, result.updatedService, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  updateServiceStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const result = await this.serviceService.updateServiceStatus(id, isActive);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  getServiceProducts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const result = await this.serviceService.getServiceProducts(
        id,
        Number(page),
        Number(limit)
      );

      return sendPaginatedResponse(
        res,
        result.products,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Service products retrieved"
      );
    } catch (error: any) {
      next(error);
    }
  };
}