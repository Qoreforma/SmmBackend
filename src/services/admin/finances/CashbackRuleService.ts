import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { CacheService } from "@/services/core/CacheService";
import logger from "@/logger";

export class CashbackRuleService {
  private cacheService: CacheService;

  constructor(
    private cashbackRuleRepository: CashbackRuleRepository,
    cacheService?: CacheService
  ) {
    this.cacheService = cacheService || new CacheService();
  }

  private async invalidateCache(): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.deletePattern("cashbacks:*"),
        this.cacheService.deletePattern("cashback:rule:*"),
      ]);
    } catch (err) {
      logger.error("Failed to invalidate cashback caches", err);
    }
  }

  async create(data: any) {
    const result = await this.cashbackRuleRepository.create(data);
    await this.invalidateCache();
    return result;
  }

  async getAll(page: number = 1, limit: number = 10, filters: any = {}) {
    return this.cashbackRuleRepository.findWithPagination(
      filters,
      page,
      limit,
      { createdAt: -1 },
      [{ path: "serviceTypeId", select: "name code" }]
    );
  }

  async getById(id: string) {
    const rule = await this.cashbackRuleRepository.findById(id);
    if (!rule) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    return rule;
  }

  async update(id: string, data: any) {
    const rule = await this.cashbackRuleRepository.update(id, data);
    if (!rule) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    await this.invalidateCache();
    return rule;
  }

  async delete(id: string) {
    const success = await this.cashbackRuleRepository.delete(id);
    if (!success) {
      throw new AppError("Cashback rule not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }
    await this.invalidateCache();
    return true;
  }

  async bulkUpdate(ids: string[], data: any) {
    const rules = await this.cashbackRuleRepository.find({ _id: { $in: ids } } as any);
    if (rules.length === 0) {
      throw new AppError("No matching cashback rules found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const result = await this.cashbackRuleRepository.bulkUpdate(ids, data);
    await this.invalidateCache();
    return {
      message: `Successfully updated ${result.modifiedCount} cashback rule(s)`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  async findApplicableRule(
    serviceTypeId: string
  ) {
    // Find all active rules
    const activeRules = await this.cashbackRuleRepository.findActiveRules();

    // Match rules from most specific to least specific
    const rules = activeRules.filter((r) => {
      let isMatch = true;
      if (r.serviceTypeId && r.serviceTypeId.toString() !== serviceTypeId) isMatch = false;
      return isMatch;
    });

    if (rules.length === 0) return null;

    return rules[0];
  }
}
