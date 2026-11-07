import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { ProviderHealthMonitor } from "@/services/monitoring/ProviderHealthMonitor";
// TYPES

type ProviderCategory =
  | "payment_gateway"
  | "bill_provider";

interface MonitoredMethod {
  (...args: any[]): Promise<any>;
}

// Wraps a provider service with automatic failure tracking

export function withProviderMonitoring<T extends object>(
  service: T,
  providerName: string,
  category: ProviderCategory,
): T {
  // Get monitoring instance
  const getMonitor = (): ProviderHealthMonitor => {
    const cacheService = ServiceContainer.getCacheService();
    const notificationService = ServiceContainer.getNotificationService();
    return new ProviderHealthMonitor(cacheService, notificationService);
  };

  // Create proxy to intercept method calls
  return new Proxy(service, {
    get(target: any, prop: string) {
      const originalMethod = target[prop];

      // Only wrap methods (functions)
      if (typeof originalMethod !== "function") {
        return originalMethod;
      }

      // Return wrapped method
      return async function (this: any, ...args: any[]) {
        const monitor = getMonitor();
        const operation = prop; // Method name is the operation

        try {
          // Execute original method
          const result = await originalMethod.apply(target, args);

          // Track success (clears failures)
          monitor.trackSuccess(category, providerName, operation).catch(() => {
            logger.error("Failed to track provider success");
          });

          return result;
        } catch (error: any) {
          // Track failure
          monitor
            .trackFailure({
              category,
              provider: providerName,
              operation,
              error: error.message || "Unknown error",
              timestamp: new Date(),
              // Extract metadata from args if available
              userId: extractUserId(args),
              reference: extractReference(args),
              amount: extractAmount(args),
            })
            .catch(() => {
              logger.error("Failed to track provider failure");
            });

          throw error;
        }
      };
    },
  });
}

// MANUAL TRACKING HELPERS

// Manually track a provider failure
export async function trackProviderFailure(
  category: ProviderCategory,
  provider: string,
  operation: string,
  error: Error | string,
  metadata?: {
    userId?: string;
    reference?: string;
    amount?: number;
    transactionType?: string;
  },
): Promise<void> {
  try {
    const cacheService = ServiceContainer.getCacheService();
    const notificationService = ServiceContainer.getNotificationService();
    const monitor = new ProviderHealthMonitor(
      cacheService,
      notificationService,
    );

    await monitor.trackFailure({
      category,
      provider,
      operation,
      error: typeof error === "string" ? error : error.message,
      timestamp: new Date(),
      ...metadata,
    });
  } catch (err) {
    logger.error("Failed to track provider failure", err);
  }
}

// Manually track a provider success
export async function trackProviderSuccess(
  category: ProviderCategory,
  provider: string,
  operation: string,
): Promise<void> {
  try {
    const cacheService = ServiceContainer.getCacheService();
    const notificationService = ServiceContainer.getNotificationService();
    const monitor = new ProviderHealthMonitor(
      cacheService,
      notificationService,
    );

    await monitor.trackSuccess(category, provider, operation);
  } catch (err) {
    logger.error("Failed to track provider success", err);
  }
}

// Get provider health status
export async function getProviderHealth(provider: string): Promise<any> {
  const cacheService = ServiceContainer.getCacheService();
  const notificationService = ServiceContainer.getNotificationService();
  const monitor = new ProviderHealthMonitor(cacheService, notificationService);

  return monitor.getProviderHealth(provider);
}

// Get system-wide health status
export async function getSystemHealth(): Promise<any> {
  const cacheService = ServiceContainer.getCacheService();
  const notificationService = ServiceContainer.getNotificationService();
  const monitor = new ProviderHealthMonitor(cacheService, notificationService);

  return monitor.getSystemHealth();
}

// Get health for a specific category
export async function getCategoryHealth(
  category: ProviderCategory,
): Promise<any> {
  const cacheService = ServiceContainer.getCacheService();
  const notificationService = ServiceContainer.getNotificationService();
  const monitor = new ProviderHealthMonitor(cacheService, notificationService);

  return monitor.getCategoryHealth(category);
}

// METADATA EXTRACTORS

function extractUserId(args: any[]): string | undefined {
  // Try to find userId in args
  for (const arg of args) {
    if (arg && typeof arg === "object") {
      if (arg.userId) return arg.userId;
      if (arg.user?.id) return arg.user.id;
    }
  }
  return undefined;
}

function extractReference(args: any[]): string | undefined {
  for (const arg of args) {
    if (arg && typeof arg === "object") {
      if (arg.reference) return arg.reference;
      if (arg.transactionReference) return arg.transactionReference;
      if (arg.orderReference) return arg.orderReference;
    }
  }
  return undefined;
}

function extractAmount(args: any[]): number | undefined {
  for (const arg of args) {
    if (arg && typeof arg === "object") {
      if (typeof arg.amount === "number") return arg.amount;
      if (typeof arg.totalAmount === "number") return arg.totalAmount;
    }
  }
  return undefined;
}

// TRANSACTION-LEVEL MONITORING

// Track transaction-level failures (high-level operations)
// This tracks failures at the business logic level, not provider level
export async function trackTransactionFailure(
  transactionType: string,
  error: Error | string,
  metadata?: {
    userId?: string;
    reference?: string;
    amount?: number;
    provider?: string;
  },
): Promise<void> {
  try {
    // Log transaction failure for analytics
    logger.error(`Transaction failure: ${transactionType}`, {
      transactionType,
      error: typeof error === "string" ? error : error.message,
      ...metadata,
    });

    //  add additional tracking here:
    // - Send to analytics service
    // - Track in database
    // - Create alerts if multiple transaction types are failing
  } catch (err) {
    logger.error("Failed to track transaction failure", err);
  }
}

// HELPER: WRAP SPECIFIC METHODS

// Wrap only specific methods of a service
// Useful when you don't want to monitor all methods
export function wrapSpecificMethods<T extends object>(
  service: T,
  providerName: string,
  category: ProviderCategory,
  methodsToWrap: string[],
): T {
  const getMonitor = (): ProviderHealthMonitor => {
    const cacheService = ServiceContainer.getCacheService();
    const notificationService = ServiceContainer.getNotificationService();
    return new ProviderHealthMonitor(cacheService, notificationService);
  };

  return new Proxy(service, {
    get(target: any, prop: string) {
      const originalMethod = target[prop];

      // Only wrap if it's a method and it's in our list
      if (
        typeof originalMethod !== "function" ||
        !methodsToWrap.includes(prop)
      ) {
        return originalMethod;
      }

      return async function (this: any, ...args: any[]) {
        const monitor = getMonitor();

        try {
          const result = await originalMethod.apply(target, args);
          await monitor.trackSuccess(category, providerName, prop);
          return result;
        } catch (error: any) {
          await monitor.trackFailure({
            category,
            provider: providerName,
            operation: prop,
            error: error.message || "Unknown error",
            timestamp: new Date(),
            userId: extractUserId(args),
            reference: extractReference(args),
            amount: extractAmount(args),
          });
          throw error;
        }
      };
    },
  });
}

export default {
  withProviderMonitoring,
  trackProviderFailure,
  trackProviderSuccess,
  getProviderHealth,
  getSystemHealth,
  getCategoryHealth,
  trackTransactionFailure,
  wrapSpecificMethods,
};
