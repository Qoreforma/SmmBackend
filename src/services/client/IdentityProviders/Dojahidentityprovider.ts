import logger from "@/logger";
import {
  IIdentityProvider,
  ProviderValidationResponse,
  ValidationData,
} from "@/utils/Iidentityprovider";
import { DojahService } from "../providers/identityVerification/DojahService";

export class DojahIdentityProvider implements IIdentityProvider {
  private dojahService: DojahService;

  constructor(dojahService: DojahService) {
    this.dojahService = dojahService;
  }

  async validateIdentity(
    data: ValidationData,
  ): Promise<ProviderValidationResponse> {
    try {
      logger.info(
        `[DojahProvider] Validating ${data.identificationType}: ${data.value}`,
      );

      let result: ProviderValidationResponse;

      if (data.identificationType === "bvn") {
        result = await this.dojahService.validateBVN({
          bvn: data.value,
          firstName: data.firstname,
          lastName: data.lastname,
          dateOfBirth: data.dateOfBirth,
        });
      } else {

        if(data.selfieImageBase64) {
          logger.info(
            `[DojahProvider] Selfie image provided for NIN validation, using enhanced verification for ${data.value}`,
          );
          throw new Error("NIN validation with selfie is not yet implemented in DojahService. Please implement verifyNINWithSelfie method.");
        }
        // NIN validation
        result = await this.dojahService.verifyNIN({
          nin: data.value,
          firstName: data.firstname,
          lastName: data.lastname,
          selfieImageBase64: data.selfieImageBase64 ,
        });
      }

      logger.info(
        `[DojahProvider] Validation successful for ${data.identificationType}: ${data.value}`,
      );

      return {
        success: result.success,
        message: result.message,
        kycData: {
          firstName: result.kycData?.firstName || data.firstname,
          lastName: result.kycData?.lastName || data.lastname,
          middleName: result.kycData?.middleName || data.middlename,
          dateOfBirth: result.kycData?.dateOfBirth || data.dateOfBirth,
          phoneNumber: result.kycData?.phoneNumber || data.phoneNumber,
          bvn: data.identificationType === "bvn" ? data.value : undefined,
          nin: data.identificationType === "nin" ? data.value : undefined,
          gender: result.kycData?.gender,
        },
      };
    } catch (error: any) {
      logger.error(`[DojahProvider] Validation failed:`, {
        error: error.message,
        identificationType: data.identificationType,
      });
      throw error;
    }
  }

  getProviderName(): string {
    return "dojah";
  }
}
