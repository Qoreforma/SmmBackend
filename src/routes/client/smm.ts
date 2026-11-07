import { Router } from "express";
import { SmmController } from "@/controllers/client/SmmController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import { placeSmmOrderSchema } from "@/validations/client/smmValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const smmController = new SmmController();

// SMM Platform Providers (Airtime provider design)
router.get("/providers", authenticate, smmController.getProviders);
router.get("/platforms", authenticate, smmController.getProviders);

// SMM Product Types by Platform (Badges / Dropdown)
router.get("/types/:serviceCode", authenticate, smmController.getProductTypes);

// SMM Products by Platform and Product Type
router.get("/products/:serviceCode/:productType?", authenticate, smmController.getProducts);

// Full / Filterable Catalog
router.get("/catalog", authenticate, smmController.listCatalog);

router.post(
  "/order",
  authenticate,
  validateRequest(placeSmmOrderSchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.SMM),
  walletLock,
  detectChannel,
  smmController.placeOrder,
);

// Client Orders history & management
router.get("/orders", authenticate, smmController.getUserOrders);
router.post("/order/:reference/refill", authenticate, smmController.refillOrder);
router.post("/order/:reference/cancel", authenticate, smmController.cancelOrder);

export default router;
