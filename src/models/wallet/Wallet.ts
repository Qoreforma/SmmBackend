import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWallet extends Document {
  userId: Types.ObjectId;
  legacyWalletId?: string;
  type: "main";
  balance: number;
  bonusBalance: number;
  commissionBalance: number;
  lockedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    legacyWalletId: { type: String, index: true,sparse: true  },
    type: {
      type: String,
      required: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    bonusBalance: { type: Number, default: 0, min: 0 },
    commissionBalance: { type: Number, default: 0, min: 0 },
    lockedAt: { type: Date },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Compound unique index
WalletSchema.index({ userId: 1, type: 1 }, { unique: true });
WalletSchema.index({ userId: 1 });
WalletSchema.index({ type: 1 });

export const Wallet = mongoose.model<IWallet>("Wallet", WalletSchema);
