import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { SaveHavenService } from "../providers/payments/SaveHavenService";
import { MonnifyService } from "../providers/payments/MonnifyService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference } from "@/utils/helpers";
import { CacheService } from "../../core/CacheService";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { XixapayService } from "../providers/payments/XixapayService";

interface CreateVirtualAccountDTO {
  userId: string;
  type: "permanent" | "temporary";
  provider: string;
  identificationType: "bvn" | "nin";
  identityId: string; // From validated identity
  firstname?: string;
  lastname?: string;
  middlename?: string;
  dateOfBirth?: string;
  identificationData?: {
    bvn?: string;
    nin?: string;
  };
}

export class VirtualAccountService {
  constructor(
    private virtualAccountRepository: VirtualAccountRepository,
    private userRepository: UserRepository,
    private saveHavenService: SaveHavenService,
    private monnifyService: MonnifyService,
    private xixapayService: XixapayService,
    private cacheService: CacheService,
  ) { }

  // Create Virtual Account (Called after identity validation)
  // Purpose: Create SafeHaven sub-account (the real account user will use)
  // Note: Monnify account already created and saved during validation step

  async createVirtualAccount(data: CreateVirtualAccountDTO) {
    return SentryHelper.trackCriticalOperation(
      "virtual_account_creation",
      async () => {
        const user = await this.userRepository.findById(data.userId);
        if (!user) {
          throw new AppError(
            "User not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        // Get cached validation data
        const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${data.identityId}`;
        const cachedData = await this.cacheService.get(cacheKey);

        if (!cachedData) {
          throw new AppError(
            "Validation session expired. Please restart verification.",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        const validationData = JSON.parse(cachedData as any);

        // Verify OTP was validated
        if (!validationData.otpVerified) {
          throw new AppError(
            "OTP not verified. Please complete OTP validation first.",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // Check if user already has a SafeHaven sub-account
        const existingSafeHaven = await this.virtualAccountRepository.findOne({
          userId: new Types.ObjectId(data.userId),
          provider: "saveHaven",
          isActive: true,
          type: "permanent"
        });

        if (existingSafeHaven) {
          logger.info(`User ${data.userId} already has SafeHaven account`);
          return existingSafeHaven;
        }

        logger.info(
          `[STEP 4] Creating SafeHaven sub-account for user ${data.userId}`,
        );

        //  Create SafeHaven Sub-Account (Primary Account)
        // Uses verified identityId from OTP validation
        const saveHavenAccount = await this.createSafeHavenSubAccount(
          user,
          validationData.saveHavenIdentityId,
        );

        // Store SafeHaven account (PRIMARY - shown to user)
        const virtualAccount =
          await this.virtualAccountRepository.createAccount({
            userId: new Types.ObjectId(data.userId),
            provider: "saveHaven",
            type: data.type,
            accountNumber: saveHavenAccount.account_number,
            accountName: saveHavenAccount.account_name,
            bankName: saveHavenAccount.bank_name,
            bankCode: saveHavenAccount.bank_code,
            orderReference: saveHavenAccount.reference,
            isPrimary: true,
            isActive: true,
            meta: {
              providerAccountId: saveHavenAccount.provider_account_id,
              autoSweep: true,
              autoSweepAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
              accountBalanceAtCreation: saveHavenAccount.account_balance ?? 0,
            },
          });

        // NOTE: Monnify account already saved during validation
        // No need to save it again here
        logger.info(
          `[STEP 4]  SafeHaven sub-account created (primary): ${virtualAccount.accountNumber}`,
        );
        logger.info(
          `[STEP 4] ℹ️  Monnify account (validation record) already exists from Step 1`,
        );

        // Update cache
        validationData.saveHavenAccountCreated = true;
        await this.cacheService.set(
          cacheKey,
          JSON.stringify(validationData),
          3600,
        );

        logger.info(
          `[STEP 4 COMPLETE]  SafeHaven sub-account created for user ${data.userId}`,
        );

        return virtualAccount;
      },
      data.userId,
    );
  }

  // Xixapay permanent/static account creation — single-pass, no OTP round-trip.
  // Unlike createVirtualAccount() above (SaveHaven), this does not depend on
  // a cached identityId/OTP-verified session, because Xixapay's KYC has no
  // OTP step at all: createCustomer() takes BVN/NIN + bio fields directly
  // and returns a customer_id synchronously.
  async createXixapayVirtualAccount(data: {
    userId: string;
    identificationType: "bvn" | "nin";
    idNumber?: string;
    address?: string;
    state?: string;
    city?: string;
    postalCode?: string;
  }) {
    return SentryHelper.trackCriticalOperation(
      "xixapay_virtual_account_creation",
      async () => {
        const user = await this.userRepository.findById(data.userId);
        if (!user) {
          throw new AppError(
            "User not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        const idNumber =
          data.idNumber ||
          (data.identificationType === "bvn" ? user.bvn : user.nin);

        if (!idNumber) {
          throw new AppError(
            `User has no ${data.identificationType.toUpperCase()} on file. Please complete identity validation first.`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // user.phone is optional on the model (phone?: string), but
        // createStaticVirtualAccountWithRawData() requires it as a string.
        // Guard here instead of letting `undefined` reach the provider call.
        if (!user.phone) {
          throw new AppError(
            "User has no phone number on file. Please update your profile with a valid phone number.",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // Check if user already has a Xixapay account
        const existingXixapay = await this.virtualAccountRepository.findOne({
          userId: new Types.ObjectId(data.userId),
          provider: "xixapay",
          isActive: true,
          type: "permanent"
        });

        if (existingXixapay) {
          logger.info(`User ${data.userId} already has Xixapay account`);
          return existingXixapay;
        }

        // Address/state/city/postalCode are still resolved via the same
        // fallback chain (request -> user.xixapayKyc.* -> user.* profile
        // fields) and stored below, since they'll matter for a future
        // document-based KYC upgrade (createCustomer/updateCustomer once
        // file uploads exist). They are NOT required by
        // createStaticVirtualAccountWithRawData(), so they no longer block
        // account creation.
        const resolvedAddress: Record<string, string | undefined> = {
          address: data.address || user.xixapayKyc?.address || user.address,
          state: data.state || user.xixapayKyc?.state || user.state,
          city: data.city || user.xixapayKyc?.city || user.city,
          postalCode:
            data.postalCode || user.xixapayKyc?.postalCode || user.postalCode,
        };

        logger.info(
          `[Xixapay] Creating static account (raw data) for user ${data.userId}`,
        );

        // Single call, no OTP, no id_card/utility_bill, no address
        // requirement. Still returns customer.customer_id in the response,
        // which we persist below so it's available for the future
        // document-upgrade path (updateCustomer).
        const accountData =
          await this.xixapayService.createStaticVirtualAccountWithRawData({
            email: user.email,
            name: `${user.firstname} ${user.lastname}`,
            phoneNumber: user.phone,
            id_type: data.identificationType,
            id_number: idNumber,
          });

        const bankAccount = accountData.bankAccounts?.[0];

        if (!bankAccount) {
          throw new AppError(
            "Xixapay returned no bank account for the static account request",
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }

        // Persist customer_id + resolved KYC data on the user record for
        // future reuse (e.g. card issuing, updateCustomer for KYC document
        // attachment later, and so the fallback chain above has something
        // to find next time even if this was the first time these fields
        // were ever supplied).
        user.xixapayCustomerId = accountData.customer.customer_id;
        user.xixapayKyc = {
          ...user.xixapayKyc,
          address: resolvedAddress.address,
          state: resolvedAddress.state,
          city: resolvedAddress.city,
          postalCode: resolvedAddress.postalCode,
          status: "verified",
          verifiedAt: new Date(),
        };
        // idNumber may have come from `data.idNumber` this call rather than
        // from the user record — persist it back so it's on file next time,
        // same reasoning as the address fallback chain above.
        if (data.identificationType === "bvn") {
          user.bvn = idNumber;
          user.bvnValidated = true;
          user.bvnVerified = true;
        } else {
          user.nin = idNumber;
        }
        await user.save();

        const virtualAccount =
          await this.virtualAccountRepository.createAccount({
            userId: new Types.ObjectId(data.userId),
            provider: "xixapay",
            type: "permanent",
            accountNumber: bankAccount.accountNumber,
            accountName: bankAccount.accountName,
            bankName: bankAccount.bankName,
            bankCode: bankAccount.bankCode,
            orderReference: accountData.customer.customer_id,
            isPrimary: true,
            isActive: true,
          });

        logger.info(
          `[Xixapay] Static virtual account created: ${virtualAccount.accountNumber}`,
        );

        return virtualAccount;
      },
      data.userId,
    );
  }

  // Create SafeHaven Sub-Account using verified identityId

  private async createSafeHavenSubAccount(user: any, identityId: string) {
    try {
      const payload = {
        externalReference: generateReference("SAV"),
        phoneNumber: user.phone.startsWith("234")
          ? user.phone
          : "234" + user.phone,
        emailAddress: user.email,
        identityId: identityId, // Verified identityId from OTP
      };

      logger.info("Creating SafeHaven sub-account:", payload);

      const result = await SentryHelper.trackCriticalOperation(
        "savehaven_subaccount_creation",
        async () => this.saveHavenService.createSubAccount(payload),
        payload.externalReference,
      );
      return result;
    } catch (error: any) {
      logger.error("Error creating SafeHaven sub-account:", error);
      SentryHelper.captureBusinessError(
        "VIRTUAL_ACCOUNT_CREATION_FAILED",
        `Virtual account creation failed for user: ${user.id}`,
        user.userId,
        { provider: "SafeHaven", error: error },
      );
      throw new AppError(
        error.message || "Failed to create SafeHaven sub-account",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getUserVirtualAccount(userId: string, providerCode?: string) {
    const query: any = {
      userId: new Types.ObjectId(userId),
      isActive: true,
      type: "permanent"
    };

    if (providerCode) {
      // Use case-insensitive search for provider code just in case
      query.provider = { $regex: new RegExp(`^${providerCode}$`, "i") };
    }

    const account = await this.virtualAccountRepository.findOne(query);

    if (!account) {
      return null;
    }

    return {
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankName: account.bankName,
      provider: account.provider,
      createdAt: account.createdAt,
    };
  }

  async getUserPermanentAccounts(userId: string) {
    return this.virtualAccountRepository.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
      type: "permanent",
    });
  }

  // Get all user's virtual accounts (including hidden Monnify)
  // For admin/debugging purposes

  async getAllUserVirtualAccounts(userId: string) {
    const accounts = await this.virtualAccountRepository.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });

    return accounts.map((account) => ({
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankName: account.bankName,
      provider: account.provider,
      isPrimary: account.isPrimary,
      createdAt: account.createdAt,
    }));
  }
}
