import { IServiceCharge, ServiceCharge } from '@/models/billing/fees/ServiceCharge';
import { BaseRepository } from '@/repositories/BaseRepository';

export class ServiceChargeRepository extends BaseRepository<IServiceCharge> {
  constructor() {
    super(ServiceCharge);
  }

  async findByCode(code: string): Promise<IServiceCharge | null> {
    return this.model.findOne({ code });
  }

  async findByType(type: 'flat' | 'percentage'): Promise<IServiceCharge[]> {
    return this.model.find({ type });
  }
}