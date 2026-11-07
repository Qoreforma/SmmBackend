import { Router } from "express";
import { TransactionManagementController } from "@/controllers/admin/transactions/TransactionManagementController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { updateTransactionStatusSchema } from "@/validations/admin/transactionValidation";

const router = Router();
const transactionController = new TransactionManagementController();

// All routes require admin authentication
router.use(adminAuth);

// SERVICE TRANSACTIONS
router.get(
  "/services/overview",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getServiceTransactionsOverview
);

router.get(
  "/services",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listServiceTransactions
);

router.get(
  "/services/chart",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getTransactionChartData
);

router.get(
  "/services/:serviceType/chart",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getTransactionChartData
);

router.get(
  "/services/:serviceType",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getSpecificServiceTransactions
);

// WALLET TRANSACTIONS
router.get(
  "/wallet/overview",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getWalletTransactionsOverview
);

router.get(
  "/wallet",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listWalletTransactions
);

router.get(
  "/wallet/:walletType",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getSpecificWalletTransactions
);

// UTILITY ENDPOINTS
router.get(
  "/failed",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getFailedTransactions
);

router.get(
  "/pending",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getPendingTransactions
);

router.post(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("bulk_update_transactions", "transaction"),
  transactionController.bulkUpdateTransactions
);

router.get(
  "/export",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.EXPORT),
  auditLog("export_transactions", "transaction"),
  transactionController.exportTransactions
);

// GENERAL TRANSACTION ENDPOINTS
router.get(
  "/chart",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getTransactionChartData
);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listTransactions
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getTransactionDetails
);

router.post(
  "/:id/send-otp",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  transactionController.sendOTP
);

router.put(
  "/:id/status/:status",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  validateRequest(updateTransactionStatusSchema),
  auditLog("update_transaction_status", "transaction"),
  transactionController.updateTransactionStatus
);

router.post(
  "/:id/retry",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("retry_transaction", "transaction"),
  transactionController.retryFailedTransaction
);

router.post(
  "/:id/requery",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("requery_transaction", "transaction"),
  transactionController.retryFailedTransaction
);

router.post(
  "/:id/reverse",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.REVERSE),
  auditLog("reverse_transaction", "transaction"),
  transactionController.reverseTransaction
);

router.post(
  "/:id/smm/refill",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("smm_refill_order", "transaction"),
  transactionController.smmRefillOrder
);

router.get(
  "/:id/smm/refill/:refillId",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.smmGetRefillStatus
);

router.get(
  "/:id/smm/proofs",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.smmGetProofs
);

router.post(
  "/:id/smm/cancel",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("smm_cancel_order", "transaction"),
  transactionController.smmCancelOrder
);

export default router;