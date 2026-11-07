export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  apiBaseUrl: "https://api.telegram.org",
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
};
