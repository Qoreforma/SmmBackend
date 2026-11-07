import { UserRepository } from "@/repositories/client/UserRepository";
import { EmailService } from "../../core/EmailService";
import { SMSService } from "../../core/SMSService";
import { hashPassword, comparePassword } from "@/utils/cryptography";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "@/config/jwt";
import { formatPhoneNumber, generateRefCode } from "@/utils/helpers";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/utils/constants";
import { IUser, IUserResponse, User } from "@/models/core/User";
import { Types } from "mongoose";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { CacheService } from "../../core/CacheService";
import { OTPService } from "../../core/OTPService";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import logger from "@/logger";
import {
  recordFailedLoginAttempt,
  recordFailedLoginAttemptByIp,
  recordSuccessfulLogin,
  recordSuccessfulLoginByIp,
} from "@/middlewares/shared/rateLimiter";
import { BiometricService } from "./BiometricService";
import { StateRepository } from "@/repositories/shared/StateRepository";
import { CountryRepository } from "@/repositories/shared/CountryRepository";

export interface RegisterDTO {
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  phone?: string;
  phoneCode?: string;
  username?: string;
  referralCode?: string;
  gender?: "male" | "female" | "other";
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  fcmToken?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
  rememberMe?: boolean;
  fcmToken?: string;
  biometricToken?: string;
  isAppTokensNeed?: boolean;
  device?: string;
  location?: string;
  version?: string;
  appVersion?: string;
}

export interface ForgotPasswordDTO {
  email: string;
}

export interface ResetPasswordDTO {
  otp: string;
  password: string;
  gmail: string;
}

export interface ChangePasswordDTO {
  userId: string;
  oldPassword: string;
  newPassword: string;
}

export interface VerifyPhoneDTO {
  userId: string;
  phone: number;
  phoneCode: string;
  otp: string;
}

export interface SendPhoneVerificationDTO {
  userId: string;
  phoneCode: string;
  phone: string;
}

export interface UpdatePinDTO {
  userId: string;
  pin: string;
  password: string;
}

export interface VerifyPinDTO {
  userId: string;
  pin: string;
}

export interface ChangePinDTO {
  userId: string;
  oldPin: string;
  newPin: string;
}

export interface Toggle2FADTO {
  userId: string;
  enable: boolean;
}

export interface Verify2FADTO {
  email: string;
  otp: string;
}

export interface SetPinDTO {
  pin: string;
  userId: string;
}

