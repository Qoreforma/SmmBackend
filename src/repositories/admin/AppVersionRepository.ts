import { BaseRepository } from '../BaseRepository';
import { AppVersion, IAppVersion } from '@/models/system/AppVersion';

export class AppVersionRepository extends BaseRepository<IAppVersion> {
  constructor() {
    super(AppVersion);
  }

  async findByPlatform(platform: string): Promise<IAppVersion[]> {
    return await this.model.find({ platform }).sort({ buildNumber: -1 }).exec();
  }

  async findLatestByPlatform(platform: string): Promise<IAppVersion | null> {
    return await this.model.findOne({ platform }).sort({ buildNumber: -1 }).exec();
  }
}
