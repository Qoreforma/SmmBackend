import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const pollingService = ServiceContainer.getTransactionPollingService();

let isTransactionPollingRunning = false;

export function startTransactionPolling() {
  logger.info("Starting transaction polling cron job...");

  const job = cron.schedule("*/30 * * * * *", async () => {
    if (isTransactionPollingRunning) {
      logger.warn(
        "⚠️ Transaction polling already running, skipping this cycle",
      );
      return;
    }

    isTransactionPollingRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "transaction-polling",
        "*/30 * * * * *",
        async () => {
          await pollingService.pollPendingTransactions();
        },
      );
    } catch (error: any) {
      logger.error("Transaction polling cron job error", error);
    } finally {
      isTransactionPollingRunning = false;
    }
  });

  logger.info("Transaction polling cron job started (runs every 30 seconds)");
  return job;
}
