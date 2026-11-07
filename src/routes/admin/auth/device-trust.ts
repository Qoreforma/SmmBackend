import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { DeviceTrustController } from "@/controllers/admin/auth/DeviceTrustController";

const router = Router();
const controller = new DeviceTrustController();

import {
  validateRequest,
  validateParams,
} from "@/middlewares/shared/validation";
import {
  addBlocklistSchema,
  removeBlocklistSchema,
} from "@/validations/admin/deviceTrustValidation";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

router.use(adminAuth);

router.get(
  "/pending-requests",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.VIEW_DEVICE_REQUESTS),
  controller.getPendingRequests,
);
router.post(
  "/requests/:requestId/approve",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.APPROVE_DEVICE_REQUESTS),
  controller.approveRequest,
);
router.post(
  "/requests/:requestId/deny",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.APPROVE_DEVICE_REQUESTS),
  controller.denyRequest,
);

// Manual IP Blocklist Management
router.get(
  "/blocked-ips",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.MANAGE_IP_BLOCKLIST),
  controller.getBlockedIps,
);
router.post(
  "/blocked-ips",
  validateRequest(addBlocklistSchema),
  requirePermission(ADMIN_PERMISSIONS.SECURITY.MANAGE_IP_BLOCKLIST),
  controller.addBlockedIp,
);
router.delete(
  "/blocked-ips/:cidr",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.MANAGE_IP_BLOCKLIST),
  validateParams(removeBlocklistSchema),
  controller.removeBlockedIp,
);
router.get(
  "/all-trusted-devices",
  requirePermission(ADMIN_PERMISSIONS.SECURITY.VIEW_DEVICE_TRUST),
  controller.getAllTrustedDevicesAndIps,
);
export default router;
