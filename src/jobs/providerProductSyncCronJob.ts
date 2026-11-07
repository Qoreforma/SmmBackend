import cron from "node-cron";
import { ProductSyncService } from "@/services/sync/ProductSyncService";
import { Provider } from "@/models/reference/Provider";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const productSyncService = new ProductSyncService();
let isProductSyncRunning = false;

/**
 * Daily midnight cron job to sync all products from active providers
 * that support automatic product syncing (`hasSync: true`).
 */
export function startProviderProductSyncCronJob() {
  logger.info(
    "Initializing daily provider product sync cron job (scheduled for 00:00 midnight)...",
  );

  // Run at midnight every day (00:00)
  const job = cron.schedule("0 0 * * *", async () => {
    if (isProductSyncRunning) {
      logger.warn(
        "⚠️ Daily provider product sync is already running, skipping this cycle",
      );
      return;
    }

    isProductSyncRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "daily-provider-product-sync",
        "0 0 * * *",
        async () => {
          logger.info(
            "Starting midnight sync for all active sync-enabled providers...",
          );

          const providers = await Provider.find({
            isActive: true,
            hasSync: true,
          });

          if (!providers || providers.length === 0) {
            logger.info("No active sync-enabled providers found to sync.");
            return;
          }

          logger.info(
            `Found ${providers.length} active sync-enabled provider(s) to sync.`,
          );

          for (const provider of providers) {
            try {
              logger.info(
                `Syncing products for provider: ${provider.name} (${provider.code})...`,
              );
              const syncResult = await productSyncService.syncProviderProducts(
                provider.id.toString(),
              );

              logger.info(
                `Product sync completed for ${provider.name} (${provider.code}):`,
                {
                  created: syncResult.created,
                  updated: syncResult.updated,
                  failed: syncResult.failed,
                  total: syncResult.total,
                  duration: syncResult.duration,
                },
              );

              SentryHelper.addCronBreadcrumb(
                `Product sync complete: ${provider.code}`,
                {
                  provider: provider.code,
                  created: syncResult.created,
                  updated: syncResult.updated,
                  failed: syncResult.failed,
                  total: syncResult.total,
                  duration: syncResult.duration,
                },
              );
            } catch (providerError: any) {
              logger.error(
                `Failed to sync products for provider ${provider.name} (${provider.code}):`,
                providerError.message,
              );
            }
          }

          logger.info("Daily provider product sync cycle completed.");
        },
      );
    } catch (error: any) {
      logger.error("Error during daily provider product sync:", error);
    } finally {
      isProductSyncRunning = false;
    }
  });

  return job;
}
