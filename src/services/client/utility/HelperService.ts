import logger from "@/logger";
import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { UserTier, IUserTier } from "@/models/billing/fees/UserTier";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { CACHE_KEYS, CACHE_TTL, STAMP_DUTY } from "@/utils/constants";
import { roundAmount, calculatePercentage, addAmounts } from "@/utils/helpers";
import { CacheService } from "@/services/core/CacheService";
export class HelperService {
  constructor(
    private cacheService: CacheService,
    private serviceChargeRepository: ServiceChargeRepository,
  ) {}
  async getServiceChargeCached(
    transactionType: string,
  ): Promise<IServiceCharge | null> {
    const cacheKey = CACHE_KEYS.SERVICE_CHARGE_BY_CODE(transactionType);

    // Try cache first
    const cached = await this.cacheService.get<IServiceCharge>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from DB
    const serviceCharge =
      await this.serviceChargeRepository.findByCode(transactionType);

    if (serviceCharge) {
      this.cacheService
        .set(cacheKey, serviceCharge, CACHE_TTL.SERVICE_CHARGE)
        .catch((err) => logger.error("Failed to cache service charge:", err));
    }

    return serviceCharge;
  }

  async getUserTierCached(tierCode?: string): Promise<IUserTier | null> {
    if (!tierCode || tierCode.toLowerCase() === "regular") return null;
    const cacheKey = `tier:${tierCode.toLowerCase()}`;
    const cached = await this.cacheService.get<IUserTier>(cacheKey);
    if (cached) return cached;

    const tier = await UserTier.findOne({
      code: tierCode.toLowerCase(),
      isActive: true,
    }).lean<IUserTier>();

    if (tier) {
      await this.cacheService.set(cacheKey, tier, CACHE_TTL.ONE_HOUR);
    }
    return tier;
  }

  async calculateAmountWithCharge(
    baseAmount: number,
    transactionType: string,
    userTierCode?: string,
  ): Promise<{
    baseAmount: number;
    chargeAmount: number;
    originalChargeAmount: number;
    tierDiscountAmount: number;
    tierDiscountPercent: number;
    totalAmount: number;
    serviceCharge: IServiceCharge | null;
    isCapped: boolean;
  }> {
    const normalizedBase = roundAmount(baseAmount);

    const serviceCharge = await this.getServiceChargeCached(transactionType);

    let chargeAmount = 0;
    let isCapped = false;

    if (serviceCharge) {
      if (serviceCharge.type === "percentage") {
        chargeAmount = calculatePercentage(normalizedBase, serviceCharge.value);
        if (serviceCharge.cap > 0) {
          if (chargeAmount > serviceCharge.cap) {
            isCapped = true;
          }
          chargeAmount = Math.min(chargeAmount, serviceCharge.cap);
        }

        logger.debug(`Calculated percentage charge:`, {
          baseAmount: normalizedBase,
          percentage: serviceCharge.value,
          chargeAmount,
          cap: serviceCharge.cap,
        });
      } else {
        chargeAmount = roundAmount(serviceCharge.value);

        logger.debug(`Applied flat charge:`, {
          baseAmount: normalizedBase,
          flatCharge: serviceCharge.value,
          chargeAmount,
        });
      }
    } else {
      logger.info(`No service charge configured for: ${transactionType}`, {
        baseAmount: normalizedBase,
        transactionType,
      });
    }

    // Apply Admin-configured Tier Discount (If 0 or inactive, has 0 effect)
    let tierDiscountAmount = 0;
    let appliedTierDiscountPercent = 0;

    if (userTierCode) {
      const tier = await this.getUserTierCached(userTierCode);
      if (tier && tier.isActive && tier.discountPercentage > 0) {
        appliedTierDiscountPercent = tier.discountPercentage;
        const discountBasis = chargeAmount > 0 ? chargeAmount : normalizedBase;
        tierDiscountAmount = roundAmount((discountBasis * tier.discountPercentage) / 100);
      }
    }

    const netChargeAmount = Math.max(0, chargeAmount - tierDiscountAmount);
    const totalAmount = addAmounts(normalizedBase, netChargeAmount);

    return {
      baseAmount: normalizedBase,
      chargeAmount: netChargeAmount,
      originalChargeAmount: chargeAmount,
      tierDiscountAmount,
      tierDiscountPercent: appliedTierDiscountPercent,
      totalAmount,
      serviceCharge,
      isCapped,
    };
  }

