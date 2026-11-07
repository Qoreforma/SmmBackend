import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAdminDeviceApprovalRequest extends Document {
  adminId: Types.ObjectId;
  deviceId: string;
  requestedIp: string;
  userAgent?: string;
  status: "pending" | "approved" | "denied";
  expiresAt: Date;
  lastEmailedAt?: Date;
  decisionType?: "normal" | "self_approved_no_other_approver";
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminDeviceApprovalRequestSchema = new Schema<IAdminDeviceApprovalRequest>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "Admin", required: true, index: true },
    deviceId: { type: String, required: true },
    requestedIp: { type: String, required: true },
    userAgent: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "denied"],
      default: "pending",
      index: true,
    },
    decisionType: {
      type: String,
      enum: ["normal", "self_approved_no_other_approver"],
      default: "normal",
    },
    expiresAt: { type: Date, required: true },
    lastEmailedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster lookups
AdminDeviceApprovalRequestSchema.index({ adminId: 1, deviceId: 1, requestedIp: 1, status: 1 });
AdminDeviceApprovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const AdminDeviceApprovalRequest = mongoose.model<IAdminDeviceApprovalRequest>(
  "AdminDeviceApprovalRequest",
  AdminDeviceApprovalRequestSchema
);
