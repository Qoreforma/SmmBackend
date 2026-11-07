import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { Transaction } from "@/models/wallet/Transaction";
import cacheService from "@/services/core/CacheService";

let isReconciliationRunning = false;
let isCriticalCheckRunning = false;
let isStaleManualCheckRunning = false;

const paymentReconciliationService =
  ServiceContainer.getPaymentReconciliationService();
const emailService = ServiceContainer.getEmailService();

export function startPaymentReconciliationJobs() {
  logger.info("Starting payment reconciliation cron jobs...");

  // Every 5 minutes: Reconcile pending withdrawals and bank transfers
  const reconciliationJob = cron.schedule("*/1 * * * *", async () => {
    if (isReconciliationRunning) {
      logger.warn("⚠️ Reconciliation already running, skipping this cycle");
      return;
    }

    isReconciliationRunning = true;
    try {
      logger.info("Starting payment reconciliation...");

      const result =
        await paymentReconciliationService.reconcilePendingTransactions();

      logger.info("Payment reconciliation completed", {
        successCount: result.successCount,
        reversalCount: result.reversalCount,
        stuckCount: result.stuckCount,
        errorCount: result.errorCount,
        duration: result.duration,
      });

      if (result.stuckCount > 0) {
        const cacheKey = "paymentReconciliationLastEmailSent";
        const sixHoursMs = 6 * 60 * 60 * 1000;

        try {
          const lastSentTime = await cacheService.get<number>(cacheKey);
          const now = Date.now();

          if (!lastSentTime || now - lastSentTime >= sixHoursMs) {
            logger.warn(
              `⚠️ ${result.stuckCount} transactions stuck and need manual review`,
            );
            await emailService.sendSystemNotificationToAdmin(
              process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
              `⚠️ ${result.stuckCount} Stuck Transaction${result.stuckCount > 1 ? "s" : ""} Need Review`,
              {
                severity: "warning",
                successCount: result.successCount,
                reversalCount: result.reversalCount,
                stuckCount: result.stuckCount,
                errorCount: result.errorCount,
                duration: `${result.duration}ms`,
                timestamp: new Date().toISOString(),
              },
              `Payment reconciliation found ${result.stuckCount} transaction${
                result.stuckCount > 1 ? "s" : ""
              } that are stuck and require manual review. These transactions have exceeded the normal processing time but are still in pending status.`,
            );

            await cacheService.set(cacheKey, now, 6 * 60 * 60);
          } else {
            const minutesUntilNextNotification = Math.round(
              (sixHoursMs - (now - lastSentTime)) / (60 * 1000),
            );
            logger.info(
              `Skipping stuck transaction notification (${minutesUntilNextNotification} mins until next allowed)`,
            );
          }
        } catch (cacheError) {
          logger.error(
            "Cache check failed, sending notification anyway:",
            cacheError,
          );
          await emailService.sendSystemNotificationToAdmin(
            process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
            `⚠️ ${result.stuckCount} Stuck Transaction${result.stuckCount > 1 ? "s" : ""} Need Review`,
            {
              severity: "warning",
              successCount: result.successCount,
              reversalCount: result.reversalCount,
              stuckCount: result.stuckCount,
              errorCount: result.errorCount,
              duration: `${result.duration}ms`,
              timestamp: new Date().toISOString(),
            },
            `Payment reconciliation found ${result.stuckCount} transaction${
              result.stuckCount > 1 ? "s" : ""
            } that are stuck and require manual review.`,
          );
        }
      }
    } catch (error: any) {
      logger.error("Payment reconciliation failed", error);
    } finally {
      isReconciliationRunning = false;
    }
  });

  // Hourly: Check for extremely stuck transactions (> 1 hour)
  const criticalCheckJob = cron.schedule("0 * * * *", async () => {
    if (isCriticalCheckRunning) {
      logger.warn(
        "⚠️ Critical transaction check already running, skipping this cycle",
      );
      return;
    }

    isCriticalCheckRunning = true;

    try {
      logger.info("Starting critical transaction check...");

      const criticalTxns =
        await paymentReconciliationService.findCriticallyStuckTransactions();

      if (criticalTxns.length > 0) {
        const cacheKey = "paymentCriticalCheckLastEmailSent";
        const sixHoursMs = 6 * 60 * 60 * 1000;

        try {
          const lastSentTime = await cacheService.get<number>(cacheKey);
          const now = Date.now();

          if (!lastSentTime || now - lastSentTime >= sixHoursMs) {
            logger.error(
              `Found ${criticalTxns.length} critically stuck transactions`,
              {
                references: criticalTxns.map((t) => t.reference),
              },
            );
            await emailService.sendSystemNotificationToAdmin(
              process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
              `CRITICAL: ${criticalTxns.length} Transaction${criticalTxns.length > 1 ? "s" : ""} Stuck for Over 1 Hour`,
              {
                severity: "critical",
                count: criticalTxns.length,
                references: criticalTxns.map((t) => t.reference),
                timestamp: new Date().toISOString(),
              },
              `URGENT: ${criticalTxns.length} transaction${
                criticalTxns.length > 1 ? "s have" : " has"
              } been stuck for over 1 hour. Immediate manual intervention is required to prevent customer complaints and potential financial discrepancies.`,
            );

            await cacheService.set(cacheKey, now, 6 * 60 * 60);
          } else {
            const minutesUntilNextNotification = Math.round(
              (sixHoursMs - (now - lastSentTime)) / (60 * 1000),
            );
            logger.info(
              `Skipping critical transaction notification (${minutesUntilNextNotification} mins until next allowed)`,
            );
          }
        } catch (cacheError) {
          logger.error(
            "Cache check failed for critical alert, sending notification anyway:",
            cacheError,
          );
          await emailService.sendSystemNotificationToAdmin(
            process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
            `CRITICAL: ${criticalTxns.length} Transaction${criticalTxns.length > 1 ? "s" : ""} Stuck for Over 1 Hour`,
            {
              severity: "critical",
              count: criticalTxns.length,
              references: criticalTxns.map((t) => t.reference),
              timestamp: new Date().toISOString(),
            },
            `URGENT: ${criticalTxns.length} transaction${
              criticalTxns.length > 1 ? "s have" : " has"
            } been stuck for over 1 hour. Immediate manual intervention is required.`,
          );
        }
      }
    } catch (error: any) {
      logger.error("Critical transaction check failed", error);
    } finally {
      isCriticalCheckRunning = false;
    }
  });

  // Every 6 hours: Check for stale manual withdrawals (> 24 hours old)
  const staleManualCheckJob = cron.schedule("0 */6 * * *", async () => {
    if (isStaleManualCheckRunning) {
      logger.warn("Stale manual check already running, skipping this cycle");
      return;
    }

    isStaleManualCheckRunning = true;

    try {
      logger.info("Starting stale manual withdrawal check...");

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const staleManuals = await Transaction.find({
        status: "pending_manual",
        "meta.phase": "manual_fallback",
        type: { $in: ["withdrawal"] },
        createdAt: { $lt: oneDayAgo },
      });

      if (staleManuals.length > 0) {
        const cacheKey = "paymentStaleManualLastEmailSent";
        const twelveHoursMs = 12 * 60 * 60 * 1000;

        try {
          const lastSentTime = await cacheService.get<number>(cacheKey);
          const now = Date.now();

          if (!lastSentTime || now - lastSentTime >= twelveHoursMs) {
            logger.warn(
              `Found ${staleManuals.length} manual withdrawal${staleManuals.length > 1 ? "s" : ""} > 24 hours old`,
              {
                references: staleManuals.map((t) => t.reference),
              },
            );

            await emailService.sendSystemNotificationToAdmin(
              process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
              `⚠️ ${staleManuals.length} Manual Withdrawal${staleManuals.length > 1 ? "s" : ""} Pending > 24 Hours`,
              {
                severity: "warning",
                count: staleManuals.length,
                references: staleManuals.map((t) => t.reference),
                oldestCreatedAt: staleManuals[0].createdAt,
                timestamp: new Date().toISOString(),
              },
              `${staleManuals.length} manual withdrawal${
                staleManuals.length > 1 ? "s have" : " has"
              } been pending for over 24 hours. Please review and process them immediately to improve customer experience.`,
            );

            await cacheService.set(cacheKey, now, 12 * 60 * 60);
          } else {
            const minutesUntilNextNotification = Math.round(
              (twelveHoursMs - (now - lastSentTime)) / (60 * 1000),
            );
            logger.info(
              `Skipping stale manual withdrawal notification (${minutesUntilNextNotification} mins until next allowed)`,
            );
          }
        } catch (cacheError) {
          logger.error(
            "Cache check failed for stale manual alert, sending notification anyway:",
            cacheError,
          );
          await emailService.sendSystemNotificationToAdmin(
            process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
            `⚠️ ${staleManuals.length} Manual Withdrawal${staleManuals.length > 1 ? "s" : ""} Pending > 24 Hours`,
            {
              severity: "warning",
              count: staleManuals.length,
              references: staleManuals.map((t) => t.reference),
              transactions: staleManuals.map((t) => ({
                reference: t.reference,
                amount: t.amount,
                chargeAmount: t.meta?.chargeInfo?.serviceCharge || 0,
                totalDeduction:
                  t.amount + (t.meta?.chargeInfo?.serviceCharge || 0),
                createdAt: t.createdAt,
                userId: t.userId?.toString(),
                type: t.type,
                accountDetails: {
                  accountNumber: t.meta?.accountNumber,
                  accountName: t.meta?.accountName,
                  bankName: t.meta?.bankName,
                },
              })),
              oldestCreatedAt: staleManuals[0].createdAt,
              timestamp: new Date().toISOString(),
            },
            `${staleManuals.length} manual withdrawal${
              staleManuals.length > 1 ? "s have" : " has"
            } been pending for over 24 hours. Please review and process them immediately.`,
          );
        }
      }
    } catch (error: any) {
      logger.error("Stale manual withdrawal check failed", error);
    } finally {
      isStaleManualCheckRunning = false;
    }
  });

  logger.info("Payment reconciliation cron jobs started");
  logger.info("- Reconciliation: Every 5 minutes (excludes PENDING_MANUAL)");
  logger.info("- Critical Check: Every hour (excludes PENDING_MANUAL)");
  logger.info(
    "- Stale Manual Check: Every 6 hours (warns about > 24h pending manual withdrawals)",
  );

  return [reconciliationJob, criticalCheckJob, staleManualCheckJob];
}

