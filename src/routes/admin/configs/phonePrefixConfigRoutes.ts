
import { Router } from "express";

import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { PhonePrefixConfigController } from "@/controllers/admin/congifs/Phoneprefixconfigcontroller";
import { PhonePrefixConfigRepository } from "@/repositories/admin/Phoneprefixconfigrepository";
import { PhonePrefixConfigService } from "@/services/admin/configs/Phoneprefixconfigservice";

const phonePrefixRouter = Router();

const phonePrefixController = new PhonePrefixConfigController(
  new PhonePrefixConfigService(new PhonePrefixConfigRepository())
);

phonePrefixRouter.use(adminAuth);

// GET /admin/config/phone-prefixes
phonePrefixRouter.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.VIEW),
  phonePrefixController.getConfig
);

// PUT /admin/config/phone-prefixes  (replace entire list)
phonePrefixRouter.put(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("replace", "phone_prefix_config"),
  phonePrefixController.replacePrefixes
);

// POST /admin/config/phone-prefixes  (add single prefix)
phonePrefixRouter.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("create", "phone_prefix_config"),
  phonePrefixController.addPrefix
);

// PATCH /admin/config/phone-prefixes/:prefix  (update network for a prefix)
phonePrefixRouter.patch(
  "/:prefix",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("update", "phone_prefix_config"),
  phonePrefixController.updatePrefix
);

// DELETE /admin/config/phone-prefixes/:prefix
phonePrefixRouter.delete(
  "/:prefix",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("delete", "phone_prefix_config"),
  phonePrefixController.removePrefix
);

phonePrefixRouter.post(
  "/reset-defaults",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("reset", "phone_prefix_config"),
  phonePrefixController.resetDefaults
);

export default phonePrefixRouter;