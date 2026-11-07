import logger from "@/logger";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { HTTP_STATUS } from "@/utils/constants";
import { sendErrorResponse, sendSuccessResponse } from "@/utils/helpers";
import { NextFunction, Response } from "express";
import { ProfileService } from "@/services/admin/admins/ProfileService";

export class ProfileController {
  private profileService = new ProfileService();

  async updateProfile(
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const adminId = req.admin?.adminId;
      if (!adminId) {
        sendErrorResponse(
          res,
          "You have to be authenticated to make this request",
          HTTP_STATUS.UNAUTHORIZED,
        );
        return;
      }

      const admin = await this.profileService.updateAdminProfile(
        adminId,
        req.body,
      );
      logger.info("Admin profile updated", { adminId: req.admin?.adminId });
      sendSuccessResponse(res, admin, "Profile updated successfully");
    } catch (error: any) {
      logger.error("Update admin profile failed", {
        error: error.message,
        adminId: req.admin?.adminId,
      });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async changePassword(
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const adminId = req.admin?.adminId;
      if (!adminId) {
        sendErrorResponse(
          res,
          "Admin not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
        );
        return;
      }
      const { newPassword, currentPassword } = req.body;

      const result = await this.profileService.changePassword(
        adminId,
        newPassword,
        currentPassword,
        req.tokenPayload?.family,
      );

      sendSuccessResponse(res, null, "Password changed successfully");
    } catch (error: any) {
      logger.error("Error changing admin password", {
        message: error.message,
        adminId: req.admin?.adminId,
        adminEmail: req.admin?.email,
      });
      next(error);
    }
  }

  async getProfile(
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const adminId = req.admin?.adminId;

      if (!adminId) {
        sendErrorResponse(
          res,
          "You have to be authenticated to make this request",
          HTTP_STATUS.UNAUTHORIZED,
        );
        return;
      }

      const profile = await this.profileService.fetchProfile(adminId);

      sendSuccessResponse(res, profile, "Profile fetched Successfully");
    } catch (error: any) {
      logger.error("Failed to fetch Admin profile", {
        message: error.message,
        adminId: req.admin?.adminId,
      });
      next(error);
    }
  }

  async toggle2FA(req: AuthenticatedAdminRequest, res: Response) {
    try {
      const { enabled, currentPassword } = req.body;
      const adminId = req.admin?.adminId;

      if (!adminId) {
        sendErrorResponse(
          res,
          "Must be logged in to perform this action",
          HTTP_STATUS.UNAUTHORIZED,
        );
        return;
      }

      let result;
      if (enabled) {
        result = await this.profileService.enable2FA(adminId);
      } else {
        result = await this.profileService.disable2FA(adminId, currentPassword);
      }

      if (!result.success) {
        sendErrorResponse(
          res,
          "failed to set 2fa",
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
      }

      sendSuccessResponse(res, { twoFactorEnabled: enabled }, result.message);
    } catch (error: any) {
      logger.error("Toggle 2FA error", {
        message: error.message,
        statusCode: error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      });

      sendErrorResponse(
        res,
        error.message || "Internal server error",
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
