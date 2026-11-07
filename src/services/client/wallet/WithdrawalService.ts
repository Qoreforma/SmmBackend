import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
  CACHE_KEYS,
} from "@/utils/constants";
import { cacheService } from "@/services/core/CacheService";
import { generateReference, getEnviroment } from "@/utils/helpers";
import { Types } from "mongoose";
import { UserRepository } from "@/repositories/client/UserRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { MonnifyService } from "../providers/payments/MonnifyService";
import { FlutterwaveService } from "../providers/payments/FlutterwaveService";
import logger from "@/logger";
import mongoose from "mongoose";
import { HelperService } from "@/services/client/utility/HelperService";
import { NotificationService } from "../notifications/NotificationService";
import { EmailService } from "../../core/EmailService";
import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { recordTransactionFailure } from "../../monitoring/transactionFailureTracker";
import { WalletService } from "./WalletService";
import { ServiceType } from "@/models/reference/ServiceType";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { XixapayService } from "../providers/payments/XixapayService";
import SocketService from "@/services/core/SocketService";

// Service type codes for manual fallback feature flags
const SERVICE_TYPE_CODES = {
  MANUAL_WITHDRAWAL: "manual_withdrawal",
} as const;

const environment = getEnviroment();

const getErrorMessage = (
  devMessage: string,
  prodMessage: string,
  context?: Record<string, any>,
): string => {
  if (environment === "development") {
    const contextStr = context
      ? ` | ${Object.entries(context)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ")}`
      : "";
    return devMessage + contextStr;
  }
  return prodMessage;
};

export class WithdrawalService {
  constructor(
    private bankAccountRepository: BankAccountRepository,
    private walletRepository: WalletRepository,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private bankRepository: BankRepository,
    private saveHavenService: SaveHavenService,
    private helperService: HelperService,
    private monnifyService: MonnifyService,
    private flutterwaveService: FlutterwaveService,
    private xixapayService: XixapayService,
    private walletService: WalletService,
    private manualWithdrawalRepository: ManualWithdrawalRepository,
  ) { }

  // Private Helpers

  private isSaveHavenSyncCompleted(
    provider: string,
    providerResult: any,
  ): boolean {
    if (provider !== "saveHaven") return false;

    const status = providerResult?.status?.toString().toLowerCase();
    const statusCodeOk =
      providerResult?.statusCode === 200 || providerResult?.statusCode === 0;

    return statusCodeOk && status === "completed";
  }

  // Check if the manual_withdrawal service type is active.
  // Falls back to false (normal reversal) if the check itself errors.
  private async isManualWithdrawalActive(): Promise<boolean> {
    try {
      const serviceType = await ServiceType.findOne({
        code: SERVICE_TYPE_CODES.MANUAL_WITHDRAWAL,
        deletedAt: null,
      });
      return serviceType?.status === "active";
    } catch (err) {
      logger.error("Failed to check manual_withdrawal service type:", err);
      return false; // Safe default: fall back to normal reversal
    }
  }

  // When automated provider fails and manual_withdrawal is active:
  // - Keep funds debited (admin will send manually)
  // - Save a ManualWithdrawalRequest for the admin panel
  // - Update transaction phase to manual_fallback (status stays pending)
  // - Notify admin + user

  private async handleManualWithdrawalFallback(data: {
    transaction: any;
    stampDutyTransaction?: any;
    userId: string;
    amount: number;
    chargeAmount: number;
    stampDutyAmount?: number;
    totalDeduction: number;
    bankAccount: any;
    bank: any;
    bankCode: string;
    provider: string;
    reference: string;
    providerError: string;
  }): Promise<void> {
    return SentryHelper.trackCriticalOperation(
      "withdrawal_manual_fallback",
      async () => {
        const {
          transaction,
          stampDutyTransaction,
          userId,
          amount,
          chargeAmount,
          stampDutyAmount = 0,
          totalDeduction,
          bankAccount,
          bank,
          bankCode,
          provider,
          reference,
          providerError,
        } = data;

        // Create the manual withdrawal request for the admin panel
        await this.manualWithdrawalRepository.create({
          userId: new Types.ObjectId(userId),
          transactionId: transaction._id,
          stampDutyTransactionId: stampDutyTransaction?._id ?? null,
          reference,
          amount,
          chargeAmount,
          stampDutyAmount,
          totalDeduction,
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
          bankName: bank.name,
          bankCode,
          provider,
          status: "pending",
          meta: {
            providerError,
            failedAt: new Date().toISOString(),
            originalTransactionMeta: transaction.meta,
          },
        });
        SentryHelper.captureBusinessError(
          "WITHDRAWAL_PROVIDER_FAILED_FALLBACK_ACTIVATED",
          `Withdrawal failed - manual fallback activated`,
          data.userId,
          {
            reference: data.reference,
            amount: data.amount,
            provider: data.provider,
            providerError: data.providerError,
          },
        );

        // This prevents the cron job from automatically reversing it
        await Transaction.findByIdAndUpdate(transaction._id, {
          status: "pending_manual",
          provider: "Admin",
          meta: {
            ...transaction.meta,
            phase: "manual_fallback",
            manualFallbackAt: new Date().toISOString(),
            providerError: providerError,
            manualFallbackReason:
              "SaveHaven Automated provider failed; pending manual processing",
          },
        });

        if (stampDutyTransaction) {
          await Transaction.findByIdAndUpdate(stampDutyTransaction._id, {
            status: "pending_manual",
            provider: "Admin",
            meta: {
              ...stampDutyTransaction.meta,
              phase: "manual_fallback",
              manualFallbackAt: new Date().toISOString(),
              providerError: providerError,
              manualFallbackReason:
                "SaveHaven Automated provider failed; pending manual processing",
            },
          });
        }

        // Notify admin via email
        const adminEmail =
          process.env.ADMIN_EMAIL ||
          `admin@${process.env.APP_NAME?.toLowerCase()}.com`;

        this.emailService
          .sendSystemNotificationToAdmin(
            adminEmail,
            `⚠️ Manual Withdrawal Required - ${reference}`,
            {
              reference,
              userId,
              amount,
              chargeAmount,
              stampDutyAmount,
              totalDeduction,
              accountNumber: bankAccount.accountNumber,
              accountName: bankAccount.accountName,
              bankName: bank.name,
              provider,
              providerError,
              timestamp: new Date().toISOString(),
              action: "MANUAL_WITHDRAWAL_REQUIRED",
            },
            `Automated withdrawal failed for ${reference}. Manual processing required.`,
          )
          .catch((err: any) =>
            logger.error(
              `Failed to notify admin for manual withdrawal: ${reference}`,
              err.message,
            ),
          );

        // Notify user — reassure them without revealing internal failure details
        this.notificationService
          .createNotification({
            type: "transaction_processing",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(userId),
            title: "Withdrawal Being Processed",
            message: `Your withdrawal of ₦${amount.toLocaleString()} to ${bankAccount.accountNumber
              } (${bank.name
              }) is being processed. This may take a little longer than usual. Reference: ${reference}`,
            data: {
              amount,
              reference,
              accountNumber: bankAccount.accountNumber,
              bankName: bank.name,
              status: "pending",
              transactionType: TRANSACTION_TYPES.WITHDRAWAL,
            },
            sendEmail: true,
            sendPush: false,
          })
          .catch((err: any) =>
            logger.error(
              `Failed to send manual withdrawal pending notification: ${reference}`,
              err.message,
            ),
          );

        logger.info(
          `Manual withdrawal fallback created: ${reference} | Amount: ₦${amount} | User: ${userId}`,
        );
      },
      data.userId,
    ) as any;
  }

