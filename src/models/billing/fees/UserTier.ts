import mongoose, { Schema, Document } from "mongoose";

export interface IUserTier extends Document {
  name: string;
  code: string;
  description?: string;
  badge?: string;
  minMonthlySpend: number; // In NGN: 0 = regular, 50000 = pro, etc.
  discountPercentage: number; // e.g. 5 = 5% off markup/fee. If 0, no discount applies.
  priority: number; // Ordering (1 = regular, 2 = pro, 3 = vip)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserTierSchema = new Schema<IUserTier>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    badge: { type: String, default: "Bronze" },
    minMonthlySpend: { type: Number, required: true, default: 0, min: 0 },
    discountPercentage: { type: Number, required: true, default: 0, min: 0, max: 100 },
    priority: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

UserTierSchema.index({ code: 1 }, { unique: true });
UserTierSchema.index({ priority: 1 });

export const UserTier = mongoose.model<IUserTier>("UserTier", UserTierSchema);
