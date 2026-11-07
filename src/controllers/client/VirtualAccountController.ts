import { Request, Response, NextFunction } from "express";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { sendSuccessResponse } from "@/utils/helpers";
import { VirtualAccountService } from "@/services/client/wallet/VirtualAccountService";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { IdentityVerificationService } from "@/services/client/core/IdentityVerificationService";

import { Provider } from "@/models/reference/Provider";
import { User } from "@/models/core/User";

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    [key: string]: any;
  };
  serviceProvider?: any;
}

import { ProviderService } from "@/services/client/ProviderService";

export class VirtualAccountController {
  private identityVerificationService: IdentityVerificationService;
  private virtualAccountService: VirtualAccountService;
  private providerService: ProviderService;

  constructor() {
    this.identityVerificationService =
      ServiceContainer.getIdentityVerificationService();
    this.virtualAccountService = ServiceContainer.getVirtualAccountService();
    this.providerService = ServiceContainer.getProviderService();
  }

  initiateVirtualAccountGeneration = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const {
        identificationType,
        value,
        firstname,
        lastname,
        middlename,
        dateOfBirth,
        phoneNumber,
        selfieImageBase64,
        address,
        state,
        city,
        postalCode,
      } = req.body;

      // Validate identificationType
      const normalizedType = identificationType.toLowerCase();

      const user = await User.findById(userId).lean();

      // Determine active provider for virtual account generation:
      // 1. From user override (user.preferredProvider)
      // 2. From resolveServiceProvider middleware (req.serviceProvider)
      // 3. Active provider from ProviderService for TRANSACTION_TYPES.VIRTUAL_ACCOUNT
      // 4. Fallback to process.env.SUBACCOUNT_PROVIDER || "savehaven"
      let providerCode = req.serviceProvider?.code;

      if (user?.preferredProvider) {
        providerCode = user.preferredProvider;
      } else if (!providerCode) {
        try {
          const activeProviders =
            await this.providerService.getProvidersByServiceTypeCode(
              TRANSACTION_TYPES.VIRTUAL_ACCOUNT,
            );
          if (activeProviders && activeProviders.length > 0) {
            providerCode = activeProviders[0].code;
          }
        } catch (err) {
          logger.warn(
            "Could not fetch active virtual account provider from DB, falling back to default",
          );
        }
      }

      const finalProvider = (
        providerCode ||
        process.env.SUBACCOUNT_PROVIDER ||
        "savehaven"
      ).toLowerCase();

      logger.info(
        `[Step 1] Initiating validation for user ${userId}, type: ${normalizedType}, provider: ${finalProvider}`,
      );

      // Validate and send to SaveHaven for OTP (or create Xixapay account if xixapay)
      const result = await this.identityVerificationService.validateIdentity(
        userId,
        {
          identificationType: normalizedType as "bvn" | "nin",
          value,
          firstname,
          lastname,
          middlename,
          dateOfBirth,
          phoneNumber,
          selfieImageBase64,
          address,
          state,
          city,
          postalCode,
        },
        finalProvider,
      );

      logger.info(
        `[Step 1] Validation initiated successfully for user ${userId}`,
      );

