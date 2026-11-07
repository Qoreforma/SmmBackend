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
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../notifications/NotificationService";
import AdminServiceContainer from "@/services/admin/container";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import ServiceContainer from "../container";
import { WebhookDeliveryService } from "./WebhookDeliveryService";
import { WalletService } from "../wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import SocketService from "@/services/core/SocketService";

export class SaveHavenWebhookService {
  private notificationService: NotificationService;
  private transactionRepository: TransactionRepository;
  private virtualAccountRepository: VirtualAccountRepository;
  private walletRepository: WalletRepository;
  private depositRepository: DepositRepository;
  private auditLoggingService: AuditLoggingService;
  private webhookDeliveryService: WebhookDeliveryService;
  private walletService: WalletService;
  private helperService: HelperService;
  private saveHavenService: SaveHavenService;

  constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
    this.transactionRepository = new TransactionRepository();
    this.virtualAccountRepository = new VirtualAccountRepository();
    this.walletRepository = new WalletRepository();
    this.depositRepository = new DepositRepository();
    this.auditLoggingService = AdminServiceContainer.getAuditLoggingService();
    this.webhookDeliveryService = ServiceContainer.getWebhookDeliveryService();
    this.walletService = ServiceContainer.getWalletService();
    this.helperService = ServiceContainer.getHelperService();
    this.saveHavenService = ServiceContainer.getSaveHavenService();
  }

  async processWebhook(webhookData: WebhookProcessResult): Promise<void> {
    const { providerTransactionId, metadata } = webhookData;

    try {
      logger.info("SaveHaven webhook service: Processing started", {
        providerTransactionId,
        transferType: metadata.transferType,
        status: webhookData.status,
      });

      if (metadata.transferType === "Inwards") {
        const isDuplicate = await this.checkIdempotencyForInwards(
          providerTransactionId,
          webhookData.providerReference,
        );

        if (isDuplicate) {
          logger.info(
            "SaveHaven webhook: Inwards transaction already processed, skipping",
            {
              providerTransactionId,
              providerReference: webhookData.providerReference,
            },
          );
          return;
        }

        await this.handleWalletFunding(webhookData);
      } else if (metadata.transferType === "Outwards") {
        logger.warn(
          "SaveHaven webhook: Outwards webhook received but not expected...",
        );
      } else {
        logger.warn("SaveHaven webhook: Unknown transfer type", {
          transferType: metadata.transferType,
          providerTransactionId,
        });
      }

      logger.info("SaveHaven webhook service: Processing completed", {
        providerTransactionId,
        transferType: metadata.transferType,
      });
    } catch (error) {
      logger.error("SaveHaven webhook service: Processing error", {
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
    // Verified truth used for every downstream decision below. Starts as
    // the webhook's own claim but gets overwritten by direct SafeHaven
    // verification further down - the webhook payload's `status` is never
    // trusted on its own for crediting.
    let effectiveStatus: "success" | "pending" | "failed" | "reversed" =
      status;

    try {
      logger.info("SaveHaven: Processing wallet funding", {
        providerTransactionId,
        creditAccountNumber: metadata.creditAccountNumber,
        amount: metadata.amount,
        status,
      });
      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          metadata.amount,
          TRANSACTION_TYPES.DEPOSIT, // Transaction type is DEPOSIT
        );

      const amountToCredit =
        metadata.amount - Number(chargeCalculation.chargeAmount);

      await this.auditLoggingService.logWebhookEvent({
        provider: "saveHaven",
        webhookType: "transfer",
        transactionReference: webhookData.reference,
        status: "received",
        details: {
          amount: metadata.amount,
          creditAccountNumber: metadata.creditAccountNumber,
        },
      });

      // Same reasoning as checkIdempotencyForInwards below: key on the
      // event-level providerTransactionId, not on providerReference /
      // idempotencyKey, since providerReference (paymentReference)
      // legitimately repeats between an original credit and its reversal -
      // matching on it here would treat a genuine reversal webhook as an
      // already-processed duplicate of the original credit and drop it.
      const existingTransaction = await Transaction.findOne(
        providerTransactionId
          ? {
            "meta.providerTransactionId": providerTransactionId,
            provider: "saveHaven",
            type: "deposit",
          }
          : {
            $or: [
              { providerReference: providerReference },
              { idempotencyKey: providerReference },
            ],
            provider: "saveHaven",
            type: "deposit",
          },
      );

      if (existingTransaction) {
        logger.info("SaveHaven: Deposit already processed", {
          transactionId: existingTransaction._id,
          providerReference,
        });
        // Mark webhook delivery as success — duplicate webhook,

        await this.webhookDeliveryService.recordWebhookReceived({
          transactionReference:
            webhookData.reference || webhookData.providerReference,
          provider: "saveHaven",
          webhookPayload: webhookData,
          providerTransactionId,
        });

        // transaction already processed correctly
        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference:
            webhookData.reference || webhookData.providerReference,
          provider: "saveHaven",
        });

        return;
      }
      await this.webhookDeliveryService.recordWebhookReceived({
        transactionReference:
          webhookData.reference || webhookData.providerReference,
        provider: "saveHaven",
        webhookPayload: webhookData,
        providerTransactionId,
      });

      await this.webhookDeliveryService.recordWebhookProcessingStarted({
        transactionReference:
          webhookData.reference || webhookData.providerReference,
        provider: "saveHaven",
      });

      const virtualAccount = await this.virtualAccountRepository.findOne({
        accountNumber: metadata.creditAccountNumber,
        provider: "saveHaven",
        isActive: true,
      });

      if (!virtualAccount) {
        logger.error("SaveHaven: Virtual account not found", {
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

      logger.info("SaveHaven: Found virtual account", {
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

      // NEVER TRUST THE WEBHOOK ALONE - verify directly with SafeHaven
      // before crediting anything. Dispatch on the account type looked up
      // above:
      //   - permanent (static sub-account) -> account statement endpoint
      //     (confirmed live against the real API - see getAccountStatement)
      //   - temporary (dynamic virtual account) -> transfer status endpoint
      // Any inconclusive result (not found yet / call failed) defers to
      // "pending" rather than guessing - SafeHavenPendingVerificationJob
      // re-checks shortly after instead of us risking a wrong credit here.
      const verifiedVia =
        virtualAccount.type === "permanent"
          ? "account_statement"
          : "virtual_account_transfer_status";

      try {
        if (virtualAccount.type === "permanent") {
          const providerAccountId = virtualAccount.meta?.providerAccountId;

          if (!providerAccountId) {
            logger.error(
              "SaveHaven: Sub-account missing providerAccountId, cannot verify - deferring",
              { virtualAccountId: virtualAccount._id, providerTransactionId },
            );
            effectiveStatus = "pending";
          } else {
            const verification =
              await this.saveHavenService.getAccountStatement(
                providerAccountId,
                providerReference,
              );

            logger.info(
              "[SAFEHAVEN_VERIFY_LOGGING] Sub-account verification result",
              {
                providerTransactionId,
                providerReference,
                found: verification.found,
                isReversal: verification.isReversal,
              },
            );

            if (!verification.found) {
              effectiveStatus = "pending";
            } else if (verification.isReversal) {
              effectiveStatus = "reversed";
            } else {
              effectiveStatus = "success";
            }
          }
        } else {
          const sessionId = metadata.sessionId;

          if (!sessionId) {
            logger.error(
              "SaveHaven: Missing sessionId for dynamic account, cannot verify - deferring",
              { virtualAccountId: virtualAccount._id, providerTransactionId },
            );
            effectiveStatus = "pending";
          } else {
            const verification =
              await this.saveHavenService.getVirtualAccountTransferStatus(
                sessionId,
              );

            logger.info(
              "[SAFEHAVEN_VERIFY_LOGGING] Dynamic account verification result",
              {
                providerTransactionId,
                sessionId,
                status: verification?.status,
                isReversed: verification?.isReversed,
              },
            );

            if (!verification || verification.status === "unknown") {
              effectiveStatus = "pending";
            } else if (verification.isReversed) {
              effectiveStatus = "reversed";
            } else if (verification.status === "Completed") {
              effectiveStatus = "success";
            } else if (
              verification.status === "Failed" ||
              verification.status === "Declined"
            ) {
              effectiveStatus = "failed";
            } else {
              effectiveStatus = "pending";
            }
          }
        }
      } catch (verifyError: any) {
        logger.error(
          "SaveHaven: Verification call failed, deferring to reconciliation",
          {
            providerTransactionId,
            accountType: virtualAccount.type,
            error: verifyError?.message,
          },
        );
        effectiveStatus = "pending";
      }

      if (effectiveStatus === "pending") {
        // Don't credit yet. Leave a Transaction marker the
        // SafeHavenPendingVerificationJob can find and re-verify shortly
        // after - no Deposit record until the outcome is actually known.
        const pendingReference = generateReference("TXN");

        await Transaction.create({
          walletId: wallet._id,
          sourceId: userId,
          userId,
          reference: pendingReference,
          providerReference: providerReference,
          idempotencyKey: providerReference,
          amount: amountToCredit,
          direction: "CREDIT",
          type: TRANSACTION_TYPES.DEPOSIT,
          provider: "saveHaven",
          status: "pending",
          purpose: TRANSACTION_TYPES.DEPOSIT,
          comment: "Deposit pending SafeHaven verification",
          remark: "Awaiting SafeHaven confirmation before crediting",
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
          initiatedBy: userId,
          initiatedByType: "system",
          meta: {
            providerResponse: metadata,
            providerReference,
            providerTransactionId,
            virtualAccountId: virtualAccount._id,
            accountType: virtualAccount.type,
            sessionId: metadata.sessionId,
            providerAccountId: virtualAccount.meta?.providerAccountId,
            verificationStatus: "pending_verification",
            verificationAttempts: 0,
          },
        });

        logger.warn(
          "SaveHaven: Deposit deferred pending verification (not yet credited)",
          { providerTransactionId, providerReference, pendingReference },
        );

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: pendingReference,
          provider: "saveHaven",
        });

        return;
      }

      const balanceBefore = wallet.balance;
      let balanceAfter = balanceBefore;

      if (effectiveStatus === "success") {
        balanceAfter = balanceBefore + amountToCredit;
      } else if (effectiveStatus === "reversed") {
        balanceAfter = balanceBefore;
      }

      session = await mongoose.startSession();
      session.startTransaction();

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId: userId,
            walletId: wallet._id,
            reference: depositReference,
            provider: "saveHaven",
            amount: amountToCredit,
            // Deposit.status only supports "success" | "failed" (see
            // src/models/banking/Deposit.ts) - "reversed" is not a valid
            // enum value there, so a verified reversal is stored as
            // "failed" here. The true outcome is preserved on the
            // Transaction record and in meta.verifiedStatus below, so
            // nothing about the reversal is actually lost.
            status: effectiveStatus === "success" ? "success" : "failed",
            meta: {
              verifiedStatus: effectiveStatus,
              verifiedVia,
              providerResponse: metadata,
              chargeInfo: {
                baseAmount: metadata.amount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
                isServiceChargeCapped: chargeCalculation.isCapped,
              },
              providerReference: providerReference,
              providerTransactionId: providerTransactionId,
              safeHavenTransactionId: providerTransactionId,
              virtualAccountId: virtualAccount._id,
              fees: metadata.fees,
              vat: metadata.vat,
              stampDuty: metadata.stampDuty,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              unsolicited: true,
              creditAccountNumber: metadata.creditAccountNumber,
              creditAccountName: metadata.creditAccountName,
              debitAccountName: metadata.debitAccountName || "",
              debitAccountNumber: metadata.debitAccountNumber || "",
              responseMessage: metadata.responseMessage,
            },
          },
        ],
        { session },
      );

      logger.info("SaveHaven: Deposit record created", {
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
            providerReference: providerReference,
            idempotencyKey: providerReference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount: amountToCredit,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            profit:
              chargeCalculation.chargeAmount -
              ((metadata.fees || 0) +
                (metadata.vat || 0) +
                (metadata.stampDuty || 0)),

            provider: "saveHaven",
            status:
              effectiveStatus === "success"
                ? "success"
                : effectiveStatus === "reversed"
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
              depositReference: depositReference,
              verifiedVia,
              providerResponse: metadata,
              provider: "saveHaven",
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
              vat: metadata.vat,
              stampDuty: metadata.stampDuty,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              providerTransactionId: providerTransactionId,
              debitAccountNumber: metadata.debitAccountNumber,
              debitAccountName: metadata.debitAccountName,
              responseMessage: metadata.responseMessage,
            },
          },
        ],
        { session },
      );

      logger.info("SaveHaven: Transaction record created", {
        transactionId: transaction[0]._id,
        reference: transactionReference,
        userId,
      });

      let updatedWallet: any = null;
      if (effectiveStatus === "success") {
        updatedWallet = await Wallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: amountToCredit } },
          { session, new: true },
        );

        if (!updatedWallet) {
          throw new Error("Failed to update wallet balance");
        }

        logger.info("SaveHaven: Wallet credited", {
          userId: userId.toString(),
          amount: amountToCredit,
          reference: transactionReference,
          newBalance: updatedWallet.balance,
        });

        await this.auditLoggingService.logTransactionEvent({
          userId: userId,
          transactionId: transaction[0]._id.toString(),
          transactionReference: transactionReference,
          action: "status_changed",
          previousStatus: "pending",
          newStatus: effectiveStatus,
          amount: amountToCredit,
          balanceAfter: updatedWallet?.balance,
          reason: "webhook_received",
          provider: "saveHaven",
          initiatedBy: "webhook",
        });

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: transactionReference,
          provider: "saveHaven",
        });
      }

      if (effectiveStatus === "success") {
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
            provider: "SafeHaven",
            fees: metadata.fees,
            balance: balanceAfter,
          },
        };
      } else if (effectiveStatus === "reversed") {
        notificationData = {
          type: "payment_reversed",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: metadata.netAmount,
            reference: transactionReference,
            provider: "SafeHaven",
            reason: metadata.responseMessage,
          },
        };
      } else if (effectiveStatus === "failed") {
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
            provider: "SafeHaven",
            reason: metadata.responseMessage,
          },
        };
      }

      await session.commitTransaction();
      session.endSession();
      session = null;

      if (effectiveStatus === "success" && updatedWallet) {
        try {
          await cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
        } catch (cacheErr) {
          logger.error("SaveHaven: failed to invalidate wallet cache:", cacheErr);
        }

        SocketService.emitToUser(userId.toString(), "wallet_credit", {
          balance: updatedWallet.balance,
          bonusBalance: updatedWallet.bonusBalance,
          commissionBalance: updatedWallet.commissionBalance,
          amount: amountToCredit,
          direction: "CREDIT",
          type: "deposit",
          reference: transactionReference,
          reason: remark || "Wallet funded via SafeHaven",
          timestamp: new Date().toISOString(),
        });
      }

      if (notificationData) {
        try {
          await this.notificationService.createNotification(notificationData);

          logger.info("SaveHaven: Notification sent", {
            userId: userId.toString(),
            type: notificationData.type,
            reference: transactionReference,
          });
        } catch (notificationError) {
          logger.error("SaveHaven: Notification failed (non-critical)", {
            error: notificationError,
            transactionId: transaction[0]._id,
            providerTransactionId,
          });
        }
      }

      if (effectiveStatus === "success") {
        logger.info("SaveHaven: Wallet funded successfully", {
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
          logger.error("SaveHaven: Error aborting transaction", {
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
        provider: "saveHaven",
        error: error?.message || "Unknown error",
      });

      logger.error("SaveHaven: Wallet funding error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async checkIdempotencyForInwards(
    providerTransactionId: string | undefined,
    providerReference: string,
  ): Promise<boolean> {
    if (!providerTransactionId && !providerReference) {
      logger.warn("SaveHaven: Cannot check idempotency - missing identifiers");
      return false;
    }

    const orConditions: any[] = [];

    if (providerTransactionId) {
      // Match against where handleWalletFunding actually stores it. This is
      // the primary, preferred key: it identifies ONE specific event from
      // SafeHaven (the original credit and a later reversal are two
      // different events for the same underlying payment).
      orConditions.push({
        "meta.providerTransactionId": providerTransactionId,
      });
    }

    // providerReference (SafeHaven's paymentReference) intentionally
    // repeats across an inward credit and its later reversal - it
    // identifies the payment, not the event. Using it as a duplicate check
    // would silently swallow every reversal webhook as a "duplicate" of the
    // original credit. Only fall back to it when we have no event-level ID
    // to key on at all.
    if (!providerTransactionId && providerReference) {
      orConditions.push({ providerReference: providerReference });
      orConditions.push({ idempotencyKey: providerReference });
    }

    const query: any = {
      provider: "saveHaven",
      type: "deposit",
      $or: orConditions,
    };

    const existingTransaction = await this.transactionRepository.findOne(query);

    if (existingTransaction) {
      logger.info("SaveHaven: Inwards transaction already exists (duplicate)", {
        providerTransactionId,
        providerReference,
        existingTransactionId: existingTransaction._id,
        existingReference: existingTransaction.reference,
        status: existingTransaction.status,
        createdAt: existingTransaction.createdAt,
      });
      return true;
    }

    return false;
  }

  private async checkIdempotencyForOutwards(
    reference: string,
    providerTransactionId: string | undefined,
  ): Promise<boolean> {
    if (!reference && !providerTransactionId) {
      logger.warn("SaveHaven: Cannot check idempotency - missing identifiers");
      return false;
    }

    const query: any = {
      type: { $in: ["withdrawal"] },
      provider: "saveHaven",
    };

    const orConditions: any[] = [];

    if (reference) {
      orConditions.push({ reference: reference });
    }

    if (providerTransactionId) {
      orConditions.push(
        { providerReference: providerTransactionId },
        { "meta.transferId": providerTransactionId },
      );
    }

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    const existingTransaction = await this.transactionRepository.findOne(query);

    if (!existingTransaction) {
      logger.warn("SaveHaven: Outwards transaction not found", {
        reference,
        providerTransactionId,
      });
      return false;
    }

    const finalStatuses = ["success", "failed", "reversed"];
    const isInFinalState = finalStatuses.includes(existingTransaction.status);
    const hasWebhookData = existingTransaction.meta?.webhookData !== undefined;

    if (isInFinalState) {
      logger.info(
        "SaveHaven: Outwards transaction in final state (duplicate webhook)",
        {
          providerTransactionId,
          reference,
          transactionId: existingTransaction._id,
          status: existingTransaction.status,
          updatedAt: existingTransaction.updatedAt,
        },
      );
      return true;
    }

    if (hasWebhookData) {
      logger.info(
        "SaveHaven: Outwards transaction already has webhook data (duplicate)",
        {
          providerTransactionId,
          reference,
          transactionId: existingTransaction._id,
          status: existingTransaction.status,
          webhookReceivedAt:
            existingTransaction.meta?.webhookData?.webhookReceivedAt,
        },
      );
      return true;
    }

    logger.info(
      "SaveHaven: Outwards transaction ready for webhook processing",
      {
        providerTransactionId,
        reference,
        transactionId: existingTransaction._id,
        currentStatus: existingTransaction.status,
      },
    );

    return false;
  }

  private mapPaymentStatusToTransaction(
    paymentStatus: string,
  ): "pending" | "processing" | "success" | "failed" | "reversed" {
    const statusMap: Record<string, any> = {
      success: "success",
      failed: "failed",
      reversed: "reversed",
      pending: "processing",
      processing: "processing",
    };

    return statusMap[paymentStatus] || "processing";
  }
  // add as a new method on the class
  async recordAccountDebitEvent(payload: any): Promise<void> {
    const data = payload?.data || {};
    try {
      await this.auditLoggingService.logWebhookEvent({
        provider: "saveHaven",
        webhookType: "account.debit",
        transactionReference: data.reference,
        status: "received",
        details: {
          saveHavenReference: data.reference,
          narration: data.narration,
          amount: data.amount,
          fees: data.fees,
          vat: data.vat,
          stampDuty: data.stampDuty,
          debitAccountNumber: data.debitAccountNumber,
          createdAt: data.createdAt,
        },
      });

      logger.info(
        "SaveHaven: account.debit event recorded (not yet correlated to a transaction)",
        { saveHavenReference: data.reference, narration: data.narration, amount: data.amount },
      );
    } catch (error) {
      logger.error("SaveHaven: failed to record account.debit event", { error, payload });
    }
  }
}