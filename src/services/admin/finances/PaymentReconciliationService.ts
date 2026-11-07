import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { TRANSACTION_STATUS, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import mongoose from "mongoose";
import { FlutterwaveService } from "../../client/providers/payments/FlutterwaveService";
import { MonnifyService } from "../../client/providers/payments/MonnifyService";
import { EmailService } from "../../core/EmailService";
import { IUser, User } from "@/models/core/User";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { WalletService } from "@/services/client/wallet/WalletService";
import SocketService from "@/services/core/SocketService";
import ServiceContainer from "@/services/client/container";

export class PaymentReconciliationService {
  constructor(
    private flutterwaveService: FlutterwaveService,
    private monnifyService: MonnifyService,
    private saveHavenService: SaveHavenService,
    private emailService: EmailService,
    private auditLoggingService: AuditLoggingService,
    private walletService: WalletService,
  ) {}

  async reconcilePendingTransactions(): Promise<{
    successCount: number;
    reversalCount: number;
    stuckCount: number;
    errorCount: number;
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      // Find transactions stuck in PENDING for > 5 minutes
      // Or PROCESSING for > 30 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const thirtySecsAgo = new Date(Date.now() - 30 * 1000);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      const stuckTransactions = await Transaction.find({
        $or: [
          {
            // Find PENDING transactions (but NOT PENDING_MANUAL)
            status: TRANSACTION_STATUS.PENDING,
            createdAt: { $lt: fiveMinutesAgo },
            type: {
              $in: [TRANSACTION_TYPES.WITHDRAWAL],
            },
            "meta.phase": { $ne: "manual_fallback" },
          },
          {
            // Find PROCESSING transactions
            status: TRANSACTION_STATUS.PROCESSING,
            createdAt: { $lt: thirtySecsAgo },
            type: {
              $in: [TRANSACTION_TYPES.WITHDRAWAL],
            },
            "meta.phase": { $nin: ["manual_fallback", "reconciled"] },
          },
        ],
      }).limit(50);

      let successCount = 0;
      let reversalCount = 0;
      let stuckCount = 0;
      let errorCount = 0;

      for (const txn of stuckTransactions) {
        try {
          const result = await this.reconcileTransaction(txn);

          if (result === "success") successCount++;
          else if (result === "reversed") reversalCount++;
          else if (result === "stuck") stuckCount++;
        } catch (err) {
          errorCount++;
          logger.error(`Failed to reconcile ${txn.reference}:`, err);
        }
      }

      const duration = Date.now() - startTime;

      return {
        successCount,
        reversalCount,
        stuckCount,
        errorCount,
        duration,
      };
    } catch (error: any) {
      logger.error("Reconciliation service error:", error);
      throw error;
    }
  }

  private async reconcileTransaction(
    txn: any,
  ): Promise<"success" | "reversed" | "stuck" | "skip"> {
    const reference = txn.reference;
    const provider = txn.provider;
    const providerReference =
      txn.meta?.providerResponse?.paymentReference || txn.providerReference;

    // These are being processed manually by admin and should never be auto-reversed
    if (
      txn.status === "pending_manual" ||
      txn.meta?.phase === "manual_fallback"
    ) {
      logger.info(
        `Skipping manual withdrawal/transfer: ${reference} (phase: ${txn.meta?.phase}, status: ${txn.status})`,
      );
      return "skip";
    }

    // Skip if already completed
    if (
      txn.status === TRANSACTION_STATUS.SUCCESS ||
      txn.status === TRANSACTION_STATUS.FAILED ||
      txn.status === TRANSACTION_STATUS.REVERSED
    ) {
      return "skip";
    }

    // If PENDING without provider reference, wait 15 minutes then reverse
    if (txn.status === TRANSACTION_STATUS.PENDING && !providerReference) {
      if (Date.now() - txn.createdAt.getTime() < 15 * 60 * 1000) {
        return "stuck";
      }
      // return await this.reverseTransaction(
      //   txn,
      //   "Provider was never called after 15 minutes",
      // );
    }

    // If has provider reference, query provider for status
    if (providerReference) {
      try {
        const result = await this.queryProviderStatus(
          provider,
          providerReference,
        );
        const providerStatus = result.status;
        const transferData = result.transferData;

        if (providerStatus === "success" || providerStatus === "completed") {
          await this.markAsSuccess(txn, transferData);

          return "success";
        }

        if (providerStatus === "failed") {
          return await this.reverseTransaction(
            txn,
            "Provider confirmed transfer failed",
          );
        }

        // Still processing or unknown
        return "stuck";
      } catch (err) {
        logger.error(`Failed to query provider for ${reference}:`, err);
        return "stuck";
      }
    }

    return "stuck";
  }

  // Updated to also exclude manual withdrawals from critical alerts
  async findCriticallyStuckTransactions(): Promise<any[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Manual withdrawals are expected to take time for admin processing
    const criticalTxns = await Transaction.find({
      $or: [
        {
          status: TRANSACTION_STATUS.PENDING,
          createdAt: { $lt: oneHourAgo },
          type: {
            $in: [TRANSACTION_TYPES.WITHDRAWAL],
          },
          "meta.phase": { $ne: "manual_fallback" }, // Exclude manual
        },
        {
          status: TRANSACTION_STATUS.PROCESSING,
          createdAt: { $lt: oneHourAgo },
          type: {
            $in: [TRANSACTION_TYPES.WITHDRAWAL],
          },
          "meta.phase": { $ne: "manual_fallback" }, // Exclude manual
        },
      ],
    });

    return criticalTxns;
  }

  // QUERY PROVIDER FOR TRANSFER STATUS
  private async queryProviderStatus(
    provider: string,
    providerReference: string,
  ): Promise<{ status: string; transferData: any }> {
    try {
      switch (provider) {
        case "flutterwave": {
          const result =
            await this.flutterwaveService.getTransferStatus(providerReference);
          const statusMap: Record<string, string> = {
            successful: "success",
            success: "success",
            failed: "failed",
            pending: "pending",
            new: "pending",
            reversed: "reversed",
          };

          const mappedStatus =
            statusMap[result.status?.toLowerCase()] ?? "unknown";
          return {
            status: mappedStatus,
            transferData: {
              id: result.id,
              amount: result.amount,
              app_fee: result.app_fee,
              currency: result.currency,
              status: result.status,
              tx_ref: result.tx_ref,
              flw_ref: result.flw_ref,
              bank_name: result.bank_name,
              account_number: result.account_number,
              full_name: result.full_name,
              narration: result.narration,
              created_at: result.created_at,
              processor_response: result.processor_response,
              _fullResponse: result._fullResponse,
            },
          };
        }

        case "monnify": {
          const result =
            await this.monnifyService.verifyTransfer(providerReference);
          const statusMap: Record<string, string> = {
            success: "success",
            paid: "success",
            failed: "failed",
            pending: "pending",
            processing: "pending",
            reversed: "reversed",
          };

          const mappedStatus =
            statusMap[result.status?.toLowerCase()] ?? "unknown";

          return {
            status: mappedStatus,
            transferData: {
              transactionReference: result.transactionReference,
              paymentReference: result.paymentReference,
              amount: result.amount,
              amountPaid: result.amountPaid,
              settlementAmount: result.settlementAmount,
              status: result.status,
              paymentStatus: result.paymentStatus,
              currency: result.currency,
              paidOn: result.paidOn,
              _calculatedFee: result._calculatedFee,
              _fullResponse: result._fullResponse,
            },
          };
        }
        case "saveHaven": {
          const result =
            await this.saveHavenService.getTransferStatus(providerReference);

          // Map SaveHaven transfer statuses to reconciliation statuses
          if (result.isReversed) {
            return { status: "failed", transferData: result };
          }

          const statusMap: Record<string, string> = {
            Completed: "success",
            completed: "success",
            Failed: "failed",
            failed: "failed",
            Declined: "failed",
            declined: "failed",
            Pending: "pending",
            pending: "pending",
            Processing: "pending",
            processing: "pending",
            unknown: "unknown",
          };

          const mappedStatus = statusMap[result.status] ?? "unknown";
          return { status: mappedStatus, transferData: result };
        }

        default:
          return { status: "unknown", transferData: null };
      }
    } catch (error) {
      throw error;
    }
  }

  // MARK TRANSACTION AS SUCCESS (Provider confirmed)
  private async markAsSuccess(txn: any, transferData: any): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Calculate profit based on what provider actually returns
      let providerFees = 0;
      let providerVat = 0;
      let providerStampDuty = 0;

      // Flutterwave: uses app_fee
      if (txn.provider === "flutterwave") {
        providerFees = transferData?.app_fee || 0;
      }
      // Monnify: calculate from amount - settlementAmount
      else if (txn.provider === "monnify") {
        providerFees = transferData?._calculatedFee || 0;
      }
      // SaveHaven: has all three
      else if (txn.provider === "saveHaven") {
        providerFees = transferData?.fees || 0;
        providerVat = transferData?.vat || 0;
        providerStampDuty = transferData?.stampDuty || 0;
      }

      const profit =
        (txn.meta?.chargeInfo?.serviceCharge || 0) -
        (providerFees + providerVat + providerStampDuty);

      const updated = await Transaction.findOneAndUpdate(
        { _id: txn._id, status: { $in: ["pending", "processing"] } },
        {
          $set: {
            status: "success",
            profit: profit,
            meta: {
              ...txn.meta,
              // Store provider-specific transaction ID
              providerTransactionId:
                transferData?.id ||
                transferData?._id ||
                transferData?.transactionReference ||
                txn.meta?.providerTransactionId,
              // Store full response for audit trail
              webhookData: transferData,
              // Only store fees if provider gave them
              ...(transferData?.app_fee !== undefined && {
                fees: transferData.app_fee,
              }),
              ...(transferData?.fees !== undefined && {
                fees: transferData.fees,
              }),
              ...(transferData?._calculatedFee !== undefined && {
                calculatedFee: transferData._calculatedFee,
              }),
              ...(transferData?.vat !== undefined && { vat: transferData.vat }),
              ...(transferData?.stampDuty !== undefined && {
                stampDuty: transferData.stampDuty,
              }),
              // Only store responseMessage if provider gave it
              ...(transferData?.responseMessage !== undefined && {
                responseMessage: transferData.responseMessage,
              }),
              ...(transferData?.processor_response !== undefined && {
                processorResponse: transferData.processor_response,
              }),
              completedAt: new Date().toISOString(),
              phase: "reconciled",
              reconciledAt: new Date().toISOString(),
              reconciliationStatus: "provider_success",
            },
          },
        },
        { session, new: true },
      );

      if (!updated) {
        await session.abortTransaction();
        return;
      }

      await session.commitTransaction();
      logger.info(` Transaction reconciled as SUCCESS: ${txn.reference}`);
      await this.auditLoggingService.logTransactionEvent({
        userId: txn.sourceId?.toString(),
        transactionId: txn._id.toString(),
        transactionReference: txn.reference,
        action: "status_changed",
        previousStatus: txn.status,
        newStatus: "success",
        reason: "provider_confirmed_via_reconciliation",
        provider: txn.provider,
        initiatedBy: "system",
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // REVERSE TRANSACTION (Provider failed or timeout)
  private async reverseTransaction(
    txn: any,
    reason: string,
  ): Promise<"reversed"> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const totalDeduction =
        txn.amount + (txn.meta?.chargeInfo?.serviceCharge || 0);

      // AFTER — set the real end-state directly, since this function already
      // owns the atomic claim + refund as one unit
      const updated = await Transaction.findOneAndUpdate(
        { _id: txn._id, status: { $in: ["pending", "processing"] } },
        {
          $set: {
            status: TRANSACTION_STATUS.REVERSED,
            reversedAt: new Date(),
            reversalReason: reason,
            meta: {
              ...txn.meta,
              phase: "reconciled",
              reconciledAt: new Date().toISOString(),
              reconciliationStatus: "reversed",
              reversalReason: reason,
            },
          },
        },
        { session, new: true },
      );

      // Already handled by webhook or another reconciliation cycle
      if (!updated) {
        await session.abortTransaction();
        logger.info(
          `reverseTransaction skipped — already handled: ${txn.reference}`,
        );
        return "reversed";
      }

      // If this throws, the catch block aborts the session and rolls back
      // the status change too — user is never left unrefunded.
      const reversedWallet = await this.walletService.creditWallet(
        txn.sourceId || txn.userId,
        totalDeduction,
        `Refund`,
        {
          type: "refund",
          provider: txn.provider,
          idempotencyKey: `${txn.reference}_reconciliation_reversal`,
          initiatedByType: "system",
          meta: {
            reconciliationReason: reason,
            originalTransactionReference: txn.reference,
          },
          remark: `Refund: ${txn.type} failed - ${reason}`,
        },
      );

      // Both status change and wallet credit succeeded — now commit
      await session.commitTransaction();
      logger.info(
        `Transaction reversed: ${txn.reference} | Amount: ₦${totalDeduction}`,
      );

      await this.auditLoggingService.logTransactionEvent({
        userId: txn.sourceId?.toString(),
        transactionId: txn._id.toString(),
        transactionReference: txn.reference,
        action: "reversed",
        previousStatus: txn.status,
        newStatus: "reversed",
        amount: totalDeduction,
        balanceAfter: reversedWallet?.balanceAfter,
        reason: reason || "reconciliation_reversal",
        provider: txn.provider,
        initiatedBy: "system",
      });

      // Notify user — failure here does NOT affect the reversal
      try {
        let user: any = null;

        // Primary path: look up via walletId (populated join)
        if (txn.walletId) {
          const wallet = await Wallet.findById(txn.walletId).populate("userId");
          user = wallet?.userId as any;
        }

        // Fallback path: withdrawal transactions store owner in sourceId / userId
        // and may not carry walletId at all
        if (!user && (txn.sourceId || txn.userId)) {
          user = await User.findById(txn.sourceId || txn.userId).lean();
        }

        if (user?.email) {
          await this.emailService.sendTransactionReversalEmail(
            user.email,
            user.firstname || "Valued Customer",
            txn,
            totalDeduction,
            reason,
          );
          logger.info(`Reversal notification sent to user: ${user.email}`);
        } else {
          logger.warn(
            `reverseTransaction: Could not resolve user for ${txn.reference} — email notification skipped`,
          );
        }
      } catch (notificationError) {
        logger.error(
          `Failed to send reversal notification for ${txn.reference}:`,
          notificationError,
        );
      }

      // Notify Super Admins of the reconciliation reversal (fire and forget)
      try {
        const notificationService = ServiceContainer.getNotificationService();
        notificationService
          .notifySuperAdminsOfReversal({
            transaction: {
              ...txn.toObject ? txn.toObject() : txn,
              amount: totalDeduction,
            },
            reason: reason || "Reversed by automated payment reconciliation engine",
            providerResponse: txn.meta?.providerResponse || txn.meta,
            source: "reconciliation",
          })
          .catch((err: any) =>
            logger.error(
              "Failed to notify super admins of reconciliation reversal",
              err,
            ),
          );
      } catch (adminNotifyErr: any) {
        logger.error(
          "Could not dispatch super admin reversal alert in reconciliation",
          adminNotifyErr,
        );
      }

      return "reversed";
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      logger.error(
        `CRITICAL: Failed to reverse transaction ${txn.reference}:`,
        error,
      );

      try {
        await this.emailService.sendSystemNotificationToAdmin(
          process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
          `CRITICAL: Transaction Reversal Failed - ${txn.reference}`,
          {
            severity: "critical",
            transactionReference: txn.reference,
            transactionId: txn._id?.toString(),
            amount: txn.amount,
            serviceCharge: txn.meta?.chargeInfo?.serviceCharge || 0,
            totalDeduction:
              txn.amount + (txn.meta?.chargeInfo?.serviceCharge || 0),
            walletId: txn.walletId?.toString(),
            reversalReason: reason,
            errorMessage:
              error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            attemptedAt: new Date().toISOString(),
            transactionStatus: txn.status,
            transactionType: txn.type,
          },
          `CRITICAL DATABASE ERROR: Failed to reverse transaction ${txn.reference}. User funds totaling ₦${(txn.amount + (txn.meta?.chargeInfo?.serviceCharge || 0)).toLocaleString()} may be stuck.`,
        );
      } catch (alertError) {
        logger.error(
          `DOUBLE CRITICAL: Failed to alert admin about reversal failure:`,
          alertError,
        );
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  async manualReconcileTransaction(transactionId: string): Promise<{
    success: boolean;
    transaction: {
      reference: string;
      status: string;
      provider: string;
      amount: number;
    };
    providerStatus: {
      status: string;
      transferData?: any;
    };
    reconciliationResult: "success" | "reversed" | "stuck" | "skip" | "error";
    message: string;
    details: {
      previousStatus: string;
      newStatus: string;
      fees?: number;
      profit?: number;
      completedAt?: string;
    };
    error?: string;
  }> {
    try {
      logger.info("Manual reconciliation started", { transactionId });

      // STEP 1: Find the transaction
      const transaction = await Transaction.findById(transactionId);

      if (!transaction) {
        logger.error("Transaction not found", { transactionId });
        return {
          success: false,
          transaction: null as any,
          providerStatus: { status: "not_found" },
          reconciliationResult: "error",
          message: "Transaction not found",
          details: {
            previousStatus: "unknown",
            newStatus: "unknown",
          },
          error: `Transaction with ID ${transactionId} does not exist`,
        };
      }

      const reference = transaction.reference;
      const provider = transaction.provider;
      const providerReference =
        transaction.meta?.providerResponse.paymentReference ||
        transaction.providerReference;

      if (!provider) {
        logger.error("Transaction has no provider", { transactionId });
        return {
          success: false,
          transaction: null as any,
          providerStatus: { status: "not_found" },
          reconciliationResult: "error",
          message: "Transaction has no provider",
          details: {
            previousStatus: "unknown",
            newStatus: "unknown",
          },
          error: `Transaction with ID ${transactionId} has no provider`,
        };
      }

      logger.info("Found transaction for reconciliation", {
        reference,
        provider,
        status: transaction.status,
        providerReference,
      });

      // STEP 2: Check if transaction can be reconciled
      if (
        transaction.status === "success" ||
        transaction.status === "failed" ||
        transaction.status === "reversed"
      ) {
        logger.info("Transaction already completed", {
          reference,
          currentStatus: transaction.status,
        });
        return {
          success: false,
          transaction: {
            reference,
            status: transaction.status,
            provider,
            amount: transaction.amount,
          },
          providerStatus: { status: transaction.status },
          reconciliationResult: "skip",
          message: `Transaction already ${transaction.status}. Cannot reconcile completed transactions.`,
          details: {
            previousStatus: transaction.status,
            newStatus: transaction.status,
          },
        };
      }

      // STEP 3: Check if has provider reference
      if (!providerReference) {
        logger.warn("Transaction has no provider reference", {
          reference,
          provider,
        });
        return {
          success: false,
          transaction: {
            reference,
            status: transaction.status,
            provider,
            amount: transaction.amount,
          },
          providerStatus: { status: "unknown" },
          reconciliationResult: "stuck",
          message:
            "Cannot reconcile: Provider reference not found. Payment may not have been sent to provider.",
          details: {
            previousStatus: transaction.status,
            newStatus: transaction.status,
          },
        };
      }

      // STEP 4: Query provider for status
      logger.info("Querying provider for status", {
        reference,
        provider,
        providerReference,
      });

      let providerStatusResult: any;
      try {
        providerStatusResult = await this.queryProviderStatus(
          provider,
          providerReference,
        );
        logger.info("Provider status retrieved", {
          reference,
          providerStatus: providerStatusResult.status,
        });
      } catch (providerError: any) {
        logger.error("Failed to query provider", {
          reference,
          provider,
          error: providerError.message,
        });
        return {
          success: false,
          transaction: {
            reference,
            status: transaction.status,
            provider,
            amount: transaction.amount,
          },
          providerStatus: { status: "error" },
          reconciliationResult: "error",
          message: `Failed to query provider: ${providerError.message}`,
          details: {
            previousStatus: transaction.status,
            newStatus: transaction.status,
          },
          error: providerError.message,
        };
      }

      // STEP 5: Handle based on provider status
      const { status: providerStatus, transferData } = providerStatusResult;

      logger.info("Processing provider response", {
        reference,
        providerStatus,
        hasTransferData: !!transferData,
      });

      if (providerStatus === "success" || providerStatus === "completed") {
        // SUCCESS: Mark as success and merge data
        try {
          await this.markAsSuccess(transaction, transferData);

          logger.info("Transaction marked as SUCCESS", {
            reference,
            providerReference,
          });

          return {
            success: true,
            transaction: {
              reference,
              status: "success",
              provider,
              amount: transaction.amount,
            },
            providerStatus: providerStatusResult,
            reconciliationResult: "success",
            message: ` Transaction reconciled successfully. Payment confirmed at ${provider}.`,
            details: {
              previousStatus: transaction.status,
              newStatus: "success",
              fees:
                transferData?.app_fee ||
                transferData?.fees ||
                transferData?._calculatedFee,
              profit:
                (transaction.meta?.chargeInfo?.serviceCharge || 0) -
                (transferData?.app_fee ||
                  transferData?.fees ||
                  transferData?._calculatedFee ||
                  0),
              completedAt: new Date().toISOString(),
            },
          };
        } catch (updateError: any) {
          logger.error("Failed to mark transaction as success", {
            reference,
            error: updateError.message,
          });
          return {
            success: false,
            transaction: {
              reference,
              status: transaction.status,
              provider,
              amount: transaction.amount,
            },
            providerStatus: providerStatusResult,
            reconciliationResult: "error",
            message: `Provider confirmed success, but failed to update transaction: ${updateError.message}`,
            details: {
              previousStatus: transaction.status,
              newStatus: "unknown",
            },
            error: updateError.message,
          };
        }
      } else if (providerStatus === "failed") {
        // FAILED: Reverse the transaction and refund user
        try {
          const reverseResult = await this.reverseTransaction(
            transaction,
            `Manual reconciliation: Provider confirmed transfer failed`,
          );

          logger.info("Transaction reversed due to provider failure", {
            reference,
            providerReference,
          });

          Transaction.findById(transaction._id)
            .then(updatedTransaction => {
              if (updatedTransaction) {
                SocketService.emitTransactionUpdate(reference, { status: "failed", transaction: updatedTransaction });
              }
            })
            .catch(err => logger.error("Socket emit error", err));

          return {
            success: true,
            transaction: {
              reference,
              status: "failed",
              provider,
              amount: transaction.amount,
            },
            providerStatus: providerStatusResult,
            reconciliationResult: reverseResult,
            message: `⚠️ Provider confirmed failure. Transaction reversed and user refunded.`,
            details: {
              previousStatus: transaction.status,
              newStatus: "failed",
            },
          };
        } catch (reverseError: any) {
          logger.error("Failed to reverse transaction", {
            reference,
            error: reverseError.message,
          });
          return {
            success: false,
            transaction: {
              reference,
              status: transaction.status,
              provider,
              amount: transaction.amount,
            },
            providerStatus: providerStatusResult,
            reconciliationResult: "error",
            message: `Provider confirmed failure, but failed to reverse transaction: ${reverseError.message}`,
            details: {
              previousStatus: transaction.status,
              newStatus: "unknown",
            },
            error: reverseError.message,
          };
        }
      } else if (providerStatus === "pending") {
        // PENDING: Still processing at provider
        logger.info("Transaction still pending at provider", {
          reference,
          providerStatus,
        });

        return {
          success: false,
          transaction: {
            reference,
            status: transaction.status,
            provider,
            amount: transaction.amount,
          },
          providerStatus: providerStatusResult,
          reconciliationResult: "stuck",
          message: `⏳ Payment still processing at provider. Try again in a few minutes.`,
          details: {
            previousStatus: transaction.status,
            newStatus: transaction.status,
          },
        };
      } else {
        // UNKNOWN: Cannot determine status
        logger.warn("Unknown provider status", { reference, providerStatus });

        return {
          success: false,
          transaction: {
            reference,
            status: transaction.status,
            provider,
            amount: transaction.amount,
          },
          providerStatus: providerStatusResult,
          reconciliationResult: "stuck",
          message: `❓ Provider returned unknown status: ${providerStatus}. Unable to determine transaction outcome.`,
          details: {
            previousStatus: transaction.status,
            newStatus: transaction.status,
          },
        };
      }
    } catch (error: any) {
      logger.error("Manual reconciliation error", {
        transactionId,
        error: error.message,
      });

      return {
        success: false,
        transaction: null as any,
        providerStatus: { status: "error" },
        reconciliationResult: "error",
        message: "Reconciliation failed due to system error",
        details: {
          previousStatus: "unknown",
          newStatus: "unknown",
        },
        error: error.message,
      };
    }
  }
}
