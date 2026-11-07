import { WalletRepository } from "@/repositories/client/WalletRepository";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { Types } from "mongoose";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { PaymentProvider } from "@/types/payment";
import ServiceContainer from "../../client/container";

export class WithdrawalManagementService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
    private notificationService: NotificationService,
  ) {}

  async listWithdrawals(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    if (filters.minAmount || filters.maxAmount) {
      query.amount = {};
      if (filters.minAmount) query.amount.$gte = parseFloat(filters.minAmount);
      if (filters.maxAmount) query.amount.$lte = parseFloat(filters.maxAmount);
    }

    const result = await this.transactionRepository.findWithPagination(
      query,
      page,
      limit,
    );

    return {
      withdrawals: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getWithdrawalDetails(withdrawalId: string) {
    const withdrawal = await this.transactionRepository.findById(withdrawalId);

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    return withdrawal;
  }
}
