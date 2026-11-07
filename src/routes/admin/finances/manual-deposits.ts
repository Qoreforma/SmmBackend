import { AdminDepositController } from "@/controllers/admin/finances/AdminDepositController";
import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { approveDepositSchema, declineDepositSchema } from "@/validations/admin/depositValidation";

const router = Router();
const controller = new AdminDepositController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_DEPOSITS),
  controller.getRequests,
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_DEPOSITS),
  controller.getRequestById,
);

router.post(
  "/:id/send-otp",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_DEPOSITS),
  controller.sendOTP,
);

router.post(
  "/:id/approve",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_DEPOSITS),
  validateRequest(approveDepositSchema),
  auditLog("approve_deposit", "deposit"),
  controller.approveRequest,
);

router.post(
  "/:id/reject",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_DEPOSITS),
  validateRequest(declineDepositSchema),
  auditLog("decline_deposit", "deposit"),
  controller.rejectRequest,
);

export default router;
