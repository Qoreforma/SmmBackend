import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ERROR_CODES, HTTP_STATUS } from "@/utils/constants";

export interface QoreIDTokenResponse {
  accessToken: string;
  expiresIn: string;
  tokenType: string;
}

export interface QoreIDBVNMatchResponse {
  id: number;
  applicant: {
    firstname: string;
    lastname: string;
  };
  summary: {
    bvn_match_check: {
      status: "EXACT_MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_FOUND";
      fieldMatches: {
        [key: string]: boolean;
      };
    };
  };
  status: {
    state: "complete" | "pending";
    status: "verified" | "not_verified" | "failed" | "pending";
  };
  bvn_match: {
    fieldMatches: {
      [key: string]: boolean;
    };
  };
}

export interface QoreIDNINResponse {
  id: number;
  applicant: {
    firstname: string;
    lastname: string;
  };
  summary: {
    nin_check: {
      status: "EXACT_MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_FOUND";
      fieldMatches: {
        [key: string]: boolean;
      };
    };
  };
  status: {
    state: "complete" | "pending";
    status: "verified" | "not_verified" | "failed" | "pending";
  };
  nin: {
    nin: string;
    firstname: string;
    lastname: string;
    middlename: string;
    phone: string;
    gender: string;
    birthdate: string;
    photo: string;
    address: string;
  };
}

export interface QoreIDKYCData {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  bvn?: string;
  nin?: string;
  gender?: string;
  address?: string;
}

