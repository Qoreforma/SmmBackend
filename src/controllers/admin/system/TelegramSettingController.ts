import { Request, Response, NextFunction } from "express";
import ServiceContainer from "@/services/client/container";
import { HTTP_STATUS } from "@/utils/constants";

export class TelegramSettingController {
  getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const telegramService = ServiceContainer.getTelegramService();
      const settings = await telegramService.getSettings();

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: settings,
      });
    } catch (error) {
      next(error);
    }
  };

  updateSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const telegramService = ServiceContainer.getTelegramService();
      const updated = await telegramService.updateSettings(req.body);

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "Telegram bot settings updated successfully",
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };
}
