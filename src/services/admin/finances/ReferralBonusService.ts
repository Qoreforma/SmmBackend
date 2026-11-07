import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { Types } from "mongoose";
import logger from "@/logger";
import { WalletService } from "../../client/wallet/WalletService";
import { ReferralBonusRepository } from "@/repositories/admin/ReferralBonusRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";

export class ReferralBonusService {
  private transactionRepository: TransactionRepository;

  constructor(
    private referralBonusRepository: ReferralBonusRepository,
    private referralRepository: ReferralRepository,
    private userRepository: UserRepository,
    private walletService: WalletService
  ) {
    this.transactionRepository = new TransactionRepository();
  }

  // CRON JOB: Process pending referrals for REGULAR users only
  async processPendingReferrals(): Promise<{
    processed: number;
    newMilestones: number;
  }> {
    try {
      // Get all REGULAR user referrals
      const regularReferrals = await this.referralRepository.find({
        userType: "regular",
      });

      let newMilestoneCount = 0;

      logger.info(
        `[Referral Cron] Processing ${regularReferrals.length} regular user referrals`
      );

      for (const referral of regularReferrals) {
        const debits = await this.transactionRepository.find({
          sourceId: new Types.ObjectId(referral.referredId.toString()),
          direction: "DEBIT",
          status: "success",
        });
        const totalAmountSpent = debits.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        if (totalAmountSpent <= 0) continue;

        const referrer = await this.userRepository.findById(
          referral.refereeId.toString()
        );
        if (!referrer || referrer.userType !== "regular") continue;

        // Get ALL applicable bonuses for this amount
        const allApplicableBonuses =
          await this.referralBonusRepository.getAllApplicableBonuses(
            "regular",
            totalAmountSpent
          );

        if (!allApplicableBonuses.length) continue;

        // Get already earned bonus config IDs
        const earnedBonusIds = new Set(
          referral.bonusMilestones.map((m) => m.bonusConfigId.toString())
        );

        // Find NEW milestones that haven't been earned yet
        const newBonuses = allApplicableBonuses.filter(
          (bonus) => !earnedBonusIds.has(bonus.id.toString())
        );

        if (!newBonuses.length) continue;

        // Add each new milestone
        for (const bonus of newBonuses) {
          let bonusAmount = 0;

          if (bonus.bonusType === "flat") {
            bonusAmount = bonus.value; // Fixed amount
          } else if (bonus.bonusType === "percentage") {
            bonusAmount = (totalAmountSpent * bonus.value) / 100;
          }

          await this.referralRepository.addMilestone(
            referral.id,
            bonus.id,
            bonusAmount
          );

          newMilestoneCount++;

          logger.info(
            `[Referral Cron] Referral ${referral._id} earned milestone ${bonus.name}: ₦${bonusAmount}`
          );
        }
      }

      return {
        processed: regularReferrals.length,
        newMilestones: newMilestoneCount,
      };
    } catch (error) {
      logger.error(
        "[Referral Cron] Error processing pending referrals:",
        error
      );
      throw error;
    }
  }

