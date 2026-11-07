import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { WebhookProcessResult } from "../../WebhookService";
import crypto from "crypto";

// Monnify webhook payload structures

// Base webhook structure
interface MonnifyWebhookBase {
  eventType: string;
  eventData: any;
}

// SUCCESSFUL_TRANSACTION (Wallet Funding)
interface MonnifySuccessfulTransactionWebhook extends MonnifyWebhookBase {
  eventType: "SUCCESSFUL_TRANSACTION";
  eventData: {
    product: {
      reference: string; // YOUR reference (e.g., "PAY_1234567890")
      type: string; // "RESERVED_ACCOUNT"
    };
    transactionReference: string; // Monnify's transaction reference
    paymentReference: string; // Monnify's payment reference
    paidOn: string;
    paymentDescription: string;
    metaData: any;
    paymentSourceInformation: Array<{
      bankCode: string;
      amountPaid: number;
      accountName: string;
      sessionId: string;
      accountNumber: string;
    }>;
    destinationAccountInformation: {
      bankCode?: string;
      bankName?: string;
      accountNumber?: string; // Virtual account that received payment
    };
    amountPaid: number;
    totalPayable: number;
    cardDetails: any;
    paymentMethod: string;
    currency: string;
    settlementAmount: string | number; // Amount after fees
    paymentStatus: "PAID" | "PENDING" | "FAILED";
    customer: {
      name: string;
      email: string;
    };
  };
}

// SUCCESSFUL_DISBURSEMENT (Withdrawal Success)
interface MonnifySuccessfulDisbursementWebhook extends MonnifyWebhookBase {
  eventType: "SUCCESSFUL_DISBURSEMENT";
  eventData: {
    amount: number;
    transactionReference: string; // Monnify's transaction reference
    fee: number;
    transactionDescription: string;
    destinationAccountNumber: string;
    sessionId: string;
    createdOn: string;
    destinationAccountName: string;
    reference: string; // YOUR reference (e.g., "WTH_1234567890")
    destinationBankCode: string;
    completedOn: string;
    narration: string;
    currency: string;
    destinationBankName: string;
    status: "SUCCESS";
  };
}

// FAILED_DISBURSEMENT (Withdrawal Failed)
interface MonnifyFailedDisbursementWebhook extends MonnifyWebhookBase {
  eventType: "FAILED_DISBURSEMENT";
  eventData: {
    amount: number;
    transactionReference: string;
    fee: number;
    transactionDescription: string;
    destinationAccountNumber: string;
    sessionId: string;
    createdOn: string;
    destinationAccountName: string;
    reference: string; // YOUR reference
    destinationBankCode: string;
    completedOn: string;
    narration: string;
    currency: string;
    destinationBankName: string;
    status: "FAILED";
  };
}

// REVERSED_DISBURSEMENT (Withdrawal Reversed)
interface MonnifyReversedDisbursementWebhook extends MonnifyWebhookBase {
  eventType: "REVERSED_DISBURSEMENT";
  eventData: {
    transactionReference: string;
    reference: string; // YOUR reference
    narration: string;
    currency: string;
    amount: number;
    status: "REVERSED";
    fee: number;
    destinationAccountNumber: string;
    destinationAccountName: string;
    destinationBankCode: string;
    sessionId: string;
    createdOn: string;
    completedOn: string;
  };
}

type MonnifyWebhookPayload =
  | MonnifySuccessfulTransactionWebhook
  | MonnifySuccessfulDisbursementWebhook
  | MonnifyFailedDisbursementWebhook
  | MonnifyReversedDisbursementWebhook;

// MONNIFY WEBHOOK PROCESSOR
// Handles Monnify-specific webhook payload parsing and validation
//
// Supported Event Types:
// 1. SUCCESSFUL_TRANSACTION - Wallet funding via virtual accounts
// 2. SUCCESSFUL_DISBURSEMENT - Withdrawal completed successfully
// 3. FAILED_DISBURSEMENT - Withdrawal failed
// 4. REVERSED_DISBURSEMENT - Withdrawal reversed

export class MonnifyWebhookProcessor {
  private clientSecret: string;

  constructor(clientSecret?: string) {
    // Use provided secret or get from environment
    this.clientSecret = clientSecret || process.env.MONNIFY_SECRET_KEY || "";

    if (!this.clientSecret) {
      logger.warn(
        "Monnify webhook: No client secret configured for signature validation"
      );
    }
  }

