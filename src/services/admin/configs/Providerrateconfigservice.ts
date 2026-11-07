import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";

export class ProviderRateConfigService {
  constructor(
    private providerRateConfigRepository: ProviderRateConfigRepository,
    private providerRepository: ProviderRepository
  ) {}

  async listAll() {
    return this.providerRateConfigRepository.findAllActive();
  }

  async getByProviderCode(providerCode: string) {
    const config =
      await this.providerRateConfigRepository.findByProviderCode(providerCode);

    if (!config) {
      throw new AppError(
        `Rate config not found for provider: ${providerCode}`,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return config;
  }

  async upsert(
    data: {
      providerId: string;
      buyRate: number;
      sellRate: number;
      buyMarkupType?: "flat" | "percentage";
      buyMarkupValue?: number;
      buyMarkupCap?: number;
      sellMarkupType?: "flat" | "percentage";
      sellMarkupValue?: number;
      sellMarkupCap?: number;
      isActive?: boolean;
    },
    adminId: string
  ) {
    // Validate provider exists
    const provider = await this.providerRepository.findById(data.providerId);
    if (!provider) {
      throw new AppError(
        "Provider not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    // Validate rates
    if (data.buyRate < 0 || data.sellRate < 0) {
      throw new AppError(
        "Buy rate and sell rate must be non-negative",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    if (data.buyMarkupType === "percentage") {
      if (data.buyMarkupValue !== undefined && Math.abs(data.buyMarkupValue) > 30) {
        throw new AppError(
          "Buy percentage markup cannot exceed 30%",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (data.buyMarkupCap !== undefined && data.buyMarkupCap < 0) {
        throw new AppError(
          "Buy markup cap cannot be negative",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
    }

    if (data.sellMarkupType === "percentage") {
      if (data.sellMarkupValue !== undefined && Math.abs(data.sellMarkupValue) > 30) {
        throw new AppError(
          "Sell percentage markup cannot exceed 30%",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (data.sellMarkupCap !== undefined && data.sellMarkupCap < 0) {
        throw new AppError(
          "Sell markup cap cannot be negative",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
    }

    return this.providerRateConfigRepository.upsertByProviderId(
      data.providerId,
      {
        providerId: data.providerId as any,
        providerCode: provider.code,
        serviceType: "crypto",
        buyRate: data.buyRate,
        sellRate: data.sellRate,
        buyMarkupType: data.buyMarkupType ?? "flat",
        buyMarkupValue: data.buyMarkupValue ?? 0,
        buyMarkupCap: data.buyMarkupCap ?? 0,
        sellMarkupType: data.sellMarkupType ?? "flat",
        sellMarkupValue: data.sellMarkupValue ?? 0,
        sellMarkupCap: data.sellMarkupCap ?? 0,
        isActive: data.isActive ?? true,
        updatedBy: adminId as any,
      }
    );
  }

  async updateRates(
    providerId: string,
    rates: { buyRate?: number; sellRate?: number },
    markupData: {
      buyMarkupType?: "flat" | "percentage";
      buyMarkupValue?: number;
      buyMarkupCap?: number;
      sellMarkupType?: "flat" | "percentage";
      sellMarkupValue?: number;
      sellMarkupCap?: number;
    },
    adminId: string
  ) {
    const existing =
      await this.providerRateConfigRepository.findByProviderId(providerId);

    if (!existing) {
      throw new AppError(
        "Rate config not found for this provider",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    if (markupData.buyMarkupType === "percentage") {
      if (markupData.buyMarkupValue !== undefined && Math.abs(markupData.buyMarkupValue) > 30) {
        throw new AppError(
          "Buy percentage markup cannot exceed 30%",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (markupData.buyMarkupCap !== undefined && markupData.buyMarkupCap < 0) {
        throw new AppError(
          "Buy markup cap cannot be negative",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
    }

    if (markupData.sellMarkupType === "percentage") {
      if (markupData.sellMarkupValue !== undefined && Math.abs(markupData.sellMarkupValue) > 30) {
        throw new AppError(
          "Sell percentage markup cannot exceed 30%",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
      if (markupData.sellMarkupCap !== undefined && markupData.sellMarkupCap < 0) {
        throw new AppError(
          "Sell markup cap cannot be negative",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }
    }

    return this.providerRateConfigRepository.update(String(existing._id), {
      ...rates,
      ...markupData,
      updatedBy: adminId,
    });
  }

  async toggleActive(providerId: string, isActive: boolean, adminId: string) {
    const existing =
      await this.providerRateConfigRepository.findByProviderId(providerId);

    if (!existing) {
      throw new AppError(
        "Rate config not found for this provider",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return this.providerRateConfigRepository.update(String(existing._id), {
      isActive,
      updatedBy: adminId,
    });
  }
}