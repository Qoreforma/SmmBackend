import { Router } from "express";
import { AuthController } from "@/controllers/client/AuthController";

import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyOTPSchema,
  updatePinSchema,
  verifyPinSchema,
  refreshTokenSchema,
  phoneNumberVerificationSchema,
  setPinSchema,
  toggle2FASchema,
  verifyOTPAppSchema,
  changeAppPasswordSchema,
  changePinSchema,
  resetPinSchema,
  verifyPinOtpSchema,
  changeEmailSchema,
} from "@/validations/client/authValidation";
import { loginRateLimiter } from "@/middlewares/shared/rateLimiter";

const router = Router();

const authController = new AuthController();

// Public routes
router.post(
  "/register",
  validateRequest(registerSchema),
  authController.register,
);
router.post(
  "/login",
  loginRateLimiter(),
  validateRequest(loginSchema),
  authController.login,
);
router.post(
  "/refresh-token",
  validateRequest(refreshTokenSchema),
  authController.refreshToken,
);
router.post(
  "/forgot-password",
  validateRequest(forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  validateRequest(resetPasswordSchema),
  authController.resetPassword,
);

// reset password for app
router.post(
  "/verify-reset-otp",
  validateRequest(verifyOTPAppSchema),
  authController.verifyResetOTP,
);

router.post(
  "/change-app-password",
  validateRequest(changeAppPasswordSchema),
  authController.changeAppPassword,
);

router.post(
  "/change-email", validateRequest(changeEmailSchema), authController.changeEmail
)

// Protected routes
router.post("/logout", authenticate, authController.logout);
router.post(
  "/change-password",
  authenticate,
  validateRequest(changePasswordSchema),
  authController.changePassword,
);

// Email verification after login
router.post("/email/resend", authController.resendEmailVerification);
router.post(
  "/email/verify",
  validateRequest(verifyOTPSchema),
  authController.verifyEmail,
);

// Phone verification
router.post(
  "/phone/resend",
  authenticate,
  validateRequest(phoneNumberVerificationSchema),
  authController.sendPhoneVerification,
);
router.post(
  "/phone/verify",
  authenticate,
  validateRequest(verifyOTPSchema),
  authController.verifyPhone,
);

// PIN management
router.put(
  "/pin/set",
  authenticate,
  validateRequest(setPinSchema),
  authController.setPin,
);

router.put(
  "/pin/update",
  authenticate,
  validateRequest(updatePinSchema),
  authController.updatePin,
);

router.put(
  "/pin/change",
  authenticate,
  validateRequest(changePinSchema),
  authController.changePin,
);

router.post("/pin/resend", authenticate, authController.resendPinVerification);
//app
router.post(
  "/pin/verify-pin-otp",
  authenticate,
  validateRequest(verifyPinOtpSchema),
  authController.verifyPinOtp,
);
router.put(
  "/pin/app-reset",
  authenticate,
  validateRequest(setPinSchema),
  authController.appResetPin,
);
router.post(
  "/pin/reset",
  authenticate,
  validateRequest(resetPinSchema),
  authController.resetPin,
);

router.post(
  "/pin/verify",
  authenticate,
  validateRequest(verifyPinSchema),
  authController.verifyPin,
);

// 2FA management
router.post(
  "/2fa/toggle",
  authenticate,
  validateRequest(toggle2FASchema),
  authController.toggle2FA,
);
router.post(
  "/2fa/verify",
  validateRequest(verifyOTPSchema),
  authController.verify2FA,
);

router.post("/2fa/resend", authController.resend2FA);


router.post("/biometric/login/setup",   authenticate, authController.setupLoginBiometric);
router.post("/biometric/login/verify",  authenticate, authController.verifyLoginBiometric);
router.post("/biometric/login/disable", authenticate, authController.disableLoginBiometric);
router.get( "/biometric/login/status",  authenticate, authController.getLoginBiometricStatus);

// Transaction Biometric
router.post("/biometric/transaction/setup",   authenticate, authController.setupTransactionBiometric);
router.post("/biometric/transaction/verify",  authenticate, authController.verifyTransactionBiometric);
router.post("/biometric/transaction/disable", authenticate, authController.disableTransactionBiometric);
router.get( "/biometric/transaction/status",  authenticate, authController.getTransactionBiometricStatus);


// work for both pin and transaction
router.post("/biometric/setup", authenticate, authController.setupBiometric);

router.post("/biometric/verify", authenticate, authController.verifyBiometric);

router.get(
  "/biometric/status",
  authenticate,
  authController.getBiometricStatus,
);

router.post(
  "/biometric/disable",
  authenticate,
  authController.disableBiometric,
);

export default router;
