import { Types } from "mongoose";
import { User, IUser } from "@/models/core/User";
import { UserTier, IUserTier } from "@/models/billing/fees/UserTier";
import { Transaction } from "@/models/wallet/Transaction";
import { CacheService } from "@/services/core/CacheService";
import { NotificationService } from "./notifications/NotificationService";
import { CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";

export interface TierSummaryResponse {
  currentTier: {
    name: string;
    code: string;
    badge?: string;
    discountPercentage: number;
    minMonthlySpend: number;
    priority: number;
  };
  isTierLocked: boolean;
  monthlySpend: number;
  nextTier: {
    name: string;
    code: string;
    badge?: string;
    discountPercentage: number;
    minMonthlySpend: number;
  } | null;
  remainingSpendForNextTier: number;
  progressPercentage: number;
  availableTiers: Partial<IUserTier>[];
}

export class UserTierProgressionService {
  constructor(
    private cacheService: CacheService,
    private notificationService?: NotificationService,
  ) {}

  /**
   * 1. Calculate user's total successful spending over the past 30 rolling days
   */
  async calculateMonthlySpend(userId: string | Types.ObjectId): Promise<number> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "success",
          direction: "DEBIT",
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalSpend: { $sum: "$amount" },
        },
      },
    ]);

    return result.length > 0 ? Math.round(result[0].totalSpend * 100) / 100 : 0;
  }

  /**
   * 2. Evaluate and promote/adjust user tier based on monthly spending
   */
  async evaluateAndPromoteUser(
    userId: string | Types.ObjectId,
  ): Promise<{
    currentTier: string;
    previousTier: string;
    upgraded: boolean;
    spend: number;
  }> {
    const user = await User.findById(userId);
    if (!user) {
      return { currentTier: "regular", previousTier: "regular", upgraded: false, spend: 0 };
    }

    const monthlySpend = await this.calculateMonthlySpend(user._id);
    const activeTiers = await UserTier.find({ isActive: true })
      .sort({ minMonthlySpend: -1, priority: -1 })
      .lean();

    if (activeTiers.length === 0) {
      return {
        currentTier: user.tierCode || "regular",
        previousTier: user.tierCode || "regular",
        upgraded: false,
        spend: monthlySpend,
      };
    }

    // Determine eligible tier based on spend
    const eligibleTier = activeTiers.find((t) => monthlySpend >= t.minMonthlySpend) || {
      code: "regular",
      priority: 0,
      name: "Regular",
      discountPercentage: 0,
    };

    const previousTierCode = (user.tierCode || "regular").toLowerCase().trim();
    const currentTierDoc = activeTiers.find((t) => t.code.toLowerCase() === previousTierCode);
    const currentTierPriority = currentTierDoc ? currentTierDoc.priority : 0;

    // If user's tier was manually locked by an admin, do not downgrade
    if (user.isTierLocked && eligibleTier.priority < currentTierPriority) {
      return {
        currentTier: previousTierCode,
        previousTier: previousTierCode,
        upgraded: false,
        spend: monthlySpend,
      };
    }

    // Check if upgraded to a higher tier
    const isUpgrade = eligibleTier.priority > currentTierPriority;
    const tierChanged = eligibleTier.code.toLowerCase() !== previousTierCode;

    if (tierChanged) {
      user.tierCode = eligibleTier.code.toLowerCase();
      await user.save();

      // Invalidate relevant caches
      await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(user._id.toString()));
      await this.cacheService.delete(`tier:${user._id.toString()}`);

      logger.info(
        `User ${user.email} (${user._id}) tier updated from ${previousTierCode} to ${eligibleTier.code} (Spend: ₦${monthlySpend})`,
      );

      // Send celebratory in-app notification if upgraded
      if (isUpgrade && this.notificationService) {
        try {
          await this.notificationService.createNotification({
            type: "announcement",
            notifiableType: "User",
            notifiableId: user._id as Types.ObjectId,
            title: `🌟 Tier Upgraded: ${eligibleTier.name}!`,
            message: `Congratulations ${user.firstname}! Your 30-day activity qualified you for the ${eligibleTier.name} tier with ${eligibleTier.discountPercentage}% discount on all services!`,
            sendPush: true,
          });
        } catch (notifErr) {
          logger.error("Failed to send tier upgrade notification:", notifErr);
        }
      }
    }

    return {
      currentTier: user.tierCode || "regular",
      previousTier: previousTierCode,
      upgraded: isUpgrade,
      spend: monthlySpend,
    };
  }

  /**
   * 3. Get comprehensive user tier summary for client dashboard
   */
  async getUserTierSummary(userId: string | Types.ObjectId): Promise<TierSummaryResponse> {
    const user = await User.findById(userId).lean();
    const currentTierCode = (user?.tierCode || "regular").toLowerCase().trim();

    // Evaluate in background if not locked
    const monthlySpend = await this.calculateMonthlySpend(userId);

    const activeTiers = await UserTier.find({ isActive: true })
      .sort({ priority: 1, minMonthlySpend: 1 })
      .lean();

    const currentTier = activeTiers.find((t) => t.code.toLowerCase() === currentTierCode);

    // Find next tier in line
    const nextTier = activeTiers.find(
      (t) =>
        t.priority > (currentTier?.priority || 0) &&
        t.minMonthlySpend > monthlySpend,
    ) || null;

    const remainingSpendForNextTier = nextTier
      ? Math.max(0, Math.round((nextTier.minMonthlySpend - monthlySpend) * 100) / 100)
      : 0;

    const progressPercentage = nextTier
      ? Math.min(100, Math.max(0, Math.round((monthlySpend / nextTier.minMonthlySpend) * 100)))
      : 100;

    return {
      currentTier: currentTier
        ? {
            name: currentTier.name,
            code: currentTier.code,
            badge: currentTier.badge,
            discountPercentage: currentTier.discountPercentage,
            minMonthlySpend: currentTier.minMonthlySpend,
            priority: currentTier.priority,
          }
        : {
            name: "Regular",
            code: "regular",
            badge: "Bronze",
            discountPercentage: 0,
            minMonthlySpend: 0,
            priority: 0,
          },
      isTierLocked: Boolean(user?.isTierLocked),
      monthlySpend,
      nextTier: nextTier
        ? {
            name: nextTier.name,
            code: nextTier.code,
            badge: nextTier.badge,
            discountPercentage: nextTier.discountPercentage,
            minMonthlySpend: nextTier.minMonthlySpend,
          }
        : null,
      remainingSpendForNextTier,
      progressPercentage,
      availableTiers: activeTiers.map((t) => ({
        name: t.name,
        code: t.code,
        badge: t.badge,
        description: t.description,
        minMonthlySpend: t.minMonthlySpend,
        discountPercentage: t.discountPercentage,
        priority: t.priority,
      })),
    };
  }

  /**
   * 4. Batch evaluate active users (for admin or periodic cron)
   */
  async evaluateAllActiveUsers(limit: number = 500): Promise<{
    totalProcessed: number;
    upgradedCount: number;
  }> {
    const activeUsers = await User.find({ status: "active" })
      .select("_id tierCode isTierLocked email firstname")
      .limit(limit)
      .lean();

    let upgradedCount = 0;

    for (const u of activeUsers) {
      try {
        const result = await this.evaluateAndPromoteUser(u._id);
        if (result.upgraded) {
          upgradedCount++;
        }
      } catch (err) {
        logger.error(`Error evaluating tier for user ${u._id}:`, err);
      }
    }

    return {
      totalProcessed: activeUsers.length,
      upgradedCount,
    };
  }
}
