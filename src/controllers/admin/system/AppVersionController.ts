import { Request, Response, NextFunction } from "express";
import { AppVersionService } from "@/services/admin/system/AppVersionService";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";

export class AppVersionController {
  private appVersionService: AppVersionService;

  constructor() {
    this.appVersionService = AdminServiceContainer.getAppVersionService();
  }

  listAppVersions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await this.appVersionService.listAppVersions(
        Number(page),
        Number(limit)
      );

      sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page: Number(page), limit: Number(limit) },
        "App Versions retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createAppVersion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await this.appVersionService.createAppVersion(req.body);
      sendSuccessResponse(res, result, "App Version created successfully");
    } catch (error) {
      next(error);
    }
  };

  getAppVersionDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const appVersion = await this.appVersionService.getAppVersionDetails(id);
      sendSuccessResponse(
        res,
        appVersion,
        "App version Details retrived successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateAppVersion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await this.appVersionService.updateAppVersion(
        id,
        req.body
      );
      sendSuccessResponse(res, result, "App version Updated Successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteAppVersion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await this.appVersionService.deleteAppVersion(id);
      sendSuccessResponse(res, null, "App Version deleted successfully");
    } catch (error) {
      next(error);
    }
  };
}
