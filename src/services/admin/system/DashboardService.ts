import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { TRANSACTION_CATEGORIES } from "@/utils/constants";
import { resolveDateRange, StatsPeriod, PeriodFilter } from "@/utils/dateRange";

interface StatusBreakdown {
  count: number;
  amount: number;
  profit: number;
}

interface ServiceTransactionType {
  pending: StatusBreakdown;
  failed: StatusBreakdown;
  successful: StatusBreakdown;
  reversed: StatusBreakdown;
  total: StatusBreakdown;
}

interface WalletTransactionType {
  pending: StatusBreakdown;
  failed: StatusBreakdown;
  successful: StatusBreakdown;
  reversed: StatusBreakdown;
  total: StatusBreakdown;
}


export class DashboardService {
  private readonly SERVICE_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS;
  private readonly WALLET_TRANSACTION_TYPES = [
    ...TRANSACTION_CATEGORIES.WALLET_OPERATIONS,
    ...TRANSACTION_CATEGORIES.BANKING_OPERATIONS,
  ];

  constructor(
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
  ) {}

  async getDashboardStats(filters: { startDate?: Date; endDate?: Date, period?: StatsPeriod } = {}) {
    const [
      serviceTransactions,
      walletTransactions,
      users,
      walletBalance,
      comparison,
    ] = await Promise.all([
      this.getServiceTransactionStats(filters),
      this.getWalletTransactionStats(filters),
      this.getUserStats(),
      this.getWalletBalanceStats(),
      this.getYesterdayVsTodayComparison(),
    ]);

    const totalProfit =
      (serviceTransactions?.all?.successful?.profit || 0);

    return {
      services_transaction: serviceTransactions,
      wallet_transaction: walletTransactions,
      users,
      wallet_balance: walletBalance,
      total_profit: totalProfit,
      comparison,
    };
  }

  private async getServiceTransactionStats(filters: any = {}) {
    const query: any = { type: { $in: this.SERVICE_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          smm: this.createServiceTypePipeline("smm"),
          gameTopup: this.createServiceTypePipeline("game_topup"),
          numberRental: this.createServiceTypePipeline("number_rental"),
          proxy: this.createServiceTypePipeline("proxy"),
          all: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: "$amount" },
                profit: { $sum: "$profit" },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);
    const data = result[0];

    return {
      smm: this.formatServiceTypeStats(data.smm),
      gameTopup: this.formatServiceTypeStats(data.gameTopup),
      numberRental: this.formatServiceTypeStats(data.numberRental),
      proxy: this.formatServiceTypeStats(data.proxy),
      all: this.formatServiceTypeStats(data.all),
    };
  }

