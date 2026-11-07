import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const providerReconciliationService =
  ServiceContainer.getProviderReconciliationService();
const emailService = ServiceContainer.getEmailService();

let isReconciliationRunning = false;

export function startDailyProviderReconciliationJob() {
  logger.info("Starting daily provider reconciliation cron job...");

  const job = cron.schedule("0 2 * * *", async () => {
    if (isReconciliationRunning) {
      logger.warn("⚠️ Reconciliation already running, skipping this cycle");
      return;
    }

    isReconciliationRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "daily-provider-reconciliation",
        "0 2 * * *",
        async () => {
          logger.info("Running daily provider reconciliation...");

          const result =
            await providerReconciliationService.reconcileAllProviders();

          SentryHelper.addCronBreadcrumb("Reconciliation complete", {
            totalDiscrepancies: result.totalDiscrepancies,
            criticalDiscrepancies: result.criticalDiscrepancies,
          });

          logger.info("T+1 settlement reconciliation completed", {
            totalDiscrepancies: result.totalDiscrepancies,
            criticalDiscrepancies: result.criticalDiscrepancies,
            saveHaven: result.saveHaven,
            monnify: result.monnify,
            flutterwave: result.flutterwave,
          });

          if (result.totalDiscrepancies > 0) {
            SentryHelper.addCronBreadcrumb("Sending admin notification", {
              discrepancies: result.totalDiscrepancies,
              critical: result.criticalDiscrepancies,
            });

            await emailService
              .sendSystemNotificationToAdmin(
                process.env.ADMIN_EMAIL ||
                  `admin@${process.env.APP_NAME?.toLowerCase()}.com`,
                `ℹ️ T+1 Settlement Reconciliation Report - ${result.totalDiscrepancies} discrepancy(ies)`,
                {
                  severity:
                    result.criticalDiscrepancies > 0 ? "critical" : "warning",
                  saveHaven: result.saveHaven
                    ? {
                        matched: result.saveHaven.matched,
                        discrepancies: result.saveHaven.discrepanciesCreated,
                      }
                    : "failed to reconcile",
                  monnify: result.monnify
                    ? {
                        matched: result.monnify.matched,
                        discrepancies: result.monnify.discrepanciesCreated,
                      }
                    : "failed to reconcile",
                  flutterwave: result.flutterwave
                    ? {
                        matched: result.flutterwave.matched,
                        discrepancies: result.flutterwave.discrepanciesCreated,
                      }
                    : "failed to reconcile",
                  totalDiscrepancies: result.totalDiscrepancies,
                  criticalCount: result.criticalDiscrepancies,
                  timestamp: new Date().toISOString(),
                },
                `T+1 settlement reconciliation found ${result.totalDiscrepancies} discrepancy(ies).

SaveHaven:    ${result.saveHaven ? `${result.saveHaven.matched} matched, ${result.saveHaven.discrepanciesCreated} discrepancies` : "failed"}
Monnify:      ${result.monnify ? `${result.monnify.matched} matched, ${result.monnify.discrepanciesCreated} discrepancies` : "failed"}
Flutterwave:  ${result.flutterwave ? `${result.flutterwave.matched} matched, ${result.flutterwave.discrepanciesCreated} discrepancies` : "failed"}

${result.criticalDiscrepancies > 0 ? `⚠️ ${result.criticalDiscrepancies} CRITICAL discrepancy(ies) require immediate attention.` : ""}`,
              )
              .catch((err: any) => {
                logger.error("Failed to send T+1 reconciliation report", err);
              });
          }
        },
      );
    } catch (error: any) {
      logger.error("Daily provider reconciliation job failed", error);

      try {
        await emailService.sendSystemNotificationToAdmin(
          process.env.SUPER_ADMIN_EMAIL ||
            `admin@${process.env.APP_NAME?.toLowerCase()}.com`,
          "CRITICAL: Daily Provider Reconciliation Job Failed",
          {
            severity: "critical",
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            action: "IMMEDIATE_INVESTIGATION_REQUIRED",
          },
          `CRITICAL: The daily provider reconciliation job has failed. We may not detect balance discrepancies. Immediate investigation required.`,
        );
      } catch (alertError: any) {
        logger.error(
          "Failed to send critical reconciliation alert",
          alertError,
        );
      }
    } finally {
      isReconciliationRunning = false;
    }
  });

  logger.info(
    "Daily provider reconciliation cron job started (runs daily at 2 AM)",
  );
  return job;
}

export async function triggerReconciliationNow(): Promise<any> {
  if (isReconciliationRunning) {
    logger.warn("⚠️ Reconciliation already running, manual trigger skipped");
    throw new Error("Reconciliation is already in progress");
  }

  isReconciliationRunning = true;

  try {
    logger.info("Manual reconciliation triggered");
    return await providerReconciliationService.reconcileAllProviders();
  } catch (error: any) {
    logger.error("Manual reconciliation failed", error);
    throw error;
  } finally {
    isReconciliationRunning = false;
  }
}

export async function getUnresolvedDiscrepancies(
  limit: number = 10,
): Promise<any> {
  try {
    return await providerReconciliationService.getUnresolvedDiscrepancies(
      limit,
    );
  } catch (error: any) {
    logger.error("Failed to get unresolved discrepancies", error);
    throw error;
  }
}
