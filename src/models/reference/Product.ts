import mongoose, { Schema, Document, Types } from "mongoose";
import { IProvider } from "./Provider";
import {
  DataCategory,
  DataType,
  MeterType,
  ProductType,
  ValidityPeriod,
} from "@/utils/constants";

export interface IProduct extends Document {
  serviceId: Types.ObjectId;
  providerId: Types.ObjectId | IProvider;
  legacyProductId?: string;
  name: string;
  code: string;
  logo: string;
  providerAmount: number;
  amount: number;
  validity?: string;
  description?: string;
  productType?: ProductType | string;
  category?: DataCategory | string;

  dataSize?: number; 
  dataSizeDisplay?: string;

  attributes?: {
    dataType?: DataType;
    category?: DataCategory | string;
    validityPeriod?: ValidityPeriod | string;

    // For electricity
    discoName?: string;
    meterType?: MeterType;

    // For TV
    bouquetType?: string;
    decoderType?: string;

    // For betting
    minimumStake?: number;

    // For education
    examType?: string;

    networkId?: string;

    // Allow any other flexible attributes
    [key: string]: any;
  };

  isActive: boolean;
  isHot?: boolean;
  allowBelowCost?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    legacyProductId: { type: String, index: true, sparse: true  },
    name: { type: String, required: true },
    code: {
      type: String,
      required: true,
    },

    providerAmount: { type: Number, required: true },
    amount: { type: Number, required: true },
    validity: { type: String },
    description: { type: String },
    logo: { type: String, default: "" },
    productType: { type: String },
    category: { type: String, index: true },

    dataSize: {
      type: Number, // Size in MB
      index: true,
    },
    dataSizeDisplay: {
      type: String, // Display format
    },

    // Flexible attributes field
    attributes: {
      type: Schema.Types.Mixed,
      default: {},
    },

    isActive: { type: Boolean, default: true },
    isHot: { type: Boolean, default: false, index: true },
    allowBelowCost: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProductSchema.index({ serviceId: 1 });
ProductSchema.index({ providerId: 1 });
ProductSchema.index({ isActive: 1 });
ProductSchema.index({ serviceId: 1, isActive: 1 });
ProductSchema.index({ serviceId: 1, isHot: 1 });
ProductSchema.index({ isActive: 1, isHot: 1 });
ProductSchema.index({ type: 1, isActive: 1 });
ProductSchema.index({ dataSize: 1, isActive: 1 }); 

// Indexes for filtering by attributes
ProductSchema.index({ type: 1, "attributes.dataType": 1 });
ProductSchema.index({ type: 1, "attributes.validityPeriod": 1 });
ProductSchema.index({ type: 1, isActive: 1, "attributes.validityPeriod": 1 });
ProductSchema.index({ serviceId: 1, category: 1, isActive: 1 });
ProductSchema.index({ "attributes.category": 1 });
ProductSchema.index({ "attributes.meterType": 1 });
ProductSchema.index({ code: 1, providerId: 1, serviceId: 1 }, { unique: true });
ProductSchema.index({ serviceId: 1, providerId: 1, isActive: 1 });
ProductSchema.index({ 
  name: "text", 
  description: "text" 
});

// Virtual for formatted amount
ProductSchema.virtual("formattedAmount").get(function () {
  return `₦${this.amount.toLocaleString()}`;
});

// Virtual for formatted provider amount
ProductSchema.virtual("formattedProviderAmount").get(function () {
  return `₦${this.providerAmount.toLocaleString()}`;
});

// Method to calculate markup percentage
ProductSchema.methods.getMarkupPercentage = function (): number {
  if (this.providerAmount === 0) return 0;
  return ((this.amount - this.providerAmount) / this.providerAmount) * 100;
};

// Static method to find products by service
ProductSchema.statics.findByService = function (
  serviceId: string,
  options?: {
    isActive?: boolean;
    providerId?: string;
    productType?: string;
    minAmount?: number;
    maxAmount?: number;
  }
) {
  const query: any = { serviceId };

  if (options?.isActive !== undefined) {
    query.isActive = options.isActive;
  }

  if (options?.providerId) {
    query.providerId = options.providerId;
  }

  if (options?.productType) {
    query.productType = options.productType;
  }

  if (options?.minAmount !== undefined || options?.maxAmount !== undefined) {
    query.amount = {};
    if (options.minAmount !== undefined) {
      query.amount.$gte = options.minAmount;
    }
    if (options.maxAmount !== undefined) {
      query.amount.$lte = options.maxAmount;
    }
  }

  return this.find(query).sort({ amount: 1 });
};

// Static method to find products by data size range
ProductSchema.statics.findByDataSizeRange = function (
  minSizeMB: number,
  maxSizeMB: number,
  options?: {
    serviceId?: string;
    providerId?: string;
    isActive?: boolean;
  }
) {
  const query: any = {
    dataSize: { $gte: minSizeMB, $lte: maxSizeMB },
  };

  if (options?.serviceId) {
    query.serviceId = options.serviceId;
  }

  if (options?.providerId) {
    query.providerId = options.providerId;
  }

  if (options?.isActive !== undefined) {
    query.isActive = options.isActive;
  }

  return this.find(query).sort({ dataSize: 1, amount: 1 });
};

// Pre-save middleware to ensure consistency
ProductSchema.pre("save", function (next) {
  // If selling below provider cost, allowBelowCost must be enabled
  if (this.amount < this.providerAmount) {
    if (!this.allowBelowCost) {
      this.amount = this.providerAmount;
    } else {
      // Enforce max 3% below provider cost
      const minAllowed = Math.floor(this.providerAmount * 0.97 * 100) / 100;
      if (this.amount < minAllowed) {
        this.amount = minAllowed;
      }
    }
  }

  next();
});

export const Product = mongoose.model<IProduct>("Product", ProductSchema);
