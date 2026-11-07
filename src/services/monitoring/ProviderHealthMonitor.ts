import { CacheService } from "@/services/core/CacheService";
import logger from "@/logger";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

type ProviderCategory =
  | "payment_gateway"
  | "bill_provider";

interface ProviderFailure {
  category: ProviderCategory;
  provider: string;
  operation: string;
  transactionType?: string;
  error: string;
  timestamp: Date;
  userId?: string;
  reference?: string;
  amount?: number;
}

interface CategoryConfig {
  failureThreshold: number;
  timeWindow: number;
  cooldownPeriod: number;
}

interface ProviderHealthConfig {
  payment_gateway: CategoryConfig;
  bill_provider: CategoryConfig;
}

interface ProviderHealth {
  provider: string;
  category: ProviderCategory;
  operations: {
    [operation: string]: {
      failureCount: number;
      lastFailure?: Date;
      status: "healthy" | "degraded" | "failing";
    };
  };
}

interface SystemHealth {
  payment_gateways: { [provider: string]: ProviderHealth };
  bill_providers: { [provider: string]: ProviderHealth };
  overall_status: "healthy" | "degraded" | "critical";
  last_updated: Date;
}

export class ProviderHealthMonitor {
  private cacheService: CacheService;
  private notificationService: NotificationService;

  private readonly CACHE_PREFIX = "provider_health:";
  private readonly ALERT_COOLDOWN_PREFIX = "provider_alert_cooldown:";

  // Category-specific configurations
  private readonly config: ProviderHealthConfig = {
    payment_gateway: {
      failureThreshold: 3,
      timeWindow: 300, // 5 minutes
      cooldownPeriod: 180, // 3 minutes
    },
    bill_provider: {
      failureThreshold: 2,
      timeWindow: 300, // 5 minutes
      cooldownPeriod: 180, // 3 minutes
    },
  };

  // Provider to category mapping
  private readonly providerCategories: { [key: string]: ProviderCategory } = {
    // Payment Gateways
    flutterwave: "payment_gateway",
    monnify: "payment_gateway",
    savehaven: "payment_gateway",

    // Bill/Service Providers
    vtpass: "bill_provider",
    clubkonnect: "bill_provider",
    coolsub: "bill_provider",
    mysimhosting: "bill_provider",
    vtung: "bill_provider",
    bilalsadasub: "bill_provider",
    reloadly: "bill_provider",
    giftbills: "bill_provider",
    amadeus: "bill_provider",
    nigeriasmm: "bill_provider",
    bigisub: "bill_provider",
    owlet: "bill_provider",
  };


  constructor(
    cacheService: CacheService,
    notificationService: NotificationService,
  ) {
    this.cacheService = cacheService;
    this.notificationService = notificationService;
  }

  // MAIN TRACKING METHODS

  // Track a provider operation failure
  // This is the main method you'll call in catch blocks
  async trackFailure(failure: ProviderFailure): Promise<void> {
    try {
      const category =
        failure.category || this.getCategoryForProvider(failure.provider);
      const categoryConfig = this.config[category];

      const key = this.getCacheKey(
        category,
        failure.provider,
        failure.operation,
      );

      // Get existing failures
      const existingFailures = await this.getRecentFailures(
        category,
        failure.provider,
        failure.operation,
        categoryConfig.timeWindow,
      );

      // Add new failure
      existingFailures.push({
        ...failure,
        category,
        timestamp: new Date(),
      });

      // Store in cache
      await this.cacheService.set(
        key,
        JSON.stringify(existingFailures),
        categoryConfig.timeWindow,
      );

      logger.warn(
        `[${category.toUpperCase()}] Provider failure tracked: ${
          failure.provider
        }.${failure.operation}`,
        {
          category,
          provider: failure.provider,
          operation: failure.operation,
          transactionType: failure.transactionType,
          error: failure.error,
          totalFailures: existingFailures.length,
          threshold: categoryConfig.failureThreshold,
        },
      );

      // Check if we should alert
      await this.checkAndAlert(
        category,
        failure.provider,
        failure.operation,
        existingFailures,
        categoryConfig,
      );
    } catch (error) {
      logger.error("Failed to track provider failure", error);
    }
  }

  // Track a successful operation (clears failure tracking)
  async trackSuccess(
    category: ProviderCategory,
    provider: string,
    operation: string,
  ): Promise<void> {
    try {
      const key = this.getCacheKey(category, provider, operation);
      await this.cacheService.delete(key);

      logger.debug(
        `[${category.toUpperCase()}] Provider success tracked: ${provider}.${operation}`,
      );
    } catch (error) {
      logger.error("Failed to track provider success", error);
    }
  }

  // HEALTH CHECK METHODS
  // Get health status for a specific provider

