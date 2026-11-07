import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { DepositRepository } from "@/repositories/client/DepositRepository";
import { WebhookProcessResult } from "@/services/WebhookService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES, CACHE_KEYS } from "@/utils/constants";
import { cacheService } from "@/services/core/CacheService";
import logger from "@/logger";
import { generateReference } from "@/utils/helpers";
import mongoose from "mongoose";
import { NotificationService } from "../notifications/NotificationService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import AdminServiceContainer from "@/services/admin/container";
import ServiceContainer from "@/services/client/container";
import { WebhookDeliveryService } from "./WebhookDeliveryService";
import { HelperService } from "@/services/client/utility/HelperService";
import SocketService from "@/services/core/SocketService";

export class XixapayWebhookService {
  private notificationService: NotificationService;
  private transactionRepository: TransactionRepository;
  private virtualAccountRepository: VirtualAccountRepository;
  private walletRepository: WalletRepository;
  private depositRepository: DepositRepository;
  private auditLoggingService: AuditLoggingService;
  private webhookDeliveryService: WebhookDeliveryService;
  private helperService: HelperService;

  constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
    this.transactionRepository = new TransactionRepository();
    this.virtualAccountRepository = new VirtualAccountRepository();
    this.walletRepository = new WalletRepository();
    this.depositRepository = new DepositRepository();
    this.auditLoggingService = AdminServiceContainer.getAuditLoggingService();
    this.webhookDeliveryService = ServiceContainer.getWebhookDeliveryService();
    this.helperService = ServiceContainer.getHelperService();
  }

  async processWebhook(webhookData: WebhookProcessResult): Promise<void> {
    const { providerTransactionId } = webhookData;

    try {
      logger.info("Xixapay webhook service: processing started", {
        providerTransactionId,
        status: webhookData.status,
      });

      // Xixapay's documented webhook only covers collections/funding —
      // no payout/withdrawal webhook exists, so there is no "Outwards" branch
      // here (unlike SaveHavenWebhookService, which handles both).
      const isDuplicate = await this.checkIdempotency(
        providerTransactionId,
        webhookData.providerReference,
      );

      if (isDuplicate) {
        logger.info(
          "Xixapay webhook: transaction already processed, skipping",
          {
            providerTransactionId,
            providerReference: webhookData.providerReference,
          },
        );
        return;
      }

      await this.handleWalletFunding(webhookData);

      logger.info("Xixapay webhook service: processing completed", {
        providerTransactionId,
      });
    } catch (error) {
      logger.error("Xixapay webhook service: processing error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async handleWalletFunding(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const {
      reference,
      providerTransactionId,
      providerReference,
      status,
      metadata,
    } = webhookData;

    let session: mongoose.ClientSession | null = null;
    let notificationData: any = null;

    try {
      logger.info("Xixapay: processing wallet funding", {
        providerTransactionId,
        creditAccountNumber: metadata.creditAccountNumber,
        amount: metadata.amount,
        status,
      });

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          metadata.amount,
          TRANSACTION_TYPES.DEPOSIT,
        );

      const amountToCredit =
        metadata.amount - Number(chargeCalculation.chargeAmount);

      await this.auditLoggingService.logWebhookEvent({
        provider: "xixapay",
        webhookType: "virtualAccount.transfer",
        transactionReference: reference,
        status: "received",
        details: {
          amount: metadata.amount,
          creditAccountNumber: metadata.creditAccountNumber,
        },
      });

      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: providerTransactionId },
          { idempotencyKey: providerReference },
        ],
        provider: "xixapay",
        type: TRANSACTION_TYPES.DEPOSIT,
      });

      if (existingTransaction) {
        logger.info("Xixapay: deposit already processed", {
          transactionId: existingTransaction._id,
          providerReference,
        });

        await this.webhookDeliveryService.recordWebhookReceived({
          transactionReference: reference || providerReference,
          provider: "xixapay",
          webhookPayload: webhookData,
          providerTransactionId,
        });

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference || providerReference,
          provider: "xixapay",
        });

        return;
      }

      await this.webhookDeliveryService.recordWebhookReceived({
        transactionReference: reference || providerReference,
        provider: "xixapay",
        webhookPayload: webhookData,
        providerTransactionId,
      });

      await this.webhookDeliveryService.recordWebhookProcessingStarted({
        transactionReference: reference || providerReference,
        provider: "xixapay",
      });

      // Matching via account number — Xixapay's webhook carries no
      // merchant-supplied reference, same primary-resolution approach
      // SaveHavenWebhookService already relies on.
      const virtualAccount = await this.virtualAccountRepository.findOne({
        accountNumber: metadata.creditAccountNumber,
        provider: "xixapay",
        isActive: true,
      });

      if (!virtualAccount) {
        logger.error("Xixapay: virtual account not found", {
          accountNumber: metadata.creditAccountNumber,
          providerTransactionId,
        });
        throw new AppError(
          "Virtual account not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const userId = virtualAccount.userId;

      logger.info("Xixapay: found virtual account", {
        virtualAccountId: virtualAccount._id,
        userId,
        accountNumber: metadata.creditAccountNumber,
      });

      const wallet = await this.walletRepository.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const balanceBefore = wallet.balance;
      let balanceAfter = balanceBefore;

      if (status === "success") {
        balanceAfter = balanceBefore + amountToCredit;
      } else if (status === "reversed") {
        balanceAfter = balanceBefore;
      }

      session = await mongoose.startSession();
      session.startTransaction();

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId,
            walletId: wallet._id,
            reference: depositReference,
            provider: "xixapay",
            amount: amountToCredit,
            status:
              status === "success"
                ? "success"
                : status === "reversed"
                  ? "reversed"
                  : "failed",
            meta: {
              providerResponse: metadata,
              chargeInfo: {
                baseAmount: metadata.amount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
              },
              providerReference,
              providerTransactionId,
              xixapayTransactionId: providerTransactionId,
              virtualAccountId: virtualAccount._id,
              fees: metadata.fees,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              unsolicited: true,
              creditAccountNumber: metadata.creditAccountNumber,
              creditAccountName: metadata.creditAccountName,
              debitAccountNumber: metadata.debitAccountNumber,
              debitAccountName: metadata.debitAccountName,
            },
          },
        ],
        { session },
      );

      logger.info("Xixapay: deposit record created", {
        depositId: deposit[0]._id,
        reference: depositReference,
        userId,
      });
      const senderName = metadata.debitAccountName || "";
      const senderAccount = metadata.debitAccountNumber
        ? ` (${metadata.debitAccountNumber})`
        : "";

      const comment = senderName ? "Deposit received" : "Wallet funded";
      const remark = senderName
        ? `Deposit of ₦${amountToCredit.toLocaleString()} from ${senderName}${senderAccount}`
        : "Wallet funded";

      const transactionReference = generateReference("TXN");
      const transaction = await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: userId,
            userId,
            reference: transactionReference,
            providerReference,
            idempotencyKey: providerReference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount: amountToCredit,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            profit: chargeCalculation.chargeAmount - (metadata.fees || 0),
            provider: "xixapay",
            status:
              status === "success"
                ? "success"
                : status === "reversed"
                  ? "reversed"
                  : "failed",
            purpose: TRANSACTION_TYPES.DEPOSIT,
            comment: comment,
            remark: remark,
            balanceBefore,
            balanceAfter,
            initiatedBy: userId,
            initiatedByType: "system",
            meta: {
              depositId: deposit[0]._id,
              depositReference,
              provider: "xixapay",
              providerResponse: metadata,
              virtualAccount: {
                accountNumber: metadata.creditAccountNumber,
                accountName: metadata.creditAccountName,
                bankName: virtualAccount.bankName,
              },
              chargeInfo: {
                baseAmount: metadata.amount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
                isServiceChargeCapped: chargeCalculation.isCapped,
              },
              fees: metadata.fees,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              providerTransactionId,
              debitAccountNumber: metadata.debitAccountNumber,
              debitAccountName: metadata.debitAccountName,
            },
          },
        ],
        { session },
      );

      logger.info("Xixapay: transaction record created", {
        transactionId: transaction[0]._id,
        reference: transactionReference,
        userId,
      });

      let updatedWallet: any = null;
      if (status === "success") {
        updatedWallet = await Wallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: amountToCredit } },
          { session, new: true },
        );

        if (!updatedWallet) {
          throw new Error("Failed to update wallet balance");
        }

        logger.info("Xixapay: wallet credited", {
          userId: userId.toString(),
          amount: amountToCredit,
          reference: transactionReference,
          newBalance: updatedWallet.balance,
        });

        await this.auditLoggingService.logTransactionEvent({
          userId,
          transactionId: transaction[0]._id.toString(),
          transactionReference,
          action: "status_changed",
          previousStatus: "pending",
          newStatus: status,
          amount: amountToCredit,
          balanceAfter: updatedWallet?.balance,
          reason: "webhook_received",
          provider: "xixapay",
          initiatedBy: "webhook",
        });

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference,
          provider: "xixapay",
        });

        notificationData = {
          type: "payment_success",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: amountToCredit,
            reference: transactionReference,
            provider: "Xixapay",
            fees: metadata.fees,
            balance: balanceAfter,
          },
        };
      } else if (status === "failed") {
        notificationData = {
          type: "payment_failed",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: metadata.amount,
            reference: transactionReference,
            provider: "Xixapay",
          },
        };
      }

      await session.commitTransaction();
      session.endSession();
      session = null;

      if (status === "success" && updatedWallet) {
        try {
          await cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
        } catch (cacheErr) {
          logger.error("Xixapay: failed to invalidate wallet cache:", cacheErr);
        }

        SocketService.emitToUser(userId.toString(), "wallet_credit", {
          balance: updatedWallet.balance,
          bonusBalance: updatedWallet.bonusBalance,
          commissionBalance: updatedWallet.commissionBalance,
          amount: amountToCredit,
          direction: "CREDIT",
          type: "deposit",
          reference: transactionReference,
          reason: remark || "Wallet funded via Xixapay",
          timestamp: new Date().toISOString(),
        });
      }

      if (notificationData) {
        try {
          await this.notificationService.createNotification(notificationData);
          logger.info("Xixapay: notification sent", {
            userId: userId.toString(),
            type: notificationData.type,
            reference: transactionReference,
          });
        } catch (notificationError) {
          logger.error("Xixapay: notification failed (non-critical)", {
            error: notificationError,
            transactionId: transaction[0]._id,
            providerTransactionId,
          });
        }
      }

      if (status === "success") {
        logger.info("Xixapay: wallet funded successfully", {
          userId: userId.toString(),
          amount: amountToCredit,
          reference: transactionReference,
          providerTransactionId,
        });
      }
    } catch (error: any) {
      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (abortError) {
          logger.error("Xixapay: error aborting transaction", {
            error: abortError,
            originalError: error,
            providerTransactionId,
          });
        } finally {
          session.endSession();
        }
      }

      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "xixapay",
        error: error?.message || "Unknown error",
      });

      logger.error("Xixapay: wallet funding error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async checkIdempotency(
    providerTransactionId: string | undefined,
    providerReference: string,
  ): Promise<boolean> {
    if (!providerTransactionId && !providerReference) {
      logger.warn("Xixapay: cannot check idempotency — missing identifiers");
      return false;
    }

    const orConditions: any[] = [];

    if (providerReference) {
      orConditions.push({ providerReference });
      orConditions.push({ idempotencyKey: providerReference });
    }

    if (providerTransactionId) {
      orConditions.push({
        "meta.providerTransactionId": providerTransactionId,
      });
    }

    const existingTransaction = await this.transactionRepository.findOne({
      provider: "xixapay",
      type: TRANSACTION_TYPES.DEPOSIT,
      $or: orConditions,
    });

    if (existingTransaction) {
      logger.info("Xixapay: transaction already exists (duplicate)", {
        providerTransactionId,
        providerReference,
        existingTransactionId: existingTransaction._id,
        status: existingTransaction.status,
      });
      return true;
    }

    return false;
  }
}
