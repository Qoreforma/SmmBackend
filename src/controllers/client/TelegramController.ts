import { Request, Response, NextFunction } from "express";
import ServiceContainer from "@/services/client/container";
import { HTTP_STATUS } from "@/utils/constants";
import { telegramConfig } from "@/config/telegram";
import logger from "@/logger";

export class TelegramController {
  // Mini-App 1-Tap Authentication
  authMiniApp = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { initData } = req.body;
      if (!initData) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          status: "error",
          message: "Telegram initData is required",
        });
      }

      const telegramService = ServiceContainer.getTelegramService();
      const authResult = await telegramService.authenticateMiniApp(initData);

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "Telegram Mini-App authentication successful",
        data: authResult,
      });
    } catch (error) {
      next(error);
    }
  };

  // Generate Link Token from regular mobile/web app
  generateLinkToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?._id;
      const telegramService = ServiceContainer.getTelegramService();
      const result = await telegramService.generateAccountLinkToken(String(userId));

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "Telegram account link token generated",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // Telegram Bot Webhook endpoint
  handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Optional secret validation
      const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
      if (
        telegramConfig.webhookSecret &&
        secretHeader !== telegramConfig.webhookSecret
      ) {
        logger.warn("Unauthorized Telegram webhook request - invalid secret header");
        return res.status(HTTP_STATUS.FORBIDDEN).json({ status: "forbidden" });
      }

      const telegramService = ServiceContainer.getTelegramService();
      // Execute asynchronously and return 200 immediately to Telegram to prevent timeouts
      telegramService.handleWebhookUpdate(req.body).catch((err) => {
        logger.error("Error in background telegram webhook handling", err);
      });

      return res.status(HTTP_STATUS.OK).json({ status: "ok" });
    } catch (error) {
      logger.error("Telegram webhook handler error", error);
      return res.status(HTTP_STATUS.OK).json({ status: "ok" });
    }
  };

  // Get public Telegram Bot configuration
  getBotInfo = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const telegramService = ServiceContainer.getTelegramService();
      const settings = await telegramService.getSettings();

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: {
          isEnabled: settings.isEnabled,
          botUsername: settings.botUsername,
          miniAppUrl: settings.miniAppUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
