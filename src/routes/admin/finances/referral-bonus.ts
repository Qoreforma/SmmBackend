import { Router } from "express";
import { ReferralBonusController } from "@/controllers/admin/finances/ReferralBonusController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createReferralBonusValidation,
  updateReferralBonusValidation,
} from "@/validations/admin/referralBonusValidation";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const controller = new ReferralBonusController();

router.use(adminAuth);

// Get all bonus
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.MANAGE_REFERRAL_BONUS),
  controller.getAllBonus
);

// Create new bonus
router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.MANAGE_REFERRAL_BONUS),
  validateRequest(createReferralBonusValidation),
  auditLog("create", "referral_bonus"),
  controller.createBonus
);

// Update bonus
router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.MANAGE_REFERRAL_BONUS),
  validateRequest(updateReferralBonusValidation),
  auditLog("update", "referral_bonus"),
  controller.updateBonus
);

export default router;