      return sendSuccessResponse(
        res,
        {
          isOtpRequired: result.isOtpRequired,
          identityId: result.identityId,
          step: result.step,
          ...(result.isOtpRequired
            ? {
                expiresIn: 3600,
                nextStep: "Verify the OTP sent to your phone to continue",
              }
            : {
                verified: result.data?.verified,
                account: result.data?.account,
              }),
        },
        result.message,
      );
    } catch (error) {
      logger.error("[Step 1] Validation initiation failed:", error);
      next(error);
    }
  };

  resendOTPWithStoredValidation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      logger.info(
        `[Recovery] User ${userId} requesting OTP with stored validation`,
      );

      const result =
        await this.identityVerificationService.resendOTPWithStoredValidation(
          userId,
        );

      logger.info(
        `[Recovery] OTP resent successfully for user ${userId}. identityId: ${result.identityId}`,
      );

      return sendSuccessResponse(
        res,
        {
          identityId: result.identityId,
          step: "otp_sent",
          expiresIn: 3600,
          nextStep: result.nextStep,
        },
        result.message,
      );
    } catch (error) {
      logger.error(
        "[Recovery] OTP resend with stored validation failed:",
        error,
      );
      next(error);
    }
  };

  verifyOTPAndCreateAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const {
        identityId,
        otp,
        type = "permanent",
        identificationType,
      } = req.body;

      logger.info(
        `[Step 2] Validating OTP for user ${userId}, identityId: ${identityId}`,
      );

      // Validate OTP
      const validation = await this.identityVerificationService.validateOtp(
        identityId.trim(),
        identificationType,
        otp,
      );

      if (!validation.success) {
        throw new AppError(
          validation.message || "OTP validation failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Creating virtual account for user ${userId}`);

      // Create virtual account using validated identityId
      const virtualAccount =
        await this.virtualAccountService.createVirtualAccount({
          userId,
          type,
          provider: "saveHaven",
          identificationType: "bvn",
          identityId: identityId.trim(),
        });

      logger.info(`Virtual account created successfully for user ${userId}`);

      return sendSuccessResponse(
        res,
        {
          verified: true,
          account: virtualAccount,
        },
        "Identity verified and virtual account created successfully!",
      );
    } catch (error) {
      logger.error(
        "[Step 2/3] OTP verification or account creation failed:",
        error,
      );
      next(error);
    }
  };

  // Xixapay permanent account creation — single-pass, no OTP step.
  // Unlike verifyOTPAndCreateAccount (SaveHaven), this does not require a
  // prior /accounts/initiate + OTP verification round trip, because
  // Xixapay's KYC has no OTP step at all.
  createXixapayAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { identificationType, address, state, city, postalCode } = req.body;

      logger.info(`[Xixapay] Creating permanent account for user ${userId}`);

      const virtualAccount =
        await this.virtualAccountService.createXixapayVirtualAccount({
          userId,
          identificationType: identificationType.toLowerCase(),
          address,
          state,
          city,
          postalCode,
        });

      logger.info(
        `[Xixapay] Permanent account created successfully for user ${userId}`,
      );

      return sendSuccessResponse(
        res,
        { account: virtualAccount },
        "Xixapay virtual account created successfully!",
      );
    } catch (error) {
      logger.error("[Xixapay] Account creation failed:", error);
      next(error);
    }
  };

  // Get user's primary virtual account
  getUserVirtualAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const user = await User.findById(userId).lean();

      // Get user's permanent virtual accounts
      const userAccounts =
        await this.virtualAccountService.getUserPermanentAccounts(userId);

      if (!userAccounts || userAccounts.length === 0) {
        return sendSuccessResponse(
          res,
          { hasAccount: false },
          "No virtual account found. Please create one.",
        );
      }

      if (user?.preferredProvider) {
        const preferredProviderCode = user.preferredProvider.toLowerCase();
        const preferredAccount = userAccounts.find((acc) => {
          if (!acc.provider) return false;
          const p = acc.provider.toLowerCase();
          if (p === preferredProviderCode) return true;
          if (
            (p === "savehaven" || p === "safehaven") &&
            (preferredProviderCode === "savehaven" || preferredProviderCode === "safehaven")
          ) {
            return true;
          }
          return false;
        });

        if (preferredAccount) {
          return sendSuccessResponse(
            res,
            {
              hasAccount: true,
              account: {
                accountNumber: preferredAccount.accountNumber,
                accountName: preferredAccount.accountName,
                bankName: preferredAccount.bankName,
                provider: preferredAccount.provider,
                createdAt: preferredAccount.createdAt,
              },
            },
            "Virtual account retrieved successfully",
          );
        } else {
          return sendSuccessResponse(
            res,
            { hasAccount: false },
            "No virtual account found. Please create one.",
          );
        }
      }

      // Check provider global active status
      const [safeHavenProvider, xixapayProvider] = await Promise.all([
        Provider.findOne({
          code: { $regex: /^savehaven$/i },
          deletedAt: null,
        }).lean(),
        Provider.findOne({
          code: { $regex: /^xixapay$/i },
          deletedAt: null,
        }).lean(),
      ]);

      const isSafeHavenActive = Boolean(safeHavenProvider?.isActive);
      const isXixapayActive = Boolean(xixapayProvider?.isActive);

      const safeHavenAccount = userAccounts.find(
        (acc) => acc.provider && /^savehaven$/i.test(acc.provider),
      );
      const xixapayAccount = userAccounts.find(
        (acc) => acc.provider && /^xixapay$/i.test(acc.provider),
      );

      let selectedAccount: any = null;

      if (safeHavenAccount && xixapayAccount) {
        // If user has both: prioritize SafeHaven first; only return Xixapay if SafeHaven is off
        if (isSafeHavenActive) {
          selectedAccount = safeHavenAccount;
        } else if (isXixapayActive) {
          selectedAccount = xixapayAccount;
        }
      } else if (safeHavenAccount) {
        // If user has only SafeHaven: return SafeHaven unless it is off completely
        if (isSafeHavenActive) {
          selectedAccount = safeHavenAccount;
        }
      } else if (xixapayAccount) {
        // If user has only Xixapay: return Xixapay irrespective of which provider was toggled on last,
        // unless Xixapay is off completely
        if (isXixapayActive) {
          selectedAccount = xixapayAccount;
        }
      } else {
        // Any other existing provider account (e.g. monnify)
        selectedAccount = userAccounts[0];
      }

      if (!selectedAccount) {
        return sendSuccessResponse(
          res,
          { hasAccount: false },
          "No virtual account found. Please create one.",
        );
      }

      return sendSuccessResponse(
        res,
        {
          hasAccount: true,
          account: {
            accountNumber: selectedAccount.accountNumber,
            accountName: selectedAccount.accountName,
            bankName: selectedAccount.bankName,
            provider: selectedAccount.provider,
            createdAt: selectedAccount.createdAt,
          },
        },
        "Virtual account retrieved successfully",
      );
    } catch (error) {
      logger.error("Error retrieving virtual account:", error);
      next(error);
    }
  };

  // Get validation status (check if OTP session is still valid)
  getValidationStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { identityId } = req.params;

      if (!identityId || !identityId.trim()) {
        throw new AppError(
          "identityId is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const status = await this.identityVerificationService.getValidationStatus(
        identityId.trim(),
      );

      return sendSuccessResponse(
        res,
        status,
        status.exists
          ? "Validation status retrieved successfully"
          : "Validation session not found",
      );
    } catch (error) {
      logger.error("Error retrieving validation status:", error);
      next(error);
    }
  };

  resendOTP = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { identityId } = req.body;

      if (!identityId || !identityId.trim()) {
        throw new AppError(
          "identityId is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const result = await this.identityVerificationService.resendOtp(
        identityId.trim(),
      );

      sendSuccessResponse(res, result, "Otp Resent Successfully");
    } catch (error) {
      logger.error("Error resending OTP:", error);
      next(error);
    }
  };
}
