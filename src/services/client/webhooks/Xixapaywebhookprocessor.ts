import crypto from "crypto";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { WebhookProcessResult } from "../../WebhookService";

// Xixapay virtual-account (collection) webhook payload.
// NOTE: Xixapay's docs only show a successful example. There is no documented
// failure/pending payload shape or status string — see mapStatus() below for
// how that gap is handled defensively rather than guessed at.
//
// Field names below were corrected against documentation.xixapay.com and a
// live captured payload on 2026-07-01 — the previous version of this
// interface (amount, fee, narration, receiver.account_name/bank_name,
// sender.account_name/bank_name, customer.customer_name/customer_email) did
// not match the real payload shape and caused every webhook to fail
// validatePayload(), rejecting otherwise-valid, signature-verified payments.
export interface XixapayVirtualAccountWebhook {
  transaction_id: string;
  notification_status?: string;
  transaction_status: string;
  amount_paid: number;
  settlement_amount?: number;
  settlement_fee?: number;
  description?: string;
  sender?: {
    account_number?: string;
    name?: string;
    bank?: string;
  };
  receiver: {
    account_number: string;
    name?: string;
    bank?: string;
  };
  customer?: {
    customer_id?: string;
    name?: string;
    email?: string;
    phone?: string | null;
  };
  timestamp?: string;
}

export class XixapayWebhookProcessor {
  // Xixapay signs the raw request body with HMAC-SHA256 using the
  // XIXAPAY_WEBHOOK_SECRET, sent in the 'xixapay' header.
  validateSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) {
      logger.warn("Xixapay webhook: missing signature header");
      return false;
    }

    const secret = process.env.XIXAPAY_WEBHOOK_SECRET;
    if (!secret) {
      logger.error(
        "Xixapay webhook: XIXAPAY_WEBHOOK_SECRET not configured — cannot verify signature",
      );
      return false;
    }

    try {
      const calculatedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const sigBuffer = Buffer.from(signature);
      const calcBuffer = Buffer.from(calculatedSignature);

      if (sigBuffer.length !== calcBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuffer, calcBuffer);
    } catch (error: any) {
      logger.error("Xixapay webhook: signature validation error", {
        error: error.message,
      });
      return false;
    }
  }

  validatePayload(payload: any): boolean {
    try {
      if (!payload || typeof payload !== "object") {
        logger.error("Xixapay webhook: invalid payload structure", {
          payload,
        });
        return false;
      }

      const requiredFields = [
        "transaction_id",
        "transaction_status",
        "amount_paid",
      ];

      for (const field of requiredFields) {
        if (payload[field] === undefined || payload[field] === null) {
          logger.error(`Xixapay webhook: missing required field: ${field}`, {
            payload,
          });
          return false;
        }
      }

      if (!payload.receiver?.account_number) {
        logger.error(
          "Xixapay webhook: missing receiver.account_number — cannot match to a virtual account",
          { payload },
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error("Xixapay webhook: validation error", { error, payload });
      return false;
    }
  }

  async process(
    payload: XixapayVirtualAccountWebhook,
  ): Promise<WebhookProcessResult> {
    try {
      logger.info("Xixapay webhook: processing payload", {
        transactionId: payload.transaction_id,
        status: payload.transaction_status,
        amount: payload.amount_paid,
        creditAccountNumber: payload.receiver.account_number,
      });

      if (!this.validatePayload(payload)) {
        throw new AppError(
          "Invalid Xixapay webhook payload",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const status = this.mapStatus(payload.transaction_status);

      // No merchant-supplied reference field exists in Xixapay's webhook —
      // matching happens via receiver.account_number against VirtualAccountRepository,
      // same primary-resolution pattern SaveHavenWebhookService already uses.
      const result: WebhookProcessResult = {
        reference: payload.transaction_id,
        providerReference: payload.transaction_id,
        providerTransactionId: payload.transaction_id,
        status,
        metadata: {
          webhookType: "virtualAccount.transfer",
          transferType: "Inwards", // Xixapay's documented webhook only covers collections
          creditAccountNumber: payload.receiver.account_number,
          creditAccountName: payload.receiver.name || "N/A",
          debitAccountNumber: payload.sender?.account_number || "N/A",
          debitAccountName: payload.sender?.name || "N/A",
          // amount is the gross amount the customer paid (amount_paid), NOT
          // settlement_amount — our own platform fee (calculateAmountWithCharge)
          // is applied to the gross amount downstream in XixapayWebhookService.
          amount: payload.amount_paid,
          // settlement_fee is Xixapay's own cut. settlement_amount is what
          // actually lands with us (amount_paid - settlement_fee); fall back
          // to computing it in case settlement_amount is ever absent.
          fees: payload.settlement_fee || 0,
          netAmount:
            payload.settlement_amount ??
            payload.amount_paid - (payload.settlement_fee || 0),
          narration: payload.description || "N/A",
          customerId: payload.customer?.customer_id || "N/A",
          webhookReceivedAt: new Date(),
        },
      };

      return result;
    } catch (error) {
      logger.error("Xixapay webhook: processing error", { error, payload });
      throw error;
    }
  }

  // Xixapay's docs only document a successful transaction_status ("success").
  // No failure/pending status strings are documented. Rather than invent them,
  // this maps the known case explicitly and falls back defensively — same
  // pattern SaveHavenWebhookProcessor uses for its own unrecognized-status case.
  private mapStatus(
    xixapayStatus: string,
  ): "success" | "pending" | "failed" | "reversed" {
    switch (xixapayStatus?.toLowerCase()) {
      case "success":
      case "successful":
        return "success";
      case "failed":
      case "failure":
        return "failed";
      case "reversed":
        return "reversed";
      case "pending":
      case "processing":
        return "pending";
      default:
        logger.warn(
          "Xixapay webhook: unrecognized transaction_status, defaulting to pending",
          { xixapayStatus },
        );
        return "pending";
    }
  }

  isWalletFunding(): boolean {
    // Xixapay's documented webhook only covers the collection/funding side —
    // there is no documented payout/withdrawal webhook (payouts are synchronous,
    // see WithdrawalService and XixapayService.initiatePayout).
    return true;
  }
}