import { Router } from "express";
import { DailyStreakSettingController } from "@/controllers/admin/system/DailyStreakSettingController";

const router = Router();
const controller = new DailyStreakSettingController();

// GET /api/v1/admin/streak-settings
router.get("/", controller.getSettings);

// PUT /api/v1/admin/streak-settings
router.put("/", controller.updateSettings);

export default router;
