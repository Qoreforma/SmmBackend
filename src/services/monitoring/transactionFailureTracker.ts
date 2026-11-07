import cacheService from "@/services/core/CacheService";
import ServiceContainer from "@/services/client/container";
import { User } from "@/models/core/User";
import { CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";
import Sentry from "@/config/sentry";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { notifyAdminsOfSystemAction } from "@/utils/adminNotifier";

const FAILURE_THRESHOLDS: Record<string, { max: number; windowSec: number }> = {
  service: { max: 8, windowSec: 600 },
  transfer: { max: 6, windowSec: 600 },
  withdrawal: { max: 5, windowSec: 600 },
};

const TYPE_TO_CATEGORY: Record<string, string> = {
  smm: "service",
  game_topup: "service",
  number_rental: "service",
  proxy: "service",
  wallet_transfer: "transfer",
  withdrawal: "withdrawal",
};

const SHADOW_BAN_KEY = (userId: string) => `shadow:ban:tracked:${userId}`;
const getAdminRepository = () => ServiceContainer.getAdminRepository();
export const recordTransactionFailure = (
  userId: string,
  transactionType: string,
): void => {
  (async () => {
    try {
      const category = TYPE_TO_CATEGORY[transactionType];
      if (!category) return;

      const threshold = FAILURE_THRESHOLDS[category];
      const failKey = `txn:failures:${userId}:${category}`;

      const count = await cacheService.increment(failKey, threshold.windowSec);

      if (count >= threshold.max) {
        const alreadyBanned = await cacheService.exists(SHADOW_BAN_KEY(userId));
        if (alreadyBanned) return;

        await cacheService.set(
          SHADOW_BAN_KEY(userId),
          { bannedAt: Date.now() },
          86400,
        );

        await User.findByIdAndUpdate(userId, { status: "shadow-banned" });
        SentryHelper.captureBusinessError(
          "USER_SHADOW_BANNED",
          `User auto shadow-banned after ${count} failed ${category} transactions`,
          userId,
          { category, transactionType, failureCount: count },
        );
        await cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));

        logger.warn(`User shadow-banned: ${userId}`, {
          category,
          failureCount: count,
          transactionType,
        });

        notifyAdminOfShadowBan(userId, category, transactionType, count).catch(
          (err) => logger.error("Failed to notify admin of shadow ban:", err),
        );
      }
    } catch (error) {
      logger.error("Transaction failure tracker error:", error);
      Sentry.captureException(error, {
        tags: { operation: "recordTransactionFailure", userId },
      });
    }
  })();
};

export const recordTransactionSuccess = (
  userId: string,
  transactionType: string,
): void => {
  (async () => {
    try {
      const category = TYPE_TO_CATEGORY[transactionType];
      if (!category) return;
      await cacheService.delete(`txn:failures:${userId}:${category}`);
    } catch (error) {
      logger.error("Failed to clear transaction failure count:", error);
    }
  })();
};

const notifyAdminOfShadowBan = async (
  userId: string,
  category: string,
  transactionType: string,
  failureCount: number,
): Promise<void> => {
  await notifyAdminsOfSystemAction(
    `⚠️ User Shadow-Banned: ${userId}`,
    {
      severity: "warning",
      userId,
      category,
      triggeringTransactionType: transactionType,
      failureCount,
      action:
        "User status set to shadow-banned. Review and confirm or reverse via admin panel.",
      timestamp: new Date().toISOString(),
    },
    `User ${userId} has been automatically shadow-banned after ${failureCount} failed ${category} transactions. Manual review required.`
  );
};
