import { Request, Response, NextFunction } from "express";
import { ServiceChargeService } from "@/services/admin/finances/ServiceChargeService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class ServiceChargeController {
  private serviceChargeService: ServiceChargeService;

  constructor() {
    this.serviceChargeService = AdminServiceContainer.getServiceChargeService();
  }

  listServiceCharges = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const { type, code } = req.query;

      const result = await this.serviceChargeService.listServiceCharges(
        page,
        limit,
        { type, code }
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Service charges retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getServiceChargeDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const serviceCharge =
        await this.serviceChargeService.getServiceChargeDetails(id);
      return sendSuccessResponse(
        res,
        serviceCharge,
        "Service charge retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateServiceCharge = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const serviceCharge = await this.serviceChargeService.updateServiceCharge(
        id,
        req.body
      );
      return sendSuccessResponse(
        res,
        serviceCharge,
        "Service charge updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateServiceCharges = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { ids, data } = req.body;
      const result = await this.serviceChargeService.bulkUpdateServiceCharges(ids, data);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

}
