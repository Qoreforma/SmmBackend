import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { WalletService } from "./wallet/WalletService";
import { generateReference, getEnviroment } from "@/utils/helpers";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES, CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";
import { User } from "@/models/core/User";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { MonnifyService } from "./providers/payments/MonnifyService";
import { FlutterwaveService } from "./providers/payments/FlutterwaveService";
import { XixapayService } from "./providers/payments/XixapayService";
import { ProviderService } from "./ProviderService";
import { Transaction } from "@/models/wallet/Transaction";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import mongoose, { Types } from "mongoose";
import { Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { HelperService } from "@/services/client/utility/HelperService";

import {
  PaymentInitializationResult,
  PaymentMethodResponse,
  PaymentProvider,
  PaymentMethod,
  BankTransferPaymentResponse,
  CardPaymentResponse,
  MobileMoneyPaymentResponse,
} from "@/types/payment";
import { CacheService } from "../core/CacheService";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { ServiceType } from "@/models/reference/ServiceType";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

export interface InitializePaymentDTO {
  userId: string;
  amount: number;
  method: PaymentMethod;
  provider?: PaymentProvider;
}

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

export class PaymentService {
  constructor(
    private walletService: WalletService,
    private notificationRepository: NotificationRepository,
    private saveHavenService: SaveHavenService,
    private helperService: HelperService,
    private monnifyService: MonnifyService,
    private flutterwaveService: FlutterwaveService,
    private xixapayService: XixapayService,
    private providerService: ProviderService,
    private walletRepository: WalletRepository,
    private virtualAccountRepository: VirtualAccountRepository,
    private cacheService: CacheService,
    private bankRepository: BankRepository,
    private systemBankAccountRepository: SystemBankAccountRepository,
  ) {}

  async getProviders(): Promise<any> {
    const [result, manualDepositServiceType] = await Promise.all([
      this.providerService.getActiveProvidersByServiceTypeCode(
        TRANSACTION_TYPES.DEPOSIT,
      ),
      ServiceType.findOne({ code: "manual_deposit", deletedAt: null }),
    ]);

    // Exclude any legacy crypto provider entries
    const mapped: any[] = result.filter(
      (provider: any) =>
        provider.code !== "nowpayment" &&
        provider.code !== "breet" &&
        provider.code !== "tatum" &&
        provider.code !== "crypto",
    );

    if (manualDepositServiceType?.status === "active") {
      mapped.push({
        id: "manual",
        code: "manual",
        name: "Manual Deposit",
        serviceTypeCode: "manual_deposit",
        status: "active",
        isManual: true,
      });
    }

    return mapped;
  }

  async initializePayment(
    data: InitializePaymentDTO,
  ): Promise<PaymentInitializationResult> {
    const reference = generateReference("PAY");
    const { provider, method } = data;

    try {
      const [user, wallet] = await Promise.all([
        User.findById(data.userId),
        this.walletRepository.findByUserId(data.userId),
      ]);

      if (!user) {
        throw new AppError(
          getErrorMessage(`User not found: ${data.userId}`, "User not found"),
          404,
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

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          data.amount,
          TRANSACTION_TYPES.DEPOSIT,
        );

      let paymentDetails: PaymentMethodResponse;

      switch (provider) {
        case PaymentProvider.SAVEHAVEN:
          paymentDetails = await SentryHelper.trackCriticalOperation(
            "savehaven_payment_initialization",
            async () =>
              this.handleSaveHavenPayment({
                user,
                method,
                amount: data.amount,
                reference,
              }),
            reference,
          );
          break;

        case PaymentProvider.MONNIFY:
          paymentDetails = await SentryHelper.trackCriticalOperation(
            "monnify_payment_initialization",
            async () =>
              this.handleMonnifyPayment({
                user,
                method,
                amount: data.amount,
                reference,
              }),
            reference,
          );
          break;

        case PaymentProvider.FLUTTERWAVE:
          paymentDetails = await SentryHelper.trackCriticalOperation(
            "flutterwave_payment_initialization",
            async () =>
              this.handleFlutterwavePayment({
                user,
                method,
                amount: data.amount,
                reference,
              }),
            reference,
          );
          break;

        case PaymentProvider.XIXAPAY:
          paymentDetails = await SentryHelper.trackCriticalOperation(
            "xixapay_payment_initialization",
            async () =>
              this.handleXixapayPayment({
                user,
                method,
                amount: data.amount,
                reference,
              }),
            reference,
          );
          break;

        case PaymentProvider.MANUAL:
          paymentDetails = await this.handleManualPayment({ reference });
          break;

        default:
          throw new AppError(
            getErrorMessage(
              `Invalid payment provider: ${provider}`,
              "Invalid payment provider",
            ),
            400,
            ERROR_CODES.INVALID_PROVIDER,
          );
      }

      logger.info(
        `Initialized ${method} payment via ${provider}: ${reference} | Amount: ${data.amount} | User: ${data.userId}`,
      );

      return {
        reference,
        amount: data.amount,
        serviceCharge: chargeCalculation.chargeAmount,
        amountYouWillReceive: chargeCalculation.baseAmount,
        provider,
        paymentDetails,
        chargeInfo: {
          serviceCharge: chargeCalculation.chargeAmount,
          chargeType: chargeCalculation.serviceCharge?.type,
          chargeValue: chargeCalculation.serviceCharge?.value,
          isServiceChargeCapped: chargeCalculation.isCapped,
        },
      };
    } catch (error: any) {
      logger.error(`Failed to initialize payment: ${reference}`, {
        error: error.message,
        provider,
        method,
        userId: data.userId,
        amount: data.amount,
      });
      throw new AppError(
        getErrorMessage(
          `Failed to initialize payment: ${error.message}`,
          "Failed to initialize payment",
        ),
        400,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Manual Deposit Handler
  // Returns the platform's bank account details for the user to pay into manually.
  // No virtual account is created. The user then submits proof via POST /wallet/record-deposit.

  private async handleManualPayment(data: {
    reference: string;
  }): Promise<BankTransferPaymentResponse> {
    const systemBankAccount =
      await this.systemBankAccountRepository.findDefault();

    if (!systemBankAccount) {
      throw new AppError(
        getErrorMessage(
          "No system bank account configured in the database",
          "Manual deposit is currently unavailable",
        ),
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.CONFIGURATION_ERROR,
      );
    }

    // Look up the human-readable bank name from the bank repository
    const bank = await this.bankRepository.findBySavehavenCode(
      systemBankAccount.bankCode,
    );

    return {
      method: PaymentMethod.BANK_TRANSFER,
      accountNumber: systemBankAccount.accountNumber,
      accountName: systemBankAccount.accountName,
      bankName: bank?.name ?? systemBankAccount.bankCode,
      bankCode: systemBankAccount.bankCode,
      reference: data.reference,
      // No expiresAt — this is a permanent system account
    } as BankTransferPaymentResponse;
  }

  // SaveHaven
  private async handleSaveHavenPayment(data: {
    user: any;
    method: PaymentMethod;
    amount: number;
    reference: string;
  }): Promise<PaymentMethodResponse> {
    const { user, method, amount, reference } = data;

    switch (method) {
      case PaymentMethod.BANK_TRANSFER: {
        const accountData =
          await this.saveHavenService.createVirtualAccountForTransfer({
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            reference,
            amount,
            phone: user.phone,
            bvn: user.bvn,
          });

        const bank = await this.bankRepository.findBySavehavenCode(
          accountData.bank_code,
        );

        if (!bank) {
          throw new AppError(
            getErrorMessage(
              `Bank not found for code: ${accountData.bank_code}`,
              "Bank information unavailable",
            ),
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        // Save virtual account so the inbound webhook can look it up
        await this.saveVirtualAccount({
          userId: data.user._id.toString(),
          accountNumber: accountData.account_number,
          accountName: accountData.account_name,
          bankName: bank.name,
          provider: PaymentProvider.SAVEHAVEN,
          reference,
          expiresAt: accountData.expires_at,
          amount,
        });

        return {
          method: PaymentMethod.BANK_TRANSFER,
          accountNumber: accountData.account_number,
          accountName: accountData.account_name,
          bankName: bank.name,
          bankCode: accountData.bank_code,
          expiresAt: accountData.expires_at,
          reference,
        } as BankTransferPaymentResponse;
      }

      case PaymentMethod.CARD: {
        const checkoutData = await this.saveHavenService.initiateCardPayment({
          email: user.email,
          firstname: user.firstname,
          lastname: user.lastname,
          amount,
          reference,
          phone: user.phone,
        });

        return {
          method: PaymentMethod.CARD,
          paymentUrl: checkoutData.checkoutUrl,
          reference,
          expiresAt: checkoutData.expiresAt,
        } as CardPaymentResponse;
      }

      default:
        throw new AppError(
          getErrorMessage(
            `SaveHaven does not support payment method: ${method}`,
            `Payment method not supported`,
          ),
          400,
          ERROR_CODES.INVALID_PAYMENT_METHOD,
        );
    }
  }

  // Monnify
  private async handleMonnifyPayment(data: {
    user: any;
    method: PaymentMethod;
    amount: number;
    reference: string;
  }): Promise<PaymentMethodResponse> {
    const { user, method, amount, reference } = data;

    switch (method) {
      case PaymentMethod.BANK_TRANSFER: {
        const accountData =
          await this.monnifyService.createVirtualAccountForTransfer({
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            reference,
            bvn: user.bvn,
            getAllBanks: true,
          });

        return {
          method: PaymentMethod.BANK_TRANSFER,
          accountNumber: accountData.accounts[0].accountNumber,
          accountName: accountData.accountName,
          bankName: accountData.accounts[0].bankName,
          bankCode: accountData.accounts[0].bankCode,
          reference,
        } as BankTransferPaymentResponse;
      }

      case PaymentMethod.CARD: {
        const checkoutData = await this.monnifyService.initiateCardPayment({
          email: user.email,
          amount,
          reference,
          customerName: `${user.firstname} ${user.lastname}`,
          redirectUrl: `${process.env.BASE_URL}/api/v1/webhooks/monnify/callback`,
        });

        await this.cacheService.set(
          `payment:${reference}`,
          user._id.toString(),
          1800,
        );

        return {
          method: PaymentMethod.CARD,
          paymentUrl: checkoutData.checkoutUrl,
          reference,
        } as CardPaymentResponse;
      }

      default:
        throw new AppError(
          getErrorMessage(
            `Monnify does not support payment method: ${method}`,
            `Payment method not supported`,
          ),
          400,
          ERROR_CODES.INVALID_PAYMENT_METHOD,
        );
    }
  }

  // Flutterwave
  private async handleFlutterwavePayment(data: {
    user: any;
    method: PaymentMethod;
    amount: number;
    reference: string;
  }): Promise<PaymentMethodResponse> {
    const { user, method, amount, reference } = data;

    switch (method) {
      case PaymentMethod.BANK_TRANSFER: {
        if (!user.bvn) {
          throw new AppError(
            getErrorMessage(
              `User ${user._id} attempted bank transfer without BVN`,
              "BVN is required for this payment method",
            ),
            400,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        const accountData =
          await this.flutterwaveService.createVirtualAccountForTransfer({
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            reference,
            bvn: user.bvn,
            phone: user.phone,
            isPermanent: false,
            amount,
          });

        return {
          method: PaymentMethod.BANK_TRANSFER,
          accountNumber: accountData.account_number,
          accountName: accountData.account_name,
          bankName: accountData.bank_name,
          bankCode: accountData.bank_code,
          expiresAt: accountData.expiry_date,
          reference,
        } as BankTransferPaymentResponse;
      }

      case PaymentMethod.CARD: {
        const paymentData = await this.flutterwaveService.initiateCardPayment({
          txRef: reference,
          amount,
          customerEmail: user.email,
          customerName: `${user.firstname} ${user.lastname}`,
          customerPhone: user.phone,
          redirectUrl: `${process.env.BASE_URL}/api/v1/webhooks/flutterwave/callback`,
        });

        await this.cacheService.set(
          `payment:${reference}`,
          user._id.toString(),
          1800,
        );

        return {
          method: PaymentMethod.CARD,
          paymentUrl: paymentData.paymentUrl,
          reference,
          expiresAt: paymentData.expiresAt,
        } as CardPaymentResponse;
      }

      case PaymentMethod.MOBILE_MONEY: {
        const mobileMoneyData =
          await this.flutterwaveService.initiateMobileMoneyPayment({
            txRef: reference,
            amount,
            currency: "GHS",
            customerEmail: user.email,
            customerName: `${user.firstname} ${user.lastname}`,
            customerPhone: user.phone || "",
          });

        return {
          method: PaymentMethod.MOBILE_MONEY,
          paymentUrl: mobileMoneyData.paymentUrl,
          reference,
          provider: "MTN Mobile Money",
        } as MobileMoneyPaymentResponse;
      }

      default:
        throw new AppError(
          getErrorMessage(
            `Flutterwave does not support payment method: ${method}`,
            `Payment method not supported`,
          ),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INVALID_PAYMENT_METHOD,
        );
    }
  }

  // Xixapay
  // Only BANK_TRANSFER is supported — Xixapay's collection product is virtual
  private async handleXixapayPayment(data: {
    user: any;
    method: PaymentMethod;
    amount: number;
    reference: string;
  }): Promise<PaymentMethodResponse> {
    const { user, method, amount, reference } = data;

    switch (method) {
      case PaymentMethod.BANK_TRANSFER: {
        // Dynamic (temporary) account — no KYC/customer_id required.
        // Confirmed: dynamic accounts skip the createCustomer step entirely.
        const accountData =
          await this.xixapayService.createDynamicVirtualAccount({
            email: user.email,
            name: `${user.firstname} ${user.lastname}`,
            phoneNumber: user.phone,
            amount,
            externalReference: reference,
          });

        const bankAccount = accountData.bankAccounts?.[0];

        if (!bankAccount) {
          throw new AppError(
            getErrorMessage(
              `Xixapay returned no bank account for reference: ${reference}`,
              "Account creation failed",
            ),
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }

        // Save virtual account so the inbound webhook can look it up
        await this.saveVirtualAccount({
          userId: user._id.toString(),
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
          bankName: bankAccount.bankName,
          provider: PaymentProvider.XIXAPAY,
          reference,
          amount,
        });

        return {
          method: PaymentMethod.BANK_TRANSFER,
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
          bankName: bankAccount.bankName,
          bankCode: bankAccount.bankCode,
          reference,
        } as BankTransferPaymentResponse;
      }

      default:
        throw new AppError(
          getErrorMessage(
            `Xixapay does not support payment method: ${method}`,
            `Payment method not supported`,
          ),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INVALID_PAYMENT_METHOD,
        );
    }
  }

  // Verify Payment
  async verifyPayment(reference: string): Promise<any> {
    const session = await mongoose.startSession();
    session.startTransaction();
    const virtualAccount = await this.virtualAccountRepository.findOne({
      $or: [
        { accountReference: reference },
        { accountNumber: reference },
        { orderReference: reference },
      ],
      isActive: true,
    });

    if (!virtualAccount) {
      await session.abortTransaction();
      throw new AppError(
        getErrorMessage(
          `Virtual account not found for reference: ${reference}`,
          "Payment reference not found",
        ),
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const provider = virtualAccount.provider;
    const userId = virtualAccount.userId;
    try {
      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: reference },
          { idempotencyKey: reference },
          { "meta.verificationReference": reference },
        ],
        type: TRANSACTION_TYPES.DEPOSIT,
        status: "success",
      });

      if (existingTransaction) {
        await session.abortTransaction();
        return {
          reference: existingTransaction.reference,
          amount: existingTransaction.amount,
          status: "success",
          provider,
          balance: existingTransaction.balanceAfter,
        };
      }

      let verificationResult;
      let amount = 0;

      switch (provider) {
        case "monnify":
          verificationResult = await SentryHelper.trackCriticalOperation(
            "monnify_payment_verification",
            async () => this.monnifyService.verifyPayment(reference),
            reference,
          );
          if (
            verificationResult.paymentStatus !== "PAID" ||
            !verificationResult.settlementAmount
          ) {
            SentryHelper.captureBusinessError(
              "MONNIFY_VERIFICATION_FAILED",
              `Monnify verification failed: ${verificationResult.paymentStatus}`,
              userId.toString(),
              { reference, status: verificationResult.paymentStatus },
            );
            throw new AppError(
              getErrorMessage(
                `Monnify payment verification failed: ${verificationResult.paymentStatus}`,
                "Payment verification failed",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }
          amount = verificationResult.settlementAmount;
          break;

        case "flutterwave":
          const txRef = virtualAccount.orderReference || reference;
          verificationResult = await SentryHelper.trackCriticalOperation(
            "flutterwave_payment_verification",
            async () => this.flutterwaveService.verifyTransaction(txRef),
            reference,
          );
          if (
            verificationResult.status !== "successful" ||
            !verificationResult.amount
          ) {
            SentryHelper.captureBusinessError(
              "FLUTTERWAVE_VERIFICATION_FAILED",
              `Flutterwave verification failed: ${verificationResult.status}`,
              userId.toString(),
              { reference, status: verificationResult.status },
            );
            throw new AppError(
              getErrorMessage(
                `Flutterwave verification failed: ${verificationResult.status}`,
                "Payment verification failed",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }
          amount = verificationResult.amount;
          break;

        case "saveHaven":
          verificationResult = await SentryHelper.trackCriticalOperation(
            "savehaven_payment_verification",
            async () => this.saveHavenService.verifyPayment(reference),
            reference,
          );
          if (!verificationResult || !verificationResult.amount) {
            SentryHelper.captureBusinessError(
              "SAVEHAVEN_VERIFICATION_FAILED",
              `SaveHaven verification failed for: ${reference}`,
              userId.toString(),
              { reference, response: verificationResult },
            );
            throw new AppError(
              getErrorMessage(
                `SaveHaven verification returned invalid response for: ${reference}`,
                "Payment verification failed",
              ),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }
          amount = verificationResult.amount;
          break;

        case "xixapay":
          // No documented "verify transaction by reference" endpoint exists
          // for Xixapay collections. Rather than fabricate one, this is
          // logged clearly and returns an honest not-implemented response.
          // Reconciliation for Xixapay currently relies entirely on the
          // webhook — see XixapayWebhookService.
          logger.warn(
            `Xixapay verifyPayment called but no verify-by-reference endpoint exists`,
            { reference },
          );
          throw new AppError(
            getErrorMessage(
              `Xixapay manual verification is not yet integrated for: ${reference}`,
              "Payment verification is not available for this provider. Please contact support if your payment hasn't reflected.",
            ),
            HTTP_STATUS.NOT_IMPLEMENTED,
            ERROR_CODES.THIRD_PARTY_ERROR,
          );

        default:
          throw new AppError(
            getErrorMessage(
              `Unknown payment provider: ${provider}`,
              "Invalid payment provider",
            ),
            400,
            ERROR_CODES.INVALID_PROVIDER,
          );
      }

      const wallet = await this.walletRepository.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          getErrorMessage(
            `Wallet not found for user during verification: ${userId}`,
            "Wallet not found",
          ),
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + amount;
      const depositReference = generateReference("DEP");

      const deposit = await Deposit.create(
        [
          {
            userId,
            walletId: wallet._id,
            reference: depositReference,
            provider,
            amount,
            status: "success",
            meta: {
              verificationData: verificationResult,
              providerReference: reference,
              virtualAccountId: virtualAccount._id,
              manualVerification: true,
              verifiedAt: new Date(),
            },
          },
        ],
        { session },
      );

      const transactionReference = generateReference("TXN");
      await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: userId,
            userId,
            reference: transactionReference,
            providerReference: reference,
            idempotencyKey: reference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            provider,
            status: "success",
            purpose: "Manual deposit verification",
            balanceBefore,
            balanceAfter,
            initiatedBy: userId,
            initiatedByType: "user",
            meta: {
              depositId: deposit[0]._id,
              depositReference,
              provider,
              virtualAccountId: virtualAccount._id,
              verificationData: verificationResult,
              verificationReference: reference,
              manualVerification: true,
            },
          },
        ],
        { session },
      );

      const updatedWallet = await Wallet.findByIdAndUpdate(
        wallet._id,
        { $inc: { balance: amount } },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new Error("Failed to update wallet balance");
      }

      await session.commitTransaction();

      try {
        await this.cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
      } catch (cacheErr) {
        logger.error("PaymentService: failed to invalidate wallet cache:", cacheErr);
      }

      await this.notificationRepository.create({
        type: "payment_success",
        notifiableType: "User",
        notifiableId: userId,
        data: {
          transactionType: "Wallet Funding",
          amount,
          reference: transactionReference,
          provider,
          balance: balanceAfter,
        },
      });

      return {
        reference: transactionReference,
        amount,
        status: "success",
        provider,
        balance: balanceAfter,
      };
    } catch (error: any) {
      await session.abortTransaction();
      SentryHelper.captureBusinessError(
        "PAYMENT_VERIFICATION_FAILED",
        `Payment verification error: ${error.message}`,
        reference,
        { reference, provider, error: error.message },
      );
      logger.error(`Failed to verify payment for ${reference}:`, error);
      throw new AppError(
        getErrorMessage(
          `Payment verification error: ${error.message}`,
          "Payment verification failed",
        ),
        error.statusCode || HTTP_STATUS.BAD_REQUEST,
        error.errorCode || ERROR_CODES.VALIDATION_ERROR,
      );
    } finally {
      session.endSession();
    }
  }

  private async saveVirtualAccount(data: {
    userId: string;
    accountNumber: string;
    accountName: string;
    bankName: string;
    provider: PaymentProvider;
    reference: string;
    expiresAt?: string;
    amount: number;
  }): Promise<void> {
    try {
      await this.virtualAccountRepository.create({
        userId: new Types.ObjectId(data.userId),
        accountNumber: data.accountNumber,
        accountName: data.accountName,
        bankName: data.bankName,
        provider: data.provider,
        accountReference: data.reference,
        orderReference: data.reference,
        type: "temporary" as const,
        isActive: true,
        expiredAt: data.expiresAt
          ? new Date(data.expiresAt)
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
        meta: { amount: data.amount },
      } as any);

      logger.info(`Virtual account saved: ${data.reference}`, {
        userId: data.userId,
        accountNumber: data.accountNumber,
        provider: data.provider,
      });
    } catch (err: any) {
      logger.error(`Failed to save virtual account: ${data.reference}`, {
        error: err.message,
        userId: data.userId,
      });
      throw new AppError(
        getErrorMessage(
          `Database error while saving virtual account: ${err.message}`,
          "Unable to process payment at this time",
        ),
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.DATABASE_ERROR,
      );
    }
  }
}
