import admin from "firebase-admin";
import { UserRepository } from "@/repositories/client/UserRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { generateAccessToken, generateRefreshToken } from "@/config/jwt";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { IUserResponse } from "@/models/core/User";
import { Types } from "mongoose";
import logger from "@/logger";
import { hashPassword } from "@/utils/cryptography";
import { generateRefCode } from "@/utils/helpers";
import { CacheService } from "../../core/CacheService";
import { EmailService } from "@/services/core/EmailService";

export interface GoogleSignInDTO {
  googleIdToken: string;
  fcmToken?: string;
}

export interface AppleSignInDTO {
  appleIdentityToken: string;
  appleRefreshToken?: string;
  appleAuthCode?: string;
  fcmToken?: string;
  profile?: {
    firstname?: string;
    lastname?: string;
  };
}

export interface SocialAuthResponseDTO {
  user: IUserResponse | null;
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
}

export class SocialAuthService {
  constructor(
    private userRepository: UserRepository,
    private walletRepository: WalletRepository,
    private cacheService: CacheService,
    private emailService: EmailService,
  ) {}

  // Handle Google Sign-In/Sign-Up
  // Verifies Google ID token and creates/retrieves user
  async googleSignIn(data: GoogleSignInDTO): Promise<SocialAuthResponseDTO> {
    try {
      // Verify Google ID token
      const decodedToken = await admin.auth().verifyIdToken(data.googleIdToken);

      const { email, name, picture, uid } = decodedToken;

      if (!email) {
        throw new AppError(
          "Email not provided by Google",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check if user exists
      let user = await this.userRepository.findByEmail(email);
      let isNewUser = false;

      if (!user) {
        // Create new user from Google data
        isNewUser = true;
        const [firstname, lastname] = this.parseGoogleName(name || "");

        // Generate unique refCode
        let refCode = generateRefCode();
        while (await this.userRepository.findByRefCode(refCode)) {
          refCode = generateRefCode();
        }

        // Create a placeholder hashed password
        const placeholderPassword = await hashPassword(
          `social_${uid}_${Date.now()}`,
        );

        user = await this.userRepository.create({
          firstname,
          lastname,
          email: email.toLowerCase(),
          password: placeholderPassword,
          avatar: picture,
          refCode,
          emailVerifiedAt: new Date(),
          authType: "social",
          status: "active",
        });

        // Create main wallet
        await this.walletRepository.create({
          userId: user._id as Types.ObjectId,
          type: "main",
          balance: 0,
        });

        logger.info(`New user created via Google Sign-In: ${user.id}`);
      } else {
        // Update existing user's auth type if needed
        if (user.authType !== "social") {
          await this.userRepository.update(user.id, {
            authType: "social",
          });
        }

        // Update avatar if not present
        if (!user.avatar && picture) {
          await this.userRepository.update(user.id, {
            avatar: picture,
          });
        }
      }

      // Check account status
      if (user.status === "suspended") {
        throw new AppError(
          "Account is suspended",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.ACCOUNT_SUSPENDED,
        );
      }

      // Update FCM token (one token per user) and lastLoginAt
      const now = new Date();
      user.lastLoginAt = now;
      const updateFields: Record<string, any> = { lastLoginAt: now };
      if (data.fcmToken) {
        user.fcmTokens = [data.fcmToken];
        updateFields.fcmTokens = [data.fcmToken];
      }

      await this.userRepository.update(user.id.toString(), {
        $set: updateFields,
      });

      // this.emailService
      //   .sendLoginSecurityEmail(user.email, user.firstname)
      //   .catch((err) =>
      //     logger.error("Failed to send login security email:", err),
      //   );

      // Generate tokens
      const accessToken = generateAccessToken({
        id: user.id.toString(),
        email: user.email,
      });
      const refreshToken = generateRefreshToken({
        id: user.id.toString(),
        email: user.email,
      });

      const formattedUser = await this.formatUserDetails(user);

      // Cache user data
      if (formattedUser) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(user.id.toString()),
          formattedUser,
        );
      }

      return {
        user: formattedUser,
        accessToken,
        refreshToken,
        isNewUser,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error("Google Sign-In error:", error);
      throw new AppError(
        "Invalid or expired Google token",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }
  }

  // Handle Apple Sign-In/Sign-Up
  // Verifies Apple identity token and creates/retrieves user

  async appleSignIn(data: AppleSignInDTO): Promise<SocialAuthResponseDTO> {
    try {
      logger.info("Apple sign-in attempt");

      // 1. Firebase Verification
      let decodedToken: admin.auth.DecodedIdToken;
      try {
        decodedToken = await admin
          .auth()
          .verifyIdToken(data.appleIdentityToken);
      } catch (firebaseError: any) {
        logger.error("Firebase verification failed for Apple sign-in:", {
          code: firebaseError.code,
          message: firebaseError.message,
        });
        throw new AppError(
          "Apple token verification failed",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_TOKEN,
        );
      }

      const { email, uid } = decodedToken;

      if (!email) {
        throw new AppError(
          "Email not provided by Apple",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check if a deleted user exists for this email
      const deletedUser = await this.userRepository.findOne({
        email: email.toLowerCase(),
        deletedAt: { $exists: true, $ne: null },
      });
      if (deletedUser) {
        throw new AppError(
          "This account has been deleted",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.ACCOUNT_DELETED,
        );
      }

      // Check if user exists
      let user = await this.userRepository.findByEmail(email.toLowerCase());
      let isNewUser = false;

      if (!user) {
        isNewUser = true;

        // Fallback hierarchy: DTO explicitly sent names -> Apple metadata -> Email split
        const firstname =
          data.profile?.firstname || decodedToken.name || email.split("@")[0];
        const lastname = data.profile?.lastname || "User";

        let refCode = generateRefCode();
        while (await this.userRepository.findByRefCode(refCode)) {
          refCode = generateRefCode();
        }

        const placeholderPassword = await hashPassword(
          `social_${uid}_${Date.now()}`,
        );

        user = await this.userRepository.create({
          firstname,
          lastname,
          email: email.toLowerCase(),
          password: placeholderPassword,
          refCode,
          emailVerifiedAt: new Date(),
          authType: "social",
          status: "active",
        });

        // Create main wallet
        await this.walletRepository.create({
          userId: user._id as Types.ObjectId,
          type: "main",
          balance: 0,
        });

        logger.info(`New user created via Apple Sign-In: ${user.id}`);
      } else {
        if (user.authType !== "social") {
          await this.userRepository.update(user.id, {
            authType: "social",
          });
        }
      }

      // Check account status
      if (user.status === "suspended") {
        throw new AppError(
          "Account is suspended",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.ACCOUNT_SUSPENDED,
        );
      }

      // Update FCM token (one token per user) and lastLoginAt
      const now = new Date();
      user.lastLoginAt = now;
      const updateFields: Record<string, any> = { lastLoginAt: now };
      if (data.fcmToken) {
        user.fcmTokens = [data.fcmToken];
        updateFields.fcmTokens = [data.fcmToken];
      }

      await this.userRepository.update(user.id.toString(), {
        $set: updateFields,
      });

      // this.emailService
      //   .sendLoginSecurityEmail(user.email, user.firstname)
      //   .catch((err) =>
      //     logger.error("Failed to send login security email:", err),
      //   );

      // Generate tokens
      const accessToken = generateAccessToken({
        id: user.id.toString(),
        email: user.email,
      });
      const refreshToken = generateRefreshToken({
        id: user.id.toString(),
        email: user.email,
      });

      const formattedUser = await this.formatUserDetails(user);

      // Cache user data
      if (formattedUser) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(user.id.toString()),
          formattedUser,
        );
      }

      logger.info(`Apple sign-in successful: ${user.id}`);

      return {
        user: formattedUser,
        accessToken,
        refreshToken,
        isNewUser,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error("Apple Sign-In error:", error);
      throw new AppError(
        "Invalid or expired Apple token",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }
  }

  // Link existing password user to Google account
  // For users who already have password auth

  async linkGoogleAccount(
    userId: string,
    googleIdToken: string,
  ): Promise<void> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(googleIdToken);
      const { email } = decodedToken;
      if (!email) {
        throw new AppError(
          "Email not provided by Google",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Check if this Google email is already in use
      const existingUser = await this.userRepository.findByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        throw new AppError(
          "This Google account is already linked to another user",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }

      // Update user's auth type
      await this.userRepository.update(userId, {
        authType: "social",
      });

      logger.info(`Google account linked to user: ${userId}`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "Failed to link Google account",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Link existing password user to Apple account

  async linkAppleAccount(
    userId: string,
    appleIdentityToken: string,
  ): Promise<void> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(appleIdentityToken);
      const { email } = decodedToken;

      if (!email) {
        throw new AppError(
          "Email not provided by Apple",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Check if this Apple email is already in use
      const existingUser = await this.userRepository.findByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        throw new AppError(
          "This Apple account is already linked to another user",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }

      // Update user's auth type
      await this.userRepository.update(userId, {
        authType: "social",
      });

      logger.info(`Apple account linked to user: ${userId}`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "Failed to link Apple account",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  private parseGoogleName(fullName: string): [string, string] {
    const parts = fullName.trim().split(" ");
    const firstname = parts[0] || "User";
    const lastname = parts.slice(1).join(" ") || "Account";
    return [firstname, lastname];
  }

  private async formatUserDetails(user: any): Promise<IUserResponse | null> {
    if (!user) return null;

    return {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone || null,
      phoneCode: user.phoneCode || null,
      username: user.username || null,
      gender: user.gender || null,
      refCode: user.refCode || null,
      referredBy: user.referredBy || null,
      avatar: user.avatar || null,
      country: user.country || null,
      state: user.state || null,
      status: user.status,
      authType: user.authType,
      fcmTokens: user.fcmTokens,
      virtualAccount: user.virtualAccount || null,
      dateOfBirth: user.dateOfBirth || null,
      bvnVerified: user.bvnVerified,
      bvnValidated: user.bvnValidated,
      loginBiometricEnabled: user.loginBiometricEnabled || false,
      transactionBiometricEnabled: user.transactionBiometricEnabled || false,
      twofactorEnabled: user.twofactorEnabled || false,
      emailVerifiedAt: user.emailVerifiedAt || null,
      phoneVerifiedAt: user.phoneVerifiedAt || null,
      pinActivatedAt: user.pinActivatedAt || null,
      twoFactorEnabledAt: user.twoFactorEnabledAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      appVersion: user.appVersion || null,
    };
  }
}
