import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  FleexaBaseResponse,
  FleexaProfileData,
  FleexaBalanceData,
  FleexaSms4Country,
  FleexaSms4App,
  FleexaSms4PriceData,
  FleexaSms4BuyData,
  FleexaSms4CheckData,
  FleexaSms5Product,
  FleexaSms5App,
  FleexaSms5BuyData,
  FleexaSms5CheckData,
  FleexaEmailProduct,
  FleexaEmailDomain,
  FleexaEmailBuyData,
  FleexaEmailCheckData,
} from "@/types/fleexa";

export class FleexaService {
  private client: AxiosInstance;
  private provider = PROVIDERS.FLEEXA;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl.replace(/\/$/, ""),
      timeout: 25000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Request interceptor
    this.client.interceptors.request.use((config) => {
      const apiKey = this.provider.apiKey;
      if (apiKey) {
        config.headers.Authorization = `Bearer ${apiKey}`;
      }
      logger.debug("FLEEXA_RAW_REQUEST", {
        method: config.method,
        url: config.url,
        params: config.params,
        data: config.data,
      });
      return config;
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("FLEEXA_RAW_RESPONSE", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error("FLEEXA_RAW_ERROR", {
          status,
          data,
          message: error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      },
    );
  }

  /**
   * Universal response handler for Fleexa JSON responses
   */
  private handleResponse<T>(response: any): T {
    const body: FleexaBaseResponse<T> = response.data;

    if (body && typeof body === "object") {
      if (body.success === false) {
        throw new AppError(
          body.message || "Fleexa operation failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
      // If data is encapsulated in body.data, return that, otherwise return body
      return (body.data !== undefined ? body.data : body) as T;
    }

    return response.data as T;
  }

  private handleError(error: any, context: string): never {
    if (error instanceof AppError) throw error;

    const status = error.response?.status;
    const data = error.response?.data;
    const msg = data?.message || data?.error || error.message || `Fleexa error during ${context}`;

    if (status === 401) {
      throw new AppError(
        "Fleexa Authentication Failed (Invalid or expired API Key)",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }

    if (status === 403) {
      throw new AppError(
        `Fleexa Forbidden: ${msg}`,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    if (status === 429) {
      throw new AppError(
        "Fleexa rate limit exceeded (60 req/min). Please try again shortly.",
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

  // ===========================================================================
  // 1. Account & Balance
  // ===========================================================================

  async getProfile(): Promise<FleexaProfileData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_get_profile",
      async () => {
        try {
          const res = await this.client.get("/profile");
          return this.handleResponse<FleexaProfileData>(res);
        } catch (err: any) {
          this.handleError(err, "getProfile");
        }
      },
      "profile",
    );
  }

  async getBalance(): Promise<FleexaBalanceData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_get_balance",
      async () => {
        try {
          const res = await this.client.get("/balance");
          return this.handleResponse<FleexaBalanceData>(res);
        } catch (err: any) {
          this.handleError(err, "getBalance");
        }
      },
      "balance",
    );
  }

  // ===========================================================================
  // 2. SMS OTP 4 (US Virtual Numbers)
  // ===========================================================================

  async getSms4Countries(): Promise<FleexaSms4Country[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_countries",
      async () => {
        try {
          const res = await this.client.get("/sms4/countries");
          return this.handleResponse<FleexaSms4Country[]>(res);
        } catch (err: any) {
          this.handleError(err, "getSms4Countries");
        }
      },
      "sms4_countries",
    );
  }

  async getSms4Apps(): Promise<FleexaSms4App[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_apps",
      async () => {
        try {
          const res = await this.client.get("/sms4/apps");
          return this.handleResponse<FleexaSms4App[]>(res);
        } catch (err: any) {
          this.handleError(err, "getSms4Apps");
        }
      },
      "sms4_apps",
    );
  }

  async getSms4Price(serviceName: string, areaCode?: boolean): Promise<FleexaSms4PriceData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_price",
      async () => {
        try {
          const params: Record<string, any> = { serviceName };
          if (areaCode) params.areaCode = "true";
          const res = await this.client.get("/sms4/prices", { params });
          return this.handleResponse<FleexaSms4PriceData>(res);
        } catch (err: any) {
          this.handleError(err, `getSms4Price(${serviceName})`);
        }
      },
      serviceName,
    );
  }

  async buySms4Number(params: {
    serviceName: string;
    maxPrice?: string | number;
    areaCode?: string;
    capability?: string;
  }): Promise<FleexaSms4BuyData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_buy",
      async () => {
        try {
          logger.info("FleexaService: buying SMS4 number", params);
          const res = await this.client.post("/sms4/buy", params);
          return this.handleResponse<FleexaSms4BuyData>(res);
        } catch (err: any) {
          this.handleError(err, `buySms4Number(${params.serviceName})`);
        }
      },
      params.serviceName,
    );
  }

