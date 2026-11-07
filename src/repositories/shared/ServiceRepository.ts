import { BaseRepository } from "../BaseRepository";
import { Service, IService } from "@/models/reference/Service";
import { Types } from "mongoose";

export class ServiceRepository extends BaseRepository<IService> {
  constructor() {
    super(Service);
  }
  async findActive(): Promise<IService[]> {
    return this.model
      .find({ isActive: true, deletedAt: null })
      .sort({ displayOrder: 1 })
      .exec();
  }

  async findByCode(code: string): Promise<IService | null> {
    return this.model.findOne({ code, deletedAt: null }).exec();
  }
  findByIdAndPopulateType(id: string): Promise<IService | null> {
    return this.model.findById(id).populate("serviceTypeId").exec();
  }

  async findByServiceType(
    serviceTypeId: string | Types.ObjectId
  ): Promise<IService[]> {
    return this.model
      .find({ serviceTypeId, deletedAt: null })
      .sort({ displayOrder: 1 })
      .exec();
  }

  async findActiveByServiceType(
    serviceTypeId: string | Types.ObjectId
  ): Promise<IService[]> {
    return this.model
      .find({ serviceTypeId, isActive: true, deletedAt: null })
      .sort({ displayOrder: 1 })
      .exec();
  }

  async findWithServiceType(filter: any = {}): Promise<IService[]> {
    return this.model
      .find({ ...filter, deletedAt: null })
      .populate("serviceTypeId")
      .sort({ displayOrder: 1 })
      .exec();
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const query: any = { code, deletedAt: null };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    const count = await this.model.countDocuments(query).exec();
    return count > 0;
  }

  async updateDisplayOrder(
    id: string,
    displayOrder: number
  ): Promise<IService | null> {
    return this.model
      .findByIdAndUpdate(id, { displayOrder }, { new: true })
      .exec();
  }

  async toggleActive(id: string): Promise<IService | null> {
    const service = await this.findById(id);
    if (!service) return null;

    return this.model
      .findByIdAndUpdate(id, { isActive: !service.isActive }, { new: true })
      .exec();
  }

  async bulkUpdateDisplayOrders(
    updates: { id: string; displayOrder: number }[]
  ): Promise<void> {
    const bulkOps = updates.map(({ id, displayOrder }) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id)},
        update: { displayOrder },
      },
    }));

    await this.model.bulkWrite(bulkOps);
  }

  async findWithFilters(
    filters: {
      isActive?: boolean;
      serviceTypeId?: string | Types.ObjectId;
      search?: string;
    },
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: IService[]; total: number; page: number; pages: number }> {
    const query: any = { deletedAt: null };

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    if (filters.serviceTypeId) {
      query.serviceTypeId = filters.serviceTypeId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .populate("serviceTypeId")
        .sort({ displayOrder: 1, createdAt: -1 })
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

  async countByServiceType(
    serviceTypeId: string | Types.ObjectId
  ): Promise<number> {
    return this.model
      .countDocuments({
        serviceTypeId,
        deletedAt: null,
      })
      .exec();
  }

  async getNextDisplayOrder(
    serviceTypeId?: string | Types.ObjectId
  ): Promise<number> {
    const query: any = { deletedAt: null };
    if (serviceTypeId) {
      query.serviceTypeId = serviceTypeId;
    }

    const lastService = await this.model
      .findOne(query)
      .sort({ displayOrder: -1 })
      .exec();

    return lastService ? lastService.displayOrder + 1 : 0;
  }
}
