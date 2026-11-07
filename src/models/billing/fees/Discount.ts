import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDiscount extends Document {
  providerId: Types.ObjectId;
  serviceId: Types.ObjectId;
  name: string;
  code: string;
  type: "flat" | "percentage";
  value: number;
  cap: number;
  productType: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  legacyDiscountId?: string;
}

const DiscountSchema = new Schema<IDiscount>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["flat", "percentage"], required: true },
    value: { type: Number, required: true },
    cap: { type: Number, default: 0 },
    productType: { type: String, required: true },
    active: { type: Boolean, default: true },
    legacyDiscountId: { type: String, index: true,sparse: true  },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
DiscountSchema.index({ providerId: 1 });
DiscountSchema.index({ serviceId: 1 });
DiscountSchema.index({ active: 1 });
DiscountSchema.index({ productType: 1 });
DiscountSchema.index(
  { providerId: 1, serviceId: 1, productType: 1 },
  { unique: true }
);

export const Discount = mongoose.model<IDiscount>("Discount", DiscountSchema);
