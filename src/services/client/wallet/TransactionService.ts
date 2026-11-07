import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  WALLET_OPERATION_TYPES,
  BILL_PAYMENT_TYPES,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import { normalizeProviderName } from "@/utils/helpers";
import ServiceContainer from "../container";
import { getProviderConfig } from "@/config";
import logger from "@/logger";

export interface TransactionFilters {
  type?: string;
  status?: string;
  provider?: string;
  direction?: string;
  purpose?: string;
  reference?: string;
  startDate?: string;
  endDate?: string;
  startPrice?: number;
  endPrice?: number;
  transactionType?: "wallet" | "bills";
}

export class TransactionService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
  ) {}

  async getUserTransactions(
    userId: string,
    filters: TransactionFilters = {},
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const query: any = {
      walletId: wallet._id,
      isHiddenFromUser: { $ne: true },
    };

    const EXCLUDED_TYPES = [
      TRANSACTION_TYPES.REFUND,
      TRANSACTION_TYPES.CASHBACK_EARNED,
      TRANSACTION_TYPES.CASHBACK_SPENT,
    ];
    // Always exclude refund/cashback — no branch below is allowed to override this
    const typeConditions: any[] = [{ type: { $nin: EXCLUDED_TYPES } }];

    if (filters.type) {
      typeConditions.push({ type: filters.type });
    }

    if (filters.transactionType === "wallet") {
      typeConditions.push({ type: { $in: WALLET_OPERATION_TYPES } });
    } else if (filters.transactionType === "bills") {
      typeConditions.push({ type: { $in: BILL_PAYMENT_TYPES } });
    }

    if (typeConditions.length > 1) {
      query.$and = typeConditions;
    } else {
      query.type = { $nin: EXCLUDED_TYPES };
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

    if (filters.direction) {
      query.direction = filters.direction;
    }

    if (filters.purpose) {
      query.purpose = filters.purpose;
    }

    if (filters.reference) {
      query.reference = { $regex: filters.reference, $options: "i" };
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        // Set to end of day
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    if (filters.startPrice !== undefined || filters.endPrice !== undefined) {
      query.amount = {};
      if (filters.startPrice !== undefined) {
        query.amount.$gte = filters.startPrice;
      }
      if (filters.endPrice !== undefined) {
        query.amount.$lte = filters.endPrice;
      }
    }

    const result = await this.transactionRepository.findWithFilters(
      query,
      page,
      limit,
    );

    const linked = await this.transactionRepository.findLinkedTransactions(
      result.data.map((t: any) => t._id),
    );
    const linkedMap = new Map(
      linked.map((l: any) => [l.linkedTransactionId.toString(), l]),
    );
    return TransactionMapper.toPaginatedDTO(
      result.data,
      result.total,
      page,
      limit,
      linkedMap,
    );
  }

  async getTransaction(reference: string, userId: string): Promise<any> {
    let transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet || transaction.walletId?.toString() !== wallet.id.toString()) {
      throw new AppError(
        "Unauthorized access to transaction",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // JIT (Just-In-Time) Auto-Requery for pending / processing transactions on user view/refresh
    if (
      (transaction.status === "pending" || transaction.status === "processing") &&
      Date.now() - new Date(transaction.createdAt).getTime() >= 8000
    ) {
      try {
        const providerCode = (
          transaction.provider ||
          transaction.polling?.pollingProvider ||
          transaction.meta?.providerResponse?.providerCode ||
          transaction.meta?.providerCode ||
          transaction.meta?.provider ||
          ""
        ).toLowerCase();

        const providerConfig = providerCode ? getProviderConfig(providerCode) : null;

        if (providerConfig && providerConfig.hasStatusCheckEndpoint) {
          const lastPolledAt = transaction.polling?.lastPolledAt
            ? new Date(transaction.polling.lastPolledAt).getTime()
            : 0;

          // Only live-requery if at least 15s elapsed since last poll attempt
          if (Date.now() - lastPolledAt >= 15000) {
            const pollingService = ServiceContainer.getTransactionPollingService();
            await pollingService.requeryTransaction(transaction._id.toString(), {
              silentCooldown: true,
              cooldownMs: 15000,
            });

            // Reload fresh transaction state from database
            const freshTx = await this.transactionRepository.findByReference(reference);
            if (freshTx) {
              transaction = freshTx;
            }
          }
        }
      } catch (err) {
        logger.debug("JIT requery on getTransaction skipped or inconclusive", err);
      }
    }

    return TransactionMapper.toDTO(transaction);
  }

  async exportTransactions(
    userId: string,
    filters: TransactionFilters = {},
  ): Promise<string> {
    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const query: any = { walletId: wallet._id };

    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);
    if (filters.direction) query.direction = filters.direction;
    if (filters.purpose) query.purpose = filters.purpose;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const result = await this.transactionRepository.findWithFilters(
      query,
      1,
      10000,
    );

    const sanitizedData = TransactionMapper.toDTOList(result.data);

    const headers = [
      "Reference",
      "Type",
      "Direction",
      "Description",
      "Amount",
      "Status",
      "Balance Before",
      "Balance After",
      "Date",
    ];

    const rows = sanitizedData.map((t: any) => [
      t.reference,
      t.type || "",
      t.direction || "",
      t.description || "",
      t.amount,
      t.status,
      t.balanceBefore || "",
      t.balanceAfter || "",
      new Date(t.createdAt).toISOString(),
    ]);

    const escapeCsvValue = (value: any): string => {
      const strValue = String(value);
      if (
        strValue.includes(",") ||
        strValue.includes('"') ||
        strValue.includes("\n")
      ) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    };

    const csv = [
      headers.join(","),
      ...rows.map((row: any[]) => row.map(escapeCsvValue).join(",")),
    ].join("\n");

    return csv;
  }

  async generateReceipt(reference: string, userId: string): Promise<any> {
    const transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet || transaction.walletId?.toString() !== wallet.id.toString()) {
      throw new AppError(
        "Unauthorized access to transaction",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Only generate receipts for successful transactions
    if (transaction.status !== "success") {
      throw new AppError(
        "Receipt can only be generated for successful transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const sanitized = TransactionMapper.toDTO(transaction);

    return {
      receiptNumber: `RCP-${sanitized.reference}`,
      reference: sanitized.reference,
      amount: sanitized.amount,
      direction: sanitized.direction,
      type: sanitized.type,
      status: sanitized.status,
      description: sanitized.description,
      balanceBefore: sanitized.balanceBefore,
      balanceAfter: sanitized.balanceAfter,
      metadata: sanitized.metadata,
      transactionDate: sanitized.createdAt,
      generatedAt: new Date(),
    };
  }

  // Monthly transaction volume
  async getMonthlyTradingVolume(
    userId: string,
    options: {
      month?: number;
      year?: number;
    } = {},
  ) {
    const targetMonth = options.month || new Date().getMonth() + 1;
    const targetYear = options.year || new Date().getFullYear();

    return {
      month: targetMonth,
      year: targetYear,
      summary: {
        totalVolume: 0,
        transactionCount: 0,
        previousMonthVolume: 0,
        percentageChange: 0,
        changeAmount: 0,
        trend: "stable",
      },
    };
  }

  // Yearly transaction volume
  async getYearlyTradingVolume(
    userId: string,
    options: {
      year?: number;
    } = {},
  ) {
    const targetYear = options.year || new Date().getFullYear();
    const monthlyData = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      totalVolume: 0,
      transactionCount: 0,
    }));

    return {
      year: targetYear,
      summary: {
        yearTotal: 0,
        yearTransactionCount: 0,
        averageMonthlyVolume: 0,
        highestMonth: { month: 1, volume: 0 },
        lowestMonth: { month: 1, volume: 0 },
      },
      monthlyData,
    };
  }
}
