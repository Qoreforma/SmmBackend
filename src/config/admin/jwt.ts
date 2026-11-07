import jwt, { SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { AdminJWTPayload } from "@/types/admin";
import logger from "@/logger";
import CacheService from "@/services/core/CacheService";
import { EmailService } from "@/services/core/EmailService";

export interface AdminRefreshTokenPayload {
  adminId: string;
  tokenId: string;
  deviceInfo?: string | undefined;
  generation: number;
  family: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface TokenReuseContext {
  timeSinceIssue: number; // seconds
  timeSinceLastUse: number; // seconds
  isSuspicious: boolean;
  reason?: string;
}

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AdminJWTConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
  adminEmail: string;
  // Tunable thresholds
  tokenReuseWindow: number; // seconds - if reused within this window, it's suspicious (default: 10)
  failureAlertThreshold: number; // number of failures before alert (default: 5)
}

class AdminJWTUtil {
  private config: AdminJWTConfig;
  private cacheService = CacheService;
  private emailService = new EmailService();

  constructor() {
    if (
      !process.env.JWT_ADMIN_ACCESS_SECRET ||
      !process.env.JWT_ADMIN_REFRESH_SECRET
    ) {
      throw new Error(
        "FATAL: JWT_ADMIN_ACCESS_SECRET is missing from environment",
      );
    }
    this.config = {
      accessSecret: process.env.JWT_ADMIN_ACCESS_SECRET,
      refreshSecret: process.env.JWT_ADMIN_REFRESH_SECRET,
      accessExpiresIn: process.env.JWT_ADMIN_ACCESS_EXPIRES_IN || "2h",
      refreshExpiresIn: process.env.JWT_ADMIN_REFRESH_EXPIRES_IN || "20d",
      adminEmail: process.env.SUPER_ADMIN_EMAIL || "",
      tokenReuseWindow: parseInt(process.env.TOKEN_REUSE_WINDOW || "10"), // 10 seconds
      failureAlertThreshold: parseInt(
        process.env.FAILURE_ALERT_THRESHOLD || "10",
      ), // 10 failures
    };
  }

  generateAccessToken(payload: {
    adminId: string;
    email: string;
    adminLevel: string;
    tokenId: string;
    generation?: number;
  }): string {
    const jwtPayload: AdminJWTPayload = {
      id: payload.adminId,
      adminId: payload.adminId,
      email: payload.email,
      adminLevel: payload.adminLevel,
      tokenId: payload.tokenId,
      generation: payload.generation || 0,
    };

    return jwt.sign(jwtPayload, this.config.accessSecret, {
      expiresIn: this.config.accessExpiresIn,
      issuer: "pelbliss-admin",
      audience: "pelbliss-admin-client",
    } as jwt.SignOptions);
  }

  generateRefreshToken(payload: {
    adminId: string;
    deviceInfo?: string;
    generation?: number;
    family?: string;
  }): {
    token: string;
    tokenId: string;
    family: string;
    generation: number;
  } {
    const tokenId = uuidv4();
    const family = payload.family || uuidv4();
    const generation = (payload.generation || 0) + 1;

    const refreshPayload: AdminRefreshTokenPayload = {
      adminId: payload.adminId,
      tokenId,
      deviceInfo: payload.deviceInfo,
      generation,
      family,
    };

    const token = jwt.sign(refreshPayload, this.config.refreshSecret, {
      expiresIn: this.config.refreshExpiresIn,
      issuer: "pelbliss-admin",
      audience: "pelbliss-admin-refresh",
    } as jwt.SignOptions);

    return { token, tokenId, family, generation };
  }

  generateTokenPair(payload: {
    adminId: string;
    email: string;
    adminLevel: string;
    deviceInfo?: string;
    generation?: number;
    family?: string;
  }): AdminTokenPair & { tokenId: string; family: string; generation: number } {
    const refreshTokenData = this.generateRefreshToken({
      adminId: payload.adminId,
      deviceInfo: payload.deviceInfo,
      generation: payload.generation,
      family: payload.family,
    });

    const accessToken = this.generateAccessToken({
      adminId: payload.adminId,
      email: payload.email,
      adminLevel: payload.adminLevel,
      tokenId: refreshTokenData.tokenId,
      generation: refreshTokenData.generation,
    });

    const expiresIn = this.getTokenExpirationTime(this.config.accessExpiresIn);

    return {
      accessToken,
      refreshToken: refreshTokenData.token,
      tokenId: refreshTokenData.tokenId,
      family: refreshTokenData.family,
      generation: refreshTokenData.generation,
      expiresIn,
    };
  }

  verifyAccessToken(token: string): AdminJWTPayload {
    try {
      const decoded = jwt.verify(
        token,
        this.config.accessSecret,
      ) as AdminJWTPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("ADMIN_ACCESS_TOKEN_EXPIRED");
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("ADMIN_ACCESS_TOKEN_INVALID");
      }
      throw new Error("ADMIN_ACCESS_TOKEN_VERIFICATION_FAILED");
    }
  }

  verifyRefreshToken(token: string): AdminRefreshTokenPayload {
    try {
      const decoded = jwt.verify(
        token,
        this.config.refreshSecret,
      ) as AdminRefreshTokenPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("ADMIN_REFRESH_TOKEN_EXPIRED");
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("ADMIN_REFRESH_TOKEN_INVALID");
      }
      throw new Error("ADMIN_REFRESH_TOKEN_VERIFICATION_FAILED");
    }
  }

  async markTokenAsUsed(tokenId: string): Promise<void> {
    const key = `admin:refresh_used:${tokenId}`;
    await this.cacheService.set(
      key,
      { used: true, timestamp: Date.now() },
      this.getTokenExpirationTime(this.config.refreshExpiresIn),
    );
  }

  async isTokenUsed(tokenId: string): Promise<boolean> {
    const key = `admin:refresh_used:${tokenId}`;
    return await this.cacheService.exists(key);
  }


