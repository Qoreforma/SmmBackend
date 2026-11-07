import { BannerRepository } from "@/repositories/admin/BannerRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class BannerService {
  constructor(private bannerRepository: BannerRepository) {}


  async listBanners(page: number = 1, limit: number = 20) {
    const populate = [{ path: "creator", select: "firstName lastName email" }];
    const { data, total } = await this.bannerRepository.findWithPagination(
      {}, page, limit, { priority: -1, createdAt: -1 }, populate
    );
    return { data, total, page, limit };
  }

  async createBanner(data: any, creator: string) {
    const maxPriority = await this.bannerRepository.getMaxPriority();
    const banner = await this.bannerRepository.create({ ...data, creator, priority: maxPriority + 1 });
    return banner;
  }

async reorderBanners(orderedIds: string[]) {
    await this.bannerRepository.reorderPriorities(orderedIds);
    return { message: "Banner order updated successfully" };
  }
  async getBannerDetails(bannerId: string) {
    const banner = await this.bannerRepository.findByIdAndPopulateAdmin(
      bannerId
    );
    if (!banner) {
      throw new AppError(
        "Banner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }
    return banner;
  }

  async updateBanner(bannerId: string, data: any) {
    const banner = await this.bannerRepository.update(bannerId, data);
    if (!banner) {
      throw new AppError(
        "Banner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return banner;
  }

  async deleteBanner(bannerId: string) {
    const banner = await this.bannerRepository.findById(bannerId);
    if (!banner) {
      throw new AppError(
        "Banner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    await this.bannerRepository.delete(bannerId);
  }

  async updateStatus(id: string, isActive: boolean) {
    const banner = await this.bannerRepository.findById(id);
    if (!banner) {
      throw new AppError(
        "Banner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }
    return await this.bannerRepository.update(id, { isActive });
  }
}
