import {
  TransactionResponseDTO,
  TransactionListResponseDTO,
  TransactionMetadata,
} from "@/types";
import { TRANSACTION_TYPES } from "../constants";
import { toDisplayProviderName } from "../helpers";

export class TransactionMapper {
  // Handle single transaction
  static toDTO(
    transaction: any,
    linkedTransaction?: any,
    transactableDoc?: any,
  ): TransactionResponseDTO {
    return {
      id: transaction._id?.toString() || transaction.id,
      reference: transaction.reference,
      amount: transaction.amount,
      direction: transaction.direction,
      type: transaction.type,
      displayType: this.formatDisplayType(
        transaction.type,
        transaction.direction,
      ),
      status: transaction.status,
      purpose: transaction.purpose,
      remark:
        transaction.remark ||
        transaction.purpose ||
        transaction.description ||
        "",
      provider:
        toDisplayProviderName(transaction.provider) || transaction.provider,
      baseAmount: transaction.chargeInfo?.baseAmount,
      description: this.generateDescription(transaction),
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      metadata: this.getSanitizedMetadata(transaction, transactableDoc),
      transactableType: transaction.transactableType || "",
      transactableId: transaction.transactableId || "",
      bonusCategory: transaction.bonusCategory,
      reversal: this.getReversalSummary(linkedTransaction),
    };
  }

  // Handle list of transactions
  static toDTOList(
    transactions: any[],
    linkedMap?: Map<string, any>,
    transactableMap?: Map<string, any>,
  ): TransactionResponseDTO[] {
    return transactions.map((t) =>
      this.toDTO(
        t,
        linkedMap?.get(t._id?.toString()),
        transactableMap?.get(t._id?.toString()),
      ),
    );
  }

  // Handle paginated list of transactions
  static toPaginatedDTO(
    data: any[],
    total: number,
    page?: number,
    limit?: number,
    linkedMap?: Map<string, any>,
    transactableMap?: Map<string, any>,
  ): TransactionListResponseDTO {
    return {
      data: this.toDTOList(data, linkedMap, transactableMap),
      total,
      page,
      limit,
      totalPages: limit ? Math.ceil(total / limit) : undefined,
    };
  }

