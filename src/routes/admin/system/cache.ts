import { Router } from "express";
import { CacheController } from "@/controllers/admin/system/CacheController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";

const router = Router();
const cacheController = new CacheController();

router.use(adminAuth);
router.use(requirePermission("all")); // Needs full permission or specific system config permission

router.get("/stats", cacheController.getCacheStats);

router.post(
  "/flush",
  auditLog("flush_cache", "system"),
  cacheController.flushCache
);

export default router;
