import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { CashbackRuleController } from "@/controllers/admin/finances/CashbackRuleController";
import AdminServiceContainer from "@/services/admin/container";

const router = Router();
const controller = new CashbackRuleController(AdminServiceContainer.getCashbackRuleService());

router.use(adminAuth);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.CREATE),
  controller.create.bind(controller)
);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.VIEW),
  controller.getAll.bind(controller)
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.VIEW),
  controller.getById.bind(controller)
);

router.put(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.UPDATE),
  controller.bulkUpdate.bind(controller)
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.UPDATE),
  controller.update.bind(controller)
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CASHBACKS.DELETE),
  controller.delete.bind(controller)
);

export default router;
