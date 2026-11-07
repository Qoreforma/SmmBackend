import axios from "axios";
import crypto from "crypto";
import { telegramConfig } from "@/config/telegram";
import { User, IUser } from "@/models/core/User";
import { Wallet } from "@/models/wallet/Wallet";
import { TelegramBotSetting, ITelegramBotSetting } from "@/models/system/TelegramBotSetting";
import { ChannelIdentityRepository } from "@/repositories/client/ChannelIdentityRepository";
import { WalletService } from "@/services/client/wallet/WalletService";
import { CacheService } from "@/services/core/CacheService";
import { generateAccessToken, generateRefreshToken } from "@/config/jwt";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

export interface TelegramUserData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export class TelegramService {
  private botToken: string;
  private apiBaseUrl: string;

  constructor(
    private channelIdentityRepository: ChannelIdentityRepository,
    private walletService: WalletService,
    private cacheService: CacheService,
  ) {
    this.botToken = telegramConfig.botToken;
    this.apiBaseUrl = telegramConfig.apiBaseUrl;
  }

  // ---------------------------------------------------------------------------
  // Admin-Configurable Settings Cache & Fetch
  // ---------------------------------------------------------------------------
  async getSettings(): Promise<ITelegramBotSetting> {
    const cacheKey = "telegram:bot_settings";
    const cached = await this.cacheService.get<ITelegramBotSetting>(cacheKey);
    if (cached) return cached;

    let settings = await TelegramBotSetting.findOne();
    if (!settings) {
      settings = await TelegramBotSetting.create({
        isEnabled: true,
        welcomeMessage:
          "👋 Welcome to *Paymint*!\n\nYour #1 hub for Social Media Marketing, Virtual Phone Numbers, and Instant SMS OTP verifications.\n\nTap the button below to launch the app directly inside Telegram!",
        helpMessage:
          "💡 *Paymint Bot Commands*:\n\n• /start — Launch or link your Paymint account\n• /balance — Check your active wallet balance\n• /help — Show support and command list\n\nNeed support? Contact @paymint_support",
        miniAppUrl: process.env.FRONTEND_URL || "https://app.paymint.com",
      });
    }

    await this.cacheService.set(cacheKey, settings, 600); // 10 minutes cache
    return settings;
  }

  async updateSettings(updates: Partial<ITelegramBotSetting>): Promise<ITelegramBotSetting> {
    let settings = await TelegramBotSetting.findOne();
    if (!settings) {
      settings = new TelegramBotSetting(updates);
    } else {
      Object.assign(settings, updates);
    }
    await settings.save();
    await this.cacheService.delete("telegram:bot_settings");
    return settings;
  }

