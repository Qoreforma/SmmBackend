import {
  FAQRepository,
  FaqCategoryRepository,
} from "@/repositories/shared/FAQRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";

export class FAQService {
  constructor(
    private faqRepository: FAQRepository,
    private faqCategoryRepository: FaqCategoryRepository
  ) {}

  // Get all FAQs with pagination
  async getAllFAQs(page: number = 1, limit: number = 50): Promise<any> {
    const result = await this.faqRepository.findWithPagination(
      { isActive: true },
      page,
      limit
    );

    return {
      data: result.data,
      total: result.total,
      page,
      limit,
    };
  }

  // Get all FAQ categories
  async getAllCategories(): Promise<any> {
    const categories = await this.faqCategoryRepository.find({
      isActive: true,
    });
    return categories;
  }

  // Get FAQs by category slug
  async getFAQsByCategory(categorySlug: string): Promise<any> {
    const category = await this.faqCategoryRepository.findBySlug(categorySlug);

    if (!category) {
      throw new AppError(
        "Category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    const faqs = await this.faqRepository.find({
      faqCategoryId: category._id,
      isActive: true,
    });

    return {
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
      },
      faqs,
    };
  }

  // Search FAQs
  async searchFAQs(
    query: string,
    page: number = 1,
    limit: number = 50
  ): Promise<any> {
    if (!query || query.trim().length === 0) {
      throw new AppError(
        "Search query is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const result = await this.faqRepository.searchFAQs(query, page, limit);

    return {
      data: result.data,
      total: result.total,
      page,
      limit,
    };
  }

  // Get single FAQ by slug
  async getFAQBySlug(slug: string) {
    try {
      const faq = await this.faqRepository.findBySlug(slug);

      if (!faq) {
        throw new AppError(
          "FAQ not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND
        );
      }

      return faq;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Error fetching FAQ by slug:", error);
      throw new AppError(
        "Failed to fetch FAQ",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  async getFAQById(id: string) {
    try {
      const faq = await this.faqRepository.findById(id);

      if (!faq) {
        throw new AppError(
          "FAQ not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND
        );
      }

      return faq;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Error fetching FAQ by id:", error);
      throw new AppError(
        "Failed to fetch FAQ",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
