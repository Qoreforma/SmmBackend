import logger from "@/logger";

// Base class for all sync services
// Provides common functionality and patterns
export abstract class BaseSyncService {
  // Execute sync operation with error handling and logging

  protected async executeSyncOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      logger.info(`Starting ${operationName}`, context);

      const result = await operation();

      const duration = Date.now() - startTime;
      logger.info(`${operationName} completed in ${duration}ms`, {
        ...context,
        duration,
      });

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error(`${operationName} failed after ${duration}ms`, {
        ...context,
        error: error.message,
        duration,
      });
      throw error;
    }
  }

  // Process items in batches

  protected async processBatch<T, R>(
    items: T[],
    batchSize: number,
    processor: (item: T) => Promise<R>,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{
    successful: R[];
    failed: Array<{ item: T; error: string }>;
  }> {
    const successful: R[] = [];
    const failed: Array<{ item: T; error: string }> = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      for (const item of batch) {
        try {
          const result = await processor(item);
          successful.push(result);
        } catch (error: any) {
          failed.push({ item, error: error.message });
        }
      }

      if (onProgress) {
        onProgress(i + batch.length, items.length);
      }
    }

    return { successful, failed };
  }

  // Retry operation with exponential backoff

  protected async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          let delay = baseDelay * Math.pow(2, attempt);
          if (error.message && error.message.includes("429")) {
            delay = Math.max(delay, 5000); // Wait at least 5 seconds on rate limits
          }
          
          logger.warn(`Operation failed, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxRetries,
            error: error.message,
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  // Sleep utility

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Build sync result statistics

  protected buildSyncResult(
    provider: string,
    startTime: Date,
    stats: {
      created?: number;
      updated?: number;
      failed?: number;
      deleted?: number;
      total?: number;
    },
    errors: Array<{ id: string; error: string }> = []
  ) {
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    return {
      success: (stats.failed || 0) === 0 && errors.length === 0,
      provider,
      startTime,
      endTime,
      duration,
      created: stats.created || 0,
      updated: stats.updated || 0,
      failed: stats.failed || 0,
      deleted: stats.deleted || 0,
      total: stats.total || 0,
      errors: errors.map((e) => e.error),
    };
  }
}
