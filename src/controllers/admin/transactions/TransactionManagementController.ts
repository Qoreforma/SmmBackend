import { Request, Response } from "express";
import { TransactionManagementService } from "@/services/admin/transactions/TransactionManagementService";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendPaginatedResponse,
} from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";
import ServiceContainer from "@/services/client/container";
import { AppError } from "@/middlewares/shared/errorHandler";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { WalletService } from "@/services/client/wallet/WalletService";
import { StatsPeriod } from "@/utils/dateRange";

export class TransactionManagementController {
  private transactionService: TransactionManagementService;
  private walletService: WalletService;
  constructor() {
    this.transactionService =
      AdminServiceContainer.getTransactionManagementService();
    this.walletService = ServiceContainer.getWalletService();
  }

  // GENERAL TRANSACTIONS
  getTransactionChartData = async (req: Request, res: Response) => {
    try {
      const filters: any = { ...req.query };
      if (req.params.serviceType && req.params.serviceType !== "chart") {
        filters.type = req.params.serviceType;
      }
      if (!filters.type && (req.baseUrl?.includes("/services") || req.path?.includes("/services"))) {
        filters.isServiceOnly = true;
      }
      const result = await this.transactionService.getTransactionChartData(filters);
      return sendSuccessResponse(
        res,
        result,
        "Transaction chart data retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };


  listTransactions = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.transactionService.listTransactions(
        Number(page),
        Number(limit),
        filters,
      );
      return sendPaginatedResponse(
        res,
        result.transactions,
        result.pagination,
        "Transactions retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getTransactionDetails = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.transactionService.getTransactionDetails(id);
      return sendSuccessResponse(
        res,
        result,
        "Transaction details retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

  sendOTP = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const transaction =
        await this.transactionService.getTransactionDetails(id);

      const otpService = ServiceContainer.getOTPService();
      const emailService = ServiceContainer.getEmailService();

      const otp = await otpService.generateAndStore(adminId, "finance_action");

      await emailService.sendAdminFinanceActionOTP(
        req.admin!.email,
        otp,
        req.admin!.fullName || req.admin!.firstName,
        "Approve",
        "Transaction Status Update",
        transaction.amount.toString(),
        transaction.reference,
      );

      return sendSuccessResponse(res, null, "OTP sent to your email");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  updateTransactionStatus = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ) => {
    try {
      const { id, status } = req.params;
      const { note, otp } = req.body;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const transaction =
        await this.transactionService.getTransactionDetails(id);
      const isManualDeposit =
        transaction.transactableType === "DepositRequest" &&
        transaction.type === "deposit";
      const isManualWithdrawal =
        transaction.type === "withdrawal" && transaction.direction === "DEBIT"; // Approximation, service handles deeper check

      if (isManualDeposit || isManualWithdrawal) {
        if (!otp) {
          throw new AppError(
            "OTP is required for manual deposit/withdrawal status updates",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
        const otpService = ServiceContainer.getOTPService();
        const isOtpValid = await otpService.verify(
          adminId,
          "finance_action",
          otp,
        );
        if (!isOtpValid) {
          throw new AppError(
            "Invalid or expired OTP",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      const result = await this.transactionService.updateTransactionStatus(
        id,
        status,
        note,
        adminId,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  reverseTransaction = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.admin?.adminId;

      if (!reason?.trim()) {
        return sendErrorResponse(res, "Reversal reason is required", 400);
      }

      if (!id) {
        return sendErrorResponse(res, "Transaction ID is required", 400);
      }

      const result = await this.transactionService.reverseTransaction(
        id,
        adminId,
        reason.trim(),
      );
      return sendSuccessResponse(
        res,
        result,
        "Transaction reversed successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message || "Failed to reverse transaction",
        HTTP_STATUS.BAD_REQUEST,
      );
    }
  };

  // SERVICE TRANSACTIONS
  getServiceTransactionsOverview = async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result =
        await this.transactionService.getServiceTransactionsOverview({
          startDate,
          endDate,
          period: period as StatsPeriod,
        });
      return sendSuccessResponse(
        res,
        result,
        "Service transactions overview retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  listServiceTransactions = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.transactionService.listServiceTransactions(
        Number(page),
        Number(limit),
        filters,
      );
      return sendSuccessResponse(
        res,
        result,
        "Service transactions retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getSpecificServiceTransactions = async (req: Request, res: Response) => {
    try {
      const { serviceType } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;
      const result =
        await this.transactionService.getSpecificServiceTransactions(
          serviceType,
          Number(page),
          Number(limit),
          filters,
        );
      return sendSuccessResponse(
        res,
        result,
        `${serviceType} transactions retrieved successfully`,
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  // WALLET TRANSACTIONS
  getWalletTransactionsOverview = async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result =
        await this.transactionService.getWalletTransactionsOverview({
          startDate,
          endDate,
          period: period as StatsPeriod,
        });
      return sendSuccessResponse(
        res,
        result,
        "Wallet transactions overview retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  listWalletTransactions = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.transactionService.listWalletTransactions(
        Number(page),
        Number(limit),
        filters,
      );
      return sendSuccessResponse(
        res,
        result,
        "Wallet transactions retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getSpecificWalletTransactions = async (req: Request, res: Response) => {
    try {
      const { walletType } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;
      const result =
        await this.transactionService.getSpecificWalletTransactions(
          walletType,
          Number(page),
          Number(limit),
          filters,
        );
      return sendSuccessResponse(
        res,
        result,
        `${walletType} transactions retrieved successfully`,
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  // UTILITY ENDPOINTS
  getFailedTransactions = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await this.transactionService.getFailedTransactions(
        Number(page),
        Number(limit),
      );
      return sendPaginatedResponse(
        res,
        result.transactions,
        result.pagination,
        "Failed transactions retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getPendingTransactions = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await this.transactionService.getPendingTransactions(
        Number(page),
        Number(limit),
      );
      return sendPaginatedResponse(
        res,
        result.transactions,
        result.pagination,
        "Pending transactions retrieved successfully",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  retryFailedTransaction = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.transactionService.retryFailedTransaction(id);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  bulkUpdateTransactions = async (
    req: AuthenticatedAdminRequest,
    res: Response,
  ) => {
    try {
      const { transactionIds, status, note } = req.body;
      const adminId = req.admin?.adminId;

      if (!transactionIds || !Array.isArray(transactionIds)) {
        return sendErrorResponse(
          res,
          "Transaction IDs array is required",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!status) {
        return sendErrorResponse(
          res,
          "Status is required",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const result = await this.transactionService.bulkUpdateTransactions(
        transactionIds,
        status,
        note,
        adminId,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  exportTransactions = async (req: Request, res: Response) => {
    try {
      const filters = req.query;
      const transactions =
        await this.transactionService.exportTransactions(filters);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=transactions-${Date.now()}.csv`,
      );

      const headers = [
        "Reference",
        "Type",
        "Amount",
        "Status",
        "Provider",
        "User",
        "Created At",
      ];
      let csv = headers.join(",") + "\n";

      transactions.forEach((txn: any) => {
        csv += [
          txn.reference,
          txn.type,
          txn.amount,
          txn.status,
          txn.provider || "N/A",
          txn.sourceId?.toString() || "N/A",
          new Date(txn.createdAt).toISOString(),
        ].join(",");
        csv += "\n";
      });

      return res.send(csv);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  // -------------------------------------------------------------------------
  // SMM Admin Actions
  // -------------------------------------------------------------------------

  smmRefillOrder = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const result = await this.transactionService.smmRefillOrder(id, adminId);
      return sendSuccessResponse(res, result, "SMM refill request submitted");
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
      );
    }
  };

  smmGetRefillStatus = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id, refillId } = req.params;
      const result = await this.transactionService.smmGetRefillStatus(id, refillId);
      return sendSuccessResponse(res, result, "SMM refill status retrieved");
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
      );
    }
  };

  smmGetProofs = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.transactionService.smmGetProofs(id);
      return sendSuccessResponse(res, result, "SMM proofs retrieved");
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
      );
    }
  };

  smmCancelOrder = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      if (!adminId) throw new Error("Admin ID not found");

      const result = await this.transactionService.smmCancelOrder(id, adminId);
      return sendSuccessResponse(res, result, "SMM cancel request submitted");
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
      );
    }
  };
}

