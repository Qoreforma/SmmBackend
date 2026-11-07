import { Request, Response, NextFunction } from "express";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";
import { PricingRuleService } from "@/services/admin/finances/PricingRuleService";

export class PricingRuleController {
  private pricingRuleService: PricingRuleService;

  constructor() {
    this.pricingRuleService = AdminServiceContainer.getPricingRuleService();
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, providerId, serviceId, status } = req.query;
      const result = await this.pricingRuleService.listPricingRules(
        Number(page),
        Number(limit),
        { providerId, serviceId, status } as any,
      );
      sendPaginatedResponse(
        res,
        result.rows,
        { total: result.total, page: Number(page), limit: Number(limit) },
        "Pricing rules retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  bulkUpsert = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = req.body;
      const result = await this.pricingRuleService.bulkUpsertPricingRules(rows);
      sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  getOne = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId, serviceId } = req.params;
      const rule = await this.pricingRuleService.getPricingRule(
        providerId,
        serviceId,
      );
      if (!rule) {
        res
          .status(404)
          .json({ success: false, message: "Pricing rule not found" });
        return;
      }
      sendSuccessResponse(res, rule, "Pricing rule retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  updateOne = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId, serviceId } = req.params;
      const rule = await this.pricingRuleService.upsertPricingRule({
        providerId,
        serviceId,
        ...req.body,
      });
      sendSuccessResponse(res, rule, "Pricing rule updated successfully");
    } catch (error) {
      next(error);
    }
  };

  setStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId, serviceId } = req.params;
      const rule = await this.pricingRuleService.setPricingRuleStatus(
        providerId,
        serviceId,
        Boolean(req.body.active),
      );
      sendSuccessResponse(res, rule, "Pricing rule status updated");
    } catch (error) {
      next(error);
    }
  };
}
