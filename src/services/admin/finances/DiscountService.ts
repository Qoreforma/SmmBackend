import logger from "@/logger";
import { Provider } from "@/models/reference/Provider";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { DiscountRepository } from "@/repositories/shared/DiscountRepository";
import { CacheService } from "@/services/core/CacheService";

export class DiscountService {
  constructor(
    private discountRepository: DiscountRepository,
    private cacheService: CacheService,
  ) {}

  // Invalidates all cache entries related to a discount change
  // This covers:
  // 1. Direct discount caches for specific provider/service combinations
  // 2. Provider caches (since discounts affect provider visibility)
  // 3. Service and product caches that might include discount info
  // 4. Service charge caches (discounts impact final pricing)
  private async invalidateDiscountCaches(
    providerId: string,
    serviceId: string,
  ): Promise<void> {
    const cachePatterns = [
      `discounts:${providerId}:${serviceId}:*`,
      `discounts:${providerId}:*`,
      `provider:${providerId}:*`,
      `discount:auto:${providerId}:${serviceId}`,
    ];

    const invalidationPromises = cachePatterns.map((pattern) =>
      this.cacheService.deletePattern(pattern).catch((err) => {
        logger.error(`Failed to invalidate cache pattern: ${pattern}`, {
          error: err.message,
        });
      }),
    );

    await Promise.all(invalidationPromises);
  }

  // Comprehensive cache invalidation for discount operations
  // Covers direct discount caches and related caches
  private async invalidateAllDiscountRelatedCaches(
    providerId: string,
    serviceId: string,
  ): Promise<void> {
    const cachePatterns = [
      `discounts:${providerId}:${serviceId}:*`,
      `discounts:${providerId}:*`,
      `discounts:*`,
      `provider:active:*`,
      `provider:${providerId}:*`,
      `service:${serviceId}:*`,
      `service:*`,
      `products:service:${serviceId}:*`,
      `products:*`,
      `service_charge:*`,
      `discount:auto:${providerId}:${serviceId}`,
    ];

    const invalidationPromises = cachePatterns.map((pattern) =>
      this.cacheService.deletePattern(pattern).catch((err) => {
        logger.error(`Failed to invalidate cache pattern: ${pattern}`, {
          error: err.message,
          pattern,
        });
      }),
    );

    await Promise.all(invalidationPromises);
  }

  async listDiscounts(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = {};

    if (filters.serviceId) {
      query.serviceId = filters.serviceId;
    }

    if (filters.status !== undefined) {
      query.active = filters.status === "active";
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.code) {
      query.code = { $regex: filters.code, $options: "i" };
    }

    const result = await this.discountRepository.findWithPagination(
      query,
      page,
      limit,
    );

    return {
      discounts: result.data,
      total: result.total,
    };
  }

  async createDiscount(data: any) {
    const existingDiscount = await this.discountRepository.findByCode(
      data.code,
    );
    if (existingDiscount) {
      throw new Error("Discount code already exists");
    }

    const discount = await this.discountRepository.create(data);

    // Invalidate all discount-related caches for this provider/service
    await this.invalidateDiscountCaches(
      discount.providerId.toString(),
      discount.serviceId.toString(),
    );

    return { message: "Discount created successfully", discount };
  }

  async getDiscountDetails(discountId: string) {
    const discount = await this.discountRepository.findById(discountId);
    if (!discount) {
      throw new Error("Discount not found");
    }
    return discount;
  }

  async updateDiscount(discountId: string, data: any) {
    const discount = await this.discountRepository.findById(discountId);
    if (!discount) {
      throw new Error("Discount not found");
    }

    if (data.code && data.code !== discount.code) {
      const existingDiscount = await this.discountRepository.findByCode(
        data.code,
      );
      if (existingDiscount) {
        throw new Error("Discount code already exists");
      }
    }

    const updatedDiscount = await this.discountRepository.update(
      discountId,
      data,
    );

    // Invalidate caches - use both old and new values in case provider/service changed
    const providerId = discount.providerId.toString();
    const serviceId = discount.serviceId.toString();

    await this.invalidateDiscountCaches(providerId, serviceId);

    // If provider or service was updated, also invalidate the new combination
    if (
      (data.providerId && data.providerId.toString() !== providerId) ||
      (data.serviceId && data.serviceId.toString() !== serviceId)
    ) {
      const newProviderId = data.providerId?.toString() || providerId;
      const newServiceId = data.serviceId?.toString() || serviceId;
      await this.invalidateDiscountCaches(newProviderId, newServiceId);
    }

    return {
      message: "Discount updated successfully",
      discount: updatedDiscount,
    };
  }

