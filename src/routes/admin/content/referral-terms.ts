import { Router } from "express";
import { ReferralTermsController } from "@/controllers/admin/content/ReferralTermsController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createReferralTermsValidation,
  updateReferralTermsValidation,
} from "@/validations/admin/referralTermsValidation";

const router = Router();
const referralTermsController = new ReferralTermsController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.REFERRAL_TERMS.VIEW),
  referralTermsController.listReferralTerms
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.REFERRAL_TERMS.CREATE),
  validateRequest(createReferralTermsValidation),
  auditLog("create", "referral_terms"),
  referralTermsController.createReferralTerms
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.REFERRAL_TERMS.VIEW),
  referralTermsController.getReferralTermsDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.REFERRAL_TERMS.UPDATE),
  validateRequest(updateReferralTermsValidation),
  auditLog("update", "referral_terms"),
  referralTermsController.updateReferralTerms
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.REFERRAL_TERMS.DELETE),
  auditLog("delete", "referral_terms"),
  referralTermsController.deleteReferralTerms
);

export default router;
