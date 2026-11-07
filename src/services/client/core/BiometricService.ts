import crypto from "crypto";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { UserRepository } from "@/repositories/client/UserRepository";
import { IUser, IBiometricToken } from "@/models/core/User";
import { getEnviroment } from "@/utils/helpers";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

type BiometricType = "login" | "transaction";

const MAX_BIOMETRIC_DEVICES = 5;

export class BiometricService {
  private userRepository: UserRepository;
  private readonly BIOMETRIC_SALT =
    process.env.BIOMETRIC_SECRET_SALT ||
    "your-secret-salt-here-change-in-production";

  constructor() {
    this.userRepository = new UserRepository();
  }

  // Private Helpers
  private generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  private hashToken(frontendToken: string): string {
    return crypto
      .createHmac("sha256", this.BIOMETRIC_SALT)
      .update(frontendToken)
      .digest("hex");
  }

  private getFields(type: BiometricType): {
    tokensField: "loginBiometricTokens" | "transactionBiometricTokens";
    enabledField: "loginBiometricEnabled" | "transactionBiometricEnabled";
    label: string;
  } {
    if (type === "login") {
      return {
        tokensField: "loginBiometricTokens",
        enabledField: "loginBiometricEnabled",
        label: "Login",
      };
    }
    return {
      tokensField: "transactionBiometricTokens",
      enabledField: "transactionBiometricEnabled",
      label: "Transaction",
    };
  }

  // Generic Setup
  private async setup(
    userId: string,
    type: BiometricType,
  ): Promise<{ frontendToken: string; userData: IUser; message: string }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      const { tokensField, enabledField, label } = this.getFields(type);

      let tokens: IBiometricToken[] = user[tokensField] || [];

      // If there's already a valid stored token (has frontendToken), return it — no new entry
      const existingToken = tokens
        .slice()
        .reverse()
        .find((t) => t.frontendToken);

      if (existingToken) {
        logger.info(
          `[${label} Biometric Setup] User ${userId} already has a ${type} biometric token. Returning existing.`,
        );
        return {
          frontendToken: existingToken.frontendToken!,
          userData: user,
          message: `Store this token securely on your device. You will need it for ${type} biometric authentication.`,
        };
      }

      // No existing token with frontendToken — generate new one
      const frontendToken = this.generateToken();
      const tokenHash = this.hashToken(frontendToken);

      // If at max capacity, remove oldest entry first
      if (tokens.length >= MAX_BIOMETRIC_DEVICES) {
        tokens = tokens
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
          .slice(1);
      }

      tokens.push({
        tokenHash,
        frontendToken,
        createdAt: new Date(),
      });

      await this.userRepository.update(userId, {
        [tokensField]: tokens,
        [enabledField]: true,
      });

      logger.info(
        `[${label} Biometric Setup] User ${userId} setup ${type} biometric authentication. Total devices: ${tokens.length}`,
      );

