import { Router } from "express";
import { AlertController } from "@/controllers/admin/content/AlertController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createAlertValidation,
  updateAlertValidation,
} from "@/validations/admin/alertValidation";

const router = Router();
const alertController = new AlertController();

router.use(adminAuth);

// List all alerts with filters
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.VIEW),
  alertController.listAlerts
);

// Create new alert
router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.CREATE),
  validateRequest(createAlertValidation),
  auditLog("create", "alert"),
  alertController.createAlert
);

// Get alert details
router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.VIEW),
  alertController.getAlertDetails
);

// Update alert (only if not dispatched)
router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.UPDATE),
  validateRequest(updateAlertValidation),
  auditLog("update", "alert"),
  alertController.updateAlert
);

// Delete alert (soft delete)
router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.DELETE),
  auditLog("delete", "alert"),
  alertController.deleteAlert
);

// Restore deleted alert
router.put(
  "/:id/restore",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.UPDATE),
  auditLog("restore", "alert"),
  alertController.restoreAlert
);

// Manually dispatch alert immediately
router.post(
  "/:id/dispatch",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.UPDATE),
  auditLog("dispatch", "alert"),
  alertController.dispatchAlert
);

// Redispatch already sent alert
router.post(
  "/:id/redispatch",
  requirePermission(ADMIN_PERMISSIONS.ALERTS.UPDATE),
  auditLog("redispatch", "alert"),
  alertController.redispatchAlert
);

export default router;
