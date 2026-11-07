import mongoose, { Schema, Document } from "mongoose";

export interface ICountry extends Document {
  id: number;
  name: string;
  legacyCountryId?: string; // For migration purposes
  numeric_code: string;
  iso2: string;
  iso3: string;
  phonecode: string;
  region: string;
  emoji: string;
  emojiU: string;
  capital: string;
  currency: string;
  currency_name: string;
  currency_symbol: string;
  longitude: string;
  latitude: string;
  flag: string;
}

const CountrySchema = new Schema<ICountry>(
  {
    id: { type: Number, required: true, unique: true, index: true },
    legacyCountryId: { type: String, index: true, sparse: true  },
    name: { type: String, required: true, index: true },
    numeric_code: { type: String, required: true },
    iso2: { type: String, required: true, uppercase: true, index: true },
    iso3: { type: String, required: true, uppercase: true, index: true },
    phonecode: { type: String, required: true },
    region: { type: String, required: true, index: true },
    emoji: { type: String },
    emojiU: { type: String },
    capital: { type: String },
    currency: { type: String },
    currency_name: { type: String },
    currency_symbol: { type: String },
    longitude: { type: String },
    latitude: { type: String },
    flag: { type: String },
  },
  { timestamps: true }
);

// Text search index
CountrySchema.index({ name: "text" });

export const Country = mongoose.model<ICountry>("Country", CountrySchema);
