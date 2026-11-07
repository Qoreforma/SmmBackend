import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAlert extends Document {
  legacyAlertId?: string;
  creatorId: Types.ObjectId;
  title: string;
  body: string;
  status: "pending" | "dispatching" | "sent" | "failed";
  target:
    | "all"
    | "specific"
    | "verified"
    | "phone-verified"
    | "email-verified"
    | "profile-completed";
  userCount?: number;
  dispatchedAt?: Date | null;
  dispatchTime?: Date;
  isImmediate?: boolean;
  isPersonalised?: boolean;
  type?: string;
  channels: string[];
  failedNote?: string;
  users?: Types.ObjectId[];
  // Only populated when at least one selected channel is batched
  // (see src/config/alertDispatch.ts). Keyed by channel name.
  batchProgress?: Record<
    string,
    { total: number; sent: number; failed: number; completed: boolean }
  >;
  nextBatchAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

const alertSchema = new Schema<IAlert>(
  {
    legacyAlertId: {
      type: String,
      index: true,
      sparse: true,
    },
    creatorId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      maxlength: 50000,
    },
    status: {
      type: String,
      // "dispatching" = immediate channels sent, batched channel(s) still
      // draining via the batch worker — see src/jobs/alertBatchCronJobs.ts
      enum: ["pending", "dispatching", "sent", "failed"],
      default: "pending",
      index: true,
    },
    target: {
      type: String,
      enum: [
        "all",
        "specific",
        "verified",
        "phone-verified",
        "email-verified",
        "profile-completed",
      ],
      required: true,
      index: true,
    },
    userCount: {
      type: Number,
      default: 0,
    },
    dispatchedAt: {
      type: Date,
      index: true,
    },
    dispatchTime: {
      type: Date,
      default: null,
      index: true,
    },
   isImmediate: {
      type: Boolean,
      default: false,
    },
    isPersonalised: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      default: null,
    },
    channels: {
      type: [String],
      enum: ["email", "sms", "push", "in_app"],
      required: true,
      default: ["push"],
    },
    failedNote: String,
    users: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    batchProgress: {
      type: Schema.Types.Mixed,
      default: {},
    },
    nextBatchAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

alertSchema.index({ status: 1, dispatchTime: 1, deletedAt: 1 });

alertSchema.index({ status: 1, nextBatchAt: 1, deletedAt: 1 });

export const Alert = mongoose.model<IAlert>("Alert", alertSchema);
