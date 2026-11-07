import { AppError } from "@/middlewares/shared/errorHandler";
import { IPhonePrefixEntry } from "@/models/admin/configs/Phoneprefixconfig";
import { PhonePrefixConfigRepository } from "@/repositories/admin/Phoneprefixconfigrepository";
export function invalidatePrefixMapCache(): void {}
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class PhonePrefixConfigService {
  constructor(
    private phonePrefixConfigRepository: PhonePrefixConfigRepository
  ) {}

  async getConfig() {
    return this.phonePrefixConfigRepository.getConfig();
  }

  async replacePrefixes(prefixes: IPhonePrefixEntry[], adminId: string) {
    this.validatePrefixEntries(prefixes);

    const result = await this.phonePrefixConfigRepository.replacePrefixes(
      prefixes,
      adminId
    );

    invalidatePrefixMapCache();
    return result;
  }

  async addPrefix(entry: IPhonePrefixEntry, adminId: string) {
    this.validateSingleEntry(entry);

    const result = await this.phonePrefixConfigRepository.addPrefix(
      entry,
      adminId
    );

    invalidatePrefixMapCache();
    return result;
  }

  async removePrefix(prefix: string, adminId: string) {
    if (!prefix || prefix.trim().length === 0) {
      throw new AppError(
        "Prefix is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const result = await this.phonePrefixConfigRepository.removePrefix(
      prefix.trim(),
      adminId
    );

    invalidatePrefixMapCache();
    return result;
  }

  async updatePrefix(prefix: string, network: string, adminId: string) {
    this.validateSingleEntry({ prefix, network });

    const result = await this.phonePrefixConfigRepository.updatePrefix(
      prefix,
      network,
      adminId
    );

    if (!result) {
      throw new AppError(
        `Prefix ${prefix} not found in config`,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    invalidatePrefixMapCache();
    return result;
  }

  async resetToDefaults(adminId: string, confirm: boolean) {
    if (!confirm) {
      throw new AppError(
        "Pass confirm: true to reset prefixes to defaults",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const result = await this.phonePrefixConfigRepository.resetToDefaults(adminId);
    invalidatePrefixMapCache();
    return result;
  }

  // Private validation helpers

  private validateSingleEntry(entry: IPhonePrefixEntry): void {
    if (!entry.prefix || entry.prefix.trim().length === 0) {
      throw new AppError(
        "Prefix is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    if (!entry.network || entry.network.trim().length === 0) {
      throw new AppError(
        "Network is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
  }

  private validatePrefixEntries(prefixes: IPhonePrefixEntry[]): void {
    if (!Array.isArray(prefixes) || prefixes.length === 0) {
      throw new AppError(
        "Prefixes array must not be empty",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    // Check for duplicate prefixes within the submitted array
    const seen = new Set<string>();
    for (const entry of prefixes) {
      this.validateSingleEntry(entry);

      if (seen.has(entry.prefix)) {
        throw new AppError(
          `Duplicate prefix found: ${entry.prefix}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      seen.add(entry.prefix);
    }
  }
}
