import { Router } from "express";
import { TelegramSettingController } from "@/controllers/admin/system/TelegramSettingController";

const router = Router();
const controller = new TelegramSettingController();

// GET current Telegram bot configuration
router.get("/", controller.getSettings);

// PUT update Telegram bot configuration
router.put("/", controller.updateSettings);

export default router;
