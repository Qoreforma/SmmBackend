import mongoose, { Schema, Document } from "mongoose";

export interface IDailyStreakSetting extends Document {
  isEnabled: boolean;
  rewardAmount: number; // In NGN. If 0 or disabled, feature does nothing.
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DailyStreakSettingSchema = new Schema<IDailyStreakSetting>(
  {
    isEnabled: { type: Boolean, default: false },
    rewardAmount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "Daily login check-in streak reward" },
  },
  { timestamps: true }
);

export const DailyStreakSetting = mongoose.model<IDailyStreakSetting>(
  "DailyStreakSetting",
  DailyStreakSettingSchema
);
