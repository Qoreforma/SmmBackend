import axios from "axios";
import { smsConfig } from "@/config/sms";
import logger from "@/logger";

interface SMSOptions {
  to: string;
  message: string;
}

interface TermiiResponse {
  message_id: string;
  message: string;
  balance: number;
  code: string;
  user: string;
}

export class SMSService {
  private baseUrl: string;
  private apiKey: string;
  private senderId: string;

  constructor() {
    this.baseUrl = smsConfig.termii.baseUrl;
    this.apiKey = smsConfig.termii.apiKey;
    this.senderId = smsConfig.termii.senderId;

    if (!this.baseUrl || !this.apiKey) {
      logger.error("Termii configuration is incomplete", {
        hasBaseUrl: !!this.baseUrl,
        hasApiKey: !!this.apiKey,
      });
    }
  }

  async sendSMS(options: SMSOptions): Promise<void> {
    try {
      const url = `${this.baseUrl}/sms/send`;

      const payload: any = {
        to: options.to,
        sms: options.message,
        type: "plain",
        channel: "dnd",
        api_key: this.apiKey,
        from: this.senderId || "N-Alert",
      };

      logger.info(`Sending SMS to ${options.to}`, {
        endpoint: url,
        messageLength: options.message.length,
      });

      const response = await axios.post<TermiiResponse>(url, payload, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      logger.info(`SMS sent successfully to ${options.to}`, {
        messageId: response.data.message_id,
        balance: response.data.balance,
        code: response.data.code,
      });

      if (response.data.code !== "ok") {
        throw new Error(
          `Termii error: ${response.data.code} - ${response.data.message}`
        );
      }

      if (response.data.balance < 100) {
        logger.warn(`Low Termii balance: ${response.data.balance} NGN`);
      }
    } catch (error: any) {
      const errorData = error.response?.data || error.message;

      logger.error("SMS sending failed", {
        error: errorData,
        phone: options.to,
        status: error.response?.status,
      });

      throw new Error(`SMS sending failed: ${JSON.stringify(errorData)}`);
    }
  }

  async sendPhoneVerificationOTP(to: string, otp: string): Promise<void> {
    const message = `Your ${process.env.APP_NAME} authentication code is ${otp}. Valid for 10 minutes, one-time use only.`;

    logger.info(`Sending verification OTP to ${to}`);
    await this.sendSMS({ to, message });
  }

  async send2FAOTP(to: string, otp: string): Promise<void> {
    const message = `Your ${process.env.APP_NAME} 2FA code is: ${otp}.Valid for 10 minutes, one-time use only.`;

    logger.info(`Sending 2FA OTP to ${to}`);
    await this.sendSMS({ to, message });
  }

  async testConfiguration(): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/get-balance?api_key=${this.apiKey}`
      );

      logger.info("Termii config test successful", {
        balance: response.data.balance,
      });

      return true;
    } catch (error: any) {
      logger.error("Termii config test failed", {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  async checkMessageStatus(messageId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/sms/inbox?api_key=${this.apiKey}&message_id=${messageId}`
      );

      logger.info("Message status retrieved", { messageId });
      return response.data;
    } catch (error: any) {
      logger.error("Failed to check message status", {
        messageId,
        error: error.response?.data || error.message,
      });
      return null;
    }
  }
}