  private createServiceTypePipeline(type: string) {
    return [
      { $match: { type } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
          profit: { $sum: "$profit" },
        },
      },
    ];
  }

  private formatServiceTypeStats(statusData: any[]): ServiceTransactionType {
    const statusMap = new Map(statusData.map((s) => [s._id, s]));

    const pending = statusMap.get("pending") || { count: 0, amount: 0, profit: 0 };
    const failed = statusMap.get("failed") || { count: 0, amount: 0, profit: 0 };
    const successful = statusMap.get("success") || { count: 0, amount: 0, profit: 0 };
    const reversed = statusMap.get("reversed") || { count: 0, amount: 0, profit: 0 };

    const totalCount =
      pending.count + failed.count + successful.count + reversed.count;
    const totalAmount =
      pending.amount + failed.amount + successful.amount + reversed.amount;
    const totalProfit =
      (pending.profit || 0) + (failed.profit || 0) + (successful.profit || 0) + (reversed.profit || 0);

    return {
      pending: { count: pending.count, amount: pending.amount, profit: pending.profit || 0 },
      failed: { count: failed.count, amount: failed.amount, profit: failed.profit || 0 },
      successful: { count: successful.count, amount: successful.amount, profit: successful.profit || 0 },
      reversed: { count: reversed.count, amount: reversed.amount, profit: reversed.profit || 0 },
      total: { count: totalCount, amount: totalAmount, profit: totalProfit },
    };
  }

  private async getWalletTransactionStats(filters: any = {}) {
    const query: any = { type: { $in: this.WALLET_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          deposit: this.createWalletTypePipeline(["deposit"]),
          withdrawal: this.createWalletTypePipeline(["withdrawal"]),
          transfer: this.createWalletTypePipeline(["wallet_transfer"]),
          all: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: "$amount" },
                profit: { $sum: "$profit" },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);
    const data = result[0];

    return {
      deposit: this.formatServiceTypeStats(data.deposit),
      withdrawal: this.formatServiceTypeStats(data.withdrawal),
      transfer: this.formatServiceTypeStats(data.transfer),
      all: this.formatServiceTypeStats(data.all),
    };
  }

  private createWalletTypePipeline(types: string[]) {
    return [
      { $match: { type: { $in: types } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
          profit: { $sum: "$profit" },
        },
      },
    ];
  }

  private async getUserStats() {
    const pipeline = [
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          total: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const result = await this.userRepository.aggregate(pipeline);
    const data = result[0];

    const statusMap = new Map(
      data.statusBreakdown.map((s: any) => [s._id, s.count]),
    );

    return {
      active: statusMap.get("active") || 0,
      inactive: statusMap.get("inactive") || 0,
      restricted: statusMap.get("suspended") || 0,
      deactivated: 0, // Adjust based on your actual status values
      fraudulent: statusMap.get("fraudulent") || 0,
      "shadow-banned": statusMap.get("shadow-banned") || 0,
      total: data.total[0]?.count || 0,
    };
  }

  private async getWalletBalanceStats() {
    const result = await this.walletRepository.aggregate([
      {
        $match: {
          balance: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$balance" },
          userCount: { $sum: 1 },
        },
      },
    ]);

    if (!result || result.length === 0) {
      return {
        amount: 0,
        users: 0,
      };
    }

    return {
      amount: result[0].totalBalance || 0,
      users: result[0].userCount || 0,
    };
  }

  // Additional helper methods for revenue and charts
  async getRevenueChart(days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.transactionRepository.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return result.map((item) => ({
      date: item._id,
      revenue: item.revenue,
      transactions: item.count,
    }));
  }

  async getTransactionTypeDistribution() {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success" } },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          total: { $sum: "$amount" },
        },
      },
    ]);

    return result.map((item) => ({
      type: item._id,
      count: item.count,
      total: item.total,
    }));
  }

  private async calculateTotalRevenue() {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result[0]?.total || 0;
  }

  private async calculateTodayRevenue(today: Date) {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success", createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result[0]?.total || 0;
  }

  async getYesterdayVsTodayComparison() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart.getTime() - 1);

    const [todayMetrics, yesterdayMetrics, todayUsers, yesterdayUsers] = await Promise.all([
      this.getAggregatedPeriodMetrics(todayStart, todayEnd),
      this.getAggregatedPeriodMetrics(yesterdayStart, yesterdayEnd),
      this.userRepository.count({
        createdAt: { $gte: todayStart, $lte: todayEnd },
        deletedAt: null,
      }),
      this.userRepository.count({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
        deletedAt: null,
      }),
    ]);

    const today = {
      volume: todayMetrics.volume,
      profit: todayMetrics.profit,
      newUsers: todayUsers,
      successfulCount: todayMetrics.count,
      avgTransactionValue: todayMetrics.count > 0 ? Math.round(todayMetrics.volume / todayMetrics.count) : 0,
    };

    const yesterday = {
      volume: yesterdayMetrics.volume,
      profit: yesterdayMetrics.profit,
      newUsers: yesterdayUsers,
      successfulCount: yesterdayMetrics.count,
      avgTransactionValue: yesterdayMetrics.count > 0 ? Math.round(yesterdayMetrics.volume / yesterdayMetrics.count) : 0,
    };

    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const diff = {
      volumeDiff: today.volume - yesterday.volume,
      volumeChange: calcChange(today.volume, yesterday.volume),
      profitDiff: today.profit - yesterday.profit,
      profitChange: calcChange(today.profit, yesterday.profit),
      newUsersDiff: today.newUsers - yesterday.newUsers,
      newUsersChange: calcChange(today.newUsers, yesterday.newUsers),
      successfulCountDiff: today.successfulCount - yesterday.successfulCount,
      successfulCountChange: calcChange(today.successfulCount, yesterday.successfulCount),
      avgTransactionValueDiff: today.avgTransactionValue - yesterday.avgTransactionValue,
      avgTransactionValueChange: calcChange(today.avgTransactionValue, yesterday.avgTransactionValue),
    };

    return {
      today,
      yesterday,
      diff,
    };
  }

  private async getAggregatedPeriodMetrics(startDate: Date, endDate: Date) {
    const dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };

    const serviceAgg = await this.transactionRepository.aggregate([
      {
        $match: {
          ...dateQuery,
          type: { $in: this.SERVICE_TRANSACTION_TYPES },
          status: "success",
        },
      },
      {
        $group: {
          _id: null,
          volume: { $sum: "$amount" },
          profit: { $sum: { $ifNull: ["$profit", 0] } },
          count: { $sum: 1 },
        },
      },
    ]);

    const s = serviceAgg[0] || { volume: 0, profit: 0, count: 0 };

    return {
      volume: s.volume || 0,
      profit: s.profit || 0,
      count: s.count || 0,
    };
  }

  async getProfitChartData(filters: PeriodFilter = {}) {
    const dateRange = resolveDateRange(filters);
    const periodLower = (filters.period || "").toLowerCase();
    const isTodayOnly = periodLower === "today" || periodLower === "1d";
    const dateFormat = isTodayOnly ? "%H:00" : "%Y-%m-%d";

    const matchDate = dateRange ? { createdAt: dateRange } : {};

    const serviceStats = await this.transactionRepository.aggregate([
      {
        $match: {
          ...matchDate,
          type: { $in: this.SERVICE_TRANSACTION_TYPES },
          status: "success",
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
          profit: { $sum: { $ifNull: ["$profit", 0] } },
          volume: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    return serviceStats
      .filter((item: any) => item._id)
      .map((item: any) => ({ date: item._id, profit: item.profit || 0, volume: item.volume || 0, count: item.count || 0 }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  }
}
