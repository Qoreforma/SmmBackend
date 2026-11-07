import { Response, NextFunction } from "express";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ReferralBonusService } from "@/services/admin/finances/ReferralBonusService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class ReferralBonusController {
  private referralBonusService: ReferralBonusService;

  constructor() {
    this.referralBonusService = AdminServiceContainer.getReferralBonusService();
  }

  createBonus = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const result = await this.referralBonusService.createBonus(
        req.body,
        adminId
      );
      return sendSuccessResponse(
        res,
        result,
        "Referral bonus created successfully",
        HTTP_STATUS.CREATED
      );
    } catch (error) {
      next(error);
    }
  };

  updateBonus = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await this.referralBonusService.updateBonus(id, req.body);
      return sendSuccessResponse(
        res,
        result,
        "Referral bonus updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getAllBonus = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await this.referralBonusService.getAllBonus();
      return sendSuccessResponse(
        res,
        result,
        "Referral bonus retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
