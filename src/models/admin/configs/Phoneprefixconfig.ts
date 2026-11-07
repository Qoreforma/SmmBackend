import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPhonePrefixEntry {
  prefix: string;   // e.g. '0803'
  network: string;  // e.g. 'MTN'
}

export interface IPhonePrefixConfig extends Document {
  prefixes: IPhonePrefixEntry[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PhonePrefixEntrySchema = new Schema<IPhonePrefixEntry>(
  {
    prefix: {
      type: String,
      required: true,
      trim: true,
    },
    network: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  { _id: false }
);

const PhonePrefixConfigSchema = new Schema<IPhonePrefixConfig>(
  {
    prefixes: {
      type: [PhonePrefixEntrySchema],
      default: [],
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

export const PhonePrefixConfig = mongoose.model<IPhonePrefixConfig>(
  "PhonePrefixConfig",
  PhonePrefixConfigSchema
);