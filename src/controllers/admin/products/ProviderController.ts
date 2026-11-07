import { NextFunction, Request, Response } from "express";
import { ProviderManagementService } from "@/services/admin/products/ProviderManagementService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import logger from "@/logger";
import AdminServiceContainer from "@/services/admin/container";

export class ProviderController {
  private providerService: ProviderManagementService;

  constructor() {
    this.providerService = AdminServiceContainer.getProviderManagementService();
  }

  listProviders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        page = 1,
        limit = 20,
        includeProductCounts,
        ...filters
      } = req.query;

      const includeCounts = includeProductCounts === "true";

      const result = await this.providerService.listProviders(
        Number(page),
        Number(limit),
        filters,
        includeCounts
      );

      return sendPaginatedResponse(
        res,
        result.providers,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Providers retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };

  createProvider = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name,
        logo,
        isActive,
        serviceTypes,
        hasSync,
        usd_ngn_rate,
        usdNgnRate,
        markup_percent,
        markupPercent,
      } = req.body;
      const code = name.replace(/\s+/g, "-").toLowerCase();

      const result = await this.providerService.createProvider(
        name,
        code,
        logo,
        isActive,
        serviceTypes,
        hasSync || false,
        {
          usdNgnRate: usdNgnRate !== undefined ? usdNgnRate : usd_ngn_rate,
          markupPercent: markupPercent !== undefined ? markupPercent : markup_percent,
        },
      );

      return sendSuccessResponse(
        res,
        result.provider,
        result.message,
        HTTP_STATUS.CREATED
      );
    } catch (error: any) {
      next(error);
    }
  };

  getProviderDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { includeProductCounts } = req.query;

      const includeCounts = includeProductCounts === "true";

      const result = await this.providerService.getProviderDetails(
        id,
        includeCounts
      );

      return sendSuccessResponse(res, result, "Provider details retrieved");
    } catch (error: any) {
      next(error);
    }
  };

  updateProvider = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const {
        name,
        logo,
        isActive,
        serviceTypes,
        hasSync,
        usd_ngn_rate,
        usdNgnRate,
        markup_percent,
        markupPercent,
      } = req.body;

      const result = await this.providerService.updateProvider(
        id,
        name,
        logo,
        isActive,
        serviceTypes,
        hasSync,
        {
          usdNgnRate: usdNgnRate !== undefined ? usdNgnRate : usd_ngn_rate,
          markupPercent: markupPercent !== undefined ? markupPercent : markup_percent,
        },
      );

      return sendSuccessResponse(res, result.provider, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  updateProviderStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const result = await this.providerService.updateProviderStatus(
        id,
        isActive
      );

      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  getProviderProducts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const result = await this.providerService.getProviderProducts(
        id,
        Number(page),
        Number(limit)
      );

      return sendPaginatedResponse(
        res,
        result.products,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Provider products retrieved"
      );
    } catch (error: any) {
      next(error);
    }
  };

  toggleProviderServiceType = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { providerId, serviceTypeId } = req.params;
      const { isActive } = req.body;

      const result = await this.providerService.toggleProviderServiceType(
        providerId,
        serviceTypeId,
        isActive
      );

      return sendSuccessResponse(res, result.relationship, result.message);
    } catch (error: any) {
      next(error);
    }
  };

  getProviderServiceTypes = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const result = await this.providerService.getProviderServiceTypes(id);

      return sendSuccessResponse(
        res,
        result,
        "Provider service types retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };


  // Sync provider products
  syncProviderProducts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { serviceTypeId, forceUpdate } = req.body;

      const result = await this.providerService.syncProviderProducts(id, {
        serviceTypeId,
        forceUpdate: forceUpdate || false,
      });



      return sendSuccessResponse(
        res,
        result,
        "Product sync completed successfully",
        HTTP_STATUS.OK
      );
    } catch (error: any) {
      next(error);
    }
  };

  // Delete all products for a provider
  deleteProviderProducts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const result = await this.providerService.deleteProviderProducts(id);

      return sendSuccessResponse(
        res,
        result,
        result.message,
        HTTP_STATUS.OK
      );
    } catch (error: any) {
      next(error);
    }
  };

  // Get product aggregations (Service + Product Type combinations)
  getProviderProductAggregations = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const result = await this.providerService.getProviderProductAggregations(
        id
      );

      return sendSuccessResponse(
        res,
        result,
        "Product aggregations retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };

  // Get products by service and product type
  getProductsByServiceAndType = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id, serviceId, productType } = req.params;
      const { page = 1, limit = 20, isActive, search } = req.query;

      const filters: any = {};
      if (isActive !== undefined) {
        filters.isActive = isActive === "true";
      }
      if (search) {
        filters.search = search;
      }

      const result = await this.providerService.getProductsByServiceAndType(
        id,
        serviceId,
        productType,
        Number(page),
        Number(limit),
        filters
      );

      return sendPaginatedResponse(
        res,
        result.products,
        {
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
        },
        "Products retrieved successfully"
      );
    } catch (error: any) {
      next(error);
    }
  };

  // Toggle products by service and product type
  toggleProductsByServiceAndType = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id, serviceId, productType } = req.params;
      const { isActive } = req.body;

      const result = await this.providerService.toggleProductsByServiceAndType(
        id,
        serviceId,
        productType,
        isActive
      );

      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      next(error);
    }
  };
}
