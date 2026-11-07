import { Router } from "express";
import { BannerController } from "@/controllers/admin/content/BannerController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import {
  createBannerValidation,
  reorderBannersValidation,
  updateBannerValidation,
} from "@/validations/admin/bannerValidation";

const router = Router();
const bannerController = new BannerController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.VIEW),
  bannerController.listBanners
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.CREATE),
  validateRequest(createBannerValidation),
  auditLog("create", "banner"),
  bannerController.createBanner
);

router.put(
  "/reorder",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.UPDATE),
  validateRequest(reorderBannersValidation),
  auditLog("reorder", "banner"),
  bannerController.reorderBanners
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.VIEW),
  bannerController.getBannerDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.UPDATE),
  validateRequest(updateBannerValidation),
  auditLog("update", "banner"),
  bannerController.updateBanner
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.BANNERS.DELETE),
  auditLog("delete", "banner"),
  bannerController.deleteBanner
);

router.put(
  "/:id/status",
   requirePermission(ADMIN_PERMISSIONS.BANNERS.UPDATE),
  auditLog("delete", "banner"),
  bannerController.updateStatus
)
export default router;
