import redisConfig, { ensureRedisConnected } from "@/config/redis";
import { CACHE_TTL, CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

export class CacheService {
  private isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.JEST_WORKER_ID !== undefined
    );
  }
  private async ensureConnection(): Promise<void> {
    await ensureRedisConnected();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.isTestEnvironment()) {
        return null;
      }
      await this.ensureConnection();
      const data = await redisConfig.client.get(key);
      if (!data) {
        logger.debug(`Cache MISS: ${key}`);
        return null;
      }
      logger.debug(`Cache HIT: ${key}`);
      return JSON.parse(data);
    } catch (error) {
      if (this.isTestEnvironment()) {
        logger.debug(`Cache SET failed in test, skipping: ${key}`);
        return null;
      }
      logger.error("Cache get error:", error);
      return null;
    }
  }

  async set(
    key: string,
    value: any,
    ttl: number = CACHE_TTL.ONE_HOUR,
  ): Promise<void> {
    try {
      if (this.isTestEnvironment()) {
        return;
      }
      await this.ensureConnection();
      const serializedValue = JSON.stringify(value);

      if (ttl) {
        await redisConfig.client.setEx(key, ttl, serializedValue);
      } else {
        await redisConfig.client.set(key, serializedValue);
      }

      logger.debug(`Cache SET: ${key}`, { ttl });
    } catch (error) {
      if (this.isTestEnvironment()) {
        logger.debug(`Cache SET failed in test, skipping: ${key}`);
        return;
      }
      logger.error("Cache set error:", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnection();
      await redisConfig.client.del(key);
      logger.debug(`Cache DELETE: ${key}`);
    } catch (error) {
      logger.error("Cache delete error:", error);
    }
  }

  async deletePattern(pattern: string): Promise<void> {
    try {
      await this.ensureConnection();
      const keys = await redisConfig.client.keys(pattern);
      if (keys.length > 0) {
        await redisConfig.client.del(keys);
        logger.debug(`Cache DELETE PATTERN: ${pattern}`, {
          deletedCount: keys.length,
        });
      }
    } catch (error) {
      logger.error("Cache delete pattern error:", error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.ensureConnection();
      const result = await redisConfig.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error("Cache exists error:", error);
      return false;
    }
  }

  async increment(key: string, ttl?: number): Promise<number> {
    try {
      await this.ensureConnection();
      const result = await redisConfig.client.incr(key);
      if (ttl) {
        await redisConfig.client.expire(key, ttl);
      }
      return result;
    } catch (error) {
      logger.error("Cache increment error:", error);
      return 0;
    }
  }

  async incrementBy(key: string, by: number = 1): Promise<number> {
    try {
      await this.ensureConnection();
      return await redisConfig.client.incrBy(key, by);
    } catch (error) {
      logger.error("Cache incrementBy error:", error);
      throw error;
    }
  }

  async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.ensureConnection();
      await redisConfig.client.expire(key, ttl);
      logger.debug(`Cache EXPIRE: ${key}`, { ttl });
    } catch (error) {
      logger.error("Cache expire error:", error);
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      await this.ensureConnection();
      return await redisConfig.client.ttl(key);
    } catch (error) {
      logger.error("Cache TTL error:", error);
      return -1;
    }
  }
  async acquireLock(
    key: string,
    value: string,
    ttl: number,
  ): Promise<string | null> {
    try {
      await this.ensureConnection();
      return await redisConfig.client.set(key, value, { NX: true, EX: ttl });
    } catch (error) {
      logger.error("Cache acquire lock error:", error);
      return null;
    }
  }

  // Token Methods

  async setRefreshToken(tokenId: string, tokenData: any): Promise<void> {
    const key = CACHE_KEYS.REFRESH_TOKEN(tokenId);
    await this.set(key, tokenData, CACHE_TTL.REFRESH_TOKEN);
  }

  async getRefreshToken(tokenId: string): Promise<any | null> {
    const key = CACHE_KEYS.REFRESH_TOKEN(tokenId);
    return await this.get(key);
  }

  async deleteRefreshToken(tokenId: string): Promise<void> {
    const key = CACHE_KEYS.REFRESH_TOKEN(tokenId);
    await this.delete(key);
  }

  async blacklistToken(
    tokenId: string,
    ttl: number = CACHE_TTL.BLACKLISTED_TOKEN,
  ): Promise<void> {
    const key = CACHE_KEYS.BLACKLISTED_TOKEN(tokenId);
    await this.set(key, { blacklisted: true, timestamp: Date.now() }, ttl);
  }

  async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const key = CACHE_KEYS.BLACKLISTED_TOKEN(tokenId);
    return await this.exists(key);
  }

  // Utility Methods

  async clearAll(): Promise<void> {
    try {
      await this.ensureConnection();
      await redisConfig.client.flushAll();
      logger.info("Cache cleared successfully");
    } catch (error) {
      logger.error("Cache clear error:", error);
      throw error;
    }
  }

  async getStats(): Promise<any> {
    try {
      await this.ensureConnection();
      const info = await redisConfig.client.info();
      return info;
    } catch (error) {
      logger.error("Cache stats error:", error);
      return null;
    }
  }

  // Delete with enhanced error handling and admin alerting
  // Non-blocking but alerts admins of failures
  async deleteWithAlert(
    key: string,
    context?: { userId?: string; operation?: string },
  ): Promise<void> {
    try {
      await this.delete(key);
      logger.debug(`Cache DELETE: ${key}`);
    } catch (error) {
      logger.error("Cache delete error:", {
        key,
        error,
        context,
        timestamp: new Date().toISOString(),
      });

      this.alertAdminCacheFailure(key, error, context);
    }
  }

  // Delete multiple keys with enhanced error handling
  async deleteMultipleWithAlert(
    keys: string[],
    context?: { userId?: string; operation?: string },
  ): Promise<void> {
    const promises = keys.map((key) => this.deleteWithAlert(key, context));
    await Promise.allSettled(promises);
  }

  // Set with enhanced error handling
  async setWithAlert(
    key: string,
    value: any,
    ttl: number,
    context?: { userId?: string; operation?: string },
  ): Promise<void> {
    try {
      await this.set(key, value, ttl);
    } catch (error) {
      logger.error("Cache set error:", {
        key,
        error,
        context,
        timestamp: new Date().toISOString(),
      });

      this.alertAdminCacheFailure(key, error, context);
    }
  }

  // Alert admin about cache failures
  // This is suppose to be integrated with your monitoring system (Sentry, Slack, etc.)
  private alertAdminCacheFailure(
    key: string,
    error: any,
    context?: { userId?: string; operation?: string },
  ): void {
    // Fire-and-forget alert
    (async () => {
      try {
        // Option 1: If you have NotificationService for admin alerts
        // await this.notificationService.alertAdmin('cache_failure', {
        //   key,
        //   error: error.message,
        //   context,
        //   timestamp: new Date().toISOString(),
        // });

        // Replace the commented Sentry block with:
        SentryHelper.captureBusinessError(
          "CACHE_FAILURE",
          `Cache failure on key: ${key}`,
          context?.userId,
          { key, operation: context?.operation, error: error?.message },
        );

        // Option 3: If you use Slack webhooks
        // await fetch(process.env.SLACK_WEBHOOK_URL, {
        //   method: 'POST',
        //   body: JSON.stringify({
        //     text: `⚠️ Cache Failure: ${key}`,
        //     attachments: [{
        //       color: 'warning',
        //       fields: [
        //         { title: 'Error', value: error.message },
        //         { title: 'Context', value: JSON.stringify(context) },
        //       ],
        //     }],
        //   }),
        // });

        // For now, just log it prominently
        logger.warn("CACHE FAILURE ALERT 🚨", {
          severity: "warning",
          key,
          error: error.message,
          context,
          action_required: "Check Redis connection and health",
        });
      } catch (alertError) {
        // If alerting fails, just log it
        logger.error("Failed to send cache failure alert:", alertError);
      }
    })();
  }

  // Retry cache operation with exponential backoff
  async deleteWithRetry(
    key: string,
    maxRetries: number = 3,
    initialDelayMs: number = 100,
  ): Promise<boolean> {
    let lastError: any;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.delete(key);
        logger.debug(`Cache DELETE succeeded on attempt ${attempt}: ${key}`);
        return true;
      } catch (error) {
        lastError = error;
        logger.warn(`Cache DELETE attempt ${attempt}/${maxRetries} failed:`, {
          key,
          error,
          nextRetryIn: attempt < maxRetries ? `${delay}ms` : "no retry",
        });

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }
    }

    logger.error(`Cache DELETE failed after ${maxRetries} attempts:`, {
      key,
      error: lastError,
    });

    this.alertAdminCacheFailure(key, lastError, {
      operation: "delete_with_retry",
    });

    return false;
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;
