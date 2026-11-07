import { Request, Response, NextFunction } from "express";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import cacheService from "@/services/core/CacheService";
import { User } from "@/models/core/User";
import logger from "@/logger";
import { AuthRequest } from "../client/auth";
import { notifyAdminsOfSystemAction } from "@/utils/adminNotifier";

interface LoginAttemptConfig {
  thresholds: Array<{
    attempts: number;
    lockoutDurationMs: number;
  }>;
}
const DEFAULT_CONFIG: LoginAttemptConfig = {
  // IMPORTANT: attempts must be in ascending order and must differ
  // After reaching each threshold, user gets locked out for the specified duration
  thresholds: [
    { attempts: 10, lockoutDurationMs: 1 * 60 * 1000 }, // After 3 attempts: lock 1 mins
    { attempts: 20, lockoutDurationMs: 2 * 60 * 1000 }, // After 20 attempts: lock 2 mins
    { attempts: 30, lockoutDurationMs: 3 * 60 * 1000 }, // After 30 attempts: lock 3 mins
  ],
};

const CACHE_KEY_LOGIN_ATTEMPTS = CACHE_KEYS.LOGIN_ATTEMPTS;
const CACHE_KEY_LOGIN_LOCKOUT = CACHE_KEYS.LOGIN_LOCKOUT;

interface AttemptData {
  count: number;
  firstAttemptTime: number;
  lastAttemptTime: number;
}
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter = (
  maxAttempts: number,
  windowMs: number,
  lockoutDurationMs?: number,
) => {
  // If lockout duration not provided, use same as tracking window
  const actualLockoutDuration = lockoutDurationMs || windowMs;
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next();
      }

      const ip = getClientIp(req);
      const route = req.route?.path || req.path;

      const identifier = `${userId}:${ip}`;
      const routeKey = `rate:${identifier}:${route}`;
      const attemptsKey = `${routeKey}:attempts`;
      const lockedKey = `${routeKey}:locked`;

      // Store on request for potential debugging/logging
      (req as any).rateLimitIdentifier = identifier;
      (req as any).rateLimitRoute = route;
      (req as any).rateLimitAttemptsKey = attemptsKey;

      // Check if currently locked out for this route
      const isLocked = await cacheService.exists(lockedKey);
      if (isLocked) {
        const remainingTtl = await cacheService.ttl(lockedKey);
        const remainingSeconds = Math.ceil(Math.max(remainingTtl, 0));

        logger.warn(`[RATE_LIMIT] User locked out: ${identifier} on ${route}`, {
          remainingSeconds,
          timestamp: new Date().toISOString(),
        });

        return sendErrorResponse(
          res,
          `Too many failed attempts. Try again in ${remainingSeconds} seconds`,
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          { retryAfter: remainingSeconds },
        );
      }

      // Intercept res.json() to detect success/failure from response
      const originalJson = res.json.bind(res);

      res.json = function (body: any) {
        // Detect success/failure based on response.success field
        const isSuccess = body?.success === true;
        const statusCode = res.statusCode;

        // Skip counting 401 (auth) and 422 (validation) errors
        const shouldSkipRateLimit = statusCode === 401 || statusCode === 422;

        // Handle success: clear the counter
        if (isSuccess) {
          cacheService.delete(attemptsKey).catch((err) => {
            logger.error(
              `[RATE_LIMIT] Failed to clear attempts: ${attemptsKey}`,
              {
                error: err.message,
              },
            );
          });

          logger.debug(
            `[RATE_LIMIT] Attempt cleared (success): ${identifier} on ${route}`,
          );
        }
        // Handle failure: increment counter (unless 401 or 422)
        else if (!shouldSkipRateLimit) {
          // Increment the failure counter
          cacheService
            .increment(attemptsKey, Math.floor(windowMs / 1000))
            .then(async (attempts) => {
              logger.debug(
                `[RATE_LIMIT] Attempt incremented: ${identifier} on ${route}`,
                {
                  attempts,
                  maxAttempts,
                  windowMs,
                },
              );

              if (attempts >= maxAttempts) {
                // Lock them out
                await cacheService.set(
                  lockedKey,
                  {
                    lockedAt: Date.now(),
                    attempts,
                    route,
                    reason: "Too many failed attempts",
                  },
                  Math.floor(actualLockoutDuration / 1000),
                );

                logger.warn(
                  `[RATE_LIMIT] User locked: ${identifier} on ${route}`,
                  {
                    attempts,
                    maxAttempts,
                    trackingWindowMs: windowMs,
                    lockoutDurationMs: actualLockoutDuration,
                    timestamp: new Date().toISOString(),
                  },
                );
              }
            })
            .catch((err) => {
              logger.error(
                `[RATE_LIMIT] Failed to increment attempts: ${attemptsKey}`,
                {
                  error: err.message,
                },
              );
            });
        } else {
          // 401 or 422: just log, don't count
          logger.debug(
            `[RATE_LIMIT] Status ${statusCode} skipped (no rate limit increment)`,
            {
              identifier,
              route,
            },
          );
        }

        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error("[RATE_LIMIT] Middleware error:", error);
      next();
    }
  };
};