  async deleteDiscount(discountId: string) {
    const discount = await this.discountRepository.findById(discountId);
    if (!discount) {
      throw new Error("Discount not found");
    }

    await this.discountRepository.delete(discountId);

    // Invalidate caches for the deleted discount
    await this.invalidateDiscountCaches(
      discount.providerId.toString(),
      discount.serviceId.toString(),
    );

    return { message: "Discount deleted successfully" };
  }

  async toggleDiscountStatus(discountId: string) {
    const discount =
      await this.discountRepository.toggleActiveStatus(discountId);
    if (!discount) {
      throw new Error("Discount not found");
    }

    // For toggle operations, invalidate all discount caches since active status affects all queries
    await this.invalidateAllDiscountRelatedCaches(
      discount.providerId.toString(),
      discount.serviceId.toString(),
    );

    return { message: "Discount status updated successfully", discount };
  }

  async getDiscountByCode(code: string) {
    const discount = await this.discountRepository.findByCode(code);
    if (!discount) {
      throw new Error("Discount not found");
    }
    if (!discount.active) {
      throw new Error("Discount is not active");
    }
    return discount;
  }

  async bulkUpdateDiscounts(ids: string[], data: any) {
    // code must stay unique per discount — never allow a single payload to overwrite many codes
    const { code, ...safeData } = data;

    const discounts = await this.discountRepository.find({ _id: { $in: ids } } as any);
    if (discounts.length === 0) {
      throw new Error("No matching discounts found");
    }

    const result = await this.discountRepository.bulkUpdate(ids, safeData);

    // Dedupe provider/service pairs so we invalidate each combination once, not once per id
    const seen = new Set<string>();
    for (const discount of discounts) {
      const key = `${discount.providerId}:${discount.serviceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.invalidateAllDiscountRelatedCaches(
        discount.providerId.toString(),
        discount.serviceId.toString(),
      );
    }

    return {
      message: `${result.modifiedCount} of ${ids.length} discounts updated successfully`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

// Upserts a discount by providerId+serviceId. `code` and `productType` are
// required by the schema but never admin-managed — they're only generated
// the first time a row is created (via $setOnInsert) and never touched again.
async upsertDiscount(data: {
  providerId: string;
  serviceId: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  cap?: number;
  active?: boolean;
}) {
  const [provider, service] = await Promise.all([
    Provider.findById(data.providerId).select("code").lean(),
    Service.findById(data.serviceId).select("code serviceTypeId").lean(),
  ]);
  if (!provider) throw new Error("Provider not found");
  if (!service) throw new Error("Service not found");

  const serviceType = await ServiceType.findById(service.serviceTypeId)
    .select("code")
    .lean();

  const generatedCode = `${provider.code}-${service.code}`
    .toUpperCase()
    .replace(/[^A-Z0-9\-]/g, "");

  const discount = await this.discountRepository.upsertByProviderAndService(
    data.providerId,
    data.serviceId,
    {
      name: data.name,
      type: data.type,
      value: data.value,
      cap: data.cap ?? 0,
      active: data.active ?? true,
    },
    {
      code: generatedCode,
      productType: serviceType?.code ?? "general",
    },
  );

  await this.invalidateDiscountCaches(
    discount.providerId.toString(),
    discount.serviceId.toString(),
  );

  return discount;
}

async setDiscountActiveByProviderAndService(
  providerId: string,
  serviceId: string,
  active: boolean,
) {
  const discount = await this.discountRepository.setActiveByProviderAndService(
    providerId,
    serviceId,
    active,
  );
  if (discount) {
    await this.invalidateAllDiscountRelatedCaches(providerId, serviceId);
  }
  return discount;
}
}