  // withdrawFunds

  async withdrawFunds(data: {
    userId: string;
    amount: number;
    bankAccountId: string;
    provider?: "flutterwave" | "saveHaven" | "monnify" | "xixapay";
    channel?: "ios" | "android" | "web" | "api";
  }) {
    return SentryHelper.trackCriticalOperation(
      "withdrawal_processing",
      async () => {
        const reference = generateReference("WTH");
        const idempotencyKey = reference;

        const existingTransaction = await Transaction.findOne({
          idempotencyKey,
          userId: new Types.ObjectId(data.userId),
          status: {
            $in: [
              TRANSACTION_STATUS.PENDING,
              TRANSACTION_STATUS.PROCESSING,
              TRANSACTION_STATUS.SUCCESS,
            ],
          },
        });

        if (existingTransaction) {
          logger.warn(`Duplicate withdrawal detected: ${idempotencyKey}`);
          return existingTransaction.toObject();
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        let transaction: any;
        let stampDutyTransaction: any = null;
        let wallet: any;
        let bankAccount: any;
        let bank: any;
        let balanceBefore: number;
        let balanceAfter: number;
        let bankCode: string | undefined;
        let user: any;
        let chargeCalculation: {
          chargeAmount: number;
          totalAmount: number;
          baseAmount: number;
          serviceCharge: any;
          isCapped: boolean;
        };
        let stampDutyAmount = 0;
        let phase1SessionEnded = false;
        try {
          // PHASE 1: VALIDATION & FUND RESERVATION

          [user, bankAccount, wallet] = await Promise.all([
            this.userRepository.findById(data.userId),
            this.bankAccountRepository.findById(data.bankAccountId),
            this.walletRepository.findByUserId(data.userId),
          ]);

          if (!user) {
            throw new AppError(
              getErrorMessage(
                `User not found: ${data.userId}`,
                "User not found",
              ),
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          if (!bankAccount || bankAccount.userId.toString() !== data.userId) {
            throw new AppError(
              getErrorMessage(
                `Invalid bank account: ${data.bankAccountId} for user: ${data.userId}`,
                "Invalid bank account",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }

          if (!wallet) {
            throw new AppError(
              getErrorMessage(
                `Wallet not found for user: ${data.userId}`,
                "Wallet not found",
              ),
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.RESOURCE_NOT_FOUND,
            );
          }

          chargeCalculation =
            await this.helperService.calculateAmountWithCharge(
              data.amount,
              TRANSACTION_TYPES.WITHDRAWAL,
            );

          const stampDutyResult = await this.helperService.calculateStampDuty(
            data.amount,
          );
          stampDutyAmount = stampDutyResult.stampDutyAmount;

          // TODO: Fetch max withdrawal threshold from admin config (e.g. SystemConfig or a Settings model)
          // const maxWithdrawalThreshold = await this.systemConfigService.getWithdrawalThreshold();
          // if (data.amount > maxWithdrawalThreshold) {
          //   throw new AppError(
          //     `Withdrawal amount exceeds the maximum limit of ₦${maxWithdrawalThreshold.toLocaleString()}`,
          //     HTTP_STATUS.BAD_REQUEST,
          //     ERROR_CODES.VALIDATION_ERROR
          //   );
          // }

          const totalDeduction =
            data.amount +
            Number(chargeCalculation.chargeAmount) +
            Number(stampDutyAmount);
          balanceBefore = wallet.balance;

          bank = await this.bankRepository.findBySavehavenCode(
            bankAccount.bankCode,
          );
          if (!bank) {
            throw new AppError(
              getErrorMessage(
                `Bank not found for code: ${bankAccount.bankCode}`,
                "Bank information unavailable",
              ),
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.RESOURCE_NOT_FOUND,
            );
          }

          balanceAfter = Number(balanceBefore) - Number(totalDeduction);
          const provider = data.provider || "saveHaven";

          if (provider === "saveHaven") {
            bankCode = bank.savehavenCode;
          } else if (provider === "monnify") {
            bankCode = bank.monnifyCode;
          } else if (provider === "flutterwave") {
            bankCode = bank.flutterwaveCode;
          } else if (provider === "xixapay") {
            bankCode = bank.savehavenCode; // Xixapay payout bank-code format matches SaveHaven's
          } else {
            bankCode = bank.savehavenCode;
          }

          if (!bankCode) {
            throw new AppError(
              getErrorMessage(
                `Bank "${bank.name}" has no ${provider} code configured`,
                `Bank is not configured for this provider`,
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }
          const transactionMeta: any = {
            accountNumber: bankAccount.accountNumber,
            accountName: bankAccount.accountName,
            bankName: bank.name,
            bankCode,
            phase: "phase1_reserved",
            reservedAt: new Date().toISOString(),
          };

          transactionMeta.chargeInfo = {
            baseAmount: data.amount,
            serviceCharge: chargeCalculation.chargeAmount,
            chargeType: chargeCalculation.serviceCharge?.type,
            chargeValue: chargeCalculation.serviceCharge?.value,
            totalDeduction,
            isServiceChargeCapped: chargeCalculation.isCapped,
            stampDutyAmount,
            isStampDutyCapped: stampDutyResult.isCapped,
          };

          const mainTxnBalanceAfter =
            Number(balanceBefore) -
            (Number(data.amount) + Number(chargeCalculation.chargeAmount));

          transaction = await Transaction.create(
            [
              {
                walletId: wallet._id,
                sourceId: new Types.ObjectId(data.userId),
                userId: new Types.ObjectId(data.userId),
                reference,
                idempotencyKey,
                amount: data.amount,
                direction: "DEBIT",
                type: TRANSACTION_TYPES.WITHDRAWAL,
                provider: provider,
                remark: `Withdrawal to ${bankAccount.accountNumber} (${bank.name})`,
                status: TRANSACTION_STATUS.PENDING,
                purpose: "withdrawal",
                channel: data.channel || "web",
                balanceBefore,
                balanceAfter: mainTxnBalanceAfter,
                initiatedBy: new Types.ObjectId(data.userId),
                initiatedByType: "user",
                meta: transactionMeta,
              },
            ],
            { session },
          );

          if (stampDutyAmount > 0) {
            stampDutyTransaction = await Transaction.create(
              [
                {
                  walletId: wallet._id,
                  sourceId: new Types.ObjectId(data.userId),
                  userId: new Types.ObjectId(data.userId),
                  reference: `${reference}-STAMPDUTY`,
                  idempotencyKey: `${idempotencyKey}_stamp_duty`,
                  amount: stampDutyAmount,
                  direction: "DEBIT",
                  type: TRANSACTION_TYPES.STAMP_DUTY,
                  provider: provider,
                  remark: `EMTL stamp duty on withdrawal (Ref: ${reference})`,
                  status: TRANSACTION_STATUS.PENDING,
                  purpose: "withdrawal_stamp_duty",
                  channel: data.channel || "web",
                  balanceBefore: mainTxnBalanceAfter,
                  balanceAfter,
                  initiatedBy: new Types.ObjectId(data.userId),
                  initiatedByType: "user",
                  linkedTransactionId: transaction[0]._id as Types.ObjectId,
                  meta: {
                    phase: "phase1_reserved",
                    reservedAt: new Date().toISOString(),
                    parentReference: reference,
                  },
                },
              ],
              { session },
            );
          }

          const walletUpdate = await Wallet.findOneAndUpdate(
            { _id: wallet._id, balance: { $gte: totalDeduction } },
            { $inc: { balance: -totalDeduction } },
            { session, new: true },
          );

          if (!walletUpdate) {
            throw new AppError(
              getErrorMessage(
                `Insufficient balance: ₦${balanceBefore} < ₦${totalDeduction}`,
                "Insufficient balance",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.INSUFFICIENT_BALANCE,
            );
          }

          await session.commitTransaction();

          try {
            await cacheService.delete(CACHE_KEYS.USER_WALLET(data.userId.toString()));
          } catch (cacheErr) {
            logger.error("Withdrawal: failed to invalidate wallet cache:", cacheErr);
          }

          SocketService.emitToUser(data.userId.toString(), "wallet_debit", {
            balance: Math.trunc(walletUpdate.balance * 100) / 100,
            bonusBalance: Math.trunc(walletUpdate.bonusBalance * 100) / 100,
            commissionBalance: Math.trunc(walletUpdate.commissionBalance * 100) / 100,
            amount: totalDeduction,
            direction: "DEBIT",
            type: "withdrawal",
            reference,
            reason: "Withdrawal",
            timestamp: new Date().toISOString(),
          });
        } catch (phase1Error: any) {
          if (session.inTransaction()) await session.abortTransaction();
          await session.endSession();
          phase1SessionEnded = true;
          throw phase1Error;
        } finally {
          if (!phase1SessionEnded) {
            session.endSession();
          }
        }

        // PHASE 2: PROVIDER CALL (OUTSIDE SESSION)

        try {
          let providerResult: any;
          const provider = data.provider;

          switch (provider) {
            case "saveHaven":
              providerResult = await this.saveHavenService.initiateTransfer({
                amount: data.amount,
                account_number: bankAccount.accountNumber,
                bank_code: bankCode!,
                narration: `Withdrawal - ${reference}`,
                reference,
              });
              break;

            case "monnify":
              providerResult = await this.monnifyService.initiateTransfer({
                amount: data.amount,
                destinationBankCode: bankCode!,
                destinationAccountNumber: bankAccount.accountNumber,
                narration: `Withdrawal - ${reference}`,
                reference,
                currency: "NGN",
                async: false,
              });
              break;

            case "flutterwave":
              providerResult = await this.flutterwaveService.initiateTransfer({
                accountBank: bankCode!,
                accountNumber: bankAccount.accountNumber,
                amount: data.amount,
                narration: `Withdrawal - ${reference}`,
                reference,
                currency: "NGN",
                beneficiaryName: bankAccount.accountName,
                callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/flutterwave/transfer`,
              });
              break;

            case "xixapay":
              // Per Xixapay's documented Recommended Payout Flow:
              // 1. Fetch supported banks (skipped here — bankCode already resolved
              //    from the Bank model in Phase 1, same as other providers)
              // 2. Verify bank account
              await this.xixapayService.verifyBankAccount({
                bank: bankCode!,
                accountNumber: bankAccount.accountNumber,
              });
              // 3. Deduct user balance — already done in Phase 1 (lock row)
              // 4. Initiate payout — synchronous response, treated as authoritative
              //    (no documented async payout webhook exists for Xixapay)
              providerResult = await this.xixapayService.initiatePayout({
                amount: data.amount,
                bank: bankCode!,
                accountNumber: bankAccount.accountNumber,
                narration: `Withdrawal - ${reference}`,
              });
              break;

            default:
              // No recognised automated provider (middleware found none configured).
              // Throw a plain Error so Phase 2b catches it and routes to manual fallback.
              throw new Error(
                `No automated provider configured for withdrawal (received: ${provider}). Routing to manual fallback.`,
              );
          }

          // PHASE 2a: PROVIDER ACCEPTED
          const providerReference =
            providerResult.reference ||
            providerResult.transactionReference ||
            providerResult.id?.toString();

          const settledInstantly = this.isSaveHavenSyncCompleted(provider, providerResult) || (provider === "xixapay" && providerResult?.status === "success");
          const initialStatus = settledInstantly
            ? TRANSACTION_STATUS.SUCCESS
            : TRANSACTION_STATUS.PROCESSING;

          // SaveHaven Outwards transfers settle synchronously with no payout
          // webhook to follow up later, so profit has to be booked right here
          // for the instant-completion case. Mirrors the formula
          // PaymentReconciliationService.markAsSuccess() already uses for
          // SaveHaven withdrawals that settle asynchronously: our service
          // charge minus whatever SafeHaven itself deducted for the transfer
          // (fees + vat + stampDuty, all present on the sync response).
          const saveHavenProfit = settledInstantly
            ? (transaction[0].meta?.chargeInfo?.serviceCharge || 0) -
            ((providerResult.fees || 0) +
              (providerResult.vat || 0) +
              (providerResult.stampDuty || 0))
            : undefined;

          await this.transactionRepository.update(
            transaction[0]._id.toString(),
            {
              status: initialStatus,
              providerReference,
              ...(saveHavenProfit !== undefined && { profit: saveHavenProfit }),
              meta: {
                ...transaction[0].meta,
                phase: settledInstantly
                  ? "phase2_provider_success_sync"
                  : "phase2_provider_success",
                transferId: providerReference,
                providerStatus: providerResult.status,
                providerResponse: providerResult,
                ...(saveHavenProfit !== undefined && {
                  providerFees: providerResult.fees,
                  providerVat: providerResult.vat,
                  providerStampDuty: providerResult.stampDuty,
                }),
                processedAt: new Date().toISOString(),
              },
            },
          );

          if (stampDutyTransaction?.[0]) {
            await this.transactionRepository.update(
              stampDutyTransaction[0]._id.toString(),
              {
                status: initialStatus,
                meta: {
                  ...stampDutyTransaction[0].meta,
                  phase: settledInstantly
                    ? "phase2_provider_success_sync"
                    : "phase2_provider_success",
                  processedAt: new Date().toISOString(),
                },
              },
            );
          }

          const notificationMessage =
            chargeCalculation.chargeAmount > 0
              ? `Your withdrawal of ₦${data.amount.toLocaleString()} to ${bankAccount.accountNumber
              } (${bank.name}) ${settledInstantly ? "was successful" : "is being processed"}. Service charge: ₦${chargeCalculation.chargeAmount.toLocaleString()}. Reference: ${reference}`
              : `Your withdrawal of ₦${data.amount.toLocaleString()} to ${bankAccount.accountNumber
              } (${bank.name}) ${settledInstantly ? "was successful" : "is being processed"}. Reference: ${reference}`;

          const notificationData: any = {
            amount: data.amount,
            balance: balanceAfter,
            reference,
            accountNumber: bankAccount.accountNumber,
            bankName: bank.name,
            status: settledInstantly ? "success" : "processing",
          };

          if (chargeCalculation.chargeAmount > 0) {
            notificationData.serviceCharge = chargeCalculation.chargeAmount;
            notificationData.totalDeducted =
              data.amount + chargeCalculation.chargeAmount;
          }

          this.notificationService
            .createNotification({
              type: "withdrawal_initiated",
              notifiableType: "User",
              notifiableId: new Types.ObjectId(data.userId),
              title: "Withdrawal Initiated",
              message: notificationMessage,
              data: notificationData,
              sendEmail: true,
              sendPush: true,
            })
            .catch((err: any) => {
              logger.error(
                `Failed to send withdrawal notification: ${reference}`,
                err.message,
              );
            });

          const returnData: any = {
            ...transaction[0].toObject(),
            status: initialStatus,
          };

          if (chargeCalculation.chargeAmount > 0) {
            returnData.serviceCharge = chargeCalculation.chargeAmount;
            returnData.totalDeducted =
              data.amount + chargeCalculation.chargeAmount;
          }

          return returnData;
        } catch (providerError: any) {
          // PHASE 2b: PROVIDER FAILED
          logger.error(
            `Withdrawal provider failed: ${reference} - ${providerError.message}`,
          );

          const totalDeduction =
            data.amount + chargeCalculation.chargeAmount + stampDutyAmount;
          const isManualActive = await this.isManualWithdrawalActive();

          if (isManualActive) {
            //  MANUAL FALLBACK: Keep funds, queue for admin
            try {
              await this.handleManualWithdrawalFallback({
                transaction: transaction[0],
                stampDutyTransaction: stampDutyTransaction?.[0] ?? null,
                userId: data.userId,
                amount: data.amount,
                chargeAmount: chargeCalculation.chargeAmount,
                stampDutyAmount,
                totalDeduction,
                bankAccount,
                bank,
                bankCode: bankCode!,
                provider: data.provider || "saveHaven",
                reference,
                providerError: providerError.message,
              });

              const returnData: any = {
                ...transaction[0].toObject(),
                status: TRANSACTION_STATUS.PENDING,
                message:
                  "Your withdrawal is being processed manually. You will be notified once it is completed.",
              };

              if (chargeCalculation.chargeAmount > 0) {
                returnData.serviceCharge = chargeCalculation.chargeAmount;
                returnData.totalDeducted = totalDeduction;
              }

              return returnData;
            } catch (manualFallbackError: any) {
              logger.error(
                `CRITICAL: Manual fallback also failed for ${reference}: ${manualFallbackError.message}`,
              );
              // If manual fallback itself fails, fall through to the reversal below
            }
          }

          //  STANDARD REVERSAL: Refund user immediately
          try {
            await Transaction.findOneAndUpdate(
              {
                _id: transaction[0]._id,
                status: { $in: ["pending", "processing"] },
              },
              {
                $set: {
                  status: TRANSACTION_STATUS.FAILED,
                  meta: {
                    ...transaction[0].meta,
                    phase: "phase2_provider_failed",
                    error: providerError.message,
                    failedAt: new Date().toISOString(),
                  },
                },
              },
            );

            if (stampDutyTransaction?.[0]) {
              await Transaction.findOneAndUpdate(
                {
                  _id: stampDutyTransaction[0]._id,
                  status: { $in: ["pending", "processing"] },
                },
                {
                  $set: {
                    status: TRANSACTION_STATUS.FAILED,
                    meta: {
                      ...stampDutyTransaction[0].meta,
                      phase: "phase2_provider_failed",
                      error: providerError.message,
                      failedAt: new Date().toISOString(),
                    },
                  },
                },
              );
            }

            const mainRefundAmount =
              data.amount + chargeCalculation.chargeAmount;

            await this.walletService.creditWallet(
              data.userId,
              mainRefundAmount,
              "Withdrawal refund",
              {
                type: "refund",
                provider: data.provider || "system",
                idempotencyKey: `${reference}_refund`,
                initiatedByType: "system",
                linkedTransactionId: transaction[0]._id as Types.ObjectId,
                remark: `Refund: ₦${mainRefundAmount} for failed withdrawal (Ref: ${reference})`,
                meta: {
                  originalReference: reference,
                  reason: "withdrawal_failed",
                  accountNumber: bankAccount.accountNumber,
                  accountName: bankAccount.accountName,
                  bankName: bank.name,
                },
              },
            );

            if (stampDutyTransaction?.[0] && stampDutyAmount > 0) {
              await this.walletService.creditWallet(
                data.userId,
                stampDutyAmount,
                "Stamp duty refund",
                {
                  type: "refund",
                  provider: data.provider || "system",
                  idempotencyKey: `${reference}_stamp_duty_refund`,
                  initiatedByType: "system",
                  linkedTransactionId: stampDutyTransaction[0]
                    ._id as Types.ObjectId,
                  remark: `Refund: ₦${stampDutyAmount} stamp duty for failed withdrawal (Ref: ${reference})`,
                  meta: {
                    originalReference: reference,
                    reason: "withdrawal_failed",
                    accountNumber: bankAccount.accountNumber,
                    accountName: bankAccount.accountName,
                    bankName: bank.name,
                  },
                },
              );
            }



            logger.info(
              `Withdrawal reversed: ${reference} | Amount: ₦${totalDeduction}`,
            );
            try {
              recordTransactionFailure(
                data.userId,
                TRANSACTION_TYPES.WITHDRAWAL,
              );
            } catch (trackingError: any) {
              // Redis may be down — fraud tracking is blind, alert immediately
              logger.error(
                "CRITICAL: recordTransactionFailure failed — fraud tracking disabled",
                { userId: data.userId, error: trackingError.message },
              );
            }
            const chargeParts: string[] = [];
            if (chargeCalculation.chargeAmount > 0) {
              chargeParts.push(
                `₦${chargeCalculation.chargeAmount.toLocaleString()} service charge`,
              );
            }
            if (stampDutyAmount > 0) {
              chargeParts.push(
                `₦${stampDutyAmount.toLocaleString()} stamp duty`,
              );
            }

            const failureMessage =
              chargeParts.length > 0
                ? `Your withdrawal of ₦${data.amount.toLocaleString()} failed. ₦${totalDeduction.toLocaleString()} (including ${chargeParts.join(" and ")}) has been refunded to your wallet. Reference: ${reference}`
                : `Your withdrawal of ₦${data.amount.toLocaleString()} failed. The amount has been refunded to your wallet. Reference: ${reference}`;

            const failureData: any = {
              amount: data.amount,
              reference,
              accountNumber: bankAccount.accountNumber,
              bankName: bank.name,
            };

            if (chargeCalculation.chargeAmount > 0) {
              failureData.serviceCharge = chargeCalculation.chargeAmount;
            }
            if (stampDutyAmount > 0) {
              failureData.stampDuty = stampDutyAmount;
            }
            if (chargeParts.length > 0) {
              failureData.totalRefunded = totalDeduction;
            }

            this.notificationService
              .createNotification({
                type: "withdrawal_failed",
                notifiableType: "User",
                notifiableId: new Types.ObjectId(data.userId),
                title: "Withdrawal Failed & Refunded",
                message: failureMessage,
                data: failureData,
                sendEmail: true,
                sendPush: true,
              })
              .catch((err: any) => {
                logger.error(
                  `Failed to send withdrawal failure notification: ${reference}`,
                  err.message,
                );
              });

            throw new AppError(
              getErrorMessage(
                `Withdrawal failed: ${providerError.message}`,
                "Payment processing failed",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.THIRD_PARTY_ERROR,
            );
          } catch (reversalError: any) {

            SentryHelper.captureBusinessError(
              "WITHDRAWAL_REVERSAL_FAILED_CRITICAL",
              `Critical: Withdrawal reversal failed - funds may be stuck`,
              data.userId,
              {
                reference,
                originalError: providerError.message,
                reversalError: reversalError.message,
              },
            );
            logger.error(
              `CRITICAL: Failed to reverse withdrawal ${reference}`,
              {
                reversalError: reversalError.message,
                originalProviderError: providerError.message,
              },
            );

            await this.alertAdminForStuckFunds({
              reference,
              userId: data.userId,
              amount: data.amount,
              chargeAmount: chargeCalculation.chargeAmount,
              stampDutyAmount,
              totalDeduction,
              type: "withdrawal",
              accountDetails: {
                accountNumber: bankAccount.accountNumber,
                accountName: bankAccount.accountName,
                bankName: bank.name,
              },
              error: `Provider error: ${providerError.message} | Reversal error: ${reversalError.message}`,
            });

            const combinedError = new Error(
              `Withdrawal failed (${providerError.message}) and reversal also failed (${reversalError.message}). Funds may be stuck. Reference: ${reference}`,
            );
            (combinedError as any).originalProviderError = providerError;
            (combinedError as any).reversalError = reversalError;
            (combinedError as any).reference = reference;

            throw combinedError;
          } finally {

          }
        }
      },
      data.userId,
    );
  }

  // bankTransfer

  async bankTransfer(data: {
    userId: string;
    amount: number;
    accountNumber: string;
    accountName: string;
    bankCode: string;
    provider?: "flutterwave" | "saveHaven" | "monnify" | "xixapay";
    channel?: "ios" | "android" | "web" | "api";
  }) {
    const reference = generateReference("BTR");
    const idempotencyKey = reference;

    const existingTransaction = await Transaction.findOne({
      idempotencyKey,
      userId: new Types.ObjectId(data.userId),
      status: {
        $in: [
          TRANSACTION_STATUS.PENDING,
          TRANSACTION_STATUS.PROCESSING,
          TRANSACTION_STATUS.SUCCESS,
        ],
      },
    });

    if (existingTransaction) {
      logger.warn(`Duplicate bank transfer detected: ${idempotencyKey}`);
      return existingTransaction.toObject();
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    let transaction: any;
    let stampDutyTransaction: any = null;
    let wallet: any;
    let bank: any;
    let balanceBefore: number;
    let balanceAfter: number;
    let bankCode: string | undefined;
    let user: any;
    let chargeCalculation: {
      chargeAmount: number;
      totalAmount: number;
      baseAmount: number;
      serviceCharge: any;
      isCapped: boolean;
    };
    let stampDutyAmount = 0;
    let phase1SessionEnded = false;
    try {
      // PHASE 1: VALIDATION & FUND RESERVATION

      [user, wallet, bank] = await Promise.all([
        this.userRepository.findById(data.userId),
        this.walletRepository.findByUserId(data.userId),
        this.bankRepository.findBySavehavenCode(data.bankCode),
      ]);

      if (!user) {
        throw new AppError(
          getErrorMessage(`User not found: ${data.userId}`, "User not found"),
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (!wallet) {
        throw new AppError(
          getErrorMessage(
            `Wallet not found for user: ${data.userId}`,
            "Wallet not found",
          ),
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (!bank) {
        throw new AppError(
          getErrorMessage(
            `Bank not found for code: ${data.bankCode}`,
            "Bank information unavailable",
          ),
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      chargeCalculation = await this.helperService.calculateAmountWithCharge(
        data.amount,
        TRANSACTION_TYPES.WITHDRAWAL,
      );

      const stampDutyResult = await this.helperService.calculateStampDuty(
        data.amount,
      );
      stampDutyAmount = stampDutyResult.stampDutyAmount;

      // TODO: Fetch max withdrawal threshold from admin config (e.g. SystemConfig or a Settings model)
      // const maxWithdrawalThreshold = await this.systemConfigService.getWithdrawalThreshold();
      // if (data.amount > maxWithdrawalThreshold) {
      //   throw new AppError(
      //     `Transfer amount exceeds the maximum limit of ₦${maxWithdrawalThreshold.toLocaleString()}`,
      //     HTTP_STATUS.BAD_REQUEST,
      //     ERROR_CODES.VALIDATION_ERROR
      //   );
      // }

      const totalDeduction =
        data.amount +
        Number(chargeCalculation.chargeAmount) +
        Number(stampDutyAmount);
      balanceBefore = wallet.balance;

      balanceAfter = Number(balanceBefore) - Number(totalDeduction);
      const provider = data.provider || "saveHaven";

      if (provider === "saveHaven") {
        bankCode = bank.savehavenCode;
      } else if (provider === "monnify") {
        bankCode = bank.monnifyCode;
      } else if (provider === "flutterwave") {
        bankCode = bank.flutterwaveCode;
      } else if (provider === "xixapay") {
        bankCode = bank.savehavenCode; // Xixapay payout bank-code format matches SaveHaven's
      } else {
        bankCode = bank.savehavenCode; // safe fallback to canonical code
      }

      if (!bankCode) {
        throw new AppError(
          getErrorMessage(
            `Bank "${bank.name}" has no ${provider} code configured`,
            `Bank is not configured for this provider`,
          ),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const transactionMeta: any = {
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        bankName: bank.name,
        bankCode,
        phase: "phase1_reserved",
        reservedAt: new Date().toISOString(),
      };

      transactionMeta.chargeInfo = {
        baseAmount: data.amount,
        serviceCharge: chargeCalculation.chargeAmount,
        chargeType: chargeCalculation.serviceCharge?.type,
        chargeValue: chargeCalculation.serviceCharge?.value,
        totalDeduction,
        isServiceChargeCapped: chargeCalculation.isCapped,
        stampDutyAmount,
        isStampDutyCapped: stampDutyResult.isCapped,
      };

      const mainTxnBalanceAfter =
        Number(balanceBefore) -
        (Number(data.amount) + Number(chargeCalculation.chargeAmount));

      transaction = await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: new Types.ObjectId(data.userId),
            userId: new Types.ObjectId(data.userId),
            reference,
            idempotencyKey,
            amount: data.amount,
            direction: "DEBIT",
            channel: data.channel || "web",
            type: TRANSACTION_TYPES.WITHDRAWAL,
            provider,
            remark: `Bank transfer to ${data.accountNumber} - ${data.accountName} (${bank.name})`,
            status: TRANSACTION_STATUS.PENDING,
            purpose: "withdrawal",
            balanceBefore,
            balanceAfter: mainTxnBalanceAfter,
            initiatedBy: new Types.ObjectId(data.userId),
            initiatedByType: "user",
            meta: transactionMeta,
          },
        ],
        { session },
      );

      if (stampDutyAmount > 0) {
        stampDutyTransaction = await Transaction.create(
          [
            {
              walletId: wallet._id,
              sourceId: new Types.ObjectId(data.userId),
              userId: new Types.ObjectId(data.userId),
              reference: `${reference}-STAMPDUTY`,
              idempotencyKey: `${idempotencyKey}_stamp_duty`,
              amount: stampDutyAmount,
              direction: "DEBIT",
              type: TRANSACTION_TYPES.STAMP_DUTY,
              provider,
              remark: `EMTL stamp duty on bank transfer (Ref: ${reference})`,
              status: TRANSACTION_STATUS.PENDING,
              purpose: "withdrawal_stamp_duty",
              channel: data.channel || "web",
              balanceBefore: mainTxnBalanceAfter,
              balanceAfter,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "user",
              linkedTransactionId: transaction[0]._id as Types.ObjectId,
              meta: {
                phase: "phase1_reserved",
                reservedAt: new Date().toISOString(),
                parentReference: reference,
              },
            },
          ],
          { session },
        );
      }

      const walletUpdate = await Wallet.findOneAndUpdate(
        { _id: wallet._id, balance: { $gte: totalDeduction } },
        { $inc: { balance: -totalDeduction } },
        { session, new: true },
      );

      if (!walletUpdate) {
        throw new AppError(
          getErrorMessage(
            `Insufficient balance: ₦${balanceBefore} < ₦${totalDeduction}`,
            "Insufficient balance",
          ),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      await session.commitTransaction();

      try {
        await cacheService.delete(CACHE_KEYS.USER_WALLET(data.userId.toString()));
      } catch (cacheErr) {
        logger.error("Withdrawal: failed to invalidate wallet cache:", cacheErr);
      }

      SocketService.emitToUser(data.userId.toString(), "wallet_debit", {
        balance: Math.trunc(walletUpdate.balance * 100) / 100,
        bonusBalance: Math.trunc(walletUpdate.bonusBalance * 100) / 100,
        commissionBalance: Math.trunc(walletUpdate.commissionBalance * 100) / 100,
        amount: totalDeduction,
        direction: "DEBIT",
        type: "withdrawal",
        reference,
        reason: "Withdrawal",
        timestamp: new Date().toISOString(),
      });
    } catch (phase1Error: any) {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
      phase1SessionEnded = true;
      throw phase1Error;
    } finally {
      if (!phase1SessionEnded) {
        session.endSession();
      }
    }

    // PHASE 2: PROVIDER CALL (OUTSIDE SESSION)

    try {
      let providerResult: any;
      const provider = data.provider;

      switch (provider) {
        case "saveHaven":
          providerResult = await this.saveHavenService.initiateTransfer({
            amount: data.amount,
            account_number: data.accountNumber,
            bank_code: bankCode!,
            narration: `Bank transfer - ${reference}`,
            reference,
          });
          break;

        case "monnify":
          providerResult = await this.monnifyService.initiateTransfer({
            amount: data.amount,
            destinationBankCode: bankCode!,
            destinationAccountNumber: data.accountNumber,
            narration: `Bank transfer - ${reference}`,
            reference,
            currency: "NGN",
            async: false,
          });
          break;

        case "flutterwave":
          providerResult = await this.flutterwaveService.initiateTransfer({
            accountBank: bankCode!,
            accountNumber: data.accountNumber,
            amount: data.amount,
            narration: `Bank transfer - ${reference}`,
            reference,
            currency: "NGN",
            beneficiaryName: data.accountName,
            callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/flutterwave/transfer`,
          });
          break;

        case "xixapay":
          await this.xixapayService.verifyBankAccount({
            bank: bankCode!,
            accountNumber: data.accountNumber,
          });
          providerResult = await this.xixapayService.initiatePayout({
            amount: data.amount,
            bank: bankCode!,
            accountNumber: data.accountNumber,
            narration: `Bank transfer - ${reference}`,
          });
          break;

        default:
          // No recognised automated provider (middleware found none configured).
          // Throw a plain Error so Phase 2b catches it and routes to manual fallback.
          throw new Error(
            `No automated provider configured for bank transfer (received: ${provider}). Routing to manual fallback.`,
          );
      }

      // PHASE 2a: PROVIDER ACCEPTED
      const providerReference =
        providerResult.paymentReference ||
        providerResult.reference ||
        providerResult.transactionReference ||
        providerResult.id?.toString();

      const settledInstantly = this.isSaveHavenSyncCompleted(provider, providerResult) || (provider === "xixapay" && providerResult?.status === "success");
      const initialStatus = settledInstantly
        ? TRANSACTION_STATUS.SUCCESS
        : TRANSACTION_STATUS.PROCESSING;

      // SaveHaven Outwards transfers settle synchronously with no payout
      // webhook to follow up later, so profit has to be booked right here
      // for the instant-completion case. Mirrors the formula
      // PaymentReconciliationService.markAsSuccess() already uses for
      // SaveHaven withdrawals that settle asynchronously: our service
      // charge minus whatever SafeHaven itself deducted for the transfer
      // (fees + vat + stampDuty, all present on the sync response).
      const saveHavenProfit = settledInstantly
        ? (transaction[0].meta?.chargeInfo?.serviceCharge || 0) -
        ((providerResult.fees || 0) +
          (providerResult.vat || 0) +
          (providerResult.stampDuty || 0))
        : undefined;

      await this.transactionRepository.update(transaction[0]._id.toString(), {
        status: initialStatus,
        providerReference,
        ...(saveHavenProfit !== undefined && { profit: saveHavenProfit }),
        meta: {
          ...transaction[0].meta,
          phase: settledInstantly
            ? "phase2_provider_success_sync"
            : "phase2_provider_success",
          transferId: providerReference,
          providerStatus: providerResult.status,
          providerResponse: providerResult,
          ...(saveHavenProfit !== undefined && {
            providerFees: providerResult.fees,
            providerVat: providerResult.vat,
            providerStampDuty: providerResult.stampDuty,
          }),
          processedAt: new Date().toISOString(),
        },
      });

      if (stampDutyTransaction?.[0]) {
        await this.transactionRepository.update(
          stampDutyTransaction[0]._id.toString(),
          {
            status: initialStatus,
            meta: {
              ...stampDutyTransaction[0].meta,
              phase: settledInstantly
                ? "phase2_provider_success_sync"
                : "phase2_provider_success",
              processedAt: new Date().toISOString(),
            },
          },
        );
      }

      const notificationMessage =
        chargeCalculation.chargeAmount > 0
          ? `Your bank transfer of ₦${data.amount.toLocaleString()} to ${data.accountNumber} (${data.accountName} - ${bank.name}) is being processed. Service charge: ₦${chargeCalculation.chargeAmount.toLocaleString()}. Reference: ${reference}`
          : `Your bank transfer of ₦${data.amount.toLocaleString()} to ${data.accountNumber} (${data.accountName} - ${bank.name}) is being processed. Reference: ${reference}`;

      const notificationData: any = {
        amount: data.amount,
        balance: balanceAfter,
        reference,
        accountNumber: data.accountNumber,
        accountName: data.accountName,
        bankName: bank.name,
        status: "processing",
      };

      if (chargeCalculation.chargeAmount > 0) {
        notificationData.serviceCharge = chargeCalculation.chargeAmount;
        notificationData.totalDeducted =
          data.amount + chargeCalculation.chargeAmount;
      }

      this.notificationService
        .createNotification({
          type: "withdrawal_initiated",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(data.userId),
          title: "Bank Transfer Initiated",
          message: notificationMessage,
          data: notificationData,
          sendEmail: true,
          sendPush: true,
        })
        .catch((err: any) => {
          logger.error(
            `Failed to send bank transfer notification: ${reference}`,
            err.message,
          );
        });

      logger.info(
        `Bank transfer initiated: ${reference} | Amount: ₦${data.amount}${chargeCalculation.chargeAmount > 0
          ? ` | Charge: ₦${chargeCalculation.chargeAmount}`
          : ""
        }`,
      );

      const returnData: any = {
        ...transaction[0].toObject(),
        status: initialStatus,
      };

      if (chargeCalculation.chargeAmount > 0) {
        returnData.serviceCharge = chargeCalculation.chargeAmount;
        returnData.totalDeducted = data.amount + chargeCalculation.chargeAmount;
      }

      return returnData;
    } catch (providerError: any) {
      // PHASE 2b: PROVIDER FAILED
      logger.error(
        `Bank transfer provider failed: ${reference} - ${providerError.message}`,
      );

      const totalDeduction =
        data.amount + chargeCalculation.chargeAmount + stampDutyAmount;
      const isManualActive = await this.isManualWithdrawalActive();

      if (isManualActive) {
        //  MANUAL FALLBACK─
        try {
          // Build a bankAccount-compatible shape from the ad-hoc data
          const adhocBankAccount = {
            accountNumber: data.accountNumber,
            accountName: data.accountName,
          };

          await this.handleManualWithdrawalFallback({
            transaction: transaction[0],
            stampDutyTransaction: stampDutyTransaction?.[0] ?? null,
            userId: data.userId,
            amount: data.amount,
            chargeAmount: chargeCalculation.chargeAmount,
            stampDutyAmount,
            totalDeduction,
            bankAccount: adhocBankAccount,
            bank,
            bankCode: bankCode!,
            provider: data.provider || "saveHaven",
            reference,
            providerError: providerError.message,
          });

          const returnData: any = {
            ...transaction[0].toObject(),
            status: TRANSACTION_STATUS.PENDING,
            message:
              "Your bank transfer is being processed manually. You will be notified once it is completed.",
          };

          if (chargeCalculation.chargeAmount > 0) {
            returnData.serviceCharge = chargeCalculation.chargeAmount;
            returnData.totalDeducted = totalDeduction;
          }

          return returnData;
        } catch (manualFallbackError: any) {
          logger.error(
            `CRITICAL: Manual fallback also failed for ${reference}: ${manualFallbackError.message}`,
          );
          // Fall through to standard reversal
        }
      }

      //  STANDARD REVERSAL

      try {
        await Transaction.findOneAndUpdate(
          {
            _id: transaction[0]._id,
            status: { $in: ["pending", "processing"] },
          },
          {
            $set: {
              status: TRANSACTION_STATUS.FAILED,
              meta: {
                ...transaction[0].meta,
                phase: "phase2_provider_failed",
                error: providerError.message,
                failedAt: new Date().toISOString(),
              },
            },
          },
        );

        if (stampDutyTransaction?.[0]) {
          await Transaction.findOneAndUpdate(
            {
              _id: stampDutyTransaction[0]._id,
              status: { $in: ["pending", "processing"] },
            },
            {
              $set: {
                status: TRANSACTION_STATUS.FAILED,
                meta: {
                  ...stampDutyTransaction[0].meta,
                  phase: "phase2_provider_failed",
                  error: providerError.message,
                  failedAt: new Date().toISOString(),
                },
              },
            },
          );
        }

        const mainRefundAmount = data.amount + chargeCalculation.chargeAmount;

        await this.walletService.creditWallet(
          data.userId,
          mainRefundAmount,
          "Withdrawal refund",
          {
            type: "refund",
            provider: data.provider || "system",
            idempotencyKey: `${reference}_refund`,
            initiatedByType: "system",
            linkedTransactionId: transaction[0]._id as Types.ObjectId,
            remark: `Refund: ₦${mainRefundAmount} for failed withdrawal (Ref: ${reference})`,
            meta: {
              originalReference: reference,
              reason: "withdrawal_failed",
              accountNumber: data.accountNumber,
              accountName: data.accountName,
              bankName: bank.name,
            },
          },
        );

        if (stampDutyTransaction?.[0] && stampDutyAmount > 0) {
          await this.walletService.creditWallet(
            data.userId,
            stampDutyAmount,
            "Stamp duty refund",
            {
              type: "refund",
              provider: data.provider || "system",
              idempotencyKey: `${reference}_stamp_duty_refund`,
              initiatedByType: "system",
              linkedTransactionId: stampDutyTransaction[0]
                ._id as Types.ObjectId,
              remark: `Refund: ₦${stampDutyAmount} stamp duty for failed withdrawal (Ref: ${reference})`,
              meta: {
                originalReference: reference,
                reason: "withdrawal_failed",
                accountNumber: data.accountNumber,
                accountName: data.accountName,
                bankName: bank.name,
              },
            },
          );
        }


        logger.info(
          `Bank transfer reversed: ${reference} | Amount: ₦${totalDeduction}`,
        );
        try {
          recordTransactionFailure(data.userId, TRANSACTION_TYPES.WITHDRAWAL);
        } catch (trackingError: any) {
          // Redis may be down — fraud tracking is blind, alert immediately
          logger.error(
            "CRITICAL: recordTransactionFailure failed — fraud tracking disabled",
            { userId: data.userId, error: trackingError.message },
          );
        }

        const chargeParts: string[] = [];
        if (chargeCalculation.chargeAmount > 0) {
          chargeParts.push(
            `₦${chargeCalculation.chargeAmount.toLocaleString()} service charge`,
          );
        }
        if (stampDutyAmount > 0) {
          chargeParts.push(`₦${stampDutyAmount.toLocaleString()} stamp duty`);
        }

        const failureMessage =
          chargeParts.length > 0
            ? `Your bank transfer of ₦${data.amount.toLocaleString()} to ${data.accountNumber} (${data.accountName} - ${bank.name}) failed. ₦${totalDeduction.toLocaleString()} (including ${chargeParts.join(" and ")}) has been refunded to your wallet. Reference: ${reference}`
            : `Your bank transfer of ₦${data.amount.toLocaleString()} to ${data.accountNumber} (${data.accountName} - ${bank.name}) failed. The amount has been refunded. Reference: ${reference}`;

        const failureData: any = {
          amount: data.amount,
          reference,
          accountNumber: data.accountNumber,
          accountName: data.accountName,
          bankName: bank.name,
          reason: providerError.message,
        };

        if (chargeCalculation.chargeAmount > 0) {
          failureData.serviceCharge = chargeCalculation.chargeAmount;
        }
        if (stampDutyAmount > 0) {
          failureData.stampDuty = stampDutyAmount;
        }
        if (chargeParts.length > 0) {
          failureData.totalRefunded = totalDeduction;
        }

        this.notificationService
          .createNotification({
            type: "withdrawal_failed",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            title: "Bank Transfer Failed & Refunded",
            message: failureMessage,
            data: failureData,
            sendEmail: true,
            sendPush: true,
          })
          .catch((err: any) => {
            logger.error(
              `Failed to send bank transfer failure notification: ${reference}`,
              err.message,
            );
          });
      } catch (reversalError: any) {
        logger.error(`CRITICAL: Failed to reverse bank transfer ${reference}`, {
          reversalError: reversalError.message,
          originalProviderError: providerError.message,
        });

        await this.alertAdminForStuckFunds({
          reference,
          userId: data.userId,
          amount: data.amount,
          chargeAmount: chargeCalculation.chargeAmount,
          stampDutyAmount,
          totalDeduction,
          type: "withdrawal",
          accountDetails: {
            accountNumber: data.accountNumber,
            accountName: data.accountName,
            bankName: bank.name,
          },
          error: `Provider error: ${providerError.message} | Reversal error: ${reversalError.message}`,
        });
        const combinedError = new Error(
          `Bank transfer failed (${providerError.message}) and reversal also failed (${reversalError.message}). Funds may be stuck. Reference: ${reference}`,
        );
        (combinedError as any).originalProviderError = providerError;
        (combinedError as any).reversalError = reversalError;
        (combinedError as any).reference = reference;

        throw combinedError;
      }

      // Throw the provider error after successful reversal
      throw new AppError(
        getErrorMessage(
          `Bank transfer failed: ${providerError.message}`,
          "Bank transfer processing failed",
        ),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Existing unchanged methods
  async getWithdrawalRequests(
    userId: string,
    filters: any = {},
    page: number = 1,
    limit: number = 10,
  ) {
    const query: any = {
      sourceId: new Types.ObjectId(userId),
      type: { $in: ["withdrawal"] },
    };

    if (filters.status) query.status = filters.status;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }

    return this.transactionRepository.findWithFilters(query, page, limit);
  }

  async getWithdrawalRequestById(requestId: string) {
    const transaction = await this.transactionRepository.findById(requestId);
    if (!transaction) {
      throw new AppError(
        getErrorMessage(
          `Transaction not found: ${requestId}`,
          "Transaction not found",
        ),
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (!["withdrawal"].includes(transaction.type)) {
      throw new AppError(
        getErrorMessage(
          `Invalid transaction type: ${transaction.type}`,
          "Invalid transaction type",
        ),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return transaction;
  }

  private async alertAdminForStuckFunds(data: {
    reference: string;
    userId: string;
    amount: number;
    chargeAmount: number;
    stampDutyAmount?: number;
    totalDeduction: number;
    type: "withdrawal";
    accountDetails: {
      accountNumber: string;
      accountName: string;
      bankName: string;
    };
    error: string;
  }): Promise<void> {
    const adminEmail =
      process.env.ADMIN_EMAIL ||
      `admin@${process.env.APP_NAME?.toLowerCase()}.com`;

    const notificationData = {
      reference: data.reference,
      userId: data.userId,
      transactionType: data.type,
      amount: data.amount,
      chargeAmount: data.chargeAmount,
      stampDutyAmount: data.stampDutyAmount ?? 0,
      totalDeduction: data.totalDeduction,
      accountDetails: data.accountDetails,
      errorMessage: data.error,
      severity: "critical",
      timestamp: new Date().toISOString(),
      action: "MANUAL_REVERSAL_REQUIRED",
    };

    const message = `CRITICAL: Funds are STUCK during ${data.type} reversal. Immediate manual intervention required!`;

    try {
      await this.emailService.sendSystemNotificationToAdmin(
        adminEmail,
        `⚠️ CRITICAL: Stuck Funds - ${data.reference}`,
        notificationData,
        message,
      );

      logger.info(
        `CRITICAL ALERT: Stuck Funds - ${data.reference}`,
        notificationData,
      );
    } catch (err: any) {
      logger.error(
        `Failed to alert admin for stuck funds: ${data.reference}`,
        err,
      );
    }
  }
}