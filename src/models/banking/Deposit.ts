import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDeposit extends Document {
  userId: Types.ObjectId;
  walletId: Types.ObjectId;
  reference: string;
  provider: string;
  amount: number;
  status: "success" | "failed";
  meta?: {
    webhookData?: any;
    providerReference?: string;
    providerTransactionId?: string;
    virtualAccountId?: Types.ObjectId;
    fees?: number;
    vat?: number;
    stampDuty?: number;
    grossAmount?: number;
    netAmount?: number;
    unsolicited?: boolean;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const depositSchema = new Schema<IDeposit>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
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
      enum: ["monnify", "flutterwave", "saveHaven", "xixapay"],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
      index: true,
    },
    meta: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Indexes
depositSchema.index({ status: 1, createdAt: -1 });
depositSchema.index({ userId: 1, status: 1 });
depositSchema.index({ provider: 1, createdAt: -1 });

export const Deposit = mongoose.model<IDeposit>("Deposit", depositSchema);
