import { BaseRepository } from "../BaseRepository";
import { ChannelIdentity, IChannelIdentity } from "@/models/core/ChannelIdentity";

export class ChannelIdentityRepository extends BaseRepository<IChannelIdentity> {
  constructor() {
    super(ChannelIdentity);
  }

  async findByChannelAndExternalId(
    channel: "telegram" | "whatsapp",
    externalId: string,
  ): Promise<IChannelIdentity | null> {
    return this.model.findOne({ channel, externalId }).exec();
  }

  async link(
    channel: "telegram" | "whatsapp",
    externalId: string,
    userId: string,
  ): Promise<IChannelIdentity> {
    return this.model
      .findOneAndUpdate(
        { channel, externalId },
        { channel, externalId, userId, linkedAt: new Date() },
        { upsert: true, new: true },
      )
      .exec();
  }
}
