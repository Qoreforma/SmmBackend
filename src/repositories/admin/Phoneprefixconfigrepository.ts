
import { IPhonePrefixConfig, PhonePrefixConfig, IPhonePrefixEntry } from "@/models/admin/configs/Phoneprefixconfig";
import { BaseRepository } from "@/repositories/BaseRepository";

// ADD after the imports, before the class:
const DEFAULT_PHONE_PREFIXES: IPhonePrefixEntry[] = [
  { prefix: '0803', network: 'MTN' }, { prefix: '0806', network: 'MTN' },
  { prefix: '0703', network: 'MTN' }, { prefix: '0706', network: 'MTN' },
  { prefix: '0810', network: 'MTN' }, { prefix: '0813', network: 'MTN' },
  { prefix: '0814', network: 'MTN' }, { prefix: '0816', network: 'MTN' },
  { prefix: '0903', network: 'MTN' }, { prefix: '0906', network: 'MTN' },
  { prefix: '0913', network: 'MTN' }, { prefix: '0916', network: 'MTN' },
  { prefix: '0704', network: 'MTN' },
  { prefix: '0707', network: 'MTN' },
  { prefix: '0805', network: 'GLO' }, { prefix: '0807', network: 'GLO' },
  { prefix: '0705', network: 'GLO' }, { prefix: '0815', network: 'GLO' },
  { prefix: '0811', network: 'GLO' }, { prefix: '0905', network: 'GLO' },
  { prefix: '0915', network: 'GLO' },
  { prefix: '0802', network: 'AIRTEL' }, { prefix: '0808', network: 'AIRTEL' },
  { prefix: '0708', network: 'AIRTEL' }, { prefix: '0812', network: 'AIRTEL' },
  { prefix: '0701', network: 'AIRTEL' }, { prefix: '0902', network: 'AIRTEL' },
  { prefix: '0901', network: 'AIRTEL' }, { prefix: '0904', network: 'AIRTEL' },
  { prefix: '0907', network: 'AIRTEL' }, { prefix: '0912', network: 'AIRTEL' },
  { prefix: '0809', network: '9MOBILE' }, { prefix: '0817', network: '9MOBILE' },
  { prefix: '0818', network: '9MOBILE' }, { prefix: '0908', network: '9MOBILE' },
  { prefix: '0909', network: '9MOBILE' },
];

export class PhonePrefixConfigRepository extends BaseRepository<IPhonePrefixConfig> {
  constructor() {
    super(PhonePrefixConfig);
  }


  // Always returns the single config document.
  // Creates one with an empty prefixes array if it doesn't exist yet.
  async getConfig(): Promise<IPhonePrefixConfig> {
    let config = await this.model.findOne();
    if (!config) {
      config = await this.model.create({ prefixes: [] });
    }
    return config;
  }


  // Replace the entire prefixes array at once.
  async replacePrefixes(
    prefixes: IPhonePrefixEntry[],
    updatedBy?: string
  ): Promise<IPhonePrefixConfig> {
    let config = await this.model.findOne();

    if (!config) {
      config = await this.model.create({ prefixes, updatedBy });
      return config;
    }

    config.prefixes = prefixes;
    if (updatedBy) config.updatedBy = updatedBy as any;
    return config.save();
  }


  // Add a single prefix entry. Rejects duplicates.
  async addPrefix(
    entry: IPhonePrefixEntry,
    updatedBy?: string
  ): Promise<IPhonePrefixConfig> {
    const config = await this.getConfig();

    const exists = config.prefixes.some((p) => p.prefix === entry.prefix);
    if (exists) {
      // Update in place instead of throwing — just update the network
      config.prefixes = config.prefixes.map((p) =>
        p.prefix === entry.prefix ? { ...p, network: entry.network.toUpperCase() } : p
      );
    } else {
      config.prefixes.push({
        prefix: entry.prefix,
        network: entry.network.toUpperCase(),
      });
    }

    if (updatedBy) config.updatedBy = updatedBy as any;
    return config.save();
  }


  // Remove a prefix by its prefix string (e.g. '0803').
  async removePrefix(
    prefix: string,
    updatedBy?: string
  ): Promise<IPhonePrefixConfig> {
    const config = await this.getConfig();
    config.prefixes = config.prefixes.filter((p) => p.prefix !== prefix);
    if (updatedBy) config.updatedBy = updatedBy as any;
    return config.save();
  }


  // Update a specific prefix entry's network.
  async updatePrefix(
    prefix: string,
    network: string,
    updatedBy?: string
  ): Promise<IPhonePrefixConfig | null> {
    const config = await this.getConfig();
    const entry = config.prefixes.find((p) => p.prefix === prefix);
    if (!entry) return null;

    entry.network = network.toUpperCase();
    if (updatedBy) config.updatedBy = updatedBy as any;
    return config.save();
  }


  // Returns a plain prefix→network map for use in ValidationHelpers.
  // e.g. { '0803': 'MTN', '0805': 'GLO', ... }
  async getPrefixMap(): Promise<Record<string, string>> {
    const config = await this.getConfig();
    return config.prefixes.reduce(
      (map, entry) => {
        map[entry.prefix] = entry.network;
        return map;
      },
      {} as Record<string, string>
    );
  }

  async resetToDefaults(updatedBy?: string): Promise<IPhonePrefixConfig> {
    return this.replacePrefixes(
      DEFAULT_PHONE_PREFIXES.map((p) => ({ ...p })),
      updatedBy
    );
  }
}