import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import ServiceContainer from "@/services/client/container";
import { TransactionService } from "@/services/client/wallet/TransactionService";

export class TransactionController {
  private transactionService: TransactionService;

  constructor() {
    this.transactionService = ServiceContainer.getTransactionService();
  }

  getUserTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const filters = {
        type: req.query.type as string,
        status: req.query.status as string,
        provider: req.query.provider as string,
        transactionType: req.query.transactionType as "wallet" | "bills",
        direction: req.query.direction as string,
        purpose: req.query.purpose as string,
        reference: req.query.reference as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        startPrice: req.query.startPrice
          ? parseFloat(req.query.startPrice as string)
          : undefined,
        endPrice: req.query.endPrice
          ? parseFloat(req.query.endPrice as string)
          : undefined,
      };

      const result = await this.transactionService.getUserTransactions(
        userId,
        filters,
        page,
        limit,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;

      const transaction = await this.transactionService.getTransaction(
        reference,
        userId,
      );

      return sendSuccessResponse(
        res,
        transaction,
        "Transaction retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  exportTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const filters = {
        type: req.query.type as string,
        status: req.query.status as string,
        provider: req.query.provider as string,
        direction: req.query.direction as string,
        purpose: req.query.purpose as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      const csvData = await this.transactionService.exportTransactions(
        userId,
        filters,
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=transactions_${
          new Date().toISOString().split("T")[0]
        }.csv`,
      );

      return res.send(csvData);
    } catch (error) {
      next(error);
    }
  };

  generateReceipt = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;

      const receipt = await this.transactionService.generateReceipt(
        reference,
        userId,
      );

      return sendSuccessResponse(
        res,
        receipt,
        "Receipt generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getMonthlyTradingVolume = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { month, year } = req.query;
      let options: { month?: number; year?: number } = {};

      if (month) options.month = parseInt(month as string);
      if (year) options.year = parseInt(year as string);

      const result = await this.transactionService.getMonthlyTradingVolume(
        userId,
        options,
      );
      return sendSuccessResponse(
        res,
        result,
        "Monthly volume retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getYearlyTradingVolume = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { year } = req.query;
      let options: { year?: number } = {};

      if (year) options.year = parseInt(year as string);

      const result = await this.transactionService.getYearlyTradingVolume(
        userId,
        options,
      );
      return sendSuccessResponse(
        res,
        result,
        "Yearly volume retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
