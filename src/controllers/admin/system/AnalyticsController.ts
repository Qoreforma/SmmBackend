import { Request, Response } from "express";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";
import logger from "@/logger";
import { StatsPeriod } from "@/utils/dateRange";

export class AnalyticsController {
  public static async getServiceComparison(req: Request, res: Response) {
    try {
      const { period, startDate, endDate } = req.query;

      const filters: any = {};
      if (period) filters.period = period as StatsPeriod;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const analyticsService = AdminServiceContainer.getAnalyticsService();
      const stats = await analyticsService.getServiceComparisonStats(filters);

      return sendSuccessResponse(res, stats, "Service comparison stats retrieved successfully", 200);
    } catch (error: any) {
      logger.error("Error getting service comparison stats:", error);
      return sendErrorResponse(res, error.message || "Failed to retrieve stats", 500);
    }
  }
}
