export const whatsappConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  appSecret: process.env.WHATSAPP_APP_SECRET || "",
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  apiVersion: process.env.WHATSAPP_API_VERSION || "v20.0",
};
