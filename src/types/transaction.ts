import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";

export interface TransactionResponseDTO {
  id: string;
  reference: string;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  type: string;
  displayType: string;
  status: string;
  purpose: string;
  baseAmount?: number;
  provider: string;
  remark: string;
  description: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
  updatedAt?: Date;
  transactableType?: string;
  transactableId?: string;
  bonusCategory?: string;
  metadata?: TransactionMetadata;
  reversal?: {
    reference: string;
    amount: number;
    direction: "CREDIT" | "DEBIT";
    occurredAt: Date;
    reason?: string;
  };
}

export interface TransactionMetadata {
  // Provider details
  provider?: string;
  providerReference?: string;
  providerOrderId?: string;

  // Wallet transfers
  recipientName?: string;
  recipentUsername?: string;
  recipientEmail?: string;
  recipientId?: string;
  senderName?: string;
  senderUsername?: string;
  senderEmail?: string;
  senderId?: string;
  transferId?: string;

  // Bank transfers / Withdrawals / Deposits
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  debitAccountNumber?: string;
  debitAccountName?: string;
  debitBankName?: string;

  // SMM & Digital Services
  productName?: string;
  serviceCategory?: string;
  serviceCode?: string;
  link?: string;
  quantity?: number;
  startCount?: number;
  remains?: number;
  operator?: string;
  country?: string;
  orderId?: string;

  // Fees (for deposits/withdrawals)
  fees?: number;
  vat?: number;
  grossAmount?: number;
  netAmount?: number;

  // Response messages
  responseMessage?: string;

  // Refund specific
  originalReference?: string;
  reason?: string;
  email?: string;

  // General & Fees
  remark?: string;
  cashbackAmount?: number;
  bonusApplied?: number;
  cashbackInfo?: {
    amount?: number;
    serviceName?: string;
    credited?: boolean;
    creditedAt?: Date;
  };

  chargeInfo?: {
    baseAmount?: number;
    chargeAmount?: number;
    totalAmount?: number;
    serviceCharge?: IServiceCharge | null;
    amountSaved?: number;
    discountedAmount?: number;
    chargeType?: string;
    chargeValue?: number;
    totalDeduction?: number;
    cashbackAmount?: number;
    bonusApplied?: number;
  };

  failureReason?: string;
  rawFailureReason?: string;
}

export interface TransactionListResponseDTO {
  data: TransactionResponseDTO[];
  total: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}
