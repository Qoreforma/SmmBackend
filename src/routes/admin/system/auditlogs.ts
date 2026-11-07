import { Router } from "express";
import { AuditLogController } from "@/controllers/admin/system/AuditLogController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const auditLogController = new AuditLogController();

router.use(adminAuth);

router.get(
  "/",
  // requirePermission(ADMIN_PERMISSIONS.AUDIT.VIEW),
  auditLogController.listAuditLogs
);

router.get(
  "/:id",
  // requirePermission(ADMIN_PERMISSIONS.AUDIT.VIEW),
  auditLogController.getAuditLogDetails
);

router.get(
  "/export/all",
  // requirePermission(ADMIN_PERMISSIONS.AUDIT.EXPORT),
  auditLogController.exportAuditLogs
);

export default router;