//Get metadata about when token was last used
  async getTokenUsageMetadata(tokenId: string): Promise<any> {
    const key = `admin:refresh_used:${tokenId}`;
    return await this.cacheService.get(key);
  }

  async invalidateTokenFamily(family: string, adminId: string): Promise<void> {
    const pattern = `admin:refresh_token:${adminId}:${family}:*`;
    await this.cacheService.deletePattern(pattern);

    const blacklistKey = `admin:blacklist_family:${family}`;
    await this.cacheService.set(
      blacklistKey,
      {
        blacklisted: true,
        timestamp: Date.now(),
        adminId,
      },
      this.getTokenExpirationTime(this.config.refreshExpiresIn),
    );

    logger.warn(
      `Admin token family invalidated: ${family} for admin: ${adminId}`,
    );
  }

  async isTokenFamilyBlacklisted(family: string): Promise<boolean> {
    const key = `admin:blacklist_family:${family}`;
    return await this.cacheService.exists(key);
  }

  async storeRefreshTokenMetadata(
    tokenId: string,
    adminId: string,
    family: string,
    generation: number,
    metadata: any = {},
  ): Promise<void> {
    const key = `admin:refresh_token:${adminId}:${family}:${generation}`;
    await this.cacheService.set(
      key,
      {
        tokenId,
        adminId,
        family,
        generation,
        createdAt: Date.now(),
        ...metadata,
      },
      this.getTokenExpirationTime(this.config.refreshExpiresIn),
    );
  }

  async getRefreshTokenMetadata(
    adminId: string,
    family: string,
    generation: number,
  ): Promise<any> {
    const key = `admin:refresh_token:${adminId}:${family}:${generation}`;
    return await this.cacheService.get(key);
  }


