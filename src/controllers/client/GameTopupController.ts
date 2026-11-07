import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { GameTopupService } from "@/services/client/GameTopupService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class GameTopupController {
  private gameTopupService: GameTopupService;

  constructor() {
    this.gameTopupService = ServiceContainer.getGameTopupService();
  }

  getGames = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const games = await this.gameTopupService.getGames();
      return sendSuccessResponse(res, games, "Games retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getPackages = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { serviceCode } = req.params;
      const packages = await this.gameTopupService.getPackages(serviceCode);
      return sendSuccessResponse(res, packages, "Packages retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  orderTopup = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const productId = req.body.productId || req.body.packageId;
      const explicitFields = req.body.fields || {};
      
      // Merge any top-level account parameters that frontends might send directly
      const topLevelFields: Record<string, any> = {};
      const knownKeys = [
        "playerId", "player_id", "userId", "user_id",
        "zoneId", "zone_id", "serverId", "server_id",
        "roleId", "role_id",
      ];
      for (const k of knownKeys) {
        if (req.body[k] !== undefined && req.body[k] !== "") {
          topLevelFields[k] = req.body[k];
        }
      }

      const mergedFields = {
        ...topLevelFields,
        ...explicitFields,
      };

      const result = await this.gameTopupService.orderTopup({
        userId: req.user!.id,
        productId,
        fields: mergedFields,
        channel: req.body.channel,
      });
      return sendSuccessResponse(res, result, "Game top-up processed successfully");
    } catch (error) {
      next(error);
    }
  };
}
