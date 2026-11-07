import { WalletRepository } from "@/repositories/client/WalletRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { NotificationService } from "../notifications/NotificationService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_KEYS,
  WALLET_TYPES,
  TRANSACTION_TYPES,
  SYSTEM,
  SystemProvider,
} from "@/utils/constants";
import { Types } from "mongoose";
import {
  generateReference,
  retryOperation,
  roundAmount,
} from "@/utils/helpers";
import { CacheService } from "../../core/CacheService";
import logger from "@/logger";
import { ITransaction, Transaction } from "@/models/wallet/Transaction";
import mongoose from "mongoose";
import { Wallet } from "@/models/wallet/Wallet";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import { IUser } from "@/models/core/User";
import { SystemConfigService } from "../../core/SystemConfigService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { recordTransactionFailure } from "../../monitoring/transactionFailureTracker";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { HelperService } from "../utility/HelperService";
import SocketService from "@/services/core/SocketService";

export interface WalletTransactionResult {
  walletId: Types.ObjectId;
  reference: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  transaction: ITransaction;
}

export interface RecipientValidationOptions {
  allowSuspended?: boolean;
  allowInactive?: boolean;
  allowFraudulent?: boolean;
  requireEmailVerified?: boolean;
  requirePhoneVerified?: boolean;
}

export class WalletService {
  constructor(
    private walletRepository: WalletRepository,
    private cacheService: CacheService,
    private transactionRepository: TransactionRepository,
    private userRepository: UserRepository,
    private notificationService: NotificationService,
    private helperService: HelperService,
    private systemConfigService: SystemConfigService,
    private auditLoggingService: AuditLoggingService,
  ) {}

  private isTestEnvironment(): boolean {
    // return false;
    return process.env.NODE_ENV === "test";
  }

  async getWallet(userId: string): Promise<any> {
    const cacheKey = CACHE_KEYS.USER_WALLET(userId);
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const wallet = await this.walletRepository.findByUserId(userId);
    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const result = {
      id: wallet._id,
      userId: wallet.userId,
      type: wallet.type,
      balance: Math.trunc(wallet.balance * 100) / 100,
      bonusBalance: wallet.bonusBalance,
      commissionBalance: wallet.commissionBalance,
      createdAt: wallet.createdAt,
    };

    this.cacheService
      .set(cacheKey, result, 60) // 60s TTL — balance changes on debit/credit, both already delete this key
      .catch((err) => logger.error("Failed to cache wallet:", err));

    return result;
  }

  async getAllWallets(userId: string): Promise<any> {
    const wallets = await this.walletRepository.findAllByUserId(userId);
    return wallets.map((wallet) => ({
      id: wallet._id,
      type: wallet.type,
      balance: wallet.balance,
      bonusBalance: wallet.bonusBalance,
      commissionBalance: wallet.commissionBalance,
    }));
  }

  // REVERSAL METHOD
  async reverseTransaction(data: {
    transactionId: string;
    adminId: string;
    reason: string;
  }): Promise<{
    originalTransaction: ITransaction | null;
    reversalTransaction: ITransaction;
  }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const originalTxn = await Transaction.findById(data.transactionId);

