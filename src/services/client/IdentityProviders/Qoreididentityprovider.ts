import logger from "@/logger";
import {
  IIdentityProvider,
  ValidationData,
  ProviderValidationResponse,
} from "@/utils/Iidentityprovider";
import { QoreIDService } from "../providers/identityVerification/QoreidService";

export class QoreIDIdentityProvider implements IIdentityProvider {
  private qoreIDService: QoreIDService;

  constructor(qoreIDService: QoreIDService) {
    this.qoreIDService = qoreIDService;
  }

  async validateIdentity(
    data: ValidationData
  ): Promise<ProviderValidationResponse> {
    try {
      logger.info(
        `[QoreIDProvider] Validating ${data.identificationType}: ${data.value}`
      );

      let validationResult;

      if (data.identificationType === "bvn") {
        validationResult = await this.qoreIDService.validateBVN({
          bvn: data.value,
          firstName: data.firstname,
          lastName: data.lastname,
          dateOfBirth: data.dateOfBirth,
          phoneNumber: data.phoneNumber,
        });
      } else if (data.identificationType === "nin") {
        validationResult = await this.qoreIDService.validateNIN({
          nin: data.value,
          firstName: data.firstname,
          lastName: data.lastname,
          dateOfBirth: data.dateOfBirth,
          phoneNumber: data.phoneNumber,
        });
      } else {
        throw new Error(`Unsupported identification type: ${data.identificationType}`);
      }

      logger.info(
        `[QoreIDProvider] Validation successful for ${data.identificationType}: ${data.value}`
      );

      return {
        success: true,
        message: validationResult.message,
        kycData: validationResult.kycData,
      };
    } catch (error: any) {
      logger.error(`[QoreIDProvider] Validation failed:`, {
        error: error.message,
        identificationType: data.identificationType,
      });
      throw error;
    }
  }

  getProviderName(): string {
    return "qoreid";
  }
}