import { WalletRepository } from "@/repositories/client/WalletRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference, getEnviroment } from "@/utils/helpers";
import logger from "@/logger";
import { ValidationData } from "@/utils/Iidentityprovider";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { CacheService } from "@/services/core/CacheService";
import { IdentityProviderFactory } from "../IdentityProviders/Identityproviderfactory";
import { MonnifyService } from "../providers/payments/MonnifyService";
import { SaveHavenService } from "../providers/payments/SaveHavenService";
import { VirtualAccountService } from "../wallet/VirtualAccountService";
import { SUBACCOUNT_PROVIDER } from "@/config/providers";

interface ValidationDataInput {
  firstname: string;
  lastname: string;
  dateOfBirth: string;
  identificationType: "bvn" | "nin";
  value: string;
  middlename?: string;
  phoneNumber?: string;
  selfieImageBase64?: string; // Optional for NIN with selfie
  address?: string;
  state?: string;
  city?: string;
  postalCode?: string;
}

interface ValidationResponse {
  success: boolean;
  isOtpRequired: boolean;
  identityId?: string;
  message: string;
  step: "bvn_validated" | "otp_sent" | "completed";
  data?: any;
}

export class IdentityVerificationService {
  private providerFactory = IdentityProviderFactory.getInstance();

  constructor(
    private walletRepository: WalletRepository,
    private cacheService: CacheService,
    private transactionRepository: TransactionRepository,
    private userRepository: UserRepository,
    private virtualAccountRepository: VirtualAccountRepository,
    private notificationRepository: NotificationRepository,
    private saveHavenService: SaveHavenService,
    private monnifyService: MonnifyService,
    private providerRepository: ProviderRepository,
    private virtualAccountService: VirtualAccountService,
  ) { }

