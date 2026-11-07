import { Router } from "express";
import { BankAccountController } from "@/controllers/client/BankAccountController";
import { BankAccountService } from "@/services/client/wallet/BankAccountService";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createBankAccountSchema,
  verifyBankAccountSchema,
} from "@/validations/client/bankaccountValidation";
import ServiceContainer from "@/services/client/container";

const router = Router();

// Initialize dependencies
const bankAccountRepository = new BankAccountRepository();
const bankAccountService = ServiceContainer.getBankAccountService();
const providerService = ServiceContainer.getProviderService();
const bankAccountController = new BankAccountController(bankAccountService, providerService);

// All routes require authentication
router.use(authenticate);

router.get("/", bankAccountController.getUserBankAccounts);
router.post(
  "/",
  validateRequest(createBankAccountSchema),
  bankAccountController.createBankAccount
);
router.post(
  "/verify",
  validateRequest(verifyBankAccountSchema),
  bankAccountController.verifyBankAccount
);
router.delete("/:id", bankAccountController.deleteBankAccount);
router.put("/:id/default", bankAccountController.setDefaultBankAccount);

export default router;
