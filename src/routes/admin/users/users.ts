import { Router } from "express";
import { UserManagementController } from "@/controllers/admin/users/UserManagementController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { create } from "domain";
import {
  manageUserWalletSchema,
  updateUserTypeSchema,
  sendWalletActionOTPSchema,
  updateUserTierSchema,
} from "@/validations/admin/userValidation";

const router = Router();
const userController = new UserManagementController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.listUsers,
);

router.get(
  "/types/all",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getUserTypes,
);

router.get(
  "/stats",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getTotalUsersStats,
);

router.get(
  "/chart",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getUserChartData,
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getUserDetails,
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.USERS.SUSPEND_UNSUSPEND),
  auditLog("update_user_status", "user"),
  userController.updateUserStatus,
);

router.put(
  "/:id/restrict",
  requirePermission(ADMIN_PERMISSIONS.USERS.SUSPEND_UNSUSPEND),
  auditLog("update_user_status", "user"),
  userController.restrictUser,
);

router.put(
  "/:id/suspend",
  requirePermission(ADMIN_PERMISSIONS.USERS.SUSPEND_UNSUSPEND),
  auditLog("update_user_status", "user"),
  userController.suspendUser,
);

router.put(
  "/:id/mark-as-fraudulent",
  requirePermission(ADMIN_PERMISSIONS.USERS.SUSPEND_UNSUSPEND),
  auditLog("mark_as_fraudulent", "user"),
  userController.markAsFraudulent,
);

router.post(
  "/:id/wallet/send-otp",
  requirePermission(ADMIN_PERMISSIONS.USERS.MANAGE_WALLET),
  validateRequest(sendWalletActionOTPSchema),
  userController.sendWalletActionOTP,
);

router.post(
  "/:id/wallet/credit",
  requirePermission(ADMIN_PERMISSIONS.USERS.MANAGE_WALLET),
  validateRequest(manageUserWalletSchema),
  auditLog("credit_wallet", "user"),
  userController.manageUserWalletSchema,
);

router.post(
  "/:id/wallet/debit",
  requirePermission(ADMIN_PERMISSIONS.USERS.MANAGE_WALLET),
  validateRequest(manageUserWalletSchema),

  auditLog("debit_wallet", "user"),
  userController.manageUserWalletSchema,
);

router.post(
  "/:id/bvn",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW_BVN),
  userController.getUserBvn,
);

router.put(
  "/:id/user-type",
  requirePermission(ADMIN_PERMISSIONS.USERS.UPDATE),
  validateRequest(updateUserTypeSchema),
  auditLog("update_user_type", "user"),
  userController.updateUserType,
);

router.put(
  "/:id/preferred-provider",
  requirePermission(ADMIN_PERMISSIONS.USERS.UPDATE),
  auditLog("update_preferred_provider", "user"),
  userController.updatePreferredProvider,
);

router.put(
  "/:id/tier",
  requirePermission(ADMIN_PERMISSIONS.USERS.UPDATE),
  validateRequest(updateUserTierSchema),
  auditLog("update_user_tier", "user"),
  userController.updateUserTier,
);

router.get(
  "/:id/service-transactions",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getUserServiceTransactions,
);
router.get(
  "/:id/wallet-transactions",
  requirePermission(ADMIN_PERMISSIONS.USERS.VIEW),
  userController.getUserWalletTransactions,
);

export default router;
