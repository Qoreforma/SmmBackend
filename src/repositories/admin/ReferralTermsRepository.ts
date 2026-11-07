import { BaseRepository } from '../BaseRepository';
import { ReferralTerms, IReferralTerms } from '@/models/system/ReferralTerms';

export class ReferralTermsRepository extends BaseRepository<IReferralTerms> {
  constructor() {
    super(ReferralTerms);
  }

  async findBySlug(slug: string): Promise<IReferralTerms | null> {
    return await this.model.findOne({ slug }).exec();
  }
}
