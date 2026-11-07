import { Transaction } from "@/models/wallet/Transaction";
import { IWallet, Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { VirtualAccount } from "@/models/banking/VirtualAccount";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { DepositRepository } from "@/repositories/client/DepositRepository";
import { WebhookProcessResult } from "@/services/WebhookService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  SYSTEM,
  TRANSACTION_TYPES,
  CACHE_KEYS,
} from "@/utils/constants";
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

// FLUTTERWAVE WEBHOOK SERVICE - COMPLETE
// Handles all payment scenarios:
// 1. Virtual Account Deposits (user sends to their assigned account)
// 2. Card Payments (user pays with card)
// 3. Withdrawals/Transfers (user requests payout)

export class FlutterwaveWebhookService {
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
      logger.info("Flutterwave webhook service: Processing started", {
        providerTransactionId,
        eventType: metadata.eventType,
        status: webhookData.status,
        txRef: metadata.txRef,
        paymentMethod: metadata.paymentMethod,
      });

      // Check idempotency - prevent duplicate processing
      const isDuplicate = await this.checkIdempotency(providerTransactionId);
      if (isDuplicate) {
        logger.info("Flutterwave webhook: Duplicate transaction, skipping", {
          providerTransactionId,
        });
        return;
      }

      // Route based on event type
      switch (metadata.eventType) {
        case "charge.completed":
          await this.handleChargeEvent(webhookData);
          break;

        case "transfer.completed":
          await this.handleTransferEvent(webhookData);
          break;

        default:
          logger.warn(`Unsupported Flutterwave event: ${metadata.eventType}`);
      }

