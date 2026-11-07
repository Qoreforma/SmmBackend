import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { CACHE_KEYS } from "@/utils/constants";
import { CacheService } from "../../core/CacheService";

export class ServiceChargeService {
  constructor(
    private serviceChargeRepository: ServiceChargeRepository,
    private cacheService: CacheService,
  ) {}

  async listServiceCharges(
    page: number = 1,
    limit: number = 50,
    filters: any = {},
  ) {
    const query: any = {};

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.code) {
      query.code = { $regex: filters.code, $options: "i" };
    }

    const result = await this.serviceChargeRepository.findWithPagination(
      query,
      page,
      limit,
      { name: 1 },
    );

    return {
      data: result.data,
      total: result.total,
    };
  }

  async getServiceChargeDetails(chargeId: string) {
    const serviceCharge = await this.serviceChargeRepository.findById(chargeId);
    if (!serviceCharge) {
      throw new Error("Service charge not found");
    }
    return serviceCharge;
  }

  async updateServiceCharge(chargeId: string, data: any) {
    const serviceCharge = await this.serviceChargeRepository.findById(chargeId);
    if (!serviceCharge) {
      throw new Error("Service charge not found");
    }

    const result = await this.serviceChargeRepository.update(chargeId, data);

    this.invalidateServiceChargeCache(serviceCharge.code);

    return result;
  }

  async invalidateServiceChargeCache(code: string): Promise<void> {
    await this.cacheService.delete(CACHE_KEYS.SERVICE_CHARGE_BY_CODE(code));
  }

  async bulkUpdateServiceCharges(ids: string[], data: any) {
    // code is unique per charge — never let one payload overwrite many codes
    const { code, ...safeData } = data;

    const charges = await this.serviceChargeRepository.find({ _id: { $in: ids } } as any);
    if (charges.length === 0) {
      throw new Error("No matching service charges found");
    }

    const result = await this.serviceChargeRepository.bulkUpdate(ids, safeData);

    for (const charge of charges) {
      await this.invalidateServiceChargeCache(charge.code);
    }

    return {
      message: `${result.modifiedCount} of ${ids.length} service charges updated successfully`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }
}

