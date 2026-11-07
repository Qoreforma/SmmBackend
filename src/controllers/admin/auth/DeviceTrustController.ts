import { Request, Response } from "express";
import { DeviceTrustService } from "@/services/admin/auth/DeviceTrustService";
import { sendSuccessResponse, sendErrorResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import logger from "@/logger";
import AdminServiceContainer from "@/services/admin/container";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { AdminDeviceApprovalRequest } from "@/models/admin/AdminDeviceApprovalRequest";
import { Types } from "mongoose";

export class DeviceTrustController {
  private deviceTrustService: DeviceTrustService;

  constructor() {
    this.deviceTrustService = AdminServiceContainer.getDeviceTrustService();
  }

  getPendingRequests = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ) => {
    try {
      const requests = await AdminDeviceApprovalRequest.find({
        status: "pending",
      })
        .populate("adminId", "firstName lastName email")
        .sort({ createdAt: -1 });

      sendSuccessResponse(
        res,
        requests,
        "Pending device approval requests retrieved",
      );
    } catch (error: any) {
      logger.error("Failed to get pending device requests", {
        error: error.message,
      });
      sendErrorResponse(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  };

  approveRequest = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { requestId } = req.params;
      await this.deviceTrustService.approveRequest(
        requestId,
        new Types.ObjectId(req.admin.adminId),
      );
      sendSuccessResponse(res, null, "Device request approved successfully");
    } catch (error: any) {
      logger.error("Failed to approve device request", {
        error: error.message,
      });
      sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  denyRequest = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { requestId } = req.params;
      const { blockIp, reason } = req.body;

      await this.deviceTrustService.denyRequest(
        requestId,
        new Types.ObjectId(req.admin.adminId),
        !!blockIp,
        reason,
      );

      sendSuccessResponse(res, null, "Device request denied successfully");
    } catch (error: any) {
      logger.error("Failed to deny device request", { error: error.message });
      sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getBlockedIps = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await this.deviceTrustService.getBlockedIps(page, limit);
      sendSuccessResponse(res, result, "Blocked IPs retrieved successfully");
    } catch (error: any) {
      logger.error("Failed to get blocked IPs", { error: error.message });
      sendErrorResponse(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  };

  addBlockedIp = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { cidr, reason } = req.body;
      await this.deviceTrustService.addBlockedIp(
        cidr,
        new Types.ObjectId(req.admin.adminId),
        reason,
      );
      sendSuccessResponse(res, null, "IP added to blocklist successfully");
    } catch (error: any) {
      logger.error("Failed to add blocked IP", { error: error.message });
      sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  removeBlockedIp = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const cidr = decodeURIComponent(req.params.cidr);
      await this.deviceTrustService.removeBlockedIp(cidr);
      sendSuccessResponse(res, null, "IP removed from blocklist successfully");
    } catch (error: any) {
      logger.error("Failed to remove blocked IP", { error: error.message });
      sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

 getAllTrustedDevicesAndIps = async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const { data, total } = await this.deviceTrustService.getAllTrustedDevicesAndIps(page, limit);
    
    sendPaginatedResponse(
      res,
      data,
      { total, page, limit },
      "All trusted devices and IPs retrieved successfully"
    );
  } catch (error: any) {
    logger.error("Failed to get all trusted devices and IPs", { error: error.message });
    sendErrorResponse(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
};
}
