import { PROVIDERS } from "@/config";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ERROR_CODES, HTTP_STATUS } from "@/utils/constants";
import axios, { AxiosInstance } from "axios";

export interface DojahBVNValidationResponse {
  entity: {
    bvn: {
      value: string;
      status: boolean;
    };
    first_name: {
      confidence_value: number;
      status: boolean;
    };
    last_name: {
      confidence_value: number;
      status: boolean;
    };
  };
}

export interface DojahNINVerificationResponse {
  entity: {
    first_name: string;
    last_name: string;
    middle_name: string;
    gender: string;
    image: string;
    phone_number: string;
    date_of_birth: string; // YYYY-MM-DD
    nin: string;
    selfie_verification: {
      confidence_value: number;
      match: boolean;
    };
  };
}

export interface DojahKYCData {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  phoneNumber?: string;
  bvn?: string;
  nin?: string;
  gender?: string;
}

export class DojahService {
  private client: AxiosInstance;
  private provider = PROVIDERS.DOJAH;
  private confidenceThreshold: number;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      headers: {
        "Content-Type": "application/json",
        AppId: this.provider.appId,
        Authorization: this.provider.secretKey,
      },
      validateStatus: () => true,
    });

    // Get confidence threshold from env, default to 85%
    this.confidenceThreshold = parseInt(
      process.env.DOJAH_CONFIDENCE_MIN || "85",
      10,
    );
  }

  // Validate BVN with optional name and DOB matching

  async validateBVN(data: {
    bvn: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string; // Format: YYYY-MM-DD
  }): Promise<{
    success: boolean;
    message: string;
    kycData?: DojahKYCData;
  }> {
    try {
      logger.info(`[Dojah] Validating BVN: ${data.bvn}`);

      const params: any = {
        bvn: data.bvn.trim(),
      };

      if (data.firstName) params.first_name = data.firstName.trim();
      if (data.lastName) params.last_name = data.lastName.trim();
      if (data.dateOfBirth) params.dob = data.dateOfBirth.trim();

      const response = await this.client.get<DojahBVNValidationResponse>(
        "/api/v1/kyc/bvn",
        { params },
      );

      logger.info(`[Dojah] BVN validation response status: ${response.status}`);

      // Handle error responses
      if (response.status !== 200 || !response.data?.entity) {
        const errorMessage =
          (response.data as any)?.error || "BVN validation failed at provider";

        logger.error(`[Dojah] BVN validation failed:`, {
          status: response.status,
          error: errorMessage,
          bvn: data.bvn,
        });

        const environment = process.env.NODE_ENV;
        const finalMessage =
          environment === "production"
            ? "BVN validation failed. Please check your details and try again."
            : errorMessage;

        throw new AppError(
          finalMessage,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const entity = response.data.entity;

      // Check BVN validity
      if (!entity.bvn.status) {
        logger.error(`[Dojah] BVN is invalid: ${data.bvn}`);

        throw new AppError(
          "BVN is invalid. Please check and try again.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check first name confidence if provided
      if (
        data.firstName &&
        !this.meetsConfidenceThreshold(entity.first_name.confidence_value)
      ) {
        logger.warn(`[Dojah] First name confidence too low:`, {
          confidence: entity.first_name.confidence_value,
          threshold: this.confidenceThreshold,
          bvn: data.bvn,
        });

        throw new AppError(
          "First name does not match BVN records. Please verify your details.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check last name confidence if provided
      if (
        data.lastName &&
        !this.meetsConfidenceThreshold(entity.last_name.confidence_value)
      ) {
        logger.warn(`[Dojah] Last name confidence too low:`, {
          confidence: entity.last_name.confidence_value,
          threshold: this.confidenceThreshold,
          bvn: data.bvn,
        });

        throw new AppError(
          "Last name does not match BVN records. Please verify your details.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`[Dojah] BVN validation successful: ${data.bvn}`);

      return {
        success: true,
        message: "BVN validated successfully",
        kycData: {
          bvn: data.bvn,
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          dateOfBirth: data.dateOfBirth,
        },
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(`[Dojah] BVN validation error:`, {
        error: error.message,
        bvn: data.bvn,
      });

      const environment = process.env.NODE_ENV;
      const finalMessage =
        environment === "production"
          ? "BVN validation failed. Please try again later."
          : error.message || "BVN validation failed";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Verify NIN with selfie image (optional)

  async verifyNIN(data: {
    nin: string;
    firstName?: string;
    lastName?: string;
    selfieImageBase64?: string; // Optional base64 image (with data:image/jpeg;base64, prefix removed)
  }): Promise<{
    success: boolean;
    message: string;
    kycData?: DojahKYCData;
  }> {
    try {
      logger.info(`[Dojah] Verifying NIN: ${data.nin}`);

      // If selfie image is provided, use the full verification endpoint
      if (data.selfieImageBase64) {
        return await this.verifyNINWithSelfie(data);
      }

      // Otherwise, just validate the NIN exists and is valid
      // Note: Dojah doesn't have a direct NIN lookup without selfie
      // So we'll throw an error if selfie is not provided
      logger.warn(`[Dojah] NIN verification without selfie not supported`);

      throw new AppError(
        "NIN verification requires a selfie image. Please provide your selfie.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(`[Dojah] NIN verification error:`, {
        error: error.message,
        nin: data.nin,
      });

      const environment = process.env.NODE_ENV;
      const finalMessage =
        environment === "production"
          ? "NIN verification failed. Please try again later."
          : error.message || "NIN verification failed";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Verify NIN with selfie image (for enhanced verification)

  private async verifyNINWithSelfie(data: {
    nin: string;
    firstName?: string;
    lastName?: string;
    selfieImageBase64?: string;
  }): Promise<{
    success: boolean;
    message: string;
    kycData?: DojahKYCData;
  }> {
    try {
      logger.info(`[Dojah] Verifying NIN with selfie: ${data.nin}`);

      const payload: any = {
        nin: data.nin.trim(),
      };

      if (data.firstName) payload.first_name = data.firstName.trim();
      if (data.lastName) payload.last_name = data.lastName.trim();
      if (data.selfieImageBase64)
        payload.selfie_image = data.selfieImageBase64.trim();

      const response = await this.client.post<DojahNINVerificationResponse>(
        "/api/v1/kyc/nin/verify",
        payload,
      );

      logger.info(
        `[Dojah] NIN verification response status: ${response.status}`,
      );

      // Handle error responses
      if (response.status !== 200 || !response.data?.entity) {
        const errorMessage =
          (response.data as any)?.error ||
          "NIN verification failed at provider";

        logger.error(`[Dojah] NIN verification failed:`, {
          status: response.status,
          error: errorMessage,
          nin: data.nin,
        });

        const environment = process.env.NODE_ENV;
        const finalMessage =
          environment === "production"
            ? "NIN verification failed. Please check your details and try again."
            : errorMessage;

        throw new AppError(
          finalMessage,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const entity = response.data.entity;

      // Check selfie match confidence
      const selfieConfidence =
        entity.selfie_verification?.confidence_value || 0;
      const selfieMatches = entity.selfie_verification?.match || false;

      if (!selfieMatches || !this.meetsConfidenceThreshold(selfieConfidence)) {
        logger.warn(`[Dojah] Selfie verification confidence too low:`, {
          confidence: selfieConfidence,
          threshold: this.confidenceThreshold,
          nin: data.nin,
        });

        throw new AppError(
          "Selfie does not match NIN records. Please try again.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`[Dojah] NIN verification successful: ${data.nin}`);

      return {
        success: true,
        message: "NIN verified successfully with selfie",
        kycData: {
          nin: data.nin,
          firstName: entity.first_name,
          lastName: entity.last_name,
          middleName: entity.middle_name,
          dateOfBirth: entity.date_of_birth, // YYYY-MM-DD
          phoneNumber: entity.phone_number,
          gender: entity.gender,
        },
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(`[Dojah] NIN verification error:`, {
        error: error.message,
        nin: data.nin,
      });

      const environment = process.env.NODE_ENV;
      const finalMessage =
        environment === "production"
          ? "NIN verification failed. Please try again later."
          : error.message || "NIN verification failed";

      throw new AppError(
        finalMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Check if confidence value meets the threshold

  private meetsConfidenceThreshold(confidence: number): boolean {
    return confidence >= this.confidenceThreshold;
  }
}