const getClientIp = (req: Request): string => {
  return req.ip || req.socket.remoteAddress || "unknown";
};

export const loginRateLimiter = (
  config: LoginAttemptConfig = DEFAULT_CONFIG,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email?.toLowerCase() || "";
      const ip = getClientIp(req);

      // Combine email + IP for better security
      // This prevents: account enumeration, distributed attacks, and accidental lockouts
      const identifier = `${email}:${ip}`;

      // Also track IP separately for brute force detection across different accounts
      const ipIdentifier = `ip:${ip}`;
      (req as any).ipIdentifier = ipIdentifier;

      // Check if user is locked out
      const lockoutKey = CACHE_KEY_LOGIN_LOCKOUT(identifier);
      const isLockedOut = await cacheService.exists(lockoutKey);

      if (isLockedOut) {
        const remainingTTL = await cacheService.ttl(lockoutKey);
        const remainingSeconds = Math.ceil(remainingTTL);

        return sendErrorResponse(
          res,
          `Account temporarily locked. Try again in ${remainingSeconds} seconds`,
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          { retryAfter: remainingSeconds },
        );
      }

      // Store identifier in request for later use (after successful/failed login)
      (req as any).loginIdentifier = identifier;

      next();
    } catch (error) {
      logger.error("Login rate limiter error:", error);
      (req as any).loginIdentifier = req.body.email || req.ip || "unknown";
      next();
    }
  };
};