  async calculateStampDuty(baseAmount: number): Promise<{
    stampDutyAmount: number;
    applied: boolean;
    isCapped: boolean;
  }> {
    const normalizedBase = roundAmount(baseAmount);

    if (normalizedBase < STAMP_DUTY.WITHDRAWAL_THRESHOLD) {
      return { stampDutyAmount: 0, applied: false, isCapped: false };
    }

    const stampDutyCharge = await this.getServiceChargeCached(
      STAMP_DUTY.SERVICE_CHARGE_CODE,
    );

    let stampDutyAmount = STAMP_DUTY.DEFAULT_AMOUNT;
    let isCapped = false;

    if (stampDutyCharge) {
      if (stampDutyCharge.type === "percentage") {
        stampDutyAmount = calculatePercentage(normalizedBase, stampDutyCharge.value);
        if (stampDutyCharge.cap > 0) {
          if (stampDutyAmount > stampDutyCharge.cap) {
            isCapped = true;
          }
          stampDutyAmount = Math.min(stampDutyAmount, stampDutyCharge.cap);
        }
      } else {
        stampDutyAmount = roundAmount(stampDutyCharge.value);
      }
    } else {
      logger.info(
        `No stamp duty ServiceCharge configured (code: ${STAMP_DUTY.SERVICE_CHARGE_CODE}), using default ₦${STAMP_DUTY.DEFAULT_AMOUNT}`,
        { baseAmount: normalizedBase },
      );
    }

    logger.debug(`Calculated stamp duty:`, {
      baseAmount: normalizedBase,
      stampDutyAmount,
    });

    return { stampDutyAmount, applied: true, isCapped };
  }


  applyRate(
    baseAmount: number,
    rule: { type: "flat" | "percentage"; value: number; cap?: number } | null,
  ): {
    newAmount: number;
    amountDifference: number;
    isCapped: boolean;
  } {
    if (!rule) {
      return { newAmount: baseAmount, amountDifference: 0, isCapped: false };
    }

    let amountDifference = 0;

    let isCapped = false;

    if (rule.type === "percentage") {
      amountDifference = calculatePercentage(baseAmount, rule.value);
      if (rule.cap && rule.cap > 0) {
        if (amountDifference > rule.cap) {
          isCapped = true;
        }
        amountDifference = Math.min(amountDifference, rule.cap);
      }
    } else {
      amountDifference = roundAmount(rule.value);
    }

    amountDifference = Math.min(amountDifference, baseAmount);

    const newAmount = baseAmount - amountDifference;

    return { newAmount, amountDifference, isCapped };
  }
  applyDiscount(
    discount: any | null,
    baseAmount: number,
  ): {
    discountedAmount: number;
    amountSaved: number;
    isCapped: boolean;
  } {
    if (!discount) {
      return { discountedAmount: baseAmount, amountSaved: 0, isCapped: false };
    }
    let amountSaved = 0;
    let isCapped = false;
    if (discount.type === "percentage") {
      amountSaved = (baseAmount * discount.value) / 100;
      if (discount.cap && discount.cap > 0) {
        if (amountSaved > discount.cap) {
          isCapped = true;
        }
        amountSaved = Math.min(amountSaved, discount.cap);
      }
    } else if (discount.type === "flat") {
      amountSaved = discount.value;
    }
    const discountedAmount = baseAmount - amountSaved;
    return { discountedAmount, amountSaved, isCapped };
  }
}