  async getProviderHealth(provider: string): Promise<ProviderHealth> {
    const category = this.getCategoryForProvider(provider);
    const operations = this.getOperationsForCategory(category);
    const categoryConfig = this.config[category];

    const health: ProviderHealth = {
      provider,
      category,
      operations: {},
    };

    for (const operation of operations) {
      const failures = await this.getRecentFailures(
        category,
        provider,
        operation,
        categoryConfig.timeWindow,
      );

      let status: "healthy" | "degraded" | "failing" = "healthy";
      if (failures.length >= categoryConfig.failureThreshold) {
        status = "failing";
      } else if (failures.length > 0) {
        status = "degraded";
      }

      health.operations[operation] = {
        failureCount: failures.length,
        lastFailure:
          failures.length > 0
            ? failures[failures.length - 1].timestamp
            : undefined,
        status,
      };
    }

    return health;
  }

  // Get complete system health status

  async getSystemHealth(): Promise<SystemHealth> {
    const systemHealth: SystemHealth = {
      payment_gateways: {},
      bill_providers: {},
      overall_status: "healthy",
      last_updated: new Date(),
    };

    // Get health for all providers
    const allProviders = Object.keys(this.providerCategories);

    for (const provider of allProviders) {
      const health = await this.getProviderHealth(provider);
      const category = health.category;

      // Categorize by type
      if (category === "payment_gateway") {
        systemHealth.payment_gateways[provider] = health;
      } else if (category === "bill_provider") {
        systemHealth.bill_providers[provider] = health;
      }
    }

    // Determine overall status
    systemHealth.overall_status = this.calculateOverallStatus(systemHealth);

    return systemHealth;
  }

  // Get health for specific category

  async getCategoryHealth(category: ProviderCategory): Promise<{
    [provider: string]: ProviderHealth;
  }> {
    const categoryHealth: { [provider: string]: ProviderHealth } = {};

    const providers = Object.entries(this.providerCategories)
      .filter(([_, cat]) => cat === category)
      .map(([provider]) => provider);

    for (const provider of providers) {
      categoryHealth[provider] = await this.getProviderHealth(provider);
    }

    return categoryHealth;
  }

  // PRIVATE HELPER METHODS

  private async getRecentFailures(
    category: ProviderCategory,
    provider: string,
    operation: string,
    timeWindow: number,
  ): Promise<ProviderFailure[]> {
    try {
      const key = this.getCacheKey(category, provider, operation);
      const cached = await this.cacheService.get<string>(key);

      if (!cached) {
        return [];
      }

      const failures: ProviderFailure[] = JSON.parse(cached);

      // Filter out failures outside time window
      const cutoff = new Date(Date.now() - timeWindow * 1000);
      return failures.filter((f) => new Date(f.timestamp) > cutoff);
    } catch (error) {
      logger.error("Failed to get recent failures", error);
      return [];
    }
  }

  private async checkAndAlert(
    category: ProviderCategory,
    provider: string,
    operation: string,
    failures: ProviderFailure[],
    config: CategoryConfig,
  ): Promise<void> {
    if (failures.length < config.failureThreshold) {
      return;
    }

    // Check cooldown
    const cooldownKey = `${this.ALERT_COOLDOWN_PREFIX}${category}:${provider}:${operation}`;
    const inCooldown = await this.cacheService.get(cooldownKey);

    if (inCooldown) {
      logger.info(
        `Alert cooldown active for [${category}] ${provider}.${operation}`,
      );
      return;
    }

    // Send alert
    await this.sendAdminAlert(category, provider, operation, failures, config);

    // Set cooldown
    await this.cacheService.set(cooldownKey, "true", config.cooldownPeriod);
  }

  private async sendAdminAlert(
    category: ProviderCategory,
    provider: string,
    operation: string,
    failures: ProviderFailure[],
    config: CategoryConfig,
  ): Promise<void> {
    const errorSummary = this.buildErrorSummary(failures);
    const priority = this.getAlertPriority(category, operation);

    const alertMessage = `
PROVIDER HEALTH ALERT

Category: ${category.toUpperCase().replace(/_/g, " ")}
Provider: ${provider.toUpperCase()}
Operation: ${operation}
Priority: ${priority}

Failure Count: ${failures.length} within ${config.timeWindow / 60} minutes
Threshold: ${config.failureThreshold}

Recent Errors:
${errorSummary}

Time Range: ${failures[0].timestamp} to ${
      failures[failures.length - 1].timestamp
    }

Action Required: Please investigate ${provider} ${operation} operations immediately.
    `.trim();

    logger.error(`PROVIDER ALERT [${category}]: ${provider}.${operation}`, {
      category,
      provider,
      operation,
      priority,
      failureCount: failures.length,
      recentErrors: errorSummary,
    });

    // Send notifications
    await Promise.allSettled([
      // 1. In-app notification
      this.notificationService.createNotification({
        type: "admin_notification",
        notifiableType: "Admin",
        notifiableId: await this.getAdminUserId(),
        title: `⚠️ ${priority.toUpperCase()}: ${provider.toUpperCase()} ${operation} Failing`,
        message: alertMessage,
        data: {
          category,
          provider,
          operation,
          priority,
          failureCount: failures.length,
          failures: failures.slice(-5),
        },
        sendEmail: true,
        sendPush: false,
      }),

      // 2. Slack alert
      this.sendSlackAlert(
        category,
        provider,
        operation,
        alertMessage,
        priority,
      ),

      // 3. External monitoring
      this.logToMonitoringService(category, provider, operation, failures),
    ]);
  }

