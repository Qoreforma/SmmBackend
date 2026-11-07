import "./config/sentry";
import { config } from "dotenv";
config();
import { connectDatabase } from "./config/database";
import { connectRedis, disconnectRedis, flushRedis } from "./config/redis";
import app from "./app";
import logger from "./logger";
import mongoose from "mongoose";
import { initializeFirebase } from "./config/firebase";
import { startAllCronJobs } from "./jobs";
import { SaveHavenService } from "./services/client/providers/payments/SaveHavenService";

import { triggerReconciliationNow } from "./jobs/dailyproviderreconciliation";
import { runReferralBonusProcessingNow } from "./jobs/referralBonusCron";
import ServiceContainer from "./services/client/container";
import { createServer } from "http";
import { Server } from "socket.io";
import SocketService from "./services/core/SocketService";
import { socketAuth, AuthedSocket } from "./middlewares/core/socketAuth";

const PORT = process.env.PORT || 5000;
const enviroment = process.env.NODE_ENV || "development";



export let io: Server;
let server: any = null;
let isShuttingDown = false;
let activeJobs: any[] = [];

const startServer = async () => {
  try {
    logger.info("Starting server...");

    await connectRedis();
    await connectDatabase();
    await initializeFirebase();
    // await pss.syncProviderProducts("6a9377bd39d82ed613946f13")
    // await pss.syncProviderProducts("690b878e58257f44d05233b9")



    // await runReferralBonusProcessingNow();
    // await triggerReconciliationNow()

    // await syncImmediately();
    // Start all cron jobs and capture handles
    activeJobs = startAllCronJobs();

    const httpServer = createServer(app);
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    SocketService.init(io);

    io.use(socketAuth);

    io.on("connection", (socket: AuthedSocket) => {
      if (socket.userId) {
        socket.join(`user:${socket.userId}`);
      }

      socket.on("subscribe:transaction", (reference: string) => {
        socket.join(reference);
      });

      socket.on("unsubscribe:transaction", (reference: string) => {
        socket.leave(reference);
      });
    });

    server = httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${enviroment}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });

    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) {
        logger.warn("Shutdown already in progress, ignoring duplicate signal");
        return;
      }

      isShuttingDown = true;
      logger.info(`Received ${signal} signal, closing server gracefully...`);

      const forceShutdownTimer = setTimeout(() => {
        logger.error("Forced shutdown after 5s timeout");
        process.exit(1);
      }, 5000);

      try {
        // 1. Stop all cron jobs first to clear the event loop
        logger.info("Stopping background jobs...");
        activeJobs.forEach((job) => {
          if (job && typeof job.stop === "function") job.stop();
        });
        logger.info("Background jobs stopped");

        // 2. Stop accepting new connections
        if (server) {
          await new Promise<void>((resolve) => {
            server.close((err: Error) => {
              if (err) {
                logger.error("Error closing HTTP server:", err);
              } else {
                logger.info("HTTP server closed");
              }
              resolve();
            });
          });
        }

        // 3. Close Redis connection
        try {
          await disconnectRedis();
          logger.info("Redis connection closed");
        } catch (error) {
          logger.error("Error closing Redis:", error);
        }

        // 4. Close MongoDB connection
        try {
          await mongoose.connection.close();
          logger.info("MongoDB connection closed");
        } catch (error) {
          logger.error("Error closing MongoDB:", error);
        }

        clearTimeout(forceShutdownTimer);
        logger.info("Graceful shutdown completed");
        process.exit(0);
      } catch (error) {
        logger.error("Error during graceful shutdown:", error);
        clearTimeout(forceShutdownTimer);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

startServer();