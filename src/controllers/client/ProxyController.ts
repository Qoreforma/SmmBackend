import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { ProxyService } from "@/services/client/ProxyService";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class ProxyController {
  private proxyService: ProxyService;

  constructor() {
    this.proxyService = ServiceContainer.getProxyService();
  }

  getCatalog = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const catalog = await this.proxyService.getCatalog();
      return sendSuccessResponse(res, catalog, "Proxy catalog retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  buyProxy = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { product, plan, quantity, location, channel } = req.body;
      const result = await this.proxyService.buyProxy({
        userId: req.user!.id,
        product,
        plan,
        quantity: Number(quantity),
        location,
        channel,
      });
      return sendSuccessResponse(res, result, "Proxies purchased successfully");
    } catch (error) {
      next(error);
    }
  };
}