  // Validate Monnify webhook signature
  // Monnify uses HMAC-SHA512 hash sent in 'monnify-signature' header

  validateSignature(
    requestBody: string,
    signature: string,
    secret?: string
  ): boolean {
    try {
      const secretKey = secret || this.clientSecret;

      if (!secretKey || !signature) {
        logger.warn(
          "Monnify webhook: Missing secret or signature for validation"
        );
        return false;
      }

      // Compute HMAC-SHA512 hash
      const computedHash = crypto
        .createHmac("sha512", secretKey)
        .update(requestBody)
        .digest("hex");

      // Compare hashes using a constant-time comparison (avoids leaking
      // timing information about how much of the signature matched)
      const computedBuffer = Buffer.from(computedHash, "hex");
      const signatureBuffer = Buffer.from(signature, "hex");
      const isValid =
        computedBuffer.length === signatureBuffer.length &&
        crypto.timingSafeEqual(computedBuffer, signatureBuffer);

      if (!isValid) {
        logger.error("Monnify webhook: Signature validation failed", {
          expected: signature,
          computed: computedHash,
        });
      }

      return isValid;
    } catch (error) {
      logger.error("Monnify webhook: Signature validation error", { error });
      return false;
    }
  }

  // Validate Monnify webhook payload structure

  validatePayload(payload: any): boolean {
    try {
      // Check required fields
      if (!payload || typeof payload !== "object") {
        logger.error("Monnify webhook: Invalid payload structure", { payload });
        return false;
      }

      // Check eventType
      const supportedEvents = [
        "SUCCESSFUL_TRANSACTION",
        "SUCCESSFUL_DISBURSEMENT",
        "FAILED_DISBURSEMENT",
        "REVERSED_DISBURSEMENT",
      ];

      if (!supportedEvents.includes(payload.eventType)) {
        logger.error("Monnify webhook: Unsupported event type", {
          eventType: payload.eventType,
        });
        return false;
      }

      // Check eventData object
      if (!payload.eventData || typeof payload.eventData !== "object") {
        logger.error("Monnify webhook: Missing eventData object", { payload });
        return false;
      }

      // Event-specific validation
      switch (payload.eventType) {
        case "SUCCESSFUL_TRANSACTION":
          return this.validateTransactionPayload(payload.eventData);

        case "SUCCESSFUL_DISBURSEMENT":
        case "FAILED_DISBURSEMENT":
        case "REVERSED_DISBURSEMENT":
          return this.validateDisbursementPayload(payload.eventData);

        default:
          return false;
      }
    } catch (error) {
      logger.error("Monnify webhook: Validation error", { error, payload });
      return false;
    }
  }

  // Replace the validateTransactionPayload method in MonnifyWebhookProcessor

  private validateTransactionPayload(data: any): boolean {
    const requiredFields = [
      "product",
      "transactionReference",
      "paymentReference",
      "amountPaid",
      "settlementAmount",
      "paymentStatus",
    ];

    for (const field of requiredFields) {
      if (!data[field]) {
        logger.error(`Monnify webhook: Missing required field: ${field}`, {
          data,
        });
        return false;
      }
    }

    // Validate product.reference exists
    if (!data.product.reference) {
      logger.error("Monnify webhook: Missing product.reference", { data });
      return false;
    }

    // CARD PAYMENTS: destinationAccountInformation may be empty {}
    // VIRTUAL ACCOUNT DEPOSITS: destinationAccountInformation contains accountNumber
    // Only validate if destinationAccountInformation has data
    if (
      data.destinationAccountInformation &&
      Object.keys(data.destinationAccountInformation).length > 0
    ) {
      if (!data.destinationAccountInformation.accountNumber) {
        logger.error(
          "Monnify webhook: Missing destinationAccountInformation.accountNumber when object is present",
          { data }
        );
        return false;
      }
    }

    return true;
  }

  // Validate disbursement payload

  private validateDisbursementPayload(data: any): boolean {
    const requiredFields = [
      "reference",
      "transactionReference",
      "amount",
      "status",
      "destinationAccountNumber",
      "destinationBankCode",
    ];

    for (const field of requiredFields) {
      if (!data[field]) {
        logger.error(`Monnify webhook: Missing required field: ${field}`, {
          data,
        });
        return false;
      }
    }

    return true;
  }

