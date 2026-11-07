import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChannelIdentity extends Document {
  channel: "telegram" | "whatsapp";
  externalId: string;
  userId: Types.ObjectId;
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelIdentitySchema = new Schema<IChannelIdentity>(
  {
    channel: { type: String, enum: ["telegram", "whatsapp"], required: true },
    externalId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    linkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

ChannelIdentitySchema.index({ channel: 1, externalId: 1 }, { unique: true });
ChannelIdentitySchema.index({ userId: 1, channel: 1 });

export const ChannelIdentity = mongoose.model<IChannelIdentity>(
  "ChannelIdentity",
  ChannelIdentitySchema,
);