  // CRON JOB: Pay earned bonuses (both regular milestones and influencer bonuses)
  async payQualifiedBonuses(): Promise<{
    regularPaid: number;
    influencerPaid: number;
  }> {
    try {
      let regularPaidCount = 0;
      let influencerPaidCount = 0;

      // 1. Pay regular user milestones
      const regularReferrals =
        await this.referralRepository.getRegularReferralsWithUnpaidMilestones();

      logger.info(
        `[Referral Cron] Paying ${regularReferrals.length} regular referrals with unpaid milestones`
      );

      for (const referral of regularReferrals) {
        const unpaidMilestones = referral.bonusMilestones.filter(
          (m) => m.status === "earned"
        );

        if (!unpaidMilestones.length) continue;

        let referredName = "a user";
        try {
          const referredUser = await this.userRepository.findById(referral.referredId.toString());
          if (referredUser) {
            referredName = referredUser.username ? `@${referredUser.username}` : (referredUser.firstname || "a user");
          }
        } catch (err) {
          // fallback to default
        }

        for (const milestone of unpaidMilestones) {
          try {
            const idempotencyKey = `referral-milestone:${referral._id}:${milestone.bonusConfigId}`;

            await this.walletService.creditWallet(
              referral.refereeId.toString(),
              milestone.bonusAmount,
              `Referral Bonus (${referredName})`,
              {
                idempotencyKey,
                initiatedByType: "system",
                meta: {
                  referralId: referral.id.toString(),
                  referredId: referral.referredId.toString(),
                  referredUsername: referredName,
                  bonusConfigId: milestone.bonusConfigId.toString(),
                  logo: "https://ik.imagekit.io/x2ug9v49a/Screenshot_2026-01-06_134046_8_IN5WBUu.png",
                },
                remark: `Referral Milestone Bonus from ${referredName}`,
              }
            );

            await this.referralRepository.markMilestoneAsPaid(
              referral.id,
              milestone.bonusConfigId
            );

            regularPaidCount++;

            logger.info(
              `[Referral Cron] Milestone bonus ₦${milestone.bonusAmount} paid to ${referral.refereeId}`
            );
          } catch (error) {
            logger.error(
              `[Referral Cron] Failed to pay milestone for referral ${referral._id}:`,
              error
            );
            continue;
          }
        }
      }

      // 2. Pay influencer bonuses
      const influencerReferrals =
        await this.referralRepository.getInfluencerReferralsWithUnpaidBonuses();

      logger.info(
        `[Referral Cron] Paying ${influencerReferrals.length} influencer bonuses`
      );

      const ruleFriendlyLabels: Record<string, string> = {
        accountCompletion: "Account Completion",
        firstBillPayment: "First Bill Payment",
        transactionVolume: "Transaction Volume",
        kycCompletion: "KYC Completion",
      };

      for (const referral of influencerReferrals) {
        // Pay new rule-based influencerBonuses
        if (referral.influencerBonuses && referral.influencerBonuses.length > 0) {
          const unpaidBonuses = referral.influencerBonuses.filter(
            (b) => b.status === "earned"
          );

          if (!unpaidBonuses.length) continue;

          let referredName = "a user";
          try {
            const referredUser = await this.userRepository.findById(referral.referredId.toString());
            if (referredUser) {
              referredName = referredUser.username ? `@${referredUser.username}` : (referredUser.firstname || "a user");
            }
          } catch (err) {
            // fallback to default
          }

          for (const bonus of unpaidBonuses) {
            try {
              const idempotencyKey = `influencer-rule-bonus:${referral._id}:${bonus.ruleType}`;
              const ruleLabel = ruleFriendlyLabels[bonus.ruleType] || bonus.ruleType;

              await this.walletService.creditWallet(
                referral.refereeId.toString(),
                bonus.amount,
                `Referral Bonus (${referredName})`,
                {
                  idempotencyKey,
                  initiatedByType: "system",
                  meta: {
                    referralId: referral.id.toString(),
                    referredId: referral.referredId.toString(),
                    referredUsername: referredName,
                    ruleType: bonus.ruleType,
                    logo: "https://ik.imagekit.io/x2ug9v49a/Screenshot_2026-01-06_134046_8_IN5WBUu.png",
                  },
                  remark: `Influencer Referral Bonus (${ruleLabel}) from ${referredName}`,
                }
              );

              await this.referralRepository.markInfluencerRuleBonusAsPaid(
                referral.id,
                bonus.ruleType
              );

              influencerPaidCount++;

              logger.info(
                `[Referral Cron] Influencer rule bonus ₦${bonus.amount} paid to ${referral.refereeId} for rule ${bonus.ruleType}`
              );
            } catch (error) {
              logger.error(
                `[Referral Cron] Failed to pay influencer rule bonus for referral ${referral._id}:`,
                error
              );
            }
          }
        }
      }

      return {
        regularPaid: regularPaidCount,
        influencerPaid: influencerPaidCount,
      };
    } catch (error) {
      logger.error("[Referral Cron] Error paying qualified bonuses:", error);
      throw error;
    }
  }

