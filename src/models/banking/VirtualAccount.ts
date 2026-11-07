import mongoose, { Schema, Document, Types } from "mongoose";

export interface IVirtualAccount extends Document {
  userId: Types.ObjectId;
  provider: string;
  bankCode?: string;
  bankName: string;
  customerName?: string;
  accountName?: string;
  accountNumber: string;
  accountReference?: string;
  orderReference?: string;
  isPrimary?: boolean;
  isActive?: boolean;
  type: "permanent" | "temporary";
  expiredAt?: Date;
  meta?: any;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const virtualAccountSchema = new Schema<IVirtualAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    provider: {
      type: String,
      required: true,
      enum: ["monnify", "flutterwave", "saveHaven", "xixapay"],
      index: true,
    },
    bankCode: String,
    bankName: {
      type: String,
      required: true,
    },
    customerName: String,
    accountName: String,
    accountNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountReference: {
      type: String,
      index: true,
    },
    orderReference: {
      type: String,
      index: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["permanent", "temporary"],
      required: true,
      index: true,
    },
    expiredAt: {
      type: Date,
      index: true,
    },
    meta: {
      type: Schema.Types.Mixed,
    },
    deletedAt: {
      type: Date,
      index: true,
    },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
virtualAccountSchema.index({ userId: 1, isActive: 1 });
virtualAccountSchema.index({ userId: 1, type: 1 });
virtualAccountSchema.index({ provider: 1, isActive: 1 });

virtualAccountSchema.methods.isExpired = function (): boolean {
  if (this.type === "permanent") return false;
  if (!this.expiredAt) return false;
  return new Date() > this.expiredAt;
};

export const VirtualAccount = mongoose.model<IVirtualAccount>(
  "VirtualAccount",
  virtualAccountSchema
);