export interface AuthResponseDTO {
  user: IUserResponse | null;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private otpService: OTPService,
    private emailService: EmailService,
    private smsService: SMSService,
    private userRepository: UserRepository,
    private walletRepository: WalletRepository,
    private cacheService: CacheService,
    private referralRepository: ReferralRepository,
    private biometricService: BiometricService,
    private stateRepository: StateRepository,
    private countryRepository: CountryRepository,
  ) {}

  async register(data: RegisterDTO): Promise<any> {
    const existingUser = await this.userRepository.findByEmail(data.email);

    if (existingUser) {
      if (!existingUser.deletedAt || existingUser.status === "active") {
        throw new AppError(
          "Email already exists",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }
    }
    // Check if username exists already
    if (data.username) {
      const existingUsername = await this.userRepository.findByUsername(
        data.username,
      );
      if (existingUsername) {
        throw new AppError(
          "Username already exists",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }
    }

    // Validate referral code if provided
    let referrerId: Types.ObjectId | undefined = undefined;
    if (data.referralCode) {
      const referrer = await this.userRepository.findByRefCode(
        data.referralCode,
      );
      if (referrer) {
        referrerId = referrer._id as Types.ObjectId;
      } else {
        throw new AppError(
          "Invalid referral code",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INVALID_REFERRAL_CODE,
        );
      }
    }
    let countryName = data.country;
    if (data.country && !isNaN(Number(data.country))) {
      // It's an ID, fetch the country name
      const country = await this.countryRepository.findByNumericId(
        Number(data.country),
      );
      countryName = country?.name || data.country;
    }

    let stateName = data.state;
    if (data.state && !isNaN(Number(data.state))) {
      // It's an ID, fetch the state name
      const state = await this.stateRepository.findByNumericId(
        Number(data.state),
      );
      stateName = state?.name || data.state;
    }
    // Hash password
    const hashedPassword = await hashPassword(data.password);

    // Generate unique refCode
    let refCode = data.username;

    // Create user
    const user = await this.userRepository.create({
      ...data,
      country: countryName,
      state: stateName,
      password: hashedPassword,
      refCode,
      referredBy: referrerId,
      fcmTokens: data.fcmToken ? [data.fcmToken] : [],
    });

    if (referrerId) {
      const referrer = await this.userRepository.findById(
        referrerId!.toString(),
      );
      if (!referrer) {
        logger.info("there is an issue with the register referral logic");
        return;
      }
      await this.referralRepository.findOrCreateReferral(
        referrerId,
        user.id,
        referrer.userType,
      );

    }

    // Create main wallet
    await this.walletRepository.create({
      userId: user._id as Types.ObjectId,
      type: "main",
      balance: 0,
    });

    // Send email verification OTP automatically
    const otp = await this.otpService.generateAndStore(
      user.id.toString(),
      "email_verification",
    );
    await this.emailService.sendVerificationEmail(
      user.email,
      otp,
      user.firstname,
    );

    return {
      message:
        "Registration successful. Please check your email for verification code.",
    };
  }

  async login(
    data: LoginDTO,
    loginIdentifier: string,
    ipIdentifier: string,
    ipAddress?: string,
  ): Promise<any> {
    // Find user
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      throw new AppError(
        "Invalid credentials",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // Check account status first
    if (["suspended", "fraudulent"].includes(user.status)) {
      throw new AppError(
        "Account is suspended",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_SUSPENDED,
      );
    }

    if (user.status === "inactive") {
      throw new AppError(
        "Account is inactive",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.ACCOUNT_INACTIVE,
      );
    }

    // BIOMETRIC LOGIN
    if (data.biometricToken) {
      const isBiometricValid = await this.biometricService.verifyLoginBiometric(
        user.id.toString(),
        data.biometricToken,
      );

      if (!isBiometricValid.success) {
        recordFailedLoginAttempt(loginIdentifier).catch((err) =>
          logger.error("Failed to record login attempt:", err),
        );
        throw new AppError(
          "Biometric verification failed",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_CREDENTIALS,
        );
      }
    }
    // PASSWORD LOGIN
    else {
      const isPasswordValid = await comparePassword(
        data.password,
        user.password,
      );

      if (!isPasswordValid) {
        recordFailedLoginAttempt(loginIdentifier).catch((err) =>
          logger.error("Failed to record login attempt:", err),
        );
        if (ipIdentifier) {
          recordFailedLoginAttemptByIp(ipIdentifier).catch((err) =>
            logger.error("Failed to record IP attempt:", err),
          );
        }
        throw new AppError(
          "Invalid credentials",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.INVALID_CREDENTIALS,
        );
      }
    }

    // Check if email is verified
    if (!user.emailVerifiedAt) {
      await this.resendEmailVerification(user.email);
      throw new AppError(
        "Please verify your email before logging in",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.EMAIL_NOT_VERIFIED,
      );
    }

    const incomingAppVersion = (data.appVersion || data.version)?.trim();
    const isAppVersionChanged = !!(
      incomingAppVersion &&
      incomingAppVersion !== "" &&
      user.appVersion !== incomingAppVersion
    );

    if (
      !data.biometricToken &&
      (user.twoFactorEnabledAt || user.twofactorEnabled)
    ) {
      const twoFaUpdateFields: Record<string, any> = {};
      if (data.fcmToken) {
        user.fcmTokens = [data.fcmToken];
        twoFaUpdateFields.fcmTokens = [data.fcmToken];
      }
      if (isAppVersionChanged) {
        user.appVersion = incomingAppVersion;
        twoFaUpdateFields.appVersion = incomingAppVersion;
      }
      if (Object.keys(twoFaUpdateFields).length > 0) {
        await this.userRepository.update(user.id.toString(), {
          $set: twoFaUpdateFields,
        });
      }

      const otp = await this.otpService.generateAndStore(
        user.id.toString(),
        "2fa",
      );

      await this.emailService.send2FAEmail(user.email, otp, user.firstname);

      // throw new AppError(
      //   "2FA code sent. Please verify to complete login.",
      //   HTTP_STATUS.OK,
      //   ERROR_CODES.TWO_FA_REQUIRED,
      // );

      return {
        twofaSuccess: true,
        message: "2FA code sent. Please verify to complete login.",
        user: await this.formatUserDetails(user),
      };
    }

    const now = new Date();
    user.lastLoginAt = now;
    const updateFields: Record<string, any> = { lastLoginAt: now };
    if (data.fcmToken) {
      user.fcmTokens = [data.fcmToken];
      updateFields.fcmTokens = [data.fcmToken];
    }
    if (isAppVersionChanged) {
      user.appVersion = incomingAppVersion;
      updateFields.appVersion = incomingAppVersion;
    }

    await this.userRepository.update(user.id.toString(), {
      $set: updateFields,
    });

    // Generate tokens
    const accessToken = generateAccessToken({
      id: user.id.toString(),
      email: user.email,
    });
    const refreshToken = generateRefreshToken({
      id: user.id.toString(),
      email: user.email,
      rememberMe: data.rememberMe,
    });

    recordSuccessfulLogin(loginIdentifier).catch((err) =>
      logger.error("Failed to clear rate limit:", err),
    );
    recordSuccessfulLoginByIp(ipIdentifier).catch((err) =>
      logger.error("Failed to clear IP rate limit:", err),
    );

    const formattedUser = await this.formatUserDetails(user);

    // Update cache
    if (formattedUser) {
      await this.cacheService.set(
        CACHE_KEYS.USER_PROFILE(user.id.toString()),
        formattedUser,
      );
    }

    const responsePayload: any = {
      user: formattedUser,
      accessToken,
      refreshToken,
    };

    // const loginMeta = {
    //   ipAddress: ipAddress,
    //   device: data.device,
    //   location: data.location,
    // };

    // this.emailService
    //   .sendLoginSecurityEmail(user.email, user.firstname, loginMeta)
    //   .catch((err) =>
    //     logger.error("Failed to send login security email:", err),
    //   );

    if (data.isAppTokensNeed && formattedUser) {
      const freshUser = await this.userRepository.findById(user.id.toString());
      if (freshUser) {
        const latestLogin =
          [...(freshUser.loginBiometricTokens || [])]
            .reverse()
            .find((t) => t.frontendToken)?.frontendToken ?? null;

        const latestTransaction =
          [...(freshUser.transactionBiometricTokens || [])]
            .reverse()
            .find((t) => t.frontendToken)?.frontendToken ?? null;

        responsePayload.user = {
          ...formattedUser,
          loginBiometricToken: latestLogin,
          transactionBiometricToken: latestTransaction,
        };
      }
    }

    return responsePayload;
  }

  async logout(
    userId: string,
    token: string,
    fcmToken?: string,
  ): Promise<void> {
    // Blacklist the token
    await this.cacheService.set(
      CACHE_KEYS.TOKEN_BLACKLIST(token),
      "true",
      CACHE_TTL.ONE_DAY,
    );

    if (fcmToken) {
      // Multiple device logout - only remove this device's fcmToken
      const user = await this.userRepository.findById(userId);

      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      await this.userRepository.update(userId, {
        $pull: { fcmTokens: fcmToken } as any,
      });
      user.fcmTokens = user.fcmTokens.filter((t) => t !== fcmToken);

      // Update cache with latest user data
      const userDetails = await this.formatUserDetails(user);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(userId),
          userDetails,
        );
      }
    } else {
      await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    }
  }

  async refreshToken(refreshToken: string): Promise<any> {
    try {
      const decoded = verifyRefreshToken(refreshToken);

      const user = await this.userRepository.findById(decoded.id);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (user.status !== "active") {
        throw new AppError(
          "Account is not active",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.ACCOUNT_INACTIVE,
        );
      }

      const accessToken = generateAccessToken({
        id: user.id.toString(),
        email: user.email,
      });
      const newRefreshToken = generateRefreshToken({
        id: user.id.toString(),
        email: user.email,
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new AppError(
        "Invalid refresh token",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_TOKEN,
      );
    }
  }

  async forgotPassword(data: ForgotPasswordDTO): Promise<void> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      return;
    }

    const otp = await this.otpService.generateAndStore(
      user.id.toString(),
      "forgot_password",
    );
    await this.emailService.sendForgotPasswordEmail(
      user.email,
      otp,
      user.firstname,
    );

    return;
  }

  async resetPassword(data: ResetPasswordDTO): Promise<void> {
    const user = await this.userRepository.findByEmail(data.gmail);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Verify OTP from Redis
    const isValid = await this.otpService.verify(
      user.id.toString(),
      "forgot_password",
      data.otp,
    );
    if (!isValid) {
      throw new AppError(
        "Invalid or expired OTP",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    const hashedPassword = await hashPassword(data.password);
    await this.userRepository.updatePassword(user.email, hashedPassword);

    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(user.id.toString()));

    return;
  }

  async verifyResetOTP(otp: string, email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isValid = await this.otpService.verify(
      user.id.toString(),
      "forgot_password",
      otp,
    );

    if (!isValid) {
      throw new AppError(
        "Invalid or expired OTP",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    await this.otpService.markVerified(user.id.toString(), "forgot_password");

    return;
  }

  async changeAppPassword(password: string, email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const ok = await this.otpService.consumeVerified(
      user.id.toString(),
      "forgot_password",
    );
    if (!ok)
      throw new AppError(
        "OTP verification required or expired",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );

    const hashedPassword = await hashPassword(password);
    await this.userRepository.updatePassword(user.email, hashedPassword);

    // Invalidate cache after password change
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(user.id.toString()));

    return;
  }

  async changeEmail(oldEmail: string, newEmail: string): Promise<void> {
    const user = await this.userRepository.findByEmail(oldEmail);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (user.emailVerifiedAt) {
      throw new AppError(
        "Email already verified, Kindly login and request for a change of email",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const existingUser = await this.userRepository.findByEmail(newEmail);
    if (existingUser) {
      throw new AppError(
        "Email already exists",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    const otp = await this.otpService.generateAndStore(
      user.id.toString(),
      "email_verification",
    );
    await this.emailService.sendVerificationEmail(
      user.email,
      otp,
      user.firstname,
    );

    await this.userRepository.updateEmail(user.id, newEmail);
    return;
  }

  async changePassword(data: ChangePasswordDTO): Promise<void> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isPasswordValid = await comparePassword(
      data.oldPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new AppError(
        "Invalid Credentials",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    const hashedPassword = await hashPassword(data.newPassword);
    await this.userRepository.updatePassword(data.userId, hashedPassword);

    // Invalidate cache after password change
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(data.userId));
  }

  async verifyEmail(
    otp: string,
    email: string,
  ): Promise<AuthResponseDTO | null> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (user.emailVerifiedAt) {
      throw new AppError(
        "Email already verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Verify OTP from Redis
    const isValid = await this.otpService.verify(
      user.id.toString(),
      "email_verification",
      otp,
    );
    if (!isValid) {
      throw new AppError(
        "Invalid or expired OTP",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    // Mark email as verified
    await this.userRepository.verifyEmail(user.id.toString());

    // Check if user was referred by an influencer with active refereeFirstTransaction offer
    let referralOffer: { referrerName?: string; percentage: number; cap: number } | undefined;
    if (user.referredBy) {
      try {
        const referrer = await this.userRepository.findById(user.referredBy.toString());
        if (
          referrer &&
          (referrer.userType === "micro-influencer" || referrer.userType === "influencer") &&
          referrer.influencerRules?.refereeFirstTransaction?.isActive
        ) {
          referralOffer = {
            referrerName: referrer.username || referrer.firstname,
            percentage: referrer.influencerRules.refereeFirstTransaction.discountPercentage || 10,
            cap: referrer.influencerRules.refereeFirstTransaction.cap ?? 200,
          };
        }
      } catch (refErr) {
        logger.warn("Failed to check referrer for welcome email:", refErr);
      }
    }

    this.emailService
      .sendWelcomeEmail(user.email, user.firstname, referralOffer)
      .catch((err) => logger.error("Failed to send welcome email:", err));

    // Fetch updated user data
    const updatedUser = await this.userRepository.findById(user.id.toString());
    if (!updatedUser) {
      throw new AppError(
        "User not found after verification",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const data = await this.formatUserDetails(updatedUser);
    const accessToken = generateAccessToken({
      id: updatedUser.id.toString(),
      email: updatedUser.email,
    });
    const refreshToken = generateRefreshToken({
      id: updatedUser.id.toString(),
      email: updatedUser.email,
    });

    // Update cache with verified user data
    if (data) {
      await this.cacheService.set(
        CACHE_KEYS.USER_PROFILE(updatedUser.id.toString()),
        data,
      );
    }

    return { user: data, accessToken, refreshToken };
  }

  async resendEmailVerification(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (user.emailVerifiedAt) {
      throw new AppError(
        "Email already verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Generate and store OTP in Redis
    const otp = await this.otpService.generateAndStore(
      user.id.toString(),
      "email_verification",
    );

    // Send verification email
    await this.emailService.sendVerificationEmail(
      user.email,
      otp,
      user.firstname,
    );

    return;
  }

  async sendPhoneVerification(data: SendPhoneVerificationDTO): Promise<void> {
    const user = await this.userRepository.findById(data.userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if the submitted phone is the same as the existing one
    const isSamePhone =
      user.phone === data.phone && user.phoneCode === data.phoneCode;

    if (user.phoneVerifiedAt && isSamePhone) {
      throw new AppError(
        "Phone already verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // If the phone has changed, reset verification
    if (!isSamePhone) {
      user.phoneVerifiedAt = undefined;
    }

    user.phoneCode = data.phoneCode;
    user.phone = data.phone;
    await user.save();

    // Generate and store OTP in Redis
    const otp = await this.otpService.generateAndStore(
      data.userId.toString(),
      "phone_verification",
    );

    /*
    // --- SMS service (Termii) temporarily disabled ---
    // await this.smsService.sendPhoneVerificationOTP(
    //   formatPhoneNumber(user.phone),
    //   otp,
    // );
    */

    // Fallback: Send phone verification OTP to user's email address
    await this.emailService.sendPhoneVerificationEmail(
      user.email,
      otp,
      user.firstname,
      user.phone ? `${user.phoneCode || ""}${user.phone}` : undefined,
    );

    // Update cache
    const userDetails = await this.formatUserDetails(user);
    if (userDetails) {
      await this.cacheService.set(
        CACHE_KEYS.USER_PROFILE(data.userId),
        userDetails,
      );
    }
  }

  async verifyPhone(data: VerifyPhoneDTO): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (user.phoneVerifiedAt) {
      throw new AppError(
        "Phone already verified",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Verify OTP from Redis
    const isValid = await this.otpService.verify(
      data.userId.toString(),
      "phone_verification",
      data.otp,
    );
    if (!isValid) {
      throw new AppError(
        "Invalid or expired OTP",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    // Mark phone as verified
    await this.userRepository.verifyPhone(
      data.userId,
      data.phone,
      data.phoneCode,
    );

    // Fetch updated user and update cache
    const updatedUser = await this.userRepository.findById(data.userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(data.userId),
          userDetails,
        );
      }
    }

    return { user: updatedUser };
  }

  async updatePin(data: UpdatePinDTO): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Verify password
    const isPasswordValid = await comparePassword(data.password, user.password);
    if (!isPasswordValid) {
      throw new AppError(
        "Invalid Credentials",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // Hash PIN
    const hashedPin = await hashPassword(data.pin);

    await User.findByIdAndUpdate(data.userId, {
      pin: hashedPin,
      pinActivatedAt: new Date(),
    });

    // Fetch updated user and update cache
    const updatedUser = await this.userRepository.findById(data.userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(data.userId),
          userDetails,
        );
      }
    }

    return { user: updatedUser };
  }

  async changePin(data: ChangePinDTO): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!user.pin) {
      throw new AppError(
        "Kindly Set Your Pin",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Verify old PIN
    const isPinValid = await comparePassword(data.oldPin, user.pin);
    if (!isPinValid) {
      throw new AppError(
        "Invalid old PIN",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // Hash new PIN
    const hashedPin = await hashPassword(data.newPin);

    await User.findByIdAndUpdate(data.userId, {
      pin: hashedPin,
      pinActivatedAt: new Date(),
    });

    // Fetch updated user and update cache
    const updatedUser = await this.userRepository.findById(data.userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(data.userId),
          userDetails,
        );
      }
    }

    return { user: updatedUser };
  }

  async setPin(data: SetPinDTO): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Hash PIN
    const hashedPin = await hashPassword(data.pin);

    await User.findByIdAndUpdate(data.userId, {
      pin: hashedPin,
      pinActivatedAt: new Date(),
    });

    // Fetch updated user and update cache
    const updatedUser = await this.userRepository.findById(data.userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(data.userId),
          userDetails,
        );
      }
    }

    return { user: updatedUser };
  }

  async verifyPin(data: VerifyPinDTO): Promise<boolean> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!user.pin) {
      throw new AppError(
        "PIN not set",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const isPinValid = await comparePassword(data.pin, user.pin);
    return isPinValid;
  }

  async resendPinVerification(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const email = user.email;
    const otp = await this.otpService.generateAndStore(
      email.toLowerCase(),
      "pin_change",
    );

    // Send verification email
    await this.emailService.sendPinChangeEmail(email, otp);

    return;
  }

  async resetPin(userId: string, newPin: string, otp: string): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!user.pin || !user.pinActivatedAt) {
      throw new AppError(
        "Kindly Set Your Pin",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const email = user.email;
    const isOtpValid = await this.otpService.verify(email, "pin_change", otp);
    if (!isOtpValid) {
      throw new AppError(
        "Invalid OTP",
        HTTP_STATUS.UNAUTHORIZED,
        "INVALID_OTP",
      );
    }

    // Hash PIN
    const hashedPin = await hashPassword(newPin);

    await User.findByIdAndUpdate(userId, {
      pin: hashedPin,
      pinActivatedAt: new Date(),
    });

    const updatedUser = await this.userRepository.findById(userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(userId),
          userDetails,
        );
      }
    }

    return { user: updatedUser };
  }

  async verifyPinOtp(otp: string, userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const email = user.email;
    const isOtpValid = await this.otpService.verify(email, "pin_change", otp);
    if (!isOtpValid) {
      throw new AppError(
        "Invalid OTP",
        HTTP_STATUS.UNAUTHORIZED,
        "INVALID_OTP",
      );
    }

    await this.otpService.markVerified(user.id.toString(), "pin_change");

    return;
  }

  async appResetPin(data: { userId: string; pin: string }): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const ok = await this.otpService.consumeVerified(
      user.id.toString(),
      "pin_change",
    );
    if (!ok)
      throw new AppError(
        "OTP verification required or expired",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );

    // Hash PIN
    const hashedPin = await hashPassword(data.pin);

    await User.findByIdAndUpdate(data.userId, {
      pin: hashedPin,
      pinActivatedAt: new Date(),
    });

    const updatedUser = await this.userRepository.findById(data.userId);
    if (updatedUser) {
      const userDetails = await this.formatUserDetails(updatedUser);
      if (userDetails) {
        await this.cacheService.set(
          CACHE_KEYS.USER_PROFILE(data.userId),
          userDetails,
        );
      }
    } else {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return { user: updatedUser };
  }

  async toggle2FA(data: Toggle2FADTO): Promise<any> {
    const user = await this.userRepository.findById(data.userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    user.twofactorEnabled = data.enable;
    user.twoFactorEnabledAt = data.enable ? new Date() : undefined;
    await user.save();

    // Update cache with 2FA status
    const userDetails = await this.formatUserDetails(user);
    if (userDetails) {
      await this.cacheService.set(
        CACHE_KEYS.USER_PROFILE(data.userId),
        userDetails,
      );
    }

    return { user: userDetails };
  }

  async verify2FA(data: Verify2FADTO): Promise<AuthResponseDTO | null> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isValid = await this.otpService.verify(
      user.id.toString(),
      "2fa",
      data.otp,
    );
    if (!isValid) {
      throw new AppError(
        "Invalid or expired OTP",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_TOKEN,
      );
    }

    const userDetails = await this.formatUserDetails(user);
    if (!userDetails) {
      throw new AppError(
        "Error formatting user details",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }

    // Update cache with user data
    await this.cacheService.set(CACHE_KEYS.USER_PROFILE(user.id), userDetails);

    // Generate tokens
    const accessToken = generateAccessToken({
      id: user.id.toString(),
      email: user.email,
    });
    const refreshToken = generateRefreshToken({
      id: user.id.toString(),
      email: user.email,
    });

    return { user: userDetails, accessToken, refreshToken };
  }

  async resend2FA(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      // throw new AppError(
      //   "User not found",
      //   HTTP_STATUS.NOT_FOUND,
      //   ERROR_CODES.NOT_FOUND
      // );
      return;
    }

    const otp = await this.otpService.generateAndStore(
      user.id.toString(),
      "2fa",
    );

    await this.emailService.send2FAEmail(user.email, otp, user.firstname);

    return;
  }

  async setupBiometric(
    userId: string,
  ): Promise<{ frontendToken: string; user: IUserResponse; message: string }> {
    const { frontendToken, userData, message } =
      await this.biometricService.setupBiometric(userId);

    const userDetails = await this.formatUserDetails(userData);
    if (!userDetails) {
      throw new AppError(
        "Error formatting user details",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }

    return { frontendToken, user: userDetails, message };
  }

  async verifyBiometric(
    userId: string,
    frontendToken: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this.biometricService.verifyBiometric(userId, frontendToken);
  }

  async disableBiometric(userId: string): Promise<{ success: boolean }> {
    return await this.biometricService.disableBiometric(userId);
  }

  async getBiometricStatus(userId: string): Promise<{ isEnabled: boolean }> {
    return await this.biometricService.getBiometricStatus(userId);
  }

  //  Login Biometric

  async setupLoginBiometric(
    userId: string,
  ): Promise<{ frontendToken: string; user: IUserResponse; message: string }> {
    const { frontendToken, userData, message } =
      await this.biometricService.setupLoginBiometric(userId);

    const userDetails = await this.formatUserDetails(userData);
    if (!userDetails) {
      throw new AppError(
        "Error formatting user details",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }

    return { frontendToken, user: userDetails, message };
  }

  async verifyLoginBiometric(
    userId: string,
    frontendToken: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this.biometricService.verifyLoginBiometric(
      userId,
      frontendToken,
    );
  }

  async disableLoginBiometric(userId: string): Promise<{ success: boolean }> {
    return await this.biometricService.disableLoginBiometric(userId);
  }

  async getLoginBiometricStatus(
    userId: string,
  ): Promise<{ isEnabled: boolean }> {
    return await this.biometricService.getLoginBiometricStatus(userId);
  }

  //  Transaction Biometric

  async setupTransactionBiometric(
    userId: string,
  ): Promise<{ frontendToken: string; user: IUserResponse; message: string }> {
    const { frontendToken, userData, message } =
      await this.biometricService.setupTransactionBiometric(userId);

    const userDetails = await this.formatUserDetails(userData);
    if (!userDetails) {
      throw new AppError(
        "Error formatting user details",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }

    return { frontendToken, user: userDetails, message };
  }

  async verifyTransactionBiometric(
    userId: string,
    frontendToken: string,
  ): Promise<{ success: boolean; message: string }> {
    return await this.biometricService.verifyTransactionBiometric(
      userId,
      frontendToken,
    );
  }

  async disableTransactionBiometric(
    userId: string,
  ): Promise<{ success: boolean }> {
    return await this.biometricService.disableTransactionBiometric(userId);
  }

  async getTransactionBiometricStatus(
    userId: string,
  ): Promise<{ isEnabled: boolean }> {
    return await this.biometricService.getTransactionBiometricStatus(userId);
  }

  private async formatUserDetails(user: IUser): Promise<IUserResponse | null> {
    if (!user) return null;

    // if (user.country || user.state) {
    //   await user.populate(["country", "state"]);
    // }

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
      biometricEnabled: user.biometricEnabled || false,
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