//Analyze token reuse and determine if it's suspicious
//Only flags actual threats, not normal frontend retries
  async analyzeTokenReuse(
    decoded: AdminRefreshTokenPayload,
  ): Promise<TokenReuseContext> {
    try {
      // Check if family is blacklisted (previous incident)
      if (await this.isTokenFamilyBlacklisted(decoded.family)) {
        logger.warn(`Attempt to use blacklisted token family`, {
          adminId: decoded.adminId,
          family: decoded.family,
        });
        return {
          isSuspicious: true,
          reason: "Token family is blacklisted due to previous incident",
          timeSinceIssue: 0,
          timeSinceLastUse: 0,
        };
      }

      // Check if token was already marked as used
      let metadata;
      try {
        metadata = await this.getTokenUsageMetadata(decoded.tokenId);
      } catch (error: any) {
        logger.warn("Failed to check token usage metadata", {
          tokenId: decoded.tokenId,
          error: error.message,
        });
        // On cache error, allow the token (fail open for availability)
        return {
          isSuspicious: false,
          reason: "Unable to verify metadata (cache issue) - allowing token",
          timeSinceIssue: 0,
          timeSinceLastUse: 0,
        };
      }

      if (!metadata) {
        // Token hasn't been used before - this is normal
        return {
          isSuspicious: false,
          timeSinceIssue: 0,
          timeSinceLastUse: 0,
        };
      }

      // Calculate time between usages
      const lastUseTime = metadata?.timestamp;
      if (!lastUseTime || typeof lastUseTime !== "number") {
        logger.warn("Invalid metadata timestamp", {
          tokenId: decoded.tokenId,
          lastUseTime,
        });
        return {
          isSuspicious: false,
          timeSinceIssue: 0,
          timeSinceLastUse: 0,
        };
      }

      const currentTime = Date.now();
      const timeSinceLastUse = Math.floor((currentTime - lastUseTime) / 1000);
      const timeSinceIssue =
        decoded.iat && typeof decoded.iat === "number"
          ? Math.floor((currentTime - decoded.iat * 1000) / 1000)
          : 0;

      // If reused within the suspicious window (e.g., 10 seconds), it's suspicious
      // This indicates the token was leaked and used simultaneously from different places
      if (timeSinceLastUse < this.config.tokenReuseWindow) {
        return {
          isSuspicious: true,
          reason: `Token reused within ${this.config.tokenReuseWindow}s (possible leak)`,
          timeSinceIssue,
          timeSinceLastUse,
        };
      }

      // If reused much later (minutes/hours), it's normal (frontend retry, cache issue, etc)
      return {
        isSuspicious: false,
        reason: "Normal retry after expiration",
        timeSinceIssue,
        timeSinceLastUse,
      };
    } catch (error: any) {
      logger.error("Unexpected error in analyzeTokenReuse", {
        adminId: decoded.adminId,
        error: error.message,
      });
      // On unexpected error, fail safe (allow the token to proceed)
      return {
        isSuspicious: false,
        reason: "Error during analysis - allowing token for availability",
        timeSinceIssue: 0,
        timeSinceLastUse: 0,
      };
    }
  }


//Track failed refresh attempts for rate limiting
  async recordFailedRefreshAttempt(
    adminId: string,
  ): Promise<{ failureCount: number; shouldAlert: boolean }> {
    try {
      const key = `admin:refresh_failures:${adminId}`;
      const failureWindow = 3600; // 1 hour window

      let current: any;
      try {
        current = await this.cacheService.get(key);
      } catch (error: any) {
        logger.warn("Failed to get failure count from cache", {
          adminId,
          error: error.message,
        });
        // If cache fails, return as if this is first failure
        return { failureCount: 1, shouldAlert: false };
      }

      const failureCount = (current?.count || 0) + 1;

      try {
        await this.cacheService.set(
          key,
          { count: failureCount, timestamp: Date.now() },
          failureWindow,
        );
      } catch (error: any) {
        logger.warn("Failed to record failure count in cache", {
          adminId,
          failureCount,
          error: error.message,
        });
        // Continue even if cache write fails - don't break auth flow
      }

      const shouldAlert = failureCount >= this.config.failureAlertThreshold;

      logger.warn(`Admin refresh failure recorded`, {
        adminId,
        failureCount,
        threshold: this.config.failureAlertThreshold,
      });

      return { failureCount, shouldAlert };
    } catch (error: any) {
      logger.error("Unexpected error in recordFailedRefreshAttempt", {
        adminId,
        error: error.message,
      });
      // Fail open - don't break auth on unexpected errors
      return { failureCount: 1, shouldAlert: false };
    }
  }


