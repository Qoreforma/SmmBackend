import {
  ALL_TRANSACTION_TYPES,
  SystemProvider,
  TransactionType,
} from "../../utils/constants";
import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITransaction extends Document {
  legacyTransactionId?: string;
  walletId: Types.ObjectId;
  userId: Types.ObjectId;
  sourceId?: Types.ObjectId;
  recipientId?: Types.ObjectId;
  transactableType?: string;
  transactableId?: Types.ObjectId;
  reference: string;
  providerReference?: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  type: TransactionType;
  provider?: string;
  remark?: string;
  purpose?: string;
  status:
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "reversed"
  | "pending_manual";
  meta?: any;
  polling?: {
    nextPollAt?: Date;
    pollCount: number;
    lastPolledAt?: Date;
    stoppedAt?: Date;
    stopReason?: "completed" | "failed" | "timeout" | "max_attempts";
    providerOrderId?: string;
    internalReference?: string;
    pollingProvider?: string;
  };
  idempotencyKey?: string; // Prevent duplicate processing
  initiatedBy?: Types.ObjectId;
  initiatedByType?: SystemProvider;
  balanceBefore: number; // ← For reconciliation
  balanceAfter: number; // ← For reconciliation
  bonusBalanceBefore?: number;
  bonusBalanceAfter?: number;
  profit?: number; // to hold the difference between the amount charged for a service and amount charged by the the third party/amount deducted by the third party. in on word does the platform earn from the transaction or lose from it

  // Approval workflow (for manual deposits)
  approvalStatus?: "pending" | "approved" | "declined";
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  declinedBy?: Types.ObjectId;
  declinedAt?: Date;
  declineReason?: string;
  reversedBy?: Types.ObjectId;
  reversalReason?: string;
  reversedAt?: Date;

  linkedTransactionId?: Types.ObjectId;
  channel?: "ios" | "android" | "web" | "api";
  bonusCategory?: string;
  isHiddenFromUser?: boolean;
  // Soft delete
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    legacyTransactionId: { type: String, index: true, sparse: true },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true },
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    transactableType: { type: String },
    transactableId: { type: Schema.Types.ObjectId },
    reference: { type: String, required: true, unique: true },
    providerReference: { type: String },
    amount: { type: Number, required: true },
    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    type: { type: String, required: true, enum: ALL_TRANSACTION_TYPES },
    provider: { type: String, required: false },
    remark: { type: String },
    purpose: { type: String },
    status: {
      type: String,
      enum: [
        "pending",
        "pending_manual",
        "processing",
        "success",
        "failed",
        "reversed",
      ],
      default: "pending",
    },

    idempotencyKey: { type: String },
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    initiatedByType: {
      type: String,
      enum: ["user", "system", "admin"],
      default: "user",
    },

    linkedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    profit: {
      type: Number,
      default: 0,
    },
    bonusCategory: {
      type: String,
      enum: ["referral_bonus", "cashback"],
    },
    isHiddenFromUser: {
      type: Boolean,
      default: false,
    },
    // Approval workflow (for manual deposits)
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    approvedAt: { type: Date },
    declinedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    declinedAt: { type: Date },
    declineReason: { type: String },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      sparse: true,
    },
    reversalReason: {
      type: String,
      sparse: true,
    },
    reversedAt: {
      type: Date,
      sparse: true,
    },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    bonusBalanceBefore: { type: Number },
    bonusBalanceAfter: { type: Number },
    meta: { type: Schema.Types.Mixed },
    polling: { type: Schema.Types.Mixed },
    channel: {
      type: String,
      enum: ["ios", "android", "web", "api"],
      sparse: true,
      index: true,
    },

    deletedAt: { type: Date },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  },
);

// Indexes
TransactionSchema.index({ walletId: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ linkedTransactionId: 1 });
TransactionSchema.index({ sourceId: 1, createdAt: -1 }); // For user transaction history
TransactionSchema.index({ status: 1, "polling.nextPollAt": 1 }); // For polling queries
TransactionSchema.index({ providerReference: 1 }); // For webhook lookups
TransactionSchema.index({ reference: 1, status: 1 }); // For transaction status checks
TransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    sparse: true, // Allow multiple NULL values
  },
);
TransactionSchema.index({ type: 1, status: 1, walletId: 1, createdAt: -1 });
TransactionSchema.index({ reversedBy: 1, reversedAt: -1 });

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema,
);