export class QoreIDService {
  private client: AxiosInstance;
  private provider = PROVIDERS.QOREID;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 30000,
      validateStatus: () => true,
    });
  }

  private async getAccessToken(): Promise<string> {
    // Check if token exists and hasn't expired (with 60s buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      logger.debug("[QoreID] Using cached access token");
      return this.accessToken;
    }

    try {
      logger.info("[QoreID] Fetching new access token...");

      const response = await axios.post<QoreIDTokenResponse>(
        `${this.provider.baseUrl}/token`,
        {
          clientId: this.provider.clientId,
          secret: this.provider.secret,
        },
      );

      if (response.status !== 201 || !response.data.accessToken) {
        throw new Error(
          `Failed to get token: ${response.status} - ${JSON.stringify(response.data)}`,
        );
      }

      this.accessToken = response.data.accessToken;

      // Parse expiresIn from "7200 secs" format
      const expiresInSeconds = this.parseExpiresIn(response.data.expiresIn);
      this.tokenExpiry = Date.now() + (expiresInSeconds - 60) * 1000;

      logger.info("[QoreID] Access token obtained successfully", {
        expiresInSeconds,
      });
      return this.accessToken;
    } catch (error: any) {
      logger.error("[QoreID] Failed to get access token:", {
        error: error.message,
        status: error.response?.status,
      });

      throw new AppError(
        "Failed to authenticate with QoreID service. Please try again.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Parse expiresIn from "7200 secs" format to seconds
  private parseExpiresIn(expiresInStr: string): number {
    try {
      const seconds = parseInt(expiresInStr.split(" ")[0], 10);
      if (isNaN(seconds)) {
        logger.warn("[QoreID] Failed to parse expiresIn, using default 7200", {
          expiresInStr,
        });
        return 7200;
      }
      return seconds;
    } catch (error) {
      logger.warn("[QoreID] Error parsing expiresIn, using default 7200", {
        expiresInStr,
        error,
      });
      return 7200;
    }
  }

  private convertDateFormat(dateStr: string): string {
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const [day, month, year] = parts;
        return `${year}-${month}-${day}`;
      }
      return dateStr;
    } catch (error) {
      logger.warn("[QoreID] Failed to convert date format:", {
        dateStr,
        error,
      });
      return dateStr;
    }
  }

  // Validate BVN using BVN Boolean Match endpoint
  // Checks if provided data matches the BVN record

  async validateBVN(data: {
    bvn: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    email?: string;
    gender?: string;
  }): Promise<{
    success: boolean;
    message: string;
    kycData?: QoreIDKYCData;
  }> {
    try {
      logger.info(`[QoreID] Validating BVN: ${data.bvn}`);

      const token = await this.getAccessToken();

      const payload: any = {};
      if (data.firstName) payload.firstname = data.firstName.trim();
      if (data.lastName) payload.lastname = data.lastName.trim();
      if (data.dateOfBirth) payload.dob = data.dateOfBirth.trim();
      if (data.phoneNumber) payload.phone = data.phoneNumber.trim();
      if (data.email) payload.email = data.email.trim();
      if (data.gender) payload.gender = data.gender.trim();

      const response = await this.client.post<QoreIDBVNMatchResponse>(
        `/v1/ng/identities/bvn-match/${data.bvn.trim()}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      logger.info(
        `[QoreID] BVN validation response status: ${response.status}`,
      );

      // Check if API call was successful (state === complete)
      if (
        response.status !== 200 ||
        !response.data?.status ||
        response.data.status.state !== "complete"
      ) {
        const errorMessage =
          (response.data as any)?.message ||
          (response.data as any)?.error ||
          "BVN validation failed";

        logger.error(`[QoreID] BVN validation failed:`, {
          status: response.status,
          error: errorMessage,
          apiState: response.data?.status?.state,
          bvn: data.bvn,
        });

        throw new AppError(
          "BVN validation failed. Please check your details and try again.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check if verification was successful (status === verified)
      if (response.data.status.status !== "verified") {
        logger.warn(`[QoreID] BVN not verified:`, {
          verificationStatus: response.data.status.status,
          bvn: data.bvn,
        });

        throw new AppError(
          `BVN verification ${response.data.status.status}. Details may not match your BVN record.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check match status from summary
      const bvnMatchCheck = response.data.summary?.bvn_match_check;
      logger.info(`[QoreID] BVN match status: ${bvnMatchCheck?.status}`, {
        fieldMatches: bvnMatchCheck?.fieldMatches,
      });

      if (
        bvnMatchCheck?.status !== "EXACT_MATCH" &&
        bvnMatchCheck?.status !== "PARTIAL_MATCH"
      ) {
        throw new AppError(
          `BVN validation result: ${bvnMatchCheck?.status}. Please verify your details.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`[QoreID] BVN validation successful: ${data.bvn}`);

      // Return KYC data in standardized format
      const kycData: QoreIDKYCData = {
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        dateOfBirth: data.dateOfBirth,
        phoneNumber: data.phoneNumber,
        bvn: data.bvn,
        // email: data.email,
        gender: data.gender,
      };

      return {
        success: true,
        message: "BVN validated successfully",
        kycData,
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(`[QoreID] BVN validation error:`, {
        error: error.message,
        bvn: data.bvn,
      });

      throw new AppError(
        "BVN validation failed. Please try again later.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Validate NIN

  async validateNIN(data: {
    nin: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    email?: string;
    gender?: string;
  }): Promise<{
    success: boolean;
    message: string;
    kycData?: QoreIDKYCData;
  }> {
    try {
      logger.info(`[QoreID] Validating NIN: ${data.nin}`);

      const token = await this.getAccessToken();

      const payload: any = {};
      if (data.firstName) payload.firstname = data.firstName.trim();
      if (data.lastName) payload.lastname = data.lastName.trim();
      if (data.dateOfBirth) payload.dob = data.dateOfBirth.trim();
      if (data.phoneNumber) payload.phone = data.phoneNumber.trim();
      if (data.email) payload.email = data.email.trim();
      if (data.gender) payload.gender = data.gender.trim();

      const response = await this.client.post<QoreIDNINResponse>(
        `/v1/ng/identities/nin/${data.nin.trim()}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      logger.info(
        `[QoreID] NIN validation response status: ${response.status}`,
      );

      // Check if API call was successful
      if (
        response.status !== 200 ||
        !response.data?.status ||
        response.data.status.state !== "complete"
      ) {
        const errorMessage =
          (response.data as any)?.message ||
          (response.data as any)?.error ||
          "NIN validation failed";

        logger.error(`[QoreID] NIN validation failed:`, {
          status: response.status,
          error: errorMessage,
          apiState: response.data?.status?.state,
          nin: data.nin,
        });

        throw new AppError(
          "NIN validation failed. Please check your details and try again.",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check if verification was successful
      if (response.data.status.status !== "verified") {
        logger.warn(`[QoreID] NIN not verified:`, {
          verificationStatus: response.data.status.status,
          nin: data.nin,
        });

        throw new AppError(
          `NIN verification ${response.data.status.status}. Details may not match your NIN record.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check match status
      const ninCheck = response.data.summary?.nin_check;
      logger.info(`[QoreID] NIN match status: ${ninCheck?.status}`, {
        fieldMatches: ninCheck?.fieldMatches,
      });

      // Accept EXACT_MATCH or PARTIAL_MATCH
      if (
        ninCheck?.status !== "EXACT_MATCH" &&
        ninCheck?.status !== "PARTIAL_MATCH"
      ) {
        throw new AppError(
          `NIN validation result: ${ninCheck?.status}. Please verify your details.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`[QoreID] NIN validation successful: ${data.nin}`);

      // Extract and format KYC data from response
      const ninData = response.data.nin;
      const kycData: QoreIDKYCData = {
        firstName: ninData?.firstname || data.firstName || "",
        lastName: ninData?.lastname || data.lastName || "",
        middleName: ninData?.middlename,
        dateOfBirth: ninData?.birthdate
          ? this.convertDateFormat(ninData.birthdate)
          : data.dateOfBirth,
        phoneNumber: ninData?.phone || data.phoneNumber,
        nin: data.nin,
        gender: ninData?.gender || data.gender,
        address: ninData?.address,
      };

      return {
        success: true,
        message: "NIN validated successfully",
        kycData,
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(`[QoreID] NIN validation error:`, {
        error: error.message,
        nin: data.nin,
      });

      throw new AppError(
        "NIN validation failed. Please try again later.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }
}
