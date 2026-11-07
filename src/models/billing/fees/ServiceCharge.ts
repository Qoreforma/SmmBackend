import mongoose, { Schema, Document } from 'mongoose';

export interface IServiceCharge extends Document {
  name: string;
  code: string;
  details?: string;
  type: 'flat' | 'percentage';
  value: number;
  cap: number;
  createdAt: Date;
  updatedAt: Date;
  legacyServiceChargeId?: string;
}

const ServiceChargeSchema = new Schema<IServiceCharge>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    details: { type: String },
    type: { type: String, enum: ['flat', 'percentage'], required: true },
    value: { type: Number, required: true },
    cap: { type: Number, default: 0 },
    legacyServiceChargeId: { type: String, index: true, sparse: true  },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
ServiceChargeSchema.index({ type: 1 });

export const ServiceCharge = mongoose.model<IServiceCharge>('ServiceCharge', ServiceChargeSchema);
