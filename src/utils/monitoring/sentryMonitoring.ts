import Sentry from "../../config/sentry";

export class SentryHelper {
  // Check if Sentry is initialized
  private static isEnabled(): boolean {
    return !!Sentry.getClient();
  }

  static captureBusinessError(
    code: string,
    message: string,
    userId?: string,
    metadata?: Record<string, any>,
  ) {
    if (!this.isEnabled()) return;

    Sentry.captureMessage(message, {
      level: "warning",
      tags: {
        errorCode: code,
        userId: userId || "anonymous",
        ...metadata,
      },
    });
  }

  static trackCriticalOperation(
    operationName: string,
    fn: () => Promise<any>,
    referenceId?: string,
  ) {
    if (!this.isEnabled()) {
      return fn(); // Just run function without tracking
    }

    return Sentry.startSpan(
      {
        name: operationName,
        op: "function",
        attributes: {
          referenceId: referenceId || "unknown",
        },
      },
      async () => {
        try {
          return await fn();
        } catch (error) {
          Sentry.captureException(error, {
            tags: {
              operation: operationName,
              referenceId: referenceId || "unknown",
            },
          });
          throw error;
        }
      },
    );
  }

  static captureWebhookError(
    provider: string,
    webhookType: string,
    error: Error,
    payload?: any,
  ) {
    if (!this.isEnabled()) return;

    Sentry.captureException(error, {
      tags: {
        webhook: provider,
        type: webhookType,
      },
      contexts: {
        webhook: {
          provider,
          type: webhookType,
          payloadSize: payload ? JSON.stringify(payload).length : 0,
        },
      },
    });
  }

  static setUserContext(userId: string, email?: string, tier?: string) {
    if (!this.isEnabled()) return;

    Sentry.setUser({
      id: userId,
      email,
      tier,
    });
  }

  static clearUserContext() {
    if (!this.isEnabled()) return;

    Sentry.setUser(null);
  }

  static async wrapCronJob(
    monitorSlug: string,
    schedule: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!this.isEnabled()) {
      return fn(); // Just run without monitoring
    }

    const checkInId = Sentry.captureCheckIn(
      {
        monitorSlug,
        status: "in_progress",
      },
      {
        schedule: {
          type: "crontab",
          value: schedule,
        },
        checkinMargin: 5,
        maxRuntime: 10,
        timezone: "Africa/Lagos",
      },
    );

    try {
      await fn();

      Sentry.captureCheckIn({
        checkInId,
        monitorSlug,
        status: "ok",
      });
    } catch (error) {
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug,
        status: "error",
      });

      Sentry.captureException(error, {
        tags: { cronJob: monitorSlug },
      });

      throw error;
    }
  }

  static addCronBreadcrumb(message: string, data?: Record<string, any>): void {
    if (!this.isEnabled()) return;

    Sentry.addBreadcrumb({
      category: "cron",
      message,
      level: "info",
      data,
    });
  }
}

export default SentryHelper;
