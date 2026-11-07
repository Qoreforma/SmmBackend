import { CacheService } from "./CacheService";
import { generateOTP } from "@/utils/cryptography";
import { CACHE_TTL } from "@/utils/constants";

export class OTPService {
  private otpLength: number = 6;
  private otpTTL: number = CACHE_TTL.TEN_MINUTES;
  private maxAttempts: number = 5;

  constructor(private cacheService: CacheService) {}

  async generateAndStore(
    userId: string,
    purpose:
      | "email_verification"
      | "phone_verification"
      | "2fa"
      | "password_reset"
      | "forgot_password"
      | "pin_change"
      | "wallet_transfer"
      | "finance_action",
  ): Promise<string> {
    const otp = generateOTP(this.otpLength);
    const key = this.getKey(userId, purpose);

    await this.cacheService.set(key, otp, this.otpTTL);
    // Fresh OTP means a fresh attempt budget too
    await this.cacheService.delete(this.getAttemptsKey(userId, purpose));

    return otp;
  }

  async verify(
    userId: string,
    purpose:
      | "email_verification"
      | "phone_verification"
      | "2fa"
      | "password_reset"
      | "forgot_password"
      | "pin_change"
      | "wallet_transfer"
      | "finance_action",
    otp: string,
  ): Promise<boolean> {
    const key = this.getKey(userId, purpose);
    const attemptsKey = this.getAttemptsKey(userId, purpose);

    const currentAttempts =
      (await this.cacheService.get<number>(attemptsKey)) || 0;
    if (currentAttempts >= this.maxAttempts) {
      // Too many wrong guesses — kill the OTP outright so a locked-out
      // attacker can't keep trying against it, and the real user has to
      // request a fresh one.
      await this.cacheService.delete(key);
      return false;
    }

    const storedOTP = await this.cacheService.get<string>(key);

    if (!storedOTP || storedOTP !== otp) {
      await this.cacheService.increment(attemptsKey, this.otpTTL);
      return false;
    }

    // Delete OTP and attempt counter after successful verification
    await this.cacheService.delete(key);
    await this.cacheService.delete(attemptsKey);
    return true;
  }

  async delete(
    userId: string,
    purpose:
      | "email_verification"
      | "phone_verification"
      | "2fa"
      | "password_reset"
      | "forgot_password"
      | "finance_action",
  ): Promise<void> {
    const key = this.getKey(userId, purpose);
    await this.cacheService.delete(key);
  }

  async exists(
    userId: string,
    purpose:
      | "email_verification"
      | "phone_verification"
      | "2fa"
      | "password_reset"
      | "forgot_password"
      | "finance_action",
  ): Promise<boolean> {
    const key = this.getKey(userId, purpose);
    return await this.cacheService.exists(key);
  }

  async markVerified(userId: string, purpose: string): Promise<void> {
    await this.cacheService.set(
      `otp_verified:${purpose}:${userId}`,
      true,
      CACHE_TTL.TEN_MINUTES, // short window to actually use it
    );
  }

  async consumeVerified(userId: string, purpose: string): Promise<boolean> {
    const key = `otp_verified:${purpose}:${userId}`;
    const wasVerified = await this.cacheService.exists(key);
    if (wasVerified) await this.cacheService.delete(key); // single-use
    return wasVerified;
  }

  private getKey(userId: string, purpose: string): string {
    return `otp:${purpose}:${userId}`;
  }

  private getAttemptsKey(userId: string, purpose: string): string {
    return `otp_attempts:${purpose}:${userId}`;
  }
}
