import logger from "@/logger";
import Sentry from "@/config/sentry";
import { User } from "@/models/core/User";
import cacheService from "@/services/core/CacheService";
import { CACHE_KEYS } from "@/utils/constants";
import { notifyAdminsOfSystemAction } from "@/utils/adminNotifier";

interface PinAttemptConfig {
  thresholds: Array<{
    attempts: number;
    lockoutDurationMs: number;
  }>;
}

const PIN_CONFIG: PinAttemptConfig = {
  thresholds: [
    { attempts: 5, lockoutDurationMs: 1 * 60 * 1000 }, // 1 min
    { attempts: 10, lockoutDurationMs: 2 * 60 * 1000 }, // 2 mins
    { attempts: 15, lockoutDurationMs: 3 * 60 * 1000 }, // 3 mins
    { attempts: 20, lockoutDurationMs: 4 * 60 * 1000 }, // 4 mins
  ],
};

export const checkPinLockout = async (
  userId: string,
): Promise<{ locked: boolean; remainingSeconds: number }> => {
  try {
    const lockoutKey = CACHE_KEYS.PIN_LOCKOUT(userId);
    const isLocked = await cacheService.exists(lockoutKey);

    if (!isLocked) return { locked: false, remainingSeconds: 0 };

    const remainingSeconds = Math.ceil(await cacheService.ttl(lockoutKey));
    return { locked: true, remainingSeconds };
  } catch (error) {
    return { locked: false, remainingSeconds: 0 };
  }
};

export const recordFailedPinAttempt = (userId: string): void => {
  (async () => {
    try {
      const attemptsKey = CACHE_KEYS.PIN_ATTEMPTS(userId);
      const lockoutKey = CACHE_KEYS.PIN_LOCKOUT(userId);

      const attempts = await cacheService.increment(attemptsKey, 86400);

      const applicableThreshold = PIN_CONFIG.thresholds
        .sort((a, b) => b.attempts - a.attempts)
        .find((t) => attempts >= t.attempts);

      if (applicableThreshold) {
        const isMaxThreshold = attempts >= 20;

        // TODO: If 20 attempts reached, enable 2FA and logout user
        if (isMaxThreshold) {
          logger.warn(`PIN max attempts reached for user ${userId}`);

          try {
            Sentry.captureMessage(
              `PIN max attempts reached - forcing 2FA enablement`,
              {
                level: "warning",
                tags: {
                  userId,
                  event: "pin_forced_2fa",
                  attempts: attempts.toString(),
                },
              },
            );
          } catch (sentryErr) {
            logger.error(
              "[Sentry] Failed to capture PIN forced 2FA:",
              sentryErr,
            );
          }

          User.findByIdAndUpdate(userId, {
            twofactorEnabled: true,
            twoFactorEnabledAt: new Date(),
            twoFactorForcedBySystem: true,
          }).catch((err) => logger.error("Failed to force-enable 2FA:", err));

          cacheService
            .delete(CACHE_KEYS.USER_PROFILE(userId.toString()))
            .catch((err) => logger.error("Failed to invalidate cache:", err));
            
          notifyAdminsOfSystemAction(
            `⚠️ User PIN Locked: ${userId}`,
            {
              severity: "critical",
              userId,
              attempts,
              action: "User account locked and 2FA forced due to too many failed PIN attempts.",
              timestamp: new Date().toISOString(),
            },
            `User account for ${userId} has been locked after ${attempts} failed PIN attempts.`
          ).catch((err) => logger.error("Failed to notify admins of PIN lockout:", err));
          //TODO: Logout user from all sessions
        } else {
          try {
            Sentry.captureMessage(`PIN lockout threshold reached`, {
              level: "warning",
              tags: {
                userId,
                event: "pin_lockout_threshold",
                attempts: attempts.toString(),
                lockoutDurationMs:
                  applicableThreshold.lockoutDurationMs.toString(),
              },
            });
          } catch (sentryErr) {
            logger.error(
              "[Sentry] Failed to capture PIN lockout threshold:",
              sentryErr,
            );
          }
        }

        await cacheService.set(
          lockoutKey,
          {
            lockedAt: Date.now(),
            attempts,
            reason: "Too many failed PIN attempts",
          },
          Math.floor(applicableThreshold.lockoutDurationMs / 1000),
        );
      }
    } catch (error) {
      logger.error("Failed to record PIN attempt:", error);
    }
  })();
};

export const recordSuccessfulPin = (userId: string): void => {
  (async () => {
    try {
      await cacheService.delete(CACHE_KEYS.PIN_ATTEMPTS(userId));
      await cacheService.delete(CACHE_KEYS.PIN_LOCKOUT(userId));
    } catch (error) {
      logger.error("Failed to clear PIN attempts:", error);
    }
  })();
};
