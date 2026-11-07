import { Router } from "express";
import { ServiceTypeController } from "@/controllers/admin/products/ServiceTypeController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import {
  createServiceTypeSchema,
  updateServiceTypeSchema,
  updateServiceTypeStatusSchema,
} from "@/validations/admin/serviceTypeValidation";
import { validateRequest } from "@/middlewares/shared/validation";

const router = Router();
const serviceTypeController = new ServiceTypeController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.VIEW),
  serviceTypeController.listServiceTypes
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.UPDATE),
  validateRequest(createServiceTypeSchema),
  auditLog("create", "service_type"),
  serviceTypeController.createServiceType
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.VIEW),
  serviceTypeController.getServiceTypeDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.UPDATE),
  validateRequest(updateServiceTypeSchema),
  auditLog("update", "service_type"),
  serviceTypeController.updateServiceType
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.UPDATE),
  validateRequest(updateServiceTypeStatusSchema),
  auditLog("update_status", "service_type"),
  serviceTypeController.updateServiceTypeStatus
);

router.get(
  "/:id/services",
  requirePermission(ADMIN_PERMISSIONS.SETTINGS.VIEW),
  serviceTypeController.getServiceTypeServices
);

export default router;