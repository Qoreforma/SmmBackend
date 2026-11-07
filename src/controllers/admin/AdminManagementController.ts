import { Request, Response } from "express";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import logger from "@/logger";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";

export class AdminManagementController {
  private adminManagementService =
    AdminServiceContainer.getAdminManagementService();

  createAdmin = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const creatorId = req.admin?.id;
      if (!creatorId) {
        sendErrorResponse(res, "Unauthorized", HTTP_STATUS.UNAUTHORIZED);
        return;
      }

      const admin = await this.adminManagementService.createAdmin(
        req.body,
        creatorId,
        req.admin?.permissions || [],
      );

      logger.info("Admin account created", {
        newAdminId: admin._id.toString(),
        createdBy: creatorId,
        adminLevel: admin.adminLevel,
      });

      sendSuccessResponse(
        res,
        admin,
        "Admin account created successfully",
        HTTP_STATUS.CREATED,
      );
    } catch (error: any) {
      logger.error("Failed to create admin account", {
        error: error.message,
        createdBy: req.admin?.id,
        email: req.body.email,
      });

      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  getAllAdmins = async (req: Request, res: Response): Promise<void> => {
    try {
      const { page = 1, limit = 20, status, adminLevel, search } = req.query;

      let filters: any = {
        page: Number(page),
        limit: Number(limit),
      };

      if (status) {
        filters.status = status;
      }
      if (adminLevel) {
        filters.adminLevel = adminLevel;
      }
      if (search) {
        filters.search = search;
      }
      const result = await this.adminManagementService.getAllAdmins(filters);

      sendSuccessResponse(res, result, "Admins retrieved successfully");
    } catch (error: any) {
      logger.error("Failed to get admins", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  getAdminById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { adminId } = req.params;
      const admin = await this.adminManagementService.getAdminById(adminId);

      sendSuccessResponse(res, { admin }, "Admin retrieved successfully");
    } catch (error: any) {
      logger.error("Failed to get admin", {
        adminId: req.params.adminId,
        error: error.message,
      });

      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  updateAdmin = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const { adminId } = req.params;
      const updatedBy = req.admin?.id;

      if (!updatedBy) {
        sendErrorResponse(res, "Unauthorized", HTTP_STATUS.UNAUTHORIZED);
        return;
      }

      const admin = await this.adminManagementService.updateAdmin(
        adminId,
        req.body,
        updatedBy,
        req.admin?.permissions || [],
      );

      logger.info("Admin account updated", {
        adminId,
        updatedBy,
        updates: Object.keys(req.body),
      });

      sendSuccessResponse(res, { admin }, "Admin account updated successfully");
    } catch (error: any) {
      logger.error("Failed to update admin", {
        adminId: req.params.adminId,
        error: error.message,
        updatedBy: req.admin?.id,
      });

      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  deactivateAdmin = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const { adminId } = req.params;
      const deactivatedBy = req.admin?.id;

      if (!deactivatedBy) {
        sendErrorResponse(res, "Unauthorized", HTTP_STATUS.UNAUTHORIZED);
        return;
      }

      await this.adminManagementService.deactivateAdmin(adminId, deactivatedBy);

      logger.info("Admin account deleted", {
        adminId,
        deactivatedBy,
      });

      sendSuccessResponse(res, null, "Admin account deleted successfully");
    } catch (error: any) {
      logger.error("Failed to delete admin", {
        adminId: req.params.adminId,
        error: error.message,
        deactivatedBy: req.admin?.id,
      });

      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  resetAdminPassword = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const { adminId } = req.params;
      const resetBy = req.admin?.id;

      if (!resetBy) {
        sendErrorResponse(res, "Unauthorized", HTTP_STATUS.UNAUTHORIZED);
        return;
      }

      await this.adminManagementService.resetAdminPassword(adminId, resetBy);

      logger.info("Admin password reset", {
        adminId,
        resetBy,
      });

      sendSuccessResponse(res, null, "Admin password reset successfully");
    } catch (error: any) {
      logger.error("Failed to reset admin password", {
        adminId: req.params.adminId,
        error: error.message,
        resetBy: req.admin?.id,
      });

      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };

  getAdminStatistics = async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.adminManagementService.getAdminStatistics();

      sendSuccessResponse(
        res,
        stats,
        "Admin statistics retrieved successfully",
      );
    } catch (error: any) {
      logger.error("Failed to get admin statistics", { error: error.message });
      sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}
