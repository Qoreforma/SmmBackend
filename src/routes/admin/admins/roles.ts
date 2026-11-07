import { Router } from "express";
import { RoleController } from "@/controllers/admin/RoleController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import { assignRoleSchema, createRoleSchema, updateRolePermissionsSchema, updateRoleSchema } from "@/validations/admin/roleValidation";

const router = Router();
const roleController = new RoleController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.VIEW,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  roleController.getAllRoles
);

router.get(
  "/:id",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.VIEW,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  roleController.getRoleById
);

router.post(
  "/",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.CREATE,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  validateRequest(createRoleSchema),
  roleController.createRole
);

// Update existing role
router.patch(
  "/:id",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.UPDATE,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  validateRequest(updateRoleSchema.body),
  roleController.updateRole
);

router.delete(
  "/:id",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.DELETE,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  roleController.deleteRole
);

// Get available permissions
router.get(
  "/permissions/available",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.CREATE,
    ADMIN_PERMISSIONS.ROLES.UPDATE,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  roleController.getAvailablePermissions
);

// Update role permissions //not in postman yet
router.patch(
  "/:id/permissions",
  requirePermission(ADMIN_PERMISSIONS.ROLES.MANAGE),
  validateRequest(updateRolePermissionsSchema.body),
  roleController.updateRolePermissions
);

// Assign role to admin user
router.post(
  "/assign",
  requirePermission(ADMIN_PERMISSIONS.ROLES.MANAGE),
  validateRequest(assignRoleSchema.body),
  roleController.assignRole
);

// Remove role from admin user
router.post(
  "/revoke",
  requirePermission(ADMIN_PERMISSIONS.ROLES.MANAGE),
  validateRequest(assignRoleSchema.body),
  roleController.revokeRole
);

// Get users with specific role
router.get(
  "/:id/users",
  requirePermission(
    ADMIN_PERMISSIONS.ROLES.VIEW,
    ADMIN_PERMISSIONS.ROLES.MANAGE
  ),
  roleController.getUsersByRole
);

export default router;
