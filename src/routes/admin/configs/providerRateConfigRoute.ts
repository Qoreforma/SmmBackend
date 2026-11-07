import { Router } from "express";

import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { ProviderRateConfigController } from "@/controllers/admin/congifs/Providerrateconfigcontroller";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import { ProviderRateConfigService } from "@/services/admin/configs/Providerrateconfigservice";

const router = Router();

const controller = new ProviderRateConfigController(
  new ProviderRateConfigService(
    new ProviderRateConfigRepository(),
    new ProviderRepository()
  )
);

router.use(adminAuth);

// GET /admin/config/provider-rates
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.VIEW),
  controller.listAll
);

// GET /admin/config/provider-rates/:providerCode
router.get(
  "/:providerCode",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.VIEW),
  controller.getByProviderCode
);

// POST /admin/config/provider-rates  (create or update)
router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("upsert", "provider_rate_config"),
  controller.upsert
);

// PATCH /admin/config/provider-rates/:providerId/rates
router.patch(
  "/:providerId/rates",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("update", "provider_rate_config"),
  controller.updateRates
);

// PATCH /admin/config/provider-rates/:providerId/status
router.patch(
  "/:providerId/status",
  requirePermission(ADMIN_PERMISSIONS.CONFIG.UPDATE),
  auditLog("update", "provider_rate_config"),
  controller.toggleActive
);

export default router;

