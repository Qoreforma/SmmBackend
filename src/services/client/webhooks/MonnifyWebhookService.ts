import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { DepositRepository } from "@/repositories/client/DepositRepository";
import { WebhookProcessResult } from "@/services/WebhookService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES, CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";
import { generateReference } from "@/utils/helpers";
import { cacheService } from "@/services/core/CacheService";
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../notifications/NotificationService";
import ServiceContainer from "../container";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { WebhookDeliveryService } from "./WebhookDeliveryService";
import { HelperService } from "@/services/client/utility/HelperService";
import { WalletService } from "@/services/client/wallet/WalletService";
import SocketService from "@/services/core/SocketService";

// MONNIFY WEBHOOK SERVICE - COMPLETE
// Handles all payment scenarios:
// 1. Virtual Account Deposits (user sends to their assigned account)
// 2. Card Payments (user pays with card)
// 3. Withdrawals/Transfers (user requests payout)

export class MonnifyWebhookService {
  private notificationService: NotificationService;
  private transactionRepository: TransactionRepository;
  private virtualAccountRepository: VirtualAccountRepository;
  private walletRepository: WalletRepository;
  private depositRepository: DepositRepository;
  private auditLoggingService: AuditLoggingService;
  private webhookDeliveryService: WebhookDeliveryService;
  private helperService: HelperService;
  private walletService: WalletService;

  constructor() {
    this.notificationService = ServiceContainer.getNotificationService();
    this.transactionRepository = new TransactionRepository();
    this.virtualAccountRepository = new VirtualAccountRepository();
    this.walletRepository = new WalletRepository();
    this.depositRepository = new DepositRepository();
    this.auditLoggingService = ServiceContainer.getAuditLoggingService();
    this.webhookDeliveryService = ServiceContainer.getWebhookDeliveryService();
    this.helperService = ServiceContainer.getHelperService();
    this.walletService = ServiceContainer.getWalletService();
  }

