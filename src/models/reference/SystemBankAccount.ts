import mongoose, { Schema, Document } from "mongoose";

export interface ISystemBankAccount extends Document {
  accountName: string;
  legacySystemBankAccountId?: string;
  accountNumber: string;
  bankCode: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SystemBankAccountSchema = new Schema<ISystemBankAccount>(
  {
    accountName: { type: String, required: true },
    legacySystemBankAccountId: { type: String, index: true, sparse: true  },
    accountNumber: { type: String, required: true },
    bankCode: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Ensure only one default account
SystemBankAccountSchema.pre("save", async function (next) {
  if (this.isDefault) {
    await mongoose
      .model("SystemBankAccount")
      .updateMany({ _id: { $ne: this._id } }, { $set: { isDefault: false } });
  }
  next();
});

export const SystemBankAccount = mongoose.model<ISystemBankAccount>(
  "SystemBankAccount",
  SystemBankAccountSchema
);
