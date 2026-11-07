import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  FiveSimProfileResponse,
  FiveSimCountriesResponse,
  FiveSimProductsResponse,
  FiveSimOrderResponse,
  FiveSimInboxResponse,
} from "@/types/fivesim";

export class FiveSimService {
  private client: AxiosInstance;
  private provider = PROVIDERS.FIVESIM;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl.replace(/\/$/, ""),
      timeout: 25000,
      headers: {
        Accept: "application/json",
      },
    });

    // Request interceptor
    this.client.interceptors.request.use((config) => {
      const token = this.provider.apiKey;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      logger.debug("FIVESIM_RAW_REQUEST", {
        method: config.method,
        url: config.url,
        params: config.params,
      });
      return config;
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("FIVESIM_RAW_RESPONSE", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error("FIVESIM_RAW_ERROR", {
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
   * Helper to execute GET requests with unified error parsing
   */
  private async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    try {
      const response = await this.client.get<T>(url, { params });
      const data: any = response.data;

      // 5SIM sometimes returns plain text error with 200 status (e.g. "no free phones")
      if (typeof data === "string") {
        const trimmed = data.trim();
        if (
          trimmed === "no free phones" ||
          trimmed === "not enough user balance" ||
          trimmed === "not enough rating" ||
          trimmed === "bad country" ||
          trimmed === "bad operator" ||
          trimmed === "no product" ||
          trimmed === "server offline"
        ) {
          throw new AppError(
            `5SIM Error: ${trimmed}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new AppError(
          String(data.error),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      const status = error.response?.status;
      const rawData = error.response?.data;
      const errorMsg =
        typeof rawData === "string"
          ? rawData
          : rawData?.message || rawData?.error || error.message;

      if (status === 401) {
        throw new AppError(
          "5SIM Authentication failed (Invalid API Token)",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.AUTHENTICATION_ERROR,
        );
      }

      if (status === 429) {
        throw new AppError(
          "5SIM rate limit reached. Please retry in a few moments.",
          HTTP_STATUS.TOO_MANY_REQUESTS,
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
        );
      }

      if (status === 404) {
        throw new AppError(
          errorMsg || "5SIM resource not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      throw new AppError(
        errorMsg || "5SIM request failed",
        status && status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // ===========================================================================
  // 1. User & Account Endpoints
  // ===========================================================================

  /**
   * Get user profile data: email, balance, rating, default country
   * GET /v1/user/profile
   */
  async getProfile(): Promise<FiveSimProfileResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_get_profile",
      async () => {
        return await this.get<FiveSimProfileResponse>("/user/profile");
      },
      "profile",
    );
  }

  // ===========================================================================
  // 2. Reference & Catalog Endpoints (Guest)
  // ===========================================================================

  /**
   * Returns a list of all countries with available operators.
   * GET /v1/guest/countries
   */
  async getCountries(): Promise<FiveSimCountriesResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_get_countries",
      async () => {
        return await this.get<FiveSimCountriesResponse>("/guest/countries");
      },
      "countries",
    );
  }

  /**
   * Get available products, quantity, and price for a given country and operator.
   * GET /v1/guest/products/{country}/{operator}
   * country: e.g. "england", "russia", "any"
   * operator: e.g. "vodafone", "any"
   */
  async getProducts(
    country: string = "any",
    operator: string = "any",
  ): Promise<FiveSimProductsResponse> {
    const safeCountry = encodeURIComponent(country.toLowerCase().trim());
    const safeOperator = encodeURIComponent(operator.toLowerCase().trim());
    return SentryHelper.trackCriticalOperation(
      "fivesim_get_products",
      async () => {
        return await this.get<FiveSimProductsResponse>(
          `/guest/products/${safeCountry}/${safeOperator}`,
        );
      },
      `${safeCountry}_${safeOperator}`,
    );
  }

  /**
   * Get detailed product prices and quantities.
   * GET /v1/guest/prices?country={country}&product={product}
   */
  async getPrices(country?: string, product?: string): Promise<any> {
    const params: Record<string, string> = {};
    if (country) params.country = country.toLowerCase().trim();
    if (product) params.product = product.toLowerCase().trim();

    return SentryHelper.trackCriticalOperation(
      "fivesim_get_prices",
      async () => {
        return await this.get<any>("/guest/prices", params);
      },
      country || "all",
    );
  }

  // ===========================================================================
  // 3. Purchase Endpoints
  // ===========================================================================

  /**
   * Buy activation number for receiving OTP SMS.
   * GET /v1/user/buy/activation/{country}/{operator}/{product}
   */
  async buyActivationNumber(params: {
    country: string;
    operator?: string;
    product: string;
    maxPrice?: number;
    forwarding?: boolean;
    number?: string;
    reuse?: boolean;
    voice?: boolean;
    ref?: string;
  }): Promise<FiveSimOrderResponse> {
    const country = encodeURIComponent((params.country || "any").toLowerCase().trim());
    const operator = encodeURIComponent((params.operator || "any").toLowerCase().trim());
    const product = encodeURIComponent(params.product.toLowerCase().trim());

    const queryParams: Record<string, any> = {};
    if (params.maxPrice !== undefined) queryParams.maxPrice = params.maxPrice;
    if (params.forwarding) queryParams.forwarding = "true";
    if (params.number) queryParams.number = params.number;
    if (params.reuse) queryParams.reuse = "1";
    if (params.voice) queryParams.voice = "1";
    if (params.ref) queryParams.ref = params.ref;

    return SentryHelper.trackCriticalOperation(
      "fivesim_buy_activation",
      async () => {
        logger.info("FiveSimService: buying activation number", {
          country,
          operator,
          product,
        });
        const order = await this.get<FiveSimOrderResponse>(
          `/user/buy/activation/${country}/${operator}/${product}`,
          queryParams,
        );

        if (!order || !order.id || !order.phone) {
          throw new AppError(
            "5SIM did not return a valid phone number or order ID",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }

        return order;
      },
      `${country}_${product}`,
    );
  }

  // ===========================================================================
  // 4. Order Management & SMS Checking
  // ===========================================================================

  /**
   * Check order status and get incoming SMS.
   * GET /v1/user/check/{id}
   */
  async checkOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_check_order",
      async () => {
        const id = encodeURIComponent(String(orderId).trim());
        return await this.get<FiveSimOrderResponse>(`/user/check/${id}`);
      },
      String(orderId),
    );
  }

  /**
   * Finish order once SMS code is received.
   * Calling finish boosts account rating by +0.5 points.
   * GET /v1/user/finish/{id}
   */
  async finishOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_finish_order",
      async () => {
        const id = encodeURIComponent(String(orderId).trim());
        logger.info(`FiveSimService: finishing order ${id} to earn rating points`);
        return await this.get<FiveSimOrderResponse>(`/user/finish/${id}`);
      },
      String(orderId),
    );
  }

  /**
   * Cancel order (refunds balance to 5sim account if no SMS received yet).
   * GET /v1/user/cancel/{id}
   */
  async cancelOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_cancel_order",
      async () => {
        const id = encodeURIComponent(String(orderId).trim());
        logger.info(`FiveSimService: cancelling order ${id}`);
        return await this.get<FiveSimOrderResponse>(`/user/cancel/${id}`);
      },
      String(orderId),
    );
  }

  /**
   * Ban order if the phone number was already used or banned on the target service.
   * GET /v1/user/ban/{id}
   */
  async banOrder(orderId: number | string): Promise<FiveSimOrderResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_ban_order",
      async () => {
        const id = encodeURIComponent(String(orderId).trim());
        logger.info(`FiveSimService: banning order ${id}`);
        return await this.get<FiveSimOrderResponse>(`/user/ban/${id}`);
      },
      String(orderId),
    );
  }

  /**
   * Get SMS inbox list for hosted/rented numbers.
   * GET /v1/user/sms/inbox/{id}
   */
  async getSmsInbox(orderId: number | string): Promise<FiveSimInboxResponse> {
    return SentryHelper.trackCriticalOperation(
      "fivesim_sms_inbox",
      async () => {
        const id = encodeURIComponent(String(orderId).trim());
        return await this.get<FiveSimInboxResponse>(`/user/sms/inbox/${id}`);
      },
      String(orderId),
    );
  }
}
