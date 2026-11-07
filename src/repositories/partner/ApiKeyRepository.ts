import { BaseRepository } from "../BaseRepository";
import { ApiKey, IApiKey } from "@/models/partner/ApiKey";
import { hashApiKey } from "@/utils/cryptography";
import { Types } from "mongoose";

export class ApiKeyRepository extends BaseRepository<IApiKey> {
  constructor() {
    super(ApiKey);
  }

async findByApiKey(apiKey: string): Promise<IApiKey | null> {
    const apiKeyHash = hashApiKey(apiKey);
    return this.model
      .findOne({
        apiKeyHash,
        isActive: true,
        deletedAt: null,
      })
      .select("+apiSecret")
      .populate("userId", "firstname lastname email partner")
      .exec();
  }

  async findByUserId(userId: string | Types.ObjectId): Promise<IApiKey | null> {
    return this.model
      .findOne({ userId, isActive: true, deletedAt: null })
      .select("+apiKeyHash")
      .exec();
  }

  async updateLastUsed(
    apiKeyId: string | Types.ObjectId,
    ip: string,
  ): Promise<void> {
    await this.model.findByIdAndUpdate(apiKeyId, {
      lastUsedAt: new Date(),
      lastUsedIp: ip,
      $inc: { requestCount: 1 },
    });
  }

  async deactivate(apiKeyId: string | Types.ObjectId): Promise<void> {
    await this.model.findByIdAndUpdate(apiKeyId, { isActive: false });
  }
}
