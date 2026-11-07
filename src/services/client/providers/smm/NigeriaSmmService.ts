import axios, { AxiosInstance } from "axios";
import { PROVIDERS } from "@/config";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import {
  NigeriaSmmServiceItem,
  NigeriaSmmServiceItemNormalised,
  NigeriaSmmOrderResponse,
  NigeriaSmmOrderStatus,
  NigeriaSmmMultiOrderStatus,
  NigeriaSmmBalance,
  NigeriaSmmRefillResponse,
  NigeriaSmmCancelResponse,
} from "@/types/smm";
import qs from "qs";

export class NigeriaSmmService {
  private client: AxiosInstance;
  private provider = PROVIDERS.NIGERIASMM;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 20000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });
  }

  // -------------------------------------------------------------------------
  // POST helper — all Nigeria SMM actions are POST form-encoded
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
  // Normalise service id — provider inconsistently uses "service" vs "services"
  // -------------------------------------------------------------------------
  private resolveServiceId(item: NigeriaSmmServiceItem): number {
    const raw = item.service ?? item.services;
    if (raw == null) return 0;
    const id = Number(raw);
    return isNaN(id) ? 0 : id;
  }

  // -------------------------------------------------------------------------
  // action=services — fetch full catalog
  // -------------------------------------------------------------------------
  async getServices(): Promise<NigeriaSmmServiceItemNormalised[]> {
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_get_services",
      async () => {
        try {
          const data = await this.post<NigeriaSmmServiceItem[]>({
            action: "services",
          });

          if (!Array.isArray(data)) {
            throw new AppError(
              "Unexpected response from Nigeria SMM services endpoint",
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
              rateUsd: rate,
              min: parseInt(String(item.min)) || 0,
              max: parseInt(String(item.max)) || 0,
            };
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Nigeria SMM services",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "nigeriasmm_catalog",
    );
  }

  // -------------------------------------------------------------------------
  // action=add — place an SMM order
  //
  // IMPORTANT: This method is INTENTIONALLY non-retryable.
  // Nigeria SMM has no idempotency key on action=add. A duplicate call will
  // create a second order and charge twice. On timeout or ambiguous 5xx, the
  // caller must set the transaction to pending_manual rather than retrying.
  // -------------------------------------------------------------------------
  async addOrder(params: {
    service: number;
    link: string;
    quantity?: number;
    comments?: string;
    runs?: number;
    interval?: number;
    answer_number?: string | number;
    usernames?: string;
    [key: string]: any;
  }): Promise<{ success: true; orderId: number } | { success: false; ambiguous: true; message: string }> {
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_add_order",
      async () => {
        try {
          const payload: Record<string, any> = {
            action: "add",
            service: params.service,
            link: params.link,
          };
          if (params.quantity !== undefined && params.quantity !== null) {
            payload.quantity = params.quantity;
          }
          if (params.comments) payload.comments = params.comments;
          if (params.runs) payload.runs = params.runs;
          if (params.interval) payload.interval = params.interval;
          if (params.answer_number !== undefined) payload.answer_number = params.answer_number;
          if (params.usernames) payload.usernames = params.usernames;

          const data = await this.post<any>(payload);

          const rawOrderId = data?.order ?? data?.order_id ?? data?.id;
          const parsedOrderId = Number(rawOrderId);

          if (!isNaN(parsedOrderId) && parsedOrderId > 0) {
            logger.info("NigeriaSmmService.addOrder: order placed", { orderId: parsedOrderId, ...params });
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
            logger.warn("NigeriaSmmService.addOrder: provider returned explicit rejection", {
              data,
              explicitError,
            });
            throw new AppError(
              String(explicitError),
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.PROVIDER_ERROR,
            );
          }

          logger.warn("NigeriaSmmService.addOrder: unexpected response shape", { data });
          return { success: false, ambiguous: true, message: "Unexpected provider response shape" };
        } catch (error: any) {
          if (error instanceof AppError) {
            // Hard provider error (e.g. invalid service, link, quantity) — not ambiguous
            throw error;
          }

          const isTimeout =
            error.code === "ECONNABORTED" ||
            error.message?.includes("timeout") ||
            !error.response;

          if (isTimeout) {
            logger.error("NigeriaSmmService.addOrder: ambiguous error (timeout)", {
              params,
              message: error.message,
            });
            return {
              success: false,
              ambiguous: true,
              message:
                "Nigeria SMM request timed out — order state is unconfirmed. Check dashboard before retrying.",
            };
          }

          throw new AppError(
            error.message || "Failed to place Nigeria SMM order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      params.link, // using link as reference since there's no unique idempotency key
    );
  }

  // -------------------------------------------------------------------------
  // action=status (single order)
  // -------------------------------------------------------------------------
  async getOrderStatus(orderId: number | string): Promise<NigeriaSmmOrderStatus> {
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_get_order_status",
      async () => {
        try {
          return await this.post<NigeriaSmmOrderStatus>({
            action: "status",
            order: orderId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Nigeria SMM order status",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  // -------------------------------------------------------------------------
  // action=status (batch — comma-separated order ids)
  // Returns a map keyed by orderId string
  // -------------------------------------------------------------------------
  async getMultiOrderStatus(orderIds: (number | string)[]): Promise<NigeriaSmmMultiOrderStatus> {
    const joined = orderIds.join(",");
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_get_multi_order_status",
      async () => {
        try {
          return await this.post<NigeriaSmmMultiOrderStatus>({
            action: "status",
            order: joined,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Nigeria SMM multi-order status",
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
      "nigeriasmm_get_balance",
      async () => {
        try {
          return await this.post<NigeriaSmmBalance>({ action: "balance" });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to fetch Nigeria SMM balance",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      "balance",
    );
  }

  // -------------------------------------------------------------------------
  // action=refill — request a refill for an under-delivered order
  // -------------------------------------------------------------------------
  async refill(orderId: number | string): Promise<NigeriaSmmRefillResponse> {
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_refill",
      async () => {
        try {
          return await this.post<NigeriaSmmRefillResponse>({
            action: "refill",
            order: orderId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to submit Nigeria SMM refill",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }

  // -------------------------------------------------------------------------
  // action=cancel — cancel a pending order
  // -------------------------------------------------------------------------
  async cancel(orderId: number | string): Promise<NigeriaSmmCancelResponse> {
    return SentryHelper.trackCriticalOperation(
      "nigeriasmm_cancel",
      async () => {
        try {
          return await this.post<NigeriaSmmCancelResponse>({
            action: "cancel",
            order: orderId,
          });
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            error.message || "Failed to cancel Nigeria SMM order",
            HTTP_STATUS.BAD_GATEWAY,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }
      },
      String(orderId),
    );
  }
}
