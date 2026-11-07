import { Request, Response } from "express";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";
import logger from "@/logger";

export class EmailBannerController {
  async getEmailBanners(req: Request, res: Response) {
    try {
      const emailBannerService = AdminServiceContainer.getEmailBannerService();
      const banners = await emailBannerService.getEmailBanners();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: banners,
      });
    } catch (error: any) {
      logger.error("Error in getEmailBanners", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to fetch email banners",
      });
    }
  }

  async updateEmailBanners(req: Request, res: Response) {
    try {
      const adminId = (req as any).admin.id;
      const data = req.body;
      
      const emailBannerService = AdminServiceContainer.getEmailBannerService();
      await emailBannerService.updateEmailBanners(data, adminId);

      // Return the updated data structure instead of the full Mongoose model
      const updatedBanners = await emailBannerService.getEmailBanners();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: "Email banners updated successfully",
        data: updatedBanners,
      });
    } catch (error: any) {
      logger.error("Error in updateEmailBanners", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update email banners",
      });
    }
  }
}