//Clear failed attempts on successful refresh
  async clearFailedRefreshAttempts(adminId: string): Promise<void> {
    try {
      const key = `admin:refresh_failures:${adminId}`;
      await this.cacheService.delete(key);
      logger.debug("Cleared failed refresh attempts", { adminId });
    } catch (error: any) {
      logger.warn("Failed to clear refresh attempts from cache", {
        adminId,
        error: error.message,
      });
      // Don't throw - this is non-critical
    }
  }


//Handle suspicious activity - BACKWARD COMPATIBLE
//Can be called with just decoded (old way) or with context (new way)
  async handleSuspiciousActivity(
    decoded: AdminRefreshTokenPayload,
    context?: TokenReuseContext,
  ): Promise<void> {
    try {
      // Invalidate the compromised token family
      await this.invalidateTokenFamily(decoded.family, decoded.adminId);

      // Log security incident
      const logPayload: any = {
        adminId: decoded.adminId,
        tokenId: decoded.tokenId,
        family: decoded.family,
        generation: decoded.generation,
        timestamp: Date.now(),
      };

      if (context) {
        logPayload.reason = context.reason;
        logPayload.timeSinceLastUse = context.timeSinceLastUse;
      }

      logger.error(
        `Security incident: Suspicious token reuse detected`,
        logPayload,
      );

      // Send alert
      const alertPayload: any = {
        severity: "warning",
        adminId: decoded.adminId,
        tokenId: decoded.tokenId,
        tokenFamily: decoded.family,
        detectedAt: new Date().toISOString(),
        actionTaken: ["Token family invalidated", "Session revoked"],
      };

      if (context) {
        alertPayload.reason = context.reason;
        alertPayload.timeSinceLastUse = context.timeSinceLastUse;
      }

      await this.emailService.sendSystemNotificationToAdmin(
        this.config.adminEmail,
        "⚠️ Security Alert: Suspicious Admin Token Activity",
        alertPayload,
        `Suspicious token activity detected for admin ${decoded.adminId}. Token family has been invalidated.`,
      );
    } catch (error: any) {
      // Don't let alert sending errors break the auth flow
      logger.error("Failed to handle suspicious activity", {
        adminId: decoded.adminId,
        error: error.message,
      });
      // Still invalidate the token family even if alert fails
      try {
        await this.invalidateTokenFamily(decoded.family, decoded.adminId);
      } catch (e: any) {
        logger.error("Failed to invalidate token family", {
          adminId: decoded.adminId,
          error: e.message,
        });
      }
    }
  }


//Simplified detection - use analyzeTokenReuse instead
//This is kept for backwards compatibility but delegates to the new method
  async detectTokenReuse(decoded: AdminRefreshTokenPayload): Promise<boolean> {
    const context = await this.analyzeTokenReuse(decoded);
    return context.isSuspicious;
  }

  decodeToken(token: string): any {
    try {
      return jwt.decode(token);
    } catch (error) {
      return null;
    }
  }

  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) return null;

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return null;

    return parts[1];
  }

  private getTokenExpirationTime(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 900;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      case "d":
        return value * 24 * 60 * 60;
      default:
        return 90000;
    }
  }

  isTokenExpired(token: string): boolean {
    try {
      const decoded: any = jwt.decode(token);
      if (!decoded || !decoded.exp) return true;

      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp < currentTime;
    } catch (error) {
      return true;
    }
  }

  getTimeUntilExpiration(token: string): number {
    try {
      const decoded: any = jwt.decode(token);
      if (!decoded || !decoded.exp) return 0;

      const currentTime = Math.floor(Date.now() / 1000);
      return Math.max(0, decoded.exp - currentTime);
    } catch (error) {
      return 0;
    }
  }

  isSuperAdmin(payload: AdminJWTPayload): boolean {
    return payload.adminLevel === "super_admin";
  }
}

export const adminJwtUtil = new AdminJWTUtil();
export default adminJwtUtil;
