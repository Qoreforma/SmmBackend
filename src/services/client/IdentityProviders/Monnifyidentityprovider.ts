
import { MonnifyService } from "@/services/client/providers/payments/MonnifyService";
import logger from "@/logger";
import { IIdentityProvider, ValidationData, ProviderValidationResponse } from "@/utils/Iidentityprovider";


export class MonnifyIdentityProvider implements IIdentityProvider {
  private monnifyService: MonnifyService;

  constructor(monnifyService: MonnifyService) {
    this.monnifyService = monnifyService;
  }

  async validateIdentity(
    data: ValidationData
  ): Promise<ProviderValidationResponse> {
    try {
      logger.info(
        `[MonnifyProvider] Validating ${data.identificationType}: ${data.value}`
      );

      const monnifyAccount =
        await this.monnifyService.createVirtualAccount({
          email: "", // Will be added from user context in service
          firstname: data.firstname,
          lastname: data.lastname,
          reference: this.generateReference(),
          bvn: data.identificationType === "bvn" ? data.value : undefined,
          nin: data.identificationType === "nin" ? data.value : undefined,
          getAllBanks: false,
        });

      logger.info(
        `[MonnifyProvider] Validation successful for ${data.identificationType}: ${data.value}`
      );

      return {
        success: true,
        message: "Identity validated successfully with Monnify",
        kycData: {
          firstName: data.firstname,
          lastName: data.lastname,
          middleName: data.middlename,
          dateOfBirth: data.dateOfBirth,
          phoneNumber: data.phoneNumber,
          bvn: data.identificationType === "bvn" ? data.value : undefined,
          nin: data.identificationType === "nin" ? data.value : undefined,
        },
      };
    } catch (error: any) {
      logger.error(`[MonnifyProvider] Validation failed:`, {
        error: error.message,
        identificationType: data.identificationType,
      });
      throw error;
    }
  }

  getProviderName(): string {
    return "monnify";
  }

  private generateReference(prefix: string = "MVAL"): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9).toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
  }
}