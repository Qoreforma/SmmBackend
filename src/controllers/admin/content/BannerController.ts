import { Request, Response, NextFunction } from "express";
import { BannerService } from "@/services/admin/content/BannerService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";

export class BannerController {
  private bannerService: BannerService;

  constructor() {
    this.bannerService = AdminServiceContainer.getBannerService();
  }

  listBanners = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await this.bannerService.listBanners(page, limit);

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Banners retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createBanner = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const banner = await this.bannerService.createBanner(req.body, adminId);
      return sendSuccessResponse(
        res,
        banner,
        "Banner created successfully",
        HTTP_STATUS.CREATED
      );
    } catch (error) {
      next(error);
    }
  };
  
reorderBanners = async (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => {
    try {
      const { bannerIds } = req.body;
      const result = await this.bannerService.reorderBanners(bannerIds);
      return sendSuccessResponse(res, result, "Banner order updated successfully");
    } catch (error) {
      next(error);
    }
  };

  getBannerDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const banner = await this.bannerService.getBannerDetails(id);
      return sendSuccessResponse(res, banner, "Banner retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  updateBanner = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const banner = await this.bannerService.updateBanner(id, req.body);
      return sendSuccessResponse(res, banner, "Banner updated successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteBanner = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await this.bannerService.deleteBanner(id);
      return sendSuccessResponse(res, null, "Banner deleted successfully");
    } catch (error) {
      next(error);
    }
  };
  updateStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const result = await this.bannerService.updateStatus(id, isActive);
      return sendSuccessResponse(
        res,
        result,
        "Banner status updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
