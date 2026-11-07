import { BaseRepository } from "../BaseRepository";
import { Discount, IDiscount } from "@/models/billing/fees/Discount";
import { Types } from "mongoose";

export class DiscountRepository extends BaseRepository<IDiscount> {
  constructor() {
    super(Discount);
  }

  async findByCode(code: string): Promise<IDiscount | null> {
    return this.model.findOne({ code }).exec();
  }

  async findByProviderId(
    providerId: string | Types.ObjectId,
  ): Promise<IDiscount[]> {
    return this.model.find({ providerId }).exec();
  }

  async findByServiceId(
    serviceId: string | Types.ObjectId,
  ): Promise<IDiscount[]> {
    return this.model.find({ serviceId }).exec();
  }

  async findByProductType(productType: string): Promise<IDiscount[]> {
    return this.model.find({ productType }).exec();
  }

  async findActiveDiscounts(): Promise<IDiscount[]> {
    return this.model.find({ active: true }).exec();
  }

  async findByType(type: "flat" | "percentage"): Promise<IDiscount[]> {
    return this.model.find({ type }).exec();
  }

  async findActiveByServiceAndProduct(
    serviceId: string | Types.ObjectId,
    productType: string,
  ): Promise<IDiscount[]> {
    return this.model
      .find({
        serviceId,
        productType,
        active: true,
      })
      .exec();
  }

  async toggleActiveStatus(discountId: string): Promise<IDiscount | null> {
    const discount = await this.model.findById(discountId).exec();
    if (!discount) return null;

    return this.model
      .findByIdAndUpdate(
        discountId,
        { active: !discount.active },
        { new: true },
      )
      .exec();
  }

  async deactivateDiscount(discountId: string): Promise<IDiscount | null> {
    return this.model
      .findByIdAndUpdate(discountId, { active: false }, { new: true })
      .exec();
  }

  async activateDiscount(discountId: string): Promise<IDiscount | null> {
    return this.model
      .findByIdAndUpdate(discountId, { active: true }, { new: true })
      .exec();
  }

  async findWithFilters(filters: {
    providerId?: string | Types.ObjectId;
    serviceId?: string | Types.ObjectId;
    productType?: string;
    type?: "flat" | "percentage";
    active?: boolean;
    code?: string;
  }): Promise<IDiscount[]> {
    const query: any = {};

    if (filters.providerId) query.providerId = filters.providerId;
    if (filters.serviceId) query.serviceId = filters.serviceId;
    if (filters.productType) query.productType = filters.productType;
    if (filters.type) query.type = filters.type;
    if (filters.active !== undefined) query.active = filters.active;
    if (filters.code) query.code = { $regex: filters.code, $options: "i" };

    return this.model.find(query).exec();
  }

  async getDiscountStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    byType: Record<string, number>;
    byProductType: Record<string, number>;
  }> {
    const [allDiscounts, activeCount, inactiveCount] = await Promise.all([
      this.model.find().exec(),
      this.model.countDocuments({ active: true }).exec(),
      this.model.countDocuments({ active: false }).exec(),
    ]);

    const byType = allDiscounts.reduce(
      (acc, d) => {
        acc[d.type] = (acc[d.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byProductType = allDiscounts.reduce(
      (acc, d) => {
        acc[d.productType] = (acc[d.productType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      total: allDiscounts.length,
      active: activeCount,
      inactive: inactiveCount,
      byType,
      byProductType,
    };
  }

  async bulkActivate(discountIds: string[]): Promise<number> {
    const result = await this.model
      .updateMany({ _id: { $in: discountIds } }, { active: true })
      .exec();

    return result.modifiedCount;
  }

  async bulkDeactivate(discountIds: string[]): Promise<number> {
    const result = await this.model
      .updateMany({ _id: { $in: discountIds } }, { active: false })
      .exec();

    return result.modifiedCount;
  }

  async upsertByProviderAndService(
    providerId: string | Types.ObjectId,
    serviceId: string | Types.ObjectId,
    data: Partial<IDiscount>,
    onInsert: Partial<IDiscount>,
  ): Promise<IDiscount> {
    return this.model.findOneAndUpdate(
      {
        providerId: new Types.ObjectId(providerId.toString()),
        serviceId: new Types.ObjectId(serviceId.toString()),
      },
      {
        $set: data,
        $setOnInsert: onInsert,
      },
      { upsert: true, new: true },
    );
  }

  async setActiveByProviderAndService(
    providerId: string | Types.ObjectId,
    serviceId: string | Types.ObjectId,
    active: boolean,
  ): Promise<IDiscount | null> {
    return this.model
      .findOneAndUpdate(
        { providerId, serviceId },
        { $set: { active } },
        { new: true },
      )
      .exec();
  }
}
