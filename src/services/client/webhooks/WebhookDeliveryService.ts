import { ITransaction, Transaction } from "@/models/wallet/Transaction";
import { Types } from "mongoose";
import logger from "@/logger";
import mongoose from "mongoose";
import { TRANSACTION_STATUS, TRANSACTION_TYPES } from "@/utils/constants";
import { generateReference } from "@/utils/helpers";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import {
  IWebhookDeliveryLog,
  WebhookDeliveryLog,
} from "@/models/admin/WebhookDeliveryLog";
import { NotificationService } from "../notifications/NotificationService";
import { WalletService } from "../wallet/WalletService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { PeriodFilter, resolveDateRange } from "@/utils/dateRange";

// Manages webhook delivery tracking and auto-refund on timeout
//
// Flow:
//  Transaction created → initiate webhook tracking (expectedArrivalBy = now + 1 hour)
//  Webhook arrives → update status to "received"
// Webhook processing → update status to "processing"
//  Webhook complete → update status to "success"
//  Timeout check job runs every 15 mins
//   - If webhook not arrived after 1 hour → auto-refund + notify customer

export class WebhookDeliveryService {
  private walletService: WalletService;
  private auditLoggingService: AuditLoggingService;
  private notificationService: NotificationService;

  constructor(
    walletService: WalletService,
    auditLoggingService: AuditLoggingService,
    notificationService: NotificationService,
  ) {
    this.walletService = walletService;
    this.auditLoggingService = auditLoggingService;
    this.notificationService = notificationService;
  }

  // Initiate webhook tracking for a transaction
  // Called when transaction is created and waiting for webhook

  async initializeWebhookTracking(data: {
    transactionId: string | Types.ObjectId;
    transactionReference: string;
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay";
    userId: string | Types.ObjectId;
    amount: number;
    timeoutMinutes?: number;
  }): Promise<IWebhookDeliveryLog> {
    const timeoutMinutes = data.timeoutMinutes || 60; // Default 1 hour
    const expectedArrivalBy = new Date(Date.now() + timeoutMinutes * 60 * 1000);

    try {
      const webhookLog = await WebhookDeliveryLog.create({
        transactionId: new Types.ObjectId(data.transactionId),
        transactionReference: data.transactionReference,
        provider: data.provider,
        status: "awaiting",
        expectedArrivalBy,
        retryCount: 0,
        refundIssued: false,
        meta: {
          userId: data.userId.toString(),
          amount: data.amount,
          initiatedAt: new Date(),
        },
      });

      logger.info(`Webhook tracking initiated: ${data.transactionReference}`, {
        provider: data.provider,
        expectedArrivalBy,
        timeoutMinutes,
      });

      return webhookLog;
    } catch (error: any) {
      logger.error(
        `Failed to initialize webhook tracking: ${data.transactionReference}`,
        error,
      );
      throw error;
    }
  }

  // Record webhook arrival
  // Called when webhook hits our endpoint
  async recordWebhookReceived(data: {
    transactionReference: string;
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay";
    webhookPayload: any;
    providerTransactionId?: string;
  }): Promise<void> {
    try {
      await WebhookDeliveryLog.findOneAndUpdate(
        {
          transactionReference: data.transactionReference,
          provider: data.provider,
        },
        {
          $set: {
            status: "received",
            receivedAt: new Date(),
            webhookPayload: data.webhookPayload,
            providerTransactionId: data.providerTransactionId,
          },
          $setOnInsert: {
            transactionReference: data.transactionReference,
            provider: data.provider,
            expectedArrivalBy: new Date(Date.now() + 60 * 60 * 1000),
            retryCount: 0,
            refundIssued: false,
            meta: {
              source: "inbound_webhook",
              providerTransactionId: data.providerTransactionId,
            },
          },
        },
        {
          upsert: true, // create if not found
          new: true,
        },
      );

      logger.info(`Webhook received: ${data.transactionReference}`, {
        provider: data.provider,
      });
    } catch (error: any) {
      logger.error(
        `Failed to record webhook received: ${data.transactionReference}`,
        error,
      );
    }
  }

  // Record webhook processing started
  async recordWebhookProcessingStarted(data: {
    transactionReference: string;
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay";
  }): Promise<void> {
    try {
      await WebhookDeliveryLog.findOneAndUpdate(
        {
          transactionReference: data.transactionReference,
          provider: data.provider,
        },
        {
          status: "processing",
          processingStartedAt: new Date(),
        },
      );
    } catch (error: any) {
      logger.error(
        `Failed to record webhook processing started: ${data.transactionReference}`,
        error,
      );
    }
  }

