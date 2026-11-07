import { Types } from "mongoose";
import { BaseRepository } from "../BaseRepository";
import { Banner, IBanner } from "@/models/system/Banner";

export class BannerRepository extends BaseRepository<IBanner> {
  constructor() {
    super(Banner);
  }

  async findByIdAndPopulateAdmin(bannerId: string): Promise<IBanner | null> {
    return await this.model
      .findById(bannerId)
      .populate([{ path: "creator", select: "firstName lastName email" }])
      .exec();
  }

  async getMaxPriority(): Promise<number> {
    const top = await this.model.findOne().sort({ priority: -1 }).select("priority").exec();
    return top?.priority || 0;
  }

  async findActiveBanners(): Promise<IBanner[]> {
    return await this.model
      .find({ isActive: true })
      .sort({ priority: -1, createdAt: -1 })
      .exec();
  }
  async reorderPriorities(orderedIds: string[]): Promise<void> {
    const total = orderedIds.length;
    await this.model.bulkWrite(
      orderedIds.map((id, index) => ({
        updateOne: {
          filter: { _id: new Types.ObjectId(id) },
          update: { $set: { priority: total - index } },
        },
      })),
    );
  }
}
