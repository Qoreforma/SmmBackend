import mongoose, { Schema, Document } from "mongoose";

export interface IServiceType extends Document {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  status: "active" | "coming-soon" | "deactivated" | "temporary-deactivated";
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  services?: any[];
}

const ServiceTypeSchema = new Schema<IServiceType>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    icon: {
      type: String,
    },
    status: {
      type: String,
      enum: ["active", "coming-soon", "deactivated", "temporary-deactivated"],
      default: "active",
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ServiceTypeSchema.virtual("services", {
  ref: "Service",
  localField: "_id",
  foreignField: "serviceTypeId",
  match: { deletedAt: null },
  options: { sort: { displayOrder: 1 } },
});

ServiceTypeSchema.index({ status: 1 });
ServiceTypeSchema.index({ displayOrder: 1 });
ServiceTypeSchema.index({ code: 1, status: 1 });

export const ServiceType = mongoose.model<IServiceType>(
  "ServiceType",
  ServiceTypeSchema
);