import { Router } from "express";
import { ServiceController } from "@/controllers/admin/products/ServiceController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { createServiceValidation, updateServiceValidation, updateServiceStatusValidation } from "@/validations/admin/serviceValidation";

const router = Router();
const serviceController = new ServiceController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  serviceController.listServices
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  validateRequest(createServiceValidation),
  auditLog("create", "service"),
  serviceController.createService
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  serviceController.getServiceDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  validateRequest(updateServiceValidation),
  auditLog("update", "service"),
  serviceController.updateService
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  validateRequest(updateServiceStatusValidation),
  auditLog("update_status", "service"),
  serviceController.updateServiceStatus
);

// Get service products
router.get(
  "/:id/products",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_SERVICES),
  serviceController.getServiceProducts
);

export default router;