  async processWebhook(webhookData: WebhookProcessResult): Promise<void> {
    const { providerTransactionId, metadata } = webhookData;

    try {
      logger.info("Monnify webhook service: Processing started", {
        providerTransactionId,
        eventType: metadata?.eventType,
        status: webhookData.status,
        reference: webhookData.reference,
      });

      // Check idempotency
      const isDuplicate = await this.checkIdempotency(providerTransactionId);
      if (isDuplicate) {
        logger.info("Monnify webhook: Duplicate transaction, skipping", {
          providerTransactionId,
        });
        return;
      }

      // Route based on event type
      const eventType = metadata?.eventType;

      switch (eventType) {
        case "SUCCESSFUL_TRANSACTION":
          await this.handleSuccessfulTransaction(webhookData);
          break;

        case "SUCCESSFUL_DISBURSEMENT":
          await this.handleSuccessfulDisbursement(webhookData);
          break;

        case "FAILED_DISBURSEMENT":
          await this.handleFailedDisbursement(webhookData);
          break;

        case "REVERSED_DISBURSEMENT":
          await this.handleReversedDisbursement(webhookData);
          break;

        default:
          logger.warn("Monnify webhook: Unsupported event type", {
            eventType,
            reference: webhookData.reference,
          });
      }

      logger.info("Monnify webhook service: Processing completed", {
        providerTransactionId,
        eventType,
      });
    } catch (error) {
      logger.error("Monnify webhook service: Processing error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  // SCENARIO 1: VIRTUAL ACCOUNT DEPOSIT (SUCCESSFUL_TRANSACTION)
  // SCENARIO 2: CARD PAYMENT (SUCCESSFUL_TRANSACTION)
  // Both handled in handleSuccessfulTransaction

  private async handleSuccessfulTransaction(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { providerTransactionId, providerReference, status, metadata } =
      webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: webhookData.reference || providerReference,
      provider: "monnify",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: webhookData.reference || providerReference,
      provider: "monnify",
    });
    await this.auditLoggingService
      .logWebhookEvent({
        provider: "monnify",
        webhookType: metadata.eventType || "transaction",
        transactionReference: webhookData.reference,
        status: "received",
        details: {
          settlementAmount: metadata.settlementAmount,
          virtualAccountNumber: metadata.virtualAccountNumber,
          paymentMethod: metadata.paymentMethod,
        },
      })
      .catch((err) => logger.error("Failed to log webhook event:", err));

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info("Monnify: Processing wallet funding", {
        providerTransactionId,
        virtualAccountNumber: metadata.virtualAccountNumber,
        settlementAmount: metadata.settlementAmount,
        reference: webhookData.reference,
        paymentMethod: metadata.paymentMethod,
        status,
      });

      let userId: string;
      let paymentSource: "virtual_account" | "card" = "card"; // Default to card

      //  Identify user based on payment scenario

      // SCENARIO 1: Virtual Account Deposit
      if (metadata.virtualAccountNumber) {
        logger.info(
          "Monnify: Virtual account deposit detected - finding user by account number",
        );
        paymentSource = "virtual_account";

        const virtualAccount = await this.virtualAccountRepository.findOne({
          accountNumber: metadata.virtualAccountNumber,
          provider: "monnify",
        });

        if (!virtualAccount) {
          await session.abortTransaction();
          logger.error("Monnify: Virtual account not found", {
            accountNumber: metadata.virtualAccountNumber,
            providerTransactionId,
          });
          throw new AppError(
            "Virtual account not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        userId = virtualAccount.userId.toString();
        logger.info("Monnify: Found user via virtual account", {
          userId,
          accountNumber: metadata.virtualAccountNumber,
        });
      }
      // SCENARIO 2: Card Payment
      else if (metadata.monnifyPaymentReference) {
        logger.info(
          "Monnify: Card payment detected - looking up user by payment reference",
        );
        paymentSource = "card";

        // Look up userId from Redis cache (stored when payment was initiated)
        const cachedUserId = await cacheService.get<string>(
          `payment:${metadata.monnifyPaymentReference}`,
        );

        if (!cachedUserId) {
          await session.abortTransaction();
          logger.error("Monnify: User not found for card payment", {
            monnifyPaymentReference: metadata.monnifyPaymentReference,
            providerTransactionId,
          });
          throw new AppError(
            "User not found for this payment",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        userId = cachedUserId;
        logger.info("Monnify: Found user via payment reference lookup", {
          userId,
          monnifyPaymentReference: metadata.monnifyPaymentReference,
        });

        await cacheService.delete(
          `payment:${metadata.monnifyPaymentReference}`,
        );
      } else {
        await session.abortTransaction();
        logger.error("Monnify: Cannot identify user for transaction", {
          metadata,
          providerTransactionId,
        });
        throw new AppError(
          "Cannot identify user for payment",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: providerReference },
          { providerReference: metadata.monnifyTransactionReference },
          { "meta.monnifyPaymentReference": metadata.monnifyPaymentReference },
          { "meta.providerTransactionId": providerTransactionId },
          { reference: webhookData.reference },
        ],
        provider: "monnify",
        type: "deposit",
      });

      if (existingTransaction) {
        await session.abortTransaction();
        logger.info("Monnify: Deposit already processed", {
          transactionId: existingTransaction._id,
          providerReference,
        });
        return;
      }

      const wallet = await this.walletRepository.findByUserId(userId);
      if (!wallet) {
        await session.abortTransaction();
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const balanceBefore = wallet.balance;
      const grossAmount =
        Number(metadata.settlementAmount) || metadata.amountPaid || 0;

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          grossAmount,
          TRANSACTION_TYPES.DEPOSIT,
        );

      const amountToCredit = grossAmount - chargeCalculation.chargeAmount;
      const balanceAfter = balanceBefore + amountToCredit;

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId: userId,
            walletId: wallet._id,
            reference: depositReference,
            provider: "monnify",
            amount: amountToCredit,
            status: "success",
            meta: {
              providerResponse: metadata,
              chargeInfo: {
                baseAmount: grossAmount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
                isServiceChargeCapped: chargeCalculation.isCapped,
              },
              providerReference: providerReference,
              providerTransactionId: providerTransactionId,
              monnifyTransactionReference: metadata.monnifyTransactionReference,
              monnifyPaymentReference: metadata.monnifyPaymentReference,
              fees: metadata.fees || metadata.amountPaid - amountToCredit,
              grossAmount: metadata.amountPaid,
              netAmount: amountToCredit,
              paymentMethod: metadata.paymentMethod,
              paymentSource: paymentSource,
              paymentSourceInformation: metadata.paymentSourceInformation,
              customer: metadata.customer,
              debitAccountName:
                metadata.paymentSourceInformation?.[0]?.accountName || "",
              debitAccountNumber:
                metadata.paymentSourceInformation?.[0]?.accountNumber || "",
              paidOn: metadata.paidOn,
              virtualAccountNumber: metadata.virtualAccountNumber,
              virtualBankName: metadata.virtualBankName,
              currency: metadata.currency,
              unsolicited: paymentSource === "virtual_account",
            },
          },
        ],
        { session },
      );

      logger.info("Monnify: Deposit record created", {
        depositId: deposit[0]._id,
        reference: depositReference,
        userId,
        paymentSource,
        amount: amountToCredit,
      });
      const senderName =
        metadata.paymentSourceInformation?.[0]?.accountName || "";
      const senderAccount = metadata.paymentSourceInformation?.[0]
        ?.accountNumber
        ? ` (${metadata.paymentSourceInformation[0].accountNumber})`
        : "";

      const comment = senderName ? "Deposit received" : "Wallet funded";
      const remark = senderName
        ? `Deposit of ₦${grossAmount.toLocaleString()} from ${senderName}${senderAccount}`
        : "Wallet funded";

      const transactionReference = generateReference("TXN");
      const transaction = await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: userId,
            userId,
            reference: transactionReference,
            providerReference:
              metadata.monnifyTransactionReference || providerReference,
            idempotencyKey:
              metadata.monnifyPaymentReference || webhookData.reference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount: amountToCredit,
            direction: "CREDIT",
            type: "deposit",
            provider: "monnify",
            status: "success",
            purpose: TRANSACTION_TYPES.DEPOSIT,
            remark: remark,
            comment: comment,
            balanceBefore,
            balanceAfter,
            initiatedBy: userId,
            initiatedByType: "system",
            profit: chargeCalculation.chargeAmount - (metadata.fees || 0),
            meta: {
              depositId: deposit[0]._id,
              providerResponse: metadata,
              chargeInfo: {
                baseAmount: grossAmount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
                isServiceChargeCapped: chargeCalculation.isCapped,
              },
              depositReference: depositReference,
              provider: "monnify",
              monnifyTransactionReference: metadata.monnifyTransactionReference,
              monnifyPaymentReference: metadata.monnifyPaymentReference,
              fees: metadata.fees || metadata.amountPaid - amountToCredit,
              grossAmount: metadata.amountPaid,
              netAmount: amountToCredit,
              paymentMethod: metadata.paymentMethod,
              paymentSource: paymentSource,
              paymentSourceInformation: metadata.paymentSourceInformation,
              customer: metadata.customer,
              debitAccountName:
                metadata.paymentSourceInformation?.[0]?.accountName || "",
              debitAccountNumber:
                metadata.paymentSourceInformation?.[0]?.accountNumber || "",
              paidOn: metadata.paidOn,
              providerTransactionId: providerTransactionId,
              currency: metadata.currency,
              virtualAccount:
                paymentSource === "virtual_account"
                  ? {
                      accountNumber: metadata.virtualAccountNumber,
                      bankName: metadata.virtualBankName,
                    }
                  : null,
            },
          },
        ],
        { session },
      );

      logger.info("Monnify: Transaction record created", {
        transactionId: transaction[0]._id,
        reference: transactionReference,
        userId,
      });

      const updatedWallet = await Wallet.findByIdAndUpdate(
        wallet._id,
        { $inc: { balance: amountToCredit } },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new Error("Failed to update wallet balance");
      }

      logger.info("Monnify: Wallet credited", {
        userId: userId.toString(),
        amount: amountToCredit,
        newBalance: updatedWallet.balance,
        reference: transactionReference,
      });

      await session.commitTransaction();

      if (updatedWallet) {
        try {
          await cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
        } catch (cacheErr) {
          logger.error("Monnify: failed to invalidate wallet cache:", cacheErr);
        }

        SocketService.emitToUser(userId.toString(), "wallet_credit", {
          balance: updatedWallet.balance,
          bonusBalance: updatedWallet.bonusBalance,
          commissionBalance: updatedWallet.commissionBalance,
          amount: amountToCredit,
          direction: "CREDIT",
          type: "deposit",
          reference: transactionReference,
          reason: remark || "Wallet funded via Monnify",
          timestamp: new Date().toISOString(),
        });
      }

      await this.webhookDeliveryService.recordWebhookProcessingSuccess({
        transactionReference: transactionReference,
        provider: "monnify",
      });

      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(userId),
          transactionId: transaction[0]._id.toString(),
          transactionReference: transactionReference,
          action: "status_changed",
          previousStatus: "pending",
          newStatus: "success",
          amount: amountToCredit,
          balanceAfter: updatedWallet?.balance,
          reason: "webhook_received",
          provider: "monnify",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));

      try {
        await this.notificationService.createNotification({
          type: "payment_success",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(userId),
          sendEmail: false,
          sendSMS: false,
          sendPush: true,
          data: {
            transactionType: "Wallet Funding",
            amount: amountToCredit,
            amountPaid: metadata.amountPaid,
            fees: metadata.fees || metadata.amountPaid - amountToCredit,
            reference: transactionReference,
            provider: "Monnify",
            paymentMethod: metadata.paymentMethod,
            paymentSource: paymentSource,
            balance: updatedWallet.balance,
          },
        });
      } catch (notificationError) {
        logger.warn("Monnify: Failed to send notification (non-critical)", {
          error: notificationError,
          userId,
        });
      }
      logger.info("Monnify: Wallet funded successfully", {
        userId: userId.toString(),
        amount: amountToCredit,
        reference: transactionReference,
        paymentSource,
        providerTransactionId,
      });
    } catch (error: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: webhookData.reference || providerReference,
        provider: "monnify",
        error: error?.message || "Unknown error",
      });
      logger.error("Monnify: Wallet funding error", {
        error: error.message,
        providerTransactionId,
      });
      throw error;
    } finally {
      session.endSession();
    }
  }

  // SCENARIO 3: SUCCESSFUL WITHDRAWAL/TRANSFER

  private async handleSuccessfulDisbursement(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
    });
    try {
      logger.info("Monnify: Processing successful withdrawal", {
        reference,
        providerTransactionId,
        amount: metadata.amount,
        destinationAccount: metadata.destinationAccountNumber,
      });

      // Find the withdrawal transaction that was created by user
      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "monnify",
      });

      if (!transaction) {
        logger.error("Monnify: Withdrawal transaction not found", {
          reference,
          providerTransactionId,
        });
        throw new AppError(
          "Withdrawal transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // Check if already processed
      if (["success", "failed", "reversed"].includes(transaction.status)) {
        logger.info("Monnify: Withdrawal already processed", {
          transactionId: transaction._id,
          currentStatus: transaction.status,
        });
        return;
      }

      // Update transaction to success
      await this.transactionRepository.update(transaction.id.toString(), {
        status: "success",
        providerReference: metadata.monnifyTransactionReference,
        profit:
          (transaction.meta?.chargeInfo?.serviceCharge || 0) -
          ((metadata.fee || 0) +
            (metadata.vat || 0) +
            (metadata.stampDuty || 0)),
        meta: {
          ...transaction.meta,
          monnifyTransactionReference: metadata.monnifyTransactionReference,
          sessionId: metadata.sessionId,
          transactionDescription: metadata.transactionDescription,
          fee: metadata.fee,
          providerTransactionId: providerTransactionId,
          providerResponse: metadata,
          completedOn: metadata.completedOn,
        },
      });

      logger.info("Monnify: Withdrawal marked as success", {
        transactionId: transaction._id,
        monnifyTransactionReference: metadata.monnifyTransactionReference,
      });

      const userId = transaction.sourceId;
      const amount = transaction.amount;

      // Send notification
      try {
        await this.notificationService.createNotification({
          type: "withdrawal_completed",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(userId),
          sendEmail: false,
          sendSMS: false,
          sendPush: true,
          data: {
            amount,
            reference,
            provider: "Monnify",
            destinationAccountNumber: metadata.destinationAccountNumber,
            destinationAccountName: metadata.destinationAccountName,
            destinationBankName: metadata.destinationBankName,
            completedOn: metadata.completedOn,
          },
        });
      } catch (notificationError) {
        logger.warn("Monnify: Failed to send withdrawal notification", {
          error: notificationError,
          userId,
        });
      }

      logger.info("Monnify: Withdrawal completed successfully", {
        reference,
        amount,
        providerTransactionId,
      });

      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(transaction.sourceId),
          transactionId: transaction._id.toString(),
          transactionReference: reference,
          action: "status_changed",
          previousStatus: transaction.status,
          newStatus: "success",
          amount: transaction.amount,
          reason: "disbursement_successful",
          provider: "monnify",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));

      await this.webhookDeliveryService.recordWebhookProcessingSuccess({
        transactionReference: reference,
        provider: "monnify",
      });
    } catch (error: any) {
      logger.error("Monnify: Withdrawal processing error", {
        error,
        reference,
        providerTransactionId,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "monnify",
        error: error?.message || "Unknown error",
      });

      throw error;
    }
  }

  // SCENARIO 4: FAILED WITHDRAWAL/TRANSFER

  private async handleFailedDisbursement(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
    });
    try {
      logger.info("Monnify: Processing failed withdrawal", {
        reference,
        providerTransactionId,
        amount: metadata.amount,
        failureReason: metadata.failureReason,
      });

      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "monnify",
      });

      if (!transaction) {
        logger.error("Monnify: Transaction not found for failed disbursement", {
          reference,
        });
        throw new AppError(
          "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (["failed", "reversed"].includes(transaction.status)) {
        logger.info("Flutterwave: Withdrawal already processed", {
          transactionId: transaction._id,
          currentStatus: transaction.status,
        });
        return;
      }

      // Update transaction to failed
      await this.transactionRepository.update(transaction.id.toString(), {
        status: "failed",
        meta: {
          ...transaction.meta,
          monnifyTransactionReference: metadata.monnifyTransactionReference,
          failureReason: metadata.failureReason,
          transactionDescription: metadata.transactionDescription,
          providerTransactionId: providerTransactionId,
          providerResponse: metadata,
          completedOn: metadata.completedOn,
        },
      });

      logger.info("Monnify: Withdrawal marked as failed", {
        transactionId: transaction._id,
      });

      // Refund wallet
      try {
        const serviceCharge = transaction.meta?.chargeInfo?.serviceCharge || 0;
        const mainRefundAmount = transaction.amount + serviceCharge;

        const linkedStampDutyTxn = await this.transactionRepository.findOne({
          linkedTransactionId: transaction._id,
          type: TRANSACTION_TYPES.STAMP_DUTY,
        });
        const stampDutyAmount = linkedStampDutyTxn?.amount || 0;

        if (linkedStampDutyTxn && linkedStampDutyTxn.status !== "failed") {
          await Transaction.findByIdAndUpdate(linkedStampDutyTxn._id, {
            status: "failed",
            meta: {
              ...linkedStampDutyTxn.meta,
              failureReason: metadata.failureReason,
              completedOn: metadata.completedOn,
            },
          });
        }

        await this.walletService.creditWallet(
          transaction.sourceId || transaction.userId,
          mainRefundAmount,
          "Withdrawal refund",
          {
            type: "refund",
            provider: "monnify",
            idempotencyKey: `${reference}_webhook_refund`,
            initiatedByType: "system",
            linkedTransactionId: transaction._id as Types.ObjectId,
            remark: `Withdrawal refund - failed`,
            meta: {
              originalReference: reference,
              reason: "disbursement_failed",
              failureReason: metadata.failureReason,
            },
          },
        );

        if (linkedStampDutyTxn && stampDutyAmount > 0) {
          await this.walletService.creditWallet(
            transaction.sourceId || transaction.userId,
            stampDutyAmount,
            "Stamp duty refund",
            {
              type: "refund",
              provider: "monnify",
              idempotencyKey: `${reference}_webhook_stamp_duty_refund`,
              initiatedByType: "system",
              linkedTransactionId: linkedStampDutyTxn._id as Types.ObjectId,
              remark: `Stamp duty refund - failed`,
              meta: {
                originalReference: reference,
                reason: "disbursement_failed",
                failureReason: metadata.failureReason,
              },
            },
          );
        }

        logger.info("Monnify: Wallet refunded for failed withdrawal", {
          userId: transaction.sourceId?.toString(),
          amount: mainRefundAmount + stampDutyAmount,
          reference,
        });
        await this.auditLoggingService
          .logTransactionEvent({
            userId: new Types.ObjectId(transaction.sourceId),
            transactionId: transaction._id.toString(),
            transactionReference: reference,
            action: "reversed",
            previousStatus: transaction.status,
            newStatus: "failed",
            amount: mainRefundAmount + stampDutyAmount,
            reason: metadata.failureReason || "disbursement_failed",
            provider: "monnify",
            initiatedBy: "webhook",
          })
          .catch((err) =>
            logger.error("Failed to log transaction event:", err),
          );
        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference,
          provider: "monnify",
        });
      } catch (refundError) {
        logger.error("Monnify: Refund failed", {
          error: refundError,
          transactionId: transaction._id,
        });

        throw refundError;
      }

      // Send notification
      try {
        await this.notificationService.createNotification({
          type: "withdrawal_failed",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(transaction.sourceId),
          sendEmail: false,
          sendSMS: false,
          sendPush: true,
          data: {
            amount: transaction.amount,
            reference,
            provider: "Monnify",
            failureReason: metadata.failureReason,
            refunded: true,
          },
        });
      } catch (notificationError) {
        logger.warn("Monnify: Failed to send failure notification", {
          error: notificationError,
          userId: transaction.sourceId,
        });
      }

      logger.info("Monnify: Failed withdrawal processed and refunded", {
        reference,
        amount: transaction.amount,
      });
    } catch (error: any) {
      logger.error("Monnify: Failed disbursement processing error", {
        error,
        reference,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "monnify",
        error: error?.message || "Unknown error",
      });

      throw error;
    }
  }

  // SCENARIO 5: REVERSED WITHDRAWAL/TRANSFER

  private async handleReversedDisbursement(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: reference || providerTransactionId!,
      provider: "monnify",
    });
    try {
      logger.info("Monnify: Processing reversed withdrawal", {
        reference,
        providerTransactionId,
        amount: metadata.amount,
      });

      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "monnify",
      });

      if (!transaction) {
        logger.error(
          "Monnify: Transaction not found for reversed disbursement",
          { reference },
        );
        throw new AppError(
          "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // Check if already processed
      if (transaction.status === "reversed") {
        logger.info("Monnify: Withdrawal already marked as reversed", {
          transactionId: transaction._id,
        });
        return;
      }

      // Update transaction to reversed
      const session = await mongoose.startSession();
      session.startTransaction();

      const serviceCharge = transaction.meta?.chargeInfo?.serviceCharge || 0;
      const mainRefundAmount = transaction.amount + serviceCharge;
      const linkedStampDutyTxn = await this.transactionRepository.findOne({
        linkedTransactionId: transaction._id,
        type: TRANSACTION_TYPES.STAMP_DUTY,
      });
      const stampDutyAmount = linkedStampDutyTxn?.amount || 0;

      try {
        await Transaction.findOneAndUpdate(
          { _id: transaction._id, status: { $in: ["pending", "processing"] } },
          {
            $set: {
              status: "reversed",
              meta: {
                ...transaction.meta,
                monnifyTransactionReference:
                  metadata.monnifyTransactionReference,
                reversalReason: "Disbursement reversed by Monnify",
                providerTransactionId: providerTransactionId,
                providerResponse: metadata,
                completedOn: metadata.completedOn,
              },
            },
          },
          { session },
        );

        if (linkedStampDutyTxn && linkedStampDutyTxn.status !== "reversed") {
          await Transaction.findOneAndUpdate(
            {
              _id: linkedStampDutyTxn._id,
              status: { $in: ["pending", "processing"] },
            },
            {
              $set: {
                status: "reversed",
                meta: {
                  ...linkedStampDutyTxn.meta,
                  reversalReason: "Disbursement reversed by Monnify",
                  completedOn: metadata.completedOn,
                },
              },
            },
            { session },
          );
        }

        await session.commitTransaction();

        await this.walletService.creditWallet(
          transaction.sourceId || transaction.userId,
          mainRefundAmount,
          "Withdrawal refund",
          {
            type: "refund",
            provider: "monnify",
            idempotencyKey: `${reference}_webhook_refund`,
            initiatedByType: "system",
            linkedTransactionId: transaction._id as Types.ObjectId,
            remark: `Withdrawal refund - reversed`,
            meta: {
              originalReference: reference,
              reason: "disbursement_reversed_by_provider",
            },
          },
        );

        if (linkedStampDutyTxn && stampDutyAmount > 0) {
          await this.walletService.creditWallet(
            transaction.sourceId || transaction.userId,
            stampDutyAmount,
            "Stamp duty refund",
            {
              type: "refund",
              provider: "monnify",
              idempotencyKey: `${reference}_webhook_stamp_duty_refund`,
              initiatedByType: "system",
              linkedTransactionId: linkedStampDutyTxn._id as Types.ObjectId,
              remark: `Stamp duty refund - reversed`,
              meta: {
                originalReference: reference,
                reason: "disbursement_reversed_by_provider",
              },
            },
          );
        }

        logger.info("Monnify: Withdrawal reversed and wallet refunded", {
          userId: transaction.sourceId?.toString(),
          amount: mainRefundAmount + stampDutyAmount,
          reference,
        });

        await this.auditLoggingService
          .logTransactionEvent({
            userId: new Types.ObjectId(transaction.sourceId),
            transactionId: transaction._id.toString(),
            transactionReference: reference,
            action: "reversed",
            previousStatus: transaction.status,
            newStatus: "reversed",
            amount: mainRefundAmount + stampDutyAmount,
            reason: "disbursement_reversed_by_provider",
            provider: "monnify",
            initiatedBy: "webhook",
          })
          .catch((err) =>
            logger.error("Failed to log transaction event:", err),
          );

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference,
          provider: "monnify",
        });
      } catch (refundError) {
        if (session.inTransaction()) await session.abortTransaction();
        logger.error("Monnify: Reversal failed", {
          error: refundError,
          transactionId: transaction._id,
        });
        throw refundError;
      } finally {
        session.endSession();
      }

      // Send notification
      try {
        await this.notificationService.createNotification({
          type: "withdrawal_reversed",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(transaction.sourceId),
          sendEmail: false,
          sendSMS: false,
          sendPush: true,
          data: {
            amount: transaction.amount,
            reference,
            provider: "Monnify",
            refunded: true,
          },
        });
      } catch (notificationError) {
        logger.warn("Monnify: Failed to send reversal notification", {
          error: notificationError,
          userId: transaction.sourceId,
        });
      }

      logger.info("Monnify: Reversed withdrawal processed and refunded", {
        reference,
        amount: transaction.amount,
      });
    } catch (error: any) {
      logger.error("Monnify: Reversed disbursement processing error", {
        error,
        reference,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "monnify",
        error: error?.message || "Unknown error",
      });
      throw error;
    }
  }

  // Check if transaction already processed (idempotency)
  private async checkIdempotency(
    providerTransactionId?: string,
  ): Promise<boolean> {
    if (!providerTransactionId) return false;

    const existingTransaction = await this.transactionRepository.findOne({
      $or: [
        { providerReference: providerTransactionId },
        { "meta.providerTransactionId": providerTransactionId },
        { "meta.monnifyTransactionReference": providerTransactionId },
      ],
      provider: "monnify",
    });

    return !!existingTransaction;
  }
}
