import logger from "@/logger";
import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { HelperService } from "@/services/client/utility/HelperService";
import ServiceContainer from "@/services/client/container";
import { TRANSACTION_TYPES, CACHE_KEYS } from "@/utils/constants";
import { cacheService } from "@/services/core/CacheService";
import { generateReference } from "@/utils/helpers";
import mongoose, { Types } from "mongoose";
import SocketService from "@/services/core/SocketService";

type VerificationOutcome = {
  outcome: "success" | "failed" | "pending";
  isReversal: boolean;
  amount?: number;
};

/**
 * Runs every 5 minutes to re-verify SafeHaven deposits stuck in "pending"
 * status. These are created by SaveHavenWebhookService.handleWalletFunding
 * whenever the webhook's own claim couldn't be confirmed directly against
 * SafeHaven at the time it arrived (verification call failed, or came back
 * inconclusive). This job is the only place that credits the wallet for a
 * deposit that took this path - the wallet is deliberately NOT credited
 * when the pending transaction is first created.
 *
 * Handles both account types the webhook service can defer:
 *   - "permanent" (static sub-account) -> re-checks via getAccountStatement
 *   - "temporary" (dynamic virtual account) -> re-checks via
 *     getVirtualAccountTransferStatus
 */
export class SafeHavenPendingVerificationJob {
  private saveHavenService: SaveHavenService;
  private helperService: HelperService;
  private notificationService = ServiceContainer.getNotificationService();

  constructor() {
    this.saveHavenService = ServiceContainer.getSaveHavenService();
    this.helperService = ServiceContainer.getHelperService();
  }

  async execute(): Promise<void> {
    try {
      logger.info("SafeHaven Pending Verification Job: Starting");

      const pendingTxns = await Transaction.find({
        status: "pending",
        type: TRANSACTION_TYPES.DEPOSIT,
        provider: "saveHaven",
        "meta.verificationStatus": "pending_verification",
      })
        .limit(100)
        .sort({ createdAt: 1 });

      if (pendingTxns.length === 0) {
        logger.info(
          "SafeHaven Pending Verification Job: No pending transactions",
        );
        return;
      }

      logger.info(
        `SafeHaven Pending Verification Job: Found ${pendingTxns.length} pending transactions`,
      );

      for (const txn of pendingTxns) {
        try {
          await this.reverifyTransaction(txn);
        } catch (error) {
          logger.error(
            "SafeHaven Pending Verification Job: Error reverifying transaction",
            { transactionId: txn._id, error },
          );
        }
      }

      logger.info("SafeHaven Pending Verification Job: Completed");
    } catch (error) {
      logger.error("SafeHaven Pending Verification Job: Fatal error", {
        error,
      });
    }
  }

