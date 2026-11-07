import { BaseRepository } from '../BaseRepository';
import { FAQ, IFAQ } from '@/models/system/FAQ';
import { FaqCategory, IFaqCategory } from '@/models/system/FaqCategory';

export class FAQRepository extends BaseRepository<IFAQ> {
  constructor() {
    super(FAQ);
  }

  async findBySlug(slug: string): Promise<IFAQ | null> {
    return this.model.findOne({ slug }).populate('faqCategoryId').exec();
  }

  async findByCategory(categoryId: string, page: number = 1, limit: number = 10) {
    return this.findWithPagination({ faqCategoryId: categoryId }, page, limit);
  }

  async searchFAQs(search: string, page: number = 1, limit: number = 10) {
    const query = {
      $or: [
        { question: { $regex: search, $options: 'i' } },
        { answer: { $regex: search, $options: 'i' } },
      ],
    };
    
    return this.findWithPagination(query, page, limit);
  }
}

export class FaqCategoryRepository extends BaseRepository<IFaqCategory> {
  constructor() {
    super(FaqCategory);
  }

  async findBySlug(slug: string): Promise<IFaqCategory | null> {
    return this.model.findOne({ slug }).exec();
  }

  async findActive(page: number = 1, limit: number = 10) {
    return this.findWithPagination({ status: 'active' }, page, limit);
  }
}
