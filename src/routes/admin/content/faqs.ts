import { Router } from "express";
import { FAQController } from "@/controllers/admin/content/FAQController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import {
  createFaqValidation,
  updateFaqValidation,
  createFaqCategoryValidation,
  updateFaqCategoryValidation,
} from "@/validations/admin/faqValidation";

const router = Router();
const faqController = new FAQController();

router.use(adminAuth);

// FAQ Category Routes
router.get(
  "/categories",
  requirePermission(ADMIN_PERMISSIONS.FAQS.VIEW_CATEGORIES),
  faqController.listCategories
);

router.post(
  "/categories",
  requirePermission(ADMIN_PERMISSIONS.FAQS.CREATE_CATEGORIES),
  validateRequest(createFaqCategoryValidation),
  auditLog("create", "faq_category"),
  faqController.createCategory
);


router.get(
  "/categories/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.VIEW_CATEGORIES),
  faqController.getCategoryDetails
);

router.post(
  "/categories/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.UPDATE_CATEGORIES),
  validateRequest(updateFaqCategoryValidation),
  auditLog("update", "faq_category"),
  faqController.updateCategory
);

router.delete(
  "/categories/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.DELETE_CATEGORIES),
  auditLog("delete", "faq_category"),
  faqController.deleteCategory
);

router.put(
  "/categories/:id/status",
  requirePermission(ADMIN_PERMISSIONS.FAQS.UPDATE_CATEGORIES),
  auditLog("update_status", "faq_category"),
  faqController.updateCategoryStatus
)
// FAQ Routes
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.FAQS.VIEW),
  faqController.listFAQs
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.FAQS.CREATE),
  validateRequest(createFaqValidation),
  auditLog("create", "faq"),
  faqController.createFAQ
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.VIEW),
  faqController.getFAQDetails
);

router.post(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.UPDATE),
  validateRequest(updateFaqValidation),
  auditLog("update", "faq"),
  faqController.updateFAQ
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FAQS.DELETE),
  auditLog("delete", "faq"),
  faqController.deleteFAQ
);

export default router;