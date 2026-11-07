import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { User } from "@/models/core/User";
import { DailyStreakSetting } from "@/models/system/DailyStreakSetting";
import ServiceContainer from "@/services/client/container";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { AppError } from "@/middlewares/shared/errorHandler";
import { Types } from "mongoose";

export class RewardController {
  // GET /api/v1/client/rewards/daily-streak
  getStreakStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const user = await User.findById(userId).select("lastStreakClaimAt streakCount").lean();
      const setting = await DailyStreakSetting.findOne().lean();

      const isEnabled = Boolean(setting && setting.isEnabled && setting.rewardAmount > 0);
      const rewardAmount = isEnabled ? setting!.rewardAmount : 0;

      let canClaimToday = false;
      let streakCount = user?.streakCount || 0;

      if (isEnabled) {
        if (!user?.lastStreakClaimAt) {
          canClaimToday = true;
        } else {
          const lastClaim = new Date(user.lastStreakClaimAt);
          const now = new Date();

          // Compare year, month, date in UTC
          const isSameDay =
            lastClaim.getUTCFullYear() === now.getUTCFullYear() &&
            lastClaim.getUTCMonth() === now.getUTCMonth() &&
            lastClaim.getUTCDate() === now.getUTCDate();

          canClaimToday = !isSameDay;
        }
      }

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: {
          isEnabled,
          rewardAmount,
          streakCount,
          canClaimToday,
          lastStreakClaimAt: user?.lastStreakClaimAt || null,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/v1/client/rewards/daily-streak/claim
  claimDailyStreak = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const setting = await DailyStreakSetting.findOne().lean();

      // Rule: If disabled or set to 0, completely inactive / reject
      if (!setting || !setting.isEnabled || setting.rewardAmount <= 0) {
        throw new AppError(
          "Daily streak rewards are currently inactive or disabled",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new AppError("User not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
      }

      const now = new Date();
      let newStreakCount = 1;

      if (user.lastStreakClaimAt) {
        const lastClaim = new Date(user.lastStreakClaimAt);

        // Check if already claimed today
        const isSameDay =
          lastClaim.getUTCFullYear() === now.getUTCFullYear() &&
          lastClaim.getUTCMonth() === now.getUTCMonth() &&
          lastClaim.getUTCDate() === now.getUTCDate();

        if (isSameDay) {
          throw new AppError(
            "You have already claimed your streak reward today. Come back tomorrow!",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // Check if claimed yesterday (consecutive day)
        const diffMs = now.getTime() - lastClaim.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours <= 48) {
          newStreakCount = (user.streakCount || 0) + 1;
        } else {
          newStreakCount = 1; // Streak reset
        }
      }

      const todayString = now.toISOString().split("T")[0];
      const idempotencyKey = `STREAK-${userId}-${todayString}`;

      // Credit wallet with reward amount
      const walletService = ServiceContainer.getWalletService();
      await walletService.creditWallet(
        userId,
        setting.rewardAmount,
        `Daily Streak Reward (Day ${newStreakCount})`,
        {
          type: "daily_streak_reward",
          idempotencyKey,
          initiatedBy: new Types.ObjectId(userId),
          initiatedByType: "system",
          meta: {
            streakCount: newStreakCount,
            rewardAmount: setting.rewardAmount,
          },
        },
      );

      // Update user document
      user.lastStreakClaimAt = now;
      user.streakCount = newStreakCount;
      await user.save();

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: `Claimed ₦${setting.rewardAmount.toLocaleString()} for Day ${newStreakCount} streak!`,
        data: {
          rewardAmount: setting.rewardAmount,
          streakCount: newStreakCount,
          claimedAt: now,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
