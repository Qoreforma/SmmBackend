import { Response, NextFunction } from "express";
import { sendSuccessResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ManualWithdrawalService } from "@/services/admin/finances/Manualwithdrawalservice";
import AdminServiceContainer from "@/services/admin/container";
import ServiceContainer from "@/services/client/container";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class ManualWithdrawalController {
  private manualWithdrawalService: ManualWithdrawalService;
  constructor() {
    this.manualWithdrawalService = AdminServiceContainer.getManualWithdrawalService();
  }

  // List all manual withdrawal requests with optional filters.
  getRequests = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        status,
        userId,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const result = await this.manualWithdrawalService.getRequests(
        {
          status: status as string | undefined,
          userId: userId as string | undefined,
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        },
        Number(page),
        Number(limit),
      );

      return sendSuccessResponse(
        res,
        result,
        "Manual withdrawal requests retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get a single manual withdrawal request.

  getRequestById = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.manualWithdrawalService.getRequestById(id);
      return sendSuccessResponse(
        res,
        result,
        "Manual withdrawal request retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  sendOTP = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const request = await this.manualWithdrawalService.getRequestById(id);
      
      const otpService = ServiceContainer.getOTPService();
      const emailService = ServiceContainer.getEmailService();

      const otp = await otpService.generateAndStore(adminId, "finance_action");
      
      await emailService.sendAdminFinanceActionOTP(
        req.admin!.email,
        otp,
        req.admin!.fullName || req.admin!.firstName,
        "Approve",
        "Manual Withdrawal",
        request.amount.toString(),
        request.reference || id,
      );

      return sendSuccessResponse(res, null, "OTP sent to your email");
    } catch (error) {
      next(error);
    }
  };

  // Admin has manually sent the money — mark as approved.

  approveRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      const { otp } = req.body;
      if (!adminId) throw new Error("Admin ID not found");

      const otpService = ServiceContainer.getOTPService();
      const isOtpValid = await otpService.verify(adminId, "finance_action", otp);
      if (!isOtpValid) {
        throw new AppError("Invalid or expired OTP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await this.manualWithdrawalService.approveRequest(
        id,
        adminId,
      );
      return sendSuccessResponse(
        res,
        result,
        "Withdrawal approved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Admin rejects the request — funds are reversed back to user.

  rejectRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { reason, otp } = req.body;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const otpService = ServiceContainer.getOTPService();
      const isOtpValid = await otpService.verify(adminId, "finance_action", otp);
      if (!isOtpValid) {
        throw new AppError("Invalid or expired OTP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await this.manualWithdrawalService.rejectRequest(
        id,
        adminId,
        reason,
      );
      return sendSuccessResponse(
        res,
        result,
        "Withdrawal rejected and funds refunded",
      );
    } catch (error) {
      next(error);
    }
  };
}