  private async reverifyTransaction(txn: any): Promise<void> {
    const { _id: transactionId, meta } = txn;
    const accountType = meta?.accountType;
    let verification: VerificationOutcome;

    try {
      if (accountType === "permanent") {
        const providerAccountId = meta?.providerAccountId;
        const providerReference = meta?.providerReference;

        if (!providerAccountId || !providerReference) {
          logger.error(
            "SaveHaven: Pending transaction missing providerAccountId/providerReference, marking as failed",
            { transactionId },
          );
          await Transaction.findByIdAndUpdate(transactionId, {
            status: "failed",
            "meta.verificationStatus": "failed",
            "meta.lastVerificationError":
              "Missing providerAccountId/providerReference for reverification",
          });
          return;
        }

        logger.info(
          "SaveHaven: Re-verifying pending transaction (permanent sub-account)",
          {
            transactionId,
            providerAccountId,
            verificationAttempt: (meta.verificationAttempts || 0) + 1,
          },
        );

        const statement = await this.saveHavenService.getAccountStatement(
          providerAccountId,
          providerReference,
        );

        verification = !statement.found
          ? { outcome: "pending", isReversal: false }
          : statement.isReversal
            ? {
                outcome: "failed",
                isReversal: true,
                amount: statement.amount,
              }
            : {
                outcome: "success",
                isReversal: false,
                amount: statement.amount,
              };
      } else {
        // "temporary" (dynamic virtual account) - also the fallback for
        // any older pending records created before accountType was stored.
        const sessionId = meta?.sessionId;

        if (!sessionId) {
          logger.error(
            "SaveHaven: Pending transaction missing sessionId, marking as failed",
            { transactionId },
          );
          await Transaction.findByIdAndUpdate(transactionId, {
            status: "failed",
            "meta.verificationStatus": "failed",
            "meta.lastVerificationError":
              "Missing sessionId for reverification",
          });
          return;
        }

        logger.info(
          "SaveHaven: Re-verifying pending transaction (temporary virtual account)",
          {
            transactionId,
            sessionId,
            verificationAttempt: (meta.verificationAttempts || 0) + 1,
          },
        );

        const transfer =
          await this.saveHavenService.getVirtualAccountTransferStatus(
            sessionId,
          );

        if (!transfer || transfer.status === "unknown") {
          verification = { outcome: "pending", isReversal: false };
        } else if (transfer.isReversed) {
          verification = {
            outcome: "failed",
            isReversal: true,
            amount: transfer.amount,
          };
        } else if (transfer.status === "Completed") {
          verification = {
            outcome: "success",
            isReversal: false,
            amount: transfer.amount,
          };
        } else if (
          transfer.status === "Failed" ||
          transfer.status === "Declined"
        ) {
          verification = {
            outcome: "failed",
            isReversal: false,
            amount: transfer.amount,
          };
        } else {
          verification = { outcome: "pending", isReversal: false };
        }
      }
    } catch (error: any) {
      logger.error("SaveHaven: Reverification query failed", {
        transactionId,
        accountType,
        error: error?.message,
      });
      await this.handleStillPending(txn, error?.message);
      return;
    }

    if (verification.outcome === "success") {
      logger.info("SaveHaven: Pending transaction verified as completed", {
        transactionId,
        accountType,
      });
      await this.creditConfirmedTransaction(txn, verification, accountType);
    } else if (verification.outcome === "failed") {
      logger.warn("SaveHaven: Transaction failed/reversed on provider", {
        transactionId,
        accountType,
        isReversal: verification.isReversal,
      });

      await Transaction.findByIdAndUpdate(transactionId, {
        status: "failed",
        "meta.verificationStatus": "failed",
        "meta.lastVerificationError": verification.isReversal
          ? "Provider confirmed reversal"
          : "Provider confirmed failure",
      });
    } else {
      await this.handleStillPending(txn);
    }
  }

  /**
   * Still inconclusive - not a credit, not a confirmed failure. Track the
   * attempt and, past 4 hours old, flag it for a human instead of retrying
   * forever.
   */
  private async handleStillPending(
    txn: any,
    errorMessage?: string,
  ): Promise<void> {
    const { _id: transactionId, userId, meta } = txn;
    const now = new Date();
    const ageMs = now.getTime() - new Date(txn.createdAt).getTime();
    const hoursPassed = ageMs / (1000 * 60 * 60);
    const newAttempts = (meta?.verificationAttempts || 0) + 1;

    if (hoursPassed > 4) {
      logger.error(
        "SaveHaven: Pending transaction timeout - flagged for admin review",
        { transactionId, hoursPassed, userId, errorMessage },
      );

      await Transaction.findByIdAndUpdate(transactionId, {
        "meta.verificationStatus": "admin_review",
        "meta.verificationAttempts": newAttempts,
        "meta.lastVerificationAttempt": now,
        "meta.flaggedForAdminAt": now,
        "meta.lastVerificationError": errorMessage
          ? `ADMIN REVIEW: Verification failed after ${Math.round(hoursPassed)}h - ${errorMessage}`
          : `ADMIN REVIEW: Transaction still pending after ${Math.round(hoursPassed)} hours`,
      });
      return;
    }

    logger.warn(
      `SaveHaven: Transaction still pending on provider (${Math.round(hoursPassed)}h / 4h timeout)`,
      { transactionId, hoursPassed, newAttempts },
    );

    await Transaction.findByIdAndUpdate(transactionId, {
      "meta.verificationAttempts": newAttempts,
      "meta.lastVerificationAttempt": now,
      ...(errorMessage ? { "meta.lastVerificationError": errorMessage } : {}),
    });
  }

