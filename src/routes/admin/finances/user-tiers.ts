import { Router } from "express";
import { UserTierController } from "@/controllers/admin/finances/UserTierController";

const router = Router();
const controller = new UserTierController();

// GET all user tiers
router.get("/", controller.listTiers);

// POST create user tier
router.post("/", controller.createTier);

// GET tier by ID
router.get("/:id", controller.getTier);

// PUT update tier
router.put("/:id", controller.updateTier);

// DELETE tier
router.delete("/:id", controller.deleteTier);

// POST batch evaluate active users' tiers based on 30-day spend
router.post("/evaluate-all", controller.evaluateAllUserTiers);

export default router;
