import mongoose, { Schema, Document } from "mongoose";

export interface ITelegramBotSetting extends Document {
  isEnabled: boolean;
  botUsername?: string;
  miniAppUrl?: string;
  welcomeMessage: string;
  helpMessage: string;
  enableOtpNotifications: boolean;
  maintenanceMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TelegramBotSettingSchema = new Schema<ITelegramBotSetting>(
  {
    isEnabled: { type: Boolean, default: true },
    botUsername: { type: String, default: "PaymintBot" },
    miniAppUrl: { type: String, default: "" },
    welcomeMessage: {
      type: String,
      default:
        "👋 Welcome to *Paymint*!\\n\\nYour #1 hub for Social Media Marketing, Virtual Phone Numbers, and Instant SMS OTP verifications.\\n\\nTap the button below to launch the app directly inside Telegram!",
    },
    helpMessage: {
      type: String,
      default:
        "💡 *Paymint Bot Commands*:\\n\\n• /start — Launch or link your Paymint account\\n• /balance — Check your active wallet balance\\n• /help — Show support and command list\\n\\nNeed support? Contact @paymint_support",
    },
    enableOtpNotifications: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const TelegramBotSetting = mongoose.model<ITelegramBotSetting>(
  "TelegramBotSetting",
  TelegramBotSettingSchema
);