  /**
   * Confirmed by SafeHaven - actually move the money now. Mirrors the
   * normal webhook success path in SaveHavenWebhookService: deduct the
   * service charge, create the Deposit, credit the Wallet, flip the
   * Transaction to success - all inside one DB session so it either fully
   * happens or fully doesn't.
   */
  private async creditConfirmedTransaction(
    txn: any,
    verification: VerificationOutcome,
    accountType: string | undefined,
  ): Promise<void> {
    const { _id: transactionId, userId, walletId, reference, meta } = txn;

    let session: mongoose.ClientSession | null = null;
    let amountToCredit = 0;
    let newBalance = 0;
    const verifiedVia =
      accountType === "permanent"
        ? "account_statement"
        : "virtual_account_transfer_status";

    try {
      session = await mongoose.startSession();
      session.startTransaction();

      // Guard against double-crediting if a run ever overlaps another.
      const freshTxn =
        await Transaction.findById(transactionId).session(session);
      if (!freshTxn || freshTxn.status !== "pending") {
        await session.abortTransaction();
        logger.warn(
          "SaveHaven: Transaction no longer pending, skipping credit",
          { transactionId, currentStatus: freshTxn?.status },
        );
        return;
      }

      const grossAmount =
        typeof verification.amount === "number"
          ? verification.amount
          : freshTxn.amount;

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          grossAmount,
          TRANSACTION_TYPES.DEPOSIT,
        );
      amountToCredit = grossAmount - Number(chargeCalculation.chargeAmount);

      const wallet = await Wallet.findById(walletId).session(session);
      if (!wallet) {
        throw new Error(
          "Wallet not found while crediting confirmed SafeHaven deposit",
        );
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + amountToCredit;

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId,
            walletId,
            reference: depositReference,
            provider: "saveHaven",
            amount: amountToCredit,
            status: "success",
            meta: {
              verifiedVia,
              providerResponse: meta?.providerResponse,
              chargeInfo: {
                baseAmount: grossAmount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
                isServiceChargeCapped: chargeCalculation.isCapped,
              },
              providerReference: meta?.providerReference,
              providerTransactionId: meta?.providerTransactionId,
              safeHavenTransactionId: meta?.providerTransactionId,
              virtualAccountId: meta?.virtualAccountId,
              creditAccountNumber: meta?.providerResponse?.creditAccountNumber,
              creditAccountName: meta?.providerResponse?.creditAccountName,
              unsolicited: true,
              verifiedViaRetryJob: true,
            },
          },
        ],
        { session },
      );

      const updatedWallet = await Wallet.findByIdAndUpdate(
        walletId,
        { $inc: { balance: amountToCredit } },
        { session, new: true },
      );

      await Transaction.findByIdAndUpdate(
        transactionId,
        {
          status: "success",
          amount: amountToCredit,
          transactableType: "Deposit",
          transactableId: deposit[0]._id,
          balanceBefore,
          balanceAfter,
          "meta.verificationStatus": "verified",
          "meta.verifiedVia": verifiedVia,
          "meta.lastVerificationAttempt": new Date(),
          "meta.depositId": deposit[0]._id,
          "meta.depositReference": depositReference,
        },
        { session },
      );

      await session.commitTransaction();
      newBalance = balanceAfter;

      if (updatedWallet) {
        try {
          await cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
        } catch (cacheErr) {
          logger.error("SaveHaven job: failed to invalidate wallet cache:", cacheErr);
        }

        SocketService.emitToUser(userId.toString(), "wallet_credit", {
          balance: updatedWallet.balance,
          bonusBalance: updatedWallet.bonusBalance,
          commissionBalance: updatedWallet.commissionBalance,
          amount: amountToCredit,
          direction: "CREDIT",
          type: "deposit",
          reference: depositReference,
          reason: `Deposit verified (${verifiedVia})`,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info(
        "SaveHaven: Pending transaction verified and wallet credited",
        { transactionId, userId, amountToCredit, newBalance },
      );
    } catch (error) {
      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (abortError) {
          logger.error("SaveHaven: Error aborting credit transaction", {
            error: abortError,
            originalError: error,
            transactionId,
          });
        }
      }
      logger.error(
        "SaveHaven: Failed to credit confirmed pending transaction",
        { transactionId, error },
      );
      throw error;
    } finally {
      if (session) session.endSession();
    }

    // Same notification pattern as a normal confirmed webhook deposit - no
    // custom title/message, so it reads exactly like any other deposit.
    try {
      await this.notificationService.createNotification({
        type: "payment_success",
        notifiableType: "User",
        notifiableId: userId as Types.ObjectId,
        sendPush: true,
        sendEmail: false,
        sendSMS: false,
        data: {
          transactionType: "Wallet Funding",
          amount: amountToCredit,
          reference: reference,
          provider: "SafeHaven",
          balance: newBalance,
        },
      });
      logger.info("SaveHaven: Confirmation notification sent", {
        transactionId,
        userId,
      });
    } catch (notifyErr) {
      logger.error("SaveHaven: Failed to send confirmation notification", {
        userId,
        transactionId,
        error: notifyErr,
      });
    }
  }
}