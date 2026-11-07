import { Request, Response, NextFunction } from "express";
import { DiscountService } from "@/services/admin/finances/DiscountService";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";

export class DiscountController {
  private discountService: DiscountService;

  constructor() {
    this.discountService = AdminServiceContainer.getDiscountService();
  }

  listDiscounts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        page = 1,
        limit = 20,
        serviceId,
        providerId,
        status,
        code,
      } = req.query;
      const result = await this.discountService.listDiscounts(
        Number(page),
        Number(limit),
        { serviceId, providerId, status, code }
      );

      sendPaginatedResponse(
        res,
        result.discounts,
        { total: result.total, page: Number(page), limit: Number(limit) },
        "Discounts retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.discountService.createDiscount(req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getDiscountDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const discount = await this.discountService.getDiscountDetails(id);
      sendSuccessResponse(
        res,
        discount,
        "Dicount Details Fetched Successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.discountService.updateDiscount(id, req.body);
      sendSuccessResponse(res, result, "Discount Updated Suceessfully");
    } catch (error) {
      next(error);
    }
  };

  deleteDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.discountService.deleteDiscount(id);
      sendSuccessResponse(res, null, "Discount Deleted Successfully");
    } catch (error) {
      next(error);
    }
  };
  bulkUpdateDiscounts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, data } = req.body;
      const result = await this.discountService.bulkUpdateDiscounts(ids, data);
      sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
}
