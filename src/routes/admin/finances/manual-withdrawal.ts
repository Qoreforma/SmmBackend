import { Router } from "express";
import { ManualWithdrawalController } from "@/controllers/admin/finances/Manualwithdrawalcontroller";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { processWithdrawalSchema, declineWithdrawalSchema } from "@/validations/admin/withdrawalValidation";

const router = Router();
const controller = new ManualWithdrawalController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_WITHDRAWALS),
  controller.getRequests
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_WITHDRAWALS),
  controller.getRequestById
);

router.post(
  "/:id/send-otp",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_WITHDRAWALS),
  controller.sendOTP
);

router.post(
  "/:id/approve",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_WITHDRAWALS),
  validateRequest(processWithdrawalSchema),
  auditLog("approve_manual_withdrawal", "withdrawal"),
  controller.approveRequest
);

router.post(
  "/:id/reject",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_WITHDRAWALS),
  validateRequest(declineWithdrawalSchema),
  auditLog("decline_manual_withdrawal", "withdrawal"),
  controller.rejectRequest
);

export default router;