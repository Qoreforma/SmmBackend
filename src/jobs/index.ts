import cron from "node-cron";
import logger from "@/logger";
import { startAlertDispatchCron } from "./alertDispatchCronJobs";
import { startCleanupExpiredVirtualAccountsCron } from "./cleanupExpiredVirtualAccounts";
import { startPaymentReconciliationJobs } from "./paymentReconciliation";
import { startReferralBonusCrons } from "./referralBonusCron";
import { startTransactionPolling } from "./transactionPolling";
import { startUserLifecycleCron } from "./userLifecycleCron";
import { startAlertBatchCron } from "./alertBatchCronJobs";
import { SafeHavenPendingVerificationJob } from "./SafeHavenPendingVerificationJob";
import { startPendingTransactionWatchdogJob } from "./pendingTransactionWatchdogJob";

const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";

let isSafeHavenPendingVerificationRunning = false;
const safeHavenPendingVerificationJob = new SafeHavenPendingVerificationJob();

// Every 5 minutes: re-verify SafeHaven deposits left "pending" by
// SaveHavenWebhookService because they couldn't be confirmed directly
// against SafeHaven at webhook time. See SafeHavenPendingVerificationJob
// for details - this is the only place those deposits ever get credited.
function startSafeHavenPendingVerificationJob() {
  return cron.schedule("*/5 * * * *", async () => {
    if (isSafeHavenPendingVerificationRunning) {
      logger.warn(
        "⚠️ SafeHaven pending verification already running, skipping this cycle",
      );
      return;
    }

    isSafeHavenPendingVerificationRunning = true;
    try {
      await safeHavenPendingVerificationJob.execute();
    } finally {
      isSafeHavenPendingVerificationRunning = false;
    }
  });
}

export function startAllCronJobs(): any[] {
  logger.info(`Starting cron jobs in [${environment}] mode...`);

  const jobs: any[] = [
    startTransactionPolling(),
    startPendingTransactionWatchdogJob(),
    startCleanupExpiredVirtualAccountsCron(),
    // startProviderProductSyncCronJob(), // Midnight (00:00) product sync for all active sync-enabled providers
  ];

  if (isProduction) {
    jobs.push(
      startAlertDispatchCron(),
      startAlertBatchCron(),
      startUserLifecycleCron(),
      ...startPaymentReconciliationJobs(),
      ...startReferralBonusCrons(),
      startSafeHavenPendingVerificationJob(),
    );

    logger.info("Production-only cron jobs started");
  } else {
    logger.info("Skipping production-only cron jobs in development mode");
  }

  logger.info("All cron jobs initialized");
  return jobs;
}