  // Format display type based on transaction type and direction
  private static formatDisplayType(
    type: string,
    direction: "CREDIT" | "DEBIT",
  ): string {
    if (!type) return "Transaction";
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private static generateDescription(transaction: any): string {
    const meta = transaction.meta || {};

    switch (transaction.type) {
      case TRANSACTION_TYPES.WALLET_TRANSFER:
        if (transaction.direction === "DEBIT") {
          return `Transfer to ${
            meta.recipientUsername || meta.recipientEmail || "user"
          }`;
        }
        return "Transfer received";

      case TRANSACTION_TYPES.WITHDRAWAL:
        return `Withdrawal to ${meta.bankName || "bank account"}`;

      case TRANSACTION_TYPES.DEPOSIT:
        return "Wallet funded";

      case TRANSACTION_TYPES.WALLET_CREDIT:
        return meta.reason || transaction.remark || "Wallet credited";

      case TRANSACTION_TYPES.WALLET_DEBIT:
        return meta.reason || transaction.remark || "Wallet debited";

      case TRANSACTION_TYPES.SMM:
        return meta.productName ? `SMM: ${meta.productName}` : "SMM Order";

      case TRANSACTION_TYPES.NUMBER_RENTAL:
        return "Number Rental";

      case TRANSACTION_TYPES.GAME_TOPUP:
        return meta.productName ? `Game Topup: ${meta.productName}` : "Game Topup";

      case TRANSACTION_TYPES.PROXY:
        return "Proxy Order";

      case TRANSACTION_TYPES.EMAIL_OTP:
        return meta.site ? `Email OTP: ${meta.site}` : "Email OTP";

      case TRANSACTION_TYPES.REFUND:
        return transaction.remark || "Refund";

      default:
        return transaction.remark || transaction.purpose || "Transaction";
    }
  }

  private static getSanitizedMetadata(
    transaction: any,
    transactableDoc?: any,
  ): TransactionMetadata | undefined {
    const meta = transaction.meta || {};
    const sanitized: TransactionMetadata = {};

    // Always include provider from transaction level (not meta)
    if (transaction.provider) {
      sanitized.provider = toDisplayProviderName(transaction.provider);
    }

    switch (transaction.type) {
      case TRANSACTION_TYPES.WALLET_TRANSFER:
        if (transaction.direction === "DEBIT") {
          sanitized.recipientName = meta.recipientUsername;
          sanitized.recipentUsername = meta.recipientUsername;
          sanitized.recipientEmail = meta.recipientEmail;
          sanitized.recipientId = meta.recipientId;
          sanitized.senderId = meta.senderId;
          sanitized.senderUsername = meta.senderUsername;
          sanitized.senderEmail = meta.senderEmail;
        } else {
          sanitized.recipientName = meta.recipientUsername;
          sanitized.recipentUsername = meta.recipientUsername;
          sanitized.recipientEmail = meta.recipientEmail;
          sanitized.recipientId = meta.recipientId;
          sanitized.senderId = meta.senderId;
          sanitized.senderUsername = meta.senderUsername;
          sanitized.senderEmail = meta.senderEmail;
        }
        if (meta.transferId) {
          sanitized.transferId = meta.transferId;
        }
        if (transaction.remark) {
          sanitized.remark = transaction.remark;
        }
        break;

      case TRANSACTION_TYPES.WITHDRAWAL:
        if (meta.accountNumber) {
          sanitized.accountNumber = this.maskAccountNumber(meta.accountNumber);
        }
        if (meta.accountName) {
          sanitized.accountName = meta.accountName;
        }
        sanitized.bankName = meta.bankName;
        sanitized.bankCode = meta.bankCode;

        if (meta.fees) sanitized.fees = meta.fees;
        if (meta.vat) sanitized.vat = meta.vat;
        if (meta.responseMessage) {
          sanitized.responseMessage = meta.responseMessage;
        }
        break;

      case TRANSACTION_TYPES.DEPOSIT:
        if (meta.virtualAccount?.accountNumber) {
          sanitized.accountNumber = this.maskAccountNumber(
            meta.virtualAccount.accountNumber,
          );
        }
        if (meta.virtualAccount?.accountName) {
          sanitized.accountName = meta.virtualAccount.accountName;
        }
        if (meta.virtualAccount?.bankName) {
          sanitized.bankName = meta.virtualAccount.bankName;
        }

        if (meta.fees) sanitized.fees = meta.fees;
        if (meta.vat) sanitized.vat = meta.vat;
        if (meta.grossAmount) sanitized.grossAmount = meta.grossAmount;
        if (meta.netAmount) sanitized.netAmount = meta.netAmount;
        if (meta.responseMessage) {
          sanitized.responseMessage = meta.responseMessage;
        }
        if (meta.debitAccountName) {
          sanitized.debitAccountName = meta.debitAccountName;
          sanitized.senderName = meta.debitAccountName;
        }
        if (meta.debitAccountNumber) {
          sanitized.debitAccountNumber = this.maskAccountNumber(
            meta.debitAccountNumber,
          );
        }
        if (meta.debitBankName) {
          sanitized.debitBankName = meta.debitBankName;
        }
        break;

      case TRANSACTION_TYPES.SMM:
        if (meta.productName) sanitized.productName = meta.productName;
        if (meta.serviceCategory) sanitized.serviceCategory = meta.serviceCategory;
        if (meta.serviceCode) sanitized.serviceCode = meta.serviceCode;
        if (meta.link) sanitized.link = meta.link;
        if (meta.quantity != null) sanitized.quantity = meta.quantity;
        if (meta.providerOrderId) sanitized.providerOrderId = String(meta.providerOrderId);
        if (meta.startCount != null) sanitized.startCount = meta.startCount;
        if (meta.start_count != null && sanitized.startCount == null) {
          sanitized.startCount = meta.start_count;
        }
        if (meta.remains != null) sanitized.remains = meta.remains;
        break;

      case TRANSACTION_TYPES.NUMBER_RENTAL:
        if (meta.operator) sanitized.operator = meta.operator;
        if (meta.country) sanitized.country = meta.country;
        if (meta.orderId) sanitized.orderId = meta.orderId;
        break;

      case TRANSACTION_TYPES.GAME_TOPUP:
        if (meta.productName) sanitized.productName = meta.productName;
        if (meta.orderId) sanitized.orderId = meta.orderId;
        break;

      case TRANSACTION_TYPES.PROXY:
        if (meta.orderId) sanitized.orderId = meta.orderId;
        break;

      case TRANSACTION_TYPES.EMAIL_OTP:
        if (meta.email) (sanitized as any).email = meta.email;
        if (meta.site) (sanitized as any).serviceCategory = meta.site;
        if (meta.domain) (sanitized as any).operator = meta.domain;
        if (meta.orderId) sanitized.orderId = meta.orderId;
        break;

      case TRANSACTION_TYPES.REFUND:
      case TRANSACTION_TYPES.WALLET_CREDIT:
      case TRANSACTION_TYPES.WALLET_DEBIT:
        if (transaction.remark) {
          sanitized.remark = transaction.remark;
        }
        if (meta.originalReference) {
          sanitized.originalReference = meta.originalReference;
        }
        if (meta.reason) {
          sanitized.reason = meta.reason;
        }
        if (meta.email) {
          sanitized.email = meta.email;
        }
        break;
    }

    // Add general fields if available and not already set
    if (transaction.remark && !sanitized.remark) {
      sanitized.remark = transaction.remark;
    }

    if (transaction.providerReference && !sanitized.providerReference) {
      sanitized.providerReference = transaction.providerReference;
    }

    if (meta.chargeInfo) {
      sanitized.chargeInfo = {
        baseAmount: meta.chargeInfo.baseAmount,
        chargeAmount: meta.chargeInfo.serviceCharge ?? meta.chargeInfo.chargeAmount,
        totalAmount: meta.chargeInfo.totalAmount,
        amountSaved: meta.chargeInfo.amountSaved,
        discountedAmount: meta.chargeInfo.discountedAmount,
        chargeType: meta.chargeInfo.chargeType,
        chargeValue: meta.chargeInfo.chargeValue,
        totalDeduction: meta.chargeInfo.totalDeduction,
        cashbackAmount: meta.chargeInfo.cashbackAmount,
        bonusApplied: meta.chargeInfo.bonusApplied,
      };
    }

    if (
      meta.cashbackInfo?.amount != null ||
      meta.chargeInfo?.cashbackAmount != null
    ) {
      sanitized.cashbackAmount =
        meta.cashbackInfo?.amount ?? meta.chargeInfo?.cashbackAmount;
    }

    if (meta.cashbackInfo) {
      sanitized.cashbackInfo = meta.cashbackInfo;
    }

    if (meta.chargeInfo?.bonusApplied != null) {
      sanitized.bonusApplied = meta.chargeInfo.bonusApplied;
    }

    if (meta.failureReason) {
      sanitized.failureReason = meta.failureReason;
    }

    // Return undefined if no metadata was added
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  // Mask account number - show only last 4 digits
  private static maskAccountNumber(accountNumber: string): string {
    if (!accountNumber || accountNumber.length < 4) {
      return "****";
    }
    return "****" + accountNumber.slice(-4);
  }

  private static getReversalSummary(linkedTransaction?: any) {
    if (!linkedTransaction) return undefined;
    return {
      reference: linkedTransaction.reference,
      amount: linkedTransaction.amount,
      direction: linkedTransaction.direction,
      occurredAt: linkedTransaction.createdAt,
      reason:
        linkedTransaction.meta?.reversalReason ||
        linkedTransaction.meta?.reason ||
        undefined,
    };
  }
}
