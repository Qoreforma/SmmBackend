import { Types } from "mongoose";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletService } from "@/services/client/wallet/WalletService";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_STATUS,
} from "@/utils/constants";
import { Transaction } from "@/models/wallet/Transaction";
import logger from "@/logger";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import SocketService from "@/services/core/SocketService";

export class ManualWithdrawalService {
  constructor(
    private manualWithdrawalRepository: ManualWithdrawalRepository,
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
  ) {}

  // Used by TransactionManagementService to detect whether a pending
  // withdrawal transaction has already been escalated to manual fallback,
  // so the generic status-update endpoint can delegate to this service's
  // approve/reject flow instead of doing a raw status flip.
  async getRequestByTransactionId(transactionId: Types.ObjectId) {
    return this.manualWithdrawalRepository.findByTransactionId(transactionId);
  }

  async getRequests(
    filters: {
      status?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
    page: number = 1,
    limit: number = 20,
  ) {
    const { data, total } =
      await this.manualWithdrawalRepository.findWithFilters(
        filters,
        page,
        limit,
      );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Get a single manual withdrawal request by ID.
  async getRequestById(requestId: string) {
    const request = await this.manualWithdrawalRepository.findById(requestId);
    if (!request) {
      throw new AppError(
        "Manual withdrawal request not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return request;
  }

  // Admin approves a manual withdrawal.
  // Funds are already debited. Admin has manually sent the money.
  // We just mark the transaction as successful.
  async approveRequest(requestId: string, adminId: string) {
    const existing = await this.manualWithdrawalRepository.findById(requestId);
    if (!existing) {
      throw new AppError(
        "Manual withdrawal request not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const details =
      await this.manualWithdrawalRepository.findOneAndUpdateStatusFromPending(
        requestId,
        {
          status: "approved",
          processedBy: new Types.ObjectId(adminId),
          processedAt: new Date(),
        },
      );

    if (!details) {
      const current = await this.manualWithdrawalRepository.findById(requestId);
      throw new AppError(
        `Cannot approve a request with status: ${current?.status ?? "unknown"}`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const request = details;

    // Mark the original transaction as success
    await Transaction.findByIdAndUpdate(request.transactionId, {
      status: TRANSACTION_STATUS.SUCCESS,
      approvalStatus: "approved",
      approvedBy: new Types.ObjectId(adminId),
      approvedAt: new Date(),
      "meta.phase": "manual_approved",
      "meta.approvedAt": new Date().toISOString(),
      "meta.approvedBy": adminId,
    });

    this.transactionRepository.findById(request.transactionId.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(request.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    // Notify user
    this.notificationService
      .createNotification({
        type: "withdrawal_approved",
        notifiableType: "User",
        notifiableId: request.userId,
        title: "Withdrawal Approved",
        message: `Your withdrawal of ₦${request.amount.toLocaleString()} to ${
          request.accountNumber
        } (${request.bankName}) has been processed successfully. Reference: ${
          request.reference
        }`,
        data: {
          amount: request.amount,
          reference: request.reference,
          accountNumber: request.accountNumber,
          bankName: request.bankName,
          status: "approved",
        },
        sendEmail: true,
        sendPush: true,
      })
      .catch((err: any) =>
        logger.error(
          `Failed to send manual withdrawal approval notification: ${request.reference}`,
          err.message,
        ),
      );

    logger.info(
      `Manual withdrawal approved: ${request.reference} by admin: ${adminId}`,
    );

    return { message: "Withdrawal approved successfully", details };
  }

  // Admin rejects a manual withdrawal.
  // Funds are still debited — we reverse them back to the user's wallet.
  async rejectRequest(requestId: string, adminId: string, reason: string) {
    const existing = await this.manualWithdrawalRepository.findById(requestId);
    if (!existing) {
      throw new AppError(
        "Manual withdrawal request not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const details =
      await this.manualWithdrawalRepository.findOneAndUpdateStatusFromPending(
        requestId,
        {
          status: "rejected",
          rejectionReason: reason,
          processedBy: new Types.ObjectId(adminId),
          processedAt: new Date(),
        },
      );

    if (!details) {
      const current = await this.manualWithdrawalRepository.findById(requestId);
      throw new AppError(
        `Cannot reject a request with status: ${current?.status ?? "unknown"}`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const request = details;

    // Mark the original transaction as failed
    await Transaction.findByIdAndUpdate(request.transactionId, {
      status: TRANSACTION_STATUS.FAILED,
      approvalStatus: "declined",
      declinedBy: new Types.ObjectId(adminId),
      declinedAt: new Date(),
      declineReason: reason,
      "meta.phase": "manual_rejected",
      "meta.rejectedAt": new Date().toISOString(),
      "meta.rejectedBy": adminId,
      "meta.rejectionReason": reason,
    });

    this.transactionRepository.findById(request.transactionId.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(request.reference, { status: "failed", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    // Reverse funds back to user wallet
    await this.walletService.creditWallet(
      request.userId.toString(),
      request.totalDeduction,
      "Withdrawal refund",
      {
        type: "refund",
        provider: "system",
        idempotencyKey: `${request.reference}_manual_refund`,
        initiatedByType: "admin",
        initiatedBy: new Types.ObjectId(adminId),
        linkedTransactionId: request.transactionId,
        meta: {
          originalReference: request.reference,
          reason: "manual_withdrawal_rejected",
          rejectionReason: reason,
          accountNumber: request.accountNumber,
          accountName: request.accountName,
          bankName: request.bankName,
        },
        remark: "Withdrawal refund - manual request rejected",
      },
    );

    // Notify user
    const refundMessage =
      request.chargeAmount > 0
        ? `Your withdrawal of ₦${request.amount.toLocaleString()} to ${
            request.accountNumber
          } (${
            request.bankName
          }) was rejected. ₦${request.totalDeduction.toLocaleString()} (including ₦${request.chargeAmount.toLocaleString()} service charge) has been refunded to your wallet. Reason: ${reason}. Reference: ${
            request.reference
          }`
        : `Your withdrawal of ₦${request.amount.toLocaleString()} to ${
            request.accountNumber
          } (${
            request.bankName
          }) was rejected. The amount has been refunded to your wallet. Reason: ${reason}. Reference: ${request.reference}`;

    this.notificationService
      .createNotification({
        type: "withdrawal_rejected",
        notifiableType: "User",
        notifiableId: request.userId,
        title: "Withdrawal Rejected & Refunded",
        message: refundMessage,
        data: {
          amount: request.amount,
          totalRefunded: request.totalDeduction,
          chargeAmount: request.chargeAmount,
          reference: request.reference,
          accountNumber: request.accountNumber,
          bankName: request.bankName,
          reason,
        },
        sendEmail: true,
        sendPush: true,
      })
      .catch((err: any) =>
        logger.error(
          `Failed to send manual withdrawal rejection notification: ${request.reference}`,
          err.message,
        ),
      );

    logger.info(
      `Manual withdrawal rejected: ${request.reference} by admin: ${adminId} | Reason: ${reason}`,
    );

    return { message: "Withdrawal rejected and funds refunded", details };
  }
}
