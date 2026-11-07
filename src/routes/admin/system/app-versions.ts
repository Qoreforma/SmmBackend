import { Router } from "express";
import { AppVersionController } from "@/controllers/admin/system/AppVersionController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import {
  createAppVersionValidation,
  updateAppVersionValidation,
} from "@/validations/admin/appVersionValidation";

const router = Router();
const appVersionController = new AppVersionController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.APP_VERSIONS.VIEW),
  appVersionController.listAppVersions
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.APP_VERSIONS.CREATE),
  validateRequest(createAppVersionValidation),
  appVersionController.createAppVersion
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.APP_VERSIONS.VIEW),
  appVersionController.getAppVersionDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.APP_VERSIONS.UPDATE),
  validateRequest(updateAppVersionValidation),
  appVersionController.updateAppVersion
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.APP_VERSIONS.DELETE),
  appVersionController.deleteAppVersion
);

export default router;
