import cron from "node-cron";
import logger from "@/logger";
import AdminServiceContainer from "@/services/admin/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const referralBonusService = AdminServiceContainer.getReferralBonusService();

let isProcessPendingReferralsRunning = false;
let isPayQualifiedBonusesRunning = false;

export const startProcessPendingReferralsCron = () => {
  const job = cron.schedule("0 * * * *", async () => {
    if (isProcessPendingReferralsRunning) {
      logger.warn(
        "⚠️ Process pending referrals already running, skipping this cycle",
      );
      return;
    }

    isProcessPendingReferralsRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "referral-process-pending",
        "0 * * * *",
        async () => {
          logger.info("[CRON] Starting: Process pending referrals");
          
          // 1. Regular user milestones
          const result = await referralBonusService.processPendingReferrals();
          logger.info("[CRON] Completed: Process pending referrals (Regular)", {
            result,
          });

          // 2. Influencer rule-based bonuses
          const influencerResult = await referralBonusService.processInfluencerReferrals();
          logger.info("[CRON] Completed: Process pending referrals (Influencer)", {
            result: influencerResult,
          });
        },
      );
    } catch (error: any) {
      logger.error("[CRON] Error in processPendingReferrals:", error);
    } finally {
      isProcessPendingReferralsRunning = false;
    }
  });

  logger.info(
    "Process pending referrals cron job started (runs every 1 hour)",
  );
  return job;
};

export const startPayQualifiedBonusesCron = () => {
  const job = cron.schedule("0 */4 * * *", async () => {
    if (isPayQualifiedBonusesRunning) {
      logger.warn(
        "⚠️ Pay qualified bonuses already running, skipping this cycle",
      );
      return;
    }

    isPayQualifiedBonusesRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "referral-pay-qualified",
        "0 */4 * * *",
        async () => {
          logger.info("[CRON] Starting: Pay qualified bonuses");
          const result = await referralBonusService.payQualifiedBonuses();
          logger.info("[CRON] Completed: Pay qualified bonuses", { result });
        },
      );
    } catch (error: any) {
      logger.error("[CRON] Error in payQualifiedBonuses:", error);
    } finally {
      isPayQualifiedBonusesRunning = false;
    }
  });

  logger.info("Pay qualified bonuses cron job started (runs every 4 hours / 6 times daily)");
  return job;
};

export const startReferralBonusCrons = () => {
  const processPendingJob = startProcessPendingReferralsCron();
  const payQualifiedJob = startPayQualifiedBonusesCron();
  logger.info("All referral bonus cron jobs initialized");
  return [processPendingJob, payQualifiedJob];
};

export const runReferralBonusProcessingNow = async (force = false) => {
  try {
    logger.info("[MANUAL TRIGGER] Starting referral bonus processing...");

    //  Process pending referrals
    if (!isProcessPendingReferralsRunning || force) {
      isProcessPendingReferralsRunning = true;
      try {
        logger.info("[MANUAL TRIGGER] Step 1: Running processPendingReferrals");
        const processingResult = await referralBonusService.processPendingReferrals();
        const influencerResult = await referralBonusService.processInfluencerReferrals();
        logger.info("[MANUAL TRIGGER] Step 1 completed", { processingResult, influencerResult });
      } finally {
        isProcessPendingReferralsRunning = false;
      }
    } else {
      logger.warn(
        "[MANUAL TRIGGER] processPendingReferrals is already running, skipping...",
      );
    }

    //  Pay qualified bonuses
    if (!isPayQualifiedBonusesRunning || force) {
      isPayQualifiedBonusesRunning = true;
      try {
        logger.info("[MANUAL TRIGGER] Step 2: Running payQualifiedBonuses");
        const paymentResult = await referralBonusService.payQualifiedBonuses();
        logger.info("[MANUAL TRIGGER] Step 2 completed", { paymentResult });
      } finally {
        isPayQualifiedBonusesRunning = false;
      }
    } else {
      logger.warn(
        "[MANUAL TRIGGER] payQualifiedBonuses is already running, skipping...",
      );
    }

    logger.info(
      "[MANUAL TRIGGER] Referral bonus processing completed successfully",
    );
    return { success: true, message: "Both steps executed successfully" };
  } catch (error: any) {
    logger.error(
      "[MANUAL TRIGGER] ❌ Error in referral bonus processing:",
      error,
    );
    return { success: false, error: error.message };
  }
};
