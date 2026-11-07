import { AuthRequest } from "@/middlewares/client/auth";
import { ReferralService } from "@/services/client/ReferralService";
import { ReferralBonusService } from "@/services/admin/finances/ReferralBonusService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { NextFunction, Response, Request } from "express";
import ServiceContainer from "@/services/client/container";
import AdminServiceContainer from "@/services/admin/container";

export class ReferralController {
  private referralService: ReferralService;
  private referralBonusService: ReferralBonusService;

  constructor() {
    this.referralService = ServiceContainer.getReferralService();
    this.referralBonusService = AdminServiceContainer.getReferralBonusService();
  }

  getReferralStats = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const stats = await this.referralBonusService.getReferralStats(userId);
      return sendSuccessResponse(
        res,
        stats,
        "Referral stats retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getReferredUsers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await this.referralService.getReferredUsers(
        userId,
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Referred users retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getReferralUpline = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const upline = await this.referralService.getReferralUpline(userId);
      return sendSuccessResponse(
        res,
        upline,
        "Referral upline retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getReferralEarnings = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await this.referralService.getReferralEarnings(
        userId,
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Referral earnings retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getReferralTerms = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const terms = await this.referralService.getReferralTerms();
      return sendSuccessResponse(
        res,
        terms,
        "Referral terms retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
