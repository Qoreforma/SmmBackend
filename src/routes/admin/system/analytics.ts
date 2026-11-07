import { Router } from "express";
import { AnalyticsController } from "@/controllers/admin/system/AnalyticsController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";

const router = Router();

// GET /api/v1/admin/analytics/service-comparison
router.get(
  "/service-comparison",
  adminAuth,
  // Using VIEW_DASHBOARD permission since it's analytics
  requirePermission("SYSTEM_DASHBOARD.VIEW"),
  AnalyticsController.getServiceComparison,
);

export default router;
