import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBankAccount extends Document {
  userId: Types.ObjectId;
  legacyBankAccountId?: string;
  bankId: Types.ObjectId;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  recipientCode?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    legacyBankAccountId: { type: String, index: true, sparse: true },
    bankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    bankCode: { type: String, required: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    recipientCode: { type: String },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Compound unique index
BankAccountSchema.index({ userId: 1, accountNumber: 1, bankCode: 1 }, { unique: true });
BankAccountSchema.index({ userId: 1 });
BankAccountSchema.index({ bankId: 1 });
BankAccountSchema.index({ bankCode: 1 });

export const BankAccount = mongoose.model<IBankAccount>(
  "BankAccount",
  BankAccountSchema
);