      return {
        frontendToken,
        userData: user,
        message: `Store this token securely on your device. You will need it for ${type} biometric authentication.`,
      };
    } catch (error) {
      logger.error(`[${type} Biometric Setup Error] ${error}`);
      throw error;
    }
  }

  // Generic Verify
  private async verify(
    userId: string,
    frontendToken: string,
    type: BiometricType,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      const { tokensField, enabledField, label } = this.getFields(type);

      // frontend handle this check
      // if (!user[enabledField]) {
      //   throw new AppError(
      //     `${label} biometric authentication not enabled. Please setup ${type} biometric first.`,
      //     401,
      //   );
      // }

      const tokens: IBiometricToken[] = user[tokensField] || [];

      if (tokens.length === 0) {
        const environment = getEnviroment();
        const detailedMessage = `${label} biometric authentication not setup. Please setup ${type} biometric first.`;
        const finalMessage =
          environment === "production"
            ? "Biometric authentication not setup. Please try again."
            : detailedMessage;

        throw new AppError(finalMessage, 401);
      }

      // Hash the incoming token and check if it matches any stored token
      const incomingHash = this.hashToken(frontendToken);
      const isValid = tokens.some((t) =>
        crypto.timingSafeEqual(
          Buffer.from(t.tokenHash, "hex"),
          Buffer.from(incomingHash, "hex"),
        ),
      );

      if (!isValid) {
        const environment = getEnviroment();
        const detailedMessage = `${label} biometric verification failed. Please try again or setup biometric again.`;
        const finalMessage =
          environment === "production"
            ? "Biometric verification failed. Please try again."
            : detailedMessage;

        logger.warn(
          `[${label} Biometric Failed] User ${userId} - Token verification failed`,
        );

        // Capture biometric verification failure
        SentryHelper.captureBusinessError(
          "BIOMETRIC_VERIFICATION_FAILED",
          `${label} biometric verification failed for user`,
          userId,
          {
            biometricType: type,
            event: `biometric_failure_${type}`,
          },
        );

        throw new AppError(finalMessage, 401);
      }

      logger.info(`[${label} Biometric Verified] User ${userId} authenticated`);

      return {
        success: true,
        message: `${label} biometric authentication successful`,
      };
    } catch (error) {
      logger.error(`[${type} Biometric Verification Error] ${error}`);

      // Capture unexpected errors in biometric verification
      if (error instanceof AppError) {
        throw error; // Re-throw AppError without double-capturing (already captured above for verification failures)
      }

      SentryHelper.captureBusinessError(
        "BIOMETRIC_SERVICE_ERROR",
        `Unexpected error in ${type} biometric verification`,
        userId,
        {
          biometricType: type,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      );

      throw error;
    }
  }

  // Generic Disable (clears all devices)
  private async disable(
    userId: string,
    type: BiometricType,
  ): Promise<{ success: boolean }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      const { tokensField, enabledField, label } = this.getFields(type);

      await this.userRepository.update(userId, {
        [tokensField]: [],
        [enabledField]: false,
      });

      logger.info(
        `[${label} Biometric Disabled] User ${userId} - All devices cleared`,
      );

      return { success: true };
    } catch (error) {
      logger.error(`[${type} Biometric Disable Error] ${error}`);
      throw error;
    }
  }

  // Generic Status
  private async getStatus(
    userId: string,
    type: BiometricType,
  ): Promise<{ isEnabled: boolean; deviceCount: number }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      return { isEnabled: false, deviceCount: 0 };
    }

    const { tokensField, enabledField } = this.getFields(type);

    return {
      isEnabled: user[enabledField] || false,
      deviceCount: (user[tokensField] || []).length,
    };
  }

  // Public: Login Biometric
  async setupLoginBiometric(userId: string) {
    return this.setup(userId, "login");
  }

  async verifyLoginBiometric(userId: string, frontendToken: string) {
    return this.verify(userId, frontendToken, "login");
  }

  async disableLoginBiometric(userId: string) {
    return this.disable(userId, "login");
  }

  async getLoginBiometricStatus(userId: string) {
    return this.getStatus(userId, "login");
  }

  // Public: Transaction Biometric
  async setupTransactionBiometric(userId: string) {
    return this.setup(userId, "transaction");
  }

  async verifyTransactionBiometric(userId: string, frontendToken: string) {
    return this.verify(userId, frontendToken, "transaction");
  }

  async disableTransactionBiometric(userId: string) {
    return this.disable(userId, "transaction");
  }

  async getTransactionBiometricStatus(userId: string) {
    return this.getStatus(userId, "transaction");
  }

  // ─── Legacy Methods (kept for backward compat, do not remove) ────────────

  async setupBiometric(userId: string): Promise<{
    frontendToken: string;
    userData: IUser;
    message: string;
  }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      let tokens: IBiometricToken[] = user.loginBiometricTokens || [];

      // If there's already a valid stored token (has frontendToken), return it — no new entry
      const existingToken = tokens
        .slice()
        .reverse()
        .find((t) => t.frontendToken);

      if (existingToken) {
        logger.info(
          `[Biometric Setup] User ${userId} already has a biometric token. Returning existing.`,
        );
        return {
          frontendToken: existingToken.frontendToken!,
          userData: user,
          message:
            "Store this token securely on your device. You will need it for biometric authentication.",
        };
      }

      // No existing token with frontendToken — generate new one
      const frontendToken = this.generateToken();
      const tokenHash = this.hashToken(frontendToken);

      if (tokens.length >= MAX_BIOMETRIC_DEVICES) {
        tokens = tokens
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
          .slice(1);
      }

      tokens.push({ tokenHash, frontendToken, createdAt: new Date() });

      await this.userRepository.update(userId, {
        loginBiometricTokens: tokens,
        biometricEnabled: true,
      });

      logger.info(
        `[Biometric Setup] User ${userId} setup biometric authentication`,
      );

      return {
        frontendToken,
        userData: user,
        message:
          "Store this token securely on your device. You will need it for biometric authentication.",
      };
    } catch (error) {
      logger.error(`[Biometric Setup Error] ${error}`);
      throw error;
    }
  }

  async verifyBiometric(
    userId: string,
    frontendToken: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (!user.biometricEnabled) {
        const environment = getEnviroment();
        const detailedMessage =
          "Biometric authentication not enabled. Please setup biometric first.";
        const finalMessage =
          environment === "production"
            ? "Biometric not setup. Please try again."
            : detailedMessage;

        throw new AppError(finalMessage, 401);
      }

      const tokens: IBiometricToken[] = user.loginBiometricTokens || [];

      if (tokens.length === 0) {
        const environment = getEnviroment();
        const detailedMessage =
          "Biometric authentication not setup. Please setup biometric first.";
        const finalMessage =
          environment === "production"
            ? "Biometric not setup. Please try again."
            : detailedMessage;

        throw new AppError(finalMessage, 401);
      }

      const incomingHash = this.hashToken(frontendToken);
      const isValid = tokens.some((t) =>
        crypto.timingSafeEqual(
          Buffer.from(t.tokenHash, "hex"),
          Buffer.from(incomingHash, "hex"),
        ),
      );

      if (!isValid) {
        const environment = getEnviroment();
        const detailedMessage =
          "Biometric verification failed. Please try again or setup biometric again.";
        const finalMessage =
          environment === "production"
            ? "Biometric verification failed. Please try again."
            : detailedMessage;

        logger.warn(
          `[Biometric Failed] User ${userId} - Token verification failed`,
        );

        SentryHelper.captureBusinessError(
          "BIOMETRIC_VERIFICATION_FAILED",
          "Biometric verification failed for user (legacy)",
          userId,
          {
            event: "biometric_failure_legacy",
          },
        );

        throw new AppError(finalMessage, 401);
      }

      logger.info(`[Biometric Verified] User ${userId} authenticated`);

      return {
        success: true,
        message: "Biometric authentication successful",
      };
    } catch (error) {
      logger.error(`[Biometric Verification Error] ${error}`);

      // Capture unexpected errors in legacy biometric verification
      if (error instanceof AppError) {
        throw error;
      }

      SentryHelper.captureBusinessError(
        "BIOMETRIC_SERVICE_ERROR",
        "Unexpected error in biometric verification (legacy)",
        userId,
        {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      );

      throw error;
    }
  }

  async disableBiometric(userId: string): Promise<{ success: boolean }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      await this.userRepository.update(userId, {
        loginBiometricTokens: [],
        biometricEnabled: false,
      });

      logger.info(`[Biometric Disabled] User ${userId}`);

      return { success: true };
    } catch (error) {
      logger.error(`[Biometric Disable Error] ${error}`);
      throw error;
    }
  }

  async getBiometricStatus(userId: string): Promise<{ isEnabled: boolean }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      return { isEnabled: false };
    }

    return { isEnabled: user.biometricEnabled || false };
  }

  async resetBiometric(userId: string): Promise<{ success: boolean }> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      await this.userRepository.update(userId, {
        loginBiometricTokens: [],
        biometricEnabled: false,
      });

      logger.info(`[Biometric Reset] User ${userId} - Biometric cleared`);

      return { success: true };
    } catch (error) {
      logger.error(`[Biometric Reset Error] ${error}`);
      throw error;
    }
  }
}
