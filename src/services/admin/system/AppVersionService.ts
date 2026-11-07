import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";

export class AppVersionService {
  constructor(private appVersionRepository: AppVersionRepository) {}

  async listAppVersions(page: number = 1, limit: number = 20) {
    const result = await this.appVersionRepository.findWithPagination(
      {},
      page,
      limit
    );

    return {
      data: result.data,
      total: result.total,
    };
  }

  async createAppVersion(data: any) {
    const appVersion = await this.appVersionRepository.create(data);
    return { message: "App version created successfully", appVersion };
  }

  async getAppVersionDetails(versionId: string) {
    const appVersion = await this.appVersionRepository.findById(versionId);
    if (!appVersion) {
      throw new Error("App version not found");
    }
    return appVersion;
  }

  async updateAppVersion(versionId: string, data: any) {
    const appVersion = await this.appVersionRepository.findById(versionId);
    if (!appVersion) {
      throw new Error("App version not found");
    }

    Object.assign(appVersion, data);
    await appVersion.save();

    return { message: "App version updated successfully", appVersion };
  }

  async deleteAppVersion(versionId: string) {
    await this.appVersionRepository.delete(versionId);
    return { message: "App version deleted successfully" };
  }
}
