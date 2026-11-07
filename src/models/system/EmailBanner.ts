import mongoose, { Schema, Document, ObjectId } from "mongoose";

export interface IEmailBanner extends Document {
  logoUrl?: string;
  headerBannerUrl?: string;
  footerBannerUrl?: string;
  updatedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const emailBannerSchema = new Schema<IEmailBanner>(
  {
    logoUrl: { type: String },
    headerBannerUrl: { type: String },
    footerBannerUrl: { type: String },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  {
    timestamps: true,
  }
);

export const EmailBanner = mongoose.model<IEmailBanner>("EmailBanner", emailBannerSchema);
