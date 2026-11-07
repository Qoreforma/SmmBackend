import { Router } from "express";
import { TransactionController } from "@/controllers/client/TransactionController";
import { authenticate } from "@/middlewares/client/auth";
import { validateQuery } from "@/middlewares/shared/validation";
import { paginationSchema } from "@/validations/client/transactionValidation";

const router = Router();

const transactionController = new TransactionController();

// All routes require authentication
router.use(authenticate);

// Transaction queries
router.get(
  "/",
  validateQuery(paginationSchema),
  transactionController.getUserTransactions
);
router.get(
  "/export",
  validateQuery(paginationSchema),
  transactionController.exportTransactions
);

router.get("/monthly-volume", transactionController.getMonthlyTradingVolume);
router.get("/yearly-volume", transactionController.getYearlyTradingVolume);

// Single transaction
router.get("/:reference", transactionController.getTransaction);
router.get("/:reference/receipt", transactionController.generateReceipt);


export default router;
