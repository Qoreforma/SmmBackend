import nodemailer from "nodemailer";
import FormData from "form-data";
import axios from "axios";
import { Resend } from "resend";
import { emailConfig } from "@/config/email";
import logger from "@/logger";
import { emailColors } from "@/config/emailColors";
import { EmailBannerRepository } from "@/repositories/admin/EmailBannerRepository";
import { CacheService } from "@/services/core/CacheService";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private transporter: any;
  private mailgunClient: any;
  private resendClient: Resend | null = null;
  private emailBannerRepo: EmailBannerRepository;
  private cacheService: CacheService;
  private inMemoryCounters: { [dateKey: string]: { resend: number; brevo: number } } = {};
  private inMemoryExhausted: { [dateKey: string]: { resend?: boolean; brevo?: boolean } } = {};

  constructor() {
    this.emailBannerRepo = new EmailBannerRepository();
    this.cacheService = new CacheService();
    console.log("initializing email service with transport: ", emailConfig.transport);

    if (emailConfig.transport === "mailgun") {
      this.initializeResend();
    } else if (emailConfig.transport === "gmail") {
      this.initializeGmail();
    } else {
      // For "resend", "brevo", or default smart routing
      this.initializeResend();
      if (emailConfig.gmail?.auth?.user && emailConfig.gmail?.auth?.pass) {
        this.initializeGmail();
      }
    }
  }

  private initializeGmail() {
    logger.debug("Initializing Gmail transport...");
    this.transporter = nodemailer.createTransport({
      service: emailConfig.gmail.service || "gmail",
      auth: {
        user: emailConfig.gmail.auth.user || process.env.EMAIL_USER,
        pass: emailConfig.gmail.auth.pass || process.env.EMAIL_PASSWORD,
      },
    });
  }

  private initializeResend() {
    logger.debug("Initializing Resend transport...");
    this.resendClient = new Resend(
      emailConfig.resend?.apiKey || process.env.RESEND_API_KEY,
    );
  }

  public getTodayKey(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
  }

  async getDailyCount(dateKey: string, provider: "resend" | "brevo"): Promise<number> {
    try {
      const key = `email:counter:${provider}:${dateKey}`;
      const cached = await this.cacheService.get<number | string>(key);
      if (cached !== null && cached !== undefined) {
        return Number(cached);
      }
    } catch (error) {
      // Redis error, fallback to in-memory
    }
    return this.inMemoryCounters[dateKey]?.[provider] || 0;
  }

  private async incrementDailyCount(dateKey: string, provider: "resend" | "brevo"): Promise<number> {
    if (!this.inMemoryCounters[dateKey]) {
      this.inMemoryCounters[dateKey] = { resend: 0, brevo: 0 };
    }
    this.inMemoryCounters[dateKey][provider] = (this.inMemoryCounters[dateKey][provider] || 0) + 1;

    let redisCount = 0;
    try {
      const key = `email:counter:${provider}:${dateKey}`;
      // Expire in 48 hours (172800 seconds)
      redisCount = await this.cacheService.increment(key, 172800);
    } catch (error) {
      logger.warn(`Failed to increment email count in Redis for ${provider}:`, error);
    }

    return redisCount || this.inMemoryCounters[dateKey][provider];
  }

  async isProviderExhausted(dateKey: string, provider: "resend" | "brevo"): Promise<boolean> {
    if (this.inMemoryExhausted[dateKey]?.[provider]) {
      return true;
    }
    try {
      const key = `email:exhausted:${provider}:${dateKey}`;
      const exists = await this.cacheService.exists(key);
      if (exists) {
        if (!this.inMemoryExhausted[dateKey]) {
          this.inMemoryExhausted[dateKey] = {};
        }
        this.inMemoryExhausted[dateKey][provider] = true;
        return true;
      }
    } catch (error) {
      // Redis error, use in-memory
    }
    return false;
  }

  async markProviderExhausted(dateKey: string, provider: "resend" | "brevo"): Promise<void> {
    if (!this.inMemoryExhausted[dateKey]) {
      this.inMemoryExhausted[dateKey] = {};
    }
    this.inMemoryExhausted[dateKey][provider] = true;

    try {
      const key = `email:exhausted:${provider}:${dateKey}`;
      await this.cacheService.set(key, true, 172800);
    } catch (error) {
      logger.error(`Failed to mark ${provider} exhausted in Redis:`, error);
    }
  }

  async resetProviderQuota(dateKey: string, provider?: "resend" | "brevo"): Promise<void> {
    const providers: ("resend" | "brevo")[] = provider ? [provider] : ["resend", "brevo"];
    for (const p of providers) {
      if (this.inMemoryExhausted[dateKey]) {
        delete this.inMemoryExhausted[dateKey][p];
      }
      try {
        await this.cacheService.delete(`email:exhausted:${p}:${dateKey}`);
      } catch (error) {
        logger.error(`Failed to reset exhausted flag for ${p}:`, error);
      }
    }

    for (const key of Object.keys(this.inMemoryCounters)) {
      if (key !== dateKey) {
        delete this.inMemoryCounters[key];
      }
    }
    for (const key of Object.keys(this.inMemoryExhausted)) {
      if (key !== dateKey) {
        delete this.inMemoryExhausted[key];
      }
    }
  }

  async getEmailStats(): Promise<{
    date: string;
    resend: { count: number; limit: number; exhausted: boolean };
    brevo: { count: number; limit: number; exhausted: boolean };
    activeProvider: string;
    totalSentToday: number;
  }> {
    const dateKey = this.getTodayKey();
    const resendCount = await this.getDailyCount(dateKey, "resend");
    const brevoCount = await this.getDailyCount(dateKey, "brevo");
    const resendExhausted = await this.isProviderExhausted(dateKey, "resend");
    const brevoExhausted = await this.isProviderExhausted(dateKey, "brevo");

    const resendLimit = emailConfig.resend?.dailyLimit || 195;
    const brevoLimit = emailConfig.brevo?.dailyLimit || 300;

    let activeProvider = "resend";
    if (resendExhausted || resendCount >= resendLimit) {
      activeProvider = brevoExhausted || brevoCount >= brevoLimit ? "gmail/smtp" : "brevo";
    }

    return {
      date: dateKey,
      resend: {
        count: resendCount,
        limit: resendLimit,
        exhausted: resendExhausted || resendCount >= resendLimit,
      },
      brevo: {
        count: brevoCount,
        limit: brevoLimit,
        exhausted: brevoExhausted || brevoCount >= brevoLimit,
      },
      activeProvider,
      totalSentToday: resendCount + brevoCount,
    };
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      if (emailConfig.transport === "mailgun") {
        await this.sendViaMailgun(options);
        logger.info(`Email sent successfully to ${options.to} via Mailgun`);
        return;
      }

      if (emailConfig.transport === "gmail") {
        await this.sendViaSMTP(options);
        logger.info(`Email sent successfully to ${options.to} via Gmail SMTP`);
        return;
      }

      // Default, "resend", or "brevo": Smart multi-tier routing with failover
      await this.sendWithSmartRouting(options);
    } catch (error) {
      logger.error("Email sending failed:", error);
      throw error;
    }
  }

  private async sendWithSmartRouting(options: EmailOptions): Promise<void> {
    const today = this.getTodayKey();
    const resendDailyLimit = emailConfig.resend?.dailyLimit || 195;
    const brevoDailyLimit = emailConfig.brevo?.dailyLimit || 300;

    const resendCount = await this.getDailyCount(today, "resend");
    const isResendExhausted = await this.isProviderExhausted(today, "resend");

    // Tier 1: Resend (if transport is not explicitly 'brevo', under limit, and not exhausted)
    const canUseResend =
      emailConfig.transport !== "brevo" &&
      !isResendExhausted &&
      resendCount < resendDailyLimit &&
      (!!emailConfig.resend?.apiKey || !!process.env.RESEND_API_KEY);

    if (canUseResend) {
      try {
        await this.sendViaResend(options);
        const newCount = await this.incrementDailyCount(today, "resend");
        logger.info(
          `Email sent successfully to ${options.to} via Resend (Today: ${newCount}/${resendDailyLimit})`
        );

        if (newCount >= resendDailyLimit) {
          logger.info(
            `Resend daily threshold reached (${newCount}/${resendDailyLimit}). Subsequent emails will route to Brevo.`
          );
        }
        return;
      } catch (resendError: any) {
        logger.warn(
          `Resend failed for ${options.to}: ${resendError.message}. Failing over to Brevo...`
        );
        if (resendError.isQuota || resendCount >= resendDailyLimit - 1) {
          await this.markProviderExhausted(today, "resend");
          logger.warn(`Resend marked exhausted for ${today}.`);
        }
      }
    } else if (resendCount >= resendDailyLimit && !isResendExhausted) {
      logger.info(
        `Resend daily limit reached (${resendCount}/${resendDailyLimit}). Routing to Brevo.`
      );
    }

    // Tier 2: Brevo (if configured, under limit, and not exhausted)
    const brevoCount = await this.getDailyCount(today, "brevo");
    const isBrevoExhausted = await this.isProviderExhausted(today, "brevo");
    const hasBrevoKey = !!emailConfig.brevo?.apiKey || !!process.env.BREVO_API_KEY;

    const canUseBrevo = hasBrevoKey && !isBrevoExhausted && brevoCount < brevoDailyLimit;

    if (canUseBrevo) {
      try {
        await this.sendViaBrevo(options);
        const newCount = await this.incrementDailyCount(today, "brevo");
        logger.info(
          `Email sent successfully to ${options.to} via Brevo (Today: ${newCount}/${brevoDailyLimit})`
        );

        if (newCount >= brevoDailyLimit) {
          logger.warn(`Brevo daily limit reached (${newCount}/${brevoDailyLimit}).`);
        }
        return;
      } catch (brevoError: any) {
        logger.warn(`Brevo failed for ${options.to}: ${brevoError.message}.`);
        if (brevoError.isQuota || brevoCount >= brevoDailyLimit - 1) {
          await this.markProviderExhausted(today, "brevo");
          logger.warn(`Brevo marked exhausted for ${today}.`);
        }
      }
    }

    // Tier 3: Gmail SMTP Backup (if transporter is initialized)
    if (this.transporter && (process.env.EMAIL_USER || emailConfig.gmail?.auth?.user)) {
      try {
        logger.warn(
          `Primary email providers exhausted or failed. Falling back to Gmail SMTP for ${options.to}...`
        );
        await this.sendViaSMTP(options);
        logger.info(`Email sent successfully to ${options.to} via Gmail SMTP fallback`);
        return;
      } catch (smtpError: any) {
        logger.error(`Gmail SMTP fallback also failed for ${options.to}:`, smtpError);
      }
    }

    throw new Error(
      `All email delivery options failed or reached daily limits for ${options.to} (Resend: ${resendCount}/${resendDailyLimit}, Brevo: ${brevoCount}/${brevoDailyLimit})`
    );
  }

  private async sendViaMailgun(options: EmailOptions): Promise<void> {
    const messageData = {
      from: `${emailConfig.fromName} <${emailConfig.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || "",
    };

    await this.mailgunClient.messages.create(
      emailConfig.mailgun.domain,
      messageData,
    );
  }

  private async sendViaResend(options: EmailOptions): Promise<void> {
    if (!this.resendClient) {
      throw new Error("Resend client not initialized");
    }

    const fromAddress =
      process.env.RESEND_FROM_EMAIL ||
      emailConfig.resend?.from ||
      emailConfig.from ||
      `${emailConfig.fromName || "PayMint"} <support@paymint.com.ng>`;

    const { data, error } = await this.resendClient.emails.send({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      const errorMsg = error.message || JSON.stringify(error);
      const isQuota =
        error.name === "daily_quota_exceeded" ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("limit") ||
        (error as any).statusCode === 429;
      const err = new Error(`Resend send failed: ${errorMsg}`);
      (err as any).isQuota = isQuota;
      throw err;
    }
  }

  private async sendViaBrevo(options: EmailOptions): Promise<void> {
    const apiKey = emailConfig.brevo?.apiKey || process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new Error("Brevo API key not configured");
    }

    const senderEmail =
      emailConfig.brevo?.from ||
      process.env.BREVO_FROM_EMAIL ||
      emailConfig.from ||
      "support@paymint.com.ng";
    const senderName = emailConfig.fromName || "PayMint";

    const payload: any = {
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: options.to,
        },
      ],
      subject: options.subject,
      htmlContent: options.html,
    };

    if (options.text) {
      payload.textContent = options.text;
    }

    try {
      const response = await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        payload,
        {
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 15000,
        },
      );

      if (response.status !== 201 && response.status !== 200) {
        throw new Error(
          `Brevo API returned unexpected status ${response.status}: ${JSON.stringify(response.data)}`
        );
      }
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorMsg = errorData
        ? errorData.message || JSON.stringify(errorData)
        : error.message;
      const isQuota =
        error.response?.status === 402 ||
        error.response?.status === 429 ||
        errorData?.code === "exceed_daily_limit" ||
        (errorMsg && errorMsg.toLowerCase().includes("limit"));
      const err = new Error(`Brevo API error: ${errorMsg}`);
      (err as any).isQuota = isQuota;
      throw err;
    }
  }

  private async sendViaSMTP(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      this.initializeGmail();
    }
    await this.transporter.sendMail({
      from: `${emailConfig.fromName} <${emailConfig.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  /**
   * HELPER METHODS
   */

  
  private async getHeaderHtml(title: string, subtitle?: string, icon?: string, customGradient?: string): Promise<string> {
    const banners = await this.emailBannerRepo.getSettings();
    const headerBannerUrl = banners?.headerBannerUrl;

    if (headerBannerUrl) {
      return `
        <!--[if !mso]><!-->
        <div style="position:relative;">
          <img src="${headerBannerUrl}" style="width:100%; height:auto; display:block;" alt="">
          <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; width:100%;">
            ${icon ? `<span class="header-icon" style="color: white; margin-bottom: 8px;">${icon}</span>` : ''}
            <h1 style="margin: 0; padding: 0; font-size: 24px; color: white;">${title}</h1>
            ${subtitle ? `<p style="margin: 0; opacity: 0.95; color: white;">${subtitle}</p>` : ''}
          </div>
        </div>
        <!--<![endif]-->
        <!--[if mso]>
        <div>
          <img src="${headerBannerUrl}" style="width:100%; height:auto; display:block;" alt="">
          <div style="text-align: center; padding: 20px 0;">
            ${icon ? `<span class="header-icon" style="margin-bottom: 8px;">${icon}</span>` : ''}
            <h1 style="margin: 0; padding: 0; font-size: 24px; color: #${emailColors.primary};">${title}</h1>
            ${subtitle ? `<p style="margin: 0; opacity: 0.95; color: #${emailColors.textSecondary};">${subtitle}</p>` : ''}
          </div>
        </div>
        <![endif]-->
      `;
    }

    const gradient = customGradient || `linear-gradient(135deg, #${emailColors.primary} 0%, #${emailColors.secondary || emailColors.primary} 100%)`;
    
    return `
      <div class="header-section" style="background: ${gradient};">
        ${icon ? `<span class="header-icon">${icon}</span>` : ''}
        <h1>${title}</h1>
        ${subtitle ? `<p style="margin: 0; opacity: 0.95;">${subtitle}</p>` : ''}
      </div>
    `;
  }

  private getBaseStyles(): string {
    return `
      * { margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.6;
        color: #1a1a1a;
        background-color: #f8f9fa;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
      }
      .header-section {
        background: linear-gradient(135deg, #${emailColors.primary} 0%, #${emailColors.secondary || emailColors.primary} 100%);
        padding: 40px 30px;
        text-align: center;
        color: white;
      }
      .header-section h1 {
        font-size: 28px;
        font-weight: 700;
        margin-bottom: 8px;
        letter-spacing: -0.5px;
      }
      .header-icon {
        font-size: 48px;
        display: block;
        margin-bottom: 15px;
      }
      .content-section {
        padding: 40px 30px;
      }
      .text-primary { color: #1a1a1a; }
      .text-secondary { color: #666666; }
      .text-muted { color: #999999; }
      .divider {
        border: none;
        border-top: 1px solid #e8e8e8;
        margin: 30px 0;
      }
      .button {
        display: inline-block;
        padding: 14px 32px;
        background-color: #${emailColors.primary};
        color: white !important;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
        font-size: 16px;
        margin: 20px 0;
        transition: opacity 0.2s;
      }
      .button-secondary {
        background-color: #e8e8e8;
        color: #1a1a1a !important;
      }
      .button-outline {
        border: 2px solid #${emailColors.primary};
        background-color: transparent;
        color: #${emailColors.primary} !important;
      }
      .info-card {
        background-color: #f0f4f8;
        border-left: 4px solid #${emailColors.primary};
        padding: 20px;
        margin: 20px 0;
        border-radius: 4px;
      }
      .success-card {
        background-color: #f0fdf4;
        border-left: 4px solid #10b981;
        padding: 20px;
        margin: 20px 0;
        border-radius: 4px;
      }
      .warning-card {
        background-color: #fffbeb;
        border-left: 4px solid #f59e0b;
        padding: 20px;
        margin: 20px 0;
        border-radius: 4px;
      }
      .error-card {
        background-color: #fef2f2;
        border-left: 4px solid #ef4444;
        padding: 20px;
        margin: 20px 0;
        border-radius: 4px;
      }
      .detail-table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
      }
      .detail-table tr {
        border-bottom: 1px solid #e8e8e8;
      }
      .detail-table tr:last-child {
        border-bottom: none;
      }
      .detail-table td {
        padding: 14px 0;
        vertical-align: top;
      }
      .detail-label {
        font-weight: 600;
        color: #666666;
        width: 45%;
      }
      .detail-value {
        color: #1a1a1a;
        text-align: right;
      }
      .amount-highlight {
        font-size: 42px;
        font-weight: 700;
        color: #${emailColors.primary};
        text-align: center;
        margin: 30px 0;
        letter-spacing: -1px;
      }
      .badge {
        display: inline-block;
        padding: 6px 12px;
        background-color: #e8e8e8;
        color: #1a1a1a;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        margin-right: 8px;
      }
      .badge-success { background-color: #d1fae5; color: #065f46; }
      .badge-warning { background-color: #fef3c7; color: #92400e; }
      .badge-error { background-color: #fee2e2; color: #991b1b; }
      .footer-section {
        background-color: #f8f9fa;
        padding: 30px;
        text-align: center;
        border-top: 1px solid #e8e8e8;
      }
      .footer-links {
        margin-bottom: 20px;
      }
      .footer-links a {
        color: #666666;
        text-decoration: none;
        font-size: 13px;
        margin: 0 12px;
      }
      .footer-links a:hover {
        color: #${emailColors.primary};
      }
      .footer-text {
        font-size: 12px;
        color: #999999;
        margin: 8px 0;
      }
      p { margin: 16px 0; }
      h2 { font-size: 20px; font-weight: 700; margin: 24px 0 16px 0; }
      h3 { font-size: 16px; font-weight: 600; margin: 20px 0 12px 0; }
      .text-center { text-align: center; }
      .mt-20 { margin-top: 20px; }
      .mb-20 { margin-bottom: 20px; }
    `;
  }

  private getLogoAndBranding(): string {
    return `
      <div style="text-align: center; padding: 20px 30px; background-color: #ffffff;">
        <img src="${process.env.EMAIL_LOGO_URL}" alt="${process.env.APP_NAME}" style="height: 40px; width: auto;">
      </div>
    `;
  }

  private getFooter(): string {
    return `
    <div class="footer-section">
      <div class="footer-links">
        ${process.env.SOCIAL_INSTAGRAM ? `<a href="${process.env.SOCIAL_INSTAGRAM}">Instagram</a>` : ""}
        ${process.env.SOCIAL_LINKEDIN ? `<a href="${process.env.SOCIAL_LINKEDIN}">LinkedIn</a>` : ""}
        ${process.env.SOCIAL_TIKTOK ? `<a href="${process.env.SOCIAL_TIKTOK}">TikTok</a>` : ""}
        ${process.env.SOCIAL_FACEBOOK ? `<a href="${process.env.SOCIAL_FACEBOOK}">Facebook</a>` : ""}
        ${process.env.SOCIAL_TWITTER ? `<a href="${process.env.SOCIAL_TWITTER}">X</a>` : ""}
      </div>
      <p class="footer-text">Questions? <a href="mailto:support@qoreformasolutionlimited.com.ng" style="color: #${emailColors.primary}; text-decoration: none;">Get in touch</a></p>
      <p class="footer-text">&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
    </div>
  `;
  }

  /**
   * AUTHENTICATION EMAILS
   */

  async sendVerificationEmail(
    to: string,
    otp: string,
    name: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Verify Your Email`, `Complete your signup in seconds`, `✓`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Thanks for joining ${process.env.APP_NAME}! Use the code below to verify your email address. This code will expire in <strong>10 minutes</strong>.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your verification code</p>
              <p style="font-size: 48px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <div class="warning-card">
              <strong>Didn't request this?</strong><br>
              If you didn't sign up for ${process.env.APP_NAME}, you can safely ignore this email or contact us immediately.
            </div>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              This is an automated message. Please don't reply to this email.
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Your verification code: ${otp}`,
      html,
      text: `Hello ${name}, Your verification code is: ${otp}. This code expires in 10 minutes.`,
    });
  }

  async sendPhoneVerificationEmail(
    to: string,
    otp: string,
    name: string,
    phone?: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Verify Your Phone Number`, `Complete your phone verification`, `📱`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Use the code below to verify your phone number ${phone ? `<strong>${phone}</strong>` : ""} on ${process.env.APP_NAME || "PayMint"}. This code will expire in <strong>10 minutes</strong>.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your verification code</p>
              <p style="font-size: 48px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <div class="warning-card">
              <strong>Didn't request this?</strong><br>
              If you didn't request phone verification on ${process.env.APP_NAME || "PayMint"}, you can safely ignore this email or contact support.
            </div>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              This is an automated message. Please don't reply to this email.
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Your phone verification code: ${otp}`,
      html,
      text: `Hello ${name}, Your phone verification code is: ${otp}. This code expires in 10 minutes.`,
    });
  }

  async sendForgotPasswordEmail(
    to: string,
    otp: string,
    name: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Reset Your Password`, `Secure your account`, `🔒`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>We received a password reset request for your ${process.env.APP_NAME} account. Use the code below to create a new password.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your reset code</p>
              <p style="font-size: 48px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <p style="font-size: 13px; color: #666666; text-align: center;">This code expires in <strong>10 minutes</strong></p>

            <div class="warning-card">
              <strong>Didn't request this?</strong><br>
              Your account is safe. If you didn't request a password reset, ignore this email. Your password hasn't changed.
            </div>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              For security, never share this code with anyone.
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Reset your password",
      html,
      text: `Hello ${name}, Your password reset code is: ${otp}. It expires in 10 minutes.`,
    });
  }

  async sendPinChangeEmail(to: string, otp: string): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Confirm PIN Change`, `Protect your account`, `🔐`)}

          <div class="content-section">
            <p>We received a request to change your transaction PIN. Use the code below to confirm this action.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your confirmation code</p>
              <p style="font-size: 48px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <p style="font-size: 13px; color: #666666; text-align: center;">Expires in <strong>10 minutes</strong></p>

            <div class="warning-card">
              <strong>Suspicious activity?</strong><br>
              If you didn't request this, secure your account immediately by changing your password.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Confirm your PIN change",
      html,
      text: `Your PIN change confirmation code is: ${otp}. This expires in 10 minutes.`,
    });
  }

  async send2FAEmail(to: string, otp: string, name: string): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Two-Factor Authentication`, `Your login is being verified`, `🛡️`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>We detected a login attempt to your ${process.env.APP_NAME} account from a new device. Enter the code below to continue.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your authentication code</p>
              <p style="font-size: 48px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <p style="font-size: 13px; color: #666666; text-align: center;">Valid for <strong>10 minutes</strong></p>

            <div class="info-card">
              💡 If this wasn't you, your account may have been compromised. Change your password and contact support immediately.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Your 2FA code: ${otp}`,
      html,
      text: `Hi ${name}, Your 2FA code is: ${otp}. Expires in 10 minutes.`,
    });
  }

  async sendWelcomeEmail(
    to: string,
    name: string,
    referralOffer?: {
      referrerName?: string;
      percentage: number;
      cap: number;
    },
  ): Promise<void> {
    const appStoreUrl = process.env.APP_STORE_URL || "";
    const playStoreUrl = process.env.PLAY_STORE_URL || "";
    const dashboardUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/dashboard`
      : "";

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Welcome to ${process.env.APP_NAME}`, `You're all set to get started`, `🚀`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Your account is verified and ready to go. ${process.env.APP_NAME} makes boosting your social presence and digital services simple—order SMM engagement, buy game top-ups, proxies, virtual numbers, and fund your wallet in seconds.</p>

            ${referralOffer
        ? `
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-weight: 700; font-size: 16px; margin-bottom: 6px; color: #166534;">
                🎁 Special Welcome Gift: ${referralOffer.percentage}% Cashback!
              </p>
              <p style="margin: 0; font-size: 14px; color: #15803d; line-height: 1.5;">
                You joined using <strong>${referralOffer.referrerName || "an influencer"}'s</strong> invite! On your first transaction, you'll automatically receive <strong>${referralOffer.percentage}% Cashback (up to ₦${referralOffer.cap})</strong> deposited straight into your bonus wallet to spend on your next purchase.
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #16a34a;">
                ✓ No promo code required &bull; Automatically applied on your 1st purchase &bull; Instant wallet credit
              </p>
            </div>
            `
        : `
            <div class="success-card">
              ✓ Your account is verified<br>
              ✓ You're ready to make transactions<br>
              ✓ Download our app for on-the-go access
            </div>
            `
      }

            <h3>What you can do now:</h3>
            <ul style="list-style: none; padding: 0; margin: 16px 0;">
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">💰</span>
                <span>Fund your wallet and start transactions</span>
              </li>
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">🎁</span>
                <span>Enjoy exclusive perks and rewards</span>
              </li>
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">📱</span>
                <span>Download our app for seamless access</span>
              </li>
            </ul>

            <center>
              <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
            </center>

            ${appStoreUrl || playStoreUrl
        ? `
            <div style="margin-top: 30px; padding-top: 30px; border-top: 1px solid #e8e8e8; text-align: center;">
              <p style="color: #666666; font-weight: 600; margin-bottom: 15px;">Get our mobile app</p>
              <div>
                ${appStoreUrl ? `<a href="${appStoreUrl}" class="button button-secondary" style="margin: 0 8px;">📱 iOS</a>` : ""}
                ${playStoreUrl ? `<a href="${playStoreUrl}" class="button button-secondary" style="margin: 0 8px;">🤖 Android</a>` : ""}
              </div>
            </div>
            `
        : ""
      }
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: referralOffer
        ? `Welcome to ${process.env.APP_NAME}! Claim Your ${referralOffer.percentage}% Welcome Cashback`
        : `Welcome to ${process.env.APP_NAME} – Account Verified`,
      html,
      text: referralOffer
        ? `Hi ${name}, Welcome to ${process.env.APP_NAME}! You joined via ${referralOffer.referrerName || "an influencer"}'s invite. Complete your first purchase to automatically get ${referralOffer.percentage}% cashback (up to ₦${referralOffer.cap}) in your bonus wallet to spend on your next transaction.`
        : `Hi ${name}, Welcome to ${process.env.APP_NAME}! Your account is verified and ready. Fund your wallet to get started.`,
    });
  }

  /**
   * TRANSACTION EMAILS
   */

  async sendWalletFundedEmail(
    to: string,
    name: string,
    amount: number,
    balance: number,
    date: string,
    reference: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Wallet Funded`, `Your top-up was successful`, `✓`)}

          <div class="content-section">
            <p>Hi ${name},</p>

            <div class="amount-highlight">₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

            <div class="success-card">
              Successfully added to your wallet
            </div>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Date & Time</td>
                <td class="detail-value">${date}</td>
              </tr>
              <tr>
                <td class="detail-label">Reference</td>
                <td class="detail-value" style="font-family: monospace; font-size: 12px;">${reference}</td>
              </tr>
              <tr>
                <td class="detail-label">New Balance</td>
                <td class="detail-value" style="font-weight: 600; color: #${emailColors.primary};">₦${balance.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </table>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/wallet" class="button">View Wallet</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `₦${amount.toLocaleString()} added to your wallet`,
      html,
      text: `Hi ${name}, Your wallet top-up of ₦${amount.toLocaleString()} was successful. New balance: ₦${balance.toLocaleString()}`,
    });
  }

  async sendWalletWithdrawalEmail(
    to: string,
    name: string,
    amount: number,
    bank: string,
    accountNo: string,
    accountName: string,
    date: string,
    reference: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Withdrawal Processed`, `Funds on the way to your bank account`, `💸`)}

          <div class="content-section">
            <p>Hi ${name},</p>

            <div class="amount-highlight">₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

            <div class="success-card">
              Your withdrawal has been processed successfully and is being transferred to your bank account.
            </div>

            <h3>Withdrawal Details</h3>
            <table class="detail-table">
              <tr>
                <td class="detail-label">Bank</td>
                <td class="detail-value" style="font-weight: 600;">${bank}</td>
              </tr>
              <tr>
                <td class="detail-label">Account Name</td>
                <td class="detail-value">${accountName}</td>
              </tr>
              <tr>
                <td class="detail-label">Account Number</td>
                <td class="detail-value" style="font-family: monospace; font-size: 14px;">${accountNo}</td>
              </tr>
              <tr>
                <td class="detail-label">Date & Time</td>
                <td class="detail-value">${date}</td>
              </tr>
              <tr>
                <td class="detail-label">Reference</td>
                <td class="detail-value" style="font-family: monospace; font-size: 12px;">${reference}</td>
              </tr>
            </table>

            <div class="info-card">
              💡 Transfers typically arrive within minutes. If it takes longer, check your bank app or contact us.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/wallet" class="button">View Transaction</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Withdrawal confirmed: ₦${amount.toLocaleString()} → ${bank}`,
      html,
      text: `Hi ${name}, Your withdrawal of ₦${amount.toLocaleString()} to ${bank} has been processed. Reference: ${reference}`,
    });
  }

  async sendTransactionReversalEmail(
    to: string,
    name: string,
    txn: any,
    totalDeduction: number,
    reason: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Transaction Reversed`, `Funds have been refunded to your wallet`, `↩️`)}

          <div class="content-section">
            <p>Hi ${name},</p>

            <div class="amount-highlight">₦${totalDeduction.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

            <div class="success-card">
              Your transaction has been reversed and the funds are now available in your wallet.
            </div>

            <div class="info-card">
              <strong>Reason:</strong> ${reason}
            </div>

            <h3>Reversal Details</h3>
            <table class="detail-table">
              <tr>
                <td class="detail-label">Transaction Ref</td>
                <td class="detail-value" style="font-family: monospace; font-size: 12px;">${txn.reference}</td>
              </tr>
              <tr>
                <td class="detail-label">Original Amount</td>
                <td class="detail-value">₦${txn.amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ${txn.meta?.chargeInfo?.serviceCharge
        ? `
              <tr>
                <td class="detail-label">Service Charge Refunded</td>
                <td class="detail-value">₦${txn.meta.chargeInfo.serviceCharge.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              `
        : ""
      }
              <tr style="font-weight: 600; border-top: 2px solid #e8e8e8;">
                <td class="detail-label">Total Refunded</td>
                <td class="detail-value" style="color: #10b981;">₦${totalDeduction.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </table>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/wallet" class="button">View Wallet</a>
            </center>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              Questions about this reversal? <a href="mailto:support@${process.env.APP_NAME?.toLowerCase().replace(/\s+/g, "")}.com" style="color: #${emailColors.primary}; text-decoration: none;">Contact support</a>
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Transaction reversed: ₦${totalDeduction.toLocaleString()} refunded`,
      html,
      text: `Hi ${name}, Your transaction has been reversed. Amount refunded: ₦${totalDeduction.toLocaleString()}. Reason: ${reason}`,
    });
  }

  async sendFirstTransactionEmail(to: string, name: string): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`First Transaction!`, `You're now part of our community`, `🎉`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Congratulations on your first transaction! You're now officially part of the ${process.env.APP_NAME} family. This is just the beginning of your seamless financial journey.</p>

            <div class="success-card">
              ✓ First transaction complete<br>
              ✓ Explore more features<br>
              ✓ Unlock rewards
            </div>

            <h3>What's next?</h3>
            <ul style="list-style: none; padding: 0; margin: 16px 0;">
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">⭐</span>
                <span>Refer a friend and earn rewards</span>
              </li>
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">🏆</span>
                <span>Complete your KYC for higher limits</span>
              </li>
              <li style="padding: 12px 0; display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">🔐</span>
                <span>Enable 2FA for added security</span>
              </li>
            </ul>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button">Continue Exploring</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Welcome to the ${process.env.APP_NAME} community! 🎉`,
      html,
      text: `Hi ${name}, Congratulations on your first transaction! Welcome to ${process.env.APP_NAME}.`,
    });
  }

  async sendTransactionCelebrationEmail(
    to: string,
    name: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Transaction Successful`, `Thank you for choosing ${process.env.APP_NAME}`, `🎉`)}

          <div class="content-section">
            <p>Hello ${name},</p>
            <p>Nice one! Your transaction just went through successfully.</p>

            <div class="success-card">
              ✓ Transaction completed seamlessly
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button">View Dashboard</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Transaction successful ✅",
      html,
      text: `Hello ${name}, your transaction just went through successfully. Thanks for using ${process.env.APP_NAME}.`,
    });
  }

  /**
   * ACCOUNT & PROFILE EMAILS
   */

  async sendKycApprovedEmail(to: string, name: string): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`KYC Verified`, `Full access unlocked`, `✅`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Great news! Your identity verification is complete. You now have full access to higher transaction limits and exclusive features on ${process.env.APP_NAME}.</p>

            <div class="success-card">
              ✓ Identity verified<br>
              ✓ Higher limits unlocked<br>
              ✓ Full feature access enabled
            </div>

            <h3>Your new limits:</h3>
            <div style="background-color: #f0f4f8; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 8px 0;"><strong>Daily Limit:</strong> ₦500,000</p>
              <p style="margin: 8px 0;"><strong>Monthly Limit:</strong> Unlimited</p>
              <p style="margin: 8px 0;"><strong>Wallet Balance:</strong> ₦5,000,000</p>
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button">Start Transacting</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Your KYC verification is complete`,
      html,
      text: `Hi ${name}, Your KYC verification is complete! You now have full access to ${process.env.APP_NAME}.`,
    });
  }

  async sendKycRejectedEmail(
    to: string,
    name: string,
    reason: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`KYC Review`, `We need more information`, `📋`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Thank you for submitting your identity verification. We couldn't verify your information this time, but the good news is you can try again.</p>

            <div class="warning-card">
              <strong>Reason:</strong> ${reason}
            </div>

            <h3>What to do next:</h3>
            <ol style="padding-left: 20px; margin: 16px 0;">
              <li style="padding: 8px 0;">Review the reason above carefully</li>
              <li style="padding: 8px 0;">Ensure all documents are clear and readable</li>
              <li style="padding: 8px 0;">Make sure your details match your documents exactly</li>
              <li style="padding: 8px 0;">Submit again with the corrected information</li>
            </ol>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/kyc" class="button">Try Again</a>
            </center>

            <div class="info-card">
              Need help? Our support team is here to guide you through the process.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `KYC verification needs your attention`,
      html,
      text: `Hi ${name}, Your KYC submission needs adjustment. Reason: ${reason}. Please resubmit with the correct information.`,
    });
  }

  async sendProfileIncompleteEmail(to: string, name: string): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Complete Your Profile`, `Just a few steps to go`, `👤`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Your account is almost ready! Complete your profile to unlock full access to ${process.env.APP_NAME} and enjoy all our features without restrictions.</p>

            <div class="info-card">
              <strong>Missing:</strong><br>
              • Phone number verification<br>
              • Email confirmation<br>
              • Identity verification (KYC)
            </div>

            <div style="margin: 30px 0; padding: 20px; background-color: #f0fdf4; border-radius: 8px; border-left: 4px solid #10b981;">
              <strong>⏰ Estimated time:</strong> Just 3 minutes to complete everything
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/profile" class="button">Complete Profile</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Finish setting up your profile",
      html,
      text: `Hi ${name}, Complete your profile to unlock full access. Visit your profile to add missing information.`,
    });
  }

  /**
   * SECURITY EMAILS
   */

  async sendLoginSecurityEmail(
    to: string,
    name: string,
    meta?: {
      ipAddress?: string;
      device?: string;
      location?: string;
      channel?: string;
    },
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`New Login Detected`, `We noticed a new sign-in`, `🔐`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>We detected a new login to your ${process.env.APP_NAME} account. If this was you, no action is needed. If not, secure your account immediately.</p>

            <h3>Login Details</h3>
            <table class="detail-table">
              ${meta?.device ? `<tr><td class="detail-label">Device</td><td class="detail-value">${meta.device}</td></tr>` : ""}
              ${meta?.location ? `<tr><td class="detail-label">Location</td><td class="detail-value">${meta.location}</td></tr>` : ""}
              ${meta?.ipAddress ? `<tr><td class="detail-label">IP Address</td><td class="detail-value" style="font-family: monospace; font-size: 13px;">${meta.ipAddress}</td></tr>` : ""}
              ${meta?.channel ? `<tr><td class="detail-label">Channel</td><td class="detail-value">${meta.channel}</td></tr>` : ""}
              <tr><td class="detail-label">Time</td><td class="detail-value">${new Date().toLocaleString("en-NG")}</td></tr>
            </table>

            <div class="warning-card">
              <strong>Wasn't you?</strong> Change your password immediately and enable 2FA if you haven't already.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/settings/security" class="button">Secure Your Account</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "New login to your account",
      html,
      text: `Hi ${name}, A new login was detected on your account. Time: ${new Date().toLocaleString()}.`,
    });
  }

  async sendPasswordResetConfirmation(
    to: string,
    name: string,
    newPassword: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Password Changed`, `Your new temporary password`, `✓`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Your password has been successfully reset. Use the temporary password below to log in, then change it to something only you know.</p>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your temporary password</p>
              <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 0; color: #${emailColors.primary}; font-family: monospace;">${newPassword}</p>
            </div>

            <div class="warning-card">
              <strong>⚠️ Important:</strong> Change this password immediately after logging in for your security.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/login" class="button">Log In Now</a>
            </center>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              For security, never share this password with anyone.
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Your password has been reset",
      html,
      text: `Hi ${name}, Your password has been reset. Temporary password: ${newPassword}. Change it immediately after logging in.`,
    });
  }

  /**
   * ENGAGEMENT EMAILS
   */

  async sendNoTransactionReminderEmail(
    to: string,
    name: string,
    daysSinceSignup: number,
  ): Promise<void> {
    const isDay3 = daysSinceSignup <= 3;
    const discountPercentage = 5;
    const maxCap = 200;

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`${isDay3 ? "Your Welcome Offer is Ready!" : "We Miss You"}`, `${isDay3 ? "Get 5% cashback on your first transaction" : "Come back and claim your 5% bonus"}`, `${isDay3 ? "🎁" : "👋"}`)}

          <div class="content-section">
            <p>Hi ${name},</p>

            ${isDay3
        ? `
              <p>Ready to experience ${process.env.APP_NAME}? We've unlocked an exclusive 24-hour welcome offer just for you!</p>
              
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-weight: 700; font-size: 16px; margin-bottom: 6px; color: #166534;">
                  🎁 Exclusive 24-Hour Offer: ${discountPercentage}% Cashback
                </p>
                <p style="margin: 0; font-size: 14px; color: #15803d; line-height: 1.5;">
                  Get <strong>${discountPercentage}% Cashback (up to ₦${maxCap})</strong> credited directly to your bonus wallet on your first transaction today!
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #16a34a;">
                  ✓ No promo code required &bull; Automatically applied &bull; Instant credit
                </p>
              </div>

              <p>Get started with social media growth, game top-ups, proxies, or virtual numbers with zero hidden charges.</p>

              <center>
                <a href="${process.env.FRONTEND_URL || ""}/wallet" class="button">Fund Wallet & Transact</a>
              </center>
            `
        : `
              <p>It's been ${daysSinceSignup} days since you joined ${process.env.APP_NAME}. We'd love to see you transacting!</p>

              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-weight: 700; font-size: 16px; margin-bottom: 6px; color: #166534;">
                  🎁 Special 24-Hour Return Offer: ${discountPercentage}% Cashback
                </p>
                <p style="margin: 0; font-size: 14px; color: #15803d; line-height: 1.5;">
                  Complete any transaction within the next 24 hours to automatically get <strong>${discountPercentage}% Cashback (up to ₦${maxCap})</strong> deposited to your bonus wallet.
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #16a34a;">
                  ✓ No promo code required &bull; Valid for 24 hours &bull; Instant wallet credit
                </p>
              </div>

              <center>
                <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button">Claim Your 5% Offer</a>
              </center>
            `
      }
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: isDay3
        ? `Your Welcome Offer is Waiting on ${process.env.APP_NAME} – 5% Bonus Inside!`
        : `We Miss You on ${process.env.APP_NAME} – 5% Return Bonus Inside!`,
      html,
      text: isDay3
        ? `Hi ${name}, Your welcome offer is active! Complete any transaction today and get 5% cashback (up to ₦${maxCap}) credited directly to your bonus wallet.`
        : `Hi ${name}, It's been ${daysSinceSignup} days. Come back to ${process.env.APP_NAME} and claim your 5% return bonus today!`,
    });
  }

  async sendInactivityWinBackEmail(
    to: string,
    name: string,
    daysInactive: number,
  ): Promise<void> {
    const discountPercentage = daysInactive >= 30 ? 10 : 5;
    const maxCap = 200;

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`We Miss You, ${name}`, `Here is an exclusive ${discountPercentage}% return offer`, `💙`)}

          <div class="content-section">
            <p>It's been ${daysInactive} days since your last transaction. ${process.env.APP_NAME} is still here, ready to serve you.</p>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-weight: 700; font-size: 16px; margin-bottom: 6px; color: #166534;">
                🎁 Special 24-Hour Return Offer: ${discountPercentage}% OFF!
              </p>
              <p style="margin: 0; font-size: 14px; color: #15803d; line-height: 1.5;">
                Get <strong>${discountPercentage}% Cashback (up to ₦${maxCap})</strong> automatically credited to your bonus wallet on your first transaction today!
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #16a34a;">
                ✓ No promo code required &bull; Valid for the next 24 hours &bull; Instant wallet credit
              </p>
            </div>

            <div style="background-color: #f0f4f8; padding: 18px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-weight: 600; margin-bottom: 12px;">What you might have missed:</p>
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="padding: 6px 0;">✓ Instant SMM, Game Top-Up & Proxy Delivery</li>
                <li style="padding: 6px 0;">✓ Zero Hidden Fees & Best Exchange Rates</li>
                <li style="padding: 6px 0;">✓ Automated Cashback on Every Purchase</li>
              </ul>
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button">Claim Your ${discountPercentage}% Offer</a>
            </center>

            <p style="text-align: center; color: #999999; font-size: 13px; margin-top: 30px;">
              We're here to help. <a href="mailto:support@${process.env.APP_NAME?.toLowerCase().replace(/\s+/g, "")}.com" style="color: #${emailColors.primary}; text-decoration: none;">Reach out anytime</a>
            </p>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: daysInactive >= 30
        ? `We Miss You! Claim 10% OFF on ${process.env.APP_NAME} – 24-Hour Offer Inside`
        : `Come Back to ${process.env.APP_NAME} – 5% Return Bonus Waiting!`,
      html,
      text: `Hi ${name}, It's been ${daysInactive} days. We miss you! Claim ${discountPercentage}% cashback (up to ₦${maxCap}) on your next transaction within 24 hours on ${process.env.APP_NAME}.`,
    });
  }

  /**
   * CONTACT & NOTIFICATIONS
   */

  async sendContactEmail(to: string, data: any): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`New Contact Message`, `From your contact form`, `📧`)}

          <div class="content-section">
            <table class="detail-table">
              <tr>
                <td class="detail-label">Name</td>
                <td class="detail-value">${data.name}</td>
              </tr>
              <tr>
                <td class="detail-label">Email</td>
                <td class="detail-value">${data.email}</td>
              </tr>
              <tr>
                <td class="detail-label">Subject</td>
                <td class="detail-value">${data.subject || "General Inquiry"}</td>
              </tr>
            </table>

            <h3>Message</h3>
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word;">
              ${data.message}
            </div>

            <center>
              <a href="mailto:${data.email}" class="button">Reply</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Contact Form: ${data.subject || "New Message"} – From ${data.name}`,
      html,
      text: `New contact form submission from ${data.name} (${data.email}).\n\nMessage:\n${data.message}`,
    });
  }

  async sendMonthlyStatementEmail(
    to: string,
    name: string,
    month: string,
    year: string,
    summaryData: { credits: number; debits: number; balance: number },
    statementLink?: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Monthly Statement`, `${month} ${year}`, `📊`)}

          <div class="content-section">
            <p>Hi ${name},</p>
            <p>Here's your account summary for ${month} ${year}:</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Total Credits</td>
                <td class="detail-value" style="color: #10b981; font-weight: 600;">₦${summaryData.credits.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td class="detail-label">Total Debits</td>
                <td class="detail-value" style="color: #ef4444; font-weight: 600;">₦${summaryData.debits.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr style="font-weight: 700; border-top: 2px solid #e8e8e8;">
                <td class="detail-label">Closing Balance</td>
                <td class="detail-value" style="color: #${emailColors.primary};">₦${summaryData.balance.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </table>

            <div class="info-card">
              View detailed transaction history in your dashboard
            </div>

            <center>
              ${statementLink ? `<a href="${statementLink}" class="button">Download Full Statement</a>` : ""}
              <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="button ${statementLink ? "button-secondary" : ""}">View Dashboard</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Your ${month} ${year} statement is ready`,
      html,
      text: `Hi ${name}, Your ${month} ${year} statement. Credits: ₦${summaryData.credits.toLocaleString()}, Debits: ₦${summaryData.debits.toLocaleString()}, Balance: ₦${summaryData.balance.toLocaleString()}`,
    });
  }

  /**
   * ADMIN EMAILS
   */

  async sendAdminWelcomeEmail(
    to: string,
    name: string,
    adminLevel: string,
    temporaryPassword: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Welcome to Admin`, `Your account is ready`, `🔑`)}

          <div class="content-section">
            <p>Hello ${name},</p>
            <p>Your admin account has been successfully created. Use the credentials below to access the ${process.env.APP_NAME} admin dashboard.</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Admin Level</td>
                <td class="detail-value" style="font-weight: 600;">
                  <span class="badge">${adminLevel}</span>
                </td>
              </tr>
              <tr>
                <td class="detail-label">Email</td>
                <td class="detail-value">${to}</td>
              </tr>
              <tr>
                <td class="detail-label">Temporary Password</td>
                <td class="detail-value" style="font-family: monospace; font-size: 14px; font-weight: 600;">${temporaryPassword}</td>
              </tr>
            </table>

            <div class="warning-card">
              <strong>⚠️ Action Required:</strong> Change your password immediately after your first login.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/admin/login" class="button">Go to Admin Dashboard</a>
            </center>

            <h3>Next Steps:</h3>
            <ol style="padding-left: 20px; margin: 16px 0;">
              <li style="padding: 8px 0;">Log in with your email and temporary password</li>
              <li style="padding: 8px 0;">Change your password to something secure</li>
              <li style="padding: 8px 0;">Enable two-factor authentication</li>
              <li style="padding: 8px 0;">Review your permissions and access levels</li>
            </ol>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Admin Account Created – ${process.env.APP_NAME}`,
      html,
      text: `Hello ${name}, Your admin account has been created. Email: ${to}, Admin Level: ${adminLevel}, Temporary Password: ${temporaryPassword}. Change it after first login.`,
    });
  }

  async sendAdminLoginNotificationEmail(
    to: string,
    adminName: string,
    details: { ip: string; device: string; timestamp: Date },
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Admin Login Detected`, `Security notification`, `🔐`)}

          <div class="content-section">
            <p>Hello ${adminName},</p>
            <p>A successful login was registered to your admin account. Please review the details:</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">IP Address</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${details.ip}</td>
              </tr>
              <tr>
                <td class="detail-label">Device</td>
                <td class="detail-value" style="font-size: 12px; word-break: break-all;">${details.device}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${details.timestamp.toLocaleString()}</td>
              </tr>
            </table>

            <div class="info-card">
              If this login is suspicious, change your password and contact your security team immediately.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "Admin login notification",
      html,
      text: `Hello ${adminName}, Admin login detected. IP: ${details.ip}, Device: ${details.device}, Time: ${details.timestamp.toLocaleString()}.`,
    });
  }

  async sendAdminLoginCopyEmail(
    to: string,
    superAdminName: string,
    adminEmail: string,
    adminName: string,
    details: { ip: string; device: string; timestamp: Date },
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Admin Access Audit`, `Logged for compliance`, `📋`)}

          <div class="content-section">
            <p>Hello ${superAdminName},</p>
            <p>An admin account login has been recorded. This notification is sent for audit purposes.</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Admin Name</td>
                <td class="detail-value">${adminName}</td>
              </tr>
              <tr>
                <td class="detail-label">Admin Email</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${adminEmail}</td>
              </tr>
              <tr>
                <td class="detail-label">IP Address</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${details.ip}</td>
              </tr>
              <tr>
                <td class="detail-label">Device</td>
                <td class="detail-value" style="font-size: 12px;">${details.device}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${details.timestamp.toLocaleString()}</td>
              </tr>
            </table>

            <div class="success-card">
              This login is being logged for audit and compliance purposes. No action needed unless unauthorized activity is suspected.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `[Audit] Admin login: ${adminEmail}`,
      html,
      text: `Admin login audit: ${adminName} (${adminEmail}), IP: ${details.ip}, Time: ${details.timestamp.toLocaleString()}`,
    });
  }

  async sendAdminFailedLoginAlertEmail(
    to: string,
    superAdminName: string,
    attemptedEmail: string,
    details: { ip: string; device: string; timestamp: Date },
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Failed Login Attempt`, `Security alert`, `⚠️`, `linear-gradient(135deg, #ef4444 0%, #dc2626 100%)`)}

          <div class="content-section">
            <p>Hello ${superAdminName},</p>
            <p>A failed login attempt was detected on the admin portal. Please review the details:</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Attempted Email</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${attemptedEmail}</td>
              </tr>
              <tr>
                <td class="detail-label">IP Address</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${details.ip}</td>
              </tr>
              <tr>
                <td class="detail-label">Device</td>
                <td class="detail-value" style="font-size: 12px;">${details.device}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${details.timestamp.toLocaleString()}</td>
              </tr>
            </table>

            <div class="error-card">
              <strong>Action Required:</strong> If you notice repeated failed attempts from this IP, consider blocking it immediately.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `[SECURITY] Failed admin login: ${attemptedEmail}`,
      html,
      text: `Failed admin login attempt: ${attemptedEmail}, IP: ${details.ip}, Time: ${details.timestamp.toLocaleString()}`,
    });
  }

  async sendSystemNotificationToAdmin(
    to: string,
    subject: string,
    data: Record<string, any>,
    message: string,
  ): Promise<void> {
    const severity = data?.severity || "info";

    const severityConfig: Record<
      string,
      { icon: string; bgColor: string; borderColor: string }
    > = {
      info: { icon: "ℹ️", bgColor: "#f0f4f8", borderColor: "#3b82f6" },
      warning: { icon: "⚠️", bgColor: "#fffbeb", borderColor: "#f59e0b" },
      error: { icon: "❌", bgColor: "#fef2f2", borderColor: "#ef4444" },
      critical: { icon: "🚨", bgColor: "#fef2f2", borderColor: "#dc2626" },
    };

    const config = severityConfig[severity] || severityConfig.info;

    const renderDataRows = (obj: Record<string, any>) =>
      Object.entries(obj || {})
        .filter(([key]) => key !== "severity")
        .map(([key, value]) => {
          let renderedValue: string;

          if (Array.isArray(value)) {
            renderedValue = value
              .map(
                (item) =>
                  `<div>• ${typeof item === "object" ? JSON.stringify(item) : item}</div>`,
              )
              .join("");
          } else if (typeof value === "object" && value !== null) {
            renderedValue = `<pre style="margin:0; font-size: 12px; background-color: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(value, null, 2)}</pre>`;
          } else {
            renderedValue = String(value);
          }

          return `
          <div style="padding: 12px 0; border-bottom: 1px solid #e8e8e8;">
            <strong style="color: #666666;">${key}</strong><br>
            ${renderedValue}
          </div>
        `;
        })
        .join("");

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`System Notification`, `${severity.toUpperCase()}`, `${config.icon}`, `linear-gradient(135deg, #${emailColors.primary} 0%, #${emailColors.secondary} 100%)`)}

          <div class="content-section">
            <div style="background-color: ${config.bgColor}; border-left: 4px solid ${config.borderColor}; padding: 16px; border-radius: 4px; margin: 20px 0;">
              <strong style="text-transform: uppercase; font-size: 12px; color: ${config.borderColor};">${severity}</strong><br>
              <span style="font-size: 12px; color: #666666;">Time: ${new Date().toLocaleString()}</span>
            </div>

            <p>${message}</p>

            ${Object.keys(data || {}).length > 0
        ? `
              <h3>Details</h3>
              <div>
                ${renderDataRows(data)}
              </div>
            `
        : ""
      }

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/admin/dashboard" class="button mt-20">Go to Dashboard</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject,
      html,
      text: `[${severity.toUpperCase()}] ${message}\n\nDetails:\n${JSON.stringify(data, null, 2)}`,
    });
  }

  async sendAdminWalletActionOTP(
    to: string,
    otp: string,
    adminName: string,
    actionType: "credit" | "debit",
    amount: number,
    userEmail: string,
  ): Promise<void> {
    const actionLabel = actionType === "credit" ? "Credit" : "Debit";

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Authorize Wallet ${actionLabel}`, `Confirm this action`, `🔐`)}

          <div class="content-section">
            <p>Hello ${adminName},</p>
            <p>You're about to perform a wallet ${actionLabel} action. Use the code below to authorize this transaction.</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Action</td>
                <td class="detail-value" style="font-weight: 600;">Wallet ${actionLabel}</td>
              </tr>
              <tr>
                <td class="detail-label">Amount</td>
                <td class="detail-value" style="font-weight: 600; color: #${emailColors.primary};">₦${amount.toLocaleString()}</td>
              </tr>
              <tr>
                <td class="detail-label">User Email</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${userEmail}</td>
              </tr>
            </table>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your authorization code</p>
              <p style="font-size: 42px; font-weight: 700; letter-spacing: 6px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <p style="font-size: 13px; color: #666666; text-align: center;">This code expires in <strong>10 minutes</strong></p>

            <div class="warning-card">
              Do not share this code with anyone. Only use it if you initiated this action.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Authorize wallet ${actionLabel} – ₦${amount.toLocaleString()}`,
      html,
      text: `Hello ${adminName}, Authorize wallet ${actionLabel} of ₦${amount.toLocaleString()} for user ${userEmail}. Code: ${otp}. Expires in 10 minutes.`,
    });
  }

  async sendAdminFinanceActionOTP(
    to: string,
    otp: string,
    adminName: string,
    actionType: "Approve" | "Reject",
    transactionType:
      | "Manual Deposit"
      | "Manual Withdrawal"
      | "Transaction Status Update",
    amount: string,
    reference: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`${actionType} Transaction`, `Confirm authorization`, `✅`)}

          <div class="content-section">
            <p>Hello ${adminName},</p>
            <p>Please authorize the following action:</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Action</td>
                <td class="detail-value" style="font-weight: 600;">${actionType}</td>
              </tr>
              <tr>
                <td class="detail-label">Type</td>
                <td class="detail-value">${transactionType}</td>
              </tr>
              <tr>
                <td class="detail-label">Amount</td>
                <td class="detail-value" style="font-weight: 600; color: #${emailColors.primary};">${amount}</td>
              </tr>
              <tr>
                <td class="detail-label">Reference</td>
                <td class="detail-value" style="font-family: monospace; font-size: 12px;">${reference}</td>
              </tr>
            </table>

            <div style="background-color: #f0f4f8; padding: 24px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <p style="font-size: 12px; color: #666666; margin: 0 0 12px 0;">Your authorization code</p>
              <p style="font-size: 42px; font-weight: 700; letter-spacing: 6px; margin: 0; color: #${emailColors.primary};">${otp}</p>
            </div>

            <p style="font-size: 13px; color: #666666; text-align: center;">Valid for <strong>10 minutes</strong></p>

            <div class="warning-card">
              Only proceed if you initiated this action and the details are correct.
            </div>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: `Authorize ${actionType}: ${transactionType}`,
      html,
      text: `Hello ${adminName}, Authorize ${actionType} for ${transactionType}. Amount: ${amount}, Reference: ${reference}. Code: ${otp}. Expires in 10 minutes.`,
    });
  }

  async sendDeviceApprovalAlertEmail(
    to: string,
    requestingEmail: string,
    ip: string,
    deviceId: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Device Approval Needed`, `New device access request`, `📱`, `linear-gradient(135deg, #f59e0b 0%, #d97706 100%)`)}

          <div class="content-section">
            <p>A new unrecognized device is attempting to access the admin panel.</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Admin Email</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${requestingEmail}</td>
              </tr>
              <tr>
                <td class="detail-label">IP Address</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${ip}</td>
              </tr>
              <tr>
                <td class="detail-label">Device ID</td>
                <td class="detail-value" style="font-family: monospace; font-size: 12px;">${deviceId}</td>
              </tr>
            </table>

            <div class="warning-card">
              If this isn't you, deny this request immediately and secure your account.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/admin/security" class="button">Review Request</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "New device access request – Action needed",
      html,
      text: `A new device from IP ${ip} is requesting admin panel access for ${requestingEmail}. Device ID: ${deviceId}. Please approve or deny in your admin settings.`,
    });
  }

  async sendEmergencySelfApprovalAlertEmail(
    to: string,
    adminEmail: string,
    ip: string,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Emergency Self-Approval`, `Security event logged`, `🚨`, `linear-gradient(135deg, #dc2626 0%, #991b1b 100%)`)}

          <div class="content-section">
            <p>An admin has triggered an emergency fallback self-approval mechanism.</p>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Admin Email</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${adminEmail}</td>
              </tr>
              <tr>
                <td class="detail-label">IP Address</td>
                <td class="detail-value" style="font-family: monospace; font-size: 13px;">${ip}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${new Date().toLocaleString()}</td>
              </tr>
            </table>

            <div class="error-card">
              <strong>This is a security event.</strong> It occurs when no other authorized approvers are available. This has been logged for audit purposes.
            </div>

            <center>
              <a href="${process.env.FRONTEND_URL || ""}/admin/audit-logs" class="button">View Audit Log</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to,
      subject: "[SECURITY] Emergency self-approval triggered",
      html,
      text: `Emergency self-approval triggered by ${adminEmail} from IP ${ip} at ${new Date().toLocaleString()}.`,
    });
  }

  async sendAdminTransactionReversedAlert(params: {
    to: string;
    adminName: string;
    transactionReference: string;
    reversalReference?: string;
    amount: number;
    transactionType: string;
    customerName: string;
    customerEmail?: string;
    provider?: string;
    reversalReason: string;
    providerResponse?: any;
    reversedBy?: string;
    reversedAt?: Date;
  }): Promise<void> {
    const formattedProviderResponse = params.providerResponse
      ? typeof params.providerResponse === "object"
        ? JSON.stringify(params.providerResponse, null, 2)
        : String(params.providerResponse)
      : null;

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Transaction Reversed`, `Super Admin Alert`, `🔄`, `linear-gradient(135deg, #ea580c 0%, #c2410c 100%)`)}

          <div class="content-section">
            <p>Hello ${params.adminName},</p>
            <p>A transaction on the platform has been <strong>reversed</strong> and the associated funds have been refunded to the customer wallet.</p>

            <div class="amount-highlight" style="color: #ea580c; margin: 20px 0;">
              ₦${(params.amount || 0).toLocaleString()}
            </div>

            <div class="warning-card" style="margin: 15px 0;">
              <strong style="color: #9a3412;">Reversal Reason:</strong>
              <div style="margin-top: 5px; color: #7c2d12; font-weight: 500;">
                ${params.reversalReason || "No explicit reason specified"}
              </div>
            </div>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Transaction Reference</td>
                <td class="detail-value" style="font-family: monospace; font-weight: 600;">${params.transactionReference}</td>
              </tr>
              ${
                params.reversalReference
                  ? `<tr>
                <td class="detail-label">Reversal Reference</td>
                <td class="detail-value" style="font-family: monospace; font-weight: 600;">${params.reversalReference}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td class="detail-label">Service / Type</td>
                <td class="detail-value"><span class="badge badge-warning">${params.transactionType}</span></td>
              </tr>
              <tr>
                <td class="detail-label">Customer</td>
                <td class="detail-value"><strong>${params.customerName}</strong> ${params.customerEmail ? `(${params.customerEmail})` : ""}</td>
              </tr>
              <tr>
                <td class="detail-label">Provider</td>
                <td class="detail-value">${params.provider || "N/A"}</td>
              </tr>
              <tr>
                <td class="detail-label">Triggered By</td>
                <td class="detail-value">${params.reversedBy || "System"}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${(params.reversedAt || new Date()).toLocaleString()}</td>
              </tr>
            </table>

            ${
              formattedProviderResponse
                ? `<div class="info-card" style="margin-top: 20px;">
                <strong>Provider Response / Metadata:</strong>
                <pre style="margin-top: 8px; font-size: 11px; max-height: 160px; overflow-y: auto; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: pre-wrap; word-break: break-all;">${formattedProviderResponse}</pre>
              </div>`
                : ""
            }

            <center style="margin-top: 25px;">
              <a href="${process.env.FRONTEND_URL || ""}/transactions/all?search=${encodeURIComponent(params.transactionReference)}" class="button" style="background-color: #ea580c;">View in Admin Panel</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to: params.to,
      subject: `🚨 [REVERSAL] Transaction ${params.transactionReference} Reversed (₦${(params.amount || 0).toLocaleString()})`,
      html,
      text: `Super Admin Alert: Transaction ${params.transactionReference} of ₦${(params.amount || 0).toLocaleString()} (${params.transactionType}) was reversed. Reason: ${params.reversalReason}. Customer: ${params.customerName}. Provider: ${params.provider || "N/A"}.`,
    });
  }

  async sendAdminTransactionFailedAlert(params: {
    to: string;
    adminName: string;
    transactionReference: string;
    amount: number;
    transactionType: string;
    customerName: string;
    customerEmail?: string;
    provider?: string;
    failureReason: string;
    providerResponse?: any;
    failedAt?: Date;
  }): Promise<void> {
    const formattedProviderResponse = params.providerResponse
      ? typeof params.providerResponse === "object"
        ? JSON.stringify(params.providerResponse, null, 2)
        : String(params.providerResponse)
      : null;

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>${this.getBaseStyles()}</style>
      </head>
      <body>
        <div class="container">
          ${this.getLogoAndBranding()}
          ${await this.getHeaderHtml(`Transaction Failed`, `Super Admin Alert`, `❌`, `linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)`)}

          <div class="content-section">
            <p>Hello ${params.adminName},</p>
            <p>A transaction on the platform has <strong>failed</strong>.</p>

            <div class="amount-highlight" style="color: #ef4444; margin: 20px 0;">
              ₦${(params.amount || 0).toLocaleString()}
            </div>

            <div class="error-card" style="margin: 15px 0;">
              <strong style="color: #991b1b;">Failure Reason:</strong>
              <div style="margin-top: 5px; color: #7f1d1d; font-weight: 500;">
                ${params.failureReason || "No explicit reason specified"}
              </div>
            </div>

            <table class="detail-table">
              <tr>
                <td class="detail-label">Transaction Reference</td>
                <td class="detail-value" style="font-family: monospace; font-weight: 600;">${params.transactionReference}</td>
              </tr>
              <tr>
                <td class="detail-label">Service / Type</td>
                <td class="detail-value"><span class="badge badge-error">${params.transactionType}</span></td>
              </tr>
              <tr>
                <td class="detail-label">Customer</td>
                <td class="detail-value"><strong>${params.customerName}</strong> ${params.customerEmail ? `(${params.customerEmail})` : ""}</td>
              </tr>
              <tr>
                <td class="detail-label">Provider</td>
                <td class="detail-value">${params.provider || "N/A"}</td>
              </tr>
              <tr>
                <td class="detail-label">Time</td>
                <td class="detail-value">${(params.failedAt || new Date()).toLocaleString()}</td>
              </tr>
            </table>

            ${
              formattedProviderResponse
                ? `<div class="info-card" style="margin-top: 20px;">
                <strong>Provider Response / Metadata:</strong>
                <pre style="margin-top: 8px; font-size: 11px; max-height: 160px; overflow-y: auto; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: pre-wrap; word-break: break-all;">${formattedProviderResponse}</pre>
              </div>`
                : ""
            }

            <center style="margin-top: 25px;">
              <a href="${process.env.FRONTEND_URL || ""}/transactions/all?search=${encodeURIComponent(params.transactionReference)}" class="button" style="background-color: #ef4444;">View in Admin Panel</a>
            </center>
          </div>

          ${this.getFooter()}
        </div>
      </body>
    </html>`;

    await this.sendEmail({
      to: params.to,
      subject: `❌ [FAILED] Transaction ${params.transactionReference} Failed (₦${(params.amount || 0).toLocaleString()})`,
      html,
      text: `Super Admin Alert: Transaction ${params.transactionReference} of ₦${(params.amount || 0).toLocaleString()} (${params.transactionType}) failed. Reason: ${params.failureReason}. Customer: ${params.customerName}. Provider: ${params.provider || "N/A"}.`,
    });
  }
}
