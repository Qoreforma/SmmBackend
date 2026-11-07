import mongoose, { Schema, Document } from "mongoose";

export interface ICity extends Document {
  id: number;
  name: string;
  state_id: number;
  state_code: string;
  country_id: number;
  country_code: string;
  latitude: string;
  longitude: string;
}

const CitySchema = new Schema<ICity>(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    state_id: { type: Number, required: true, index: true },
    state_code: { type: String, required: true, uppercase: true, index: true },
    country_id: { type: Number, required: true, index: true },
    country_code: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    latitude: { type: String },
    longitude: { type: String },
  },
  { timestamps: true }
);

// Compound indexes for common queries
CitySchema.index({ state_id: 1, name: 1 });
CitySchema.index({ country_id: 1, name: 1 });
CitySchema.index({ name: "text" });

export const City = mongoose.model<ICity>("City", CitySchema);
