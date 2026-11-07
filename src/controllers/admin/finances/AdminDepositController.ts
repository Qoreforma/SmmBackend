import { Response, NextFunction } from "express";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import { DepositManagementService } from "@/services/admin/transactions/DepositManagementService";
import ServiceContainer from "@/services/client/container";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class AdminDepositController {
  private depositService: DepositManagementService;

  constructor() {
    this.depositService = AdminServiceContainer.getDepositManagementService();
  }
  //GET /admin/deposit-requests
  //List all manual deposit requests across all users.
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

      const result = await this.depositService.listDeposits(
        Number(page),
        Number(limit),
        {
          status: status as string | undefined,
          userId: userId as string | undefined,
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        },
      );

      return sendPaginatedResponse(
        res,
        result.deposits,
        result.pagination,
        "Deposit requests retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  //GET /admin/deposit-requests/:id
  //Get a single deposit request with full details.
  getRequestById = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.depositService.getDepositDetails(id);
      return sendSuccessResponse(
        res,
        result,
        "Deposit request retrieved successfully",
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

      const deposit = await this.depositService.getDepositDetails(id);
      
      const otpService = ServiceContainer.getOTPService();
      const emailService = ServiceContainer.getEmailService();

      const otp = await otpService.generateAndStore(adminId, "finance_action");
      
      await emailService.sendAdminFinanceActionOTP(
        req.admin!.email,
        otp,
        req.admin!.fullName || req.admin!.firstName,
        "Approve", // Could be Approve or Reject, generic
        "Manual Deposit",
        deposit.amount.toString(),
        deposit.reference,
      );

      return sendSuccessResponse(res, null, "OTP sent to your email");
    } catch (error) {
      next(error);
    }
  };

  //POST /admin/deposit-requests/:id/approve
  //Approve a manual deposit — wallet is credited immediately.
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

      const result = await this.depositService.approveDeposit(id, adminId);
      return sendSuccessResponse(
        res,
        result,
        "Deposit request approved and wallet credited",
      );
    } catch (error) {
      next(error);
    }
  };

  //POST /admin/deposit-requests/:id/reject
  //Reject a manual deposit — wallet unchanged, user notified.
  //Body: { reason: string }
  rejectRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      const { reason, otp } = req.body;
      if (!adminId) throw new Error("Admin ID not found");

      const otpService = ServiceContainer.getOTPService();
      const isOtpValid = await otpService.verify(adminId, "finance_action", otp);
      if (!isOtpValid) {
        throw new AppError("Invalid or expired OTP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }

      const result = await this.depositService.declineDeposit(
        id,
        reason,
        adminId,
      );
      return sendSuccessResponse(res, result, "Deposit request rejected");
    } catch (error) {
      next(error);
    }
  };
}
