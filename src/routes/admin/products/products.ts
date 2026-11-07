import { Router } from "express";
import { ProductController } from "@/controllers/admin/products/ProductController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";

import {
  createProductValidation,
  updateProductHotStatusValidation,
  updateProductValidation,
} from "@/validations/admin/productValidation";

const router = Router();
const productController = new ProductController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.listProducts
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  validateRequest(createProductValidation),
  auditLog("create", "product"),
  productController.createProduct
);

router.get(
  "/attributes",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductAttributes
);

router.get(
  "/filter-options",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductAttributes
);

router.get(
  "/types/all",
  productController.getProductTypes
);

router.get(
  "/types/data",
  productController.getProductDataTypes
);

router.get(
  "/types/categories",
  productController.getProductCategories
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductDetails
);

router.post(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  validateRequest(updateProductValidation),
  auditLog("update", "product"),
  productController.updateProduct
);

router.put(
  "/bulk/status",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  auditLog("bulk_update_status", "product"),
  productController.bulkUpdateProductStatus
);

router.put(
  "/bulk/hot",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  auditLog("bulk_update_hot", "product"),
  productController.bulkUpdateProductHotStatus
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  auditLog("update_status", "product"),
  productController.updateProductStatus
);

router.put(
  "/:id/hot",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  validateRequest(updateProductHotStatusValidation),
  auditLog("update_hot_status", "product"),
  productController.updateProductHotStatus
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  auditLog("delete", "product"),
  productController.deleteProduct
);

// Get products by service type
router.get(
  "/service-type/:serviceTypeId",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductsByServiceType
);

// Get products by service
router.get(
  "/service/:serviceId",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductsByService
);

// Get products by provider
router.get(
  "/provider/:providerId",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.getProductsByProvider
);

// Fetch available products from provider API
router.post(
  "/provider/:providerId/fetch",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PRODUCTS),
  productController.fetchProviderProducts
);

export default router;
