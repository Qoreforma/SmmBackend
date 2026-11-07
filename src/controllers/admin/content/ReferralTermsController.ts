import { Request, Response, NextFunction } from "express";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ReferralTermsService } from "@/services/admin/content/ReferralTermsService";
import AdminServiceContainer from "@/services/admin/container";

export class ReferralTermsController {
  private referralTermsService: ReferralTermsService;

  constructor() {
    this.referralTermsService =
      AdminServiceContainer.getReferralTermsService();
  }

  listReferralTerms = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await this.referralTermsService.listReferralTerms(
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Referral terms retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createReferralTerms = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const referralTerms = await this.referralTermsService.createReferralTerms(
        req.body
      );
      return sendSuccessResponse(
        res,
        referralTerms,
        "Referral terms created successfully",
        HTTP_STATUS.CREATED
      );
    } catch (error) {
      next(error);
    }
  };

  getReferralTermsDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const referralTerms =
        await this.referralTermsService.getReferralTermsDetails(id);
      return sendSuccessResponse(
        res,
        referralTerms,
        "Referral terms retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateReferralTerms = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const referralTerms = await this.referralTermsService.updateReferralTerms(
        id,
        req.body
      );
      return sendSuccessResponse(
        res,
        referralTerms,
        "Referral terms updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  deleteReferralTerms = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      await this.referralTermsService.deleteReferralTerms(id);
      return sendSuccessResponse(
        res,
        null,
        "Referral terms deleted successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
