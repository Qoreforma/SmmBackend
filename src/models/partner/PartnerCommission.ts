import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPartnerCommission extends Document {
  providerId: Types.ObjectId;
  serviceId: Types.ObjectId;
  code: string;
  name: string;
  type: "flat" | "percentage";
  value: number;
  cap: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCommissionSchema = new Schema<IPartnerCommission>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["flat", "percentage"],
      required: true,
    },
    value: { type: Number, required: true, min: 0 },
    cap: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

PartnerCommissionSchema.index({ providerId: 1 });
PartnerCommissionSchema.index({ serviceId: 1 });
PartnerCommissionSchema.index(
  { providerId: 1, serviceId: 1 },
  { unique: true },
);

export const PartnerCommission = mongoose.model<IPartnerCommission>(
  "PartnerCommission",
  PartnerCommissionSchema,
);