import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { WalletService } from "@/services/client/wallet/WalletService";
import { PaymentService } from "@/services/client/PaymentService";
import { WithdrawalService } from "@/services/client/wallet/WithdrawalService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { DepositService } from "@/services/client/wallet/DepositService";

export class WalletController {
  private walletService: WalletService;
  private paymentService: PaymentService;
  private withdrawalService: WithdrawalService;
  private depositService: DepositService;
  constructor() {
    this.walletService = ServiceContainer.getWalletService();
    this.paymentService = ServiceContainer.getPaymentService();
    this.withdrawalService = ServiceContainer.getWithdrawalService();
    this.depositService = ServiceContainer.getDepositService();
  }

  getWallet = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const wallet = await this.walletService.getWallet(userId);
      return sendSuccessResponse(res, wallet, "Wallet retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getAllWallets = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const wallets = await this.walletService.getAllWallets(userId);
      return sendSuccessResponse(
        res,
        wallets,
        "Wallets retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getBonusBalance = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const wallet = await this.walletService.getWallet(userId);
      return sendSuccessResponse(
        res,
        { bonusBalance: wallet.bonusBalance },
        "Bonus balance retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getWalletTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const {
        type,
        status,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;
      const result = await this.walletService.getWalletTransactions(
        userId,
        { type, status, startDate, endDate },
        Number(page),
        Number(limit),
      );
      return sendSuccessResponse(
        res,
        result,
        "Wallet transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getBalanceHistory = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { type = "main", days = 30 } = req.query;
      const result = await this.walletService.getBalanceHistory(
        userId,
        Number(days),
      );
      return sendSuccessResponse(
        res,
        result,
        "Balance history retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.paymentService.getProviders();
      return sendSuccessResponse(
        res,
        result,
        "Providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  fundWallet = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { amount, method, provider } = req.body;
      const result = await this.paymentService.initializePayment({
        userId,
        amount: Number(amount),
        method,
        provider,
      });
      return sendSuccessResponse(
        res,
        result,
        "Payment initialized successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.body;
      const result = await this.paymentService.verifyPayment(reference);
      return sendSuccessResponse(res, result, "Payment verified successfully");
    } catch (error) {
      next(error);
    }
  };

  recordDeposit = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = req.body.channel || (req as any).channel || "web";
      const { amount, provider, proof } = req.body;

      const depositRequest = await this.depositService.createDepositRequest({
        userId,
        amount: Number(amount),
        provider,
        proof,
        channel
      });

      return sendSuccessResponse(
        res,
        depositRequest,
        "Deposit request created successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  transferFunds = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = req.body.channel || (req as any).channel || "web";
      const { beneficiary: recipient, remark } = req.body;
      const amount = Number(req.body.amount);

      const result = await this.walletService.transferFunds(
        userId,
        recipient,
        amount,
        remark,
        channel
      );
      return sendSuccessResponse(res, result, "Transfer successful");
    } catch (error) {
      next(error);
    }
  };

  verifyBeneficiary = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { identifier } = req.body;
      const result = await this.walletService.verifyBeneficiary(identifier);
      return sendSuccessResponse(
        res,
        result,
        "Beneficiary verified successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getBeneficiaries = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const search = req.query.search as string;
      const result = await this.walletService.getBeneficiaries(userId, search);
      return sendSuccessResponse(
        res,
        result,
        "Beneficiaries retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  searchBeneficiaries = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const search = req.params.search;
      const result = await this.walletService.searchBeneficiaries(
        userId,
        search,
      );
      return sendSuccessResponse(
        res,
        result,
        "Search results retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  withdrawFunds = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = req.body.channel || (req as any).channel || "web";
      const { amount, bankAccountId } = req.body;
      const provider = req.serviceProvider?.code;
      const result = await this.withdrawalService.withdrawFunds({
        userId,
        amount: Number(amount),
        bankAccountId,
        provider: provider || "saveHaven",
        channel
      });
      return sendSuccessResponse(
        res,
        result,
        "Withdrawal request created successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  bankTransfer = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { amount, bankCode, accountNumber, accountName } = req.body;
      const channel = req.body.channel || (req as any).channel || "web";
      const provider = req.serviceProvider?.code;
      const result = await this.withdrawalService.bankTransfer({
        userId,
        amount: Number(amount),
        accountNumber,
        accountName,
        bankCode,
        provider,
        channel
      });
      return sendSuccessResponse(
        res,
        result,
        "Bank transfer initiated successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
