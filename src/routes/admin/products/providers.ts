import { Router } from "express";
import { ProviderController } from "@/controllers/admin/products/ProviderController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createProviderValidation,
  updateProviderValidation,
  syncProductsValidation,
  toggleProductsValidation,
} from "@/validations/admin/providerValidation";

const router = Router();
const providerController = new ProviderController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.listProviders
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  validateRequest(createProviderValidation),
  auditLog("create", "provider"),
  providerController.createProvider
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.getProviderDetails
);

router.post(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  validateRequest(updateProviderValidation),
  auditLog("update", "provider"),
  providerController.updateProvider
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  validateRequest(updateProviderValidation),
  auditLog("update", "provider"),
  providerController.updateProvider
);

router.patch(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  validateRequest(updateProviderValidation),
  auditLog("update", "provider"),
  providerController.updateProvider
);

router.put(
  "/:id/status",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  auditLog("update_status", "provider"),
  providerController.updateProviderStatus
);

// Get provider products (all products)
router.get(
  "/:id/products",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.getProviderProducts
);

// ServiceTypeProvider relationship management
router.get(
  "/:id/service-types",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.getProviderServiceTypes
);

router.put(
  "/:providerId/service-types/:serviceTypeId/toggle",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  auditLog("toggle_service_type", "provider"),
  providerController.toggleProviderServiceType
);


// Sync provider products
router.post(
  "/:id/sync",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.SYNC_PROVIDERS),
  validateRequest(syncProductsValidation),
  auditLog("sync_products", "provider"),
  providerController.syncProviderProducts
);

// Delete all provider products
router.delete(
  "/:id/products",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.SYNC_PROVIDERS),
  auditLog("delete_products", "provider"),
  providerController.deleteProviderProducts
);

// Get product aggregations (Service + Product Type combinations)
router.get(
  "/:id/product-aggregations",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.getProviderProductAggregations
);

// Get products by service and product type
router.get(
  "/:id/products/:serviceId/:productType",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  providerController.getProductsByServiceAndType
);

// Toggle products by service and product type
router.put(
  "/:id/products/:serviceId/:productType/toggle",
  requirePermission(ADMIN_PERMISSIONS.SYSTEM.MANAGE_PROVIDERS),
  validateRequest(toggleProductsValidation),
  auditLog("toggle_products_by_type", "provider"),
  providerController.toggleProductsByServiceAndType
);

export default router;