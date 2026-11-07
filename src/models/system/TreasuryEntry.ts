import mongoose, { Document, Schema } from "mongoose";

export enum TreasuryType {
  EXPENSE = "EXPENSE",
  CAPITAL_INJECTION = "CAPITAL_INJECTION",
  CAPITAL_EXPENSE = "CAPITAL_EXPENSE",
}

export enum TreasuryCategory {
  HOSTING = "HOSTING",
  DOMAIN = "DOMAIN",
  ADS = "ADS",
  SALARIES = "SALARIES",
  MARKETING = "MARKETING",
  PROVIDER_FUNDING = "PROVIDER_FUNDING",
  OTHER = "OTHER",
}

export interface ITreasuryEntry extends Document {
  type: TreasuryType;
  category: TreasuryCategory;
  provider?: string;
  amount: number;
  currency: string;
  description: string;
  date: Date;
  recordedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TreasuryEntrySchema = new Schema<ITreasuryEntry>(
  {
    type: {
      type: String,
      enum: Object.values(TreasuryType),
      required: true,
    },
    category: {
      type: String,
      enum: Object.values(TreasuryCategory),
      required: true,
    },
    provider: {
      type: String,
      required: false,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "NGN",
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TreasuryEntry = mongoose.model<ITreasuryEntry>(
  "TreasuryEntry",
  TreasuryEntrySchema
);
