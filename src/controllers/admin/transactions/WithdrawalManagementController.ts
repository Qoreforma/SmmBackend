import { Response } from "express";
import { WithdrawalManagementService } from "@/services/admin/transactions/WithdrawalManagementService";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";

export class WithdrawalManagementController {
  private withdrawalService: WithdrawalManagementService;

  constructor() {
    this.withdrawalService =
      AdminServiceContainer.getWithdrawalManagementService();
  }

  listWithdrawals = async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.withdrawalService.listWithdrawals(
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,

        "Withdrawals retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getWithdrawalDetails = async (
    req: AuthenticatedAdminRequest,
    res: Response
  ) => {
    try {
      const { id } = req.params;
      const result = await this.withdrawalService.getWithdrawalDetails(id);
      return sendSuccessResponse(res, result, "Withdrawal details retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

}
