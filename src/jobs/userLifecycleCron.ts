import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { User } from "@/models/core/User";
import { Transaction } from "@/models/wallet/Transaction";


const DAY = 24 * 60 * 60 * 1000;
const INACTIVITY_THRESHOLDS_DAYS = [3, 7, 30];

let isRunning = false;

const isProfileComplete = (user: any) =>
  !!user.username &&
  !!user.firstname &&
  !!user.lastname &&
  !!user.email &&
  !!user.phone &&
  !!user.state &&
  !!user.country &&
  !!user.emailVerifiedAt &&
  !!user.phoneVerifiedAt;

async function sendProfileIncompleteReminders() {
  const emailService = ServiceContainer.getEmailService();
  const windowStart = new Date(Date.now() - 2 * DAY);
  const windowEnd = new Date(Date.now() - 1 * DAY);

  const candidates = await User.find({
    createdAt: { $gte: windowStart, $lte: windowEnd },
    "lifecycleEmails.profileIncompleteSentAt": { $exists: false },
  });

  for (const user of candidates) {
    if (isProfileComplete(user)) continue;
    try {
      await emailService.sendProfileIncompleteEmail(user.email, user.firstname);
      await User.updateOne(
        { _id: user._id },
        { $set: { "lifecycleEmails.profileIncompleteSentAt": new Date() } },
      );
    } catch (err) {
      logger.error("Failed to send profile-incomplete email:", { userId: user._id, err });
    }
  }
}

async function sendNoTransactionReminders(days: 3 | 7) {
  const emailService = ServiceContainer.getEmailService();
  const field = days === 3 ? "day3NoTxnSentAt" : "day7NoTxnSentAt";
  const windowStart = new Date(Date.now() - (days + 1) * DAY);
  const windowEnd = new Date(Date.now() - days * DAY);

  const candidates = await User.find({
    createdAt: { $gte: windowStart, $lte: windowEnd },
    [`lifecycleEmails.${field}`]: { $exists: false },
  });
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((u) => u._id);

  // Anyone with a transaction that isn't "failed" counts as having transacted
  const userIdsWithTxn = await Transaction.distinct("userId", {
    userId: { $in: candidateIds },
    status: { $ne: "failed" },
  });
  const hasTxnSet = new Set(userIdsWithTxn.map((id) => id.toString()));

  for (const user of candidates) {
    if (hasTxnSet.has(user._id.toString())) continue;
    try {
      await emailService.sendNoTransactionReminderEmail(user.email, user.firstname, days);
      const updates: any = { [`lifecycleEmails.${field}`]: new Date() };
      // 5% bonus capped at 200 for Day 3 and Day 7 new users with no transactions
      updates.pendingCashbackOffer = {
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "pending",
        percentage: 5,
        cap: 200,
      };
      
      await User.updateOne(
        { _id: user._id },
        { $set: updates },
      );
    } catch (err) {
      logger.error(`Failed to send day-${days} no-transaction email:`, { userId: user._id, err });
    }
  }
}

async function sendInactivityWinBackEmails() {
  const emailService = ServiceContainer.getEmailService();

  for (const days of INACTIVITY_THRESHOLDS_DAYS) {
    const windowStart = new Date(Date.now() - (days + 1) * DAY);
    const windowEnd = new Date(Date.now() - days * DAY);

    // Find users whose last successful transaction falls in the inactivity window
    const inactiveUserIds = await Transaction.aggregate([
      { $match: { status: { $ne: "failed" } } },
      { $group: { _id: "$userId", lastTxnDate: { $max: "$createdAt" } } },
      { $match: { lastTxnDate: { $gte: windowStart, $lte: windowEnd } } },
    ]);

    if (inactiveUserIds.length === 0) continue;

    const userIds = inactiveUserIds.map((m: any) => m._id);
    const users = await User.find({
      _id: { $in: userIds },
      [`lifecycleEmails.inactivitySent`]: { $nin: [days] },
    });

    for (const user of users) {
      if (!user?.email) continue;
      try {
        await emailService.sendInactivityWinBackEmail(user.email, user.firstname, days);
        // 5% for 3 & 7 days, 10% for 30 days, all capped at 200
        const percentage = days === 30 ? 10 : 5;
        await User.updateOne(
          { _id: user._id },
          {
            $push: { "lifecycleEmails.inactivitySent": days },
            $set: {
              pendingCashbackOffer: {
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                status: "pending",
                percentage,
                cap: 200,
              },
            },
          },
        );
      } catch (err) {
        logger.error(`Failed to send ${days}-day inactivity email:`, { userId: user._id, err });
      }
    }
  }
}

export const startUserLifecycleCron = () => {
  const job = cron.schedule("0 8 * * *", async () => {
    if (isRunning) {
      logger.warn("⚠️ User lifecycle cron already running, skipping this cycle");
      return;
    }
    isRunning = true;
    try {
      await SentryHelper.wrapCronJob("user-lifecycle-emails", "0 8 * * *", async () => {
        logger.info("Starting user lifecycle email run");
        await sendProfileIncompleteReminders();
        await sendNoTransactionReminders(3);
        await sendNoTransactionReminders(7);
        await sendInactivityWinBackEmails();
        logger.info("Completed user lifecycle email run");
      });
    } catch (error) {
      logger.error("Error in user lifecycle cron job:", error);
    } finally {
      isRunning = false;
    }
  });

  logger.info("User lifecycle cron job started (runs daily at 8am)");
  return job;
};