import { Router } from "express";
import { DiscountController } from "@/controllers/admin/finances/DiscountController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import {
  bulkUpdateDiscountValidation,
  createDiscountValidation,
  updateDiscountValidation,
} from "@/validations/admin/discountValidation";

const router = Router();
const discountController = new DiscountController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  discountController.listDiscounts
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.CREATE),
  validateRequest(createDiscountValidation),
  discountController.createDiscount
);


router.put(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(bulkUpdateDiscountValidation),
  discountController.bulkUpdateDiscounts
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  discountController.getDiscountDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(updateDiscountValidation),
  discountController.updateDiscount
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(updateDiscountValidation),
  discountController.updateDiscount
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.DELETE),
  discountController.deleteDiscount
);

export default router;
