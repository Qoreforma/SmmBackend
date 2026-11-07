import mongoose, { Schema, Document, Types } from "mongoose";

export interface IReferralBonus extends Document {
  legacyReferralBonusId?: string;
  name: string;
  userType: "regular";
  bonusType: "flat" | "percentage";
  value: number;
  threshold: number;
  description?: string;
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralBonusSchema = new Schema<IReferralBonus>(
  {
    legacyReferralBonusId: { type: String, index: true, sparse: true  },
    name: { type: String, required: true },
    userType: {
      type: String,
      enum: ["regular"],
      required: true,
    },
    bonusType: { type: String, enum: ["flat", "percentage"], required: true },
    value: { type: Number, required: true, min: 0 },
    threshold: { type: Number, required: true, min: 0 },
    description: { type: String },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, immutable: true },
  },
  { timestamps: true }
);

ReferralBonusSchema.index({ userType: 1, isActive: 1 });
ReferralBonusSchema.index({ isActive: 1, threshold: 1 });

export const ReferralBonus = mongoose.model<IReferralBonus>(
  "ReferralBonus",
  ReferralBonusSchema
);
