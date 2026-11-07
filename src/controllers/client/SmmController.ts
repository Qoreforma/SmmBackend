import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { SmmService } from "@/services/client/SmmService";
import {
  sendSuccessResponse,
  sendPaginatedResponse,
} from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class SmmController {
  private smmService: SmmService;

  constructor() {
    this.smmService = ServiceContainer.getSmmService();
  }

  getProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const providers = await this.smmService.getProviders();
      return sendSuccessResponse(
        res,
        providers,
        "SMM providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getProductTypes = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { serviceCode } = req.params;
      const types = await this.smmService.getProductTypes(serviceCode);
      return sendSuccessResponse(
        res,
        types,
        "SMM product types retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getProducts = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { serviceCode, productType } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 100;

      const result = await this.smmService.getProducts(
        serviceCode,
        productType,
        { page, limit },
      );

      return sendPaginatedResponse(
        res,
        result.products,
        { total: result.total, page, limit },
        "SMM products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  listCatalog = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const category = req.query.category as string;
      const platform = req.query.platform as string;
      const type = req.query.type as string;
      const includeInactive = req.query.includeInactive === "true";

      const result = await this.smmService.listCatalog({
        page,
        limit,
        category,
        platform,
        type,
        includeInactive,
      });

      return sendPaginatedResponse(
        res,
        result.products,
        { total: result.total, page, limit },
        "SMM catalog retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  placeOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        productId,
        link,
        quantity,
        target,
        gender,
        region,
        comments,
        comment_gender,
        comment_instructions,
        duration,
        start_count,
        start_screenshot,
        answer_number,
        usernames,
        runs,
        interval,
        sabiFields,
      } = req.body;
      const channel = req.body?.channel || (req as any).channel || (req.headers["x-channel"] as string) || "web";
      const result = await this.smmService.placeOrder({
        userId: req.user!.id,
        productId,
        link,
        quantity,
        channel,
        target,
        gender,
        region,
        comments,
        comment_gender,
        comment_instructions,
        duration,
        start_count,
        start_screenshot,
        answer_number,
        usernames,
        runs,
        interval,
        sabiFields,
      });

      return sendSuccessResponse(
        res,
        result,
        "SMM order placed successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  refillOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const result = await this.smmService.refillOrder(req.user!.id, reference);
      return sendSuccessResponse(res, result, "Refill request submitted successfully");
    } catch (error) {
      next(error);
    }
  };

  cancelOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const result = await this.smmService.cancelOrder(req.user!.id, reference);
      return sendSuccessResponse(res, result, "Order cancellation submitted successfully");
    } catch (error) {
      next(error);
    }
  };

  getUserOrders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;

      const result = await this.smmService.getUserOrders(req.user!.id, {
        page,
        limit,
        status,
      });

      return sendPaginatedResponse(
        res,
        result.orders,
        { total: result.total, page, limit },
        "SMM orders retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