export const recordFailedLoginAttempt = async (
  identifier: string,
): Promise<void> => {
  try {
    const attemptKey = CACHE_KEY_LOGIN_ATTEMPTS(identifier);
    const lockoutKey = CACHE_KEY_LOGIN_LOCKOUT(identifier);

    const existingData = await cacheService.get<AttemptData>(attemptKey);

    let attemptData: AttemptData;
    if (!existingData) {
      attemptData = {
        count: 1,
        firstAttemptTime: Date.now(),
        lastAttemptTime: Date.now(),
      };
    } else {
      attemptData = {
        count: existingData.count + 1,
        firstAttemptTime: existingData.firstAttemptTime,
        lastAttemptTime: Date.now(),
      };
    }

    await cacheService.set(attemptKey, attemptData, 24 * 60 * 60);

    const config = DEFAULT_CONFIG;
    const applicableThreshold = [...config.thresholds]
      .sort((a, b) => b.attempts - a.attempts)
      .find((t) => attemptData.count >= t.attempts);

    if (applicableThreshold) {
      const isMaxThreshold =
        attemptData.count >=
        config.thresholds[config.thresholds.length - 1].attempts;

      if (isMaxThreshold) {
        const email = identifier.split(":")[0];

        if (email) {
          const user = await User.findOne({ email }).select("_id").lean();

          if (user) {
            User.findByIdAndUpdate(user._id, {
              twofactorEnabled: true,
              twoFactorEnabledAt: new Date(),
              twoFactorForcedBySystem: true,
            }).catch((err) => logger.error("Failed to force-enable 2FA:", err));

            cacheService
              .delete(CACHE_KEYS.USER_PROFILE(user._id.toString()))
              .catch((err) => logger.error("Failed to invalidate cache:", err));
          }
        }
      }

      await cacheService.set(
        lockoutKey,
        {
          lockedAt: Date.now(),
          attemptCount: attemptData.count,
          reason: "Too many failed login attempts",
        },
        Math.floor(applicableThreshold.lockoutDurationMs / 1000),
      );

      logger.warn(`Login lockout set for ${identifier}`, {
        attempts: attemptData.count,
        duration: applicableThreshold.lockoutDurationMs,
        forcedTwoFactor: isMaxThreshold,
        timestamp: new Date().toISOString(),
      });

      if (isMaxThreshold) {
        notifyAdminsOfSystemAction(
          `⚠️ User Account Locked: ${identifier}`,
          {
            severity: "critical",
            identifier,
            attempts: attemptData.count,
            action: "User account locked and 2FA forced due to too many failed login attempts.",
            timestamp: new Date().toISOString(),
          },
          `User account for ${identifier} has been locked after ${attemptData.count} failed login attempts.`
        ).catch((err) => logger.error("Failed to notify admins of lockout:", err));
      }
    }
  } catch (error) {
    logger.error("Failed to record login attempt:", error);
  }
};
export const recordSuccessfulLogin = async (
  identifier: string,
): Promise<void> => {
  try {
    const attemptKey = CACHE_KEY_LOGIN_ATTEMPTS(identifier);
    const lockoutKey = CACHE_KEY_LOGIN_LOCKOUT(identifier);

    // Clear attempt tracking
    await cacheService.delete(attemptKey);
    await cacheService.delete(lockoutKey);

    logger.info(`Login attempts cleared for ${identifier}`);
  } catch (error) {
    logger.error("Failed to clear login attempts:", error);
    // Don't throw - login was successful, log error but continue
  }
};

export const getLoginAttempts = async (
  identifier: string,
): Promise<AttemptData | null> => {
  try {
    return await cacheService.get<AttemptData>(
      CACHE_KEY_LOGIN_ATTEMPTS(identifier),
    );
  } catch (error) {
    logger.error("Failed to get login attempts:", error);
    return null;
  }
};

export const getLoginLockoutStatus = async (
  identifier: string,
): Promise<{ isLockedOut: boolean; remainingSeconds: number } | null> => {
  try {
    const lockoutKey = CACHE_KEY_LOGIN_LOCKOUT(identifier);
    const isLockedOut = await cacheService.exists(lockoutKey);

    if (!isLockedOut) {
      return { isLockedOut: false, remainingSeconds: 0 };
    }

    const ttl = await cacheService.ttl(lockoutKey);
    return { isLockedOut: true, remainingSeconds: Math.ceil(ttl) };
  } catch (error) {
    logger.error("Failed to get lockout status:", error);
    return null;
  }
};

