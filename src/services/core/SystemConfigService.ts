// src/services/core/SystemConfigService.ts
import { User, IUser } from "@/models/core/User";
import { Wallet, IWallet } from "@/models/wallet/Wallet";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";

export class SystemConfigService {
  private cacheService: CacheService;
  private systemUser: IUser | null = null;
  private systemWallet: IWallet | null = null;

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  // Get the system user (marked with isSystemUser: true)
  // This is cached to avoid repeated DB lookups

  async getSystemUser(): Promise<IUser> {
    if (this.systemUser) {
      return this.systemUser;
    }

    // Check Redis cache
    const cached = await this.cacheService.get<IUser>(CACHE_KEYS.SYSTEM_USER);
    if (cached) {
      this.systemUser = cached;
      return cached;
    }

    // Fetch from database
    const systemUser = await User.findOne({
      isSystemUser: true,
      status: "active",
    }).lean<IUser>();

    if (!systemUser) {
      logger.error("CRITICAL: No system user found in database!");
      logger.error(
        "Please run the system user seeder: npm run seed:system-user"
      );
      throw new Error(
        "System configuration error: system user not found. Run the seeder script."
      );
    }

    await this.cacheService.set(
      CACHE_KEYS.SYSTEM_USER,
      systemUser,
      CACHE_TTL.ONE_HOUR
    );

    this.systemUser = systemUser;
    logger.info(`System user loaded: ${systemUser.email}`);
    return systemUser;
  }

  // Get the system user ID only (lighter operation)

  async getSystemUserId(): Promise<Types.ObjectId> {
    const systemUser = await this.getSystemUser();
    return systemUser.id;
  }

  // Get the system wallet (main wallet for system user)
  // This is cached to avoid repeated DB lookups

  async getSystemWallet(): Promise<IWallet> {
    // Check memory cache first
    if (this.systemWallet) {
      return this.systemWallet;
    }

    // Check Redis cache
    const cached = await this.cacheService.get<IWallet>(
      CACHE_KEYS.SYSTEM_WALLET
    );
    if (cached) {
      this.systemWallet = cached;
      return cached;
    }

    // Get system user ID
    const systemUserId = await this.getSystemUserId();

    // Fetch wallet from database
    const wallet = await Wallet.findOne({
      userId: systemUserId,
      type: "main",
    }).lean<IWallet>();

    if (!wallet) {
      logger.error(
        "CRITICAL: System user wallet not found! User ID:",
        systemUserId.toString()
      );
      logger.error(
        "Please run the system user seeder: npm run seed:system-user"
      );
      throw new Error(
        "System configuration error: system wallet not found. Run the seeder script."
      );
    }

    // Cache for 1 hour
    await this.cacheService.set(
      CACHE_KEYS.SYSTEM_WALLET,
      wallet,
      CACHE_TTL.ONE_HOUR
    );

    this.systemWallet = wallet;
    logger.info(`System wallet loaded: ${wallet.id.toString()}`);
    return wallet;
  }

  // Get system wallet ID only

  async getSystemWalletId(): Promise<Types.ObjectId> {
    const wallet = await this.getSystemWallet();
    return wallet.id;
  }

  // Get system wallet balance

  async getSystemWalletBalance(): Promise<number> {
    const wallet = await this.getSystemWallet();
    return wallet.balance;
  }

  // Get system wallet details (all balances)

  async getSystemWalletDetails(): Promise<{
    balance: number;
    bonusBalance: number;
    commissionBalance: number;
  }> {
    const wallet = await this.getSystemWallet();
    return {
      balance: wallet.balance,
      bonusBalance: wallet.bonusBalance,
      commissionBalance: wallet.commissionBalance,
    };
  }

  // Clear system user cache (call this if system user changes)

  async clearSystemUserCache(): Promise<void> {
    this.systemUser = null;
    await this.cacheService.delete(CACHE_KEYS.SYSTEM_USER);
    logger.info("System user cache cleared");
  }

  // Clear system wallet cache (call this if wallet changes)

  async clearSystemWalletCache(): Promise<void> {
    this.systemWallet = null;
    await this.cacheService.delete(CACHE_KEYS.SYSTEM_WALLET);
    logger.info("System wallet cache cleared");
  }

  // Clear all system configuration caches

  async clearAllSystemCaches(): Promise<void> {
    this.systemUser = null;
    this.systemWallet = null;
    await this.cacheService.delete(CACHE_KEYS.SYSTEM_USER);
    await this.cacheService.delete(CACHE_KEYS.SYSTEM_WALLET);
    logger.info("All system configuration caches cleared");
  }

  // Validate system is properly configured
  // Call this on application startup

  async validateSystemConfig(): Promise<boolean> {
    try {
      logger.info("🔍 Validating system configuration...");

      // Check if system user exists
      const systemUser = await this.getSystemUser();
      logger.info(` System user found: ${systemUser.email}`);

      // Check if system wallet exists
      const wallet = await this.getSystemWallet();
      logger.info(` System wallet found: ${wallet.id.toString()}`);

      // Log system info
      logger.info("📋 System Configuration:");
      logger.info(`   User ID: ${systemUser.id.toString()}`);
      logger.info(`   User Email: ${systemUser.email}`);
      logger.info(`   Wallet ID: ${wallet.id.toString()}`);
      logger.info(`   Wallet Balance: ${wallet.balance}`);
      logger.info(`   Bonus Balance: ${wallet.bonusBalance}`);
      logger.info(`   Commission Balance: ${wallet.commissionBalance}`);

      logger.info(" System configuration validated successfully");
      return true;
    } catch (error) {
      logger.error(" System configuration validation failed:", error);
      return false;
    }
  }
}

export const systemConfigService = new SystemConfigService(new CacheService());
