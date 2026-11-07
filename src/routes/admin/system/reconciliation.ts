import { Router, Request, Response } from "express";
import {
  triggerReconciliationNow,
  getUnresolvedDiscrepancies,
} from "@/jobs/dailyproviderreconciliation";
import { SettlementDiscrepancy } from "@/models/system/SettlementDiscrepancy";
import { SettlementReconciliationRun } from "@/models/system/SettlementReconciliationRun";
import ServiceContainer from "@/services/client/container";
import logger from "@/logger";
import { normalizeProviderName } from "@/utils/helpers";
import { adminAuth } from "@/middlewares/admin/adminAuth";

const router = Router();
const providerReconciliationService =
  ServiceContainer.getProviderReconciliationService();

router.use(adminAuth);
// RECONCILIATION RUNS ENDPOINTS

// GET /admin/reconciliation/runs
// List all reconciliation runs with filters
router.get("/runs", async (req: Request, res: Response) => {
  try {
    const {
      provider,
      status,
      limit = 50,
      page = 1,
      startDate,
      endDate,
    } = req.query;

    const query: any = {};

    if (provider) query.provider = normalizeProviderName(provider as string);
    if (status) query.status = status;

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [runs, total] = await Promise.all([
      SettlementReconciliationRun.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      SettlementReconciliationRun.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: runs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    logger.error("Failed to fetch reconciliation runs", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /admin/reconciliation/runs/:id
// Get details of a specific reconciliation run
router.get("/runs/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const run = await SettlementReconciliationRun.findById(id).lean();
    if (!run) {
      return res
        .status(404)
        .json({ success: false, message: "Reconciliation run not found" });
    }

    // Also fetch related discrepancies
    const discrepancies = await SettlementDiscrepancy.find({
      reconciliationRunId: id,
    })
      .sort({ severity: -1, createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        run,
        discrepancies,
        discrepancyCount: discrepancies.length,
      },
    });
  } catch (error: any) {
    logger.error("Failed to fetch reconciliation run details", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /admin/reconciliation/runs/provider/:provider
// Get all reconciliation runs for a specific provider
router.get("/runs/provider/:provider", async (req: Request, res: Response) => {
  try {
    const { provider: rawProvider } = req.params;
    const { limit = 30, page = 1 } = req.query;

    // Validate provider
    const validProviders = ["saveHaven", "monnify", "flutterwave"];
    const provider = normalizeProviderName(rawProvider) as string;
    if (!validProviders.includes(provider)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid provider" });
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [runs, total] = await Promise.all([
      SettlementReconciliationRun.find({ provider })
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      SettlementReconciliationRun.countDocuments({ provider }),
    ]);

    // Calculate stats for provider
    const stats = {
      totalRuns: total,
      completedCount: runs.filter((r) => r.status === "completed").length,
      failedCount: runs.filter((r) => r.status === "failed").length,
      partialCount: runs.filter((r) => r.status === "partial").length,
      totalDiscrepancies: runs.reduce(
        (sum, r) => sum + r.discrepanciesCreated,
        0,
      ),
      avgDurationMs:
        runs.length > 0
          ? Math.round(
              runs.reduce((sum, r) => sum + (r.durationMs || 0), 0) /
                runs.length,
            )
          : 0,
    };

    res.json({
      success: true,
      provider,
      stats,
      data: runs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    logger.error("Failed to fetch provider reconciliation history", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /admin/reconciliation/runs/summary/dashboard
// Dashboard summary of recent runs across all providers
router.get("/runs/summary/dashboard", async (req: Request, res: Response) => {
  try {
    // Get last 30 days of runs
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const runs = await SettlementReconciliationRun.find({
      date: { $gte: thirtyDaysAgo },
    })
      .sort({ date: -1 })
      .lean();

    // Aggregate by provider
    const byProvider = {
      saveHaven: runs.filter((r) => r.provider === "saveHaven"),
      monnify: runs.filter((r) => r.provider === "monnify"),
      flutterwave: runs.filter((r) => r.provider === "flutterwave"),
    };

    const summary = {
      period: "Last 30 days",
      totalRuns: runs.length,
      providers: {
        saveHaven: {
          runs: byProvider.saveHaven.length,
          successRate:
            byProvider.saveHaven.length > 0
              ? (
                  (byProvider.saveHaven.filter((r) => r.status === "completed")
                    .length /
                    byProvider.saveHaven.length) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          totalDiscrepancies: byProvider.saveHaven.reduce(
            (sum, r) => sum + r.discrepanciesCreated,
            0,
          ),
          lastRunStatus:
            byProvider.saveHaven.length > 0
              ? byProvider.saveHaven[0].status
              : "N/A",
        },
        monnify: {
          runs: byProvider.monnify.length,
          successRate:
            byProvider.monnify.length > 0
              ? (
                  (byProvider.monnify.filter((r) => r.status === "completed")
                    .length /
                    byProvider.monnify.length) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          totalDiscrepancies: byProvider.monnify.reduce(
            (sum, r) => sum + r.discrepanciesCreated,
            0,
          ),
          lastRunStatus:
            byProvider.monnify.length > 0
              ? byProvider.monnify[0].status
              : "N/A",
        },
        flutterwave: {
          runs: byProvider.flutterwave.length,
          successRate:
            byProvider.flutterwave.length > 0
              ? (
                  (byProvider.flutterwave.filter(
                    (r) => r.status === "completed",
                  ).length /
                    byProvider.flutterwave.length) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          totalDiscrepancies: byProvider.flutterwave.reduce(
            (sum, r) => sum + r.discrepanciesCreated,
            0,
          ),
          lastRunStatus:
            byProvider.flutterwave.length > 0
              ? byProvider.flutterwave[0].status
              : "N/A",
        },
      },
    };

    res.json({ success: true, data: summary });
  } catch (error: any) {
    logger.error("Failed to fetch dashboard summary", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DISCREPANCIES ENDPOINTS

// GET /admin/reconciliation/discrepancies
// View unresolved discrepancies with filters
router.get("/discrepancies", async (req: Request, res: Response) => {
  try {
    const {
      provider,
      type,
      severity,
      status = "detected",
      limit = 20,
      page = 1,
    } = req.query;

    const query: any = {
      status: { $in: ["detected", "investigating"] },
    };

    if (status) query.status = status;
    if (provider) query.provider = normalizeProviderName(provider as string);
    if (type) query.type = type;
    if (severity) query.severity = severity;

    const skip = (Number(page) - 1) * Number(limit);

    const [discrepancies, total] = await Promise.all([
      SettlementDiscrepancy.find(query)
        .sort({ severity: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("reconciliationRunId", "provider date status"),
      SettlementDiscrepancy.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: discrepancies,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    logger.error("Failed to fetch discrepancies", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /admin/reconciliation/discrepancies/summary
// Quick summary counts by provider and type
router.get("/discrepancies/summary", async (req: Request, res: Response) => {
  try {
    const summary = await SettlementDiscrepancy.aggregate([
      {
        $match: { status: { $in: ["detected", "investigating"] } },
      },
      {
        $group: {
          _id: {
            provider: "$provider",
            type: "$type",
            severity: "$severity",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ["$ourAmount", "$providerAmount"] } },
        },
      },
      {
        $sort: { "_id.provider": 1, "_id.severity": -1 },
      },
    ]);

    res.json({ success: true, data: summary });
  } catch (error: any) {
    logger.error("Failed to fetch discrepancy summary", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /admin/reconciliation/discrepancies/:id/resolve
// Mark a discrepancy as resolved
router.post(
  "/discrepancies/:id/resolve",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { resolution, rootCause } = req.body;

      if (!resolution) {
        return res.status(400).json({
          success: false,
          message: "resolution is required",
        });
      }

      await providerReconciliationService.markDiscrepancyResolved(
        id,
        resolution,
        rootCause,
      );

      res.json({ success: true, message: "Discrepancy marked as resolved" });
    } catch (error: any) {
      logger.error("Failed to resolve discrepancy", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

// POST /admin/reconciliation/discrepancies/:id/investigate
// Mark as under investigation
router.post(
  "/discrepancies/:id/investigate",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      await SettlementDiscrepancy.findByIdAndUpdate(id, {
        status: "investigating",
        investigationStartedAt: new Date(),
        investigationNotes: notes,
      });

      res.json({
        success: true,
        message: "Discrepancy marked as investigating",
      });
    } catch (error: any) {
      logger.error("Failed to update discrepancy", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

// POST /admin/reconciliation/discrepancies/:id/ignore
// Ignore a false positive
router.post(
  "/discrepancies/:id/ignore",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      await SettlementDiscrepancy.findByIdAndUpdate(id, {
        status: "ignored",
        resolution: reason || "Marked as false positive",
        resolvedAt: new Date(),
      });

      res.json({ success: true, message: "Discrepancy ignored" });
    } catch (error: any) {
      logger.error("Failed to ignore discrepancy", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

// TRIGGER ENDPOINTS

// POST /admin/reconciliation/trigger
// Manually trigger reconciliation — useful for testing
router.post("/trigger", async (req: Request, res: Response) => {
  try {
    const result = await triggerReconciliationNow();
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Manual reconciliation trigger failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /admin/reconciliation/trigger/:date
// Reconcile a specific date — useful for backfilling missed days
router.post("/trigger/:date", async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    const result =
      await providerReconciliationService.reconcileAllProviders(date);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Manual reconciliation trigger failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
