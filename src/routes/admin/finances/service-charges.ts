import { Router } from "express";
import { ServiceChargeController } from "@/controllers/admin/finances/ServiceChargeController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import {
  bulkUpdateServiceChargeValidation,
  updateServiceChargeValidationSchema,
} from "@/validations/admin/serviceChargeValidation";
import { validateRequest } from "@/middlewares/shared/validation";

const router = Router();
const serviceChargeController = new ServiceChargeController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SERVICE_CHARGES.VIEW),
  serviceChargeController.listServiceCharges
);

router.put(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.SERVICE_CHARGES.UPDATE),
  validateRequest(bulkUpdateServiceChargeValidation),
  serviceChargeController.bulkUpdateServiceCharges
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SERVICE_CHARGES.VIEW),
  serviceChargeController.getServiceChargeDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SERVICE_CHARGES.UPDATE),
  validateRequest(updateServiceChargeValidationSchema),
  serviceChargeController.updateServiceCharge
);

export default router;
