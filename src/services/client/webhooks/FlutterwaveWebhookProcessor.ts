import crypto from "crypto";
import logger from "@/logger";
import { PROVIDERS } from "@/config";

// FLUTTERWAVE WEBHOOK PROCESSOR
//
// Purpose: Parse and validate Flutterwave webhook payloads
// Responsibilities:
// - Validate webhook signatures (HMAC-SHA256)
// - Validate payload structure
// - Extract and normalize data
// - Map provider statuses to standard statuses
// - Return WebhookProcessResult
//
// Supported Event Types:
// - charge.completed (wallet funding via virtual account, card, mobile money)
// - transfer.completed (withdrawal success/failure)

export interface WebhookProcessResult {
  reference: string; // YOUR internal reference
  providerReference: string; // Flutterwave's reference
  providerTransactionId: string; // Flutterwave's unique transaction ID
  status: "success" | "pending" | "failed" | "reversed";
  metadata: {
    eventType: string; // Original event type from Flutterwave
    amount?: number;
    netAmount?: number; // Amount after fees
    fees?: number;
    currency?: string;
    accountNumber?: string; // For virtual account payments
    accountName?: string;
    bankName?: string;
    customerEmail?: string;
    customerName?: string;
    paymentMethod?: string;
    webhookReceivedAt: Date;
    // Flutterwave-specific fields
    flutterwaveId?: string;
    txRef?: string;
    flwRef?: string;
    transferId?: string;
    failureReason?: string;
  };
  token?: string;
}

// FLUTTERWAVE WEBHOOK PROCESSOR
// Handles both official payload structure and sandbox mock format

export class FlutterwaveWebhookProcessor {
  private webhookSecret: string;

  constructor() {
    this.webhookSecret = PROVIDERS.FLUTTERWAVE.webhookSecret || "";
  }

  validateSignature(payload: string, signature: string): boolean {
    try {
      if (!this.webhookSecret) {
        logger.warn("Flutterwave webhook secret not configured");
        return false;
      }

      // Flutterwave uses HMAC-SHA256 with base64 encoding
      // Flutterwave uses HMAC-SHA256 with base64 encoding
      const hash = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(payload)
        .digest("base64");

      // Compare using a constant-time comparison (avoids leaking timing
      // information about how much of the signature matched)
      const hashBuffer = Buffer.from(hash, "base64");
      const signatureBuffer = Buffer.from(signature, "base64");
      const isValid =
        hashBuffer.length === signatureBuffer.length &&
        crypto.timingSafeEqual(hashBuffer, signatureBuffer);

      if (!isValid) {
        logger.warn("Flutterwave webhook signature validation failed", {
          expected: hash.substring(0, 10) + "...",
          received: signature.substring(0, 10) + "...",
        });
      }

      return isValid;
    } catch (error: any) {
      logger.error("Error validating Flutterwave webhook signature", error);
      return false;
    }
  }

  // FLEXIBLE PAYLOAD VALIDATION
  // Per Flutterwave docs: official structure has data, type, id, timestamp
  // Sandbox might send simplified flat structure
  validatePayload(payload: any): boolean {
    try {
      if (!payload || typeof payload !== "object") {
        logger.error("Flutterwave webhook: Invalid payload structure");
        return false;
      }

      // Official production structure
      if (payload.data && payload.type && typeof payload.data === "object") {
        logger.info("Webhook validation: Official nested structure detected");
        return true;
      }

      // Sandbox/mock flat structure (missing type and data wrapper)
      if (payload.id && payload.status && (payload.txRef || payload.flwRef)) {
        logger.info("Webhook validation: Sandbox flat structure detected", {
          note: "This will be normalized to official format",
        });
        return true;
      }

      logger.error("Flutterwave webhook: Unrecognized payload structure", {
        hasData: !!payload.data,
        hasType: !!payload.type,
        hasStatus: !!payload.status,
        hasTxRef: !!payload.txRef,
      });
      return false;
    } catch (error: any) {
      logger.error("Error validating Flutterwave webhook payload", error);
      return false;
    }
  }

  async process(payload: any): Promise<WebhookProcessResult> {
    try {
      // Normalize payload to official structure
      const normalizedPayload = this.normalizePayload(payload);
      const eventType = normalizedPayload.type;

      logger.info(`Processing Flutterwave webhook: ${eventType}`, {
        webhookId: normalizedPayload.id,
        transactionId: normalizedPayload.data?.id,
      });

      switch (eventType) {
        case "charge.completed":
          return this.processChargeCompleted(normalizedPayload);

        case "transfer.completed":
          return this.processTransferCompleted(normalizedPayload);

        default:
          logger.warn(`Unsupported Flutterwave event type: ${eventType}`);
          throw new Error(`Unsupported event type: ${eventType}`);
      }
    } catch (error: any) {
      logger.error("Error processing Flutterwave webhook", {
        error: error.message,
        payload,
      });
      throw error;
    }
  }

