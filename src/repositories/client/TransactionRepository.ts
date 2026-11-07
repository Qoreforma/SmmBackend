import { BaseRepository } from "../BaseRepository";
import { Transaction, ITransaction } from "@/models/wallet/Transaction";
import { Types, UpdateQuery, FilterQuery } from "mongoose";

export class TransactionRepository extends BaseRepository<ITransaction> {
  constructor() {
    super(Transaction);
  }

  async findByReference(reference: string): Promise<ITransaction | null> {
    return this.model.findOne({ reference }).exec();
  }

  async findByWalletId(
    walletId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination({ walletId }, page, limit);
  }

  async findByUserId(
    userId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination(
      { $or: [{ sourceId: userId }, { recipientId: userId }] },
      page,
      limit,
    );
  }

  async findByStatus(status: string, page: number = 1, limit: number = 10) {
    return this.findWithPagination({ status }, page, limit);
  }

  async findByType(type: string, page: number = 1, limit: number = 10) {
    return this.findWithPagination({ type }, page, limit);
  }

  async updateStatus(
    transactionId: string,
    status: "pending" | "success" | "failed" | "reversed",
  ): Promise<ITransaction | null> {
    return this.model
      .findByIdAndUpdate(transactionId, { status }, { new: true })
      .exec();
  }

  async findWithFilters(
    query: any,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      data,
      total,
    };
  }

  // Enhanced findWithPagination with population for admin views
  async findWithPaginationAndPopulate(
    query: FilterQuery<ITransaction>,
    page: number = 1,
    limit: number = 20,
    sort: any = { createdAt: -1 },
  ) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .populate(
          "sourceId",
          "firstname lastname username country phone avatar email",
        )
        .populate(
          "recipientId",
          "firstname lastname username country phone avatar email",
        )
        .populate("walletId", "balance")
        .populate(
          "userId",
          "firstname lastname username country phone avatar email",
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  // Bulk update transactions
  async bulkUpdate(
    filter: FilterQuery<ITransaction>,
    update: UpdateQuery<ITransaction>,
  ) {
    return this.model.updateMany(filter, update).exec();
  }

  // Find all with limit (for exports)
  async findAll(
    query: FilterQuery<ITransaction>,
    options: { limit?: number; sort?: any } = {},
  ) {
    const { limit = 10000, sort = { createdAt: -1 } } = options;

    return this.model
      .find(query)
      .populate(
        "sourceId",
        "firstName lastName firstname lastname avatar country profilePicture email phone",
      )
      .populate(
        "recipientId",
        "firstName lastName firstname lastname avatar country profilePicture email phone",
      )
      .sort(sort)
      .limit(limit)
      .lean()
      .exec();
  }

  // Get transactions by date range
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 20,
  ) {
    return this.findWithPaginationAndPopulate(
      {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      },
      page,
      limit,
    );
  }

  // Get pending transactions that need polling
  async findPendingForPolling(limit: number = 100) {
    return this.model
      .find({
        status: "pending",
        "polling.nextPollAt": { $lte: new Date() },
        "polling.pollCount": { $lt: 10 },
      })
      .limit(limit)
      .exec();
  }

  // Get transactions by provider
  async findByProvider(provider: string, page: number = 1, limit: number = 20) {
    return this.findWithPaginationAndPopulate({ provider }, page, limit);
  }

  // Get recent failed transactions
  async findRecentFailed(limit: number = 50) {
    return this.model
      .find({ status: "failed" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate(
        "sourceId",
        "firstName lastName firstname lastname avatar country profilePicture email phone",
      )
      .exec();
  }

  // Get transaction statistics
  async getStatsByDateRange(startDate: Date, endDate: Date) {
    return this.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);
  }

  // Get transaction count by type
  async getCountByType() {
    return this.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);
  }

  // Get user transaction summary
  async getUserTransactionSummary(userId: string | Types.ObjectId) {
    return this.aggregate([
      {
        $match: { sourceId: new Types.ObjectId(userId) },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
        },
      },
    ]);
  }

  // Find transactions by multiple references
  async findByReferences(references: string[]) {
    return this.model
      .find({ reference: { $in: references } })
      .populate(
        "sourceId",
        "firstName lastName firstname lastname avatar country profilePicture email phone",
      )
      .exec();
  }

  // Update multiple transactions by IDs
  async updateMany(
    transactionIds: string[],
    update: UpdateQuery<ITransaction>,
  ) {
    return this.model
      .updateMany(
        { _id: { $in: transactionIds.map((id) => new Types.ObjectId(id)) } },
        update,
      )
      .exec();
  }

  // Find transactions with advanced filters
  async findWithAdvancedFilters(filters: {
    status?: string | string[];
    type?: string | string[];
    provider?: string | string[];
    startDate?: Date;
    endDate?: Date;
    minAmount?: number;
    maxAmount?: number;
    userId?: string;
    reference?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      status,
      type,
      provider,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      userId,
      reference,
      page = 1,
      limit = 20,
    } = filters;

    const query: any = {};

    if (status) {
      query.status = Array.isArray(status) ? { $in: status } : status;
    }

    if (type) {
      query.type = Array.isArray(type) ? { $in: type } : type;
    }

    if (provider) {
      query.provider = Array.isArray(provider) ? { $in: provider } : provider;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = minAmount;
      if (maxAmount) query.amount.$lte = maxAmount;
    }

    if (userId) {
      query.sourceId = new Types.ObjectId(userId);
    }

    if (reference) {
      query.reference = { $regex: reference, $options: "i" };
    }

    return this.findWithPaginationAndPopulate(query, page, limit);
  }

  // Get daily transaction summary
  async getDailySummary(startDate: Date, endDate: Date) {
    return this.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            status: "$status",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $sort: { "_id.date": 1 as const },
      },
    ]);
  }

  // Get provider performance
  async getProviderPerformance(startDate?: Date, endDate?: Date) {
    const matchStage: any = { provider: { $exists: true, $ne: null } };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    return this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$provider",
          totalTransactions: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          totalAmount: { $sum: "$amount" },
          avgAmount: { $avg: "$amount" },
        },
      },
      {
        $addFields: {
          successRate: {
            $multiply: [
              { $divide: ["$successCount", "$totalTransactions"] },
              100,
            ],
          },
        },
      },
      {
        $sort: { totalTransactions: -1 },
      },
    ]);
  }

  // Find refund/reversal rows that point back at a batch of original
  // transactions, so the service layer can merge them into one entry
  // instead of showing both rows.
  async findLinkedTransactions(
    originalIds: (string | Types.ObjectId)[],
  ): Promise<any[]> {
    if (!originalIds.length) return [];
    return this.model
      .find({ linkedTransactionId: { $in: originalIds } })
      .lean()
      .exec();
  }

  async transitionStatus(
    id: string,
    disallowedFromStatuses: string[],
    update: UpdateQuery<ITransaction>,
  ): Promise<ITransaction | null> {
    return this.model.findOneAndUpdate(
      { _id: id, status: { $nin: disallowedFromStatuses } },
      update,
      { new: true },
    );
  }
}
