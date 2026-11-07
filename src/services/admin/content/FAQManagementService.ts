import { FAQ } from "@/models/system/FAQ";
import { FaqCategory } from "@/models/system/FaqCategory";
import {
  FaqCategoryRepository,
  FAQRepository,
} from "@/repositories/shared/FAQRepository";
import { generateUniqueSlug } from "@/utils/helpers";
import mongoose from "mongoose";

export class FAQManagementService {
  constructor(
    private faqRepository: FAQRepository,
    private categoryRepository: FaqCategoryRepository,
  ) {}

  // FAQ Methods
  async listFAQs(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = {};

    if (filters.categoryId) {
      query.faqCategoryId = filters.categoryId;
    }

    if (filters.status) {
      query.isActive = filters.status === "active";
    }

    if (filters.search) {
      query.$or = [
        { question: { $regex: filters.search, $options: "i" } },
        { answer: { $regex: filters.search, $options: "i" } },
      ];
    }

    const result = await this.faqRepository.findWithPagination(
      query,
      page,
      limit,
      undefined,
      [{ path: "faqCategoryId", select: "name isActive" }],
    );

    const data = result.data.map((faq: any) => ({
      ...(faq.toObject?.() ?? faq),
      categoryId: faq.faqCategoryId?._id ?? null,
      categoryName: faq.faqCategoryId?.name ?? null,
      faqCategoryId: undefined,
    }));

    return {
      faqs: data,
      pagination: {
        page,
        limit,
        total: result.total,
      },
    };
  }

  async createFAQ(data: any) {
    // Verify category exists
    const category = await this.categoryRepository.findById(data.faqCategoryId);
    if (!category) {
      throw new Error("FAQ category not found");
    }

    if (!data.slug) {
      data.slug = await generateUniqueSlug(FAQ, data.question);
    } else {
      const existing = await this.faqRepository.findBySlug(data.slug);
      if (existing) {
        throw new Error("An FAQ with this slug already exists");
      }
    }

    const faq = await this.faqRepository.create(data);
    return { message: "FAQ created successfully", faq };
  }

  async getFAQDetails(faqId: string) {
    const faq = await this.faqRepository.findById(faqId, [
      { path: "faqCategoryId", select: "name isActive" },
    ]);
    if (!faq) {
      throw new Error("FAQ not found");
    }
    return faq;
  }

  async updateFAQ(faqId: string, data: any) {
    const faq = await this.faqRepository.findById(faqId);
    if (!faq) {
      throw new Error("FAQ not found");
    }

    // Verify category exists if being updated
    if (
      data.faqCategoryId &&
      data.faqCategoryId !== faq.faqCategoryId.toString()
    ) {
      const category = await this.categoryRepository.findById(
        data.faqCategoryId,
      );
      if (!category) {
        throw new Error("FAQ category not found");
      }
    }

    // Only touch the slug if the caller explicitly changed it
    if (data.slug && data.slug !== faq.slug) {
      const existing = await this.faqRepository.findBySlug(data.slug);
      if (existing) {
        throw new Error("An FAQ with this slug already exists");
      }
    }

    const updatedFaq = await this.faqRepository.update(faqId, data);
    return { message: "FAQ updated successfully", faq: updatedFaq };
  }

  async deleteFAQ(faqId: string) {
    const faq = await this.faqRepository.findById(faqId);
    if (!faq) {
      throw new Error("FAQ not found");
    }

    await this.faqRepository.delete(faqId);
    return { message: "FAQ deleted successfully" };
  }

  // FAQ Category Methods
  async listCategories(page: number = 1, limit: number = 20) {
    const result = await this.categoryRepository.findWithPagination(
      {},
      page,
      limit,
    );

    const categoriesWithCount = await Promise.all(
      result.data.map(async (category) => {
        const faqCount = await FAQ.countDocuments({
          faqCategoryId: category._id,
        });

        return {
          ...category.toObject(),
          faqCount: faqCount || 0,
        };
      }),
    );

    return {
      categories: categoriesWithCount,
      pagination: {
        page,
        limit,
        total: result.total,
      },
    };
  }

  async createCategory(data: any) {
    if (!data.slug) {
      data.slug = await generateUniqueSlug(FaqCategory, data.name);
    } else {
      const existingCategory = await this.categoryRepository.findBySlug(
        data.slug,
      );
      if (existingCategory) {
        throw new Error("Category with this slug already exists");
      }
    }

    const category = await this.categoryRepository.create(data);
    return { message: "FAQ category created successfully", category };
  }

  async getCategoryDetails(categoryId: string) {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) {
      throw new Error("FAQ category not found");
    }
    return category;
  }

  async updateCategory(categoryId: string, data: any) {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) {
      throw new Error("FAQ category not found");
    }

    // Check if slug is being updated and if it conflicts
    if (data.slug && data.slug !== category.slug) {
      const existingCategory = await this.categoryRepository.findBySlug(
        data.slug,
      );
      if (existingCategory) {
        throw new Error("Category with this slug already exists");
      }
    }

    const updatedCategory = await this.categoryRepository.update(
      categoryId,
      data,
    );
    return {
      message: "FAQ category updated successfully",
      category: updatedCategory,
    };
  }

  async updateCategoryStatus(categoryId: string, isActive: boolean) {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) {
      throw new Error("FAQ category not found");
    }
    const updatedCategory = await this.categoryRepository.update(categoryId, {
      isActive,
    });
    return {
      message: "FAQ category status updated successfully",
      category: updatedCategory,
    };
  }
  async deleteCategory(categoryId: string) {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) {
      throw new Error("FAQ category not found");
    }

    const session = await mongoose.startSession();
    let deletedFaqCount = 0;

    try {
      await session.withTransaction(async () => {
        deletedFaqCount = await this.faqRepository.deleteMany(
          { faqCategoryId: new mongoose.Types.ObjectId(categoryId) },
          session,
        );

        await this.categoryRepository.delete(categoryId, session);
      });
    } finally {
      await session.endSession();
    }

    return {
      message:
        deletedFaqCount > 0
          ? `FAQ category deleted along with ${deletedFaqCount} associated FAQ(s)`
          : "FAQ category deleted successfully",
      deletedFaqCount,
    };
  }
}
