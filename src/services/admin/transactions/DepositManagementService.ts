import { DepositRequestRepository } from "@/repositories/client/DepositRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { Types } from "mongoose";
import ServiceContainer from "../../client/container";
import { TRANSACTION_TYPES, CACHE_KEYS } from "@/utils/constants";
import { cacheService } from "@/services/core/CacheService";
import { HelperService } from "@/services/client/utility/HelperService";
import { Transaction } from "@/models/wallet/Transaction";
import logger from "@/logger";
import { normalizeProviderName, toDisplayProviderName } from "@/utils/helpers";
import SocketService from "@/services/core/SocketService";

export class DepositManagementService {
  constructor(
    private depositRequestRepository: DepositRequestRepository,
    private walletRepository: WalletRepository,
    private notificationService: NotificationService,
    private transactionRepository: TransactionRepository,
    private helperService: HelperService,
  ) {}

  async listDeposits(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.userId) {
      query.userId = filters.userId;
    }
    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

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

    const populate = [
      { path: "userId", select: "firstname lastname avatar email phone" },
    ];

    const result = await this.depositRequestRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      deposits: result.data.map((deposit: any) => {
        const plain = deposit.toObject ? deposit.toObject() : deposit;
        return { ...plain, provider: toDisplayProviderName(plain.provider) };
      }),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getDepositDetails(depositId: string) {
    const deposit = await this.depositRequestRepository.findById(depositId);

    if (!deposit) {
      throw new Error("Deposit request not found");
    }

    // Populate user details
    await deposit.populate("userId", "firstname lastname email phone");

    const plain = (deposit as any).toObject
      ? (deposit as any).toObject()
      : deposit;
    return { ...plain, provider: toDisplayProviderName(plain.provider) };
  }

  async approveDeposit(depositId: string, approvedBy: string) {
    const deposit = await this.depositRequestRepository.findById(depositId);

    if (!deposit) {
      throw new Error("Deposit request not found");
    }

    if (deposit.status !== "pending") {
      throw new Error("Can only approve pending deposit requests");
    }

    // Find the transaction that was created alongside this deposit request —
    // we update it in place rather than creating a second transaction.
    const linkedTransaction = await Transaction.findOne({
      transactableType: "DepositRequest",
      transactableId: deposit._id,
      type: "deposit",
    });

    if (!linkedTransaction) {
      throw new Error("Linked transaction not found for this deposit request");
    }

    // Find user's main wallet
    const wallet = await this.walletRepository.findOne({
      userId: deposit.userId,
      type: "main",
    });

    if (!wallet) {
      throw new Error("User wallet not found");
    }

    const chargeCalculation =
      await this.helperService.calculateAmountWithCharge(
        deposit.amount,
        TRANSACTION_TYPES.DEPOSIT,
      );

    const amountToCredit =
      chargeCalculation.baseAmount - chargeCalculation.chargeAmount;

    const previousBalance = wallet.balance;

    const updatedWallet = await this.walletRepository.incrementBalance(
      wallet.id,
      amountToCredit,
    );

    if (!updatedWallet) {
      throw new Error("Failed to update wallet balance");
    }

    await this.transactionRepository.update(linkedTransaction._id.toString(), {
      status: "success",
      approvalStatus: "approved",
      approvedBy: new Types.ObjectId(approvedBy),
      approvedAt: new Date(),
      balanceBefore: previousBalance,
      balanceAfter: updatedWallet.balance,
      remark: `Deposit request approved - ${deposit.reference}`,
      meta: {
        ...linkedTransaction.meta,
        chargeInfo: {
          baseAmount: chargeCalculation.baseAmount,
          serviceCharge: chargeCalculation.chargeAmount,
          chargeType: chargeCalculation.serviceCharge?.type,
          chargeValue: chargeCalculation.serviceCharge?.value,
          creditedAmount: amountToCredit,
          isServiceChargeCapped: chargeCalculation.isCapped,
        },
        approvedBy,
        approvedAt: new Date().toISOString(),
      },
    });

    // Update deposit request status
    deposit.status = "approved";
    deposit.approvedAt = new Date();
    deposit.approvedBy = approvedBy;
    await deposit.save();

    // Invalidate user wallet cache
    try {
      await cacheService.delete(CACHE_KEYS.USER_WALLET(deposit.userId.toString()));
    } catch (cacheErr) {
      logger.error("DepositManagement: failed to invalidate wallet cache:", cacheErr);
    }

    SocketService.emitToUser(deposit.userId.toString(), "wallet_credit", {
      balance: updatedWallet.balance,
      bonusBalance: updatedWallet.bonusBalance,
      commissionBalance: updatedWallet.commissionBalance,
      amount: amountToCredit,
      direction: "CREDIT",
      type: "deposit",
      reference: deposit.reference,
      reason: `Deposit request approved - ${deposit.reference}`,
      timestamp: new Date().toISOString(),
    });

    // Send notification
    await this.notificationService.createNotification({
      notifiableType: "User",
      notifiableId: deposit.userId,
      type: "deposit_request_approved",
      data: {
        amount: amountToCredit,
        reference: deposit.reference,
      },
      sendEmail: true,
      sendSMS: false,
      sendPush: true,
    });

    return {
      message: "Deposit request approved successfully",
      deposit: {
        id: deposit._id,
        amount: deposit.amount,
        creditedAmount: amountToCredit,
        serviceCharge: chargeCalculation.chargeAmount,
        status: deposit.status,
        reference: deposit.reference,
        approvedAt: deposit.approvedAt,
        approvedBy: deposit.approvedBy,
      },
      wallet: {
        balance: updatedWallet.balance,
        previousBalance,
      },
    };
  }

