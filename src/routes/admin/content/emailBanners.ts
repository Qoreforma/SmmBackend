import { Router } from "express";
import { EmailBannerController } from "@/controllers/admin/content/EmailBannerController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { validateRequest } from "@/middlewares/shared/validation";
import { updateEmailBannerValidation } from "@/validations/admin/emailBannerValidation";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const emailBannerController = new EmailBannerController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.EMAIL_BANNERS.VIEW),
  emailBannerController.getEmailBanners.bind(emailBannerController)
);

router.put(
  "/",
  requirePermission(ADMIN_PERMISSIONS.EMAIL_BANNERS.UPDATE),
  validateRequest(updateEmailBannerValidation),
  auditLog("update", "email_banner"),
  emailBannerController.updateEmailBanners.bind(emailBannerController)
);

export default router;
