import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import { PricingRuleController } from "@/controllers/admin/finances/PricingRuleController";
import { bulkUpsertPricingRuleValidation, pricingRuleRowValidation, setPricingRuleStatusValidation } from "@/validations/admin/pricingRuleValidation";

const router = Router();
const controller = new PricingRuleController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  controller.list,
);

router.put(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(bulkUpsertPricingRuleValidation),
  controller.bulkUpsert,
);

router.get(
  "/:providerId/:serviceId",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  controller.getOne,
);

router.put(
  "/:providerId/:serviceId",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(pricingRuleRowValidation),
  controller.updateOne,
);

router.patch(
  "/:providerId/:serviceId/status",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(setPricingRuleStatusValidation),
  controller.setStatus,
);

export default router;