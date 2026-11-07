import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import qs from "qs";
import {
  OwletSmmServiceItem,
  OwletSmmServiceItemNormalised,
  NigeriaSmmOrderResponse,
  NigeriaSmmOrderStatus,
  NigeriaSmmMultiOrderStatus,
  NigeriaSmmBalance,
  NigeriaSmmRefillResponse,
  NigeriaSmmCancelResponse,
  SmmSabiOrderFields,
  OwletSmmRefillStatusResponse,
  OwletSmmProofsResponse,
} from "@/types/smm";

// =============================================================================
// Type Definitions — all Owlet module types in one place
// =============================================================================

// Capabilities
export interface OwletCapabilitiesResponse {
  api?: string;
  products?: Array<{
    key: string;
    live: boolean;
    actions?: string[];
    note?: string;
  }>;
  [key: string]: any;
}

// Gamerzone — Game Top-ups & Gaming Access Cards
export interface OwletGameProduct {
  product: string;
  name: string;
  [key: string]: any;
}

export interface OwletGamePackageField {
  key: string;
  label: string;
  required: boolean;
  type?: string;
  placeholder?: string;
}

export interface OwletGamePackage {
  sku: string;
  name: string;
  price: number;
  fields: OwletGamePackageField[];
  [key: string]: any;
}

export interface OwletGameTopupRawResponse {
  order?: string | number;
  status?: string;
  message?: string;
  card?: string;
  code?: string;
  pin?: string;
  [key: string]: any;
}

export interface OwletGameTopupResult {
  success: boolean;
  owletOrder: string;
  status: string;
  reference: string;
  message: string;
  card?: string;
  code?: string;
  pin?: string;
  data: OwletGameTopupRawResponse;
}

// Talktiyu — Virtual Phone Number Rental & OTP
export interface OwletNumberService {
  service: string;
  name: string;
  price: number;
  [key: string]: any;
}

export interface OwletRentNumberRawResponse {
  order?: string | number;
  number?: string;
  status?: string;
  message?: string;
  [key: string]: any;
}

export interface OwletRentNumberResult {
  success: boolean;
  owletOrder: string;
  number: string;
  status: string;
  reference: string;
  message: string;
  data: OwletRentNumberRawResponse;
}

export interface OwletOtpRawResponse {
  status?: string;
  number?: string;
  code?: string;
  message?: string;
  [key: string]: any;
}

export interface OwletOtpResult {
  owletOrder: string;
  status: string;
  code?: string;
  number?: string;
  message?: string;
  /**
   * true when Owlet has refunded their balance (status is "expired" or "refunded").
   * The caller should trigger a user wallet refund in this case.
   */
  shouldRefundUser: boolean;
  data: OwletOtpRawResponse;
}

// Rhombus — Proxies
export interface OwletProxyProduct {
  product: string;
  name: string;
  [key: string]: any;
}

export interface OwletBuyProxyRawResponse {
  order?: string | number;
  status?: string;
  proxies?: string[];
  message?: string;
  [key: string]: any;
}

export interface OwletBuyProxyResult {
  success: boolean;
  owletOrder: string;
  status: string;
  reference: string;
  proxies: string[];
  message: string;
  data: OwletBuyProxyRawResponse;
}

// =============================================================================
// OwletService — unified entry point for all Owlet API verticals
//
// All Owlet modules (SMM, Gamerzone, Talktiyu, Rhombus) share a single base
// URL (https://the-owlet.com/api/v2) and the same API key. This class
// consolidates all modules so that:
//   - Only one axios instance is created (one connection pool, one interceptor).
//   - Only one singleton is needed in the service container.
//   - Adding a new Owlet module requires editing only this file.
// =============================================================================

export class OwletService {
  private readonly client: AxiosInstance;
  private readonly provider = PROVIDERS.OWLET;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    // Request interceptor — structured logging
    this.client.interceptors.request.use((config) => {
      logger.debug("OWLET_RAW_REQUEST", {
        method: config.method,
        url: config.url,
        data: config.data,
      });
      return config;
    });