  // Record webhook processing completed successfully
  async recordWebhookProcessingSuccess(data: {
    transactionReference: string;
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay";
  }): Promise<void> {
    try {
      await WebhookDeliveryLog.findOneAndUpdate(
        {
          transactionReference: data.transactionReference,
          provider: data.provider,
        },
        {
          status: "success",
          processingCompletedAt: new Date(),
        },
      );

      logger.info(
        `Webhook processing completed: ${data.transactionReference}`,
        {
          provider: data.provider,
        },
      );
    } catch (error: any) {
      logger.error(
        `Failed to record webhook processing success: ${data.transactionReference}`,
        error,
      );
    }
  }

  // Record webhook processing failed
  async recordWebhookProcessingFailed(data: {
    transactionReference: string;
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay";
    error: string;
  }): Promise<void> {
    try {
      await WebhookDeliveryLog.findOneAndUpdate(
        {
          transactionReference: data.transactionReference,
          provider: data.provider,
        },
        {
          status: "failed",
          processingCompletedAt: new Date(),
          processingError: data.error,
        },
      );

      logger.error(`Webhook processing failed: ${data.transactionReference}`, {
        provider: data.provider,
        error: data.error,
      });
    } catch (error: any) {
      logger.error(
        `Failed to record webhook processing failed: ${data.transactionReference}`,
        error,
      );
    }
  }

  async checkAndRefundTimeoutWebhooks(): Promise<{
    checkedCount: number;
    refundedCount: number;
    errorCount: number;
  }> {
    let checkedCount = 0;
    let refundedCount = 0;
    let errorCount = 0;

    try {
      const now = new Date();

      // Find webhooks that timed out but haven't been refunded
      const timedOutWebhooks = await WebhookDeliveryLog.find({
        status: { $in: ["awaiting", "received", "processing"] },
        expectedArrivalBy: { $lt: now },
        refundIssued: false,
      });

      logger.info(
        `Checking ${timedOutWebhooks.length} potentially timed-out webhooks`,
      );

      for (const webhookLog of timedOutWebhooks) {
        checkedCount++;

        const FINAL_TRANSACTION_STATUSES: ITransaction["status"][] = [
          TRANSACTION_STATUS.SUCCESS,
          TRANSACTION_STATUS.FAILED,
          TRANSACTION_STATUS.REVERSED,
        ];

        try {
          // Get the transaction
          const transaction = await Transaction.findById(
            webhookLog.transactionId,
          );
          if (!transaction) {
            logger.warn(
              `Transaction not found for webhook: ${webhookLog.transactionReference}`,
            );
            continue;
          }

          // Check if already completed (success, failed, reversed)
          if (FINAL_TRANSACTION_STATUSES.includes(transaction.status)) {
            // Transaction already completed, no refund needed
            logger.info(
              `Transaction already completed, skipping refund: ${webhookLog.transactionReference}`,
              {
                status: transaction.status,
              },
            );

            // Mark webhook as completed anyway
            await WebhookDeliveryLog.findByIdAndUpdate(webhookLog._id, {
              status: "success", // Mark as resolved
            });

            continue;
          }

          // Refund the user
          await this.refundTransactionForMissingWebhook(
            transaction,
            webhookLog,
          );
          refundedCount++;
        } catch (error: any) {
          errorCount++;
          logger.error(
            `Failed to process timeout refund: ${webhookLog.transactionReference}`,
            error,
          );
        }
      }

      logger.info(`Webhook timeout check completed`, {
        checkedCount,
        refundedCount,
        errorCount,
      });

      return { checkedCount, refundedCount, errorCount };
    } catch (error: any) {
      logger.error("Webhook timeout check failed", error);
      throw error;
    }
  }

  // Refund transaction for missing/timed-out webhook
  private async refundTransactionForMissingWebhook(
    transaction: any,
    webhookLog: IWebhookDeliveryLog,
  ): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = transaction.sourceId || transaction.userId;
      const amount = transaction.amount;
      const chargeAmount = transaction.meta?.chargeInfo?.serviceCharge || 0;
      const totalRefund = amount + chargeAmount;

      logger.info(`Refunding for missing webhook: ${transaction.reference}`, {
        userId: userId.toString(),
        amount: totalRefund,
        provider: webhookLog.provider,
      });

