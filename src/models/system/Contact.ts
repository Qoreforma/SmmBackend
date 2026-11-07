import mongoose, { Document, Schema } from "mongoose";

export interface IContact extends Document {
  phoneNumber: number;
  whatsappNumber: string;
  whatsappLink: string;
  emailAddress: string;
  instagramLink?: string;
  linkedinLink?: string;
  tiktokLink?: string;
  facebookLink?: string;
  twitterLink?: string;
}

const ContactSchema = new Schema<IContact>({
  phoneNumber: {
    type: Number,
  },
  whatsappNumber: {
    type: String,
  },
  whatsappLink: {
    type: String,
  },
  emailAddress: {
    type: String,
  },
  instagramLink: {
    type: String,
  },
  linkedinLink: {
    type: String,
  },
  tiktokLink: {
    type: String,
  },
  facebookLink: {
    type: String,
  },
  twitterLink: {
    type: String,
  },
});

export const Contact = mongoose.model<IContact>("contact", ContactSchema);


