import { BaseRepository } from "../BaseRepository";
import { Product, IProduct } from "@/models/reference/Product";
import { Types } from "mongoose";

export class ProductRepository extends BaseRepository<IProduct> {
  constructor() {
    super(Product);
  }

  async findActive(): Promise<IProduct[]> {
    return this.model
      .find({ isActive: true })
      .populate("serviceId")
      .sort({ name: 1 })
      .exec();
  }

  async findByServiceId(
    serviceId: string | Types.ObjectId
  ): Promise<IProduct[]> {
    return this.model
      .find({ serviceId, isActive: true })
      .sort({ amount: 1 })
      .exec();
  }

  async findAllByServiceId(
    serviceId: string | Types.ObjectId
  ): Promise<IProduct[]> {
    return this.model.find({ serviceId }).sort({ amount: 1 }).exec();
  }

  async findByDataType(dataType: string): Promise<IProduct[]> {
    return this.model
      .find({ dataType, isActive: true })
      .populate("serviceId")
      .sort({ amount: 1 })
      .exec();
  }

  async findByCode(code: string): Promise<IProduct | null> {
    return this.model.findOne({ code }).populate("serviceId").exec();
  }

  async searchByName(name: string): Promise<IProduct[]> {
    return this.model
      .find({ name: new RegExp(name, "i"), isActive: true })
      .populate("serviceId")
      .sort({ name: 1 })
      .exec();
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const query: any = { code };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    const count = await this.model.countDocuments(query).exec();
    return count > 0;
  }

  async findWithService(filter: any = {}): Promise<IProduct[]> {
    return this.model
      .find(filter)
      .populate({
        path: "serviceId",
        populate: {
          path: "serviceTypeId",
        },
      })
      .sort({ name: 1 })
      .exec();
  }

  async findWithFilters(
    filters: {
      isActive?: boolean;
      serviceId?: string | Types.ObjectId;
      dataType?: string;
      minAmount?: number;
      maxAmount?: number;
      search?: string;
    },
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: IProduct[]; total: number; page: number; pages: number }> {
    const query: any = {};

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    if (filters.serviceId) {
      query.serviceId = filters.serviceId;
    }

    if (filters.dataType) {
      query.dataType = filters.dataType;
    }

    if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
      query.amount = {};
      if (filters.minAmount !== undefined) {
        query.amount.$gte = filters.minAmount;
      }
      if (filters.maxAmount !== undefined) {
        query.amount.$lte = filters.maxAmount;
      }
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .populate("serviceId")
        .sort({ amount: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      data,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async findByServiceAndDataType(
    serviceId: string | Types.ObjectId,
    dataType: string
  ): Promise<IProduct[]> {
    return this.model
      .find({ serviceId, dataType, isActive: true })
      .sort({ amount: 1 })
      .exec();
  }

  async findByAmountRange(
    minAmount: number,
    maxAmount: number
  ): Promise<IProduct[]> {
    return this.model
      .find({
        amount: { $gte: minAmount, $lte: maxAmount },
        isActive: true,
      })
      .populate("serviceId")
      .sort({ amount: 1 })
      .exec();
  }

  async toggleActive(id: string): Promise<IProduct | null> {
    const product = await this.findById(id);
    if (!product) return null;

    return this.model
      .findByIdAndUpdate(id, { isActive: !product.isActive }, { new: true })
      .exec();
  }

  async countByService(serviceId: string | Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ serviceId }).exec();
  }

  async countByDataType(dataType: string): Promise<number> {
    return this.model.countDocuments({ dataType, isActive: true }).exec();
  }

  async getDistinctDataTypes(): Promise<string[]> {
    return this.model.distinct("attributes.dataType").exec();
  }

  async findCheapestByService(
    serviceId: string | Types.ObjectId
  ): Promise<IProduct | null> {
    return this.model
      .findOne({ serviceId, isActive: true })
      .sort({ amount: 1 })
      .exec();
  }

  async findMostExpensiveByService(
    serviceId: string | Types.ObjectId
  ): Promise<IProduct | null> {
    return this.model
      .findOne({ serviceId, isActive: true })
      .sort({ amount: -1 })
      .exec();
  }

  async bulkUpdatePrices(
    updates: { id: string; amount: number }[]
  ): Promise<void> {
    const bulkOps = updates.map(({ id, amount }) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id) },
        update: { $set: { amount } },
      },
    }));

    await this.model.bulkWrite(bulkOps);
  }

  async getServiceStatistics(serviceId: string | Types.ObjectId): Promise<{
    total: number;
    active: number;
    inactive: number;
    minAmount: number;
    maxAmount: number;
    avgAmount: number;
  }> {
    const [stats] = await this.model.aggregate([
      { $match: { serviceId: new Types.ObjectId(serviceId as string) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
          },
          inactive: {
            $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
          },
          minAmount: { $min: "$amount" },
          maxAmount: { $max: "$amount" },
          avgAmount: { $avg: "$amount" },
        },
      },
    ]);

    return (
      stats || {
        total: 0,
        active: 0,
        inactive: 0,
        minAmount: 0,
        maxAmount: 0,
        avgAmount: 0,
      }
    );
  }

  async findByValidity(validity: string): Promise<IProduct[]> {
    return this.model
      .find({ validity, isActive: true })
      .populate("serviceId")
      .sort({ amount: 1 })
      .exec();
  }

  async getGroupedByDataType(): Promise<
    Array<{ dataType: string; count: number; products: IProduct[] }>
  > {
    const products = await this.model
      .find({ isActive: true })
      .populate("serviceId")
      .sort({ dataType: 1, amount: 1 })
      .exec();

    const grouped = products.reduce((acc, product) => {
      const type = product.attributes?.dataType || "UNCATEGORIZED";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(product);
      return acc;
    }, {} as Record<string, IProduct[]>);

    return Object.entries(grouped).map(([dataType, products]) => ({
      dataType,
      count: products.length,
      products,
    }));
  }
}
