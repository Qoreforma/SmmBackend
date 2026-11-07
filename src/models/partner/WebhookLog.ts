import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWebhookLog extends Document {
  userId: Types.ObjectId;

  // Generic transaction reference — works for any product type
  transactionId?: Types.ObjectId;        // The Transaction or GiftCardTransaction _id
  transactionModel?: "GiftCardTransaction" | "Transaction"; // Which collection

  // Legacy field — kept optional for backward compat with existing giftcard records
  giftCardTransactionId?: Types.ObjectId;

  event: string;
  webhookUrl: string;
  payload: any;
  signature: string;
  timestamp: string;

  // Delivery tracking
  status: "pending" | "success" | "failed";
  responseStatus?: number;
  responseBody?: string;
  retryCount: number;
  nextRetryAt?: Date;
  lastAttemptAt?: Date;
  succeededAt?: Date;

  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookLogSchema = new Schema<IWebhookLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Generic transaction reference (new records use this)
    transactionId: {
      type: Schema.Types.ObjectId,
      required: false,
      index: true,
    },
    transactionModel: {
      type: String,
      enum: ["GiftCardTransaction", "Transaction"],
      required: false,
    },

    // Legacy field — existing giftcard webhook logs have this populated.
    // New records use transactionId + transactionModel instead.
    giftCardTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "GiftCardTransaction",
      required: false,
      index: true,
    },

    event: { type: String, required: true },
    webhookUrl: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    signature: { type: String, required: true },
    timestamp: { type: String, required: true },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },
    responseStatus: { type: Number },
    responseBody: { type: String },
    retryCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, index: true },
    lastAttemptAt: { type: Date },
    succeededAt: { type: Date },

    deletedAt: { type: Date },
  },
  { timestamps: true },
);

WebhookLogSchema.index({ userId: 1, status: 1 });
WebhookLogSchema.index({ status: 1, nextRetryAt: 1 });

export const WebhookLog = mongoose.model<IWebhookLog>(
  "WebhookLog",
  WebhookLogSchema,
);