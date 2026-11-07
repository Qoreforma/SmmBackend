import { BaseRepository } from "../BaseRepository";
import { WebhookLog, IWebhookLog } from "@/models/partner/WebhookLog";
import { Types } from "mongoose";

export class WebhookLogRepository extends BaseRepository<IWebhookLog> {
  constructor() {
    super(WebhookLog);
  }

  async findPendingRetries(): Promise<IWebhookLog[]> {
    return this.model
      .find({
        status: "pending",
        retryCount: { $lt: 3 },
        nextRetryAt: { $lte: new Date() },
        deletedAt: null,
      })
      .populate("userId", "email partner")
      .exec();
  }

  async findByTransactionId(txnId: string | Types.ObjectId): Promise<IWebhookLog | null> {
    return this.model
      .findOne({
        $or: [
          { transactionId: txnId },
          { giftCardTransactionId: txnId },
        ],
        deletedAt: null,
      })
      .exec();
  }

  async findByUserId(userId: string | Types.ObjectId, page: number = 1, limit: number = 20) {
    return this.findWithPagination(
      { userId, deletedAt: null },
      page,
      limit,
      { createdAt: -1 }
    );
  }

  async markAsSuccess(logId: string | Types.ObjectId, responseStatus: number): Promise<void> {
    await this.model.findByIdAndUpdate(logId, {
      status: "success",
      succeededAt: new Date(),
      responseStatus,
      lastAttemptAt: new Date(),
    });
  }

  async markForRetry(logId: string | Types.ObjectId, nextRetryAt: Date): Promise<void> {
    await this.model.findByIdAndUpdate(logId, {
      $inc: { retryCount: 1 },
      nextRetryAt,
      lastAttemptAt: new Date(),
    });
  }

  async markAsFailed(
    logId: string | Types.ObjectId,
    responseStatus: number,
    responseBody: string
  ): Promise<void> {
    await this.model.findByIdAndUpdate(logId, {
      status: "failed",
      responseStatus,
      responseBody,
      lastAttemptAt: new Date(),
    });
  }
}
