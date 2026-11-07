import { Request, Response } from "express";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";
import logger from "@/logger";

export class TreasuryController {
  public static async addEntry(req: Request, res: Response) {
    try {
      const { type, category, provider, amount, description } = req.body;
      const adminId = (req as any).admin.id; // Using `req.admin` which is populated by auth middleware

      if (!type || !category || !amount || !description) {
        return sendErrorResponse(res, "Missing required fields", 400);
      }

      const treasuryService = AdminServiceContainer.getTreasuryService();
      const entry = await treasuryService.addEntry({
        type,
        category,
        provider,
        amount,
        description,
        adminId,
      });

      return sendSuccessResponse(res, entry, "Treasury entry added successfully", 201);
    } catch (error: any) {
      logger.error("Error adding treasury entry:", error);
      return sendErrorResponse(res, error.message || "Failed to add treasury entry", error.statusCode || 500);
    }
  }

  public static async updateEntry(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { type, category, provider, amount, description } = req.body;

      const treasuryService = AdminServiceContainer.getTreasuryService();
      const updated = await treasuryService.updateEntry(id, {
        type,
        category,
        provider,
        amount,
        description,
      });

      return sendSuccessResponse(res, updated, "Treasury entry updated successfully", 200);
    } catch (error: any) {
      logger.error("Error updating treasury entry:", error);
      return sendErrorResponse(res, error.message || "Failed to update treasury entry", error.statusCode || 500);
    }
  }

  public static async deleteEntry(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const treasuryService = AdminServiceContainer.getTreasuryService();
      await treasuryService.deleteEntry(id);

      return sendSuccessResponse(res, null, "Treasury entry deleted successfully", 200);
    } catch (error: any) {
      logger.error("Error deleting treasury entry:", error);
      return sendErrorResponse(res, error.message || "Failed to delete treasury entry", error.statusCode || 500);
    }
  }

  public static async getLedger(req: Request, res: Response) {
    try {
      const { type, category, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (type) filters.type = type;
      if (category) filters.category = category;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;

      const treasuryService = AdminServiceContainer.getTreasuryService();
      const ledger = await treasuryService.getLedger(filters, pageNum, limitNum);

      // Match the PaginatedResponse interface structure correctly
      // sendSuccessResponse signature: (res, data, message, statusCode)
      return res.status(200).json({
        success: true,
        message: "Ledger retrieved successfully",
        data: ledger.entries,
        pagination: ledger.pagination,
        timestamp: new Date().toISOString(),
        path: res.req.originalUrl,
      });
    } catch (error: any) {
      logger.error("Error retrieving ledger:", error);
      return sendErrorResponse(res, error.message || "Failed to retrieve ledger", 500);
    }
  }

  public static async getPlatformFinances(req: Request, res: Response) {
    try {
      const treasuryService = AdminServiceContainer.getTreasuryService();
      const finances = await treasuryService.getPlatformFinances();

      return sendSuccessResponse(res, finances, "Platform finances retrieved successfully", 200);
    } catch (error: any) {
      logger.error("Error retrieving platform finances:", error);
      return sendErrorResponse(res, error.message || "Failed to retrieve platform finances", 500);
    }
  }
}
