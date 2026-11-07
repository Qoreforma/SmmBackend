import mongoose, { Schema, Document } from "mongoose";

export interface IState extends Document {
  id: number;
  name: string;
  country_id: number;
  country_code: string;
  iso2: string;
  longitude: string;
  latitude: string;
}

const StateSchema = new Schema<IState>(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    country_id: { type: Number, required: true, index: true },
    country_code: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    iso2: { type: String, required: true, uppercase: true, index: true },
    longitude: { type: String },
    latitude: { type: String },
  },
  { timestamps: true }
);

// Compound and text indexes
StateSchema.index({ country_id: 1, name: 1 });
StateSchema.index({ name: "text" });

export const State = mongoose.model<IState>("State", StateSchema);
