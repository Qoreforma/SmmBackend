import { BaseRepository } from "../BaseRepository";
import {
  PartnerCommission,
  IPartnerCommission,
} from "@/models/partner/PartnerCommission";
import { Types } from "mongoose";

export class PartnerCommissionRepository extends BaseRepository<IPartnerCommission> {
  constructor() {
    super(PartnerCommission);
  }

  async findByServiceAndProvider(
    serviceId: string | Types.ObjectId,
    providerId: string | Types.ObjectId,
  ): Promise<IPartnerCommission | null> {
    return this.model
      .findOne({
        serviceId: new Types.ObjectId(serviceId.toString()),
        providerId: new Types.ObjectId(providerId.toString()),
        active: true,
      })
      .exec();
  }

  async findAll(
    filters: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ data: IPartnerCommission[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find()
        .populate("serviceId", "name code")
        .populate("providerId", "name code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments().exec(),
    ]);

    return { data, total };
  }

  async upsertByProviderAndService(
    providerId: string | Types.ObjectId,
    serviceId: string | Types.ObjectId,
    data: Partial<IPartnerCommission>,
  ): Promise<IPartnerCommission> {
    return this.model.findOneAndUpdate(
      {
        providerId: new Types.ObjectId(providerId.toString()),
        serviceId: new Types.ObjectId(serviceId.toString()),
      },
      { $set: data },
      { upsert: true, new: true },
    );
  }

  async setActiveByProviderAndService(
    providerId: string | Types.ObjectId,
    serviceId: string | Types.ObjectId,
    active: boolean,
  ): Promise<IPartnerCommission | null> {
    return this.model
      .findOneAndUpdate(
        {
          providerId: new Types.ObjectId(providerId.toString()),
          serviceId: new Types.ObjectId(serviceId.toString()),
        },
        { $set: { active } },
        { new: true },
      )
      .exec();
  }
}
