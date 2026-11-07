import { Request, Response } from "express";
import { DashboardService } from "@/services/admin/system/DashboardService";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";
import { StatsPeriod } from "@/utils/dateRange";

export class AdminDashboardController {
  private dashboardService: DashboardService;

  constructor() {
    this.dashboardService = AdminServiceContainer.getDashboardService();
  }

  getDashboardStats = async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result = await this.dashboardService.getDashboardStats({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        period: period as StatsPeriod,
      });
      return sendSuccessResponse(res, result, "Dashboard stats retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getRevenueChart = async (req: Request, res: Response) => {
    try {
      const { days = 30 } = req.query;
      const result = await this.dashboardService.getRevenueChart(Number(days));
      return sendSuccessResponse(res, result, "Revenue chart retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getTransactionTypeDistribution = async (req: Request, res: Response) => {
    try {
      const result =
        await this.dashboardService.getTransactionTypeDistribution();
      return sendSuccessResponse(
        res,
        result,
        "Transaction distribution retrieved",
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getProfitChart = async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, period } = req.query;
      const result = await this.dashboardService.getProfitChartData({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        period: period as StatsPeriod,
      });
      return sendSuccessResponse(res, result, "Profit chart retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getComparison = async (req: Request, res: Response) => {
    try {
      const result = await this.dashboardService.getYesterdayVsTodayComparison();
      return sendSuccessResponse(res, result, "Yesterday vs Today comparison retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };
}