  // ---------------------------------------------------------------------------
  // 1. Cryptographic Validation for Telegram Mini-App initData
  // ---------------------------------------------------------------------------
  public validateInitData(initDataRaw: string): { user: TelegramUserData; startParam?: string } {
    if (!this.botToken) {
      throw new AppError(
        "Telegram bot token is not configured on the server",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.CONFIGURATION_ERROR,
      );
    }

    const params = new URLSearchParams(initDataRaw);
    const hash = params.get("hash");

    if (!hash) {
      throw new AppError(
        "Invalid Telegram initData: missing hash parameter",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    params.delete("hash");

    // Sort parameters alphabetically
    const sortedEntries: string[] = [];
    params.sort();
    params.forEach((value, key) => {
      sortedEntries.push(`${key}=${value}`);
    });
    const dataCheckString = sortedEntries.join("\n");

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(this.botToken)
      .digest();

    // calculated_hash = HMAC_SHA256(secret_key, dataCheckString)
    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const hashBuffer = Buffer.from(hash, "hex");
    const calculatedBuffer = Buffer.from(calculatedHash, "hex");

    if (
      hashBuffer.length !== calculatedBuffer.length ||
      !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)
    ) {
      throw new AppError(
        "Telegram cryptographic signature verification failed",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }

    const userRaw = params.get("user");
    if (!userRaw) {
      throw new AppError(
        "Invalid Telegram initData: missing user object",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    try {
      const user = JSON.parse(userRaw) as TelegramUserData;
      const startParam = params.get("start_param") || undefined;
      return { user, startParam };
    } catch {
      throw new AppError(
        "Invalid Telegram user JSON structure",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Telegram Mini-App Authentication & Seamless Login
  // ---------------------------------------------------------------------------
  async authenticateMiniApp(initDataRaw: string): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  }> {
    return SentryHelper.trackCriticalOperation("telegram_mini_app_auth", async () => {
      const settings = await this.getSettings();
      if (!settings.isEnabled || settings.maintenanceMode) {
        throw new AppError(
          "Telegram bot services are currently unavailable or in maintenance mode",
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      const { user: tgUser, startParam } = this.validateInitData(initDataRaw);
      const tgIdStr = String(tgUser.id);

      // 1. Check if Telegram account is already linked
      let channelIdentity = await this.channelIdentityRepository.findByChannelAndExternalId(
        "telegram",
        tgIdStr,
      );

      let targetUser: IUser | null = null;
      let isNewUser = false;

      // 2. If deep link token is supplied, attempt linking
      if (startParam && startParam.startsWith("TL-")) {
        const linkedUserId = await this.cacheService.get<string>(`telegram:link_token:${startParam}`);
        if (linkedUserId) {
          targetUser = await User.findById(linkedUserId);
          if (targetUser) {
            channelIdentity = await this.channelIdentityRepository.link(
              "telegram",
              tgIdStr,
              targetUser._id.toString(),
            );
            await this.cacheService.delete(`telegram:link_token:${startParam}`);
            logger.info(`Linked Telegram account ${tgIdStr} to existing user ${targetUser.email}`);
          }
        }
      }

      // 3. If still not linked, check existing link
      if (!targetUser && channelIdentity) {
        targetUser = await User.findById(channelIdentity.userId);
      }

      // 4. If no user linked, seamlessly provision a Telegram user
      if (!targetUser) {
        const dummyEmail = `tg_${tgIdStr}@telegram.paymint.com`;
        targetUser = await User.findOne({ email: dummyEmail });

        if (!targetUser) {
          const randomPass = crypto.randomBytes(16).toString("hex");
          targetUser = await User.create({
            firstname: tgUser.first_name || "Telegram",
            lastname: tgUser.last_name || "User",
            email: dummyEmail,
            password: randomPass,
            username: tgUser.username || `tg_${tgIdStr}`,
            status: "active",
            authType: "social",
            userType: "regular",
            emailVerifiedAt: new Date(),
          });

          // Create wallet
          try {
            await Wallet.create({
              userId: targetUser._id,
              type: "main",
              balance: 0,
              bonusBalance: 0,
              commissionBalance: 0,
            });
          } catch (walletErr) {
            logger.error(`Error initializing wallet for Telegram user ${targetUser._id}`, walletErr);
          }

          isNewUser = true;
          logger.info(`Provisioned new Telegram user ${targetUser._id} for TG ID ${tgIdStr}`);
        }

        // Link identity
        await this.channelIdentityRepository.link(
          "telegram",
          tgIdStr,
          targetUser._id.toString(),
        );
      }

      if (targetUser.status !== "active") {
        throw new AppError(
          `Your account is currently ${targetUser.status}. Please contact support.`,
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.ACCOUNT_SUSPENDED,
        );
      }

      const accessToken = generateAccessToken({
        id: targetUser._id.toString(),
        email: targetUser.email,
        role: "user",
      });

      const refreshToken = generateRefreshToken({
        id: targetUser._id.toString(),
        email: targetUser.email,
        role: "user",
      });

      return {
        user: {
          id: targetUser._id,
          firstname: targetUser.firstname,
          lastname: targetUser.lastname,
          email: targetUser.email,
          username: targetUser.username,
          avatar: targetUser.avatar,
          userType: targetUser.userType,
        },
        accessToken,
        refreshToken,
        isNewUser,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Account Link Token Generation (From Web/Mobile app to Telegram)
  // ---------------------------------------------------------------------------
  async generateAccountLinkToken(userId: string): Promise<{ linkToken: string; deepLink: string }> {
    const settings = await this.getSettings();
    const token = `TL-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    await this.cacheService.set(`telegram:link_token:${token}`, userId, 900); // 15 mins

    const botUsername = settings.botUsername || "PaymintBot";
    const deepLink = `https://t.me/${botUsername}?start=${token}`;

    return { linkToken: token, deepLink };
  }

  // ---------------------------------------------------------------------------
  // 4. Bot Webhook Handler (Commands & Inline Buttons)
  // ---------------------------------------------------------------------------
  async handleWebhookUpdate(update: any): Promise<void> {
    if (!this.botToken) return;

    try {
      const settings = await this.getSettings();
      if (!settings.isEnabled || settings.maintenanceMode) return;

      const message = update.message || update.edited_message;
      const callbackQuery = update.callback_query;

      if (message) {
        await this.handleMessage(message, settings);
      } else if (callbackQuery) {
        await this.handleCallbackQuery(callbackQuery, settings);
      }
    } catch (err: any) {
      logger.error("Error processing Telegram webhook update", err);
    }
  }

  private async handleMessage(message: any, settings: ITelegramBotSetting): Promise<void> {
    const chatId = message.chat?.id;
    const fromId = message.from?.id;
    const text = (message.text || "").trim();

    if (!chatId || !fromId || !text) return;

    const miniAppUrl = settings.miniAppUrl || process.env.FRONTEND_URL || "https://app.paymint.com";

    // Handle /start or /start <token>
    if (text.startsWith("/start")) {
      const parts = text.split(" ");
      const linkToken = parts[1]?.trim();

      if (linkToken && linkToken.startsWith("TL-")) {
        const userId = await this.cacheService.get<string>(`telegram:link_token:${linkToken}`);
        if (userId) {
          const user = await User.findById(userId);
          if (user) {
            await this.channelIdentityRepository.link("telegram", String(fromId), userId);
            await this.cacheService.delete(`telegram:link_token:${linkToken}`);

            await this.sendMessage(chatId, `🎉 *Account Connected Successfully!*\n\nWelcome *${user.firstname}*, your Paymint account is now linked to this Telegram chat.`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🚀 Open Paymint Mini-App", web_app: { url: miniAppUrl } }],
                  [{ text: "💰 Check Balance", callback_data: "check_balance" }],
                ],
              },
            });
            return;
          }
        }
      }

      // Default /start welcome
      await this.sendMessage(chatId, settings.welcomeMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Launch Paymint App", web_app: { url: miniAppUrl } }],
            [
              { text: "💰 Balance", callback_data: "check_balance" },
              { text: "💡 Help", callback_data: "show_help" },
            ],
          ],
        },
      });
      return;
    }

    // Handle /balance
    if (text === "/balance") {
      await this.respondWithBalance(chatId, fromId, miniAppUrl);
      return;
    }

    // Handle /help
    if (text === "/help") {
      await this.sendMessage(chatId, settings.helpMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Launch Paymint App", web_app: { url: miniAppUrl } }],
          ],
        },
      });
      return;
    }
  }

  private async handleCallbackQuery(callbackQuery: any, settings: ITelegramBotSetting): Promise<void> {
    const chatId = callbackQuery.message?.chat?.id;
    const fromId = callbackQuery.from?.id;
    const data = callbackQuery.data;
    const miniAppUrl = settings.miniAppUrl || process.env.FRONTEND_URL || "https://app.paymint.com";

    if (!chatId || !fromId) return;

    if (data === "check_balance") {
      await this.respondWithBalance(chatId, fromId, miniAppUrl);
    } else if (data === "show_help") {
      await this.sendMessage(chatId, settings.helpMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Launch Paymint App", web_app: { url: miniAppUrl } }],
          ],
        },
      });
    }
  }

