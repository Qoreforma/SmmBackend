import mongoose, { Schema, Document } from "mongoose";

export interface IBank extends Document {
  legacyBankId?: string;
  name: string;
  shortName?: string;
  flutterwaveCode?: string;
  monnifyCode?: string;
  savehavenCode?: string;
  universalCode?: string;
  icon?: string;
  country?: string;
  currency?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const BankSchema = new Schema<IBank>(
  {
    legacyBankId: { type: String, index: true, sparse: true },
    name: { type: String, required: true },
    shortName: { type: String },
    flutterwaveCode: { type: String },
    monnifyCode: { type: String },
    savehavenCode: { type: String },
    universalCode: { type: String },
    icon: { type: String },
    country: { type: String, default: "Nigeria" },
    currency: { type: String, default: "NGN" },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

// Indexes for performance
BankSchema.index({ name: 1 });
BankSchema.index({ flutterwaveCode: 1 });
BankSchema.index({ monnifyCode: 1 });
BankSchema.index({ savehavenCode: 1 });

export const Bank = mongoose.model<IBank>("Bank", BankSchema);
