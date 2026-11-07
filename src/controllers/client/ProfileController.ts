import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { ProfileService } from "@/services/client/core/ProfileService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { User } from "@/models/core/User";
import { UserTier } from "@/models/billing/fees/UserTier";

export class ProfileController {
  private profileService: ProfileService;
  private userTierProgressionService = ServiceContainer.getUserTierProgressionService();
  constructor() {
    this.profileService = ServiceContainer.getProfileService();
  }

  getProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const profile = await this.profileService.getProfile(userId);
      return sendSuccessResponse(
        res,
        profile,
        "Profile retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const profile = await this.profileService.updateProfile(userId, req.body);
      return sendSuccessResponse(res, profile, "Profile updated successfully");
    } catch (error) {
      next(error);
    }
  };

  toogleBiometric = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const { enable, type } = req.body;
      const result = await this.profileService.toogleBiometric(
        userId,
        enable,
        type
      );
      let message;

      if (type === "login") {
        message = enable
          ? "Login biometric authentication enabled"
          : "Login biometric authentication disabled";
      } else if (type === "transaction") {
        message = enable
          ? "Transaction biometric authentication enabled"
          : "Transaction biometric authentication disabled";
      } else {
        message = "Biometric authentication setting updated";
      }
      return sendSuccessResponse(res, result, message);
    } catch (error) {
      next(error);
    }
  };

  deactivateAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      await this.profileService.deactivateAccount(userId);
      return sendSuccessResponse(res, null, "Account deactivated successfully");
    } catch (error) {
      next(error);
    }
  };

  updateAvatar = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const { avatar } = req.body;
      const profile = await this.profileService.updateAvatar(userId, avatar);
      return sendSuccessResponse(res, profile, "Avatar updated successfully");
    } catch (error) {
      next(error);
    }
  };

  getUserTier = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      await this.userTierProgressionService.evaluateAndPromoteUser(userId);
      const summary = await this.userTierProgressionService.getUserTierSummary(userId);

      return sendSuccessResponse(
        res,
        summary,
        "User tier information retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