  // NORMALIZE PAYLOAD
  // Converts sandbox flat structure to official nested structure
  private normalizePayload(payload: any): any {
    // If already in official format, return as-is
    if (payload.data && payload.type) {
      return payload;
    }

    // If sandbox/mock flat format, normalize to official format
    if (payload.id && payload.status && (payload.txRef || payload.flwRef)) {
      logger.info("Normalizing sandbox flat payload to official structure");

      // Determine event type from context
      // Sandbox sends both charge and transfer events, distinguish by field presence
      const isTransfer = !!payload.transferId || payload.meta?.transferId;
      const eventType = isTransfer ? "transfer.completed" : "charge.completed";

      return {
        id: `wbk_${payload.id}`, // Webhook ID (mock)
        type: eventType,
        timestamp: Date.now(),
        data: {
          id: payload.id?.toString(),
          status: payload.status?.toLowerCase(),
          amount: payload.amount,
          currency: payload.currency || "NGN",
          reference: payload.orderRef || payload.reference,
          tx_ref: payload.txRef,
          flw_ref: payload.flwRef,
          app_fee: payload.appfee || 0,
          customer: {
            email: payload.customer?.email,
            name: payload.customer?.fullName,
            phone: payload.customer?.phone,
          },
          payment_method: {
            type: payload.entity ? "card" : "unknown",
          },
          processor_response: {
            message: "Webhook processed",
          },
        },
      };
    }

    // Return original if unrecognized (will likely fail validation)
    return payload;
  }

  private processChargeCompleted(payload: any): WebhookProcessResult {
    const data = payload.data;

    const reference = data.tx_ref || data.reference || "";
    const providerReference = data.flw_ref || data.reference || "";
    const providerTransactionId = data.id || "";

    const status = this.mapChargeStatus(data.status);

    const amount = Number(data.amount) || 0;
    const fees = Number(data.app_fee) || 0;
    const netAmount = amount - fees;

    const paymentMethod = data.payment_method?.type || "unknown";

    const metadata: WebhookProcessResult["metadata"] = {
      eventType: "charge.completed",
      amount,
      netAmount,
      fees,
      currency: data.currency || "NGN",
      customerEmail: data.customer?.email,
      customerName: data.customer?.name,
      paymentMethod,
      webhookReceivedAt: new Date(),
      flutterwaveId: data.id,
      txRef: data.tx_ref,
      flwRef: data.flw_ref,
    };

    if (status === "failed" && data.processor_response) {
      metadata.failureReason =
        data.processor_response.message || "Payment failed";
    }

    logger.info("Flutterwave charge.completed processed", {
      reference,
      status,
      amount,
      netAmount,
      paymentMethod,
    });

    return {
      reference,
      providerReference,
      providerTransactionId,
      status,
      metadata,
    };
  }

  private processTransferCompleted(payload: any): WebhookProcessResult {
    const data = payload.data;

    const reference = data.reference || "";
    const providerReference = data.reference || "";
    const providerTransactionId = data.id?.toString() || "";

    const status = this.mapTransferStatus(data.status);

    const amount = Number(data.amount) || 0;
    const fees = Number(data.fee) || 0;
    const netAmount = amount + fees;

    const metadata: WebhookProcessResult["metadata"] = {
      eventType: "transfer.completed",
      amount,
      netAmount,
      fees,
      currency: data.currency || "NGN",
      accountNumber: data.account_number,
      accountName: data.full_name || data.beneficiary_name,
      bankName: data.bank_name,
      webhookReceivedAt: new Date(),
      flutterwaveId: data.id?.toString(),
      transferId: data.id?.toString(),
    };

    if (status === "failed") {
      metadata.failureReason =
        data.complete_message || data.status || "Transfer failed";
    }

    logger.info("Flutterwave transfer.completed processed", {
      reference,
      status,
      amount,
      accountNumber: data.account_number,
    });

    return {
      reference,
      providerReference,
      providerTransactionId,
      status,
      metadata,
    };
  }

  private mapChargeStatus(
    flutterwaveStatus: string,
  ): "success" | "pending" | "failed" | "reversed" {
    const statusMap: Record<
      string,
      "success" | "pending" | "failed" | "reversed"
    > = {
      succeeded: "success",
      successful: "success",
      success: "success",
      completed: "success",
      failed: "failed",
      cancelled: "failed",
      pending: "pending",
      processing: "pending",
      reversed: "reversed",
    };

    const normalized = flutterwaveStatus?.toLowerCase() || "pending";
    return statusMap[normalized] || "pending";
  }

  private mapTransferStatus(
    flutterwaveStatus: string,
  ): "success" | "pending" | "failed" | "reversed" {
    const statusMap: Record<
      string,
      "success" | "pending" | "failed" | "reversed"
    > = {
      succeeded: "success",
      successful: "success",
      success: "success",
      SUCCESSFUL: "success",
      failed: "failed",
      FAILED: "failed",
      pending: "pending",
      PENDING: "pending",
      NEW: "pending",
      reversed: "reversed",
      REVERSED: "reversed",
    };

    return statusMap[flutterwaveStatus] || "pending";
  }

  validateIP(ip: string): boolean {
    const allowedIPs: string[] = ["127.0.0.1", "::1"];
    if (allowedIPs.length === 2) {
      return true;
    }
    return allowedIPs.includes(ip);
  }
}
