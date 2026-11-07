import mongoose, { Schema, Document, Types } from "mongoose";

export type ServiceStatus =
  | "active"
  | "coming-soon"
  | "deactivated"
  | "temporary-deactivated";

export interface IService extends Document {
  name: string;
  code: string;
  logo?: string;
  serviceTypeId: Types.ObjectId;
  isActive: boolean;
  status: ServiceStatus;
  statusMessage?: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyServiceId?: string;
  supportedProviders: Types.ObjectId[];
}

const ServiceSchema = new Schema<IService>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    logo: { type: String },
    serviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ServiceType",
      required: true,
    },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["active", "coming-soon", "deactivated", "temporary-deactivated"],
      default: "active",
    },
    statusMessage: {
      type: String,
      trim: true,
    },
    displayOrder: { type: Number, default: 0 },
    deletedAt: { type: Date },
    legacyServiceId: { type: String, index: true, sparse: true },
    supportedProviders: [
      {
        type: Schema.Types.ObjectId,
        ref: "Provider",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Indexes
ServiceSchema.index({ isActive: 1 });
ServiceSchema.index({ status: 1 });
ServiceSchema.index({ serviceTypeId: 1 });
ServiceSchema.index({ serviceTypeId: 1, isActive: 1 });
ServiceSchema.index({ serviceTypeId: 1, status: 1 });
ServiceSchema.index({ displayOrder: 1 });

export const Service = mongoose.model<IService>("Service", ServiceSchema);

