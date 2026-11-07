import mongoose, { Schema, Document, Types } from "mongoose";

export interface IReferral extends Document {
  legacyReferralId?: string;
  refereeId: Types.ObjectId;
  referredId: Types.ObjectId;
  userType: "regular" | "influencer" | "micro-influencer";

  // For regular users - track multiple milestone bonuses
  bonusMilestones: Array<{
    bonusConfigId: Types.ObjectId;
    bonusAmount: number;
    earnedAt: Date;
    paidAt?: Date;
    status: "earned" | "paid";
  }>;


  // For influencers - rule-based bonuses
  influencerBonuses?: Array<{
    ruleType: "accountCompletion" | "firstBillPayment" | "transactionVolume" | "kycCompletion";
    amount: number;
    earnedAt: Date;
    paidAt?: Date;
    status: "earned" | "paid";
  }>;

  kycCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    legacyReferralId: {
      type: String,
      index: true,
      sparse: true 
    },
    refereeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referredId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userType: {
      type: String,
      enum: ["regular", "influencer", "micro-influencer"],
      required: true,
      index: true,
    },
    bonusMilestones: [
      {
        bonusConfigId: {
          type: Schema.Types.ObjectId,
          ref: "ReferralBonusConfig",
        },
        bonusAmount: { type: Number, required: true },
        earnedAt: { type: Date, required: true },
        paidAt: { type: Date },
        status: { type: String, enum: ["earned", "paid"], default: "earned" },
      },
    ],

    influencerBonuses: [
      {
        ruleType: { 
          type: String, 
          enum: ["accountCompletion", "firstBillPayment", "transactionVolume", "kycCompletion"],
          required: true
        },
        amount: { type: Number, required: true },
        earnedAt: { type: Date, required: true },
        paidAt: { type: Date },
        status: { type: String, enum: ["earned", "paid"], default: "earned" },
      },
    ],
    kycCompletedAt: { type: Date },
    createdAt: { type: Date, immutable: true },

  },
  { timestamps: true }
);

ReferralSchema.index({ refereeId: 1, referredId: 1 }, { unique: true });
ReferralSchema.index({ refereeId: 1, "bonusMilestones.status": 1 });
ReferralSchema.index({ userType: 1, "influencerBonuses.status": 1 });

export const Referral = mongoose.model<IReferral>("Referral", ReferralSchema);