    // Response interceptor — structured logging + Owlet body-error normalisation
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("OWLET_RAW_RESPONSE", {
          method: response.config.method,
          url: response.config.url,
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error("OWLET_RAW_ERROR", {
          method: error.config?.method,
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Core POST helper — all Owlet API actions are form-encoded POSTs.
  // Injects the API key and normalises Owlet-style body errors.
  // ---------------------------------------------------------------------------
  private async post<T>(params: Record<string, any>): Promise<T> {
    const payload = { key: this.provider.apiKey, ...params };
    const response = await this.client.post("", qs.stringify(payload));
    const data = response.data;

    if (data && typeof data === "object") {
      // 1. Standard "error" property
      if ("error" in data && data.error) {
        const errorMsg =
          typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        throw new AppError(
          errorMsg,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      // 2. Failure status flag with message
      const hasFailedStatus =
        data.status === false ||
        data.status === "failed" ||
        data.status === "error" ||
        data.status === "fail";
      if (hasFailedStatus) {
        const errMsg =
          data.message ||
          data.msg ||
          data.error ||
          data.detail ||
          "Provider rejected the request";
        throw new AppError(
          String(errMsg),
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      // 3. Standalone "errors" collection
      if ("errors" in data && data.errors) {
        const errMsg = Array.isArray(data.errors)
          ? data.errors.join(", ")
          : JSON.stringify(data.errors);
        throw new AppError(
          errMsg,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
    }

    return data as T;
  }

  // ===========================================================================
  // 1. CAPABILITIES & SYSTEM
  // ===========================================================================

  async getCapabilities(): Promise<OwletCapabilitiesResponse> {
    try {
      return await this.post<OwletCapabilitiesResponse>({ action: "capabilities" });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Failed to fetch Owlet capabilities",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // ===========================================================================
  // 2. SOCIAL MEDIA MARKETING (SMM)
  // ===========================================================================

  private resolveServiceId(item: OwletSmmServiceItem): number {
    const raw = item.service ?? item.services;
    if (raw == null) return 0;
    const id = Number(raw);
    return isNaN(id) ? 0 : id;
  }

  /**
   * action=services — fetch the full SMM service catalog.
   * Rates are natively NGN.
   */
  async getServices(): Promise<OwletSmmServiceItemNormalised[]> {
    return SentryHelper.trackCriticalOperation(
      "owlet_get_services",
      async () => {
        try {
          const data = await this.post<OwletSmmServiceItem[]>({
            action: "services",
          });

          if (!Array.isArray(data)) {
            throw new AppError(
              "Unexpected response from Owlet services endpoint",
              HTTP_STATUS.BAD_GATEWAY,
              ERROR_CODES.PROVIDER_ERROR,
            );
          }

          return data.map((item) => {
            const rawCategory = item.category ?? item.Category ?? "";
            const rate = parseFloat(String(item.rate)) || 0;
            return {
              id: this.resolveServiceId(item),
              category: typeof rawCategory === "string" ? rawCategory.trim() : "",
              name: item.name || "",
              type: item.type || "",
              rate,
              rateNgn: rate,
              rateUsd: 0,
              min: parseInt(String(item.min)) || 0,
              max: parseInt(String(item.max)) || 0,
              dripfeed: item.dripfeed,
              refill: item.refill,
              cancel: item.cancel,
              mode: item.mode,
              proof: item.proof,
              targetable: item.targetable,
            };
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet SMM services",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "owlet_catalog",
    );
  }

  /**
   * action=add — place an SMM order with optional SABI real-people fields.
   * IMPORTANT: Non-retryable — no idempotency key on Owlet's side.
   * Returns ambiguous:true on timeout/network error so callers can hold
   * the transaction pending instead of auto-failing.
   */
  async addOrder(params: {
    service: number;
    link: string;
    quantity: number;
    sabiFields?: SmmSabiOrderFields;
  }): Promise<{ success: true; orderId: number } | { success: false; ambiguous: true; message: string }> {
    return SentryHelper.trackCriticalOperation(
      "owlet_add_order",
      async () => {
        try {
          const payload: Record<string, any> = {
            action: "add",
            service: params.service,
            link: params.link,
            quantity: params.quantity,
          };

          if (params.sabiFields) {
            const sf = params.sabiFields;
            if (sf.target) payload.target = sf.target;
            if (sf.gender) payload.gender = sf.gender;
            if (sf.region) payload.region = sf.region;
            if (sf.comments) payload.comments = sf.comments;
            if (sf.comment_gender) payload.comment_gender = sf.comment_gender;
            if (sf.comment_instructions) payload.comment_instructions = sf.comment_instructions;
            if (sf.duration !== undefined) payload.duration = sf.duration;
            if (sf.start_count !== undefined) payload.start_count = sf.start_count;
            if (sf.start_screenshot) payload.start_screenshot = sf.start_screenshot;
          }

          const data = await this.post<any>(payload);

          // Parse order id (number or numeric string, order/order_id/id)
          const rawOrderId = data?.order ?? data?.order_id ?? data?.id;
          const parsedOrderId = Number(rawOrderId);

          if (!isNaN(parsedOrderId) && parsedOrderId > 0) {
            logger.info("OwletService.addOrder: order placed", { orderId: parsedOrderId, ...params });
            return { success: true, orderId: parsedOrderId };
          }

          // Check if provider returned an explicit rejection in payload
          const explicitError =
            data?.error ||
            data?.message ||
            data?.msg ||
            data?.detail ||
            (data?.errors
              ? Array.isArray(data.errors)
                ? data.errors.join(", ")
                : JSON.stringify(data.errors)
              : null);

          if (explicitError) {
            logger.warn("OwletService.addOrder: provider returned explicit rejection", {
              data,
              explicitError,
            });
            throw new AppError(
              String(explicitError),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.PROVIDER_ERROR,
            );
          }

          // Truly unconfirmed response with no order ID and no explicit error message
          logger.warn("OwletService.addOrder: unexpected response shape", { data });
          return {
            success: false,
            ambiguous: true,
            message: "Owlet did not return a valid order ID",
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;

          const isTimeout =
            error.code === "ECONNABORTED" ||
            error.message?.includes("timeout") ||
            !error.response;

          if (isTimeout) {
            logger.error("OwletService.addOrder: ambiguous error (timeout)", {
              params,
              message: error.message,
            });
            return {
              success: false,
              ambiguous: true,
              message:
                "Owlet request timed out — order state is unconfirmed. Check dashboard before retrying.",
            };
          }

          throw new AppError(
            error.message || "Failed to place Owlet SMM order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      params.link,
    );
  }

  /** action=status (single order) */
  async getOrderStatus(orderId: number | string): Promise<NigeriaSmmOrderStatus> {
    return SentryHelper.trackCriticalOperation(
      "owlet_get_order_status",
      async () => {
        try {
          return await this.post<NigeriaSmmOrderStatus>({
            action: "status",
            order: orderId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet order status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  /**
   * action=status (batch).
   * NOTE: Owlet uses 'orders' (plural) for batch queries.
   */
  async getMultiOrderStatus(orderIds: (number | string)[]): Promise<NigeriaSmmMultiOrderStatus> {
    const joined = orderIds.join(",");
    return SentryHelper.trackCriticalOperation(
      "owlet_get_multi_order_status",
      async () => {
        try {
          return await this.post<NigeriaSmmMultiOrderStatus>({
            action: "status",
            orders: joined,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet multi-order status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      `batch_${joined}`,
    );
  }

  /** action=balance — check NGN balance on the Owlet provider account */
  async getBalance(): Promise<NigeriaSmmBalance> {
    return SentryHelper.trackCriticalOperation(
      "owlet_get_balance",
      async () => {
        try {
          return await this.post<NigeriaSmmBalance>({ action: "balance" });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet balance",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "balance",
    );
  }

  /** action=refill — request an order refill */
  async refill(orderId: number | string): Promise<NigeriaSmmRefillResponse> {
    return SentryHelper.trackCriticalOperation(
      "owlet_refill",
      async () => {
        try {
          const data = await this.post<{ refill?: number | string; success?: string }>({
            action: "refill",
            order: orderId,
          });

          return {
            success: String(data.refill ?? data.success ?? "1"),
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to submit Owlet refill",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  /**
   * action=cancel — cancel order(s).
   * Owlet uses 'orders' param and returns: [{ order: 84213, cancel: 84213 }].
   * Normalised to NigeriaSmmCancelResponse { success: "1" }.
   */
  async cancel(orderId: number | string): Promise<NigeriaSmmCancelResponse> {
    return SentryHelper.trackCriticalOperation(
      "owlet_cancel",
      async () => {
        try {
          const data = await this.post<Array<{ order: number | string; cancel: any }>>({
            action: "cancel",
            orders: orderId,
          });

          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            if (first.cancel && typeof first.cancel === "object" && "error" in first.cancel) {
              throw new AppError(
                String(first.cancel.error),
                HTTP_STATUS.BAD_REQUEST,
                ERROR_CODES.PROVIDER_ERROR,
              );
            }
            return { success: "1" };
          }

          return { success: "1" };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to cancel Owlet order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  /** action=refill_status — check status of a refill request (Owlet-specific) */
  async getRefillStatus(refillId: number | string): Promise<OwletSmmRefillStatusResponse> {
    return SentryHelper.trackCriticalOperation(
      "owlet_refill_status",
      async () => {
        try {
          return await this.post<OwletSmmRefillStatusResponse>({
            action: "refill_status",
            refill: refillId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet refill status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(refillId),
    );
  }

  /** action=proofs — fetch delivery proofs for SABI real-people engagement orders */
  async getSabiProofs(orderId: number | string): Promise<OwletSmmProofsResponse> {
    return SentryHelper.trackCriticalOperation(
      "owlet_proofs",
      async () => {
        try {
          return await this.post<OwletSmmProofsResponse>({
            action: "proofs",
            order: orderId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Owlet SABI proofs",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  // ===========================================================================
  // 3. GAME TOP-UPS & GAMING ACCESS CARDS (GAMERZONE)
  //
  // Two sub-products share the same endpoint:
  //   A. GAME TOP-UPS  — Mobile Legends Diamonds, PUBG UC, Free Fire, etc.
  //   B. GAMING ACCESS CARDS — Steam Wallet, Roblox, PlayStation Store cards.
  //
  // API actions: game_products | game_packages + product | game_topup + ...
  // All prices in NGN. Delivery is synchronous (status: "Completed").
  // ===========================================================================

  /** action=game_products — list all available games / gaming card products */
  async getGameProducts(): Promise<OwletGameProduct[]> {
    try {
      const data = await this.post<OwletGameProduct[]>({ action: "game_products" });

      if (!Array.isArray(data)) {
        logger.warn("OwletService.getGameProducts: unexpected shape", { data });
        return [];
      }

      logger.info(`OwletService.getGameProducts: fetched ${data.length} game products`);
      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Failed to fetch Owlet Gamerzone products",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  /** action=game_packages — fetch SKUs and dynamic field requirements for a game */
  async getGamePackages(product: string): Promise<OwletGamePackage[]> {
    try {
      const data = await this.post<OwletGamePackage[]>({
        action: "game_packages",
        product,
      });

      if (!Array.isArray(data)) {
        logger.warn("OwletService.getGamePackages: unexpected shape", { product, data });
        return [];
      }

      logger.info(`OwletService.getGamePackages: fetched ${data.length} packages for ${product}`);
      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || `Failed to fetch Owlet Gamerzone packages for ${product}`,
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  /** action=game_topup — execute a game top-up or gaming access card purchase */
  async buyGameTopup(params: {
    product: string;
    sku: string;
    fields: Record<string, string>;
    reference: string;
  }): Promise<OwletGameTopupResult> {
    try {
      logger.info("OwletService.buyGameTopup: initiating", {
        product: params.product,
        sku: params.sku,
        reference: params.reference,
        fields: Object.keys(params.fields),
      });

      const payload: Record<string, any> = {
        action: "game_topup",
        product: params.product,
        sku: params.sku,
        ...params.fields,
      };

      const data = await this.post<OwletGameTopupRawResponse>(payload);

      const rawStatus = String(data?.status ?? "").toLowerCase();
      const successWords = ["completed", "success", "successful", "approved", "ok"];

      if (!successWords.includes(rawStatus)) {
        throw new AppError(
          data.message || `Game top-up failed — status: ${rawStatus}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      logger.info("OwletService.buyGameTopup: success", {
        owletOrder: data.order,
        product: params.product,
        sku: params.sku,
        reference: params.reference,
      });

      return {
        success: true,
        owletOrder: String(data.order ?? ""),
        status: rawStatus,
        reference: params.reference,
        message: data.message || "Game top-up successful",
        card: data.card,
        code: data.code,
        pin: data.pin,
        data,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Owlet Gamerzone top-up failed",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // ===========================================================================
  // 4. PHONE NUMBER RENTAL & OTP (TALKTIYU)
  //
  // IMPORTANT — OTP POLLING REQUIRED:
  //   - rentNumber() returns a phone number immediately (status: "waiting").
  //   - The OTP has NOT been received yet at this point.
  //   - Poll getOtp(order) until status === "received" or timeout.
  //   - Owlet auto-refunds their API balance if no OTP arrives.
  //   - Paymint detects this (shouldRefundUser:true) and auto-refunds the user.
  //
  // API actions: number_services + country | rent_number + country, service | otp + order
  // ===========================================================================

  /** action=number_services — list available services (apps) for a country */
  async getNumberServices(country: string): Promise<OwletNumberService[]> {
    try {
      const data = await this.post<OwletNumberService[]>({
        action: "number_services",
        country: country.toUpperCase(),
      });

      if (!Array.isArray(data)) {
        logger.warn("OwletService.getNumberServices: unexpected shape", { country, data });
        return [];
      }

      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || `Failed to fetch Owlet number services for ${country}`,
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  /** action=rent_number — rent a virtual phone number to receive an OTP */
  async rentNumber(params: {
    country: string;
    service: string;
    reference: string;
  }): Promise<OwletRentNumberResult> {
    try {
      logger.info("OwletService.rentNumber: initiating", {
        country: params.country,
        service: params.service,
        reference: params.reference,
      });

      const data = await this.post<OwletRentNumberRawResponse>({
        action: "rent_number",
        country: params.country.toUpperCase(),
        service: params.service,
      });

      if (!data.number || !data.order) {
        throw new AppError(
          "Number rental response missing required fields (order, number)",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      logger.info("OwletService.rentNumber: number assigned", {
        owletOrder: data.order,
        number: data.number,
        reference: params.reference,
      });

      return {
        success: true,
        owletOrder: String(data.order),
        number: data.number,
        status: String(data.status ?? "waiting"),
        reference: params.reference,
        message: "Number rented — waiting for OTP",
        data,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Owlet number rental failed",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  /** action=otp — poll for the OTP code on a rented number */
  async getOtp(owletOrder: string): Promise<OwletOtpResult> {
    try {
      const data = await this.post<OwletOtpRawResponse>({
        action: "otp",
        order: owletOrder,
      });

      const status = String(data?.status ?? "waiting").toLowerCase();

      logger.debug("OwletService.getOtp: polled", {
        owletOrder,
        status,
        code: status === "received" ? "[REDACTED]" : undefined,
      });

      return {
        owletOrder,
        status,
        code: data.code,
        number: data.number,
        message: data.message,
        shouldRefundUser: status === "expired" || status === "refunded",
        data,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Failed to fetch OTP status",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // ===========================================================================
  // 5. PROXIES (RHOMBUS)
  //
  // API actions: proxy_catalog | buy_proxy + product, plan, quantity, location?
  // Response: { order: "rh_xxx", status: "Completed", proxies: ["ip:port:user:pass", ...] }
  // ===========================================================================

  /** action=proxy_catalog — list all available proxy products */
  async getProxyCatalog(): Promise<OwletProxyProduct[]> {
    try {
      const data = await this.post<OwletProxyProduct[]>({ action: "proxy_catalog" });

      if (!Array.isArray(data)) {
        logger.warn("OwletService.getProxyCatalog: unexpected shape", { data });
        return [];
      }

      logger.info(`OwletService.getProxyCatalog: fetched ${data.length} proxy products`);
      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Failed to fetch Owlet proxy catalog",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  /** action=buy_proxy — purchase proxies */
  async buyProxy(params: {
    product: string;
    plan: string;
    quantity: number;
    location?: string;
    reference: string;
  }): Promise<OwletBuyProxyResult> {
    try {
      logger.info("OwletService.buyProxy: initiating", {
        product: params.product,
        plan: params.plan,
        quantity: params.quantity,
        location: params.location,
        reference: params.reference,
      });

      const payload: Record<string, any> = {
        action: "buy_proxy",
        product: params.product,
        plan: params.plan,
        quantity: params.quantity,
      };
      if (params.location) payload.location = params.location;

      const data = await this.post<OwletBuyProxyRawResponse>(payload);

      const rawStatus = String(data?.status ?? "").toLowerCase();
      const successWords = ["completed", "success", "successful", "approved", "ok"];

      if (!successWords.includes(rawStatus)) {
        throw new AppError(
          data.message || `Proxy purchase failed — status: ${rawStatus}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      if (!Array.isArray(data.proxies) || data.proxies.length === 0) {
        throw new AppError(
          "Proxy purchase succeeded but no proxy credentials were returned",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      logger.info("OwletService.buyProxy: success", {
        owletOrder: data.order,
        quantity: data.proxies.length,
        reference: params.reference,
      });

      return {
        success: true,
        owletOrder: String(data.order ?? ""),
        status: rawStatus,
        reference: params.reference,
        proxies: data.proxies,
        message: data.message || "Proxy purchase successful",
        data,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error.message || "Owlet Rhombus proxy purchase failed",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }
}
