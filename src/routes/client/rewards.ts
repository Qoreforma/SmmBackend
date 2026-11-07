import { Router } from "express";
import { RewardController } from "@/controllers/client/RewardController";
import { authenticate } from "@/middlewares/client/auth";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";

const router = Router();
const controller = new RewardController();

router.use(authenticate);

// GET /api/v1/client/rewards/daily-streak - Get current streak status
router.get("/daily-streak", controller.getStreakStatus);

// POST /api/v1/client/rewards/daily-streak/claim - Claim streak reward
router.post(
  "/daily-streak/claim",
  rateLimiter(10, 60 * 1000),
  controller.claimDailyStreak,
);

export default router;