      if (!originalTxn) {
        throw new AppError(
          "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (originalTxn.reversedBy) {
        throw new AppError(
          "This transaction is already reversed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (!["failed", "success"].includes(originalTxn.status)) {
        throw new AppError(
          `Cannot reverse transaction with status: ${originalTxn.status}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (["reversal", "refund"].includes(originalTxn.type)) {
        throw new AppError(
          "Cannot reverse this transaction type",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check age (90 days max)
      // const ageMs = Date.now() - originalTxn.createdAt.getTime();
      // const maxAge = 90 * 24 * 60 * 60 * 1000;
      // if (ageMs > maxAge) {
      //   throw new AppError(
      //     "Transaction is too old to reverse (max 90 days)",
      //     HTTP_STATUS.BAD_REQUEST,
      //     ERROR_CODES.VALIDATION_ERROR,
      //   );
      // }

      // Determine reversal direction (opposite of original)
      const reversalDirection =
        originalTxn.direction === "DEBIT" ? "CREDIT" : "DEBIT";

      // Update original transaction - mark as reversed
      const updatedOriginal = await Transaction.findByIdAndUpdate(
        data.transactionId,
        {
          status: "reversed",
          reversedBy: new Types.ObjectId(data.adminId),
          reversalReason: data.reason,
          reversedAt: new Date(),
        },
        { session, new: true },
      );

      const currentWallet = await Wallet.findById(originalTxn.walletId).session(
        session,
      );
      if (!currentWallet) {
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const currentBalance = currentWallet.balance;
      const balanceAfterReversal =
        reversalDirection === "CREDIT"
          ? currentBalance + originalTxn.amount
          : currentBalance - originalTxn.amount;

      // Create reversal transaction (opposite direction, same type)
      const reversalReference = generateReference("REV");
      const [reversalTxn] = await Transaction.create(
        [
          {
            walletId: originalTxn.walletId,
            userId: originalTxn.userId,
            sourceId: originalTxn.userId,
            reference: reversalReference,
            amount: originalTxn.amount,
            direction: reversalDirection,
            type: originalTxn.type,
            status: "success",
            purpose: "Transaction reversal",
            remark: `Reversal of ${originalTxn.reference}`,
            balanceBefore: currentBalance,
            balanceAfter: balanceAfterReversal,
            linkedTransactionId: originalTxn._id,
            initiatedBy: new Types.ObjectId(data.adminId),
            initiatedByType: "admin",
            meta: {
              reversalOf: originalTxn.reference,
              reversalReason: data.reason,
              reversalAdmin: data.adminId,
              ...originalTxn.meta,
            },
          },
        ],
        { session },
      );

      // Update wallet balance (reverse the debit/credit)
      if (reversalDirection === "CREDIT") {
        // If reversing a debit, add back the amount
        await Wallet.findByIdAndUpdate(
          originalTxn.walletId,
          { $inc: { balance: originalTxn.amount } },
          { session },
        );
      } else {
        // If reversing a credit, subtract the amount
        await Wallet.findByIdAndUpdate(
          originalTxn.walletId,
          { $inc: { balance: -originalTxn.amount } },
          { session },
        );
      }

      await session.commitTransaction();

      this.cacheService
        .delete(CACHE_KEYS.USER_WALLET(originalTxn.userId.toString()))
        .catch((err) =>
          logger.error("Failed to invalidate wallet cache on reversal:", err),
        );

      const walletAfterReversal = await Wallet.findById(originalTxn.walletId);
      SocketService.emitToUser(
        originalTxn.userId.toString(),
        reversalDirection === "CREDIT" ? "wallet_credit" : "wallet_debit",
        {
          balance: Math.trunc((walletAfterReversal?.balance ?? balanceAfterReversal) * 100) / 100,
          bonusBalance: Math.trunc((walletAfterReversal?.bonusBalance ?? currentWallet.bonusBalance) * 100) / 100,
          commissionBalance: Math.trunc((walletAfterReversal?.commissionBalance ?? currentWallet.commissionBalance) * 100) / 100,
          amount: originalTxn.amount,
          direction: reversalDirection,
          type: "reversal",
          reference: reversalReference,
          reason: data.reason,
          timestamp: new Date().toISOString(),
        },
      );

      //  Send customer notification (fire and forget)
      this.notificationService
        .createNotification({
          type: "transaction_reversed",
          notifiableType: "User",
          notifiableId: originalTxn.userId,
          data: {
            originalReference: originalTxn.reference,
            reversalReference,
            amount: originalTxn.amount,
            reason: data.reason,
            message: `Transaction reversed. ₦${originalTxn.amount.toLocaleString()} adjustment applied to your wallet.`,
          },
          sendEmail: true,
          sendPush: false,
        })
        .catch((err) =>
          logger.error("Failed to send reversal notification", err),
        );

      // Notify Super Admins of the reversal (fire and forget)
      this.notificationService
        .notifySuperAdminsOfReversal({
          transaction: originalTxn,
          reason: data.reason,
          reversalReference,
          reversedByAdminName: data.adminId,
          source: "admin",
        })
        .catch((err) =>
          logger.error("Failed to send super admin reversal alert", err),
        );

      logger.info(
        `Transaction reversed: ${originalTxn.reference} → ${reversalReference} by admin ${data.adminId}`,
      );

      return {
        originalTransaction: updatedOriginal,
        reversalTransaction: reversalTxn,
      };
    } catch (error: any) {
      await session.abortTransaction();
      logger.error("Transaction reversal failed", error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async debitWallet(
    userId: string | Types.ObjectId,
    amount: number,
    reason: string,
    options?: {
      type?: string;
      provider?: string;
      providerReference?: string;
      transactableType?: string;
      transactableId?: Types.ObjectId;
      idempotencyKey?: string;
      initiatedBy?: Types.ObjectId;
      initiatedByType?: SystemProvider;
      meta?: any;
      channel?: string;
      remark?: any;
      suppressNotification?: boolean;
      bonusCategory?: string;
      isHiddenFromUser?: boolean;
    },
  ): Promise<WalletTransactionResult> {
    return SentryHelper.trackCriticalOperation(
      "wallet_debit",
      async () => {
        const session = this.isTestEnvironment()
          ? null
          : await mongoose.startSession();
        if (session) session.startTransaction();

        try {
          // Check for existing transaction by idempotency key
          if (options?.idempotencyKey) {
            const existingTxn = await Transaction.findOne({
              idempotencyKey: options.idempotencyKey,
            });

            if (existingTxn) {
              // Check transaction status
              if (existingTxn.status === "pending") {
                // PENDING timeout handler: If older than 5 minutes, allow retry
                const ageMs = Date.now() - existingTxn.createdAt.getTime();
                const pendingTimeoutMs = 5 * 60 * 1000; // 5 minutes

                if (ageMs < pendingTimeoutMs) {
                  // Still in progress, don't retry yet
                  if (session) await session.abortTransaction();
                  throw new AppError(
                    "Operation in progress. Please retry in a moment.",
                    HTTP_STATUS.CONFLICT,
                    ERROR_CODES.VALIDATION_ERROR,
                  );
                }
                // If older than 5 minutes, mark as failed and continue with new attempt
                await Transaction.findByIdAndUpdate(
                  existingTxn._id,
                  { status: "failed" },
                  { session: session || undefined },
                );
                // Continue with new attempt (don't return yet)
              } else if (existingTxn.status === "success") {
                // Idempotent return: operation already succeeded
                if (session) await session.abortTransaction();
                logger.info(
                  `Idempotent debit returned: ${options.idempotencyKey}`,
                );
                return {
                  walletId: existingTxn.walletId,
                  reference: existingTxn.reference,
                  balanceBefore: existingTxn.balanceBefore,
                  balanceAfter: existingTxn.balanceAfter,
                  amount: existingTxn.amount,
                  direction: "DEBIT",
                  transaction: existingTxn,
                };
              } else if (existingTxn.status === "failed") {
                // Allow retry: operation failed before, try again
                // Continue with new attempt (don't return)
                logger.info(`Retrying failed debit: ${options.idempotencyKey}`);
              } else {
                // Other statuses (processing, reversed, etc)
                if (session) await session.abortTransaction();
                throw new AppError(
                  `Operation has status: ${existingTxn.status}`,
                  HTTP_STATUS.CONFLICT,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }
            }
          }

          // Check if user is shadow-banned
          const user = await this.userRepository.findById(userId.toString());
          if (user?.status === "shadow-banned") {
            if (session) await session.abortTransaction();
            throw new AppError(
              "Your account has a temporary restriction. Please contact support.",
              HTTP_STATUS.FORBIDDEN,
              ERROR_CODES.ACCOUNT_RESTRICTED,
            );
          }

          // Get wallet
          const wallet = await this.walletRepository.findByUserId(userId);
          if (!wallet) {
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          const reference = generateReference("TXN");
          const balanceBefore = wallet.balance;

          // Check if sufficient balance (for validation)
          if (balanceBefore < amount) {
            throw new AppError(
              "Insufficient balance",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          const balanceAfter = balanceBefore - amount;

          // Create transaction with status=PENDING
          let transaction;

          try {
            [transaction] = await Transaction.create(
              [
                {
                  walletId: wallet._id,
                  sourceId: new Types.ObjectId(userId),
                  userId: new Types.ObjectId(userId),
                  recipientId:
                    options?.transactableType === "User"
                      ? options.transactableId
                      : undefined,
                  transactableType: options?.transactableType,
                  transactableId: options?.transactableId,
                  reference,
                  providerReference: options?.providerReference,
                  amount: Number(amount),
                  direction: "DEBIT",
                  type: options?.type || "withdrawal",
                  provider: options?.provider || SYSTEM.PROVIDER,
                  remark: options?.remark || reason,
                  purpose: reason,
                  channel: options?.channel,
                  status: "pending", // Create with PENDING status
                  balanceBefore,
                  balanceAfter,
                  idempotencyKey: options?.idempotencyKey,
                  initiatedBy: options?.initiatedBy,
                  initiatedByType: options?.initiatedByType || "system",
                  bonusCategory: options?.bonusCategory,
                  isHiddenFromUser: options?.isHiddenFromUser,
                  meta: options?.meta,
                },
              ],
              { session: session || undefined },
            );
          } catch (txnError: any) {
            // Handle duplicate idempotency key (shouldn't happen, but handle it)
            if (txnError.code === 11000 && options?.idempotencyKey) {
              logger.warn(
                `Duplicate debit key detected: ${options.idempotencyKey}`,
              );

              const existing = await Transaction.findOne({
                idempotencyKey: options.idempotencyKey,
              });

              if (existing && existing.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existing.walletId,
                  reference: existing.reference,
                  balanceBefore: existing.balanceBefore,
                  balanceAfter: existing.balanceAfter,
                  amount: existing.amount,
                  direction: "DEBIT" as const,
                  transaction: existing,
                };
              }
            }
            throw txnError;
          }

          // Update wallet balance atomically
          const updatedWallet = await retryOperation(
            async () =>
              await Wallet.findOneAndUpdate(
                {
                  _id: wallet._id,
                  balance: { $gte: amount }, // Ensure sufficient balance (prevents negative)
                },
                {
                  $inc: { balance: -amount },
                },
                { new: true, session: session || undefined },
              ),
            3, // max retries
            50, // delay ms
          );

          if (!updatedWallet) {
            throw new AppError(
              "Insufficient balance",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          // Update transaction status to SUCCESS
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { status: "success" },
            { session: session || undefined },
          );

          if (session) await session.commitTransaction();

          SocketService.emitToUser(userId.toString(), "wallet_debit", {
            balance: Math.trunc(updatedWallet.balance * 100) / 100,
            bonusBalance: Math.trunc(updatedWallet.bonusBalance * 100) / 100,
            commissionBalance: Math.trunc(updatedWallet.commissionBalance * 100) / 100,
            amount,
            direction: "DEBIT",
            type: options?.type || "withdrawal",
            reference,
            reason,
            timestamp: new Date().toISOString(),
          });

          this.auditLoggingService
            .logWalletEvent({
              userId: userId as Types.ObjectId,
              action: "debit",
              amount,
              balanceBefore,
              balanceAfter: updatedWallet.balance,
              reason: reason || options?.type,
              reference,
              transactionId: transaction?._id?.toString(),
              initiatedBy: options?.initiatedByType || "system",
            })
            .catch((err: any) =>
              logger.error(
                `failed to log wallet event for ${{
                  userId: userId.toString(),
                  action: "debit",
                  amount,
                  balanceBefore,
                  balanceAfter: updatedWallet.balance,
                  reason: reason || options?.type,
                  reference,
                  transactionId: transaction?._id?.toString(),
                  initiatedBy: options?.initiatedByType || "system",
                }}:`,
                err,
              ),
            );

          this.cacheService
            .delete(CACHE_KEYS.USER_WALLET(userId.toString()))
            .catch((err) =>
              logger.error("Failed to invalidate wallet cache:", err),
            );

          this.notificationService
            .createNotification({
              type: "wallet_debit",
              notifiableType: "User",
              notifiableId: userId as Types.ObjectId,
              data: {
                amount,
                balance: updatedWallet.balance,
                reason,
                reference,
              },
              sendEmail: options?.suppressNotification ? false : true,
              sendSMS: false,
              sendPush: false,
            })
            .catch((err) =>
              logger.info("Failed to send debit notification", err),
            );

          logger.info(
            `Wallet debited: ${reference} - User: ${userId}, Amount: ${amount}`,
          );

          return {
            walletId: wallet.id,
            reference,
            balanceBefore,
            balanceAfter: updatedWallet.balance,
            amount,
            direction: "DEBIT",
            transaction,
          };
        } catch (error: any) {
          if (session) await session.abortTransaction();
          logger.error("Debit wallet failed:", error);
          throw error;
        } finally {
          if (session) session.endSession();
        }
      },
      userId.toString(),
    );
  }

  async creditWallet(
    userId: string | Types.ObjectId,
    amount: number,
    reason: string, // now purpose
    options?: {
      type?: string;
      provider?: string;
      providerReference?: string;
      transactableType?: string;
      transactableId?: Types.ObjectId;
      idempotencyKey?: string;
      initiatedBy?: Types.ObjectId;
      initiatedByType?: SystemProvider;
      linkedTransactionId?: Types.ObjectId; // original transaction this refund is linked to
      channel?: string;
      meta?: any;
      remark?: string;
      suppressNotification?: boolean;
      bonusCategory?: string;
      isHiddenFromUser?: boolean;
    },
  ): Promise<WalletTransactionResult> {
    return SentryHelper.trackCriticalOperation(
      "wallet_credit",
      async () => {
        const session = this.isTestEnvironment()
          ? null
          : await mongoose.startSession();
        if (session) session.startTransaction();

        try {
          // Check for existing transaction by idempotency key
          if (options?.idempotencyKey) {
            const existingTxn = await Transaction.findOne({
              idempotencyKey: options.idempotencyKey,
            });

            if (existingTxn) {
              //  Check transaction status
              if (existingTxn.status === "pending") {
                //  PENDING timeout handler: If older than 5 minutes, allow retry
                const ageMs = Date.now() - existingTxn.createdAt.getTime();
                const pendingTimeoutMs = 5 * 60 * 1000; // 5 minutes

                if (ageMs < pendingTimeoutMs) {
                  // Still in progress, don't retry yet
                  if (session) await session.abortTransaction();
                  throw new AppError(
                    "Operation in progress. Please retry in a moment.",
                    HTTP_STATUS.CONFLICT,
                    ERROR_CODES.VALIDATION_ERROR,
                  );
                }
                // If older than 5 minutes, mark as failed and continue with new attempt
                await Transaction.findByIdAndUpdate(
                  existingTxn._id,
                  { status: "failed" },
                  { session: session || undefined },
                );
                // Continue with new attempt (don't return yet)
              } else if (existingTxn.status === "success") {
                // Idempotent return: operation already succeeded
                if (session) await session.abortTransaction();
                logger.info(
                  `Idempotent credit returned: ${options.idempotencyKey}`,
                );
                return {
                  walletId: existingTxn.walletId,
                  reference: existingTxn.reference,
                  balanceBefore: existingTxn.balanceBefore,
                  balanceAfter: existingTxn.balanceAfter,
                  amount: existingTxn.amount,
                  direction: "CREDIT",
                  transaction: existingTxn,
                };
              } else if (existingTxn.status === "failed") {
                // Allow retry: operation failed before, try again
                // Continue with new attempt (don't return)
                logger.info(
                  `Retrying failed credit: ${options.idempotencyKey}`,
                );
              } else {
                // Other statuses (processing, reversed, etc)
                if (session) await session.abortTransaction();
                throw new AppError(
                  `Operation has status: ${existingTxn.status}`,
                  HTTP_STATUS.CONFLICT,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }
            }
          }

          //  Get wallet
          const wallet = await this.walletRepository.findByUserId(userId);
          if (!wallet) {
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          const reference = generateReference("TXN");
          const balanceBefore = wallet.balance;

          //  Create transaction with status=PENDING
          let transaction;
          const balanceAfter = balanceBefore + amount;

          try {
            [transaction] = await Transaction.create(
              [
                {
                  walletId: wallet._id,
                  sourceId:
                    options?.transactableType === "User"
                      ? options.transactableId
                      : userId,
                  recipientId: new Types.ObjectId(userId),
                  userId: new Types.ObjectId(userId),
                  transactableType: options?.transactableType,
                  transactableId: options?.transactableId,
                  linkedTransactionId: options?.linkedTransactionId ?? null,
                  reference,
                  providerReference: options?.providerReference,
                  amount: Number(amount),
                  direction: "CREDIT",
                  type: options?.type || "deposit",
                  provider: options?.provider || SYSTEM.PROVIDER,
                  remark: options?.remark || reason,
                  purpose: reason,
                  channel: options?.channel,
                  status: "pending", // Create with PENDING status
                  balanceBefore,
                  balanceAfter,
                  idempotencyKey: options?.idempotencyKey,
                  initiatedBy: options?.initiatedBy,
                  initiatedByType: options?.initiatedByType || "system",
                  bonusCategory: options?.bonusCategory,
                  isHiddenFromUser: options?.isHiddenFromUser,
                  meta: options?.meta,
                },
              ],
              { session: session || undefined },
            );
          } catch (txnError: any) {
            // Handle duplicate idempotency key (shouldn't happen, but handle it)
            if (txnError.code === 11000 && options?.idempotencyKey) {
              logger.warn(
                `Duplicate credit key detected: ${options.idempotencyKey}`,
              );

              const existing = await Transaction.findOne({
                idempotencyKey: options.idempotencyKey,
              });

              if (existing && existing.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existing.walletId,
                  reference: existing.reference,
                  balanceBefore: existing.balanceBefore,
                  balanceAfter: existing.balanceAfter,
                  amount: existing.amount,
                  direction: "CREDIT" as const,
                  transaction: existing,
                };
              }
            }
            throw txnError;
          }

          //  Update wallet balance
          const updatedWallet = await retryOperation(
            async () =>
              await Wallet.findOneAndUpdate(
                { _id: wallet._id },
                { $inc: { balance: amount } },
                { new: true, session: session || undefined },
              ),
          );

          if (!updatedWallet) {
            throw new AppError(
              "Wallet update failed",
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              ERROR_CODES.DATABASE_ERROR,
            );
          }

          //  Update transaction status to SUCCESS
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { status: "success" },
            { session: session || undefined },
          );

          // Mark the original transaction as reversed
          if (options?.linkedTransactionId) {
            await Transaction.findOneAndUpdate(
              { _id: options.linkedTransactionId, status: { $ne: "reversed" } },
              {
                status: "reversed",
                reversedAt: new Date(),
                reversalReason: `Auto-reversed: ${reason}`,
              },
              { session: session || undefined },
            );
          }

          if (session) await session.commitTransaction();

          SocketService.emitToUser(userId.toString(), "wallet_credit", {
            balance: Math.trunc(updatedWallet.balance * 100) / 100,
            bonusBalance: Math.trunc(updatedWallet.bonusBalance * 100) / 100,
            commissionBalance: Math.trunc(updatedWallet.commissionBalance * 100) / 100,
            amount,
            direction: "CREDIT",
            type: options?.type || "deposit",
            reference,
            reason,
            timestamp: new Date().toISOString(),
          });

          this.auditLoggingService
            .logWalletEvent({
              userId: userId as Types.ObjectId,
              action: "credit",
              amount,
              balanceBefore,
              balanceAfter: updatedWallet.balance,
              reason: reason || "refund",
              reference,
              transactionId: transaction?._id?.toString(),
              initiatedBy: options?.initiatedByType || "system",
            })
            .catch((err: any) =>
              logger.error(
                `Failed to log wallet event CREDIT WALLET: ${{
                  userId: userId.toString(),
                  action: "credit",
                  amount,
                  balanceBefore,
                  balanceAfter: updatedWallet.balance,
                  reason: reason || "refund",
                  reference,
                  transactionId: transaction?._id?.toString(),
                  initiatedBy: options?.initiatedByType || "system",
                }}:`,
                err,
              ),
            );

          this.cacheService
            .delete(CACHE_KEYS.USER_WALLET(userId.toString()))
            .catch((err) =>
              logger.error("Failed to invalidate wallet cache:", err),
            );

          this.notificationService
            .createNotification({
              type: "wallet_credit",
              notifiableType: "User",
              notifiableId: userId as Types.ObjectId,
              data: {
                amount,
                balance: updatedWallet.balance,
                reason,
                reference,
              },
              sendEmail: options?.suppressNotification ? false : true,
              sendSMS: false,
              sendPush: false,
            })
            .catch((err) =>
              logger.info("Failed to send credit notification", err),
            );

          logger.info(
            `Wallet credited: ${reference} - User: ${userId}, Amount: ${amount}`,
          );

          return {
            walletId: wallet.id,
            reference,
            balanceBefore,
            balanceAfter: updatedWallet.balance,
            amount,
            direction: "CREDIT",
            transaction,
          };
        } catch (error: any) {
          if (session) await session.abortTransaction();
          logger.error("Credit wallet failed:", error);
          throw error;
        } finally {
          if (session) session.endSession();
        }
      },
      userId.toString(),
    );
  }

  async getWalletTransactions(
    userId: string,
    filters: any = {},
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const query: any = { walletId: wallet._id };

    if (filters.type) {
      query.type = filters.type;
    } else {
      query.type = { $ne: "refund" };
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.direction) {
      query.direction = filters.direction;
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        query.createdAt.$lte = new Date(filters.endDate);
      }
    }

    const result = await this.transactionRepository.findWithFilters(
      query,
      page,
      limit,
    );

    const linked = await this.transactionRepository.findLinkedTransactions(
      result.data.map((t: any) => t._id),
    );
    const linkedMap = new Map(
      linked.map((l: any) => [l.linkedTransactionId.toString(), l]),
    );

    return TransactionMapper.toPaginatedDTO(
      result.data,
      result.total,
      page,
      limit,
      linkedMap,
    );
  }

  async getBalanceHistory(userId: string, days: number = 30): Promise<any> {
    const wallet = await this.walletRepository.findByUserId(userId);
    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const transactions = await this.transactionRepository.findWithFilters(
      {
        walletId: wallet._id,
        createdAt: { $gte: startDate },
      },
      1,
      1000,
    );

    return {
      currentBalance: wallet.balance,
      history: transactions.data.map((txn: any) => ({
        date: txn.createdAt,
        balance: txn.balanceAfter,
        amount: txn.amount,
        direction: txn.direction,
        type: txn.type,
        reference: txn.reference,
        status: txn.status,
      })),
    };
  }

  async transferFunds(
    senderId: string,
    recipientIdentifier: string,
    amount: number,
    remark?: string,
    channel?: "ios" | "android" | "web" | "api",
  ): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "wallet_transfer",
      async () => {
        // Generate more unique transferId using nanoseconds
        const hrtime = process.hrtime();
        const nanoTimestamp = hrtime[0] * 1e9 + hrtime[1];
        const random = Math.random().toString(36).substring(2, 15);
        const transferId = `TRF-${nanoTimestamp}-${random}`;

        const existingTransfer = await Transaction.findOne({
          idempotencyKey: transferId,
        });

        if (existingTransfer) {
          logger.warn(`Duplicate transfer attempt: ${transferId}`);
          return {
            reference: existingTransfer.reference,
            transferId: existingTransfer.meta?.transferId || transferId,
            amountSent: existingTransfer.amount,
            amountReceived:
              existingTransfer.meta?.baseAmount || existingTransfer.amount,
            serviceCharge:
              existingTransfer.meta?.serviceCharge?.chargeInfo?.serviceCharge ||
              0,
            senderBalance: existingTransfer.balanceAfter,
            recipient: {
              id: existingTransfer.recipientId,
              username: existingTransfer.meta?.recipientUsername,
              email: existingTransfer.meta?.recipientEmail,
            },
          };
        }

        const session = this.isTestEnvironment()
          ? null
          : await mongoose.startSession();
        if (session) session.startTransaction();

        try {
          const chargeCalculation =
            await this.helperService.calculateAmountWithCharge(
              amount,
              TRANSACTION_TYPES.WALLET_TRANSFER,
            );

          const baseAmount = roundAmount(chargeCalculation.baseAmount);
          const chargeAmount = roundAmount(chargeCalculation.chargeAmount);
          const totalAmount = roundAmount(chargeCalculation.totalAmount);

          const [byUsername, byEmail, byPhone, byRefCode] = await Promise.all([
            this.userRepository.findByUsername(recipientIdentifier),
            this.userRepository.findByEmail(recipientIdentifier),
            this.userRepository.findByPhone(recipientIdentifier),
            this.userRepository.findByRefCode(recipientIdentifier),
          ]);

          const recipient = byUsername || byEmail || byPhone || byRefCode;

          if (!recipient) {
            throw new AppError(
              "Recipient not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          if (recipient.id.toString() === senderId) {
            throw new AppError(
              "Cannot transfer to yourself",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }

          this.validateRecipient(recipient, {
            allowSuspended: false,
            allowInactive: false,
            allowFraudulent: false,
          });

          const [senderReference, recipientReference] = [
            generateReference("TXN"),
            generateReference("TXN"),
          ];

          const sender = await this.userRepository.findById(senderId);

          if (!sender) {
            throw new AppError(
              "Sender not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          if (sender.status === "shadow-banned") {
            if (session) await session.abortTransaction();
            throw new AppError(
              "Your account has a temporary restriction. Please contact support.",
              HTTP_STATUS.FORBIDDEN,
              ERROR_CODES.ACCOUNT_RESTRICTED,
            );
          }

          const [senderWallet, recipientWallet] = await Promise.all([
            this.walletRepository.findByUserId(senderId),
            this.walletRepository.findByUserId(recipient.id),
          ]);

          if (!senderWallet || !recipientWallet) {
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          const senderBalanceBefore = roundAmount(senderWallet.balance);
          const recipientBalanceBefore = roundAmount(recipientWallet.balance);

          const senderBalanceAfter = roundAmount(
            senderBalanceBefore - totalAmount,
          );
          const recipientBalanceAfter = roundAmount(
            recipientBalanceBefore + baseAmount,
          );

          let systemWallet = null;
          let systemBalanceBefore = 0;
          let systemBalanceAfter = 0;

          if (chargeAmount > 0) {
            const systemUser = await this.systemConfigService.getSystemUser();
            systemWallet = await this.walletRepository.findByUserId(
              systemUser._id as Types.ObjectId,
            );

            if (!systemWallet) {
              throw new AppError(
                "System wallet not configured",
                HTTP_STATUS.INTERNAL_SERVER_ERROR,
                ERROR_CODES.CONFIGURATION_ERROR,
              );
            }

            systemBalanceBefore = roundAmount(systemWallet.balance);
            systemBalanceAfter = roundAmount(
              systemBalanceBefore + chargeAmount,
            );
          }

          // Only one concurrent request can successfully debit
          const senderUpdated = await retryOperation(
            async () =>
              await Wallet.findOneAndUpdate(
                {
                  _id: senderWallet._id,
                  balance: { $gte: totalAmount },
                },
                {
                  $inc: { balance: -totalAmount },
                },
                { new: true, session: session || undefined },
              ),
          );

          if (!senderUpdated) {
            const errMsg = `Insufficient balance. Required: ${totalAmount}, Available: ${senderBalanceBefore}`;
            SentryHelper.captureBusinessError(
              "INSUFFICIENT_BALANCE",
              errMsg,
              senderId,
              { required: totalAmount, available: senderBalanceBefore },
            );
            throw new AppError(
              errMsg,
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          const recipientUpdated = await Wallet.findOneAndUpdate(
            { _id: recipientWallet._id },
            { $inc: { balance: baseAmount } },
            { new: true, session: session || undefined },
          );

          if (!recipientUpdated) {
            throw new AppError(
              "Recipient wallet update failed",
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              ERROR_CODES.DATABASE_ERROR,
            );
          }

          let systemUpdated = null;
          if (chargeAmount > 0 && systemWallet) {
            systemUpdated = await Wallet.findOneAndUpdate(
              { _id: systemWallet._id },
              { $inc: { balance: chargeAmount } },
              { new: true, session: session || undefined },
            );

            if (!systemUpdated) {
              throw new AppError(
                "System wallet update failed",
                HTTP_STATUS.INTERNAL_SERVER_ERROR,
                ERROR_CODES.DATABASE_ERROR,
              );
            }
          }

          const transactions: any[] = [
            {
              walletId: senderWallet._id,
              userId: new Types.ObjectId(senderId),
              sourceId: new Types.ObjectId(senderId),
              recipientId: recipient.id,
              reference: senderReference,
              idempotencyKey: transferId,
              amount: totalAmount,
              direction: "DEBIT",
              type: TRANSACTION_TYPES.WALLET_TRANSFER,
              provider: SYSTEM.PROVIDER,
              remark,
              channel: channel || "web",
              purpose: "wallet_to_wallet_transfer",
              status: "success",
              balanceBefore: senderBalanceBefore,
              balanceAfter: senderUpdated.balance,
              initiatedBy: new Types.ObjectId(senderId),
              initiatedByType: "user",
              meta: {
                transferId,
                recipientUsername: recipient.username,
                recipientEmail: recipient.email,
                recipientId: recipient.id.toString(),
                senderUsername: sender.username,
                senderEmail: sender.email,
                senderId: sender.id.toString(),
                chargeInfo: {
                  baseAmount,
                  serviceCharge: chargeAmount,
                  chargeType: chargeCalculation.serviceCharge?.type,
                  chargeValue: chargeCalculation.serviceCharge?.value,
                  isServiceChargeCapped: chargeCalculation.isCapped,
                },
              },
            },
            {
              walletId: recipientWallet._id,
              userId: recipient.id,
              sourceId: new Types.ObjectId(senderId),
              recipientId: recipient.id,
              reference: recipientReference,
              idempotencyKey: `${transferId}_recipient`,
              amount: baseAmount,
              direction: "CREDIT",
              type: TRANSACTION_TYPES.WALLET_TRANSFER,
              provider: SYSTEM.PROVIDER,
              remark,
              channel: channel || "web",
              purpose: "wallet_to_wallet_transfer",
              status: "success",
              balanceBefore: recipientBalanceBefore,
              balanceAfter: recipientUpdated.balance,
              initiatedBy: new Types.ObjectId(senderId),
              initiatedByType: "user",
              meta: {
                transferId,
                senderInfo: "Transfer received",
                senderId: senderId,
                senderUsername: sender.username,
                senderEmail: sender.email,

                recipientUsername: recipient.username,
                recipientEmail: recipient.email,
                recipientId: recipient.id.toString(),
                chargeInfo: {
                  baseAmount,
                  serviceCharge: chargeAmount,
                  note: "Amount after service charge deduction",
                  isServiceChargeCapped: chargeCalculation.isCapped,
                },
              },
            },
          ];

          if (chargeAmount > 0 && systemWallet && systemUpdated) {
            transactions.push({
              walletId: systemWallet._id,
              userId: systemWallet.userId,
              sourceId: new Types.ObjectId(senderId),
              recipientId: systemWallet.userId,
              reference: generateReference("CHG"),
              idempotencyKey: `${transferId}_charge`,
              amount: chargeAmount,
              direction: "CREDIT",
              type: TRANSACTION_TYPES.SERVICE_CHARGE,
              provider: SYSTEM.PROVIDER,
              remark: "Transfer service charge",
              purpose: "wallet_transfer_fee",
              status: "success",
              balanceBefore: systemBalanceBefore,
              balanceAfter: systemUpdated.balance,
              initiatedBy: new Types.ObjectId(senderId),
              initiatedByType: "system",
              meta: {
                parentTransferId: transferId,
                parentReference: senderReference,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                relatedTransaction: {
                  senderId,
                  recipientId: recipient.id.toString(),
                  baseAmount,
                },
              },
            });
          }

          await Transaction.insertMany(transactions, {
            session: session || undefined,
          });

          if (session) await session.commitTransaction();

          SocketService.emitToUser(senderId, "wallet_debit", {
            balance: Math.trunc(senderUpdated.balance * 100) / 100,
            bonusBalance: Math.trunc(senderWallet.bonusBalance * 100) / 100,
            commissionBalance: Math.trunc(senderWallet.commissionBalance * 100) / 100,
            amount: totalAmount,
            direction: "DEBIT",
            type: TRANSACTION_TYPES.WALLET_TRANSFER,
            reference: senderReference,
            reason: `Transfer to ${recipient.username || recipient.email}`,
            timestamp: new Date().toISOString(),
          });

          SocketService.emitToUser(recipient.id.toString(), "wallet_credit", {
            balance: Math.trunc(recipientUpdated.balance * 100) / 100,
            bonusBalance: Math.trunc(recipientWallet.bonusBalance * 100) / 100,
            commissionBalance: Math.trunc(recipientWallet.commissionBalance * 100) / 100,
            amount: baseAmount,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.WALLET_TRANSFER,
            reference: recipientReference,
            reason: "Transfer received",
            timestamp: new Date().toISOString(),
          });

          const cacheOps = [
            this.cacheService.deleteWithAlert(
              CACHE_KEYS.USER_WALLET(senderId),
              {
                userId: senderId,
                operation: TRANSACTION_TYPES.WALLET_TRANSFER,
              },
            ),
            this.cacheService.deleteWithAlert(
              CACHE_KEYS.USER_WALLET(recipient.id.toString()),
              {
                userId: recipient.id.toString(),
                operation: TRANSACTION_TYPES.WALLET_TRANSFER,
              },
            ),
          ];

          if (chargeAmount > 0) {
            cacheOps.push(this.systemConfigService.clearSystemUserCache());
          }

          const notificationOps = [
            this.notificationService.createNotification({
              type: "wallet_debit",
              notifiableType: "User",
              notifiableId: new Types.ObjectId(senderId),
              data: {
                amount: totalAmount,
                baseAmount,
                serviceCharge: chargeAmount,
                balance: senderUpdated.balance,
                reason: `Transfer to ${recipient.username || recipient.email}`,
                reference: senderReference,
              },
              sendEmail: true,
              sendSMS: false,
              sendPush: true,
            }),
            this.notificationService.createNotification({
              type: "wallet_credit",
              notifiableType: "User",
              notifiableId: recipient.id,
              data: {
                amount: baseAmount,
                balance: recipientUpdated.balance,
                reason: "Transfer received",
                reference: recipientReference,
              },
              sendEmail: true,
              sendSMS: false,
              sendPush: true,
            }),
          ];

          Promise.allSettled([...cacheOps, ...notificationOps]).catch((err) =>
            logger.error("Background operations failed:", err),
          );

          logger.info(
            `Transfer completed: ${transferId} - ${senderId} → ${recipient.id} | Total: ${totalAmount} | Base: ${baseAmount} | Charge: ${chargeAmount}`,
          );

          SentryHelper.captureBusinessError(
            "WALLET_TRANSFER_SUCCESS",
            `Wallet transfer completed successfully`,
            senderId,
            {
              recipientId: recipient.id,
              totalAmount,
              serviceCharge: chargeAmount,
              reference: senderReference,
            },
          );

          return {
            reference: senderReference,
            transferId,
            amount: baseAmount,
            amountSent: totalAmount,
            amountReceived: baseAmount,
            serviceCharge: chargeAmount,
            senderBalance: senderUpdated.balance,
            recipient: {
              id: recipient._id,
              username: recipient.username,
              email: recipient.email,
            },
          };
        } catch (error: any) {
          SentryHelper.captureBusinessError(
            "WALLET_TRANSFER_FAILED",
            `Wallet transfer failed: ${error.message}`,
            senderId,
            {
              recipientId: recipientIdentifier,
              amount: amount,
              error: error.message,
            },
          );
          if (session) await session.abortTransaction();
          try {
            recordTransactionFailure(
              senderId,
              TRANSACTION_TYPES.WALLET_TRANSFER,
            );
          } catch (trackingError: any) {
            // Redis may be down — fraud tracking is blind, alert immediately
            logger.error(
              "CRITICAL: recordTransactionFailure failed — fraud tracking disabled",
              { userId: senderId, error: trackingError.message },
            );
          }
          logger.error("Transfer failed:", error);
          throw error;
        } finally {
          if (session) session.endSession();
        }
      },
      senderId,
    );
  }

  async verifyBeneficiary(identifier: string): Promise<any> {
    let user = await this.userRepository.findByUsername(identifier);
    if (!user) {
      user = await this.userRepository.findByEmail(identifier);
    }
    if (!user) {
      user = await this.userRepository.findByRefCode(identifier);
    }

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      id: user._id,
      username: user.username,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
    };
  }

  async getBeneficiaries(userId: string, search: string): Promise<any> {
    // Get unique recipients from transaction history
    const transactions = await this.transactionRepository.findWithFilters(
      {
        sourceId: userId,
        type: "wallet_transfer",
        status: "success",
      },
      1,
      100,
    );

    const recipientIds = [
      ...new Set(
        transactions.data
          .map((t: any) => t.recipientId?.toString())
          .filter(Boolean),
      ),
    ];

    const beneficiaries = await Promise.all(
      recipientIds.map(async (id) => {
        const user = await this.userRepository.findById(id);
        return user
          ? {
              id: user._id,
              username: user.username,
              email: user.email,
              firstname: user.firstname,
              lastname: user.lastname,
              phone: user.phone,
            }
          : null;
      }),
    );

    let filteredBeneficiaries = beneficiaries.filter(
      (b): b is NonNullable<typeof b> => b !== null,
    );

    if (search?.trim()) {
      const searchLower = search.trim().toLowerCase();
      filteredBeneficiaries = filteredBeneficiaries.filter((beneficiary) => {
        return (
          beneficiary.username?.toLowerCase().includes(searchLower) ||
          beneficiary.email?.toLowerCase().includes(searchLower) ||
          beneficiary.firstname?.toLowerCase().includes(searchLower) ||
          beneficiary.lastname?.toLowerCase().includes(searchLower) ||
          `${beneficiary.firstname} ${beneficiary.lastname}`
            .toLowerCase()
            .includes(searchLower)
        );
      });
    }

    return filteredBeneficiaries;
  }

  async searchBeneficiaries(userId: string, search?: string): Promise<any> {
    if (!search || !search.trim()) {
      return this.getBeneficiaries(userId, "");
    }

    const cleanQuery = search.trim();

    const user = await this.userRepository.findOne({
      status: "active",
      $or: [
        { username: { $regex: new RegExp(`^${cleanQuery}$`, "i") } },
        { email: cleanQuery },
        { phone: cleanQuery },
      ],
    });

    if (!user) return [];

    if (user._id.toString() === userId.toString()) {
      throw new AppError(
        "You cannot add yourself as a beneficiary",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    return [
      {
        id: user._id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        phone: user.phone,
      },
    ];
  }

  private validateRecipient(
    recipient: IUser,
    options: RecipientValidationOptions = {},
  ): void {
    const {
      allowSuspended = false,
      allowInactive = false,
      allowFraudulent = false,
      requireEmailVerified = false,
      requirePhoneVerified = false,
    } = options;

    // Check account status
    if (recipient.status === "fraudulent" && !allowFraudulent) {
      throw new AppError(
        "Cannot transfer to flagged account",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    if (recipient.status === "suspended" && !allowSuspended) {
      throw new AppError(
        "Cannot transfer to suspended account",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_SUSPENDED,
      );
    }

    if (recipient.status === "inactive" && !allowInactive) {
      throw new AppError(
        "Cannot transfer to inactive account",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_INACTIVE,
      );
    }

    // Check verification requirements
    if (requireEmailVerified && !recipient.emailVerifiedAt) {
      throw new AppError(
        "Recipient email not verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.EMAIL_NOT_VERIFIED,
      );
    }

    if (requirePhoneVerified && !recipient.phoneVerifiedAt) {
      throw new AppError(
        "Recipient phone not verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Check if account is deleted (soft delete)
    if (recipient.deletedAt) {
      throw new AppError(
        "Cannot transfer to deleted account",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
  }

  //  Check if recipient can receive transfers (boolean version)
  private canReceiveTransfer(
    recipient: IUser,
    options: RecipientValidationOptions = {},
  ): boolean {
    try {
      this.validateRecipient(recipient, options);
      return true;
    } catch {
      return false;
    }
  }

  // Get human-readable reason why recipient cannot receive transfers
  private getInvalidReason(
    recipient: IUser,
    options: RecipientValidationOptions = {},
  ): string | null {
    try {
      this.validateRecipient(recipient, options);
      return null;
    } catch (error: any) {
      return error.message;
    }
  }

  async debitBonus(
    userId: string | Types.ObjectId,
    amount: number,
    reason: string,
    options?: {
      type?: string;
      provider?: string;
      providerReference?: string;
      transactableType?: string;
      transactableId?: Types.ObjectId;
      idempotencyKey?: string;
      initiatedBy?: Types.ObjectId;
      initiatedByType?: SystemProvider;
      meta?: any;
      channel?: string;
      remark?: string;
      suppressNotification?: boolean;
      bonusCategory?: string;
      isHiddenFromUser?: boolean;
    },
  ): Promise<WalletTransactionResult> {
    return SentryHelper.trackCriticalOperation(
      "wallet_debit_bonus",
      async () => {
        const session = this.isTestEnvironment()
          ? null
          : await mongoose.startSession();
        if (session) session.startTransaction();

        try {
          if (options?.idempotencyKey) {
            const existingTxn = await Transaction.findOne({
              idempotencyKey: options.idempotencyKey,
            });
            if (existingTxn) {
              if (existingTxn.status === "pending") {
                const ageMs = Date.now() - existingTxn.createdAt.getTime();
                if (ageMs < 5 * 60 * 1000) {
                  if (session) await session.abortTransaction();
                  throw new AppError(
                    "Operation in progress.",
                    HTTP_STATUS.CONFLICT,
                    ERROR_CODES.VALIDATION_ERROR,
                  );
                }
                await Transaction.findByIdAndUpdate(
                  existingTxn._id,
                  { status: "failed" },
                  { session: session || undefined },
                );
              } else if (existingTxn.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existingTxn.walletId,
                  reference: existingTxn.reference,
                  balanceBefore: existingTxn.balanceBefore,
                  balanceAfter: existingTxn.balanceAfter,
                  amount: existingTxn.amount,
                  direction: "DEBIT",
                  transaction: existingTxn,
                };
              } else if (existingTxn.status !== "failed") {
                if (session) await session.abortTransaction();
                throw new AppError(
                  `Operation has status: ${existingTxn.status}`,
                  HTTP_STATUS.CONFLICT,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }
            }
          }

          const wallet = await this.walletRepository.findByUserId(userId);
          if (!wallet)
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );

          const reference = generateReference("BNSTXN");
          const bonusBalanceBefore = wallet.bonusBalance;

          if (bonusBalanceBefore < amount) {
            throw new AppError(
              "Insufficient bonus balance",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          const bonusBalanceAfter = bonusBalanceBefore - amount;

          let transaction;
          try {
            [transaction] = await Transaction.create(
              [
                {
                  walletId: wallet._id,
                  sourceId: new Types.ObjectId(userId),
                  userId: new Types.ObjectId(userId),
                  recipientId:
                    options?.transactableType === "User"
                      ? options.transactableId
                      : undefined,
                  transactableType: options?.transactableType,
                  transactableId: options?.transactableId,
                  reference,
                  providerReference: options?.providerReference,
                  amount: Number(amount),
                  direction: "DEBIT",
                  type: options?.type || "cashback_spent",
                  provider: options?.provider || SYSTEM.PROVIDER,
                  remark: options?.remark || reason,
                  purpose: reason,
                  channel: options?.channel,
                  status: "pending",
                  balanceBefore: wallet.balance,
                  balanceAfter: wallet.balance,
                  bonusBalanceBefore,
                  bonusBalanceAfter,
                  idempotencyKey: options?.idempotencyKey,
                  initiatedBy: options?.initiatedBy,
                  initiatedByType: options?.initiatedByType || "system",
                  bonusCategory: options?.bonusCategory,
                  isHiddenFromUser: options?.isHiddenFromUser,
                  meta: options?.meta,
                },
              ],
              { session: session || undefined },
            );
          } catch (txnError: any) {
            if (txnError.code === 11000 && options?.idempotencyKey) {
              const existing = await Transaction.findOne({
                idempotencyKey: options.idempotencyKey,
              });
              if (existing && existing.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existing.walletId,
                  reference: existing.reference,
                  balanceBefore: existing.balanceBefore,
                  balanceAfter: existing.balanceAfter,
                  amount: existing.amount,
                  direction: "DEBIT",
                  transaction: existing,
                };
              }
            }
            throw txnError;
          }

          const updatedWallet = await retryOperation(
            async () =>
              await Wallet.findOneAndUpdate(
                { _id: wallet._id, bonusBalance: { $gte: amount } },
                { $inc: { bonusBalance: -amount } },
                { new: true, session: session || undefined },
              ),
            3,
            50,
          );

          if (!updatedWallet) {
            throw new AppError(
              "Insufficient bonus balance",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          await Transaction.findByIdAndUpdate(
            transaction._id,
            { status: "success" },
            { session: session || undefined },
          );

          if (session) await session.commitTransaction();

          this.cacheService
            ?.delete(CACHE_KEYS.USER_WALLET(userId.toString()))
            ?.catch(() => {});

          return {
            walletId: wallet.id,
            reference,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance,
            amount,
            direction: "DEBIT",
            transaction,
          };
        } catch (error: any) {
          if (session) await session.abortTransaction();
          throw error;
        } finally {
          if (session) session.endSession();
        }
      },
      userId.toString(),
    );
  }

  async creditBonus(
    userId: string | Types.ObjectId,
    amount: number,
    reason: string,
    options?: {
      type?: string;
      provider?: string;
      providerReference?: string;
      transactableType?: string;
      transactableId?: Types.ObjectId;
      idempotencyKey?: string;
      initiatedBy?: Types.ObjectId;
      initiatedByType?: SystemProvider;
      linkedTransactionId?: Types.ObjectId;
      channel?: string;
      meta?: any;
      remark?: string;
      suppressNotification?: boolean;
      bonusCategory?: string;
      isHiddenFromUser?: boolean;
    },
  ): Promise<WalletTransactionResult> {
    return SentryHelper.trackCriticalOperation(
      "wallet_credit_bonus",
      async () => {
        const session = this.isTestEnvironment()
          ? null
          : await mongoose.startSession();
        if (session) session.startTransaction();

        try {
          if (options?.idempotencyKey) {
            const existingTxn = await Transaction.findOne({
              idempotencyKey: options.idempotencyKey,
            });
            if (existingTxn) {
              if (existingTxn.status === "pending") {
                const ageMs = Date.now() - existingTxn.createdAt.getTime();
                if (ageMs < 5 * 60 * 1000) {
                  if (session) await session.abortTransaction();
                  throw new AppError(
                    "Operation in progress.",
                    HTTP_STATUS.CONFLICT,
                    ERROR_CODES.VALIDATION_ERROR,
                  );
                }
                await Transaction.findByIdAndUpdate(
                  existingTxn._id,
                  { status: "failed" },
                  { session: session || undefined },
                );
              } else if (existingTxn.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existingTxn.walletId,
                  reference: existingTxn.reference,
                  balanceBefore: existingTxn.balanceBefore,
                  balanceAfter: existingTxn.balanceAfter,
                  amount: existingTxn.amount,
                  direction: "CREDIT",
                  transaction: existingTxn,
                };
              } else if (existingTxn.status !== "failed") {
                if (session) await session.abortTransaction();
                throw new AppError(
                  `Operation has status: ${existingTxn.status}`,
                  HTTP_STATUS.CONFLICT,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }
            }
          }

          const wallet = await this.walletRepository.findByUserId(userId);
          if (!wallet)
            throw new AppError(
              "Wallet not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );

          const reference = generateReference("BNSTXN");
          const bonusBalanceBefore = wallet.bonusBalance;
          const bonusBalanceAfter = bonusBalanceBefore + amount;

          let transaction;
          try {
            [transaction] = await Transaction.create(
              [
                {
                  walletId: wallet._id,
                  sourceId:
                    options?.transactableType === "User"
                      ? options.transactableId
                      : userId,
                  recipientId: new Types.ObjectId(userId),
                  userId: new Types.ObjectId(userId),
                  transactableType: options?.transactableType,
                  transactableId: options?.transactableId,
                  linkedTransactionId: options?.linkedTransactionId ?? null,
                  reference,
                  providerReference: options?.providerReference,
                  amount: Number(amount),
                  direction: "CREDIT",
                  type: options?.type || "cashback_earned",
                  provider: options?.provider || SYSTEM.PROVIDER,
                  remark: options?.remark || reason,
                  purpose: reason,
                  channel: options?.channel,
                  status: "pending",
                  balanceBefore: wallet.balance,
                  balanceAfter: wallet.balance,
                  bonusBalanceBefore,
                  bonusBalanceAfter,
                  idempotencyKey: options?.idempotencyKey,
                  initiatedBy: options?.initiatedBy,
                  initiatedByType: options?.initiatedByType || "system",
                  bonusCategory: options?.bonusCategory,
                  isHiddenFromUser: options?.isHiddenFromUser,
                  meta: options?.meta,
                },
              ],
              { session: session || undefined },
            );
          } catch (txnError: any) {
            if (txnError.code === 11000 && options?.idempotencyKey) {
              const existing = await Transaction.findOne({
                idempotencyKey: options.idempotencyKey,
              });
              if (existing && existing.status === "success") {
                if (session) await session.abortTransaction();
                return {
                  walletId: existing.walletId,
                  reference: existing.reference,
                  balanceBefore: existing.balanceBefore,
                  balanceAfter: existing.balanceAfter,
                  amount: existing.amount,
                  direction: "CREDIT",
                  transaction: existing,
                };
              }
            }
            throw txnError;
          }

          const updatedWallet = await retryOperation(
            async () =>
              await Wallet.findOneAndUpdate(
                { _id: wallet._id },
                { $inc: { bonusBalance: amount } },
                { new: true, session: session || undefined },
              ),
          );

          if (!updatedWallet) {
            throw new AppError(
              "Wallet update failed",
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              ERROR_CODES.DATABASE_ERROR,
            );
          }

          await Transaction.findByIdAndUpdate(
            transaction._id,
            { status: "success" },
            { session: session || undefined },
          );

          if (options?.linkedTransactionId) {
            await Transaction.findByIdAndUpdate(
              options.linkedTransactionId,
              { status: "reversed" },
              { session: session || undefined },
            );
          }

          if (session) await session.commitTransaction();

          this.cacheService
            ?.delete(CACHE_KEYS.USER_WALLET(userId.toString()))
            ?.catch(() => {});

          return {
            walletId: wallet.id,
            reference,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance,
            amount,
            direction: "CREDIT",
            transaction,
          };
        } catch (error: any) {
          if (session) await session.abortTransaction();
          throw error;
        } finally {
          if (session) session.endSession();
        }
      },
      userId.toString(),
    );
  }
}
