import { AlertRepository } from "@/repositories/admin/AlertRepository";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { UserRepository } from "@/repositories/client/UserRepository";
import logger from "@/logger";
import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import ServiceContainer from "../../client/container";
import redisConfig from "@/config/redis";
import {
  ALERT_BATCHED_CHANNELS,
  ALERT_PERSONALISED_CHANNELS,
} from "@/config/alertDispatch";
import { sanitizeAlertBody } from "@/utils/sanitizeAlertBody";

// Channels the batch worker actually knows how to drain from a queue.
// in_app is a plain bulk DB insert with no provider to throttle against,
// so it's excluded even if someone adds it to ALERT_BATCHED_CHANNELS.
const WORKER_CAPABLE_CHANNELS = ["email", "push"];

export class AlertService {
  constructor(
    private alertRepository: AlertRepository,
    private notificationService: NotificationService,
    private userRepository: UserRepository,
  ) {}

  async listAlerts(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = { deletedAt: null };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.target) {
      query.target = filters.target;
    }

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    const result = await this.alertRepository.findWithPagination(
      query,
      page,
      limit,
      undefined,
      [
        {
          path: "creatorId",
          select: "firstName lastName email profilePicture",
        },
        { path: "users", select: "firstname lastname email country avatar" },
      ],
    );

