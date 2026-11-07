import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { DepositService } from "@/services/client/wallet/DepositService";

export class DepositController {
  private depositService: DepositService;
  constructor() {
    this.depositService = ServiceContainer.getDepositService();
  }

  createDepositRequest = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const channel = req.body?.channel || (req as any).channel || (req.headers["x-channel"] as string) || "web";
      const data = { ...req.body, userId, channel };
      const depositRequest = await this.depositService.createDepositRequest(
        data
      );
      return sendSuccessResponse(
        res,
        depositRequest,
        "Deposit request submitted successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  handleDepositWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const data = req.body;
      const deposit = await this.depositService.handleDepositWebhook(data);
      return sendSuccessResponse(
        res,
        deposit,
        "Deposit processed successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getDeposits = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters = {
        status: req.query.status as string,
        provider: req.query.provider as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      const result = await this.depositService.getDeposits(
        userId,
        filters,
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Deposits retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getDepositById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { depositId } = req.params;
      const deposit = await this.depositService.getDepositById(depositId);
      return sendSuccessResponse(
        res,
        deposit,
        "Deposit retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
