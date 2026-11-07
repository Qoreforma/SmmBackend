import mongoose, { Schema, Document, ObjectId } from "mongoose";

export interface IBanner extends Document {
  previewImageUrl: string;
  featuredImageUrl: string;
  createdAt: Date;
  creator?: ObjectId;
  updatedAt: Date;
  isActive: boolean;
  link?: string;
  name?: string;
  legacyBannerId?: string;
  priority: number;
}

const bannerSchema = new Schema<IBanner>(
  {
    previewImageUrl: {
      type: String,
      required: true,
    },
    featuredImageUrl: {
      type: String,
      required: true,
    },
    isActive: { type: Boolean, default: false },
    creator: { type: Schema.Types.ObjectId, ref: "Admin", index: true },
    legacyBannerId: { type: String, index: true, sparse: true  },
    createdAt: { type: Date, immutable: true },
    link: { type: String },
    name: { type: String },
    priority: { type: Number, default: 0, index: true },
  },
  {
    timestamps: true,
  }
);

export const Banner = mongoose.model<IBanner>("Banner", bannerSchema);
