import { Router } from "express";
import { TreasuryController } from "@/controllers/admin/finances/TreasuryController";
import { adminAuth, requireSuperAdmin } from "@/middlewares/admin/adminAuth";

const router = Router();

// Only Super Admins can access the Treasury module

// GET /api/v1/admin/treasury/ledger
router.get("/ledger", adminAuth, requireSuperAdmin, TreasuryController.getLedger);

// GET /api/v1/admin/treasury/finances
router.get("/finances", adminAuth, requireSuperAdmin, TreasuryController.getPlatformFinances);

// POST /api/v1/admin/treasury/entry
router.post("/entry", adminAuth, requireSuperAdmin, TreasuryController.addEntry);

// PUT /api/v1/admin/treasury/entry/:id
router.put("/entry/:id", adminAuth, requireSuperAdmin, TreasuryController.updateEntry);

// DELETE /api/v1/admin/treasury/entry/:id
router.delete("/entry/:id", adminAuth, requireSuperAdmin, TreasuryController.deleteEntry);

export default router;
