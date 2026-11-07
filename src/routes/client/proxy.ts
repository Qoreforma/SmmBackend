import { Router } from "express";
import { ProxyController } from "@/controllers/client/ProxyController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import { buyProxySchema } from "@/validations/client/proxyValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const proxyController = new ProxyController();

// Get proxy catalog
router.get("/catalog", authenticate, proxyController.getCatalog);

// Buy proxies
router.post(
  "/buy",
  authenticate,
  validateRequest(buyProxySchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.PROXY),
  walletLock,
  detectChannel,
  proxyController.buyProxy,
);

export default router;
