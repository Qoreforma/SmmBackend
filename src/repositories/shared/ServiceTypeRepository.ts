import { BaseRepository } from "../BaseRepository";
import { ServiceType, IServiceType } from "@/models/reference/ServiceType";

export class ServiceTypeRepository extends BaseRepository<IServiceType> {
  constructor() {
    super(ServiceType);
  }

  async findByCode(code: string): Promise<IServiceType | null> {
    return this.model.findOne({ code: code.toLowerCase().trim() }).exec();
  }

  async findAllActive(): Promise<IServiceType[]> {
    return this.model
      .find({ status: "active", deletedAt: null })
      .sort({ displayOrder: 1, name: 1 })
      .exec();
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const filter: any = { code: code.toLowerCase().trim() };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const count = await this.model.countDocuments(filter).exec();
    return count > 0;
  }

  async updateDisplayOrder(
    id: string,
    order: number
  ): Promise<IServiceType | null> {
    return this.model
      .findByIdAndUpdate(id, { displayOrder: order }, { new: true })
      .exec();
  }

  async toggleActive(id: string): Promise<IServiceType | null> {
    const serviceType = await this.findById(id);
    if (!serviceType) return null;

    return this.model
      .findByIdAndUpdate(id, { status: "active" }, { new: true })
      .exec();
  }

  async restore(id: string): Promise<IServiceType | null> {
    return this.model
      .findByIdAndUpdate(id, { deletedAt: null }, { new: true })
      .exec();
  }

  async search(
    searchTerm: string,
    activeOnly: boolean = true
  ): Promise<IServiceType[]> {
    const filter: any = {
      $or: [
        { name: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
        { code: { $regex: searchTerm, $options: "i" } },
      ],
    };

    if (activeOnly) {
      filter.status = "active";
      filter.deletedAt = null;
    }

    return this.model.find(filter).sort({ displayOrder: 1, name: 1 }).exec();
  }

  async findMany(filter: any, skip: number = 0, limit: number = 10) {
    return this.model.find(filter).skip(skip).limit(limit).exec();
  }
}
