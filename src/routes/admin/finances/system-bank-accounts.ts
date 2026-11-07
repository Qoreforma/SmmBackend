import { Router } from "express";
import { SystemBankAccountController } from "@/controllers/admin/finances/SystemBankAccountController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import {
  createSystemBankAccountSchema,
  updateSystemBankAccountStatusSchema,
} from "@/validations/admin/systemBankAccountValidation";
import { validateRequest } from "@/middlewares/shared/validation";

const router = Router();
const systemBankAccountController = new SystemBankAccountController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS.VIEW),
  systemBankAccountController.listBankAccounts
);

router.post(
  "/verify",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS.CREATE),
  systemBankAccountController.verifyBankAccount
)

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS.CREATE),
  validateRequest(createSystemBankAccountSchema),
  systemBankAccountController.createBankAccount
);

router.patch(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS.UPDATE),
  validateRequest(updateSystemBankAccountStatusSchema),
  systemBankAccountController.updateBankAccountStatus
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS.DELETE),
  systemBankAccountController.deleteBankAccount
);

export default router;
