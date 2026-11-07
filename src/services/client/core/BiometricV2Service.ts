import crypto from "crypto";
import { Types } from "mongoose";
import logger from "@/logger";
import redisConfig from "@/config/redis";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { UserRepository } from "@/repositories/client/UserRepository";
import { DeviceCredentialRepository } from "@/repositories/client/DeviceCredentialRepository";
import { BiometricCrypto } from "@/utils/biometrics/biometricCrypto";
import { IUser, IUserResponse } from "@/models/core/User";
import { generateAccessToken, generateRefreshToken } from "@/config/jwt";
import { CacheService } from "@/services/core/CacheService";
import {
  recordFailedLoginAttempt,
  recordFailedLoginAttemptByIp,
  recordSuccessfulLogin,
  recordSuccessfulLoginByIp,
} from "@/middlewares/shared/rateLimiter";

const CHALLENGE_TTL_SECONDS = 60;
const TRANSACTION_TOKEN_TTL_SECONDS = 120;

export interface CompleteSetupDTO {
  deviceId: string;
  deviceName?: string;
  publicKey: string;
  signature: string;
  algorithm?: "ES256" | "RS256";
  biometricType?: "faceId" | "touchId" | "fingerprint" | "biometric";
  purpose?: "login" | "transaction" | "all";
}

export interface VerifyLoginDTO {
  email: string;
  deviceId: string;
  signature: string;
  fcmToken?: string;
  rememberMe?: boolean;
  version?: string;
  appVersion?: string;
}

export class BiometricV2Service {
  private userRepository: UserRepository;
  private deviceCredentialRepo: DeviceCredentialRepository;
  private cacheService: CacheService;

  constructor(
    userRepository?: UserRepository,
    deviceCredentialRepo?: DeviceCredentialRepository,
    cacheService?: CacheService,
  ) {
    this.userRepository = userRepository || new UserRepository();
    this.deviceCredentialRepo =
      deviceCredentialRepo || new DeviceCredentialRepository();
    this.cacheService = cacheService || new CacheService();
  }

  // ─── REDIS CHALLENGE HELPERS ─────────────────────────────────────────────

  private getSetupChallengeKey(userId: string, deviceId: string): string {
    return `biometric:v2:challenge:setup:${userId}:${deviceId}`;
  }

  private getLoginChallengeKey(userId: string, deviceId: string): string {
    return `biometric:v2:challenge:login:${userId}:${deviceId}`;
  }

  private getTxnChallengeKey(userId: string, deviceId: string): string {
    return `biometric:v2:challenge:txn:${userId}:${deviceId}`;
  }

  private getTxnTokenKey(userId: string, token: string): string {
    return `biometric:v2:txn-token:${userId}:${token}`;
  }

  /**
   * Atomically reads and burns (deletes) the challenge from Redis.
   * Single-use guarantee: once read, the key ceases to exist regardless of whether
   * the subsequent verification succeeds or fails.
   */
  private async getAndBurnChallenge(key: string): Promise<string | null> {
    try {
      if (typeof redisConfig.client.getDel === "function") {
        return await redisConfig.client.getDel(key);
      }
    } catch {
      // Fallback for Redis instances that don't support GETDEL
    }

    const challenge = await redisConfig.client.get(key);
    if (challenge) {
      await redisConfig.client.del(key);
    }
    return challenge;
  }

  private async storeChallenge(key: string, challenge: string): Promise<void> {
    await redisConfig.client.setEx(key, CHALLENGE_TTL_SECONDS, challenge);
  }

  // ─── SETUP FLOW (ENROLLMENT) ─────────────────────────────────────────────

  /**
   * Step 1: Initiate device biometric setup.
   * Generates a 60s single-use challenge bound to (userId, deviceId).
   */
  async initiateSetup(
    userId: string,
    deviceId: string,
    biometricType?: string,
  ): Promise<{ challenge: string; expiresAt: Date; deviceId: string }> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const challenge = BiometricCrypto.generateChallenge();
    const key = this.getSetupChallengeKey(userId, deviceId);
    await this.storeChallenge(key, challenge);

    logger.info(
      `[BiometricV2 Setup] Challenge generated for user: ${userId}, device: ${deviceId}`,
    );

