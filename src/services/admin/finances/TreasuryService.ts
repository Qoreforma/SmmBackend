import mongoose from "mongoose";
import { TreasuryRepository } from "@/repositories/admin/TreasuryRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { TreasuryType, TreasuryCategory } from "@/models/system/TreasuryEntry";
import { AppError } from "@/middlewares/shared/errorHandler";

export class TreasuryService {
  constructor(
    private treasuryRepository: TreasuryRepository,
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
  ) {}

  /**
   * Adds a new entry to the treasury ledger (Expense or Capital Injection)
   */
  async addEntry(data: {
    type: TreasuryType;
    category: TreasuryCategory;
    provider?: string;
    amount: number;
    description: string;
    adminId: string;
  }) {
    if (data.amount <= 0) {
      throw new AppError("Amount must be greater than zero", 400);
    }

    const entry = await this.treasuryRepository.create({
      type: data.type,
      category: data.category,
      provider: data.provider,
      amount: data.amount,
      description: data.description,
      recordedBy: new mongoose.Types.ObjectId(data.adminId),
      date: new Date(),
    });

    return entry;
  }

  /**
   * Updates an existing treasury entry
   */
  async updateEntry(
    id: string,
    data: {
      type?: TreasuryType;
      category?: TreasuryCategory;
      provider?: string;
      amount?: number;
      description?: string;
    }
  ) {
    if (data.amount !== undefined && data.amount <= 0) {
      throw new AppError("Amount must be greater than zero", 400);
    }

    const entry = await this.treasuryRepository.findById(id);
    if (!entry) {
      throw new AppError("Treasury entry not found", 404);
    }

    const updated = await this.treasuryRepository.update(id, data);
    return updated;
  }

  /**
   * Deletes a treasury entry
   */
  async deleteEntry(id: string) {
    const entry = await this.treasuryRepository.findById(id);
    if (!entry) {
      throw new AppError("Treasury entry not found", 404);
    }

    await this.treasuryRepository.delete(id);
    return { success: true };
  }

  /**
   * Gets paginated ledger entries
   */
  async getLedger(filters: any = {}, page: number = 1, limit: number = 20) {
    const query: any = {};
    if (filters.type) query.type = filters.type;
    if (filters.category) query.category = filters.category;
    if (filters.startDate || filters.endDate) {
      query.date = {};
      if (filters.startDate) query.date.$gte = new Date(filters.startDate);
      if (filters.endDate) query.date.$lte = new Date(filters.endDate);
    }

    // Since BaseRepository doesn't have a default paginate, we'll use mongoose aggregate/find directly 
    // or assume we can just do a basic fetch with limit and skip if BaseRepository doesn't support it natively.
    // For simplicity, we'll just fetch them via raw model for pagination.
    const model = (this.treasuryRepository as any).model;
    
    const entries = await model
      .find(query)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("recordedBy", "firstName lastName email")
      .lean();

    const total = await model.countDocuments(query);

    return {
      entries,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Calculates overall platform financial worth and liquidity
   */
  async getPlatformFinances() {
    // 1. Get Total Liabilities (User Wallet Balances)
    const walletStats = await this.walletRepository.aggregate([
      { $match: { balance: { $gt: 0 } } },
      { $group: { _id: null, totalBalance: { $sum: "$balance" } } },
    ]);
    const totalLiabilities = walletStats.length > 0 ? walletStats[0].totalBalance : 0;

    // 2. Get Total Gross Transaction Profit (from successful transactions)
    const txStats = await this.transactionRepository.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, totalGrossProfit: { $sum: "$profit" } } },
    ]);
    const totalGrossProfit = txStats.length > 0 ? txStats[0].totalGrossProfit : 0;

    // 3. Get Treasury Totals
    const treasuryStats = await (this.treasuryRepository as any).model.aggregate([
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    let totalExpenses = 0;
    let totalCapitalInjected = 0;
    let totalSunkCapital = 0;

    treasuryStats.forEach((stat: any) => {
      if (stat._id === TreasuryType.EXPENSE) {
        totalExpenses = stat.totalAmount;
      } else if (stat._id === TreasuryType.CAPITAL_INJECTION) {
        totalCapitalInjected = stat.totalAmount;
      } else if (stat._id === TreasuryType.CAPITAL_EXPENSE) {
        totalSunkCapital = stat.totalAmount;
      }
    });

    // Calculations
    const trueNetProfit = totalGrossProfit - totalExpenses;
    
    // Project Worth = Total Capital Injected + Sunk Capital + True Net Profit
    const projectWorth = totalCapitalInjected + totalSunkCapital + trueNetProfit;

    // The cash you have available vs what you owe.
    // Expected Total Cash = Total Liabilities + Total Capital Injected + True Net Profit
    // Sunk capital is excluded because it's no longer liquid cash.
    // Liquidity = Expected Total Cash - Total Liabilities = (Total Capital Injected + True Net Profit)
    const platformLiquidity = totalCapitalInjected + trueNetProfit;

    return {
      totalLiabilities,
      totalGrossProfit,
      totalExpenses,
      totalCapitalInjected,
      totalSunkCapital,
      trueNetProfit,
      projectWorth,
      platformLiquidity,
    };
  }
}
