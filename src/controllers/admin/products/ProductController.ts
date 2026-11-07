import { Request, Response } from "express";
import { ProductManagementService } from "@/services/admin/products/ProductManagementService";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, PRODUCT_ATTRIBUTES } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class ProductController {
  private productService: ProductManagementService;

  constructor() {
    this.productService = AdminServiceContainer.getProductManagementService()
  }

  listProducts = async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 100, ...filters } = req.query;
      const result = await this.productService.listProducts(
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,
        "Products retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  createProduct = async (req: Request, res: Response) => {
    try {
      const result = await this.productService.createProduct(req.body);
      return sendSuccessResponse(
        res,
        result,
        result.message,
        HTTP_STATUS.CREATED
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getProductDetails = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.productService.getProductDetails(id);
      return sendSuccessResponse(res, result, "Product details retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

  getProductAttributes = async (req: Request, res: Response) => {
    try {
      const result = await this.productService.getProductAttributes();
      return sendSuccessResponse(res, result, "Product attributes retrieved");
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
  };

  getProductTypes = async (req: Request, res: Response) => {
    return sendSuccessResponse(
      res,
      PRODUCT_ATTRIBUTES.PRODUCT_TYPES,
      "Product types retrieved"
    );
  };

  getProductDataTypes = async (req: Request, res: Response) => {
    return sendSuccessResponse(
      res,
      PRODUCT_ATTRIBUTES.DATA_TYPES,
      "Product data types retrieved"
    );
  };

  getProductCategories = async (req: Request, res: Response) => {
    return sendSuccessResponse(
      res,
      PRODUCT_ATTRIBUTES.DATA_CATEGORIES,
      "Product categories retrieved"
    );
  };

  updateProduct = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.productService.updateProduct(id, req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  updateProductStatus = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const result = await this.productService.updateProductStatus(
        id,
        isActive
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  updateProductHotStatus = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isHot } = req.body;
      const result = await this.productService.updateProductHotStatus(
        id,
        isHot
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  bulkUpdateProductStatus = async (req: Request, res: Response) => {
    try {
      const { productIds, isActive } = req.body;
      const result = await this.productService.bulkUpdateProductStatus(
        productIds,
        isActive
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  bulkUpdateProductHotStatus = async (req: Request, res: Response) => {
    try {
      const { productIds, isHot } = req.body;
      const result = await this.productService.bulkUpdateProductHotStatus(
        productIds,
        isHot
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  deleteProduct = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.productService.deleteProduct(id);
      return sendSuccessResponse(res, null, result.message);
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getProductsByServiceType = async (req: Request, res: Response) => {
    try {
      const { serviceTypeId } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.productService.getProductsByServiceType(
        serviceTypeId,
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,
        "Products retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getProductsByService = async (req: Request, res: Response) => {
    try {
      const { serviceId } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.productService.getProductsByService(
        serviceId,
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,
        "Products retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  getProductsByProvider = async (req: Request, res: Response) => {
    try {
      const { providerId } = req.params;
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.productService.getProductsByProvider(
        providerId,
        Number(page),
        Number(limit),
        filters
      );
      return sendSuccessResponse(
        res,
        result,
        "Products retrieved successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
  };

  fetchProviderProducts = async (req: Request, res: Response) => {
    try {
      const { providerId } = req.params;
      const { serviceId } = req.query;

      if (!serviceId) {
        return sendErrorResponse(
          res,
          "serviceId is required",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      const result = await this.productService.fetchProviderProducts(
        providerId,
        serviceId as string
      );
      return sendSuccessResponse(
        res,
        result,
        "Provider products fetched successfully"
      );
    } catch (error: any) {
      return sendErrorResponse(
        res,
        error.message,
        error.statusCode || HTTP_STATUS.BAD_REQUEST
      );
    }
  };
}
