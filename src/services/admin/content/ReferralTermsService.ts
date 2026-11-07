import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class ReferralTermsService {
  constructor(private referralTermsRepository: ReferralTermsRepository) {}

  async listReferralTerms(page: number = 1, limit: number = 20) {
    const { data, total } =
      await this.referralTermsRepository.findWithPagination({}, page, limit, {
        createdAt: -1,
      });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async createReferralTerms(data: { title: string; body: string }) {
    const slug = data.title.toLowerCase().replace(/ /g, "-");
    const existingTerms = await this.referralTermsRepository.findOne({
      slug,
    });
    if (existingTerms) {
      throw new AppError(
        "A referral terms with this slug already exists",
        HTTP_STATUS.CONFLICT
      );
    }
    const referralTerms = await this.referralTermsRepository.create({
      ...data,
      slug,
    });
    return referralTerms;
  }

  async getReferralTermsDetails(termsId: string) {
    const referralTerms = await this.referralTermsRepository.findById(termsId);
    if (!referralTerms) {
      throw new AppError(
        "Referral terms not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }
    return referralTerms;
  }

  async updateReferralTerms(termsId: string, data: any) {
    const referralTerms = await this.referralTermsRepository.findById(termsId);
    if (!referralTerms) {
      throw new AppError(
        "Referral terms not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    if (data.slug && data.slug !== referralTerms.slug) {
      const existingTerms = await this.referralTermsRepository.findOne({
        slug: data.slug,
      });
      if (existingTerms) {
        throw new AppError(
          "A referral terms with this slug already exists",
          HTTP_STATUS.CONFLICT
        );
      }
    }

    const updatedTerms = await this.referralTermsRepository.update(
      termsId,
      data
    );
    return updatedTerms;
  }

  async deleteReferralTerms(termsId: string) {
    const referralTerms = await this.referralTermsRepository.findById(termsId);
    if (!referralTerms) {
      throw new AppError(
        "Referral terms not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    await this.referralTermsRepository.delete(termsId);
  }
}
