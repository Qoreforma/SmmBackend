import cron from "node-cron";
import { AlertRepository } from "@/repositories/admin/AlertRepository";
import logger from "@/logger";
import AdminServiceContainer from "@/services/admin/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
const alertService = AdminServiceContainer.getAlertService();
const alertRepository = new AlertRepository();

let isAlertDispatchRunning = false;

export const startAlertDispatchCron = () => {
  const job = cron.schedule("* * * * *", async () => {
    if (isAlertDispatchRunning) {
      logger.warn("⚠️ Alert dispatch already running, skipping this cycle");
      return;
    }

    isAlertDispatchRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "alert-dispatch",
        "* * * * *",
        async () => {
          logger.info("Checking for alerts ready to dispatch...");

          const readyAlerts = await alertRepository.findReadyForDispatch();

          if (readyAlerts.length === 0) {
            logger.debug("No alerts ready for dispatch");
            return;
          }

          logger.info(`Found ${readyAlerts.length} alert(s) ready to dispatch`);

          for (const alert of readyAlerts) {
            try {
              logger.info(`Dispatching alert: ${alert._id}`);
              await alertService.dispatchAlert(alert.id.toString());
              logger.info(`Successfully dispatched alert: ${alert._id}`);
            } catch (error: any) {
              logger.error(
                `Failed to dispatch alert ${alert._id}: ${error.message}`,
              );
              continue;
            }
          }
        },
      );
    } catch (error: any) {
      logger.error("Error in alert dispatch cron job:", error);
    } finally {
      isAlertDispatchRunning = false;
    }
  });

  logger.info("Alert dispatch cron job started (runs every minute)");
  return job;
};
