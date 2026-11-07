import { Router } from "express";
import { TelegramController } from "@/controllers/client/TelegramController";
import { authenticate } from "@/middlewares/client/auth";
import { rateLimiter, globalIpRateLimiter } from "@/middlewares/shared/rateLimiter";

const router = Router();
const controller = new TelegramController();

// 1. Mini-App 1-Tap Authentication (Public)
router.post(
  "/auth/mini-app",
  globalIpRateLimiter(20, 60),
  controller.authMiniApp,
);

// 2. Generate Account Link Token (Protected - for user to link account via Telegram)
router.post(
  "/link-token",
  authenticate,
  rateLimiter(10, 60 * 1000),
  controller.generateLinkToken,
);

// 3. Bot Webhook Handler (From Telegram servers)
router.post(
  "/webhook",
  controller.handleWebhook,
);

// 4. Public Bot Configuration / Info
router.get(
  "/info",
  controller.getBotInfo,
);

export default router;