    return {
      challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      deviceId,
    };
  }

  /**
   * Step 2: Complete device biometric setup.
   * Verifies proof of private key ownership by checking signature over the challenge.
   * Uses ADDITIVE flag logic — enabling one purpose never disables an already-enabled one.
   */
  async completeSetup(
    userId: string,
    data: CompleteSetupDTO,
  ): Promise<{
    credential: {
      id: string;
      deviceId: string;
      deviceName?: string;
      biometricType: string;
      algorithm: string;
      isLoginEnabled: boolean;
      isTransactionEnabled: boolean;
      createdAt: Date;
    };
    user: IUserResponse | null;
    message: string;
  }> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    // 1. Burn challenge immediately (no replay)
    const setupKey = this.getSetupChallengeKey(userId, data.deviceId);
    const challenge = await this.getAndBurnChallenge(setupKey);

    if (!challenge) {
      throw new AppError(
        "Biometric setup challenge expired or invalid. Please initiate setup again.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // 2. Parse and normalize public key
    let parsedKey: { pem: string };
    try {
      parsedKey = BiometricCrypto.parsePublicKey(data.publicKey);
    } catch (err: any) {
      throw new AppError(
        err.message || "Invalid public key format",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // 3. Verify signature (Proof of Possession of private key)
    const algorithm = data.algorithm || "ES256";
    const isValid = BiometricCrypto.verifySignature(
      challenge,
      data.signature,
      parsedKey.pem,
      algorithm,
    );

    if (!isValid) {
      logger.warn(
        `[BiometricV2 Setup Failed] Invalid signature for user: ${userId}, device: ${data.deviceId}`,
      );
      throw new AppError(
        "Invalid cryptographic signature for provided public key",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // 4. Enforce single active user per physical device:
    // If any other user previously enrolled this deviceId, revoke their credential(s)
    // and sync their user profile flags so only the current user is active on this device.
    const affectedUserIds = await this.deviceCredentialRepo.revokeDeviceForOtherUsers(
      userId,
      data.deviceId,
      "device_reassigned",
    );

    for (const otherUserId of affectedUserIds) {
      await this.syncUserBiometricFlags(otherUserId);
      logger.info(
        `[BiometricV2 Setup] Revoked previous user (${otherUserId}) credential on device ${data.deviceId} due to device reassignment`,
      );
    }

    // 5. Resolve additive flags:
    //    Read the existing credential so we never downgrade an already-enabled purpose.
    //    e.g. enrolling purpose="transaction" on a device already enrolled for "login"
    //    must keep isLoginEnabled=true.
    const existing = await this.deviceCredentialRepo.findActiveByDevice(userId, data.deviceId);

    const purpose = data.purpose || "all";
    const newLoginEnabled = purpose === "login" || purpose === "all";
    const newTransactionEnabled = purpose === "transaction" || purpose === "all";

    // OR with whatever is already persisted (additive, never subtractive)
    const isLoginEnabled = (existing?.isLoginEnabled ?? false) || newLoginEnabled;
    const isTransactionEnabled = (existing?.isTransactionEnabled ?? false) || newTransactionEnabled;

    const credential = await this.deviceCredentialRepo.upsertCredential(userId, {
      deviceId: data.deviceId,
      deviceName: data.deviceName,
      publicKey: parsedKey.pem,
      algorithm,
      biometricType: data.biometricType || "biometric",
      isLoginEnabled,
      isTransactionEnabled,
    });

    // 5. Update user profile biometric enabled flags (only ever set to true, never false here)
    const updatePayload: any = { biometricEnabled: true };
    if (isLoginEnabled) updatePayload.loginBiometricEnabled = true;
    if (isTransactionEnabled) updatePayload.transactionBiometricEnabled = true;

    await this.userRepository.update(userId, updatePayload);
    try {
      await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    } catch (err: any) {
      logger.warn(`[BiometricV2] Failed to clear user profile cache for ${userId}: ${err?.message}`);
    }

    logger.info(
      `[BiometricV2 Setup] Device ${data.deviceId} enrolled successfully for user: ${userId} ` +
      `(login=${isLoginEnabled}, transaction=${isTransactionEnabled})`,
    );

    const updatedUser = await this.userRepository.findById(userId);
    const formattedUser = await this.formatUserDetails(updatedUser!);

    return {
      credential: {
        id: credential.id,
        deviceId: credential.deviceId,
        deviceName: credential.deviceName,
        biometricType: credential.biometricType,
        algorithm: credential.algorithm,
        isLoginEnabled: credential.isLoginEnabled,
        isTransactionEnabled: credential.isTransactionEnabled,
        createdAt: credential.createdAt,
      },
      user: formattedUser,
      message: "Biometric device enrolled successfully",
    };
  }

  // ─── LOGIN FLOW (AUTHENTICATION) ─────────────────────────────────────────

  /**
   * Step 1: Initiate biometric login.
   * Public endpoint. Validates that the device is actively enrolled and issues a 60s challenge.
   */
  async initiateLogin(
    email: string,
    deviceId: string,
  ): Promise<{ challenge: string; expiresAt: Date; deviceId: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new AppError(
        "Invalid credentials or device not enrolled",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // Check account status
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

    // Lookup active credential for this user & device
    const credential = await this.deviceCredentialRepo.findActiveByDevice(
      user.id.toString(),
      deviceId,
    );

    if (!credential || !credential.isLoginEnabled) {
      throw new AppError(
        "Biometric login is not enrolled for this device",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    const challenge = BiometricCrypto.generateChallenge();
    const loginKey = this.getLoginChallengeKey(user.id.toString(), deviceId);
    await this.storeChallenge(loginKey, challenge);

    logger.info(
      `[BiometricV2 Login] Challenge issued for user: ${user.id}, device: ${deviceId}`,
    );

    return {
      challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      deviceId,
    };
  }

  /**
   * Step 2: Verify biometric signature and log in.
   * Public endpoint. Verifies signature against stored public key and issues JWT tokens.
   */
  async verifyLogin(
    data: VerifyLoginDTO,
    loginIdentifier: string,
    ipIdentifier?: string,
  ): Promise<{
    user: IUserResponse | null;
    accessToken: string;
    refreshToken: string;
    message: string;
  }> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      throw new AppError(
        "Invalid credentials",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // Check account status
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

    // 1. Burn challenge immediately
    const loginKey = this.getLoginChallengeKey(user.id.toString(), data.deviceId);
    const challenge = await this.getAndBurnChallenge(loginKey);

    if (!challenge) {
      throw new AppError(
        "Biometric challenge expired or invalid. Please initiate a new challenge.",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // 2. Fetch active credential
    const credential = await this.deviceCredentialRepo.findActiveByDevice(
      user.id.toString(),
      data.deviceId,
    );

    if (!credential || !credential.isLoginEnabled) {
      throw new AppError(
        "Biometric credential not found or revoked",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // 3. Verify signature
    const isValid = BiometricCrypto.verifySignature(
      challenge,
      data.signature,
      credential.publicKey,
      credential.algorithm,
    );

    if (!isValid) {
      recordFailedLoginAttempt(loginIdentifier).catch((err) =>
        logger.error("Failed to record login attempt:", err),
      );
      if (ipIdentifier) {
        recordFailedLoginAttemptByIp(ipIdentifier).catch((err) =>
          logger.error("Failed to record IP login attempt:", err),
        );
      }
      logger.warn(
        `[BiometricV2 Login Failed] Signature mismatch for user: ${user.id}, device: ${data.deviceId}`,
      );
      throw new AppError(
        "Biometric signature verification failed",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    // 4. Update credential lastUsedAt
    await this.deviceCredentialRepo.updateLastUsed(credential.id);

    // 5. Check email verification
    if (!user.emailVerifiedAt) {
      throw new AppError(
        "Please verify your email before logging in",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.EMAIL_NOT_VERIFIED,
      );
    }

    const now = new Date();
    user.lastLoginAt = now;
    const updateFields: Record<string, any> = { lastLoginAt: now };
    if (data.fcmToken) {
      user.fcmTokens = [data.fcmToken];
      updateFields.fcmTokens = [data.fcmToken];
    }
    const incomingAppVersion = (data.appVersion || data.version)?.trim();
    if (
      incomingAppVersion &&
      incomingAppVersion !== "" &&
      user.appVersion !== incomingAppVersion
    ) {
      user.appVersion = incomingAppVersion;
      updateFields.appVersion = incomingAppVersion;
    }

    await this.userRepository.update(user.id.toString(), {
      $set: updateFields,
    });

    // 6. Generate access & refresh tokens
    const accessToken = generateAccessToken({
      id: user.id.toString(),
      email: user.email,
    });
    const refreshToken = generateRefreshToken({
      id: user.id.toString(),
      email: user.email,
      rememberMe: data.rememberMe,
    });

    // Clear login rate limiting
    recordSuccessfulLogin(loginIdentifier).catch((err) =>
      logger.error("Failed to clear rate limit:", err),
    );
    if (ipIdentifier) {
      recordSuccessfulLoginByIp(ipIdentifier).catch((err) =>
        logger.error("Failed to clear IP rate limit:", err),
      );
    }

    const formattedUser = await this.formatUserDetails(user);

    // Update user profile cache
    if (formattedUser) {
      await this.cacheService.set(
        CACHE_KEYS.USER_PROFILE(user.id.toString()),
        formattedUser,
      );
    }

    logger.info(
      `[BiometricV2 Login Success] User ${user.id} logged in via device ${data.deviceId}`,
    );

    return {
      user: formattedUser,
      accessToken,
      refreshToken,
      message: "Biometric login successful",
    };
  }

  // ─── TRANSACTION BIOMETRIC FLOW ──────────────────────────────────────────

  /**
   * Step 1: Initiate transaction biometric challenge.
   * Authenticated endpoint.
   */
  async initiateTransaction(
    userId: string,
    deviceId: string,
  ): Promise<{ challenge: string; expiresAt: Date; deviceId: string }> {
    const credential = await this.deviceCredentialRepo.findActiveByDevice(
      userId,
      deviceId,
    );

    if (!credential || !credential.isTransactionEnabled) {
      throw new AppError(
        "Transaction biometric authentication is not enabled on this device",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    const challenge = BiometricCrypto.generateChallenge();
    const key = this.getTxnChallengeKey(userId, deviceId);
    await this.storeChallenge(key, challenge);

    return {
      challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      deviceId,
    };
  }

  /**
   * Step 2: Verify transaction biometric signature.
   * Authenticated endpoint. Returns a short-lived single-use transactionToken (120s TTL).
   */
  async verifyTransaction(
    userId: string,
    deviceId: string,
    signature: string,
  ): Promise<{ success: boolean; transactionToken: string; message: string }> {
    const key = this.getTxnChallengeKey(userId, deviceId);
    const challenge = await this.getAndBurnChallenge(key);

    if (!challenge) {
      throw new AppError(
        "Transaction challenge expired or invalid",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    const credential = await this.deviceCredentialRepo.findActiveByDevice(
      userId,
      deviceId,
    );

    if (!credential || !credential.isTransactionEnabled) {
      throw new AppError(
        "Transaction biometric credential not found or revoked",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    const isValid = BiometricCrypto.verifySignature(
      challenge,
      signature,
      credential.publicKey,
      credential.algorithm,
    );

    if (!isValid) {
      throw new AppError(
        "Transaction biometric signature verification failed",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
      );
    }

    await this.deviceCredentialRepo.updateLastUsed(credential.id);

    // Generate single-use transaction authorization token (120s TTL)
    const transactionToken = crypto.randomBytes(24).toString("hex");
    const tokenKey = this.getTxnTokenKey(userId, transactionToken);
    await redisConfig.client.setEx(tokenKey, TRANSACTION_TOKEN_TTL_SECONDS, "1");

    return {
      success: true,
      transactionToken,
      message: "Transaction biometric verified successfully",
    };
  }

  /**
   * Validates and burns a transaction token.
   * Can be used in checkAndVerifyPin or transaction controllers as a drop-in authorization check.
   */
  async consumeTransactionToken(userId: string, token: string): Promise<boolean> {
    const tokenKey = this.getTxnTokenKey(userId, token);
    const val = await this.getAndBurnChallenge(tokenKey);
    return val === "1";
  }

  // ─── DEVICE MANAGEMENT ───────────────────────────────────────────────────

  /**
   * List all enrolled devices for the user.
   */
  async listDevices(userId: string) {
    const credentials = await this.deviceCredentialRepo.findActiveByUser(userId);
    return credentials.map((c) => ({
      id: c.id,
      deviceId: c.deviceId,
      deviceName: c.deviceName,
      biometricType: c.biometricType,
      algorithm: c.algorithm,
      isLoginEnabled: c.isLoginEnabled,
      isTransactionEnabled: c.isTransactionEnabled,
      lastUsedAt: c.lastUsedAt,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Revoke a specific device.
   */
  async revokeDevice(userId: string, deviceId: string): Promise<{ success: boolean; message: string }> {
    const revoked = await this.deviceCredentialRepo.revokeDevice(userId, deviceId);
    if (!revoked) {
      throw new AppError("Device not found or already revoked", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    // Recompute user-level flags from remaining active devices
    await this.syncUserBiometricFlags(userId);

    logger.info(`[BiometricV2] Device ${deviceId} revoked by user: ${userId}`);

    return {
      success: true,
      message: "Device revoked successfully",
    };
  }

  /**
   * Toggle an individual biometric purpose (login or transaction) for a device
   * WITHOUT requiring a new key enrollment / challenge flow.
   * Useful for UI toggles post-enrollment.
   */
  async togglePurpose(
    userId: string,
    deviceId: string,
    purpose: "login" | "transaction",
    enabled: boolean,
  ): Promise<{
    isLoginEnabled: boolean;
    isTransactionEnabled: boolean;
    message: string;
  }> {
    const credential = await this.deviceCredentialRepo.findActiveByDevice(userId, deviceId);
    if (!credential) {
      throw new AppError(
        "Biometric credential not found for this device",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (purpose === "login") {
      credential.isLoginEnabled = enabled;
    } else {
      credential.isTransactionEnabled = enabled;
    }
    await credential.save();

    // Sync user-level flags
    await this.syncUserBiometricFlags(userId);

    logger.info(
      `[BiometricV2] ${purpose} biometric ${enabled ? "enabled" : "disabled"} ` +
      `for device ${deviceId}, user: ${userId}`,
    );

    return {
      isLoginEnabled: credential.isLoginEnabled,
      isTransactionEnabled: credential.isTransactionEnabled,
      message: `Biometric ${purpose} ${enabled ? "enabled" : "disabled"} successfully`,
    };
  }

  /**
   * Revoke all enrolled devices for the user.
   */
  async revokeAllDevices(userId: string): Promise<{ success: boolean; revokedCount: number; message: string }> {
    const count = await this.deviceCredentialRepo.revokeAllDevices(userId);

    // No active devices remain after revoking all — clear all flags
    await this.userRepository.update(userId, {
      biometricEnabled: false,
      loginBiometricEnabled: false,
      transactionBiometricEnabled: false,
    });

    logger.info(`[BiometricV2] All ${count} devices revoked by user: ${userId}`);

    return {
      success: true,
      revokedCount: count,
      message: "All biometric devices revoked successfully",
    };
  }

  /**
   * Recomputes and persists user-level biometric flags by scanning all active device credentials.
   * Called after any credential mutation (revoke, toggle) to keep user model in sync.
   */
  private async syncUserBiometricFlags(userId: string): Promise<void> {
    const remaining = await this.deviceCredentialRepo.findActiveByUser(userId);

    const anyLogin = remaining.some((c) => c.isLoginEnabled);
    const anyTransaction = remaining.some((c) => c.isTransactionEnabled);
    const anyActive = remaining.length > 0;

    await this.userRepository.update(userId, {
      biometricEnabled: anyActive,
      loginBiometricEnabled: anyLogin,
      transactionBiometricEnabled: anyTransaction,
    });

    try {
      await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    } catch (err: any) {
      logger.warn(
        `[BiometricV2] Failed to invalidate profile cache for user: ${userId} - ${err?.message}`,
      );
    }
  }

  // ─── PRIVATE USER FORMATTER ──────────────────────────────────────────────

  private async formatUserDetails(user: IUser): Promise<IUserResponse | null> {
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
