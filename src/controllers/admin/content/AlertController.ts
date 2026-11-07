import { Request, Response } from "express";
import { AlertService } from "@/services/admin/content/AlertService";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendPaginatedResponse,
} from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";

export class AlertController {
  private alertService: AlertService;

  constructor() {
    this.alertService = AdminServiceContainer.getAlertService();
  }

  listAlerts = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const pageNumber = Number(page);
      const limitNumber = Number(limit);
      const result = await this.alertService.listAlerts(
        Number(page),
        Number(limit),
        filters,
      );
      return sendPaginatedResponse(
        res,
        result.alerts,
        { total: result.total, page: pageNumber, limit: limitNumber },
        "Alerts retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  createAlert = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const adminId = req.admin!.adminId;
      const result = await this.alertService.createAlert(adminId, req.body);
      return sendSuccessResponse(
        res,
        result.alert,
        result.message,
        HTTP_STATUS.CREATED,
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getAlertDetails = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.alertService.getAlertDetails(id);
      return sendSuccessResponse(res, result, "Alert details retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

  updateAlert = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = req.admin!.adminId;
      const result = await this.alertService.updateAlert(id, adminId, req.body);
      return sendSuccessResponse(res, result.alert, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  deleteAlert = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.alertService.deleteAlert(id);
      return sendSuccessResponse(res, null, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  restoreAlert = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.alertService.restoreAlert(id);
      return sendSuccessResponse(res, null, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  dispatchAlert = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.alertService.dispatchAlert(id);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  redispatchAlert = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.alertService.redispatchAlert(id);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };
}
