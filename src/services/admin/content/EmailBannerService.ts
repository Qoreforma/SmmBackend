import { EmailBannerRepository } from "@/repositories/admin/EmailBannerRepository";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS } from "@/utils/constants";
import { IEmailBanner } from "@/models/system/EmailBanner";

export class EmailBannerService {
  constructor(
    private emailBannerRepository: EmailBannerRepository,
    private cacheService: CacheService,
  ) {}

  async getEmailBanners(): Promise<{ logoUrl: string | null; headerBannerUrl: string | null; footerBannerUrl: string | null }> {
    const cached = await this.cacheService.get<{ logoUrl: string | null; headerBannerUrl: string | null; footerBannerUrl: string | null }>(
      CACHE_KEYS.EMAIL_BANNERS
    );
    if (cached) return cached;

    const settings = await this.emailBannerRepository.getSettings();
    const data = {
      logoUrl: settings?.logoUrl || null,
      headerBannerUrl: settings?.headerBannerUrl || null,
      footerBannerUrl: settings?.footerBannerUrl || null,
    };

    await this.cacheService.set(CACHE_KEYS.EMAIL_BANNERS, data);
    return data;
  }

  async updateEmailBanners(
    data: { logoUrl?: string; headerBannerUrl?: string; footerBannerUrl?: string },
    adminId: string,
  ): Promise<IEmailBanner | null> {
    const settings = await this.emailBannerRepository.updateSettings(data, adminId);
    
    // Invalidate the cache
    await this.cacheService.delete(CACHE_KEYS.EMAIL_BANNERS);
    
    return settings;
  }
}
