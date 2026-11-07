import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDepositRequest extends Document {
  userId: Types.ObjectId;
  reference: string;
  provider: string;
  amount: number;
  status: "pending" | "approved" | "declined";

  accountNumber?: string; 
  providerTransactionId?: string;
  providerReference?: string; 
  verificationData?: any; 


  proof?: string;
  reviewProof?: string;
  meta?: any;
  approvedAt?: Date;
  approvedBy?: string;
  declinedAt?: Date;
  declinedBy?: string;
  declineReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const depositRequestSchema = new Schema<IDepositRequest>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
      index: true,
    },
    proof: String,
    reviewProof: String,
    approvedAt: Date,
    approvedBy: { type: String },
    declinedAt: Date,
    declinedBy: { type: String },
    declineReason: { type: String },
    meta: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

export const DepositRequest = mongoose.model<IDepositRequest>(
  "DepositRequest",
  depositRequestSchema
);
