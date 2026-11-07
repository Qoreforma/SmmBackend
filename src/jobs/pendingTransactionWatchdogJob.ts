import cron from "node-cron";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { PendingTransactionWatchdogService } from "@/services/admin/transactions/PendingTransactionWatchdogService";

const watchdogService = new PendingTransactionWatchdogService();
let isWatchdogRunning = false;

/**
 * Starts the recurring watchdog cron job that checks for transactions stuck in
 * pending or processing status past 30 minutes, or whose background polling halted,
 * and notifies admins via email and in-app notifications.
 *
 * Runs every 10 minutes.
 */
export function startPendingTransactionWatchdogJob() {
  logger.info("Starting Pending Transaction Watchdog cron job (runs every 10 minutes)...");

  const job = cron.schedule("*/10 * * * *", async () => {
    if (isWatchdogRunning) {
      logger.warn(
        "⚠️ Pending Transaction Watchdog already running, skipping this cycle",
      );
      return;
    }

    isWatchdogRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "pending-transaction-watchdog",
        "*/10 * * * *",
        async () => {
          logger.info("[Watchdog] Scanning for stuck/pending transactions...");
          const result = await watchdogService.checkAndAlertPendingTransactions();

          SentryHelper.addCronBreadcrumb("Pending transaction watchdog completed", {
            checkedCount: result.checkedCount,
            alertedCount: result.alertedCount,
            skippedCooldownCount: result.skippedCooldownCount,
          });

          logger.info("[Watchdog] Scan completed", {
            checkedCount: result.checkedCount,
            alertedCount: result.alertedCount,
            skippedCooldownCount: result.skippedCooldownCount,
          });
        },
      );
    } catch (error: any) {
      logger.error("[Watchdog] Error during pending transaction check:", error);
    } finally {
      isWatchdogRunning = false;
    }
  });

  return job;
}
