import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { WalletService } from "./wallet/WalletService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import { CacheService } from "../core/CacheService";
import { Types } from "mongoose";
import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";
import path from "path";
import logger from "@/logger";

export class ReferralService {
  constructor(
    private referralRepository: ReferralRepository,
    private userRepository: UserRepository,
    private walletService: WalletService,
    private cacheService: CacheService,
    private referralTermsRepository: ReferralTermsRepository,
  ) {}

  async getReferralStats(userId: string) {
    const totalReferrals = await this.referralRepository.countByUserId(userId);
    const totalEarnings =
      await this.referralRepository.getTotalEarnings(userId);
    const paidEarnings = await this.referralRepository.getPaidEarnings(userId);
    const unpaidEarnings =
      await this.referralRepository.getUnpaidEarnings(userId);

    const referrals = await this.referralRepository.findByUserId(userId);

    return {
      totalReferrals,
      totalEarnings,
      paidEarnings,
      unpaidEarnings,
      referrals,
    };
  }

  async getReferredUsers(userId: string, page: number = 1, limit: number = 10) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }
    const referrals = await this.referralRepository.findWithPagination(
      {
        refereeId: new Types.ObjectId(userId),
      },
      page,
      limit,
      undefined,
      [
        {
          path: "referredId",
          select:
            "email firstname lastname username avatar country status createdAt",
        },
      ],
    );

    let totalReferralBonusEarned = 0;

    const dataWithTotals = referrals.data.map((referral) => {
      // Calculate total paid bonuses for this referral
      const totalAmount = referral.bonusMilestones
        .filter((milestone) => milestone.status === "paid")
        .reduce((sum, milestone) => sum + milestone.bonusAmount, 0);

      // Add to overall total
      totalReferralBonusEarned += totalAmount;

      return {
        ...(referral.toObject ? referral.toObject() : referral),
        totalAmount,
      };
    });

    const data = [
      {
        referrals: dataWithTotals,
        totalReferralBonusEarned,
        totalReferrals: referrals.total,
        refCode: user.refCode,
      },
    ];

    return {
      data,
      total: referrals.total,
    };
  }

  async getReferralUpline(userId: string) {
    const upline = await this.referralRepository.findOne(
      { referredId: new Types.ObjectId(userId) },
      undefined,
      [
        {
          path: "refereeId",
          select:
            "email firstname lastname username avatar country status createdAt",
        },
      ],
    );
    return upline;
  }

  async getReferralEarnings(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const referrals = await this.referralRepository.findByUserId(userId);

    const skip = (page - 1) * limit;

    // Transform referrals to earnings format
    const earnings = referrals.slice(skip, skip + limit).map((r) => {
      // Calculate total earned from milestones
      const milestoneEarnings =
        r.bonusMilestones?.reduce((sum, m) => sum + m.bonusAmount, 0) || 0;

      // Add new influencer rule bonuses
      const influencerRuleEarning = r.influencerBonuses?.reduce((sum, b) => sum + b.amount, 0) || 0;
      
      const totalEarned = milestoneEarnings + influencerRuleEarning;

      // Calculate paid amount
      const paidMilestones =
        r.bonusMilestones
          ?.filter((m) => m.status === "paid")
          .reduce((sum, m) => sum + m.bonusAmount, 0) || 0;
      const paidInfluencerRules =
        r.influencerBonuses
          ?.filter((b) => b.status === "paid")
          .reduce((sum, b) => sum + b.amount, 0) || 0;
          
      const totalPaid = paidMilestones + paidInfluencerRules;

      return {
        id: r._id,
        refereeId: r.refereeId,
        referredId: r.referredId,
        amount: totalEarned,
        paid: totalPaid,
        createdAt: r.createdAt,
      };
    });

    return {
      data: earnings,
      total: referrals.length,
    };
  }

  async getReferralTerms() {
    // Check cache first
    const cached = await this.cacheService.get(CACHE_KEYS.REFERRAL_TERMS);
    if (cached) {
      return cached;
    }

    const terms = await this.referralTermsRepository.find();

    if (terms.length > 0) {
      await this.cacheService.set(
        CACHE_KEYS.REFERRAL_TERMS,
        terms[0],
        CACHE_TTL.ONE_HOUR,
      );
      return terms;
    }

    return null;
  }

  // Legacy method - kept for backward compatibility
  // Note: This logic is now handled by ReferralBonusService cron jobs
  async processReferralCommission(
    refereeId: string,
    transactionAmount: number,
  ) {
    // This method is deprecated and should not be used
    // Referral processing is now handled by:
    // 1. ReferralBonusService.processPendingReferrals() (for regular users)
    // 2. ReferralBonusService.handleKYCCompletion() (for influencers)

    logger.warn(
      "processReferralCommission is deprecated. Use ReferralBonusService instead.",
    );
    return;
  }
}