  // Check if a provider is active with caching
  private async isProviderActive(providerCode: string): Promise<boolean> {
    try {
      const cacheKey = `provider:active:${providerCode}`;

      // Try cache first
      const cached = await this.cacheService.get<boolean>(cacheKey);
      if (cached !== null && cached !== undefined) {
        logger.debug(`Using cached provider active status for ${providerCode}`);
        return cached;
      }

      // Query database
      const provider = await this.providerRepository.findByCode(providerCode);
      const isActive = provider?.isActive ?? false;

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, isActive, CACHE_TTL.ONE_HOUR);

      return isActive;
    } catch (error) {
      logger.error(
        `Error checking provider active status for ${providerCode}:`,
        error,
      );
      return false;
    }
  }

  async validateIdentity(
    userId: string | Types.ObjectId,
    data: ValidationDataInput,
    targetProvider?: string,
  ): Promise<ValidationResponse> {
    return SentryHelper.trackCriticalOperation(
      "identity_validation_start",
      async () => {
        try {
          const user = await this.userRepository.findById(userId.toString());
          if (!user) {
            throw new AppError(
              "User not found",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.RESOURCE_NOT_FOUND,
            );
          }

          const resolvedProvider = (
            targetProvider ||
            SUBACCOUNT_PROVIDER ||
            "savehaven"
          ).toLowerCase();

          if (resolvedProvider === "xixapay") {
            return this.handleXixapayInitiate(user, userId, data);
          }

          logger.info(
            `[FLOW START] Starting ${data.identificationType.toUpperCase()} validation for user ${userId} using ${resolvedProvider}`,
          );

          // Check if user already has active SafeHaven account
          const existingSafeHavenAccount =
            await this.virtualAccountRepository.findOne({
              userId: new Types.ObjectId(userId.toString()),
              provider: { $regex: /^savehaven$/i },
              isActive: true,
              type: "permanent"
            });

          if (
            existingSafeHavenAccount &&
            existingSafeHavenAccount.type !== "temporary"
          ) {
            logger.info(
              `[STEP 0] User ${userId} already has SafeHaven account: ${existingSafeHavenAccount.accountNumber}. No need to create again.`,
            );

            throw new AppError(
              "You already have a SafeHaven virtual account.",
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }

          //  Validate with identity provider (Dojah, Monnify, or skip)
          let validatedKYCData: any = {
            firstName: data.firstname,
            lastName: data.lastname,
            middleName: data.middlename,
            dateOfBirth: data.dateOfBirth,
            phoneNumber: data.phoneNumber,
            bvn: data.identificationType === "bvn" ? data.value : undefined,
            nin: data.identificationType === "nin" ? data.value : undefined,
          };

          const identityProvider = this.providerFactory.getProvider();

          if (identityProvider) {
            logger.info(
              `[STEP 1] Using ${identityProvider.getProviderName()} for ${data.identificationType.toUpperCase()} validation`,
            );

            try {
              const providerData: ValidationData = {
                identificationType: data.identificationType,
                value: data.value,
                firstname: data.firstname,
                lastname: data.lastname,
                middlename: data.middlename,
                dateOfBirth: data.dateOfBirth,
                phoneNumber: data.phoneNumber,
                selfieImageBase64: data.selfieImageBase64,
              };

              const validationResult =
                await identityProvider.validateIdentity(providerData);

              if (!validationResult.success) {
                throw new AppError(
                  validationResult.message,
                  HTTP_STATUS.BAD_REQUEST,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }

              // Use provider's validated KYC data
              validatedKYCData = {
                ...validatedKYCData,
                ...validationResult.kycData,
              };

              logger.info(
                `[STEP 1] ${data.identificationType.toUpperCase()} validated successfully with ${identityProvider.getProviderName()}`,
              );
            } catch (validationError: any) {
              logger.error(
                `[STEP 1] ${data.identificationType.toUpperCase()} validation failed:`,
                validationError.message,
              );

              if (validationError instanceof AppError) {
                throw validationError;
              }

              const environment = getEnviroment();
              const finalMessage =
                environment === "production"
                  ? `${data.identificationType.toUpperCase()} validation failed. Please check your details and try again.`
                  : validationError.message || "Validation failed";

              throw new AppError(
                finalMessage,
                HTTP_STATUS.BAD_REQUEST,
                ERROR_CODES.VALIDATION_ERROR,
              );
            }
          } else {
            logger.info(
              `[STEP 1] No identity provider configured. Skipping validation (accepting provided data)`,
            );
          }

          //  Update user profile with validated data
          logger.info(`[STEP 2] Updating user profile with validated data`);

          user.firstname = validatedKYCData.firstName || data.firstname;
          user.lastname = validatedKYCData.lastName || data.lastname;
          user.dateOfBirth = validatedKYCData.dateOfBirth
            ? new Date(validatedKYCData.dateOfBirth)
            : user.dateOfBirth;

          if (data.identificationType === "bvn") {
            user.bvn = data.value;
            user.bvnValidated = true;
          } else if (data.identificationType === "nin") {
            user.nin = data.value;
          }

          await user.save();
          logger.info(
            `[STEP 2] User ${userId} profile updated. ${data.identificationType.toUpperCase()} validated=${user.bvnValidated}`,
          );

          // Invalidate user cache
          await this.cacheService.delete(
            CACHE_KEYS.USER_PROFILE(userId.toString()),
          );

          //  Send to SaveHaven for OTP
          logger.info(`[STEP 3] Sending to SaveHaven for OTP...`);

          const saveHavenOTP =
            await this.saveHavenService.initiateIdentityVerification({
              identityType: data.identificationType,
              identityNumber: data.value,
              firstName: user.firstname,
              lastName: user.lastname,
              middleName: user.firstname.split(" ").slice(1).join(" "),
              dateOfBirth: data.dateOfBirth,
            });

          const identityId = saveHavenOTP.identityId;

          logger.info(
            `[STEP 3] OTP sent via SaveHaven. identityId: ${identityId}`,
          );

          //  Cache validation data for OTP verification step
          const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${identityId}`;

          const cacheData = {
            userId: userId.toString(),
            identificationType: data.identificationType,
            identificationValue: data.value,
            firstname: user.firstname,
            lastname: user.lastname,
            dateOfBirth: data.dateOfBirth,
            middlename: user.firstname.split(" ").slice(1).join(" "),
            phoneNumber: data.phoneNumber,
            email: user.email,

            // SaveHaven identity data
            saveHavenIdentityId: identityId,

            // Validation status flags
            usedIdentityProvider: !!identityProvider,
            identityProviderUsed: identityProvider
              ? identityProvider.getProviderName()
              : null,
            bvnValidatedWithProvider: !!identityProvider,
            otpSent: true,
            otpVerified: false,
            saveHavenAccountCreated: false,

            // Metadata
            timestamp: Date.now(),
          };

          await this.cacheService.set(
            cacheKey,
            JSON.stringify(cacheData),
            3600,
          );

          logger.info(
            `[FLOW COMPLETED] User ${userId} ready for OTP verification`,
          );

          return {
            success: true,
            isOtpRequired: true,
            identityId: identityId,
            message: `${data.identificationType.toUpperCase()} validated successfully. An OTP has been sent to your registered phone number.`,
            step: "otp_sent",
            data: {
              bvnValidated: user.bvnValidated,
              identityProviderUsed: identityProvider
                ? identityProvider.getProviderName()
                : "none",
              otpSent: true,
              expiresIn: 3600,
              nextStep: "Verify the OTP to complete your account setup",
            },
          };
        } catch (error: any) {
          SentryHelper.captureBusinessError(
            "IDENTITY_VALIDATION_FAILED",
            `Identity validation failed: ${data.identificationType}`,
            userId.toString(),
            {
              identificationType: data.identificationType,
              error: error.message,
            },
          );
          logger.error(`[FLOW] Validation initiation failed:`, {
            error: error.message,
            userId,
            identificationType: data.identificationType,
          });

          if (error instanceof AppError) {
            throw error;
          }

          const environment = getEnviroment();
          const errorMessage = error.message || "";
          const finalMessage =
            environment === "production"
              ? "Validation failed. Please check your details and try again."
              : errorMessage;

          throw new AppError(
            finalMessage,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      },
      userId.toString(),
    );
  }

  // Xixapay flag branch — single-pass, no OTP.
  private async handleXixapayInitiate(
    user: any,
    userId: string | Types.ObjectId,
    data: ValidationDataInput,
  ): Promise<ValidationResponse> {
    // Resolve the ID number: fresh value from this request first (this is
    // likely the user's first ever KYC submission, no prior SafeHaven step).
    // Fall back to what's already on the user record only if it was actually
    // validated before (bvn) or already present (nin).
    const idNumber =
      data.value ||
      (data.identificationType === "bvn"
        ? user.bvnValidated
          ? user.bvn
          : undefined
        : user.nin);

    if (!idNumber) {
      throw new AppError(
        `${data.identificationType.toUpperCase()} is required`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    user.firstname = data.firstname;
    user.lastname = data.lastname;
    user.dateOfBirth = new Date(data.dateOfBirth);
    if (data.identificationType === "bvn") {
      user.bvn = idNumber;
      user.bvnValidated = true;
    } else {
      user.nin = idNumber;
    }
    await user.save();
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId.toString()));

    const account = await this.virtualAccountService.createXixapayVirtualAccount({
      userId: userId.toString(),
      identificationType: data.identificationType,
      idNumber,
      address: data.address,
      state: data.state,
      city: data.city,
      postalCode: data.postalCode,
    });

    return {
      success: true,
      isOtpRequired: false,
      message: "Virtual account created successfully!",
      step: "completed",
      data: { verified: true, account },
    };
  }

  /**
   * Recovery method: Resend OTP for users with stored validation
   * Use this when user has already validated BVN but closed app before OTP verification
   */
  async resendOTPWithStoredValidation(
    userId: string | Types.ObjectId,
  ): Promise<{
    success: boolean;
    identityId: string;
    message: string;
    nextStep: string;
  }> {
    try {
      const user = await this.userRepository.findById(userId.toString());
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // Check if user has already validated their BVN
      if (!user.bvnValidated) {
        throw new AppError(
          "Identity has not been validated yet. Please start from the beginning.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(
        `[RECOVERY] Resending OTP for user ${userId} with stored validation`,
      );

      // Use stored user data and determine identification type
      const identificationType = user.bvn ? "bvn" : "nin";
      const identificationValue = user.bvn || user.nin;

      if (!identificationValue) {
        throw new AppError(
          "No valid BVN or NIN found. Please validate your identity.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Send to SaveHaven for new OTP
      logger.info(
        `[RECOVERY] Sending to SaveHaven for OTP with stored ${identificationType.toUpperCase()}`,
      );

      const saveHavenOTP =
        await this.saveHavenService.initiateIdentityVerification({
          identityType: identificationType as "bvn" | "nin",
          identityNumber: identificationValue,
          firstName: user.firstname,
          lastName: user.lastname,
          middleName: user.firstname.split(" ").slice(1).join(" "),
          dateOfBirth: user.dateOfBirth
            ? user.dateOfBirth.toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0],
        });

      const identityId = saveHavenOTP.identityId;

      logger.info(
        `[RECOVERY] OTP sent successfully. identityId: ${identityId}`,
      );

      // Cache validation data for OTP verification
      const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${identityId}`;

      const cacheData = {
        userId: userId.toString(),
        identificationType: identificationType,
        identificationValue: identificationValue,
        firstname: user.firstname,
        lastname: user.lastname,
        dateOfBirth: user.dateOfBirth
          ? user.dateOfBirth.toISOString().split("T")[0]
          : "",
        email: user.email,

        // SaveHaven identity data
        saveHavenIdentityId: identityId,

        // Validation status flags
        usedIdentityProvider: false,
        identityProviderUsed: "stored",
        bvnValidatedWithProvider: false,
        otpSent: true,
        otpVerified: false,
        saveHavenAccountCreated: false,

        // Metadata
        timestamp: Date.now(),
        isRecoveryFlow: true,
      };

      await this.cacheService.set(cacheKey, JSON.stringify(cacheData), 3600);

      return {
        success: true,
        identityId: identityId,
        message: "OTP has been resent to your registered phone number.",
        nextStep: "Verify the OTP to complete your account setup",
      };
    } catch (error: any) {
      logger.error(`[RECOVERY] OTP resend failed:`, {
        error: error.message,
        userId,
      });

      if (error instanceof AppError) {
        throw error;
      }

      const environment = getEnviroment();
      const finalMessage =
        environment === "production"
          ? "Failed to resend OTP. Please try again."
          : error.message || "OTP resend failed";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Validate OTP (existing method - keep as is)
  async validateOtp(
    identityId: string,
    identificationType: string,
    otp: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${identityId}`;
    const cachedData = await this.cacheService.get(cacheKey);
    if (!cachedData) {
      throw new AppError(
        "Validation session expired or not found. Please restart the verification process.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const validationData = JSON.parse(cachedData as any);

    try {
      // Get cached validation data

      if (!otp || otp.trim().length === 0) {
        throw new AppError(
          "OTP is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`[STEP 3] Validating OTP for identity ${identityId}`);

      // Validate OTP with SaveHaven
      const result = await SentryHelper.trackCriticalOperation(
        "savehaven_otp_verification",
        async () =>
          this.saveHavenService.validateIdentity({
            identityId: identityId,
            identificationType: identificationType.toUpperCase(),
            otp: otp.trim(),
          }),
        identityId,
      );

      if (!result.verified) {
        throw new AppError(
          "Invalid OTP. Please check and try again.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`OTP validated successfully`);

      // Update user with verification status
      const user = await this.userRepository.findById(validationData.userId);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (validationData.identificationType === "bvn") {
        user.bvnValidated = true;
        user.bvnVerified = true;
        await user.save();
        logger.info(
          `User ${validationData.userId} BVN: validated=true, verified=true`,
        );
      } else if (validationData.identificationType === "nin") {
        await user.save();
        logger.info(`User ${validationData.userId} NIN verified`);
      }

      await this.cacheService.delete(
        CACHE_KEYS.USER_PROFILE(validationData.userId),
      );

      logger.info(
        `[STEP 3] User ${validationData.userId} identity verified and ownership confirmed`,
      );

      // Update cache to mark OTP as verified
      const updatedCacheData = {
        ...validationData,
        otpVerified: true,
        verifiedAt: Date.now(),
      };

      await this.cacheService.set(
        cacheKey,
        JSON.stringify(updatedCacheData),
        3600,
      );

      return {
        success: true,
        message:
          "Identity verified successfully! You can now create your SafeHaven virtual account.",
        data: {
          identityId: identityId,
          userId: validationData.userId,
          identificationType: validationData.identificationType,
          otpVerified: true,
          canCreateSubAccount: true,
          validationMethod: validationData.usedIdentityProvider
            ? validationData.identityProviderUsed + " + savehaven"
            : "savehaven",
        },
      };
    } catch (error: any) {
      SentryHelper.captureBusinessError(
        "SAFEHAVEN_OTP_VERIFICATION_FAILED",
        `OTP verification failed for identity: ${identityId}`,
        validationData.userId,
        { identityId, attempts: validationData.otpAttempts },
      );
      logger.error("OTP validation error:", {
        error: error.message,
        identityId,
      });

      if (error instanceof AppError) {
        throw error;
      }

      const environment = getEnviroment();
      const finalMessage =
        environment === "production"
          ? "OTP validation failed. Please try again."
          : "OTP validation failed. Please try again.";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get validation status (existing method - keep as is)
  async getValidationStatus(identityId: string): Promise<any> {
    try {
      const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${identityId}`;
      const cachedData = await this.cacheService.get(cacheKey);

      if (!cachedData) {
        return {
          exists: false,
          message: "Validation session not found or expired",
        };
      }

      const validationData = JSON.parse(cachedData as any);

      return {
        exists: true,
        identificationType: validationData.identificationType,
        bvnValidatedWithProvider:
          validationData.bvnValidatedWithProvider || false,
        usedIdentityProvider: validationData.usedIdentityProvider || false,
        identityProviderUsed: validationData.identityProviderUsed || "none",
        otpSent: validationData.otpSent || false,
        otpVerified: validationData.otpVerified || false,
        saveHavenAccountCreated:
          validationData.saveHavenAccountCreated || false,
        canCreateSubAccount: validationData.otpVerified === true,
        timestamp: validationData.timestamp,
        expiresAt: validationData.timestamp + 3600000,
      };
    } catch (error: any) {
      logger.error("Error getting validation status:", error);
      throw new AppError(
        "Failed to get validation status",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // Resend OTP (existing method - keep as is)
  async resendOtp(identityId: string): Promise<{
    success: boolean;
    message: string;
    identityId: string;
  }> {
    const cacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${identityId}`;
    const cachedData = await this.cacheService.get(cacheKey);

    if (!cachedData) {
      throw new AppError(
        "Validation session expired or not found. Please restart the verification process.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const validationData = JSON.parse(cachedData as any);

    try {
      // Get cached validation data

      // Check if already verified
      if (validationData.otpVerified) {
        throw new AppError(
          "Identity already verified. You can now create your virtual account.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Rate limiting
      const resendCount = validationData.otpResendCount || 0;
      const MAX_RESEND_ATTEMPTS = 3;

      if (resendCount >= MAX_RESEND_ATTEMPTS) {
        logger.warn(
          `User ${validationData.userId} exceeded max OTP resend attempts`,
        );
        throw new AppError(
          "Maximum OTP resend attempts exceeded. Please restart the verification process.",
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check time since last resend
      const lastResendTime =
        validationData.lastResendTime || validationData.timestamp;
      const timeSinceLastResend = Date.now() - lastResendTime;
      const MIN_RESEND_INTERVAL = 60000; // 1 minute

      if (timeSinceLastResend < MIN_RESEND_INTERVAL) {
        const waitTime = Math.ceil(
          (MIN_RESEND_INTERVAL - timeSinceLastResend) / 1000,
        );
        throw new AppError(
          `Please wait ${waitTime} seconds before requesting another OTP.`,
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(
        `Resending OTP for identity ${identityId} (attempt ${resendCount + 1
        }/${MAX_RESEND_ATTEMPTS})`,
      );

      // Re-initiate identity verification
      const saveHavenOTP = await SentryHelper.trackCriticalOperation(
        "savehaven_otp_resend",
        async () =>
          this.saveHavenService.initiateIdentityVerification({
            identityType: validationData.identificationType,
            identityNumber: validationData.identificationValue,
            firstName: validationData.firstname,
            lastName: validationData.lastname,
            middleName: validationData.middlename,
            dateOfBirth: validationData.dateOfBirth,
          }),
        identityId,
      );
      // Update cache with new identityId and increment resend count
      const updatedCacheData = {
        ...validationData,
        saveHavenIdentityId: saveHavenOTP.identityId,
        timestamp: Date.now(),
        lastResendTime: Date.now(),
        otpResendCount: resendCount + 1,
      };

      // Delete old cache entry
      await this.cacheService.delete(cacheKey);

      // Create new cache entry with new identityId
      const newCacheKey = `${CACHE_KEYS.IDENTITY_VALIDATION}:${saveHavenOTP.identityId}`;
      await this.cacheService.set(
        newCacheKey,
        JSON.stringify(updatedCacheData),
        3600,
      );

      logger.info(
        `OTP resent successfully. New identityId: ${saveHavenOTP.identityId}`,
      );

      return {
        success: true,
        message: "OTP has been resent to your registered phone number.",
        identityId: saveHavenOTP.identityId,
      };
    } catch (error: any) {
      SentryHelper.captureBusinessError(
        "OTP_RESEND_FAILED",
        `OTP resend failed for identity: ${identityId}`,
        validationData.userId,
        { identityId, resendCount: validationData.otpResendCount },
      );
      logger.error("Resend OTP error:", {
        error: error.message,
        identityId,
      });

      if (error instanceof AppError) {
        throw error;
      }

      const environment = getEnviroment();
      const finalMessage =
        environment === "production"
          ? "Failed to resend OTP. Please try again."
          : error.message || "OTP resend failed";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }
}