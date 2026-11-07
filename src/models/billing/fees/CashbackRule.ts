import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICashbackRule extends Document {
  serviceTypeId: Types.ObjectId | null;
  type: "flat" | "percentage";
  value: number;
  cap: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CashbackRuleSchema = new Schema<ICashbackRule>(
  {
    serviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ServiceType",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["flat", "percentage"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    cap: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

export const CashbackRule = mongoose.model<ICashbackRule>(
  "CashbackRule",
  CashbackRuleSchema
);
