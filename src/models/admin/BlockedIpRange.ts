import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBlockedIpRange extends Document {
  cidr: string;
  reason?: string;
  blockedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BlockedIpRangeSchema = new Schema<IBlockedIpRange>(
  {
    cidr: { type: String, required: true, unique: true, index: true },
    reason: { type: String },
    blockedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  {
    timestamps: true,
  }
);

export const BlockedIpRange = mongoose.model<IBlockedIpRange>(
  "BlockedIpRange",
  BlockedIpRangeSchema
);