      logger.info("Flutterwave webhook service: Processing completed", {
        providerTransactionId,
        eventType: metadata.eventType,
      });
    } catch (error) {
      logger.error("Flutterwave webhook service: Processing error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async handleChargeEvent(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    switch (webhookData.status) {
      case "success":
        await this.handleSuccessfulCharge(webhookData);
        break;

      case "failed":
        await this.handleFailedCharge(webhookData);
        break;

      case "pending":
        logger.info("Flutterwave charge pending, waiting for completion", {
          reference: webhookData.reference,
        });
        break;

      default:
        logger.warn("Unexpected charge status", {
          status: webhookData.status,
          reference: webhookData.reference,
        });
    }
  }

  private async handleTransferEvent(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    switch (webhookData.status) {
      case "success":
        await this.handleSuccessfulTransfer(webhookData);
        break;

      case "failed":
        await this.handleFailedTransfer(webhookData);
        break;

      case "reversed":
        await this.handleReversedTransfer(webhookData);
        break;

      case "pending":
        logger.info("Flutterwave transfer pending, waiting for completion", {
          reference: webhookData.reference,
        });
        break;

      default:
        logger.warn("Unexpected transfer status", {
          status: webhookData.status,
          reference: webhookData.reference,
        });
    }
  }

  // SCENARIO 1: VIRTUAL ACCOUNT DEPOSIT (charge.completed)
  // SCENARIO 2: CARD PAYMENT (charge.completed)
  // Both handled in handleSuccessfulCharge

  private async handleSuccessfulCharge(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { providerTransactionId, providerReference, status, metadata } =
      webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference:
        webhookData.reference || metadata.txRef || providerReference,
      provider: "flutterwave",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference:
        webhookData.reference || metadata.txRef || providerReference,
      provider: "flutterwave",
    });
    await this.auditLoggingService
      .logWebhookEvent({
        provider: "flutterwave",
        webhookType: "charge",
        transactionReference: webhookData.reference,
        status: "received",
        details: {
          amount: metadata.amount,
          chargedAmount: metadata.charged_amount,
          paymentType: metadata.payment_type,
        },
      })
      .catch((err) => logger.error("Failed to log webhook event:", err));

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info("Flutterwave: Processing wallet funding", {
        providerTransactionId,
        txRef: metadata.txRef,
        paymentMethod: metadata.paymentMethod,
        accountNumber: metadata.accountNumber,
        amount: metadata.amount,
        status,
      });

      let userId: string;
      let paymentSource: "virtual_account" | "card" = "card"; // Default

      //  Identify user based on payment scenario

      // SCENARIO 1: Virtual Account Deposit
      if (metadata.accountNumber) {
        logger.info(
          "Flutterwave: Virtual account deposit detected - finding user by account number",
        );
        paymentSource = "virtual_account";

        const virtualAccount = await this.virtualAccountRepository.findOne({
          accountNumber: metadata.accountNumber,
          provider: "flutterwave",
          isActive: true,
        });

        if (!virtualAccount) {
          await session.abortTransaction();
          logger.error("Flutterwave: Virtual account not found", {
            accountNumber: metadata.accountNumber,
            providerTransactionId,
          });
          throw new AppError(
            "Virtual account not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        userId = virtualAccount.userId.toString();
        logger.info("Flutterwave: Found user via virtual account", {
          userId,
          accountNumber: metadata.accountNumber,
        });
      }
      // SCENARIO 2: Card Payment
      else if (metadata.txRef) {
        logger.info(
          "Flutterwave: Card payment detected - looking up user by txRef",
        );
        paymentSource = "card";

        // Look up userId from Redis cache (stored when payment was initiated)
        const cachedUserId = await cacheService.get<string>(
          `payment:${metadata.txRef}`,
        );

        if (!cachedUserId) {
          await session.abortTransaction();
          logger.error("Flutterwave: User not found for card payment", {
            txRef: metadata.txRef,
            providerTransactionId,
          });
          throw new AppError(
            "User not found for this payment",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        userId = cachedUserId;
        logger.info("Flutterwave: Found user via txRef lookup", {
          userId,
          txRef: metadata.txRef,
        });

        // Clean up Redis cache after successful lookup
        await cacheService.delete(`payment:${metadata.txRef}`);
      }
      // Fallback: Cannot identify user
      else {
        await session.abortTransaction();
        logger.error("Flutterwave: Cannot identify user for charge", {
          metadata,
          providerTransactionId,
        });
        throw new AppError(
          "Cannot identify user for payment",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      //  Check if deposit already processed (idempotency)

      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: providerReference },
          { providerReference: metadata.flwRef },
          { "meta.txRef": metadata.txRef },
          { "meta.flutterwaveId": metadata.flutterwaveId },
        ],
        provider: "flutterwave",
        type: "deposit",
      });

      if (existingTransaction) {
        await session.abortTransaction();
        logger.info("Flutterwave: Deposit already processed", {
          transactionId: existingTransaction._id,
          providerReference,
        });
        return;
      }

      //  Get wallet and capture balance

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
      const grossAmount = metadata.netAmount || metadata.amount || 0;

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          grossAmount,
          TRANSACTION_TYPES.DEPOSIT,
        );

      const amountToCredit = grossAmount - chargeCalculation.chargeAmount;

      //  Create Deposit record (audit trail)

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId: userId,
            walletId: wallet._id,
            reference: depositReference,
            provider: "flutterwave",
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
              flutterwaveId: metadata.flutterwaveId,
              txRef: metadata.txRef,
              flwRef: metadata.flwRef,
              fees: metadata.fees,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              currency: metadata.currency,
              paymentMethod: metadata.paymentMethod,
              paymentSource: paymentSource,
              customerEmail: metadata.customerEmail,
              debitAccountName: metadata.customerName || "N/A",
              unsolicited: paymentSource === "virtual_account",
            },
          },
        ],
        { session },
      );

      logger.info("Flutterwave: Deposit record created", {
        depositId: deposit[0]._id,
        reference: depositReference,
        userId,
        paymentSource,
      });
      const senderName = metadata.customerName;
      const remarkText =
        senderName && senderName !== "N/A"
          ? `Deposit from ${senderName}`
          : "Wallet funded";

      //  Create Transaction record (user-facing)

      const transactionReference = generateReference("TXN");
      const transaction = await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: userId,
            userId: userId,
            reference: transactionReference,
            providerReference: metadata.flwRef || providerReference,
            idempotencyKey: metadata.txRef || providerReference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount: amountToCredit,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            provider: "flutterwave",
            status: "success",
            purpose: `deposit`,
            remark: remarkText,
            balanceBefore,
            balanceAfter: balanceBefore + amountToCredit,
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
              provider: "flutterwave",
              flutterwaveId: metadata.flutterwaveId,
              txRef: metadata.txRef,
              flwRef: metadata.flwRef,
              fees: metadata.fees,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              currency: metadata.currency,
              paymentMethod: metadata.paymentMethod,
              paymentSource: paymentSource,
              customerEmail: metadata.customerEmail,
              debitAccountName: metadata.customerName || "N/A",
              providerTransactionId: providerTransactionId,
            },
          },
        ],
        { session },
      );

      logger.info("Flutterwave: Transaction record created", {
        transactionId: transaction[0]._id,
        reference: transactionReference,
        userId,
      });

      // Credit wallet

      const updatedWallet = await Wallet.findByIdAndUpdate(
        wallet._id,
        { $inc: { balance: amountToCredit } },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new Error("Failed to update wallet balance");
      }

      logger.info("Flutterwave: Wallet credited", {
        userId: userId.toString(),
        amount: amountToCredit,
        newBalance: updatedWallet.balance,
        reference: transactionReference,
      });

      // Commit all changes atomically
      await session.commitTransaction();

      if (updatedWallet) {
        try {
          await cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
        } catch (cacheErr) {
          logger.error("Flutterwave: failed to invalidate wallet cache:", cacheErr);
        }

        SocketService.emitToUser(userId.toString(), "wallet_credit", {
          balance: updatedWallet.balance,
          bonusBalance: updatedWallet.bonusBalance,
          commissionBalance: updatedWallet.commissionBalance,
          amount: amountToCredit,
          direction: "CREDIT",
          type: "deposit",
          reference: transactionReference,
          reason: remarkText || "Wallet funded via Flutterwave",
          timestamp: new Date().toISOString(),
        });
      }
      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(userId),
          transactionId: transaction[0]._id.toString(),
          transactionReference: transactionReference,
          action: "status_changed",
          previousStatus: "pending",
          newStatus: "success",
          amount: metadata.amount,
          balanceAfter: updatedWallet?.balance,
          reason: "webhook_received",
          provider: "flutterwave",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));
      await this.webhookDeliveryService.recordWebhookProcessingSuccess({
        transactionReference: transactionReference,
        provider: "flutterwave",
      });
      //: Send notification (outside session)

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
            provider: "Flutterwave",
            paymentMethod: metadata.paymentMethod,
            paymentSource: paymentSource,
            balance: updatedWallet.balance,
          },
        });
      } catch (notificationError) {
        logger.warn("Flutterwave: Failed to send notification (non-critical)", {
          error: notificationError,
          userId,
        });
      }

      logger.info("Flutterwave: Wallet funded successfully", {
        userId: userId.toString(),
        amount: amountToCredit,
        reference: transactionReference,
        paymentSource,
        providerTransactionId,
      });
    } catch (error: any) {
      // Only abort if transaction is still active
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      logger.error("Flutterwave: Wallet funding error", {
        error: error.message,
        providerTransactionId,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference:
          webhookData.reference || metadata.txRef || providerReference,
        provider: "flutterwave",
        error: error?.message || "Unknown error",
      });
      throw error;
    } finally {
      session.endSession();
    }
  }

  // SCENARIO 1: FAILED VIRTUAL ACCOUNT DEPOSIT
  // SCENARIO 2: FAILED CARD PAYMENT

  private async handleFailedCharge(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { providerTransactionId, providerReference, metadata } = webhookData;

    try {
      logger.info("Flutterwave: Processing failed charge", {
        providerTransactionId,
        txRef: metadata.txRef,
        paymentMethod: metadata.paymentMethod,
        amount: metadata.amount,
      });

      let userId: string | null = null;

      // Try to find user from virtual account
      if (metadata.accountNumber) {
        const virtualAccount = await this.virtualAccountRepository.findOne({
          accountNumber: metadata.accountNumber,
          provider: "flutterwave",
          isActive: true,
        });

        if (virtualAccount) {
          userId = virtualAccount.userId.toString();
        }
      }

      // Try to find user from Redis cache (card payment)
      if (!userId && metadata.txRef) {
        const cachedUserId = await cacheService.get<string>(
          `payment:${metadata.txRef}`,
        );
        if (cachedUserId) {
          userId = cachedUserId;
          // Clean up cache
          await cacheService.delete(`payment:${metadata.txRef}`);
        }
      }

      if (!userId) {
        logger.warn("Flutterwave: Could not identify user for failed charge", {
          txRef: metadata.txRef,
          accountNumber: metadata.accountNumber,
        });
        return;
      }

      // Check if already processed
      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: providerReference },
          { "meta.txRef": metadata.txRef },
        ],
        provider: "flutterwave",
        type: "deposit",
        status: "failed",
      });

      if (existingTransaction) {
        logger.info("Flutterwave: Failed charge already recorded", {
          transactionId: existingTransaction._id,
        });
        return;
      }

      // Get wallet
      const wallet = await this.walletRepository.findByUserId(userId);
      if (!wallet) {
        logger.warn("Flutterwave: Wallet not found for failed charge", {
          userId,
        });
        return;
      }

      // Create failed Deposit record
      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create({
        userId: userId,
        walletId: wallet._id,
        reference: depositReference,
        provider: "flutterwave",
        amount: metadata.amount || 0,
        status: "failed",
        meta: {
          providerResponse: metadata,
          providerReference: providerReference,
          providerTransactionId: providerTransactionId,
          failureReason: metadata.failureReason || "Payment failed",
          paymentMethod: metadata.paymentMethod,
        },
      });

      // Create failed Transaction record
      const transactionReference = generateReference("TXN");
      const transaction = await Transaction.create({
        walletId: wallet._id,
        sourceId: userId,
        userId,
        reference: transactionReference,
        providerReference: metadata.flwRef || providerReference,
        idempotencyKey: metadata.txRef || providerReference,
        transactableType: "Deposit",
        transactableId: deposit._id,
        amount: metadata.amount || 0,
        direction: "CREDIT",
        type: TRANSACTION_TYPES.DEPOSIT,
        provider: "flutterwave",
        status: "failed",
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        initiatedBy: userId,
        initiatedByType: SYSTEM.PROVIDER,
        meta: {
          depositId: deposit._id,
          depositReference: depositReference,
          failureReason: metadata.failureReason || "Payment failed",
          txRef: metadata.txRef,
          flwRef: metadata.flwRef,
        },
      });
      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(transaction.sourceId),
          transactionId: transaction._id.toString(),
          transactionReference: transaction.reference,
          action: "status_changed",
          previousStatus: transaction.status,
          newStatus: "failed",
          reason: metadata.failureReason || "charge_failed",
          provider: "flutterwave",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));

      try {
        await this.notificationService.createNotification({
          type: "payment_failed",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(userId),
          sendEmail: false,
          sendSMS: false,
          sendPush: true,
          data: {
            transactionType: "Wallet Funding",
            amount: metadata.amount,
            reference: transactionReference,
            provider: "Flutterwave",
            reason: metadata.failureReason || "Payment failed",
          },
        });
      } catch (notificationError) {
        logger.warn("Flutterwave: Failed to send notification (non-critical)", {
          error: notificationError,
          userId,
        });
      }

      logger.info("Flutterwave: Failed charge processed", {
        reference: transactionReference,
        reason: metadata.failureReason,
      });
    } catch (error) {
      logger.error("Flutterwave: Failed charge processing error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  // SCENARIO 3: SUCCESSFUL WITHDRAWAL/TRANSFER

  private async handleSuccessfulTransfer(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference:
        reference || metadata.transferId || providerTransactionId,
      provider: "flutterwave",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference:
        reference || metadata.transferId || providerTransactionId,
      provider: "flutterwave",
    });
    try {
      logger.info("Flutterwave: Processing successful withdrawal", {
        reference,
        providerTransactionId,
        transferId: metadata.transferId,
        amount: metadata.amount,
      });

      // Find the withdrawal transaction that was created by user
      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "flutterwave",
      });

      if (!transaction) {
        logger.error("Flutterwave: Withdrawal transaction not found", {
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
        logger.info("Flutterwave: Withdrawal already processed", {
          transactionId: transaction._id,
          currentStatus: transaction.status,
        });
        return;
      }

      // Update transaction to success
      await this.transactionRepository.update(transaction.id.toString(), {
        status: "success",
        providerReference: metadata.transferId || providerTransactionId,
        profit:
          (transaction.meta?.chargeInfo?.serviceCharge || 0) -
          ((metadata.fees || 0) +
            (metadata.vat || 0) +
            (metadata.stampDuty || 0)),
        meta: {
          ...transaction.meta,
          transferId: metadata.transferId,
          flutterwaveId: metadata.flutterwaveId,
          providerTransactionId: providerTransactionId,
          providerResponse: metadata,
          completedAt: new Date(),
        },
      });

      logger.info("Flutterwave: Withdrawal marked as success", {
        transactionId: transaction._id,
        transferId: metadata.transferId,
      });

      const userId = transaction.sourceId;
      const amount = transaction.amount;

      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(transaction.sourceId),
          transactionId: transaction._id.toString(),
          transactionReference: transaction.reference,
          action: "status_changed",
          previousStatus: transaction.status,
          newStatus: "success",
          amount: transaction.amount,
          reason: "transfer_successful",
          provider: "flutterwave",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));

      await this.webhookDeliveryService.recordWebhookProcessingSuccess({
        transactionReference: reference,
        provider: "flutterwave",
      });
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
            provider: "Flutterwave",
            destinationAccountNumber: metadata.destinationAccountNumber,
            destinationAccountName: metadata.destinationAccountName,
            destinationBankName: metadata.destinationBankName,
            completedOn: metadata.completedOn,
          },
        });
      } catch (notificationError) {
        logger.warn("Flutterwave: Failed to send withdrawal notification", {
          error: notificationError,
          userId,
        });
      }
      logger.info("Flutterwave: Withdrawal completed successfully", {
        reference,
        amount,
        transferId: metadata.transferId,
      });
    } catch (error: any) {
      logger.error("Flutterwave: Withdrawal processing error", {
        error,
        reference,
        providerTransactionId,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "flutterwave",
        error: error?.message || "Unknown error",
      });
      throw error;
    }
  }

  // SCENARIO 4: FAILED WITHDRAWAL/TRANSFER

  private async handleFailedTransfer(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    let refundedWallet: IWallet | null = null;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: reference || providerTransactionId!,
      provider: "flutterwave",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: reference || providerTransactionId!,
      provider: "flutterwave",
    });
    try {
      logger.info("Flutterwave: Processing failed withdrawal", {
        reference,
        providerTransactionId,
        failureReason: metadata.failureReason,
      });

      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "flutterwave",
      });

      if (!transaction) {
        logger.error("Flutterwave: Transaction not found for failed transfer", {
          reference,
        });
        throw new AppError(
          "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // Check if already processed
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
          error: metadata.failureReason || "Transfer failed",
          providerTransactionId: providerTransactionId,
          providerResponse: metadata,
          failedAt: new Date(),
        },
      });

      logger.info("Flutterwave: Withdrawal marked as failed", {
        transactionId: transaction._id,
      });

      // Refund wallet (amount + service charge + stamp duty go back to user)
      const serviceCharge = transaction.meta?.chargeInfo?.serviceCharge || 0;
      const mainRefundAmount = transaction.amount + serviceCharge;
      const linkedStampDutyTxn = await this.transactionRepository.findOne({
        linkedTransactionId: transaction._id,
        type: TRANSACTION_TYPES.STAMP_DUTY,
      });
      const stampDutyAmount = linkedStampDutyTxn?.amount || 0;

      try {
        const mainCredit = await this.walletService.creditWallet(
          transaction.sourceId || transaction.userId,
          mainRefundAmount,
          "Withdrawal refund",
          {
            type: "refund",
            provider: "flutterwave",
            idempotencyKey: `${reference}_webhook_refund`,
            initiatedByType: "system",
            linkedTransactionId: transaction._id as Types.ObjectId,
            remark: `Withdrawal refund - failed`,
            meta: {
              originalReference: reference,
              reason: "transfer_failed",
            },
          },
        );
        refundedWallet = { balance: mainCredit.balanceAfter } as IWallet;

        if (linkedStampDutyTxn && stampDutyAmount > 0) {
          const stampDutyCredit = await this.walletService.creditWallet(
            transaction.sourceId || transaction.userId,
            stampDutyAmount,
            "Stamp duty refund",
            {
              type: "refund",
              provider: "flutterwave",
              idempotencyKey: `${reference}_webhook_stamp_duty_refund`,
              initiatedByType: "system",
              linkedTransactionId: linkedStampDutyTxn._id as Types.ObjectId,
              remark: `Stamp duty refund - failed`,
              meta: {
                originalReference: reference,
                reason: "transfer_failed",
              },
            },
          );
          refundedWallet = { balance: stampDutyCredit.balanceAfter } as IWallet;
        }

        logger.info("Flutterwave: Wallet refunded for failed withdrawal", {
          userId: transaction.sourceId?.toString(),
          amount: mainRefundAmount + stampDutyAmount,
          reference,
        });
      } catch (refundError) {
        logger.error("Flutterwave: Refund failed", {
          error: refundError,
          transactionId: transaction._id,
        });
        throw refundError;
      }
      await this.auditLoggingService
        .logTransactionEvent({
          userId: new Types.ObjectId(transaction.sourceId),
          transactionId: transaction._id.toString(),
          transactionReference: transaction.reference,
          action: "reversed",
          previousStatus: transaction.status,
          newStatus: "failed",
          amount: mainRefundAmount + stampDutyAmount,
          balanceAfter: refundedWallet?.balance,
          reason: metadata.failureReason || "transfer_failed",
          provider: "flutterwave",
          initiatedBy: "webhook",
        })
        .catch((err) => logger.error("Failed to log transaction event:", err));

      await this.webhookDeliveryService.recordWebhookProcessingSuccess({
        transactionReference: reference,
        provider: "flutterwave",
      });
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
            provider: "Flutterwave",
            failureReason: metadata.failureReason,
            refunded: true,
          },
        });
      } catch (notificationError) {
        logger.warn("Flutterwave: Failed to send failure notification", {
          error: notificationError,
          userId: transaction.sourceId,
        });
      }
      logger.info("Flutterwave: Failed withdrawal processed and refunded", {
        reference,
        amount: transaction.amount,
      });
    } catch (error: any) {
      logger.error("Flutterwave: Failed transfer processing error", {
        error,
        reference,
      });

      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "flutterwave",
        error: error?.message || "Unknown error",
      });
      throw error;
    }
  }

  // SCENARIO 5: REVERSED WITHDRAWAL/TRANSFER

  private async handleReversedTransfer(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerTransactionId, metadata } = webhookData;
    let refundedWallet: IWallet | null = null;
    await this.webhookDeliveryService.recordWebhookReceived({
      transactionReference: reference || providerTransactionId!,
      provider: "flutterwave",
      webhookPayload: webhookData,
      providerTransactionId,
    });

    await this.webhookDeliveryService.recordWebhookProcessingStarted({
      transactionReference: reference || providerTransactionId!,
      provider: "flutterwave",
    });
    try {
      logger.info("Flutterwave: Processing reversed withdrawal", {
        reference,
        providerTransactionId,
        reversalReason: metadata.failureReason,
      });

      const transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "flutterwave",
      });

      if (!transaction) {
        logger.error(
          "Flutterwave: Transaction not found for reversed transfer",
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
        logger.info("Flutterwave: Withdrawal already marked as reversed", {
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
                reversedAt: new Date(),
                reversalReason: metadata.failureReason || "Transfer reversed",
                providerTransactionId: providerTransactionId,
                providerResponse: metadata,
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
                  reversedAt: new Date(),
                  reversalReason: metadata.failureReason || "Transfer reversed",
                },
              },
            },
            { session },
          );
        }

        await session.commitTransaction();

        const mainCredit = await this.walletService.creditWallet(
          transaction.sourceId || transaction.userId,
          mainRefundAmount,
          "Withdrawal refund",
          {
            type: "refund",
            provider: "flutterwave",
            idempotencyKey: `${reference}_webhook_refund`,
            initiatedByType: "system",
            linkedTransactionId: transaction._id as Types.ObjectId,
            remark: `Withdrawal refund - reversed`,
            meta: {
              originalReference: reference,
              reason: "transfer_reversed_by_provider",
            },
          },
        );
        refundedWallet = { balance: mainCredit.balanceAfter } as IWallet;

        if (linkedStampDutyTxn && stampDutyAmount > 0) {
          const stampDutyCredit = await this.walletService.creditWallet(
            transaction.sourceId || transaction.userId,
            stampDutyAmount,
            "Stamp duty refund",
            {
              type: "refund",
              provider: "flutterwave",
              idempotencyKey: `${reference}_webhook_stamp_duty_refund`,
              initiatedByType: "system",
              linkedTransactionId: linkedStampDutyTxn._id as Types.ObjectId,
              remark: `Stamp duty refund - reversed`,
              meta: {
                originalReference: reference,
                reason: "transfer_reversed_by_provider",
              },
            },
          );
          refundedWallet = { balance: stampDutyCredit.balanceAfter } as IWallet;
        }

        logger.info("Flutterwave: Withdrawal reversed and wallet refunded", {
          userId: transaction.sourceId?.toString(),
          amount: mainRefundAmount + stampDutyAmount,
          reference,
        });

        await this.auditLoggingService
          .logTransactionEvent({
            userId: new Types.ObjectId(transaction.sourceId),
            transactionId: transaction._id.toString(),
            transactionReference: transaction.reference,
            action: "reversed",
            previousStatus: transaction.status,
            newStatus: "reversed",
            amount: mainRefundAmount + stampDutyAmount,
            balanceAfter: refundedWallet?.balance,
            reason: "transfer_reversed_by_provider",
            provider: "flutterwave",
            initiatedBy: "webhook",
          })
          .catch((err) =>
            logger.error("Failed to log transaction event:", err),
          );

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference,
          provider: "flutterwave",
        });
      } catch (refundError) {
        if (session.inTransaction()) await session.abortTransaction();
        logger.error("Flutterwave: Reversal failed", {
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
            provider: "Flutterwave",
            refunded: true,
          },
        });
      } catch (notificationError) {
        logger.warn("Flutterwave: Failed to send reversal notification", {
          error: notificationError,
          userId: transaction.sourceId,
        });
      }

      logger.info("Flutterwave: Reversed withdrawal processed and refunded", {
        reference,
        amount: transaction.amount,
      });
    } catch (error: any) {
      logger.error("Flutterwave: Reversed transfer processing error", {
        error,
        reference,
      });
      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "flutterwave",
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
        { "meta.flutterwaveId": providerTransactionId },
      ],
      provider: "flutterwave",
    });

    return !!existingTransaction;
  }
}
