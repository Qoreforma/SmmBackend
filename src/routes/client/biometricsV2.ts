import { Router } from "express";
import { BiometricV2Controller } from "@/controllers/client/BiometricV2Controller";
import { authenticate } from "@/middlewares/client/auth";
import {
  validateRequest,
  validateParams,
} from "@/middlewares/shared/validation";
import {
  initiateSetupSchema,
  completeSetupSchema,
  initiateLoginSchema,
  verifyLoginSchema,
  initiateTxnSchema,
  verifyTxnSchema,
  revokeDeviceParamsSchema,
  togglePurposeParamsSchema,
  togglePurposeBodySchema,
} from "@/validations/client/biometricV2Validation";
import { loginRateLimiter } from "@/middlewares/shared/rateLimiter";

const router = Router();
const controller = new BiometricV2Controller();

// ─── SETUP FLOW (AUTHENTICATED) ─────────────────────────────────────────────

router.post(
  "/setup/initiate",
  authenticate,
  validateRequest(initiateSetupSchema),
  controller.initiateSetup,
);

router.post(
  "/setup/complete",
  authenticate,
  validateRequest(completeSetupSchema),
  controller.completeSetup,
);

// ─── LOGIN FLOW (PUBLIC) ───────────────────────────────────────────────────

router.post(
  "/login/initiate",
  loginRateLimiter(),
  validateRequest(initiateLoginSchema),
  controller.initiateLogin,
);

router.post(
  "/login/verify",
  loginRateLimiter(),
  validateRequest(verifyLoginSchema),
  controller.verifyLogin,
);

// ─── TRANSACTION BIOMETRIC FLOW (AUTHENTICATED) ────────────────────────────

router.post(
  "/transaction/initiate",
  authenticate,
  validateRequest(initiateTxnSchema),
  controller.initiateTransaction,
);

router.post(
  "/transaction/verify",
  authenticate,
  validateRequest(verifyTxnSchema),
  controller.verifyTransaction,
);

// ─── DEVICE MANAGEMENT FLOW (AUTHENTICATED) ────────────────────────────────

router.get("/devices", authenticate, controller.listDevices);

router.post(
  "/devices/:deviceId/revoke",
  authenticate,
  validateParams(revokeDeviceParamsSchema),
  controller.revokeDevice,
);

router.delete(
  "/devices/:deviceId",
  authenticate,
  validateParams(revokeDeviceParamsSchema),
  controller.revokeDevice,
);

router.post("/devices/revoke-all", authenticate, controller.revokeAllDevices);

// ─── PURPOSE TOGGLE (AUTHENTICATED) ─────────────────────────────────────────

router.patch(
  "/devices/:deviceId/toggle",
  authenticate,
  validateParams(togglePurposeParamsSchema),
  validateRequest(togglePurposeBodySchema),
  controller.togglePurpose,
);

export default router;