      // Issue refund via WalletService
      const refundResult = await this.walletService.creditWallet(
        userId.toString(),
        totalRefund,
        `${transaction.type}`,
        {
          type: "refund",
          provider: webhookLog.provider,
          idempotencyKey: `${transaction.reference}_webhook_timeout_refund`,
          initiatedByType: "system",
          linkedTransactionId: transaction._id as Types.ObjectId, // ← added
          remark: `Refund: ${transaction.type} failed - webhook timeout`,
          meta: {
            originalTransactionReference: transaction.reference,
            reason: "webhook_timeout",
            webhookProvider: webhookLog.provider,
          },
        },
      );

      // Update transaction status to failed
      await Transaction.findByIdAndUpdate(
        transaction._id,
        {
          meta: {
            ...transaction.meta,
            webhookTimeout: true,
            timedOutAt: new Date().toISOString(),
            refundedAt: new Date().toISOString(),
          },
        },
        { session },
      );

      // Mark webhook as refunded
      await WebhookDeliveryLog.findByIdAndUpdate(
        webhookLog._id,
        {
          refundIssued: true,
          refundedAt: new Date(),
          refundTransactionId: refundResult.transaction._id,
          refundReason: "webhook_timeout",
          status: "timeout",
        },
        { session },
      );

      // Log audit trail
      await this.auditLoggingService.logTransactionEvent({
        userId,
        transactionId: transaction._id.toString(),
        transactionReference: transaction.reference,
        action: "refunded",
        amount: totalRefund,
        reason: "webhook_timeout",
        provider: webhookLog.provider,
        initiatedBy: "system",
      });

      await session.commitTransaction();

      // Send notification to user (outside transaction)
      await this.notificationService
        .createNotification({
          type: "transaction_timeout_refunded",
          notifiableType: "User",
          notifiableId: userId,
          data: {
            transactionType: this.getTransactionTypeLabel(transaction.type),
            amount: totalRefund,
            reference: transaction.reference,
            reason: "Webhook timeout - your funds have been refunded",
          },
          sendEmail: true,
          sendSMS: true,
          sendPush: true,
        })
        .catch((err: any) => {
          logger.error(
            `Failed to send webhook timeout notification: ${transaction.reference}`,
            err,
          );
        });

      logger.info(
        `Webhook timeout refund completed: ${transaction.reference}`,
        {
          userId: userId.toString(),
          refundedAmount: totalRefund,
        },
      );
    } catch (error: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      logger.error(
        `Critical: Failed to refund for missing webhook: ${transaction.reference}`,
        error,
      );
      SentryHelper.captureBusinessError(
        "WEBHOOK_TIMEOUT_REFUND_FAILED",
        `Critical: Failed to refund webhook timeout for ${transaction.reference}`,
        transaction.sourceId?.toString(),
        {
          reference: transaction.reference,
          provider: webhookLog.provider,
          amount: transaction.amount,
        },
      );
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getWebhookStatus(
    transactionReference: string,
  ): Promise<IWebhookDeliveryLog | null> {
    return await WebhookDeliveryLog.findOne({ transactionReference });
  }

  async getPendingWebhooks(
    limit: number = 100,
  ): Promise<IWebhookDeliveryLog[]> {
    return await WebhookDeliveryLog.find({
      status: { $in: ["awaiting", "received", "processing"] },
    })
      .limit(limit)
      .sort({ createdAt: -1 });
  }

  async getWebhookStats(filters: PeriodFilter = {}): Promise<any> {
    const dateRange = resolveDateRange(filters);
    const match = dateRange ? { createdAt: dateRange } : {};

    const stats = await WebhookDeliveryLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const refundStats = await WebhookDeliveryLog.countDocuments({
      ...match,
      refundIssued: true,
    });

    return {
      byStatus: stats.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      totalRefunded: refundStats,
    };
  }

  private getTransactionTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      [TRANSACTION_TYPES.SMM]: "SMM Order",
      [TRANSACTION_TYPES.GAME_TOPUP]: "Game Top-Up",
      [TRANSACTION_TYPES.NUMBER_RENTAL]: "Number Rental",
      [TRANSACTION_TYPES.PROXY]: "Proxy Purchase",
      [TRANSACTION_TYPES.DEPOSIT]: "Wallet Funding",
      [TRANSACTION_TYPES.WITHDRAWAL]: "Withdrawal",
    };

    return labels[type] || type;
  }
}
