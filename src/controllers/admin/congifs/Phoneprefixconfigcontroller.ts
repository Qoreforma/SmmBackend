import { Response, NextFunction } from "express";
import { sendSuccessResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { PhonePrefixConfigService } from "@/services/admin/configs/Phoneprefixconfigservice";

export class PhonePrefixConfigController {
  constructor(private phonePrefixConfigService: PhonePrefixConfigService) {}

  getConfig = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const config = await this.phonePrefixConfigService.getConfig();
      return sendSuccessResponse(
        res,
        config,
        "Phone prefix config retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  replacePrefixes = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { prefixes } = req.body;

      const config = await this.phonePrefixConfigService.replacePrefixes(
        prefixes,
        adminId,
      );
      return sendSuccessResponse(
        res,
        config,
        "Phone prefix config replaced successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  addPrefix = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { prefix, network } = req.body;

      const config = await this.phonePrefixConfigService.addPrefix(
        { prefix, network },
        adminId,
      );
      return sendSuccessResponse(res, config, "Prefix added successfully");
    } catch (error) {
      next(error);
    }
  };

  removePrefix = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { prefix } = req.params;

      const config = await this.phonePrefixConfigService.removePrefix(
        prefix,
        adminId,
      );
      return sendSuccessResponse(res, config, "Prefix removed successfully");
    } catch (error) {
      next(error);
    }
  };

  updatePrefix = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { prefix } = req.params;
      const { network } = req.body;

      const config = await this.phonePrefixConfigService.updatePrefix(
        prefix,
        network,
        adminId,
      );
      return sendSuccessResponse(res, config, "Prefix updated successfully");
    } catch (error) {
      next(error);
    }
  };

  resetDefaults = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const adminId = req.admin!.adminId;
      const { confirm } = req.body;

      const config = await this.phonePrefixConfigService.resetToDefaults(
        adminId,
        confirm,
      );
      return sendSuccessResponse(
        res,
        config,
        "Phone prefix config reset to defaults",
      );
    } catch (error) {
      next(error);
    }
  };
}
