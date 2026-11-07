import { Router } from "express";
import {
  createAdminSchema,
  getAdminsQuerySchema,
  updateAdminSchema,
} from "@/validations/admin/authValidation";
import { validateRequest } from "@/middlewares/shared/validation";
import { AdminManagementController } from "@/controllers/admin/AdminManagementController";
import { adminAuth, requireRole } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const adminManagementController = new AdminManagementController();

router.use(adminAuth);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.ADMIN.CREATE),
  validateRequest(createAdminSchema),
  adminManagementController.createAdmin as any,
);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.ADMIN.VIEW),
  validateRequest(getAdminsQuerySchema),
  adminManagementController.getAllAdmins,
);

router.get(
  "/statistics",
  requirePermission(ADMIN_PERMISSIONS.ADMIN.ADMIN_STATS),
  adminManagementController.getAdminStatistics,
);

router.get(
  "/:adminId",
  requirePermission(ADMIN_PERMISSIONS.ADMIN.VIEW),
  adminManagementController.getAdminById,
);

router.put(
  "/:adminId",
  requireRole(["super_admin"]) as any,
  requirePermission(ADMIN_PERMISSIONS.ADMIN.UPDATE),
  validateRequest(updateAdminSchema),
  adminManagementController.updateAdmin as any,
);

router.delete(
  "/:adminId/deactivate",
  requireRole(["super_admin"]) as any,
  requirePermission(ADMIN_PERMISSIONS.ADMIN.DELETE),
  adminManagementController.deactivateAdmin as any,
);

router.patch(
  "/:adminId/reset-password",
  requireRole(["super_admin"]) as any,
  requirePermission(ADMIN_PERMISSIONS.ADMIN.UPDATE),
  adminManagementController.resetAdminPassword as any,
);

export default router;
