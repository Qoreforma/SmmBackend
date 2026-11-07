import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { WalletService } from "./client/wallet/WalletService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";
import ServiceContainer from "./client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

export interface WebhookProcessResult {
  reference: string;
  providerReference: string;
  status: "success" | "pending" | "failed" | "reversed";
  metadata?: any;
  token?: string;
  providerTransactionId?: string;
}

// UNIFIED WEBHOOK SERVICE
// Handles common webhook logic for ALL providers:
// - Transaction lookup
// - Profit calculation and persistence
// - Status updates
// - Wallet refunds
// - User notifications
// - Idempotency checks
export class WebhookService {
  private transactionRepository: TransactionRepository;
  private walletService: WalletService;
  private notificationRepository: NotificationRepository;

  constructor() {
    this.transactionRepository = new TransactionRepository();
    this.walletService = ServiceContainer.getWalletService();
    this.notificationRepository = new NotificationRepository();
  }

  // PROFIT CALCULATION HELPER
  // Called here for webhook-confirmed success where the provider response
  // arrives via webhook confirmation.

  private calculateProfit(params: {
    chargeInfo: any;
    providerName: string;
    commission?: number;
    convenienceFee?: number;
    transaction?: any;
    metadata?: any;
  }): { profit: number; providerCharge?: number } {
    const {
      chargeInfo,
      providerName,
      commission = 0,
      convenienceFee = 0,
      transaction,
      metadata,
    } = params;

    if (!chargeInfo) {
      logger.warn("WebhookService.calculateProfit: no chargeInfo, profit = 0");
      return { profit: 0 };
    }

    // 1. Service charge — always present
    const serviceCharge: number = chargeInfo.serviceCharge ?? 0;

    // 3. Provider net — VTPass only for webhooks
    //    (ClubKonnect uses polling, not webhooks)
    let providerNet = 0;
    let providerCharge: number | undefined;
    const provider = (providerName ?? "").toLowerCase();

    if (provider === "savehaven" || provider === "safehaven") {
      providerCharge = chargeInfo?.baseAmount ?? 0;
      providerNet = 0;
    }

    // General fallback: if providerCharge is still undefined, extract from metadata or providerResponse
    if (providerCharge === undefined) {
      const fallbackCost =
        metadata?.total_amount ??
        metadata?.amountcharged ??
        metadata?.amount_charged ??
        metadata?.amount ??
        transaction?.meta?.providerResponse?.data?.total_amount ??
        transaction?.meta?.providerResponse?.data?.amountcharged;

      if (fallbackCost != null) {
        const cost = parseFloat(String(fallbackCost));
        if (!isNaN(cost) && cost > 0) {
          providerNet = (chargeInfo?.baseAmount ?? 0) - cost;
          providerCharge = cost;
        }
      }
    }

    const amountSaved: number = chargeInfo.amountSaved ?? 0;

    const profit = serviceCharge + providerNet - amountSaved;

    logger.info("WebhookService.calculateProfit result", {
      providerName,
      serviceCharge,
      providerNet,
      providerCharge,
      amountSaved,
      commission,
      convenienceFee,
      profit,
    });

    return { profit, providerCharge };
  }

  // MAIN WEBHOOK PROCESSING METHOD
  // Called by all provider processors after they parse the payload.

  async processWebhook(
    providerName: string,
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerReference, status, metadata, token } =
      webhookData;