  private buildErrorSummary(failures: ProviderFailure[]): string {
    const errorGroups = failures.reduce(
      (acc, failure) => {
        const errorKey = failure.error.substring(0, 50);
        if (!acc[errorKey]) {
          acc[errorKey] = { count: 0, example: failure };
        }
        acc[errorKey].count++;
        return acc;
      },
      {} as Record<string, { count: number; example: ProviderFailure }>,
    );

    return Object.entries(errorGroups)
      .map(([error, { count }]) => `  - "${error}..." (×${count})`)
      .join("\n");
  }

  private getAlertPriority(
    category: ProviderCategory,
    operation: string,
  ): "critical" | "high" | "medium" {
    // Payment gateways are always critical
    if (category === "payment_gateway") {
      return "critical";
    }

    // Withdrawal/transfer operations are critical
    if (operation.includes("transfer") || operation.includes("withdrawal")) {
      return "critical";
    }


    // Bill providers are medium priority
    return "medium";
  }

  private async sendSlackAlert(
    category: ProviderCategory,
    provider: string,
    operation: string,
    message: string,
    priority: string,
  ): Promise<void> {
    try {
      if (!process.env.SLACK_WEBHOOK_URL) {
        return;
      }

      const axios = require("axios");
      const emoji = priority === "critical" ? ":rotating_light:" : ":warning:";

      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: message,
        channel: "#alerts",
        username: "Provider Health Monitor",
        icon_emoji: emoji,
        attachments: [
          {
            color: priority === "critical" ? "danger" : "warning",
            fields: [
              { title: "Category", value: category, short: true },
              { title: "Provider", value: provider, short: true },
              { title: "Operation", value: operation, short: true },
              { title: "Priority", value: priority.toUpperCase(), short: true },
            ],
          },
        ],
      });
    } catch (error) {
      logger.error("Failed to send Slack alert", error);
    }
  }

  private async logToMonitoringService(
    category: ProviderCategory,
    provider: string,
    operation: string,
    failures: ProviderFailure[],
  ): Promise<void> {
    try {
      const priority = this.getAlertPriority(category, operation);
      const latestFailure = failures[failures.length - 1];

      SentryHelper.captureBusinessError(
        `PROVIDER_${priority.toUpperCase()}`,
        `Provider failing: ${provider}.${operation} (${failures.length} failures)`,
        latestFailure?.userId,
        {
          category,
          provider,
          operation,
          priority,
          failureCount: failures.length,
          latestError: latestFailure?.error,
          reference: latestFailure?.reference,
          amount: latestFailure?.amount,
        },
      );
    } catch (error) {
      logger.error("Failed to log to monitoring service", error);
    }
  }

  private async getAdminUserId(): Promise<any> {
    return process.env.SYSTEM_ADMIN_USER_ID || "ADMIN_USER_ID";
  }

  private getCacheKey(
    category: ProviderCategory,
    provider: string,
    operation: string,
  ): string {
    return `${this.CACHE_PREFIX}${category}:${provider}:${operation}`;
  }

  private getCategoryForProvider(provider: string): ProviderCategory {
    const normalizedProvider = provider.toLowerCase().replace(/[^a-z]/g, "");
    return this.providerCategories[normalizedProvider] || "bill_provider";
  }

  private getOperationsForCategory(category: ProviderCategory): string[] {
    switch (category) {
      case "payment_gateway":
        return ["transfer", "payment", "verification", "balance"];
      case "bill_provider":
        return ["smm", "game_topup", "number_rental", "proxy"];
      default:
        return ["transaction"];
    }
  }

  private calculateOverallStatus(
    health: SystemHealth,
  ): "healthy" | "degraded" | "critical" {
    let failingCount = 0;
    let degradedCount = 0;

    const allProviders = [
      ...Object.values(health.payment_gateways),
      ...Object.values(health.bill_providers),
    ];

    for (const provider of allProviders) {
      for (const op of Object.values(provider.operations)) {
        if (op.status === "failing") failingCount++;
        if (op.status === "degraded") degradedCount++;
      }
    }

    // If any payment gateway is failing, system is critical
    const paymentGatewayFailing = Object.values(health.payment_gateways).some(
      (p) => Object.values(p.operations).some((op) => op.status === "failing"),
    );

    if (paymentGatewayFailing || failingCount >= 3) {
      return "critical";
    }

    if (failingCount > 0 || degradedCount >= 5) {
      return "degraded";
    }

    return "healthy";
  }
}
