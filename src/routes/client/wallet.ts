import { Router } from "express";
import { WalletController } from "@/controllers/client/WalletController";
import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { profileComplete } from "@/middlewares/client/profileComplete";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import {
  validateRequest,
  validateQuery,
} from "@/middlewares/shared/validation";
import {
  bankTransferSchema,
  fundWalletSchema,
  generateVirtualAccountSchema,
  identificationSchema,
  verifyOtpAndCreateAccountSchema,
  walletTypeSchema,
  transferSchema,
  withdrawalSchema,
  xixapayCreateAccountSchema,
} from "@/validations/client/walletValidation";
import { VirtualAccountController } from "@/controllers/client/VirtualAccountController";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { TRANSACTION_TYPES } from "@/utils/constants";
import {
  checkServiceTypeStatus,
  resolveServiceProvider,
} from "@/middlewares/shared/checkServiceAvailability";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const walletController = new WalletController();
const virtualAccountController = new VirtualAccountController();

// All routes require authentication
router.use(authenticate);

// Wallet balance routes
router.get("/", validateQuery(walletTypeSchema), walletController.getWallet);
router.get("/all", walletController.getAllWallets);
router.get("/bonus-balance", walletController.getBonusBalance);
router.get("/balance-history", walletController.getBalanceHistory);

// Wallet transactions
router.get("/transactions", walletController.getWalletTransactions);

// Wallet funding
router.post(
  "/fund",
  rateLimiter(10, 120000, 60000),
  validateRequest(fundWalletSchema),
  checkServiceTypeStatus(TRANSACTION_TYPES.DEPOSIT),
  walletLock,
  detectChannel,
  walletController.fundWallet,
);

router.get("/providers", walletController.getProviders);
router.post("/verify-transaction", walletController.verifyTransaction);
router.post(
  "/record-deposit",
  rateLimiter(5, 60000),
  walletController.recordDeposit,
);

// Wallet transfer
router.post(
  "/transfer",
  rateLimiter(5, 120000, 60000),
  profileComplete,
  validateRequest(transferSchema),
  checkServiceTypeStatus(TRANSACTION_TYPES.WITHDRAWAL),
  checkAndVerifyPin,
  walletLock,
  detectChannel,
  walletController.transferFunds,
);

router.post("/beneficiaries/verify", walletController.verifyBeneficiary);

// router.get("/beneficiaries", walletController.getBeneficiaries);

router.get("/beneficiaries/:search", walletController.searchBeneficiaries);

// Withdrawal & bank transfer
router.post(
  "/withdraw",
  rateLimiter(5, 120000, 60000),
  validateRequest(withdrawalSchema),
  checkAndVerifyPin,
  walletLock,
  detectChannel,
  profileComplete,
  resolveServiceProvider(TRANSACTION_TYPES.WITHDRAWAL),
  walletController.withdrawFunds,
);

router.post(
  "/bank-transfer",
  rateLimiter(5, 60000),
  validateRequest(bankTransferSchema),
  checkAndVerifyPin,
  walletLock,
  detectChannel,
  profileComplete,
  resolveServiceProvider(TRANSACTION_TYPES.WITHDRAWAL),
  walletController.bankTransfer,
);

// Virtual accounts
router.post(
  "/accounts/initiate",
  validateRequest(identificationSchema),
  profileComplete,
  resolveServiceProvider(TRANSACTION_TYPES.VIRTUAL_ACCOUNT),
  virtualAccountController.initiateVirtualAccountGeneration,
);

router.post(
  "/accounts/verify",
  validateRequest(verifyOtpAndCreateAccountSchema),
  virtualAccountController.verifyOTPAndCreateAccount,
);

router.get(
  "/account/validation-status/:identityId",
  virtualAccountController.getValidationStatus,
);

router.post(
  "/account/resend-otp-stored",
  virtualAccountController.resendOTPWithStoredValidation,
);

// XIXAPAY — permanent account, single-pass (no OTP step required)
router.post(
  "/accounts/xixapay/create",
  validateRequest(xixapayCreateAccountSchema),
  profileComplete,
  virtualAccountController.createXixapayAccount,
);

router.get("/accounts", virtualAccountController.getUserVirtualAccount);
// router.post(
//   "/accounts/generate",
//   validateRequest(generateVirtualAccountSchema),
//   // rateLimiter(2, 300000),
//   profileComplete,
//   virtualAccountController.generateVirtualAccount
// );

export default router;
