
import { IProviderRateConfig, ProviderRateConfig } from "@/models/admin/configs/ProviderRateConfig";
import { BaseRepository } from "@/repositories/BaseRepository";

export class ProviderRateConfigRepository extends BaseRepository<IProviderRateConfig> {
  constructor() {
    super(ProviderRateConfig);
  }

  async findByProviderId(providerId: string): Promise<IProviderRateConfig | null> {
    return this.model.findOne({ providerId, isActive: true });
  }

  async findByProviderCode(providerCode: string): Promise<IProviderRateConfig | null> {
    return this.model.findOne({
      providerCode: providerCode.toLowerCase(),
      isActive: true,
    });
  }

  async upsertByProviderId(
    providerId: string,
    data: Partial<IProviderRateConfig>
  ): Promise<IProviderRateConfig> {
    const result = await this.model.findOneAndUpdate(
      { providerId },
      { ...data },
      { upsert: true, new: true }
    );
    return result!;
  }

  async findAllActive(): Promise<IProviderRateConfig[]> {
    return this.model
      .find({ isActive: true })
      .populate("providerId", "name code logo")
      .sort({ createdAt: -1 });
  }
}