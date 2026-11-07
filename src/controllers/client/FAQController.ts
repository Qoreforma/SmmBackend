import { NextFunction, Response, Request } from "express";
import { FAQService } from "@/services/client/FAQService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";

export class FAQController {
  private faqService: FAQService;

  constructor() {
    this.faqService = ServiceContainer.getFAQService();
  }

  // Get all FAQs with pagination
  getAllFAQs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await this.faqService.getAllFAQs(page, limit);

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page: result.page, limit: result.limit },
        "FAQs retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  // Get all FAQ categories
  getAllCategories = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const categories = await this.faqService.getAllCategories();

      return sendSuccessResponse(
        res,
        categories,
        "FAQ categories retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  // Get FAQs by category slug
  getFAQsByCategory = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { slug } = req.params;

      const result = await this.faqService.getFAQsByCategory(slug);

      return sendSuccessResponse(res, result, "FAQs retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  // Search FAQs
  searchFAQs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await this.faqService.searchFAQs(query, page, limit);

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page: result.page, limit: result.limit },
        "Search results retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  // Get single FAQ by slug
  getFAQBySlug = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;

      const faq = await this.faqService.getFAQBySlug(slug);

      return sendSuccessResponse(res, faq, "FAQ retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getFAQById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const faq = await this.faqService.getFAQById(id);
      return sendSuccessResponse(res, faq, "FAQ retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  
}