    try {
      logger.info(`${providerName} webhook processing started`, {
        reference,
        providerReference,
        status,
      });

      // 1. Find the transaction
      const transaction = await this.findTransaction(reference);

      // 2. Check idempotency (prevent duplicate processing)
      if (this.isAlreadyProcessed(transaction, status)) {
        logger.info(`${providerName} webhook already processed, skipping`, {
          reference,
          currentStatus: transaction.status,
          webhookStatus: status,
        });
        return;
      }

      // 3. Process based on status
      switch (status) {
        case "success":
          await this.handleSuccessfulTransaction(
            transaction,
            providerReference,
            metadata,
            token,
            providerName,
          );
          break;

        case "reversed":
          await this.handleReversedTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        case "failed":
          await this.handleFailedTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        case "pending":
          await this.handlePendingTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        default:
          logger.warn(`${providerName} unknown status received`, {
            reference,
            status,
          });
      }

      logger.info(`${providerName} webhook processed successfully`, {
        reference,
        status,
      });
    } catch (error) {
      logger.error(`${providerName} webhook processing error`, {
        reference,
        error,
      });
      throw error;
    }
  }

  // FIND TRANSACTION

  private async findTransaction(reference: string): Promise<any> {
    let transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      // Fallback search across provider order IDs, metadata references, and request IDs
      transaction = await this.transactionRepository
        .find({
          $or: [
            { reference },
            { "polling.providerOrderId": reference },
            { "meta.providerOrderId": reference },
            { "meta.providerReference": reference },
            { "meta.providerResponse.request-id": reference },
            { "meta.providerResponse.request_id": reference },
            { "meta.providerResponse.transid": reference },
            { "meta.providerResponse.data.transaction_id": reference },
          ],
        })
        .then((txs) => txs[0] || null)
        .catch(() => null);
    }

    if (!transaction) {
      logger.error("Transaction not found for webhook", { reference });
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    return transaction;
  }

  // IDEMPOTENCY CHECK

  private isAlreadyProcessed(transaction: any, newStatus: string): boolean {
    const finalStatuses = ["success", "reversed"];
    if (finalStatuses.includes(transaction.status)) {
      return true;
    }
    if (transaction.status === newStatus) {
      return true;
    }
    return false;
  }

  // HANDLE SUCCESSFUL TRANSACTION
  // Calculates profit and persists it alongside the status update.

  private async handleSuccessfulTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    token: string | undefined,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing successful transaction via webhook", {
      reference: transaction.reference,
      providerReference,
      providerName,
    });

    // Calculate profit using chargeInfo stored at debit time
    // and commission/convenienceFee from the webhook metadata
    // after:
    const chargeInfo = transaction.meta?.chargeInfo;
    const { profit, providerCharge } = this.calculateProfit({
      chargeInfo,
      providerName,
      commission: metadata?.commission,
      convenienceFee: metadata?.convenienceFee,
      transaction,
      metadata,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "success",
      providerReference,
      profit, // <-- persisted here
      meta: {
        ...transaction.meta,
        // Merge, don't replace — the initial purchase call (pending, while
        // waiting on this webhook) already stored a providerResponse; keep
        // it and layer this webhook's metadata + totalProviderCharge on top
        // instead of wiping it out.
        providerResponse: {
          ...transaction.meta?.providerResponse,
          ...metadata,
          processedAt: new Date(),
          provider: providerName,
          ...(providerCharge !== undefined && { totalProviderCharge: providerCharge }),
        },
        providerResponseAt: new Date(),
        token,
      },
    });

    // Award pending cashback if applicable
    if (
      transaction.meta?.cashbackInfo &&
      !transaction.meta.cashbackInfo.credited &&
      transaction.meta.cashbackInfo.amount > 0
    ) {
      const cashbackAmount = transaction.meta.cashbackInfo.amount;
      const serviceName =
        transaction.meta.serviceName ||
        transaction.meta.cashbackInfo.serviceName ||
        "bill";
      const userId = (
        transaction.sourceId || transaction.userId
      )?.toString();

      if (userId) {
        await this.walletService
          .creditBonus(
            userId,
            cashbackAmount,
            `Cashback earned from ${serviceName} purchase`,
            {
              type: "cashback_earned",
              provider: serviceName,
              meta: {
                earningTransactionId:
                  transaction._id?.toString() || transaction.id,
              },
              initiatedBy: new Types.ObjectId(userId),
            },
          )
          .then(async () => {
            await this.transactionRepository
              .update(transaction.id, {
                "meta.cashbackInfo.credited": true,
                "meta.cashbackInfo.creditedAt": new Date(),
              })
              .catch((err) =>
                logger.error(
                  "Failed to mark cashback as credited in webhook",
                  err,
                ),
              );
            logger.info(
              `[Webhook] Credited ₦${cashbackAmount} cashback to user ${userId} for transaction ${transaction.reference}`,
            );
          })
          .catch((e) =>
            logger.error("Failed to credit cashback on webhook success", e),
          );
      }
    }

    logger.info("Profit set on webhook success", {
      reference: transaction.reference,
      profit,
      providerName,
    });


    await this.sendNotification(transaction.sourceId, "transaction_success", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      token: token || null,
      ...metadata,
    });

    logger.info("Transaction marked as successful via webhook", {
      reference: transaction.reference,
      providerReference,
    });
  }

  // HANDLE REVERSED TRANSACTION

  private async handleReversedTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing reversed transaction", {
      reference: transaction.reference,
      providerReference,
      amount: transaction.amount,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "reversed",
      providerReference,
      profit: 0, // reversed = no profit
      meta: {
        ...transaction.meta,
        providerResponse: {
          ...metadata,
          reversedAt: new Date(),
          provider: providerName,
        },
        providerResponseAt: new Date(),
      },
    });

    // Refund the full debited amount (totalAmount, not just base amount)
    const refundAmount =
      transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

    await this.refundWallet(
      transaction.sourceId.toString(),
      refundAmount,
      "REFUND",
      `Transaction reversed - ${transaction.reference}`,
      transaction.reference,
      new Types.ObjectId(transaction.id),
    );

    await this.sendNotification(transaction.sourceId, "transaction_reversed", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      reason: metadata?.reason || "Transaction reversed by provider",
    });

    // Notify Super Admins of the webhook reversal (fire and forget)
    try {
      const notificationService = ServiceContainer.getNotificationService();
      notificationService
        .notifySuperAdminsOfReversal({
          transaction: {
            ...transaction,
            amount: refundAmount,
            provider: providerName || transaction.provider,
          },
          reason:
            metadata?.reason ||
            metadata?.responseMessage ||
            metadata?.message ||
            `Transaction reversed by provider (${providerName || "Provider"})`,
          providerResponse: metadata,
          source: "webhook",
        })
        .catch((err: any) =>
          logger.error("Failed to notify super admins of webhook reversal", err),
        );
    } catch (notifyErr: any) {
      logger.error("Could not dispatch super admin reversal notification", notifyErr);
    }

    logger.info("Transaction reversed and refunded", {
      reference: transaction.reference,
      providerReference,
      refundedAmount: refundAmount,
    });
  }

  // HANDLE FAILED TRANSACTION

  private async handleFailedTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing failed transaction", {
      reference: transaction.reference,
      providerReference,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "failed",
      providerReference,
      profit: 0, // failed = no profit
      meta: {
        ...transaction.meta,
        providerResponse: {
          ...metadata,
          failedAt: new Date(),
          provider: providerName,
        },
        providerResponseAt: new Date(),
      },
    });

    // Only refund if was previously pending (not already failed/reversed)
    if (transaction.status === "pending") {
      // Refund the full debited amount
      const refundAmount =
        transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

      await this.refundWallet(
        transaction.sourceId.toString(),
        refundAmount,
        "REFUND",
        `Transaction failed - ${transaction.reference}`,
        transaction.reference,
        new Types.ObjectId(transaction.id),
      );

      logger.info("Failed transaction refunded", {
        reference: transaction.reference,
        refundedAmount: refundAmount,
      });
    }

    await this.sendNotification(transaction.sourceId, "transaction_failed", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      reason: metadata?.reason || "Transaction failed",
    });

    // Notify Super Admins of the webhook failure (fire and forget)
    try {
      const notificationService = ServiceContainer.getNotificationService();
      notificationService
        .notifySuperAdminsOfFailure({
          transaction: {
            ...transaction,
            provider: providerName || transaction.provider,
          },
          reason:
            metadata?.reason ||
            metadata?.responseMessage ||
            metadata?.message ||
            `Transaction failed via provider webhook (${providerName || "Provider"})`,
        })
        .catch((err: any) =>
          logger.error(
            "Failed to notify super admins of webhook transaction failure",
            err,
          ),
        );
    } catch (notifyErr: any) {
      logger.error(
        "Could not dispatch super admin failure notification",
        notifyErr,
      );
    }

    logger.info("Transaction marked as failed", {
      reference: transaction.reference,
      providerReference,
    });
  }

  // HANDLE PENDING TRANSACTION

  private async handlePendingTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Transaction still pending", {
      reference: transaction.reference,
      providerReference,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "pending",
      providerReference,
      meta: {
        ...transaction.meta,
        providerResponse: {
          ...metadata,
          updatedAt: new Date(),
          provider: providerName,
        },
        providerResponseAt: new Date(),
      },
    });
  }

  // REFUND WALLET
  private async refundWallet(
    userId: string,
    amount: number,
    purpose: string,
    remark: string,
    reference: string,
    linkedTransactionId?: Types.ObjectId,
  ): Promise<void> {
    try {
      await this.walletService.creditWallet(userId, amount, purpose, {
        type: "refund",
        remark,
        linkedTransactionId,
      });
      logger.info("Wallet refunded successfully", {
        userId,
        amount,
        reference,
      });
    } catch (error) {
      logger.error("Wallet refund failed", {
        userId,
        amount,
        reference,
        error,
      });
      SentryHelper.captureBusinessError(
        "WEBHOOK_REFUND_FAILED",
        `Wallet refund failed during webhook processing for ${reference}`,
        userId,
        { amount, reference },
      );
      // TODO: add this to a retry queue
    }
  }

  // SEND NOTIFICATION
  private async sendNotification(
    userId: Types.ObjectId,
    type: string,
    data: any,
  ): Promise<void> {
    try {
      await this.notificationRepository.create({
        type,
        notifiableType: "User",
        notifiableId: userId,
        data,
      });
      logger.info("Notification sent", { userId, type });
    } catch (error) {
      logger.error("Notification send failed", {
        userId,
        type,
        error,
      });
      // Don't throw — notifications should never block webhook processing
    }
  }

  // HELPERS
  private getTransactionTypeLabel(type: string): string {
    const typeMap: { [key: string]: string } = {
      smm: "SMM Order",
      game_topup: "Game Top-Up",
      number_rental: "Number Rental",
      proxy: "Proxy Purchase",
    };

    return typeMap[type] || type.replace(/_/g, " ").toUpperCase();
  }
}
