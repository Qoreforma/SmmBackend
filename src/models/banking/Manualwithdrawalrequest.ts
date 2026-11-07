import mongoose, { Schema, Document, Types } from "mongoose";

export interface IManualWithdrawalRequest extends Document {
  userId: Types.ObjectId;
  transactionId: Types.ObjectId; // linked to original Transaction (already debited)
  stampDutyTransactionId?: Types.ObjectId; // linked to the separate STAMP_DUTY debit transaction, if any
  reference: string; // same as the original transaction reference
  amount: number; // withdrawal amount (excluding charge)
  chargeAmount: number; // service charge (excludes stamp duty)
  stampDutyAmount: number; // EMTL stamp duty, tracked separately from chargeAmount
  totalDeduction: number; // amount + chargeAmount + stampDutyAmount (what stays debited until resolved)
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  provider: string; // which automated provider failed
  status: "pending" | "approved" | "rejected";
  processedBy?: Types.ObjectId; // admin who actioned it
  processedAt?: Date;
  rejectionReason?: string;
  meta?: {
    providerError?: string;
    failedAt?: string;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ManualWithdrawalRequestSchema = new Schema<IManualWithdrawalRequest>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      index: true,
    },
    stampDutyTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    chargeAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    stampDutyAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    totalDeduction: {
      type: Number,
      required: true,
    },
    accountNumber: {
      type: String,
      required: true,
    },
    accountName: {
      type: String,
      required: true,
    },
    bankName: {
      type: String,
      required: true,
    },
    bankCode: {
      type: String,
      required: true,
    },
    provider: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    processedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    meta: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

ManualWithdrawalRequestSchema.index({ status: 1, createdAt: -1 });
ManualWithdrawalRequestSchema.index({ userId: 1, status: 1 });

export const ManualWithdrawalRequest = mongoose.model<IManualWithdrawalRequest>(
  "ManualWithdrawalRequest",
  ManualWithdrawalRequestSchema,
);