// IP-based rate limiter to detect distributed attacks
// Tracks login attempts from same IP across ALL accounts
export const ipBasedRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const ip = getClientIp(req);
    const ipIdentifier = `ip:${ip}`;
    const ipLockoutKey = `${ipIdentifier}:lockout`;

    // Check if IP is locked out (too many attempts across different accounts)
    const isIpLockedOut = await cacheService.exists(ipLockoutKey);
    if (isIpLockedOut) {
      const ttl = await cacheService.ttl(ipLockoutKey);
      return sendErrorResponse(
        res,
        `Too many login attempts from your IP. Try again in ${Math.ceil(
          ttl,
        )} seconds`,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        { retryAfter: Math.ceil(ttl) },
      );
    }

    (req as any).ipIdentifier = ipIdentifier;
    next();
  } catch (error) {
    logger.error("IP rate limiter error:", error);
    (req as any).ipIdentifier = `ip:${getClientIp(req)}`;
    next();
  }
};
export const recordSuccessfulLoginByIp = async (
  ipIdentifier: string,
): Promise<void> => {
  try {
    const ipKey = `${ipIdentifier}:attempts`;
    await cacheService.delete(ipKey);
    logger.info(`IP attempt counter cleared: ${ipIdentifier}`);
  } catch (error) {
    logger.error("Failed to clear IP login attempts:", error);
  }
};
// Track failed login attempts by IP to detect distributed attacks
// After 20 failed logins from same IP within 1 hour → lock IP for 30 minutes
export const recordFailedLoginAttemptByIp = async (
  ipIdentifier: string,
): Promise<void> => {
  try {
    const ipKey = `${ipIdentifier}:attempts`;
    const ipLockoutKey = `${ipIdentifier}:lockout`;

    // Increment IP attempt counter
    const attempts = await cacheService.increment(ipKey, 3600); // 1 hour TTL

    // If 20+ attempts from this IP, lock it
    if (attempts >= 20) {
      await cacheService.set(
        ipLockoutKey,
        { lockedAt: Date.now(), reason: "Too many login attempts" },
        1800, // 30 minutes
      );

      logger.warn(`IP locked out: ${ipIdentifier}`, {
        attempts,
        duration: "30 minutes",
      });

      notifyAdminsOfSystemAction(
        `⚠️ IP Locked Out: ${ipIdentifier}`,
        {
          severity: "high",
          ipIdentifier,
          attempts,
          action: "IP locked out for 30 minutes due to too many failed login attempts.",
          timestamp: new Date().toISOString(),
        },
        `The IP address ${ipIdentifier} has been locked out after ${attempts} failed login attempts.`
      ).catch((err) => logger.error("Failed to notify admins of IP lockout:", err));
    }
  } catch (error) {
    logger.error("Failed to record IP login attempt:", error);
  }
};

export const getRateLimitStatus = async (
  userId: string,
  ip: string,
  route: string,
) => {
  try {
    const identifier = `${userId}:${ip}`;
    const routeKey = `rate:${identifier}:${route}`;
    const attemptsKey = `${routeKey}:attempts`;
    const lockedKey = `${routeKey}:locked`;

    const attempts = await cacheService.get<number>(attemptsKey);
    const isLocked = await cacheService.exists(lockedKey);
    const lockTtl = isLocked ? await cacheService.ttl(lockedKey) : null;

    return {
      identifier,
      route,
      attempts: attempts || 0,
      isLocked,
      remainingLockSeconds: isLocked
        ? Math.ceil(Math.max(lockTtl || 0, 0))
        : null,
    };
  } catch (error) {
    logger.error("[RATE_LIMIT] Failed to get status:", error);
    return null;
  }
};

export const clearRateLimit = async (
  userId: string,
  ip: string,
  route: string,
) => {
  try {
    const identifier = `${userId}:${ip}`;
    const routeKey = `rate:${identifier}:${route}`;
    const attemptsKey = `${routeKey}:attempts`;
    const lockedKey = `${routeKey}:locked`;

    await cacheService.delete(attemptsKey);
    await cacheService.delete(lockedKey);

    logger.info(`[RATE_LIMIT] Manually cleared: ${identifier} on ${route}`);
    return true;
  } catch (error) {
    logger.error("[RATE_LIMIT] Failed to clear rate limit:", error);
    return false;
  }
};

/**
 * Global IP Rate Limiter
 * Provides broad protection against denial-of-service, rapid vulnerability probing,
 * and high-frequency scrapers across all routes.
 * Defaults to max 300 requests per 60 seconds per IP.
 */
export const globalIpRateLimiter = (
  maxRequests: number = 300,
  windowSeconds: number = 60,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = getClientIp(req);
      if (!ip || ip === "unknown") {
        return next();
      }

      const key = `ratelimit:global:${ip}`;
      const count = await cacheService.increment(key, windowSeconds);

      if (count > maxRequests) {
        logger.warn(
          `[GLOBAL_RATE_LIMIT] IP exceeded limit: ${ip} (${count} reqs)`,
        );
        res.setHeader("Retry-After", windowSeconds);
        return sendErrorResponse(
          res,
          "Too many requests, please slow down.",
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          { retryAfter: windowSeconds },
        );
      }

      next();
    } catch (error) {
      // Fail-open: do not block valid users if cache is temporarily unreachable
      next();
    }
  };
};

