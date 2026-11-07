import { EmailBanner, IEmailBanner } from "@/models/system/EmailBanner";
import { Types } from "mongoose";

export class EmailBannerRepository {
  async getSettings(): Promise<IEmailBanner | null> {
    return await EmailBanner.findOne().exec();
  }

  async updateSettings(
    data: { logoUrl?: string; headerBannerUrl?: string; footerBannerUrl?: string },
    adminId: string,
  ): Promise<IEmailBanner | null> {
    return await EmailBanner.findOneAndUpdate(
      {},
      {
        ...data,
        updatedBy: new Types.ObjectId(adminId),
      },
      { upsert: true, new: true }
    ).exec();
  }
}