  async declineDeposit(depositId: string, reason: string, declinedBy: string) {
    // if (!reason || reason.trim().length === 0) {
    //   throw new Error("Decline reason is required");
    // }

    const deposit = await this.depositRequestRepository.findById(depositId);

    if (!deposit) {
      throw new Error("Deposit request not found");
    }

    if (deposit.status !== "pending") {
      throw new Error("Can only decline pending deposit requests");
    }

    // No wallet was ever touched for a pending deposit request, so declining
    // is just marking the linked transaction as failed — no refund needed.
    const linkedTransaction = await Transaction.findOne({
      transactableType: "DepositRequest",
      transactableId: deposit._id,
      type: "deposit",
    });

    if (linkedTransaction) {
      await this.transactionRepository.update(
        linkedTransaction._id.toString(),
        {
          status: "failed",
          approvalStatus: "declined",
          declinedBy: new Types.ObjectId(declinedBy),
          declinedAt: new Date(),
          declineReason: reason || "Declined by admin",
          remark: `Deposit request declined - ${reason}`,
          meta: {
            ...linkedTransaction.meta,
            declinedBy,
            declinedAt: new Date().toISOString(),
            declineReason: reason,
          },
        },
      );
    }

    // Update deposit request status
    deposit.status = "declined";
    deposit.declinedAt = new Date();
    deposit.declinedBy = declinedBy;
    deposit.declineReason = reason;
    await deposit.save();

    // Send notification
    await this.notificationService.createNotification({
      notifiableType: "User",
      notifiableId: deposit.userId,
      type: "deposit_request_rejected",
      data: {
        amount: deposit.amount,
        reference: deposit.reference,
        reason: reason,
      },
      sendEmail: true,
      sendSMS: false,
      sendPush: true,
    });

    return {
      message: "Deposit request declined successfully",
      deposit: {
        id: deposit._id,
        amount: deposit.amount,
        status: deposit.status,
        reference: deposit.reference,
        reason,
        declinedAt: deposit.declinedAt,
        declinedBy: deposit.declinedBy,
      },
    };
  }

  async getDepositStatistics(filters: any = {}) {
    const matchStage: any = {};

    if (filters.startDate && filters.endDate) {
      matchStage.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    if (filters.userId) {
      matchStage.userId = new Types.ObjectId(filters.userId);
    }

    const stats = await this.depositRequestRepository.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const summary = {
      pending: { count: 0, totalAmount: 0 },
      approved: { count: 0, totalAmount: 0 },
      declined: { count: 0, totalAmount: 0 },
      total: { count: 0, totalAmount: 0 },
    };

    stats.forEach((stat) => {
      if (stat._id in summary) {
        summary[stat._id as keyof typeof summary] = {
          count: stat.count,
          totalAmount: stat.totalAmount,
        };
      }
      summary.total.count += stat.count;
      summary.total.totalAmount += stat.totalAmount;
    });

    return summary;
  }

  async bulkApproveDeposits(depositIds: string[], approvedBy: string) {
    const results = {
      successful: [] as any[],
      failed: [] as any[],
    };

    for (const depositId of depositIds) {
      try {
        const result = await this.approveDeposit(depositId, approvedBy);
        results.successful.push({
          depositId,
          ...result,
        });
      } catch (error) {
        results.failed.push({
          depositId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      message: `Processed ${depositIds.length} deposits: ${results.successful.length} approved, ${results.failed.length} failed`,
      results,
    };
  }
}