  // CRON JOB: Process pending referrals for INFLUENCER/MICRO-INFLUENCER users
  async processInfluencerReferrals(): Promise<{ processed: number; newBonuses: number }> {
    try {
      const influencerReferrals = await this.referralRepository.find({
        userType: { $in: ["influencer", "micro-influencer"] },
      });

      let newBonusCount = 0;

      logger.info(`[Referral Cron] Processing ${influencerReferrals.length} influencer referrals`);

      for (const referral of influencerReferrals) {
        const referrer = await this.userRepository.findById(referral.refereeId.toString());
        const referredUser = await this.userRepository.findById(referral.referredId.toString());

        if (!referrer || !referredUser || !referrer.influencerRules || referrer.userType === "regular") continue;

        const rules = referrer.influencerRules;
        const earnedRules = new Set((referral.influencerBonuses || []).map((b) => b.ruleType));

        // Evaluate Account Completion
        if (
          rules.accountCompletion?.isActive &&
          !earnedRules.has("accountCompletion") &&
          referredUser.emailVerifiedAt
        ) {
          await this.referralRepository.addInfluencerRuleBonus(
            referral.id,
            "accountCompletion",
            rules.accountCompletion.rewardAmount
          );
          newBonusCount++;
          logger.info(`[Referral Cron] Referral ${referral._id} earned accountCompletion bonus`);
        }

        // Evaluate KYC Completion
        if (
          rules.kycCompletion?.isActive &&
          !earnedRules.has("kycCompletion") &&
          (referredUser.bvnValidated || referredUser.nin)
        ) {
          await this.referralRepository.addInfluencerRuleBonus(
            referral.id,
            "kycCompletion",
            rules.kycCompletion.rewardAmount
          );
          newBonusCount++;
          logger.info(`[Referral Cron] Referral ${referral._id} earned kycCompletion bonus`);
        }

        // Evaluate First Transaction / Bill Payment
        const hasTransaction = Boolean(
          await this.transactionRepository.findOne({
            sourceId: new Types.ObjectId(referral.referredId.toString()),
            direction: "DEBIT",
            status: "success",
          })
        );

        if (
          rules.firstBillPayment?.isActive &&
          !earnedRules.has("firstBillPayment") &&
          hasTransaction
        ) {
          await this.referralRepository.addInfluencerRuleBonus(
            referral.id,
            "firstBillPayment",
            rules.firstBillPayment.rewardAmount
          );
          newBonusCount++;
          logger.info(`[Referral Cron] Referral ${referral._id} earned firstBillPayment bonus`);
        }

        // Evaluate Transaction Volume (direct sum from transactions)
        const debits = await this.transactionRepository.find({
          sourceId: new Types.ObjectId(referral.referredId.toString()),
          direction: "DEBIT",
          status: "success",
        });
        const totalTraded = debits.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        if (
          rules.transactionVolume?.isActive &&
          !earnedRules.has("transactionVolume") &&
          totalTraded >= (rules.transactionVolume.targetVolume || 0)
        ) {
          await this.referralRepository.addInfluencerRuleBonus(
            referral.id,
            "transactionVolume",
            rules.transactionVolume.rewardAmount
          );
          newBonusCount++;
          logger.info(`[Referral Cron] Referral ${referral._id} earned transactionVolume bonus`);
        }
      }

      return { processed: influencerReferrals.length, newBonuses: newBonusCount };
    } catch (error) {
      logger.error("[Referral Cron] Error processing influencer referrals:", error);
      throw error;
    }
  }


  // Admin: Create bonus config
  async createBonus(data: any, adminId: string): Promise<any> {
    const config = await this.referralBonusRepository.create({
      ...data,
      createdBy: new Types.ObjectId(adminId),
      userType: "regular",
    });

    logger.info(
      `Admin ${adminId} created referral bonus config: ${config._id}`
    );
    return config;
  }

  // Admin: Update bonus config
  async updateBonus(id: string, data: any): Promise<any> {
    const config = await this.referralBonusRepository.update(id, data);
    logger.info(`Referral bonus config ${id} updated`);
    return config;
  }

  // Admin: Get all configs
  async getAllBonus(): Promise<any[]> {
    return await this.referralBonusRepository.find();
  }

  // User: Get referral stats
  async getReferralStats(refereeId: string): Promise<any> {
    const referrals = await this.referralRepository.getReferralsByReferee(
      new Types.ObjectId(refereeId)
    );

    const total = referrals.length;

    // Calculate earnings from milestones and influencer bonuses
    let totalEarned = 0;
    let paidAmount = 0;
    let pendingAmount = 0;

    let qualifiedCount = 0;
    let paidCount = 0;

    for (const referral of referrals) {
      // Regular user milestones
      if (referral.bonusMilestones && referral.bonusMilestones.length > 0) {
        const milestones = referral.bonusMilestones;
        const earnedMilestones = milestones.filter(
          (m) => m.status === "earned"
        );
        const paidMilestones = milestones.filter((m) => m.status === "paid");

        if (paidMilestones.length > 0) paidCount++;
        if (earnedMilestones.length > 0 || paidMilestones.length > 0)
          qualifiedCount++;

        totalEarned += milestones.reduce((sum, m) => sum + m.bonusAmount, 0);
        paidAmount += paidMilestones.reduce((sum, m) => sum + m.bonusAmount, 0);
        pendingAmount += earnedMilestones.reduce(
          (sum, m) => sum + m.bonusAmount,
          0
        );
      }

      // Influencer Rule bonuses
      if (referral.influencerBonuses && referral.influencerBonuses.length > 0) {
        const ruleBonuses = referral.influencerBonuses;
        const earnedRules = ruleBonuses.filter((b) => b.status === "earned");
        const paidRules = ruleBonuses.filter((b) => b.status === "paid");

        if (paidRules.length > 0) paidCount++;
        if (earnedRules.length > 0 || paidRules.length > 0) qualifiedCount++;

        totalEarned += ruleBonuses.reduce((sum, b) => sum + b.amount, 0);
        paidAmount += paidRules.reduce((sum, b) => sum + b.amount, 0);
        pendingAmount += earnedRules.reduce((sum, b) => sum + b.amount, 0);
      }
    }

    const pendingReferrals = total - qualifiedCount;

    return {
      totalReferrals: total,
      qualifiedReferrals: qualifiedCount,
      paidReferrals: paidCount,
      pendingReferrals,
      totalEarned,
      paidAmount,
      pendingAmount,
    };
  }
}
