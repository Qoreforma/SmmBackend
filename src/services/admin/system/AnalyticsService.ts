import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { TRANSACTION_CATEGORIES } from "@/utils/constants";
import { resolveDateRange, StatsPeriod } from "@/utils/dateRange";

export class AnalyticsService {
  private readonly SERVICE_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS;

  constructor(private transactionRepository: TransactionRepository) {}

  async getServiceComparisonStats(
    filters: { startDate?: Date; endDate?: Date; period?: StatsPeriod } = {},
  ) {
    const dateRange = resolveDateRange(filters);
    const matchQuery: any = {
      type: { $in: this.SERVICE_TRANSACTION_TYPES },
      status: "success", // Only compare successful transactions for volume/profit
    };

    if (dateRange) matchQuery.createdAt = dateRange;

    const pipeline = [
      { $match: matchQuery },
      {
        $facet: {
          // 1. Top performing services overall
          services: [
            {
              $group: {
                _id: "$type",
                count: { $sum: 1 },
                volume: { $sum: "$amount" },
                profit: { $sum: { $ifNull: ["$profit", 0] } },
              },
            },
            { $sort: { volume: -1 } },
          ],

          // 2. Top performing providers overall
          providers: [
            {
              $match: { provider: { $exists: true, $ne: null } },
            },
            {
              $group: {
                _id: "$provider",
                count: { $sum: 1 },
                volume: { $sum: "$amount" },
                profit: { $sum: { $ifNull: ["$profit", 0] } },
              },
            },
            { $sort: { volume: -1 } },
          ],

          // 3. Top performing providers per service
          providersPerService: [
            {
              $match: { provider: { $exists: true, $ne: null } },
            },
            {
              $group: {
                _id: { type: "$type", provider: "$provider" },
                count: { $sum: 1 },
                volume: { $sum: "$amount" },
                profit: { $sum: { $ifNull: ["$profit", 0] } },
              },
            },
            {
              $group: {
                _id: "$_id.type",
                providers: {
                  $push: {
                    provider: "$_id.provider",
                    count: "$count",
                    volume: "$volume",
                    profit: "$profit",
                  },
                },
              },
            },
            {
              $project: {
                _id: 1,
                providers: {
                  $sortArray: { input: "$providers", sortBy: { volume: -1 } },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline as any[]);
    const data = result[0];

    // Format the response slightly to add ratios
    const formatStats = (item: any) => ({
      name: item._id,
      count: item.count,
      volume: item.volume,
      profit: item.profit,
      profitMargin: item.volume > 0 ? (item.profit / item.volume) * 100 : 0,
    });

    return {
      services: data.services.map(formatStats),
      providers: data.providers.map(formatStats),
      providersPerService: data.providersPerService.map((item: any) => ({
        service: item._id,
        providers: item.providers.map((p: any) => ({
          name: p.provider,
          count: p.count,
          volume: p.volume,
          profit: p.profit,
          profitMargin: p.volume > 0 ? (p.profit / p.volume) * 100 : 0,
        })),
      })),
    };
  }
}
