import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const webhookDeliveryService = ServiceContainer.getWebhookDeliveryService();
const emailService = ServiceContainer.getEmailService();

let isWebhookTimeoutRefundRunning = false;

export function startWebhookTimeoutRefundJob() {
  logger.info("Starting webhook timeout refund cron job...");

  const job = cron.schedule("*/15 * * * *", async () => {
    if (isWebhookTimeoutRefundRunning) {
      logger.warn(
        "⚠️ Webhook timeout refund job already running, skipping this cycle",
      );
      return;
    }

    isWebhookTimeoutRefundRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "webhook-timeout-refund",
        "*/15 * * * *",
        async () => {
          logger.info("Running webhook timeout refund check...");

          const result =
            await webhookDeliveryService.checkAndRefundTimeoutWebhooks();

          SentryHelper.addCronBreadcrumb("Webhook timeout check completed", {
            checkedCount: result.checkedCount,
            refundedCount: result.refundedCount,
            errorCount: result.errorCount,
          });

          logger.info("Webhook timeout refund check completed", {
            checkedCount: result.checkedCount,
            refundedCount: result.refundedCount,
            errorCount: result.errorCount,
          });

          if (result.errorCount > 0) {
            logger.warn(
              `⚠️ ${result.errorCount} webhook timeout refunds failed`,
              {
                checkedCount: result.checkedCount,
                refundedCount: result.refundedCount,
                errorCount: result.errorCount,
              },
            );

            await emailService
              .sendSystemNotificationToAdmin(
                process.env.SUPER_ADMIN_EMAIL ||
                  `admin@${process.env.APP_NAME?.toLowerCase()}.com`,
                `⚠️ Webhook Timeout Refund Failures - ${result.errorCount} failed`,
                {
                  severity: "warning",
                  checkedCount: result.checkedCount,
                  refundedCount: result.refundedCount,
                  errorCount: result.errorCount,
                  timestamp: new Date().toISOString(),
                  action: "REVIEW_WEBHOOK_TIMEOUT_LOGS",
                },
                `Webhook timeout refund job had ${result.errorCount} error(s). ${result.refundedCount}/${result.checkedCount} webhooks were successfully refunded. Please review logs for details.`,
              )
              .catch((err: any) => {
                logger.error("Failed to send webhook timeout error alert", err);
              });
          }

          if (result.refundedCount > 5) {
            logger.warn(
              `⚠️ High number of webhook timeout refunds: ${result.refundedCount}`,
              {
                checkedCount: result.checkedCount,
              },
            );

            await emailService
              .sendSystemNotificationToAdmin(
                process.env.ADMIN_EMAIL ||
                  `admin@${process.env.APP_NAME?.toLowerCase()}.com`,
                `ℹ️ Webhook Timeout Refund Report - ${result.refundedCount} refunds issued`,
                {
                  severity: "info",
                  checkedCount: result.checkedCount,
                  refundedCount: result.refundedCount,
                  timestamp: new Date().toISOString(),
                },
                `${result.refundedCount} webhook timeouts were detected and refunded. This may indicate issues with one or more webhook providers.`,
              )
              .catch((err: any) => {
                logger.error("Failed to send webhook timeout report", err);
              });
          }
        },
      );
    } catch (error: any) {
      logger.error("Webhook timeout refund job failed", error);

      try {
        await emailService.sendSystemNotificationToAdmin(
          process.env.SUPER_ADMIN_EMAIL ||
            `admin@${process.env.APP_NAME?.toLowerCase()}.com`,
          "CRITICAL: Webhook Timeout Refund Job Failed",
          {
            severity: "critical",
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            action: "IMMEDIATE_INVESTIGATION_REQUIRED",
          },
          `CRITICAL: The webhook timeout refund job has failed. This means customers whose webhooks timed out will NOT be refunded automatically. Immediate investigation required.`,
        );
      } catch (alertError: any) {
        logger.error(
          "Failed to send critical webhook timeout alert",
          alertError,
        );
      }
    } finally {
      isWebhookTimeoutRefundRunning = false;
    }
  });

  logger.info(
    "Webhook timeout refund cron job started (runs every 15 minutes)",
  );
  return job;
}

export async function getWebhookStatistics(): Promise<any> {
  try {
    return await webhookDeliveryService.getWebhookStats();
  } catch (error: any) {
    logger.error("Failed to get webhook statistics", error);
    throw error;
  }
}