export async function triggerPaymentReconciliationNow() {
  if (isReconciliationRunning) {
    logger.warn(
      "⚠️ Reconciliation already running, cannot trigger another cycle",
    );
    throw new Error("Reconciliation job is already running");
  }

  isReconciliationRunning = true;
  try {
    logger.info(
      "🚀 MANUAL TRIGGER: Starting immediate payment reconciliation...",
    );

    const result =
      await paymentReconciliationService.reconcilePendingTransactions();

    logger.info("🎉 Manual payment reconciliation completed", {
      successCount: result.successCount,
      reversalCount: result.reversalCount,
      stuckCount: result.stuckCount,
      errorCount: result.errorCount,
      duration: result.duration,
      triggeredManually: true,
    });

    if (result.stuckCount > 0) {
      logger.warn(
        `⚠️ ${result.stuckCount} transactions stuck and need manual review`,
      );
      await emailService.sendSystemNotificationToAdmin(
        process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
        `[MANUAL TRIGGER] ⚠️ ${result.stuckCount} Stuck Transaction${result.stuckCount > 1 ? "s" : ""} Need Review`,
        {
          severity: "warning",
          successCount: result.successCount,
          reversalCount: result.reversalCount,
          stuckCount: result.stuckCount,
          errorCount: result.errorCount,
          duration: `${result.duration}ms`,
          triggeredManually: true,
          timestamp: new Date().toISOString(),
        },
        `[MANUAL TRIGGER] Payment reconciliation found ${result.stuckCount} transaction${
          result.stuckCount > 1 ? "s" : ""
        } that are stuck and require manual review.`,
      );
    }

    return result;
  } catch (error: any) {
    logger.error("Manual payment reconciliation failed", error);
    throw error;
  } finally {
    isReconciliationRunning = false;
  }
}