    return {
      alerts: result.data,
      total: result.total,
    };
  }

  async createAlert(adminId: string, data: any) {
    try {
      data.body = sanitizeAlertBody(data.body);
      this.assertChannelRules(data.channels, data.body);

      const alert = await this.alertRepository.create({
        ...data,
        dispatchTime: data.isImmediate ? new Date() : data.dispatchTime,
        creatorId: new Types.ObjectId(adminId),
      });

      if (data.isImmediate) {
        await this.dispatchAlert(alert._id.toString());
        const dispatchedAlert = await this.alertRepository.findById(
          alert._id.toString(),
        );
        return {
          message: "Alert created and dispatched successfully",
          alert: dispatchedAlert,
        };
      }

      return { message: "Alert created successfully", alert };
    } catch (error: any) {
      throw new AppError(
        error.message,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  async getAlertDetails(alertId: string) {
    const alert = await this.alertRepository.findById(alertId, [
      { path: "creatorId", select: "firstName lastName email profilePicture" },
      { path: "users", select: "firstname lastname email country avatar" },
    ]);
    if (!alert || alert.deletedAt) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return alert;
  }

  async updateAlert(alertId: string, adminId: string, data: any) {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert || alert.deletedAt) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Still block edits while a send is actively in progress (avoids
    // mutating an alert mid-dispatch), but allow editing after it's sent.
    if (alert.status === "dispatching") {
      throw new AppError(
        "Cannot update an alert while it is being dispatched",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    if (data.body) {
      data.body = sanitizeAlertBody(data.body);
    }
    const effectiveChannels = data.channels ?? alert.channels;
    const effectiveBody = data.body ?? alert.body;
    this.assertChannelRules(effectiveChannels, effectiveBody);

    const result = await this.alertRepository.update(alertId, {
      ...data,
      dispatchTime: data.isImmediate ? new Date() : data.dispatchTime,
    });

    if (data.isImmediate) {
      // Behave like createAlert: put it back into a clean, dispatchable
      // state and send it again right now — regardless of whatever
      // status it was in before (sent/failed/pending all get overridden).
      await this.alertRepository.update(alertId, {
        status: "pending",
        dispatchedAt: null,
        failedNote: null,
        batchProgress: {},
        nextBatchAt: null,
      });

      await this.dispatchAlert(alertId);
      const dispatchedAlert = await this.alertRepository.findById(alertId);

      return {
        message: "Alert updated and dispatched successfully",
        alert: dispatchedAlert,
      };
    }

    return { message: "Alert updated successfully", alert: result };
  }

  async deleteAlert(alertId: string) {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    await this.alertRepository.delete(alertId);

    return { message: "Alert deleted successfully" };
  }

  async restoreAlert(alertId: string) {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    alert.deletedAt = null;
    await alert.save();

    return { message: "Alert restored successfully" };
  }

  private async getUsersByTarget(
    target: string,
    specificUsers?: Types.ObjectId[],
  ): Promise<any[]> {
    let query: any = { status: "active", deletedAt: null };

    switch (target) {
      case "all":
        break;
      case "verified":
        query.bvnVerified = true;
        break;
      case "phone-verified":
        query.phoneVerifiedAt = { $ne: null };
        break;
      case "email-verified":
        query.emailVerifiedAt = { $ne: null };
        break;
      case "profile-completed":
        query.bvnVerified = true;
        query.phoneVerifiedAt = { $ne: null };
        query.emailVerifiedAt = { $ne: null };
        break;
      case "specific":
        return await this.userRepository.find({ _id: { $in: specificUsers } });
      default:
        break;
    }

    return await this.userRepository.find(query);
  }

  async dispatchAlert(alertId: string) {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert || alert.deletedAt) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const batchedChannels = alert.channels.filter(
      (c) =>
        WORKER_CAPABLE_CHANNELS.includes(c) &&
        ALERT_BATCHED_CHANNELS.includes(c),
    );
    // If any selected channel is batched, the alert isn't fully "sent" the
    // moment we claim it — it's "dispatching" until the batch worker drains
    // that channel's queue over subsequent cron ticks.
    const claimedStatus = batchedChannels.length > 0 ? "dispatching" : "sent";

    // Atomically claim the alert so a cron run and a manual click on the
    // same alert can't both dispatch it. dispatchTime now reflects the
    // actual send moment, not the original schedule. dispatchedAt is only
    // stamped here for the immediate (non-batched) case; the batched case
    // gets dispatchedAt once the worker finishes draining the last channel.
    const now = new Date();
    const claimed = await this.alertRepository.updateOne(
      { _id: alertId, status: { $ne: "dispatching" }, deletedAt: null },
      {
        status: claimedStatus,
        dispatchedAt: claimedStatus === "sent" ? now : null,
        dispatchTime: now,
        failedNote: null,
        batchProgress: {},
        nextBatchAt: null,
      },
    );

    if (!claimed) {
      throw new AppError(
        "Alert is currently being dispatched — try again once it finishes",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    try {
      const users = await this.getUsersByTarget(alert.target, alert.users);

      if (users.length === 0) {
        throw new AppError(
          "No users found matching the target criteria",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Clear any leftover queue entries from a previous dispatch attempt
      // (partial failure, or this being a manual redispatch) so old and
      // new entries never end up mixed under the same channel key.
      for (const channel of batchedChannels) {
        await redisConfig.client.del(`alert:${channel}:queue:${alert._id}`);
      }

      // Sends immediate channels now; enqueues batched channels for the
      // worker instead of sending them here.
      await this.sendNotificationsToUsers(users, alert, batchedChannels);

      const update: Record<string, any> = { userCount: users.length };
      if (batchedChannels.length > 0) {
        update.batchProgress = batchedChannels.reduce(
          (acc: Record<string, any>, channel: string) => {
            acc[channel] = {
              total: users.length,
              sent: 0,
              failed: 0,
              completed: false,
            };
            return acc;
          },
          {},
        );
        // Due immediately — the batch cron picks it up on its next tick.
        update.nextBatchAt = now;
      }
      await this.alertRepository.update(alertId, update);

      logger.info(
        `Alert ${alertId} dispatched to ${users.length} users` +
          (batchedChannels.length > 0
            ? ` (${batchedChannels.join(", ")} batching over subsequent cycles)`
            : ""),
      );

      return {
        message:
          batchedChannels.length > 0
            ? "Alert dispatch started; batched channel(s) will complete over the next cycles"
            : "Alert dispatched successfully",
        recipientCount: users.length,
      };
    } catch (error: any) {
      await this.alertRepository.update(alertId, {
        status: "failed",
        failedNote: error.message,
      });

      logger.error(`Failed to dispatch alert ${alertId}:`, error);

      throw error;
    }
  }

  // "Hi {name}, " prefix, respecting Alert.isPersonalised and which channels
  // are configured to receive it (ALERT_PERSONALISED_CHANNELS). Falls back
  // firstname -> lastname -> "" (never username, per product decision).
  private buildAlertMessage(user: any, alert: any, channel: string): string {
    if (
      !alert.isPersonalised ||
      !ALERT_PERSONALISED_CHANNELS.includes(channel)
    ) {
      return alert.body;
    }
    const name = user.firstname || user.lastname || "";
    return `Hi ${name}, ${alert.body}`;
  }

  private async sendNotificationsToUsers(
    users: any[],
    alert: any,
    batchedChannels: string[] = [],
  ): Promise<void> {
    const immediateChannels = alert.channels.filter(
      (c: string) => c !== "in_app" && !batchedChannels.includes(c),
    );

    const notificationPromises = users.map((user) => {
      const notifications = immediateChannels
        .filter((channel: string) => {
          if (channel === "email") return !!user.email;
          if (channel === "sms") return !!user.phone && !!user.phoneCode;
          return true;
        })
        .map((channel: string) =>
          this.notificationService.createNotification({
            notifiableType: "User",
            notifiableId: user._id,
            type: "alert",
            data: {
              title: alert.title,
              message: this.buildAlertMessage(user, alert, channel),
              alertId: alert._id,
              ...(alert.type && { type: alert.type }),
            },
            sendPush: channel === "push",
            sendEmail: channel === "email",
            sendSMS: channel === "sms",
            skipInApp: true,
          }),
        );

      return Promise.all(notifications);
    });

    await Promise.all(notificationPromises);

    // In-app notifications are persisted, so fan them out as one batched
    // insert instead of one DB write per user. Only go per-user when
    // personalisation actually changes the content; otherwise keep the
    // cheaper shared-payload path.
    if (alert.channels.includes("in_app")) {
      if (
        alert.isPersonalised &&
        ALERT_PERSONALISED_CHANNELS.includes("in_app")
      ) {
        await this.notificationService.bulkCreatePersonalisedNotifications(
          users.map((user) => ({
            notifiableId: user._id,
            title: alert.title,
            message: this.buildAlertMessage(user, alert, "in_app"),
          })),
          "User",
          "announcement",
        );
      } else {
        await this.notificationService.bulkCreateNotifications(
          users.map((user) => user._id),
          "User",
          "announcement",
          {
            title: alert.title,
            message: alert.body,
            alertId: alert._id,
          },
        );
      }
    }

    // Batched channels don't send now — queue each eligible recipient for
    // the batch worker (src/jobs/alertBatchCronJobs.ts) to drain later.
    for (const channel of batchedChannels) {
      const key = `alert:${channel}:queue:${alert._id}`;
      for (const user of users) {
        if (channel === "email" && !user.email) continue;
        if (channel === "push" && !user._id) continue;

        const payload = JSON.stringify({
          userId: user._id.toString(),
          title: alert.title,
          message: this.buildAlertMessage(user, alert, channel),
          type: alert.type,
          alertId: alert._id,
        });
        await redisConfig.client.lPush(key, payload);
      }
    }
  }

  async redispatchAlert(alertId: string) {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert || alert.deletedAt) {
      throw new AppError(
        "Alert not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Reset status to allow redispatch
    alert.status = "pending";
    alert.dispatchedAt = null;
    await alert.save();

    return this.dispatchAlert(alertId);
  }

  private assertChannelRules(channels: string[], body: string): void {
    if (channels.includes("email") && channels.length > 1) {
      throw new AppError(
        "Email cannot be combined with other channels — select email alone, or choose other channels without email",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    if (channels.includes("sms") && body && body.length > 160) {
      throw new AppError(
        "Message body must be 160 characters or fewer when SMS is included in channels",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }
}
