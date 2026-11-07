import { Request, Response, NextFunction } from "express";
import { UserTier } from "@/models/billing/fees/UserTier";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { AppError } from "@/middlewares/shared/errorHandler";
import ServiceContainer from "@/services/client/container";

export class UserTierController {
  // 1. List all Tiers
  listTiers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tiers = await UserTier.find().sort({ priority: 1, minMonthlySpend: 1 }).lean();
      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: tiers,
      });
    } catch (error) {
      next(error);
    }
  };

  // 2. Create Tier
  createTier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, code, description, badge, minMonthlySpend, discountPercentage, priority, isActive } = req.body;

      if (!name || !code) {
        throw new AppError("Name and code are required", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }

      const existing = await UserTier.findOne({ code: code.toLowerCase().trim() });
      if (existing) {
        throw new AppError(`Tier with code '${code}' already exists`, HTTP_STATUS.CONFLICT, ERROR_CODES.DUPLICATE_ENTRY);
      }

      const tier = await UserTier.create({
        name,
        code: code.toLowerCase().trim(),
        description,
        badge: badge || "Bronze",
        minMonthlySpend: minMonthlySpend !== undefined ? Number(minMonthlySpend) : 0,
        discountPercentage: discountPercentage !== undefined ? Number(discountPercentage) : 0,
        priority: priority !== undefined ? Number(priority) : 1,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      });

      return res.status(HTTP_STATUS.CREATED).json({
        status: "success",
        message: "User tier created successfully",
        data: tier,
      });
    } catch (error) {
      next(error);
    }
  };

  // 3. Get Tier by ID
  getTier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const tier = await UserTier.findById(id).lean();
      if (!tier) {
        throw new AppError("User tier not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
      }
      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        data: tier,
      });
    } catch (error) {
      next(error);
    }
  };

  // 4. Update Tier
  updateTier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      if (updates.code) {
        updates.code = updates.code.toLowerCase().trim();
      }

      const tier = await UserTier.findByIdAndUpdate(id, updates, { new: true });
      if (!tier) {
        throw new AppError("User tier not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
      }

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "User tier updated successfully",
        data: tier,
      });
    } catch (error) {
      next(error);
    }
  };

  // 5. Delete Tier
  deleteTier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const tier = await UserTier.findByIdAndDelete(id);
      if (!tier) {
        throw new AppError("User tier not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
      }
      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "User tier deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  };

  // 6. Batch Evaluate All Active Users
  evaluateAllUserTiers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const progressionService = ServiceContainer.getUserTierProgressionService();
      const limit = req.query.limit ? Number(req.query.limit) : 500;
      const result = await progressionService.evaluateAllActiveUsers(limit);

      return res.status(HTTP_STATUS.OK).json({
        status: "success",
        message: "User tiers evaluated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}
