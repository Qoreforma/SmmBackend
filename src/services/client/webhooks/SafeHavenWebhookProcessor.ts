import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { WebhookProcessResult } from "../../WebhookService";

// SafeHaven webhook payload structures - FLEXIBLE VERSION
export interface SafeHavenTransferWebhook {
  type: "transfer" | "virtualAccount.transfer";
  data: {
    _id: string;
    client?: string;
    account?: string;
    virtualAccount?: string;
    type?: "Inwards" | "Outwards";
    sessionId: string;
    nameEnquiryReference?: string;
    paymentReference: string;
    mandateReference?: string | null;
    isReversed: boolean;
    reversalReference?: string | null;
    provider?: string;
    providerChannel?: string;
    providerChannelCode?: string;
    destinationInstitutionCode?: string;
    creditAccountName: string;
    creditAccountNumber: string;
    creditBankVerificationNumber?: string | null;
    creditKYCLevel?: string;
    debitAccountName?: string;
    debitAccountNumber?: string;
    debitBankVerificationNumber?: string | null;
    debitKYCLevel?: string;
    transactionLocation?: string;
    narration?: string;
    amount: number;
    fees?: number;
    vat?: number;
    stampDuty?: number;
    responseCode?: string;
    responseMessage?: string;
    status: "Completed" | "Pending" | "Failed" | "Declined";
    isDeleted?: boolean;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    declinedAt?: string;
  };
}

export class SafeHavenWebhookProcessor {
  isAccountDebitEvent(payload: any): boolean {
    return (
      !!payload &&
      typeof payload === "object" &&
      (payload.eventType === "account.debit" || payload.type === "debit") &&
      payload.data &&
      typeof payload.data === "object"
    );
  }

  isIdentityCreditCheckEvent(payload: any): boolean {
    return (
      !!payload &&
      typeof payload === "object" &&
      payload.type === "identityCreditCheck"
    );
  }


  validatePayload(payload: any): boolean {
    try {
      if (!payload || typeof payload !== "object") {
        logger.error("SafeHaven webhook: Invalid payload structure", {
          payload,
        });
        return false;
      }

      if (!["transfer", "virtualAccount.transfer"].includes(payload.type)) {
        logger.error("SafeHaven webhook: Invalid webhook type", {
          type: payload.type,
        });
        return false;
      }

      if (!payload.data || typeof payload.data !== "object") {
        logger.error("SafeHaven webhook: Missing data object", { payload });
        return false;
      }

      // 🛑 REMOVED "type" from required fields
      const requiredFields = [
        "_id",
        "sessionId",
        "paymentReference",
        "creditAccountNumber",
        "creditAccountName",
        "amount",
        "status",
        "isReversed",
        "createdAt",
        "updatedAt",
      ];

      for (const field of requiredFields) {
        if (payload.data[field] === undefined || payload.data[field] === null) {
          logger.error(`SafeHaven webhook: Missing required field: ${field}`, {
            payload,
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error("SafeHaven webhook: Validation error", { error, payload });
      return false;
    }
  }

  async process(
    payload: SafeHavenTransferWebhook,
  ): Promise<WebhookProcessResult> {
    try {
      // 🛑 THE FIX: Derive transferType safely
      const transferType =
        payload.data.type ||
        (payload.type === "virtualAccount.transfer" ? "Inwards" : "Unknown");

      logger.info("SafeHaven webhook: Processing payload", {
        type: payload.type,
        transactionId: payload.data._id,
        status: payload.data.status,
        transferType: transferType,
        amount: payload.data.amount,
      });

      if (!this.validatePayload(payload)) {
        throw new AppError(
          "Invalid SafeHaven webhook payload",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const { data } = payload;
      const status = this.mapStatus(data.status, data.isReversed);
      const metadata = this.extractMetadata(payload, transferType); // Passed transferType
      const reference = this.extractReference(data, transferType); // Passed transferType

      const result: WebhookProcessResult = {
        reference,
        providerReference: data.paymentReference,
        providerTransactionId: data._id,
        status,
        metadata: {
          ...metadata,
          webhookType: payload.type,
          transferType: transferType, // Use the derived type!
          creditAccountNumber: data.creditAccountNumber,
          debitAccountNumber: data.debitAccountNumber || "N/A",
        },
      };

      return result;
    } catch (error) {
      logger.error("SafeHaven webhook: Processing error", { error, payload });
      throw error;
    }
  }

  // Extract reference based on transfer type
  private extractReference(
    data: SafeHavenTransferWebhook["data"],
    transferType: string,
  ): string {
    if (transferType === "Outwards" && data.narration) {
      const narrationMatch = data.narration.match(/WTH_\w+|PAY_\w+|BTR_\w+/);
      if (narrationMatch) {
        return narrationMatch[0];
      }
    }
    return data.paymentReference;
  }

  private mapStatus(
    safeHavenStatus: string,
    isReversed: boolean,
  ): "success" | "pending" | "failed" | "reversed" {
    if (isReversed) return "reversed";

    switch (safeHavenStatus) {
      case "Completed":
        return "success";
      case "Created":
      case "Initiated":
      case "Processing":
      case "Pending":
        return "pending";
      case "Failed":
      case "Canceled":
      case "Declined":
        return "failed";
      default:
        logger.warn(
          "SafeHaven webhook: Unknown status, defaulting to pending",
          { safeHavenStatus },
        );
        return "pending";
    }
  }

  private extractMetadata(
    payload: SafeHavenTransferWebhook,
    transferType: string,
  ): any {
    const data = payload.data;
    return {
      safeHavenTransactionId: data._id,
      sessionId: data.sessionId,
      nameEnquiryReference: data.nameEnquiryReference || "N/A",
      paymentReference: data.paymentReference,
      creditAccountName: data.creditAccountName,
      creditAccountNumber: data.creditAccountNumber,
      debitAccountName: data.debitAccountName || "N/A",
      debitAccountNumber: data.debitAccountNumber || "N/A",
      provider: data.provider || "SaveHaven",
      providerChannel: data.providerChannel || "N/A",
      providerChannelCode: data.providerChannelCode || "N/A",
      destinationInstitutionCode: data.destinationInstitutionCode || "N/A",
      narration: data.narration || "N/A",
      amount: data.amount,
      fees: data.fees || 0,
      vat: data.vat || 0,
      stampDuty: data.stampDuty || 0,
      netAmount:
        data.amount -
        (data.fees || 0) -
        (data.vat || 0) -
        (data.stampDuty || 0),
      responseCode: data.responseCode || "N/A",
      responseMessage: data.responseMessage || "N/A",
      isReversed: data.isReversed,
      reversalReference: data.reversalReference || null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      approvedAt: data.approvedAt || null,
      declinedAt: data.declinedAt || null,
      webhookReceivedAt: new Date(),
    };
  }

  isWalletFunding(payloadType: string, transferType?: string): boolean {
    return (
      payloadType === "virtualAccount.transfer" || transferType === "Inwards"
    );
  }

  isWithdrawal(transferType?: string): boolean {
    return transferType === "Outwards";
  }
}
