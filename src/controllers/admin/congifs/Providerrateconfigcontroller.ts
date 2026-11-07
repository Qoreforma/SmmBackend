import { Response, NextFunction } from "express";
import { sendSuccessResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ProviderRateConfigService } from "@/services/admin/configs/Providerrateconfigservice";

export class ProviderRateConfigController {
  constructor(
    private providerRateConfigService: ProviderRateConfigService
  ) {}

  listAll = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const configs = await this.providerRateConfigService.listAll();
      return sendSuccessResponse(
        res,
        configs,
        "Provider rate configs retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getByProviderCode = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { providerCode } = req.params;
      const config =
        await this.providerRateConfigService.getByProviderCode(providerCode);
      return sendSuccessResponse(
        res,
        config,
        "Provider rate config retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  upsert = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const config = await this.providerRateConfigService.upsert(
        req.body,
        adminId
      );
      return sendSuccessResponse(
        res,
        config,
        "Provider rate config saved successfully",
        HTTP_STATUS.OK
      );
    } catch (error) {
      next(error);
    }
  };

  updateRates = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { providerId } = req.params;
      const { 
        buyRate, 
        sellRate,
        buyMarkupType,
        buyMarkupValue,
        buyMarkupCap,
        sellMarkupType,
        sellMarkupValue,
        sellMarkupCap
      } = req.body;

      const config = await this.providerRateConfigService.updateRates(
        providerId,
        { buyRate, sellRate },
        { 
          buyMarkupType,
          buyMarkupValue,
          buyMarkupCap,
          sellMarkupType,
          sellMarkupValue,
          sellMarkupCap
        },
        adminId
      );

      return sendSuccessResponse(res, config, "Rates updated successfully");
    } catch (error) {
      next(error);
    }
  };

  toggleActive = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { providerId } = req.params;
      const { isActive } = req.body;

      const config = await this.providerRateConfigService.toggleActive(
        providerId,
        isActive,
        adminId
      );

      return sendSuccessResponse(
        res,
        config,
        `Rate config ${isActive ? "activated" : "deactivated"} successfully`
      );
    } catch (error) {
      next(error);
    }
  };
}