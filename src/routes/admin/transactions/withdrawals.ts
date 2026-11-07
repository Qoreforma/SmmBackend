import { Router } from 'express';
import { WithdrawalManagementController } from '@/controllers/admin/transactions/WithdrawalManagementController';
import { adminAuth } from '@/middlewares/admin/adminAuth';
import { requirePermission } from '@/middlewares/admin/adminPermission';
import { auditLog } from '@/middlewares/admin/auditLogger';
import { ADMIN_PERMISSIONS } from '@/utils/admin-permissions';

const router = Router();
const withdrawalController = new WithdrawalManagementController();

// All routes require admin authentication
router.use(adminAuth);

router.get(
  '/',
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_WITHDRAWALS),
  withdrawalController.listWithdrawals
);

router.get(
  '/:id',
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_WITHDRAWALS),
  withdrawalController.getWithdrawalDetails
);


export default router;
