import mongoose, { Schema, Document, Types } from "mongoose";

export interface IApiKey extends Document {
  userId: Types.ObjectId;
  name: string;
  apiKeyHash: string; // SHA-256 hash of the raw API key — used for lookup
  apiSecret: string; // AES-256-GCM encrypted — decrypt with decryptApiSecret() before use
  isActive: boolean;
  lastUsedAt?: Date;
  lastUsedIp?: string;
  requestCount: number;
  expiresAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    apiKeyHash: { type: String, required: true, select: false, index: true },
    apiSecret: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
    lastUsedIp: { type: String },
    requestCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

ApiKeySchema.index({ userId: 1, isActive: 1 });
ApiKeySchema.index({ userId: 1 }, { unique: true });

export const ApiKey = mongoose.model<IApiKey>("ApiKey", ApiKeySchema);
