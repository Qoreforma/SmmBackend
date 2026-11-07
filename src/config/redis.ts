import { createClient, RedisClientType } from "redis";
import logger from "../logger";

class RedisConfig {
  public client!: RedisClientType;
  private connectionString: string;
  private isConnected: boolean = false;

  constructor() {
    this.connectionString = process.env.REDIS_URL || "redis://localhost:6379";
    // DON'T create the client here - wait for connect() to be called
  }

  async connect(): Promise<void> {
    try {
      if (this.isConnected && this.client?.isReady) {
        logger.info("Redis already connected");
        return;
      }

      logger.info("Initiating Redis connection", {
        url: this.connectionString.replace(/:[^:@]*@/, ":***@"),
      });

      // Create the client only when connect() is called
      this.client = createClient({
        url: this.connectionString,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error("Redis reconnection attempts exhausted");
              return new Error("Redis reconnection failed");
            }
            const delay = Math.min(retries * 50, 1000);
            logger.warn(
              `Redis reconnecting in ${delay}ms (attempt ${retries})`
            );
            return delay;
          },
        },
      });

      this.setupEventHandlers();

      await this.client.connect();
      this.isConnected = true;

      logger.info("Redis connected successfully");

      // Test connection
      await this.client.ping();
      logger.debug("Redis ping successful");
    } catch (error) {
      this.isConnected = false;
      logger.error("Redis connection error:", error);

      // In development, don't throw - allow app to continue
      if (process.env.NODE_ENV === "development") {
        logger.warn("Running without Redis in development mode");
        return;
      }

      throw error;
    }
  }

  async ensureConnected(): Promise<void> {
    if (!this.isConnected || !this.client?.isReady) {
      logger.debug("Redis not ready, connecting...");
      await this.connect();
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (!this.isConnected || !this.client) {
        logger.info("Redis already disconnected");
        return;
      }

      await this.client.quit();
      this.isConnected = false;
      logger.info("Redis disconnected successfully");
    } catch (error) {
      logger.error("Redis disconnection error:", error);
      throw error;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected && this.client?.isReady;
  }

  async getInfo(): Promise<any> {
    try {
      await this.ensureConnected();

      const info = await this.client.info();
      return this.parseRedisInfo(info);
    } catch (error) {
      logger.error("Error getting Redis info:", error);
      throw error;
    }
  }

  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: any;
  }> {
    try {
      if (!this.getConnectionStatus()) {
        return {
          status: "unhealthy",
          details: { error: "Redis not connected" },
        };
      }

      const start = Date.now();
      const pong = await this.client.ping();
      const latency = Date.now() - start;

      if (pong === "PONG") {
        const info = await this.getInfo();
        return {
          status: "healthy",
          details: {
            latency: `${latency}ms`,
            memory: info.used_memory_human,
            connected_clients: info.connected_clients,
            uptime: info.uptime_in_seconds,
          },
        };
      } else {
        return {
          status: "unhealthy",
          details: { error: "Invalid ping response", response: pong },
        };
      }
    } catch (error) {
      return {
        status: "unhealthy",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  async flushAll(): Promise<void> {
    if (
      process.env.NODE_ENV !== "test" &&
      process.env.NODE_ENV !== "development"
    ) {
      throw new Error(
        "Can only flush Redis in test or development environment"
      );
    }

    try {
      await this.ensureConnected();
      await this.client.flushAll();
      logger.info("Redis flushed successfully");
    } catch (error) {
      logger.error("Error flushing Redis:", error);
      throw error;
    }
  }

  async getDbSize(): Promise<number> {
    try {
      await this.ensureConnected();
      return await this.client.dbSize();
    } catch (error) {
      logger.error("Error getting Redis DB size:", error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    this.client.on("ready", () => {
      this.isConnected = true;
      logger.info("Redis client ready");
    });

    this.client.on("connect", () => {
      logger.info("Redis client connected");
    });

    this.client.on("reconnecting", () => {
      logger.warn("Redis client reconnecting");
    });

    this.client.on("error", (error) => {
      this.isConnected = false;
      logger.error("Redis client error:", error);
    });

    this.client.on("end", () => {
      this.isConnected = false;
      logger.info("Redis client connection ended");
    });
  }

  private parseRedisInfo(info: string): any {
    const lines = info.split("\r\n");
    const result: any = {};

    for (const line of lines) {
      if (line && !line.startsWith("#")) {
        const [key, value] = line.split(":");
        if (key && value) {
          if (!isNaN(Number(value))) {
            result[key] = Number(value);
          } else {
            result[key] = value;
          }
        }
      }
    }

    return result;
  }

  async executeCommand(command: string, ...args: any[]): Promise<any> {
    try {
      await this.ensureConnected();

      // @ts-ignore - Dynamic command execution
      return await this.client[command.toLowerCase()](...args);
    } catch (error) {
      logger.error(`Redis command error (${command}):`, error);
      throw error;
    }
  }

  async executePipeline(
    commands: Array<{ command: string; args: any[] }>
  ): Promise<any[]> {
    try {
      await this.ensureConnected();

      const pipeline = this.client.multi();

      for (const { command, args } of commands) {
        // @ts-ignore - Dynamic command execution
        pipeline[command.toLowerCase()](...args);
      }

      const results = await pipeline.exec();
      return results;
    } catch (error) {
      logger.error("Redis pipeline error:", error);
      throw error;
    }
  }
}

// Create singleton instance
const redisConfig = new RedisConfig();

// Export the client and functions
export const redisClient = redisConfig.client;
export const connectRedis = () => redisConfig.connect();
export const ensureRedisConnected = () => redisConfig.ensureConnected();
export const disconnectRedis = () => redisConfig.disconnect();
export const getRedisStatus = () => redisConfig.getConnectionStatus();
export const redisHealthCheck = () => redisConfig.healthCheck();
export const flushRedis = () => redisConfig.flushAll();
export const getRedisDbSize = () => redisConfig.getDbSize();
export const executeRedisCommand = (command: string, ...args: any[]) =>
  redisConfig.executeCommand(command, ...args);
export const executeRedisPipeline = (
  commands: Array<{ command: string; args: any[] }>
) => redisConfig.executePipeline(commands);

export default redisConfig;
