export const emailConfig = {
  transport: process.env.EMAIL_TRANSPORT || "gmail", // 'mailgun' or 'smtp' or 'gmail'
  from: process.env.EMAIL_FROM || "",
  fromName: process.env.EMAIL_FROM_NAME || process.env.APP_NAME || "",
  supportContactEmail: process.env.SUPER_ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER || "",


  // Mailgun config
  mailgun: {
    apiKey: process.env.MAILGUN_API_KEY || "",
    domain: process.env.MAILGUN_DOMAIN || "",
    host: process.env.MAILGUN_HOST || "api.mailgun.net",
  },

  gmail: {
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER || "",
      pass: process.env.EMAIL_PASSWORD || "",
    },
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || "support@paymint.com.ng",
    dailyLimit: Number(process.env.RESEND_DAILY_LIMIT) || 195,
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    from: process.env.BREVO_FROM_EMAIL || process.env.EMAIL_FROM || "support@paymint.com.ng",
    dailyLimit: Number(process.env.BREVO_DAILY_LIMIT) || 300,
  },
};