  // Process Monnify webhook and extract transaction data

  async process(payload: MonnifyWebhookPayload): Promise<WebhookProcessResult> {
    try {
      logger.info("Monnify webhook: Processing payload", {
        eventType: payload.eventType,
        reference:
          payload.eventType === "SUCCESSFUL_TRANSACTION"
            ? payload.eventData.product?.reference
            : payload.eventData.reference,
      });

      // Validate payload
      if (!this.validatePayload(payload)) {
        throw new AppError(
          "Invalid Monnify webhook payload",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      // Route to appropriate handler based on event type
      switch (payload.eventType) {
        case "SUCCESSFUL_TRANSACTION":
          return this.processSuccessfulTransaction(payload);

        case "SUCCESSFUL_DISBURSEMENT":
          return this.processSuccessfulDisbursement(payload);

        case "FAILED_DISBURSEMENT":
          return this.processFailedDisbursement(payload);

        case "REVERSED_DISBURSEMENT":
          return this.processReversedDisbursement(payload);

        default:
          throw new AppError(
            `Unsupported Monnify event type`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR
          );
      }
    } catch (error) {
      logger.error("Monnify webhook: Processing error", { error, payload });
      throw error;
    }
  }

  // Process SUCCESSFUL_TRANSACTION (Wallet Funding)

  private processSuccessfulTransaction(
    payload: MonnifySuccessfulTransactionWebhook
  ): WebhookProcessResult {
    const { eventData } = payload;

    // Extract reference from product
    const reference = eventData.product.reference;

    // Map Monnify status
    const status = this.mapTransactionStatus(eventData.paymentStatus);

    // Extract metadata
    const metadata = {
      // Monnify specific fields
      monnifyTransactionReference: eventData.transactionReference,
      monnifyPaymentReference: eventData.paymentReference,
      productType: eventData.product.type,

      // Account details
      virtualAccountNumber:
        eventData.destinationAccountInformation.accountNumber,
      virtualBankName: eventData.destinationAccountInformation.bankName,
      virtualBankCode: eventData.destinationAccountInformation.bankCode,

      // Payment source
      paymentSourceInformation: eventData.paymentSourceInformation,
      paymentMethod: eventData.paymentMethod,

      // Amount details
      amountPaid: eventData.amountPaid,
      totalPayable: eventData.totalPayable,
      settlementAmount: Number(eventData.settlementAmount),
      fees: eventData.amountPaid - Number(eventData.settlementAmount),
      netAmount: Number(eventData.settlementAmount),

      // Transaction details
      paidOn: eventData.paidOn,
      paymentDescription: eventData.paymentDescription,
      currency: eventData.currency,

      // Customer details
      customer: eventData.customer,

      // Webhook info
      eventType: payload.eventType,
      webhookReceivedAt: new Date(),
    };

    const result: WebhookProcessResult = {
      reference, // YOUR reference (e.g., "PAY_1234567890")
      providerReference: eventData.paymentReference, // Monnify's payment reference
      providerTransactionId: eventData.transactionReference, // Monnify's transaction reference
      status,
      metadata,
    };

    logger.info("Monnify webhook: Successful transaction processed", {
      reference,
      providerReference: eventData.paymentReference,
      providerTransactionId: eventData.transactionReference,
      status,
      amount: eventData.amountPaid,
      settlementAmount: eventData.settlementAmount,
    });

    return result;
  }

  // Process SUCCESSFUL_DISBURSEMENT (Withdrawal Success)

  private processSuccessfulDisbursement(
    payload: MonnifySuccessfulDisbursementWebhook
  ): WebhookProcessResult {
    const { eventData } = payload;

    const metadata = {
      // Monnify specific fields
      monnifyTransactionReference: eventData.transactionReference,
      sessionId: eventData.sessionId,

      // Destination details
      destinationAccountNumber: eventData.destinationAccountNumber,
      destinationAccountName: eventData.destinationAccountName,
      destinationBankCode: eventData.destinationBankCode,
      destinationBankName: eventData.destinationBankName,

      // Amount details
      amount: eventData.amount,
      fee: eventData.fee,
      netAmount: eventData.amount - eventData.fee,

      // Transaction details
      narration: eventData.narration,
      transactionDescription: eventData.transactionDescription,
      currency: eventData.currency,
      status: eventData.status,

      // Timestamps
      createdOn: eventData.createdOn,
      completedOn: eventData.completedOn,

      // Webhook info
      eventType: payload.eventType,
      webhookReceivedAt: new Date(),
    };

    const result: WebhookProcessResult = {
      reference: eventData.reference, // YOUR reference (e.g., "WTH_1234567890")
      providerReference: eventData.transactionReference, // Monnify's transaction reference
      providerTransactionId: eventData.transactionReference,
      status: "success",
      metadata,
    };

    logger.info("Monnify webhook: Successful disbursement processed", {
      reference: eventData.reference,
      providerReference: eventData.transactionReference,
      status: "success",
      amount: eventData.amount,
      destinationAccount: eventData.destinationAccountNumber,
    });

    return result;
  }

  // Process FAILED_DISBURSEMENT (Withdrawal Failed)

  private processFailedDisbursement(
    payload: MonnifyFailedDisbursementWebhook
  ): WebhookProcessResult {
    const { eventData } = payload;

    const metadata = {
      monnifyTransactionReference: eventData.transactionReference,
      sessionId: eventData.sessionId,
      destinationAccountNumber: eventData.destinationAccountNumber,
      destinationAccountName: eventData.destinationAccountName,
      destinationBankCode: eventData.destinationBankCode,
      destinationBankName: eventData.destinationBankName,
      amount: eventData.amount,
      fee: eventData.fee,
      narration: eventData.narration,
      transactionDescription: eventData.transactionDescription,
      failureReason: eventData.transactionDescription,
      currency: eventData.currency,
      status: eventData.status,
      createdOn: eventData.createdOn,
      completedOn: eventData.completedOn,
      eventType: payload.eventType,
      webhookReceivedAt: new Date(),
    };

    const result: WebhookProcessResult = {
      reference: eventData.reference,
      providerReference: eventData.transactionReference,
      providerTransactionId: eventData.transactionReference,
      status: "failed",
      metadata,
    };

    logger.info("Monnify webhook: Failed disbursement processed", {
      reference: eventData.reference,
      providerReference: eventData.transactionReference,
      status: "failed",
      amount: eventData.amount,
      failureReason: eventData.transactionDescription,
    });

    return result;
  }

  // Process REVERSED_DISBURSEMENT (Withdrawal Reversed)

  private processReversedDisbursement(
    payload: MonnifyReversedDisbursementWebhook
  ): WebhookProcessResult {
    const { eventData } = payload;

    const metadata = {
      monnifyTransactionReference: eventData.transactionReference,
      sessionId: eventData.sessionId,
      destinationAccountNumber: eventData.destinationAccountNumber,
      destinationAccountName: eventData.destinationAccountName,
      destinationBankCode: eventData.destinationBankCode,
      amount: eventData.amount,
      fee: eventData.fee,
      narration: eventData.narration,
      currency: eventData.currency,
      status: eventData.status,
      createdOn: eventData.createdOn,
      completedOn: eventData.completedOn,
      eventType: payload.eventType,
      webhookReceivedAt: new Date(),
    };

    const result: WebhookProcessResult = {
      reference: eventData.reference,
      providerReference: eventData.transactionReference,
      providerTransactionId: eventData.transactionReference,
      status: "reversed",
      metadata,
    };

    logger.info("Monnify webhook: Reversed disbursement processed", {
      reference: eventData.reference,
      providerReference: eventData.transactionReference,
      status: "reversed",
      amount: eventData.amount,
    });

    return result;
  }

  // Map Monnify transaction status to standard status

  private mapTransactionStatus(
    monnifyStatus: string
  ): "success" | "pending" | "failed" {
    switch (monnifyStatus) {
      case "PAID":
        return "success";
      case "PENDING":
        return "pending";
      case "FAILED":
        return "failed";
      default:
        logger.warn("Monnify webhook: Unknown transaction status", {
          monnifyStatus,
        });
        return "pending";
    }
  }

  // Optional: Validate webhook IP (whitelist Monnify's IP)
  // Monnify webhook IP: 35.242.133.146

  validateIP(ip: string): boolean {
    const allowedIPs = [
      "35.242.133.146", // Monnify webhook IP
      "127.0.0.1", // Localhost for testing
      "::1", // Localhost IPv6
    ];

    return allowedIPs.includes(ip);
  }
}
