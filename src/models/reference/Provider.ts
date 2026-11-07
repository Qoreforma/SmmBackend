import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProvider extends Document {
  name: string;
  code: string;
  logo?: string;
  isActive: boolean;
  hasSync: boolean;
  lastSyncedAt?: Date;
  serviceType: Types.ObjectId[];
  paymentOptions?: string[];
  usdNgnRate?: number;
  usd_ngn_rate?: number;
  markupPercent?: number;
  markup_percent?: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyProviderId?: string;
}

const ProviderSchema = new Schema<IProvider>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    logo: { type: String },
    isActive: { type: Boolean, default: true },
    paymentOptions: [{ type: String }],
    hasSync: { type: Boolean, default: false },
    lastSyncedAt: { type: Date },
    usdNgnRate: { type: Number },
    usd_ngn_rate: { type: Number },
    markupPercent: { type: Number },
    markup_percent: { type: Number },
    serviceType: [
      {
        type: Schema.Types.ObjectId,
        ref: "ServiceType",
      },
    ],
    deletedAt: { type: Date },
    legacyProviderId: { type: String, index: true,sparse: true  },
  },
  {
    timestamps: true,
  }
);

ProviderSchema.pre("save", function (next) {
  if (this.usdNgnRate !== undefined && this.usd_ngn_rate === undefined) {
    this.usd_ngn_rate = this.usdNgnRate;
  } else if (this.usd_ngn_rate !== undefined && this.usdNgnRate === undefined) {
    this.usdNgnRate = this.usd_ngn_rate;
  }

  if (this.markupPercent !== undefined && this.markup_percent === undefined) {
    this.markup_percent = this.markupPercent;
  } else if (this.markup_percent !== undefined && this.markupPercent === undefined) {
    this.markupPercent = this.markup_percent;
  }
  next();
});

// Indexes
ProviderSchema.index({ isActive: 1 });
ProviderSchema.index({ hasSync: 1 });

// Virtual for checking if provider can sync
ProviderSchema.virtual("canSync").get(function () {
  return this.hasSync && this.isActive;
});

export const Provider = mongoose.model<IProvider>("Provider", ProviderSchema);
