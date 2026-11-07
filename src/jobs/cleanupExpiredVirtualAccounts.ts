import cron from "node-cron";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const virtualAccountRepository = new VirtualAccountRepository();

let isCleanupRunning = false;

export const startCleanupExpiredVirtualAccountsCron = () => {
  const job = cron.schedule("*/30 * * * *", async () => {
    if (isCleanupRunning) {
      logger.warn(
        "⚠️ Virtual account cleanup already running, skipping this cycle",
      );
      return;
    }

    isCleanupRunning = true;

    try {
      // await SentryHelper.wrapCronJob(
      //   "cleanup-virtual-accounts",
      //   "*/30 * * * *",
      //   async () => {
      logger.info("Checking for expired virtual accounts...");

      const now = new Date();

      const expiredAccounts = await virtualAccountRepository.find({
        type: "temporary",
        isActive: true,
        expiredAt: { $lt: now },
        provider: "saveHaven",
      });

      if (expiredAccounts.length === 0) {
        logger.debug("No expired temporary virtual accounts to clean up");
        return;
      }

      logger.info(`Found ${expiredAccounts.length} account(s) to clean up`);

      for (const account of expiredAccounts) {
        try {
          logger.info(`Deleting account: ${account.id}`);
          await virtualAccountRepository.delete(account.id.toString());
          logger.info(`Successfully deleted account: ${account.id}`);
        } catch (error: any) {
          logger.error(
            `Failed to delete account ${account.id}: ${error.message}`,
          );
          continue;
        }
      }
      //   },
      // );
    } catch (error: any) {
      logger.error(
        "Error in cleanup expired virtual accounts cron job:",
        error,
      );
    } finally {
      isCleanupRunning = false;
    }
  });

  logger.info(
    "Cleanup expired virtual accounts cron job started (runs every 30 minutes)",
  );
  return job;
};