  private async respondWithBalance(chatId: number | string, fromId: number | string, miniAppUrl: string): Promise<void> {
    const identity = await this.channelIdentityRepository.findByChannelAndExternalId("telegram", String(fromId));

    if (!identity) {
      await this.sendMessage(
        chatId,
        "⚠️ *Account Not Linked*\n\nYour Telegram profile is not yet linked to a Paymint account. Tap below to launch the Mini-App and start trading!",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Launch & Connect Paymint", web_app: { url: miniAppUrl } }],
            ],
          },
        },
      );
      return;
    }

    try {
      const wallet = await this.walletService.getWallet(identity.userId.toString());
      const mainBalance = wallet ? wallet.balance.toLocaleString("en-NG", { minimumFractionDigits: 2 }) : "0.00";
      const bonusBalance = wallet ? wallet.bonusBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 }) : "0.00";

      await this.sendMessage(
        chatId,
        `💳 *Your Paymint Wallet Balance:*\n\n• *Main Balance*: ₦${mainBalance}\n• *Bonus Balance*: ₦${bonusBalance}\n\nNeed to fund your wallet or rent numbers?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Open App & Fund Wallet", web_app: { url: miniAppUrl } }],
            ],
          },
        },
      );
    } catch (err: any) {
      logger.error("Failed to query wallet balance for Telegram user", err);
      await this.sendMessage(chatId, "⚠️ Could not retrieve balance at this time. Please try via the app.");
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Send Notification (e.g. OTP Arrived or Order Completed)
  // ---------------------------------------------------------------------------
  async sendOtpNotification(telegramChatId: string | number, otpCode: string, serviceName: string): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.enableOtpNotifications) return;

      const text = `🔔 *SMS Verification Received!*\n\nService: *${serviceName}*\nCode: \`${otpCode}\`\n\n_(Tap code to copy)_`;
      await this.sendMessage(telegramChatId, text);
    } catch (err) {
      logger.warn(`Could not send Telegram OTP notification to ${telegramChatId}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Direct HTTP Dispatch to Telegram Bot API
  // ---------------------------------------------------------------------------
  async sendMessage(chatId: string | number, text: string, options?: any): Promise<any> {
    if (!this.botToken) return;

    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/bot${this.botToken}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          ...options,
        },
        { timeout: 10000 },
      );
      return response.data;
    } catch (err: any) {
      logger.error(`Telegram sendMessage failed for chat ${chatId}:`, {
        error: err.response?.data || err.message,
      });
    }
  }
}