  async checkSms4Status(requestId: string | number): Promise<FleexaSms4CheckData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_check",
      async () => {
        try {
          const res = await this.client.get(`/sms4/check/${encodeURIComponent(String(requestId))}`);
          return this.handleResponse<FleexaSms4CheckData>(res);
        } catch (err: any) {
          this.handleError(err, `checkSms4Status(${requestId})`);
        }
      },
      String(requestId),
    );
  }

  async cancelSms4(params: {
    requestId?: string | number;
    activation_id?: string;
  }): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms4_cancel",
      async () => {
        try {
          const res = await this.client.post("/sms4/cancel", params);
          return this.handleResponse(res);
        } catch (err: any) {
          this.handleError(err, "cancelSms4");
        }
      },
      String(params.requestId || params.activation_id),
    );
  }

  // ===========================================================================
  // 3. SMS OTP 5 (Alternative US SMS Engine)
  // ===========================================================================

  async getSms5Products(): Promise<FleexaSms5Product[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms5_products",
      async () => {
        try {
          const res = await this.client.get("/sms5/products");
          return this.handleResponse<FleexaSms5Product[]>(res);
        } catch (err: any) {
          this.handleError(err, "getSms5Products");
        }
      },
      "sms5_products",
    );
  }

  async getSms5Apps(): Promise<FleexaSms5App[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms5_apps",
      async () => {
        try {
          const res = await this.client.get("/sms5/apps");
          return this.handleResponse<FleexaSms5App[]>(res);
        } catch (err: any) {
          this.handleError(err, "getSms5Apps");
        }
      },
      "sms5_apps",
    );
  }

  async buySms5Number(params: {
    serviceName: string;
    maxPrice?: string | number;
    areaCode?: string;
  }): Promise<FleexaSms5BuyData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms5_buy",
      async () => {
        try {
          logger.info("FleexaService: buying SMS5 number", params);
          const res = await this.client.post("/sms5/buy", params);
          return this.handleResponse<FleexaSms5BuyData>(res);
        } catch (err: any) {
          this.handleError(err, `buySms5Number(${params.serviceName})`);
        }
      },
      params.serviceName,
    );
  }

  async checkSms5Status(requestId: string | number): Promise<FleexaSms5CheckData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_sms5_check",
      async () => {
        try {
          const res = await this.client.get(`/sms5/check/${encodeURIComponent(String(requestId))}`);
          return this.handleResponse<FleexaSms5CheckData>(res);
        } catch (err: any) {
          this.handleError(err, `checkSms5Status(${requestId})`);
        }
      },
      String(requestId),
    );
  }

  // ===========================================================================
  // 4. Email OTP (Temporary Disposable Email Verification)
  // ===========================================================================

  async getEmailProducts(): Promise<FleexaEmailProduct[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_products",
      async () => {
        try {
          const res = await this.client.get("/email/products");
          return this.handleResponse<FleexaEmailProduct[]>(res);
        } catch (err: any) {
          this.handleError(err, "getEmailProducts");
        }
      },
      "email_products",
    );
  }

  async getEmailDomains(site: string): Promise<FleexaEmailDomain[]> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_domains",
      async () => {
        try {
          const res = await this.client.get("/email/domains", {
            params: { site },
          });
          return this.handleResponse<FleexaEmailDomain[]>(res);
        } catch (err: any) {
          this.handleError(err, `getEmailDomains(${site})`);
        }
      },
      site,
    );
  }

  async searchEmailSite(q: string): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_search_site",
      async () => {
        try {
          const res = await this.client.get("/email/search-site", {
            params: { q },
          });
          return this.handleResponse(res);
        } catch (err: any) {
          this.handleError(err, `searchEmailSite(${q})`);
        }
      },
      q,
    );
  }

  async buyEmail(params: {
    site: string;
    domain: string;
  }): Promise<FleexaEmailBuyData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_buy",
      async () => {
        try {
          logger.info("FleexaService: buying Email OTP", params);
          const res = await this.client.post("/email/buy", params);
          return this.handleResponse<FleexaEmailBuyData>(res);
        } catch (err: any) {
          this.handleError(err, `buyEmail(${params.site}, ${params.domain})`);
        }
      },
      `${params.site}_${params.domain}`,
    );
  }

  async checkEmailStatus(emailId: string): Promise<FleexaEmailCheckData> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_check",
      async () => {
        try {
          const res = await this.client.get(`/email/check/${encodeURIComponent(emailId)}`);
          return this.handleResponse<FleexaEmailCheckData>(res);
        } catch (err: any) {
          this.handleError(err, `checkEmailStatus(${emailId})`);
        }
      },
      emailId,
    );
  }

  async cancelEmail(emailId: string): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "fleexa_email_cancel",
      async () => {
        try {
          const res = await this.client.post("/email/cancel", { requestId: emailId });
          return this.handleResponse(res);
        } catch (err: any) {
          this.handleError(err, `cancelEmail(${emailId})`);
        }
      },
      emailId,
    );
  }
}
