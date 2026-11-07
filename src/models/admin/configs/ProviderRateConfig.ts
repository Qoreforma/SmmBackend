import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProviderRateConfig extends Document {
  providerId: Types.ObjectId;
  providerCode: string; // e.g. 'nigeriasmm', 'owlet'
  serviceType: string;  // e.g. 'smm' — for clarity/filtering, not enforcement
  buyRate: number;      // platform buys from user (user sells)
  sellRate: number;     // platform sells to user (user buys)
  buyMarkupType: "flat" | "percentage";
  buyMarkupValue: number;
  buyMarkupCap: number;
  sellMarkupType: "flat" | "percentage";
  sellMarkupValue: number;
  sellMarkupCap: number;
  isActive: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProviderRateConfigSchema = new Schema<IProviderRateConfig>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
      unique: true, // one config per provider
      index: true,
    },
    providerCode: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    serviceType: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: "crypto",
    },
    buyRate: {
      type: Number,
      required: true,
      min: 0,
    },
    sellRate: {
      type: Number,
      required: true,
      min: 0,
    },
    buyMarkupType: {
      type: String,
      enum: ["flat", "percentage"],
      default: "flat",
    },
    buyMarkupValue: {
      type: Number,
      default: 0,
    },
    buyMarkupCap: {
      type: Number,
      default: 0,
    },
    sellMarkupType: {
      type: String,
      enum: ["flat", "percentage"],
      default: "flat",
    },
    sellMarkupValue: {
      type: Number,
      default: 0,
    },
    sellMarkupCap: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

ProviderRateConfigSchema.index({ providerCode: 1, isActive: 1 });

export const ProviderRateConfig = mongoose.model<IProviderRateConfig>(
  "ProviderRateConfig",
  ProviderRateConfigSchema
);