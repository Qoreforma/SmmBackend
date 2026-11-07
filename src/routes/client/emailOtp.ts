import { Router } from "express";
import { EmailOtpController } from "@/controllers/client/EmailOtpController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import { buyEmailOtpSchema } from "@/validations/client/emailOtpValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const emailOtpController = new EmailOtpController();

// 1. Get supported services / sites
router.get("/products", authenticate, emailOtpController.getProducts);

// 2. Get domains for a site (e.g. ?site=telegram)
router.get("/domains", authenticate, emailOtpController.getDomains);

// 3. Search site support (e.g. ?q=telegram)
router.get("/search-site", authenticate, emailOtpController.searchSite);

// 4. Buy temporary email address
router.post(
  "/buy",
  authenticate,
  validateRequest(buyEmailOtpSchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.EMAIL_OTP),
  walletLock,
  detectChannel,
  emailOtpController.buyEmailOtp,
);

// 5. Check OTP status for email
router.get("/check/:reference", authenticate, emailOtpController.checkEmailOtp);

// 6. Cancel pending email activation (after 2 minutes per provider policy)
router.post("/cancel/:reference", authenticate, emailOtpController.cancelEmailOtp);
router.delete("/cancel/:reference", authenticate, emailOtpController.cancelEmailOtp);

export default router;
