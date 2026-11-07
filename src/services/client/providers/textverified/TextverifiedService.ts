import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  TextverifiedAuthResponse,
  TextverifiedAccountResponse,
  TextverifiedServiceItem,
  TextverifiedAreaCodeItem,
  TextverifiedVerificationRequest,
  TextverifiedVerificationResponse,
  TextverifiedSmsItem,
  TextverifiedSmsListResponse,
} from "@/types/textverified";

export class TextverifiedService {
  private client: AxiosInstance;
  private provider = PROVIDERS.TEXTVERIFIED;
  private cachedToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl.replace(/\/$/, ""),
      timeout: 25000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Request interceptor to attach Bearer token
    this.client.interceptors.request.use(async (config) => {
      // Don't attach token for auth endpoint itself
      if (config.url?.includes("/api/pub/v2/auth")) {
        return config;
      }

      const token = await this.getBearerToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      logger.debug("TEXTVERIFIED_RAW_REQUEST", {
        method: config.method,
        url: config.url,
        params: config.params,
        data: config.data,
      });

      return config;
    });

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("TEXTVERIFIED_RAW_RESPONSE", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error("TEXTVERIFIED_RAW_ERROR", {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Token Lifecycle Management
  // ---------------------------------------------------------------------------
  public async getBearerToken(): Promise<string> {
    const now = Date.now();

    // Reuse existing valid token if not expiring in the next 60 seconds
    if (
      this.cachedToken &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt.getTime() - now > 60000
    ) {
      return this.cachedToken;
    }

    // Coalesce concurrent token refresh calls
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.fetchNewBearerToken();
    try {
      const token = await this.tokenRefreshPromise;
      return token;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  private async fetchNewBearerToken(): Promise<string> {
    try {
      if (!this.provider.apiKey || !this.provider.apiUsername) {
        throw new AppError(
          "Textverified API credentials not configured (TEXTVERIFIED_API_KEY / TEXTVERIFIED_API_USERNAME)",
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.CONFIGURATION_ERROR,
        );
      }

      logger.info("TextverifiedService: Generating new Bearer token");

      const response = await axios.post<TextverifiedAuthResponse>(
        `${this.provider.baseUrl.replace(/\/$/, "")}/api/pub/v2/auth`,
        {},
        {
          headers: {
            "X-API-KEY": this.provider.apiKey,
            "X-API-USERNAME": this.provider.apiUsername,
          },
          timeout: 15000,
        },
      );

      const data = response.data;
      if (!data?.token) {
        throw new AppError(
          "Failed to obtain bearer token from Textverified",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      this.cachedToken = data.token;
      this.tokenExpiresAt = new Date(data.expiresAt);

      logger.info("TextverifiedService: Bearer token generated successfully", {
        expiresAt: this.tokenExpiresAt.toISOString(),
      });

      return this.cachedToken;
    } catch (err: any) {
      this.cachedToken = null;
      this.tokenExpiresAt = null;
      throw this.handleError(err, "fetchNewBearerToken");
    }
  }

  private handleError(error: any, context: string): never {
    if (error instanceof AppError) throw error;

    const status = error.response?.status;
    const data = error.response?.data;
    const errorCode = data?.errorCode || data?.ErrorCode;
    const msg = data?.message || data?.error || error.message || `Textverified error during ${context}`;

    if (status === 401) {
      this.cachedToken = null; // Clear cached token on 401
      throw new AppError(
        "Textverified Authentication Failed (Invalid or expired credentials)",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }

    if (status === 400 && errorCode === "InsufficientBalance") {
      throw new AppError(
        "Textverified provider account has insufficient credit balance",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    if (status === 400 && errorCode === "Unavailable") {
      throw new AppError(
        "No virtual phone numbers currently available for this service on Textverified",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (status === 400 && errorCode === "PricingFailure") {
      throw new AppError(
        "The requested service price exceeds the allowed budget or is currently unavailable",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    if (status === 400 && errorCode === "TooManyUnfinishedVerifications") {
      throw new AppError(
        "Too many active unfinished verifications. Please wait a few minutes and try again.",
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
      );
    }

    throw new AppError(
      msg,
      status && status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Account Details
  // ---------------------------------------------------------------------------
  async getAccount(): Promise<TextverifiedAccountResponse> {
    return SentryHelper.trackCriticalOperation("textverified_get_account", async () => {
      try {
        const res = await this.client.get<TextverifiedAccountResponse>("/api/pub/v2/account/me");
        return res.data;
      } catch (err: any) {
        this.handleError(err, "getAccount");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Services List
  // ---------------------------------------------------------------------------
  async getServices(): Promise<TextverifiedServiceItem[]> {
    return SentryHelper.trackCriticalOperation("textverified_get_services", async () => {
      try {
        const res = await this.client.get<TextverifiedServiceItem[]>("/api/pub/v2/services", {
          params: {
            numberType: "mobile",
            reservationType: "verification",
          },
        });
        return res.data || [];
      } catch (err: any) {
        this.handleError(err, "getServices");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Area Codes List
  // ---------------------------------------------------------------------------
  async getAreaCodes(): Promise<TextverifiedAreaCodeItem[]> {
    return SentryHelper.trackCriticalOperation("textverified_get_area_codes", async () => {
      try {
        const res = await this.client.get<TextverifiedAreaCodeItem[]>("/api/pub/v2/area-codes");
        return res.data || [];
      } catch (err: any) {
        this.handleError(err, "getAreaCodes");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Preflight Pricing & Inventory
  // ---------------------------------------------------------------------------
  async getPrice(serviceName: string, options?: { areaCode?: boolean; carrier?: boolean }): Promise<number> {
    return SentryHelper.trackCriticalOperation("textverified_get_price", async () => {
      try {
        const res = await this.client.post("/api/pub/v2/pricing/verifications", {
          serviceName,
          areaCode: Boolean(options?.areaCode),
          carrier: Boolean(options?.carrier),
          numberType: "mobile",
          capability: "sms",
        });
        const price = res.data?.price !== undefined ? res.data.price : res.data?.Price;
        return typeof price === "number" ? price : parseFloat(String(price || 0));
      } catch (err: any) {
        this.handleError(err, `getPrice(${serviceName})`);
      }
    });
  }

  async getInventory(serviceName: string): Promise<number> {
    return SentryHelper.trackCriticalOperation("textverified_get_inventory", async () => {
      try {
        const res = await this.client.post("/api/pub/v2/inventory/verifications", {
          serviceName,
          numberType: "mobile",
          capability: "sms",
        });
        const quantity =
          res.data?.availableQuantity !== undefined
            ? res.data.availableQuantity
            : res.data?.AvailableQuantity;
        return Number(quantity || 0);
      } catch (err: any) {
        this.handleError(err, `getInventory(${serviceName})`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Create Verification (Purchase Real US Mobile Number)
  // ---------------------------------------------------------------------------
  async createVerification(params: {
    serviceName: string;
    areaCode?: string;
    carrier?: string;
    maxPrice?: number;
    idempotencyKey?: string;
  }): Promise<TextverifiedVerificationResponse> {
    return SentryHelper.trackCriticalOperation("textverified_create_verification", async () => {
      try {
        const payload: TextverifiedVerificationRequest = {
          serviceName: params.serviceName,
          capability: "sms",
          ...(params.areaCode ? { areaCodeSelectOption: [params.areaCode] } : {}),
          ...(params.carrier ? { carrierSelectOption: [params.carrier] } : {}),
          ...(params.maxPrice ? { maxPrice: params.maxPrice } : {}),
        };

        const headers: Record<string, string> = {};
        if (params.idempotencyKey) {
          headers["Idempotency-Key"] = params.idempotencyKey;
        }

        logger.info("TextverifiedService: Creating verification", payload);
        const res = await this.client.post("/api/pub/v2/verifications", payload, { headers });

        // Textverified returns HTTP 201 with Location header
        const location = res.headers.location || res.data?.href;
        let verificationId = res.data?.id;
        if (!verificationId && location) {
          verificationId = String(location).split("/").filter(Boolean).pop();
        }

        if (verificationId && (!res.data?.number || !res.data?.state)) {
          // Follow up to fetch complete verification details
          return await this.getVerification(verificationId);
        }

        return res.data;
      } catch (err: any) {
        this.handleError(err, `createVerification(${params.serviceName})`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Get Verification Details & Incoming SMS
  // ---------------------------------------------------------------------------
  async getVerification(id: string): Promise<TextverifiedVerificationResponse> {
    return SentryHelper.trackCriticalOperation("textverified_get_verification", async () => {
      try {
        const res = await this.client.get<TextverifiedVerificationResponse>(`/api/pub/v2/verifications/${id}`);
        return res.data;
      } catch (err: any) {
        this.handleError(err, `getVerification(${id})`);
      }
    });
  }

  async getSms(reservationId: string): Promise<TextverifiedSmsItem[]> {
    return SentryHelper.trackCriticalOperation("textverified_get_sms", async () => {
      try {
        const res = await this.client.get<TextverifiedSmsListResponse>("/api/pub/v2/sms", {
          params: { reservationId },
        });
        return res.data?.data || [];
      } catch (err: any) {
        this.handleError(err, `getSms(${reservationId})`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Lifecycle Actions: Cancel, Report, Reuse, Reactivate
  // ---------------------------------------------------------------------------
  async cancelVerification(id: string): Promise<void> {
    return SentryHelper.trackCriticalOperation("textverified_cancel_verification", async () => {
      try {
        logger.info(`TextverifiedService: Cancelling verification ${id}`);
        await this.client.post(`/api/pub/v2/verifications/${id}/cancel`);
      } catch (err: any) {
        this.handleError(err, `cancelVerification(${id})`);
      }
    });
  }

  async reportVerification(id: string): Promise<void> {
    return SentryHelper.trackCriticalOperation("textverified_report_verification", async () => {
      try {
        logger.info(`TextverifiedService: Reporting verification ${id}`);
        await this.client.post(`/api/pub/v2/verifications/${id}/report`);
      } catch (err: any) {
        this.handleError(err, `reportVerification(${id})`);
      }
    });
  }

  async reuseVerification(id: string): Promise<TextverifiedVerificationResponse> {
    return SentryHelper.trackCriticalOperation("textverified_reuse_verification", async () => {
      try {
        logger.info(`TextverifiedService: Reusing verification ${id}`);
        const res = await this.client.post(`/api/pub/v2/verifications/${id}/reuse`);
        const location = res.headers.location || res.data?.href;
        let newId = res.data?.id;
        if (!newId && location) {
          newId = String(location).split("/").filter(Boolean).pop();
        }
        if (newId && (!res.data?.number || !res.data?.state)) {
          return await this.getVerification(newId);
        }
        return res.data;
      } catch (err: any) {
        this.handleError(err, `reuseVerification(${id})`);
      }
    });
  }

  async reactivateVerification(id: string): Promise<TextverifiedVerificationResponse> {
    return SentryHelper.trackCriticalOperation("textverified_reactivate_verification", async () => {
      try {
        logger.info(`TextverifiedService: Reactivating verification ${id}`);
        const res = await this.client.post(`/api/pub/v2/verifications/${id}/reactivate`);
        const location = res.headers.location || res.data?.href;
        let newId = res.data?.id;
        if (!newId && location) {
          newId = String(location).split("/").filter(Boolean).pop();
        }
        if (newId && (!res.data?.number || !res.data?.state)) {
          return await this.getVerification(newId);
        }
        return res.data;
      } catch (err: any) {
        this.handleError(err, `reactivateVerification(${id})`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 8. HMAC-SHA512 Webhook Validation
  // ---------------------------------------------------------------------------
  public verifyWebhookSignature(signatureHeader: string, rawBody: string | Buffer): boolean {
    const secret = this.provider.webhookSecret;
    if (!secret || !signatureHeader) return false;

    try {
      // Signature header format: "HMAC-SHA512=<base64-signature>"
      const signature = signatureHeader.replace(/^HMAC-SHA512=/i, "").trim();

      const hmac = crypto.createHmac("sha512", secret);
      hmac.update(rawBody);
      const computedBase64 = hmac.digest("base64");

      const sigBuffer = Buffer.from(signature, "base64");
      const compBuffer = Buffer.from(computedBase64, "base64");

      if (sigBuffer.length !== compBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, compBuffer);
    } catch (err) {
      logger.error("Textverified webhook signature verification error", err);
      return false;
    }
  }
}
