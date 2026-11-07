import { Request, Response, NextFunction } from "express";
import { SystemBankAccountService } from "@/services/admin/finances/SystemBankAccountService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class SystemBankAccountController {
  private bankAccountService: SystemBankAccountService;

  constructor() {
    this.bankAccountService = AdminServiceContainer.getSystemBankAccountService();
  }

  listBankAccounts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await this.bankAccountService.listBankAccounts(
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Bank accounts retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  verifyBankAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { bankCode, accountNumber } = req.body;
      const bankAccount = await this.bankAccountService.verifyBankAccount(bankCode, accountNumber );
      return sendSuccessResponse(
        res,
        bankAccount,
        "Bank account verified successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createBankAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const bankAccount = await this.bankAccountService.createBankAccount(
        req.body
      );
      return sendSuccessResponse(
        res,
        bankAccount,
        "Bank account created successfully",
        HTTP_STATUS.CREATED
      );
    } catch (error) {
      next(error);
    }
  };

  updateBankAccountStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const bankAccount = await this.bankAccountService.updateBankAccountStatus(
        id,
        isActive
      );
      return sendSuccessResponse(
        res,
        bankAccount,
        "Bank account status updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  deleteBankAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      await this.bankAccountService.deleteBankAccount(id);
      return sendSuccessResponse(
        res,
        null,
        "Bank account deleted successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
