import cron from "node-cron";
import { Types } from "mongoose";
import redisConfig from "@/config/redis";
import { AlertRepository } from "@/repositories/admin/AlertRepository";
import ServiceContainer from "@/services/client/container";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  ALERT_BATCH_SIZE,
  ALERT_BATCH_INTERVAL_MINUTES,
} from "@/config/alertDispatch";

const alertRepository = new AlertRepository();
const notificationService = ServiceContainer.getNotificationService();

const MAX_RETRIES = 3;

interface AlertQueueEntry {
  userId: string;
  title: string;
  message: string;
  type?: string;
  alertId?: string;
  retryCount?: number;
}

// Drains up to ALERT_BATCH_SIZE recipients for one alert/channel pair.
// Failures are retried up to MAX_RETRIES, then dead-lettered — the alert
// itself is never failed over a bad recipient (see AlertService.dispatchAlert
// for why: that all-or-nothing behaviour only applies to the initial,
// pre-batching dispatch step).
async function processChannelBatch(
  alertId: string,
  channel: string,
): Promise<{ sent: number; failed: number; remaining: number }> {
  const key = `alert:${channel}:queue:${alertId}`;
  const deadLetterKey = `alert:${channel}:dead_letter:${alertId}`;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < ALERT_BATCH_SIZE; i++) {
    const raw = await redisConfig.client.rPop(key);
    if (!raw) break; // this channel's queue is empty

    let entry: AlertQueueEntry;
    try {
      entry = JSON.parse(raw);
    } catch {
      logger.error("Alert batch worker: invalid queue entry, discarding", {
        alertId,
        channel,
        raw,
      });
      failed++;
      continue;
    }

    try {
      await notificationService.createNotification({
        notifiableType: "User",
        notifiableId: new Types.ObjectId(entry.userId),
        type: "alert",
        data: {
          title: entry.title,
          message: entry.message,
          alertId: entry.alertId || alertId,
          ...(entry.type && { type: entry.type }),
        },
        sendEmail: channel === "email",
        sendPush: channel === "push",
        sendSMS: false,
      });
      sent++;
    } catch (err: any) {
      const retryCount = entry.retryCount ?? 0;

      if (retryCount >= MAX_RETRIES) {
        failed++;
        logger.error(
          "Alert batch worker: recipient exceeded max retries, dead-lettering",
          { alertId, channel, userId: entry.userId, lastError: err.message },
        );
        await redisConfig.client.lPush(
          deadLetterKey,
          JSON.stringify({
            ...entry,
            deadLetteredAt: new Date().toISOString(),
            lastError: err.message,
          }),
        );
        continue;
      }

      await redisConfig.client.rPush(
        key,
        JSON.stringify({
          ...entry,
          retryCount: retryCount + 1,
          lastError: err.message,
        }),
      );
    }
  }

  const remaining = await redisConfig.client.lLen(key);
  return { sent, failed, remaining };
}

async function runBatchCycle(): Promise<void> {
  const dueAlerts = await alertRepository.findReadyForBatchContinuation();

  if (dueAlerts.length === 0) {
    logger.debug("Alert batch worker: nothing due");
    return;
  }

  logger.info(`Alert batch worker: ${dueAlerts.length} alert(s) due for a batch tick`);

  for (const alert of dueAlerts) {
    const alertId = alert._id.toString();
    const progress = (alert.batchProgress || {}) as Record<string, any>;
    const pendingChannels = Object.keys(progress).filter(
      (c) => !progress[c]?.completed,
    );

    let allChannelsDone = true;

    for (const channel of pendingChannels) {
      const { sent, failed, remaining } = await processChannelBatch(
        alertId,
        channel,
      );

      const update: Record<string, any> = {};
      const inc: Record<string, number> = {};
      if (sent) inc[`batchProgress.${channel}.sent`] = sent;
      if (failed) inc[`batchProgress.${channel}.failed`] = failed;
      if (Object.keys(inc).length > 0) update.$inc = inc;
      if (remaining === 0) {
        update.$set = { [`batchProgress.${channel}.completed`]: true };
      } else {
        allChannelsDone = false;
      }

      if (Object.keys(update).length > 0) {
        await alertRepository.update(alertId, update);
      }

      logger.info("Alert batch worker: tick complete", {
        alertId,
        channel,
        sent,
        failed,
        remaining,
      });
    }

    if (allChannelsDone) {
      await alertRepository.update(alertId, {
        status: "sent",
        dispatchedAt: new Date(),
        nextBatchAt: null,
      });
      logger.info(`Alert ${alertId} fully dispatched — all batched channels drained`);
    } else {
      await alertRepository.update(alertId, {
        nextBatchAt: new Date(
          Date.now() + ALERT_BATCH_INTERVAL_MINUTES * 60 * 1000,
        ),
      });
    }
  }
}

let isAlertBatchRunning = false;

export const startAlertBatchCron = () => {
  const cronExpression = `*/${ALERT_BATCH_INTERVAL_MINUTES} * * * *`;

  const job = cron.schedule(cronExpression, async () => {
    if (isAlertBatchRunning) {
      logger.warn("⚠️ Alert batch cycle already running, skipping this tick");
      return;
    }

    isAlertBatchRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "alert-batch-dispatch",
        cronExpression,
        runBatchCycle,
      );
    } catch (error: any) {
      logger.error("Error in alert batch cron job:", error);
    } finally {
      isAlertBatchRunning = false;
    }
  });

  logger.info(
    `Alert batch dispatch cron job started (runs every ${ALERT_BATCH_INTERVAL_MINUTES} min, batch size ${ALERT_BATCH_SIZE})`,
  );
  return job;
};
