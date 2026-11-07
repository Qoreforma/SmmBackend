import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  NigeriaSmmServiceItemNormalised,
  NigeriaSmmOrderStatus,
  NigeriaSmmMultiOrderStatus,
  NigeriaSmmBalance,
  NigeriaSmmRefillResponse,
  NigeriaSmmCancelResponse,
  SmmFollowsServiceItem,
  SmmFollowsOrderStatus,
  SmmFollowsMultiOrderStatus,
  SmmFollowsBalance,
  SmmFollowsRefillResponse,
  SmmFollowsRefillStatusResponse,
} from "@/types/smm";
import qs from "qs";

export class SmmFollowsService {
  private client: AxiosInstance;
  private provider = PROVIDERS.SMMFOLLOWS;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 25000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    // Request interceptor — structured debugging
    this.client.interceptors.request.use((config) => {
      logger.debug("SMMFOLLOWS_RAW_REQUEST", {
        method: config.method,
        url: config.url,
        data: config.data,
      });
      return config;
    });

    // Response interceptor — structured debugging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("SMMFOLLOWS_RAW_RESPONSE", {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error("SMMFOLLOWS_RAW_ERROR", {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      },
    );
  }

  // -------------------------------------------------------------------------
  // Core POST helper — all SmmFollows actions are POST form-encoded
  // -------------------------------------------------------------------------
  private async post<T>(params: Record<string, any>): Promise<T> {
    const payload = { key: this.provider.apiKey, ...params };
    const response = await this.client.post("", qs.stringify(payload));
    const data = response.data;

    if (data && typeof data === "object") {
      if ("error" in data && data.error) {
        const errorMsg =
          typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        throw new AppError(
          errorMsg,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

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

  // -------------------------------------------------------------------------
  // action=services — fetch full catalog
  // -------------------------------------------------------------------------
  async getServices(): Promise<NigeriaSmmServiceItemNormalised[]> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_get_services",
      async () => {
        try {
          const data = await this.post<SmmFollowsServiceItem[]>({
            action: "services",
          });

          if (!Array.isArray(data)) {
            throw new AppError(
              "Unexpected response from SMMFollows services endpoint",
              HTTP_STATUS.BAD_GATEWAY,
              ERROR_CODES.PROVIDER_ERROR,
            );
          }

          return data.map((item) => {
            const rawCategory = item.category ?? "";
            const rate = parseFloat(String(item.rate)) || 0;
            const parsedId = Number(item.service);
            return {
              id: isNaN(parsedId) ? 0 : parsedId,
              category: typeof rawCategory === "string" ? rawCategory.trim() : "",
              name: item.name || "",
              type: item.type || "Default",
              rate,
              rateUsd: rate,
              min: parseInt(String(item.min)) || 0,
              max: parseInt(String(item.max)) || 0,
              refill: Boolean(item.refill),
              cancel: Boolean(item.cancel),
            };
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows services",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "smmfollows_catalog",
    );
  }

  // -------------------------------------------------------------------------
  // action=add — place an SMM order
  //
  // IMPORTANT: This method is INTENTIONALLY non-retryable.
  // Standard SMM v2 panels have no idempotency key on action=add.
  // Duplicate calls will place a second order and charge twice.
  // -------------------------------------------------------------------------
  async addOrder(params: {
    service: number;
    link: string;
    quantity: number;
    comments?: string;
    runs?: number;
    interval?: number;
    [key: string]: any;
  }): Promise<{ success: true; orderId: number } | { success: false; ambiguous: true; message: string }> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_add_order",
      async () => {
        try {
          const postPayload: Record<string, any> = {
            action: "add",
            service: params.service,
            link: params.link,
            quantity: params.quantity,
          };

          if (params.comments) postPayload.comments = params.comments;
          if (params.runs) postPayload.runs = params.runs;
          if (params.interval) postPayload.interval = params.interval;
          if (params.answer_number !== undefined) postPayload.answer_number = params.answer_number;
          if (params.usernames) postPayload.usernames = params.usernames;

          const data = await this.post<any>(postPayload);

          const rawOrderId = data?.order ?? data?.order_id ?? data?.id;
          const parsedOrderId = Number(rawOrderId);

          if (!isNaN(parsedOrderId) && parsedOrderId > 0) {
            logger.info("SmmFollowsService.addOrder: order placed successfully", {
              orderId: parsedOrderId,
              ...params,
            });
            return { success: true, orderId: parsedOrderId };
          }

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
            logger.warn("SmmFollowsService.addOrder: provider returned rejection", {
              data,
              explicitError,
            });
            throw new AppError(
              String(explicitError),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.PROVIDER_ERROR,
            );
          }

          logger.warn("SmmFollowsService.addOrder: unexpected response shape", { data });
          return { success: false, ambiguous: true, message: "Unexpected provider response shape" };
        } catch (error: any) {
          if (error instanceof AppError) {
            throw error;
          }

          const isTimeout =
            error.code === "ECONNABORTED" ||
            error.message?.includes("timeout") ||
            !error.response;

          if (isTimeout) {
            logger.error("SmmFollowsService.addOrder: ambiguous error (timeout)", {
              params,
              message: error.message,
            });
            return {
              success: false,
              ambiguous: true,
              message:
                "SMMFollows request timed out — order state is unconfirmed. Check dashboard before retrying.",
            };
          }

          throw new AppError(
            error.message || "Failed to place SMMFollows order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      params.link,
    );
  }

  // -------------------------------------------------------------------------
  // action=status (single order)
  // -------------------------------------------------------------------------
  async getOrderStatus(orderId: number | string): Promise<NigeriaSmmOrderStatus> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_get_order_status",
      async () => {
        try {
          const data = await this.post<SmmFollowsOrderStatus>({
            action: "status",
            order: orderId,
          });

          return {
            charge: data.charge,
            start_count: data.start_count,
            status: data.status as any,
            remains: data.remains,
            currency: data.currency || "USD",
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows order status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  // -------------------------------------------------------------------------
  // action=status (batch — comma-separated order ids via 'orders' param)
  // -------------------------------------------------------------------------
  async getMultiOrderStatus(orderIds: (number | string)[]): Promise<NigeriaSmmMultiOrderStatus> {
    const joined = orderIds.join(",");
    return SentryHelper.trackCriticalOperation(
      "smmfollows_get_multi_order_status",
      async () => {
        try {
          return await this.post<SmmFollowsMultiOrderStatus>({
            action: "status",
            orders: joined,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows multi-order status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      `batch_${joined}`,
    );
  }

  // -------------------------------------------------------------------------
  // action=balance — check USD balance on provider account
  // -------------------------------------------------------------------------
  async getBalance(): Promise<NigeriaSmmBalance> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_get_balance",
      async () => {
        try {
          const data = await this.post<SmmFollowsBalance>({ action: "balance" });
          return {
            balance: data.balance,
            currency: data.currency || "USD",
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows balance",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "balance",
    );
  }

  // -------------------------------------------------------------------------
  // action=refill (single order)
  // -------------------------------------------------------------------------
  async refill(orderId: number | string): Promise<NigeriaSmmRefillResponse> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_refill",
      async () => {
        try {
          const data = await this.post<SmmFollowsRefillResponse>({
            action: "refill",
            order: orderId,
          });
          return {
            success: String(data?.refill ?? "1"),
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to submit SMMFollows refill",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  // -------------------------------------------------------------------------
  // action=refill (multiple orders)
  // -------------------------------------------------------------------------
  async multiRefill(orderIds: (number | string)[]): Promise<any> {
    const joined = orderIds.join(",");
    return SentryHelper.trackCriticalOperation(
      "smmfollows_multi_refill",
      async () => {
        try {
          return await this.post<any>({
            action: "refill",
            orders: joined,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to submit SMMFollows multi-refill",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      `batch_refill_${joined}`,
    );
  }

  // -------------------------------------------------------------------------
  // action=refill_status (single refill)
  // -------------------------------------------------------------------------
  async getRefillStatus(refillId: number | string): Promise<SmmFollowsRefillStatusResponse> {
    return SentryHelper.trackCriticalOperation(
      "smmfollows_refill_status",
      async () => {
        try {
          return await this.post<SmmFollowsRefillStatusResponse>({
            action: "refill_status",
            refill: refillId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows refill status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(refillId),
    );
  }

  // -------------------------------------------------------------------------
  // action=refill_status (multiple refills)
  // -------------------------------------------------------------------------
  async multiRefillStatus(refillIds: (number | string)[]): Promise<any> {
    const joined = refillIds.join(",");
    return SentryHelper.trackCriticalOperation(
      "smmfollows_multi_refill_status",
      async () => {
        try {
          return await this.post<any>({
            action: "refill_status",
            refills: joined,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch SMMFollows multi-refill status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      `batch_refill_status_${joined}`,
    );
  }

  // -------------------------------------------------------------------------
  // action=cancel (cancel orders via comma-separated IDs)
  // -------------------------------------------------------------------------
  async cancel(orderIds: (number | string)[] | number | string): Promise<NigeriaSmmCancelResponse> {
    const ordersJoined = Array.isArray(orderIds) ? orderIds.join(",") : String(orderIds);
    return SentryHelper.trackCriticalOperation(
      "smmfollows_cancel",
      async () => {
        try {
          const data = await this.post<any>({
            action: "cancel",
            orders: ordersJoined,
          });
          return {
            success: typeof data === "string" ? data : JSON.stringify(data),
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to cancel SMMFollows order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(ordersJoined),
    );
  }
}
