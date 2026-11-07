import mongoose, { Schema, Document, Types } from "mongoose";

export interface IServiceTypeProvider extends Document {
  serviceTypeId: Types.ObjectId; 
  providerId: Types.ObjectId; 
  isActive: boolean; 
  priority: number; 
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const ServiceTypeProviderSchema = new Schema<IServiceTypeProvider>(
  {
    serviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceType',
      required: true,
    },
    providerId: {
      type: Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 1,
      min: 1,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index: One provider per service type at each priority level
ServiceTypeProviderSchema.index(
  { serviceTypeId: 1, providerId: 1 },
  { unique: true }
);

// Index for finding active provider mappings
ServiceTypeProviderSchema.index({ serviceTypeId: 1, isActive: 1 });

// Index for priority ordering
ServiceTypeProviderSchema.index({ serviceTypeId: 1, priority: 1 });

ServiceTypeProviderSchema.index({ 
  serviceTypeId: 1, 
  isActive: 1, 
  priority: 1 
});

export const ServiceTypeProvider = mongoose.model<IServiceTypeProvider>(
  'ServiceTypeProvider',
  ServiceTypeProviderSchema
);