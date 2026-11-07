import { Response, NextFunction, Request } from "express";
import { UserManagementService } from "@/services/admin/users/UserManagementService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import ServiceContainer from "@/services/client/container";
import { Admin } from "@/models/admin/Admin";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class UserManagementController {
  private userService: UserManagementService;

  constructor() {
    this.userService = AdminServiceContainer.getUserManagementService();
  }

  getTotalUsersStats = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result = await this.userService.getTotalUsersStats({
        startDate,
        endDate,
        period,
      } as any);
      return sendSuccessResponse(
        res,
        result,
        "User stats retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserChartData = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result = await this.userService.getUserChartData({
        startDate,
        endDate,
        period,
      } as any);
      return sendSuccessResponse(
        res,
        result,
        "User chart data retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserTypes = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userTypes = ["regular", "influencer", "micro-influencer", "vendor"];
      return sendSuccessResponse(
        res,
        userTypes,
        "User types retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  listUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const filters = { ...req.query };
      delete filters.page;
      delete filters.limit;

      const result = await this.userService.listUsers(page, limit, filters);

      return sendPaginatedResponse(
        res,
        result.users,
        { total: result.pagination.total, page, limit },
        "Users retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserDetails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const includeRelations = req.query.include === "relations";
      const result = await this.userService.getUserDetails(
        id,
        includeRelations,
      );
      return sendSuccessResponse(
        res,
        result,
        "User details retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updateUserStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const result = await this.userService.updateUserStatus(id, status);
      return sendSuccessResponse(
        res,
        result,
        "User status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  restrictUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const status = "inactive";
      const result = await this.userService.updateUserStatus(id, status);
      return sendSuccessResponse(res, result, "User restricted successfully");
    } catch (error) {
      next(error);
    }
  };

  suspendUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const status = "suspended";
      const result = await this.userService.updateUserStatus(id, status);
      return sendSuccessResponse(
        res,
        result,
        "User mark as fraudlent successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  markAsFraudulent = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const status = "fraudulent";
      const result = await this.userService.updateUserStatus(id, status);
      // const result = await this.userService.markUserAsFraudulent(id, reason);
      return sendSuccessResponse(
        res,
        result,
        "User marked as fraudulent successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  sendWalletActionOTP = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) {
        throw new Error("User id is required");
      }
      const { type, amount } = req.body;
      const adminId = req.admin?.adminId!;

      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError(
          "Admin not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const userDetails = await this.userService.getUserDetails(id);
      if (!userDetails || !userDetails.user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const otpService = ServiceContainer.getOTPService();
      const emailService = ServiceContainer.getEmailService();

      const otp = await otpService.generateAndStore(adminId, "wallet_transfer");
      await emailService.sendAdminWalletActionOTP(
        admin.email,
        otp,
        admin.fullName,
        type,
        amount,
        userDetails.user.email,
      );

      if (admin.adminLevel !== "super_admin") {
        const superAdmins = await Admin.find({
          adminLevel: "super_admin",
          status: "active",
        });
        for (const sa of superAdmins) {
          await emailService.sendSystemNotificationToAdmin(
            sa.email,
            `Security Notice: Wallet ${type === "credit" ? "Credit" : "Debit"} Attempt`,
            {
              severity: "warning",
              adminName: admin.fullName || admin.email,
              adminLevel: admin.adminLevel,
              action: type === "credit" ? "Credit" : "Debit",
              amount: amount,
              userEmail: userDetails.user.email,
              time: new Date().toLocaleString(),
            },
            `An administrative user (${admin.adminLevel}) is currently attempting to authorize a wallet ${type} transaction. An OTP has been sent to their email.`,
          );
        }
      }

      return sendSuccessResponse(
        res,
        null,
        "OTP code has been sent to your registered email address.",
      );
    } catch (error) {
      next(error);
    }
  };

  manageUserWalletSchema = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) {
        throw new Error("User id is required");
      }
      const adminId = req.admin?.adminId!;
      const ip = req.ip;
      const userAgent = req.get("user-agent") || "unknown";

      const { amount, type, remark, otp } = req.body;

      // Verify OTP
      const otpService = ServiceContainer.getOTPService();
      const isOtpValid = await otpService.verify(
        adminId,
        "wallet_transfer",
        otp,
      );
      if (!isOtpValid) {
        throw new AppError(
          "Invalid or expired OTP",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.BAD_REQUEST,
        );
      }

      let result;
      let message;
      if (type === "credit") {
        result = await this.userService.creditUserWallet(id, amount, remark, {
          adminId,
          ipAddress: ip,
          userAgent,
        });
        message = "User account credited successfully";
      } else if (type === "debit") {
        result = await this.userService.debitUserWallet(id, amount, remark, {
          adminId,
          ipAddress: ip,
          userAgent,
        });
        message = "User account debited successfully";
      }
      return sendSuccessResponse(res, result, message);
    } catch (error) {
      next(error);
    }
  };

  getUserServiceTransactions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;

      const result = await this.userService.getUserServiceTransactions(
        id,
        Number(page),
        Number(limit),
        filters,
      );
      return sendSuccessResponse(
        res,
        result,
        "User service transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserWalletTransactions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;

      const result = await this.userService.getUserWalletTransactions(
        id,
        Number(page),
        Number(limit),
        filters,
      );
      return sendSuccessResponse(
        res,
        result,
        "User wallet transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserBvn = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { password } = req.body;
      const adminId = req.admin?.adminId!;
      const result = await this.userService.getUserBvn(id, adminId, password);
      return sendSuccessResponse(
        res,
        result,
        "User bvn retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updateUserType = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { userType, influencerRules } = req.body;
      const result = await this.userService.updateUserType(
        id,
        userType,
        influencerRules,
      );
      return sendSuccessResponse(res, result, "User type updated successfully");
    } catch (error) {
      next(error);
    }
  };

  creditUserWallet = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { amount, remark } = req.body;
      const adminId = req.admin?.adminId!;
      const ip = req.ip;
      const userAgent = req.get("user-agent") || "unknown";
      const result = await this.userService.creditUserWallet(
        id,
        amount,
        remark,
        { adminId, ipAddress: ip, userAgent },
      );
      return sendSuccessResponse(res, result, "Wallet credited successfully");
    } catch (error) {
      next(error);
    }
  };

  debitUserWallet = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { amount, remark } = req.body;
      const adminId = req.admin?.adminId!;
      const ip = req.ip;
      const userAgent = req.get("user-agent") || "unknown";
      const result = await this.userService.debitUserWallet(
        id,
        amount,
        remark,
        {
          adminId,
          ipAddress: ip,
          userAgent,
        },
      );
      return sendSuccessResponse(res, result, "Wallet debited successfully");
    } catch (error) {
      next(error);
    }
  };

  // updateUserType = async (
  //   req: AuthenticatedAdminRequest,
  //   res: Response,
  //   next: NextFunction
  // ) => {
  //   try {
  //     const { userId } = req.params;
  //     const { userType, referralEarningRate } = req.body;

  //     // Validate
  //     if (!["regular", "influencer", "micro-influencer"].includes(userType)) {
  //       throw new AppError("Invalid user type", HTTP_STATUS.BAD_REQUEST);
  //     }

  //     // If changing to regular, cannot have earning rate
  //     if (userType === "regular" && referralEarningRate) {
  //       throw new AppError(
  //         "Regular users cannot have referral earning rate",
  //         HTTP_STATUS.BAD_REQUEST
  //       );
  //     }

  //     // Update user
  //     const updateData: any = { userType };
  //     if (userType !== "regular") {
  //       updateData.referralEarningRate = referralEarningRate || 0;
  //     }

  //     const user = await this.userRepository.updateOne(
  //       { _id: userId },
  //       updateData
  //     );

  //     return sendSuccessResponse(res, user, "User type updated successfully");
  //   } catch (error) {
  //     next(error);
  //   }
  // };

  updatePreferredProvider = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { provider } = req.body; // Can be string or null
      
      const result = await this.userService.updateUserPreferredProvider(id, provider);
      
      return sendSuccessResponse(
        res,
        result,
        "User preferred provider updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updateUserTier = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { tierCode, isTierLocked } = req.body;

      const result = await this.userService.updateUserTier(
        id,
        tierCode,
        isTierLocked !== undefined ? Boolean(isTierLocked) : true,
      );

      return sendSuccessResponse(
        res,
        result,
        "User tier updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
