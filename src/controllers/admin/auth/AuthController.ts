import { NextFunction, Request, Response } from "express";
import { AdminAuthService } from "@/services/admin/auth/AdminAuthService";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import logger from "@/logger";
import adminJwtUtil from "@/config/admin/jwt";
import { Admin } from "@/models/admin/Admin";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import { v4 as uuidv4 } from "uuid";

const DEVICE_ID_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 2 * 365 * 24 * 60 * 60 * 1000, // 5 year
};

export class AuthController {
  private authService: AdminAuthService;

  constructor() {
    this.authService = AdminServiceContainer.getAdminAuthService();
  }

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);

        try {
          const decoded = adminJwtUtil.verifyAccessToken(token);
          if (decoded && !adminJwtUtil.isTokenExpired(token)) {
            // Check if token is still active in database
            const admin = await Admin.findById(decoded.adminId).select(
              "+activeTokenId",
            );
            if (admin && admin.activeTokenId === decoded.tokenId) {
              logger.info("Admin already authenticated", {
                adminId: decoded.adminId,
                ip: req.ip,
              });

              sendSuccessResponse(
                res,
                {
                  admin: {
                    id: admin._id,
                    firstName: admin.firstName,
                    lastName: admin.lastName,
                    email: admin.email,
                    adminLevel: admin.adminLevel,
                    permissions: admin.permissions,
                    profilePicture: admin.profilePicture,
                  },
                  message: "Already authenticated",
                },
                "Already logged in",
              );

              return;
            }
          }
        } catch (error) {
          logger.debug("Existing token invalid, proceeding with login", {
            ip: req.ip,
          });
        }
      }

      let deviceId = req.cookies.deviceId;
      if (!deviceId) {
        deviceId = uuidv4();
      }

      res.cookie("deviceId", deviceId, DEVICE_ID_COOKIE_OPTIONS);

      const result = await this.authService.login(
        req.body,
        deviceId,
        req.ip,
        req.get("User-Agent"),
      );

      logger.info("Admin login successful", {
        adminId: result.admin?.id,
        adminEmail: result.admin?.email,
        ip: req.ip,
      });

      if (result.message && !result.tokens) {
        sendSuccessResponse(res, null, result.message);
      } else {
        sendSuccessResponse(res, result, "Login Successful");
      }
    } catch (error: any) {
      logger.error("Admin login failed", {
        error: error.message,
        email: req.body.email,
        ip: req.ip,
      });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  verify2FA = async (req: Request, res: Response) => {
    try {
      const { email, otp } = req.body;
      let deviceId = req.cookies.deviceId;
      if (!deviceId) {
        deviceId = uuidv4();
        res.cookie("deviceId", deviceId, DEVICE_ID_COOKIE_OPTIONS);
      }

      const result = await this.authService.verify2FA(
        email,
        otp,
        deviceId,
        req.ip,
        req.get("User-Agent"),
      );

      sendSuccessResponse(res, result, "Login Successful");
    } catch (error: any) {
      logger.error("Verify 2fa OTP error:", error);
      sendErrorResponse(
        res,
        error.message || "Invalid OTP",
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
      );
    }
  };

  logout = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ): Promise<void> => {
    try {
      await this.authService.logout(req.get("Authorization"));
      logger.info("Admin logout successful", { adminId: req.admin?.adminId });
      sendSuccessResponse(res, {}, "Logout successful");
    } catch (error: any) {
      logger.error("Admin logout failed", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  refreshToken = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.authService.refreshToken(req.body.refreshToken);
      sendSuccessResponse(res, result, "Token refreshed successfully");
    } catch (error: any) {
      logger.error("Admin token refresh failed", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authService.forgotPassword(req.body.email);
      sendSuccessResponse(res, "Password reset OTP sent successfully");
    } catch (error: any) {
      logger.error("Admin forgot password failed", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  resendOtp = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authService.resend2FAOtp(req.body.email);
      sendSuccessResponse(res, "Password reset OTP sent successfully");
    } catch (error: any) {
      logger.error("Admin resend otp failed", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authService.resetPassword(req.body);
      logger.info("Admin password reset successful", { email: req.body.email });
      sendSuccessResponse(res, "Password reset successful");
    } catch (error: any) {
      logger.error("Admin password reset failed", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}
