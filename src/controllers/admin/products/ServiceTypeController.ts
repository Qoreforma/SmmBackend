import { Request, Response, NextFunction } from "express";
import { ServiceTypeService } from "@/services/admin/products/ServiceTypeService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class ServiceTypeController {
  private serviceTypeService: ServiceTypeService;

  constructor() {
    this.serviceTypeService = AdminServiceContainer.getServiceTypeService();
  }

  listServiceTypes = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { page = 1, limit = 20, includeServices, ...filters } = req.query;
      const result = await this.serviceTypeService.listServiceTypes(
        Number(page),
        Number(limit),
        filters,
        includeServices === "true"
      );

      return sendPaginatedResponse(
        res,
        result.serviceTypes,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Service types retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };

  createServiceType = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { name, description, icon, status, displayOrder } = req.body;
      const code = name.replace(/\s+/g, "-").toLowerCase();
      const result = await this.serviceTypeService.createServiceType(
        name,
        code,
        description,
        icon,
        status ?? "active",
        displayOrder ?? 0
      );
      return sendSuccessResponse(
        res,
        result.serviceType,
        result.message,
        HTTP_STATUS.CREATED
      );
    } catch (error: any) {
      next(error);
    }
  };

  getServiceTypeDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { includeServices = "false" } = req.query;
      const result = await this.serviceTypeService.getServiceTypeDetails(
        id,
        includeServices === "true"
      );
      return sendSuccessResponse(res, result, "Service type details retrieved");
    } catch (error: any) {
      next(error);
    }
  };

  updateServiceType = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await this.serviceTypeService.updateServiceType(req.body, id);
      return sendSuccessResponse(res, result.updatedServiceType, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  updateServiceTypeStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const result = await this.serviceTypeService.updateServiceTypeStatus(id, status);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  getServiceTypeServices = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, activeOnly = "true" } = req.query;
      const result = await this.serviceTypeService.getServiceTypeServices(
        id,
        Number(page),
        Number(limit),
        activeOnly === "true"
      );

      return sendPaginatedResponse(
        res,
        result.services,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Service type services retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };
}