import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { generateReference, normalizeProviderName } from "@/utils/helpers";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_CATEGORIES,
  CACHE_KEYS,
} from "@/utils/constants";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { Types } from "mongoose";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { CacheService } from "../../core/CacheService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { PeriodFilter, resolveDateRange } from "@/utils/dateRange";
import SocketService from "@/services/core/SocketService";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { UserTier } from "@/models/billing/fees/UserTier";

export class UserManagementService {
  private readonly SERVICE_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS;

  private readonly WALLET_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.FINANCIAL_OPERATIONS;

  constructor(
    private userRepository: UserRepository,
    private walletRepository: WalletRepository,
    private transactionRepository: TransactionRepository,
    private bankAccountRepository: BankAccountRepository,
    private virtualAccountRepository: VirtualAccountRepository,
    private referralRepository: ReferralRepository,
    private adminRepository: AdminRepository,
    private cacheService: CacheService,
    private auditLoggingService: AuditLoggingService,
    private notificationService: NotificationService,
    private appVersionRepository: AppVersionRepository = new AppVersionRepository(),
  ) {}

  private async getLatestAppVersions(): Promise<string[]> {
    try {
      const [latestAndroid, latestIos] = await Promise.all([
        this.appVersionRepository.findLatestByPlatform("Android"),
        this.appVersionRepository.findLatestByPlatform("iOS"),
      ]);
      const versions = new Set<string>();
      if (latestAndroid?.version && latestAndroid.version.trim()) {
        versions.add(latestAndroid.version.trim());
      }
      if (latestIos?.version && latestIos.version.trim()) {
        versions.add(latestIos.version.trim());
      }

      if (versions.size > 0) {
        return Array.from(versions);
      }

      // Fallback: Check distinct appVersions recorded on users
      const distinctVersions: string[] = (await this.userRepository.distinct(
        "appVersion",
        {
          appVersion: { $nin: [null, ""] },
          deletedAt: null,
        },
      )) || [];

      if (distinctVersions.length > 0) {
        distinctVersions.sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
        );
        return [distinctVersions[0]];
      }

      return [];
    } catch (err) {
      return [];
    }
  }

  async getTotalUsersStats(filters: PeriodFilter = {}) {
    const dateRange = resolveDateRange(filters);
    const dateMatch = dateRange ? { createdAt: dateRange } : {};

    const [userStats, walletStats] = await Promise.all([
      this.userRepository.aggregate([
        { $match: dateMatch },
        {
          $facet: {
            byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            byUserType: [{ $group: { _id: "$userType", count: { $sum: 1 } } }],
            kycStatus: [
              { $group: { _id: "$xixapayKyc.status", count: { $sum: 1 } } },
            ],
            partnerStatus: [
              { $group: { _id: "$partner.status", count: { $sum: 1 } } },
            ],
            bvnVerified: [
              {
                $match: {
                  bvnVerified: true,
                },
              },
              { $count: "count" },
            ],
            ninVerified: [
              { $match: { nin: { $exists: true, $ne: null } } },
              { $count: "count" },
            ],
            byAppVersion: [
              { $group: { _id: { $ifNull: ["$appVersion", "None"] }, count: { $sum: 1 } } },
            ],
            total: [{ $count: "count" }],
          },
        },
      ]),
      this.walletRepository.aggregate([
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$balance" },
            totalBonusBalance: { $sum: "$bonusBalance" },
            totalCommissionBalance: { $sum: "$commissionBalance" },
            walletsWithBalance: {
              $sum: { $cond: [{ $gt: ["$balance", 0] }, 1, 0] },
            },
            totalWallets: { $sum: 1 },
          },
        },
      ]),
    ]);

    const data = userStats[0];
    const statusMap = new Map(data.byStatus.map((s: any) => [s._id, s.count]));
    const kycMap = new Map(data.kycStatus.map((s: any) => [s._id, s.count]));
    const partnerMap = new Map(
      data.partnerStatus.map((s: any) => [s._id, s.count]),
    );
    const typeMap = new Map(data.byUserType.map((s: any) => [s._id, s.count]));

    const latestVersions = await this.getLatestAppVersions();
    let latestVersionCount = 0;
    let oldVersionCount = 0;
    let noVersionCount = 0;

    data.byAppVersion?.forEach((v: any) => {
      const ver = v._id;
      if (!ver || ver === "None" || ver === "") {
        noVersionCount += v.count;
      } else if (latestVersions.includes(ver)) {
        latestVersionCount += v.count;
      } else {
        oldVersionCount += v.count;
      }
    });

    return {
      total: data.total[0]?.count || 0,
      byStatus: {
        active: statusMap.get("active") || 0,
        inactive: statusMap.get("inactive") || 0,
        suspended: statusMap.get("suspended") || 0,
        fraudulent: statusMap.get("fraudulent") || 0,
        "shadow-banned": statusMap.get("shadow-banned") || 0,
      },
      byUserType: {
        regular: typeMap.get("regular") || 0,
        influencer: typeMap.get("influencer") || 0,
        "micro-influencer": typeMap.get("micro-influencer") || 0,
        vendor: typeMap.get("vendor") || 0,
      },
      kyc: {
        pending: kycMap.get("pending") || 0,
        verified: kycMap.get("verified") || 0,
        failed: kycMap.get("failed") || 0,
      },
      partner: {
        pending: partnerMap.get("pending") || 0,
        active: partnerMap.get("active") || 0,
        suspended: partnerMap.get("suspended") || 0,
      },
      bvnVerifiedCount: data.bvnVerified[0]?.count || 0,
      ninVerifiedCount: data.ninVerified[0]?.count || 0,
      versionStats: {
        latest: latestVersionCount,
        old: oldVersionCount,
        noVersion: noVersionCount,
        latestVersions,
      },
      walletBalances: {
        totalBalance: walletStats[0]?.totalBalance || 0,
        totalBonusBalance: walletStats[0]?.totalBonusBalance || 0,
        totalCommissionBalance: walletStats[0]?.totalCommissionBalance || 0,
        walletsWithBalance: walletStats[0]?.walletsWithBalance || 0,
        totalWallets: walletStats[0]?.totalWallets || 0,
      },
    };
  }

  async getUserChartData(filters: PeriodFilter = {}) {
    const dateRange = resolveDateRange(filters);
    const matchStage: any = {};
    if (dateRange) {
      matchStage.createdAt = dateRange;
    }

    const stats = await this.userRepository.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    return stats.map((stat: any) => ({
      date: stat._id,
      count: stat.count
    }));
  }

  async listUsers(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ): Promise<any> {
    const query: any = { deletedAt: null };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.userType) {
      query.userType = filters.userType;
    }

    if (filters.bvnVerified === "true") {
      query.bvnVerified = true;
    } else if (filters.bvnVerified === "false") {
      query.bvnVerified = { $ne: true };
    }

    if (filters.emailVerified === "true") {
      query.emailVerifiedAt = { $ne: null };
    } else if (filters.emailVerified === "false") {
      query.emailVerifiedAt = null;
    }

    if (filters.phoneVerified === "true") {
      query.phoneVerifiedAt = { $ne: null };
    } else if (filters.phoneVerified === "false") {
      query.phoneVerifiedAt = null;
    }

    const versionFilter = (
      filters.versionFilter ||
      filters.appVersion ||
      filters.version ||
      ""
    ).trim();

    if (versionFilter) {
      const lowerVersion = versionFilter.toLowerCase();
      if (lowerVersion === "none" || lowerVersion === "no-version") {
        query.appVersion = { $in: [null, ""] };
      } else if (lowerVersion === "latest") {
        const latestVersions = await this.getLatestAppVersions();
        query.appVersion =
          latestVersions.length > 0
            ? { $in: latestVersions }
            : { $in: ["__NONE__"] };
      } else if (lowerVersion === "old" || lowerVersion === "outdated") {
        const latestVersions = await this.getLatestAppVersions();
        query.appVersion = { $nin: [null, "", ...latestVersions] };
      } else {
        query.appVersion = versionFilter;
      }
    }

    const dateRange = resolveDateRange(filters);
    if (dateRange) {
      query.createdAt = dateRange;
    }

    if (filters.search) {
      query.$or = [
        { firstname: { $regex: filters.search, $options: "i" } },
        { lastname: { $regex: filters.search, $options: "i" } },
        { email: { $regex: filters.search, $options: "i" } },
        { phone: { $regex: filters.search, $options: "i" } },
        { username: { $regex: filters.search, $options: "i" } },
      ];
    }

    // Determine sort options
    const sortOptions: any = {};
    const sortOrder =
      filters.sortOrder === "asc" ||
      filters.order === "asc" ||
      filters.sort === "asc" ||
      filters.sortOrder === "1" ||
      filters.sortOrder === 1
        ? 1
        : -1;

    const sortBy = filters.sortBy || filters.sortField;
    if (
      sortBy === "balance" ||
      sortBy === "wallet.balance" ||
      sortBy === "walletBalance"
    ) {
      sortOptions["wallet.balance"] = sortOrder;
    } else if (sortBy === "name" || sortBy === "firstname") {
      sortOptions["firstname"] = sortOrder;
    } else if (sortBy === "email") {
      sortOptions["email"] = sortOrder;
    } else if (sortBy === "username") {
      sortOptions["username"] = sortOrder;
    } else if (sortBy === "status") {
      sortOptions["status"] = sortOrder;
    } else if (sortBy === "userType") {
      sortOptions["userType"] = sortOrder;
    } else if (sortBy === "appVersion" || sortBy === "version") {
      sortOptions["appVersion"] = sortOrder;
    } else {
      // Default to createdAt
      sortOptions["createdAt"] = sortOrder;
    }

    const result = await this.userRepository.findWithPaginationForAdmin(
      query,
      page,
      limit,
      sortOptions,
    );

    return {
      users: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getUserDetails(
    userId: string,
    includeRelations: boolean = false,
  ): Promise<any> {
    const user = await this.userRepository.findByIdForAdmin(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    const response: any = {
      user: {
        id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phone: user.phone,
        phoneCode: user.phoneCode,
        username: user.username,
        gender: user.gender,
        refCode: user.refCode,
        avatar: user.avatar,
        country: user.country,
        state: user.state,
        status: user.status,
        userType: user.userType,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        pinActivatedAt: user.pinActivatedAt,
        twoFactorEnabledAt: user.twoFactorEnabledAt,
        bvnVerified: Boolean(user.bvnVerified),
        bvnValidated: Boolean(user.bvnValidated),
        hasBvn: Boolean(user.bvn),
        loginBiometricEnabled: user.loginBiometricEnabled,
        transactionBiometricEnabled: user.transactionBiometricEnabled,
        dateOfBirth: user.dateOfBirth,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        appVersion: user.appVersion || null,
        influencerRules: user.influencerRules,
        preferredProvider: user.preferredProvider || null,
      },
      wallet: wallet
        ? {
            mainBalance: wallet.balance,
            bonusBalance: wallet.bonusBalance,
            commissionBalance: wallet.commissionBalance,
            lockedAt: wallet.lockedAt,
          }
        : null,
    };

    // Include additional relations if requested
    if (includeRelations) {
      const [bankAccounts, virtualAccounts, staticAccount, referrals] =
        await Promise.all([
          this.bankAccountRepository.findByUserIdForAdmin(userId),
          this.virtualAccountRepository.findTemporaryAccountByUserIdForAdmin(
            userId,
          ),
          this.virtualAccountRepository.findPermanentAccountByUserIdForAdmin(
            userId,
          ),
          this.referralRepository.findReferralsByRefereeIdForAdmin(userId),
        ]);

      response.bankAccounts = bankAccounts.map((account) => ({
        _id: account._id,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankCode: account.bankCode,
        userId: account.userId,
        bankName: account.bankName || "",
        isDefault: account.isDefault,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      }));
      response.virtualAccounts = virtualAccounts;
      response.staticAccount = staticAccount;
      response.referrals = {
        data: referrals,
        totalReferred: referrals.length,
        totalEarned: referrals.reduce(
          (sum, ref) =>
            sum + ref.bonusMilestones.reduce((s, m) => s + m.bonusAmount, 0),
          0,
        ),
      };
    }

    return response;
  }

  async updateUserStatus(userId: string, status: string): Promise<any> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    user.status = status as any;
    await user.save();

    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));

    return { status: user.status };
  }

  async updateUserType(
    userId: string,
    userType: "regular" | "influencer" | "micro-influencer",
    influencerRules?: any,
  ) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    user.userType = userType;
    if (influencerRules !== undefined) {
      user.influencerRules = influencerRules;
    }
    
    await user.save();

    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    return {
      userType: user.userType,
      influencerRules: user.influencerRules,
    };
  }

  async markUserAsFraudulent(userId: string, reason: string): Promise<any> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    user.status = "suspended";
    await user.save();

    // Lock wallet
    const wallet = await this.walletRepository.findByUserId(userId);
    if (wallet) {
      wallet.lockedAt = new Date();
      await wallet.save();
    }
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    return { reason };
  }

  async getUserServiceTransactions(
    userId: string,
    page: number,
    limit: number,
    filters: any = {},
  ): Promise<any> {
    const requestedType = filters.type || filters.serviceType;
    const query: any = {
      type:
        requestedType && requestedType !== "all" && this.SERVICE_TRANSACTION_TYPES.includes(requestedType as any)
          ? requestedType
          : { $in: this.SERVICE_TRANSACTION_TYPES },
      userId: userId,
    };

    this.applyFilters(query, filters);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    return {
      category: "service_transactions",
      transactions: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getUserWalletTransactions(
    userId: string,
    page: number,
    limit: number,
    filters: any = {},
  ): Promise<any> {
    const query: any = {
      type: { $in: this.WALLET_TRANSACTION_TYPES },
      userId: userId,
    };

    this.applyFilters(query, filters);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    return {
      category: "service_transactions",
      transactions: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getUserBvn(
    userId: string,
    adminId: string,
    password: string,
  ): Promise<any> {
    const admin = await this.adminRepository.findById(adminId);
    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (admin.isLocked()) {
      throw new AppError(
        "Admin is locked",
        HTTP_STATUS.LOCKED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      throw new AppError("Invalid credentials", HTTP_STATUS.UNAUTHORIZED);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return { bvn: user.bvn };
  }

  async creditUserWallet(
    userId: string,
    amount: number,
    remark: string,
    data: {
      adminId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<any> {
    const user = await this.userRepository.findById(userId);
    const admin = await this.adminRepository.findById(data.adminId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (wallet.lockedAt) {
      throw new AppError(
        "Wallet is locked",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.WALLET_LOCKED,
      );
    }

    const reference = generateReference("ADM");
    const balanceBefore = wallet.balance;

    // Use atomic increment operation
    const updatedWallet = await this.walletRepository.incrementBalance(
      wallet.id,
      amount,
    );

    if (!updatedWallet) {
      throw new AppError(
        "Failed to update wallet",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.DATABASE_ERROR,
      );
    }

    SocketService.emitToUser(userId.toString(), "wallet_credit", {
      balance: updatedWallet.balance,
      bonusBalance: updatedWallet.bonusBalance,
      commissionBalance: updatedWallet.commissionBalance,
      amount,
      direction: "CREDIT",
      type: "admin_credit",
      reference,
      reason: remark || "admin_credit",
      timestamp: new Date().toISOString(),
    });

    await this.auditLoggingService.logAdminAction({
      adminId: data.adminId || "system",
      action: "wallet_credit",
      resource: "Wallet",
      resourceId: userId,
      userId,
      amount,
      reason: remark || "admin_credit",
      status: "success",
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });

    const balanceAfter = updatedWallet.balance;

    await this.transactionRepository.create({
      walletId: wallet.id,
      sourceId: wallet.userId,
      userId: wallet.userId,
      reference,
      amount,
      direction: "CREDIT",
      status: "success",
      purpose: "Admin credit",
      type: "wallet_credit",
      provider: "Admin",
      remark,
      balanceBefore,
      balanceAfter,
      initiatedByType: "admin",
      initiatedBy: new Types.ObjectId(data.adminId),
      meta: {
        admin: {
          id: data.adminId,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          phone: admin.phone,
          avatar: admin.profilePicture,
        },
      },
    });

    await this.notificationService.createNotification({
      type: "wallet_credit",
      notifiableType: "User",
      notifiableId: new Types.ObjectId(userId),
      sendPush: true,
      sendEmail: false,
      sendSMS: false,
      data: {
        amount,
        balance: balanceAfter,
      },
    });

    try {
      await this.cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
    } catch (cacheErr) {
      // Non-critical error logging
    }
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));

    return {
      amount,
      newBalance: balanceAfter,
      reference,
    };
  }

  async debitUserWallet(
    userId: string,
    amount: number,
    remark: string,
    data: {
      adminId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<any> {
    const user = await this.userRepository.findById(userId);
    const admin = await this.adminRepository.findById(data.adminId);

    if (!admin) {
      throw new AppError(
        "Admin not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (wallet.lockedAt) {
      throw new AppError(
        "Wallet is locked",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.WALLET_LOCKED,
      );
    }

    const balanceBefore = wallet.balance;

    if (balanceBefore < amount) {
      throw new AppError(
        "Insufficient balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE,
      );
    }

    const reference = generateReference("ADM");

    // Use atomic decrement operation with balance check
    const updatedWallet = await this.walletRepository.decrementBalance(
      wallet.id,
      amount,
    );

    if (!updatedWallet) {
      throw new AppError(
        "Failed to update wallet or insufficient balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE,
      );
    }

    SocketService.emitToUser(userId.toString(), "wallet_debit", {
      balance: updatedWallet.balance,
      bonusBalance: updatedWallet.bonusBalance,
      commissionBalance: updatedWallet.commissionBalance,
      amount,
      direction: "DEBIT",
      type: "admin_debit",
      reference,
      reason: remark || "admin_debit",
      timestamp: new Date().toISOString(),
    });

    await this.auditLoggingService.logAdminAction({
      adminId: data.adminId || "system",
      action: "wallet_debit",
      resource: "Wallet",
      resourceId: userId,
      userId,
      amount,
      reason: remark || "admin_debit",
      status: "success",
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });

    const balanceAfter = updatedWallet.balance;

    await this.transactionRepository.create({
      walletId: wallet.id,
      sourceId: wallet.userId,
      userId: wallet.userId,
      reference,
      amount,
      direction: "DEBIT",
      status: "success",
      purpose: "Admin debit",
      provider: "Admin",
      type: "wallet_debit",
      remark,
      balanceBefore,
      balanceAfter,
      initiatedByType: "admin",
      initiatedBy: new Types.ObjectId(data.adminId),
      meta: {
        admin: {
          id: data.adminId,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          phone: admin.phone,
          avatar: admin.profilePicture,
        },
      },
    });

    await this.notificationService.createNotification({
      type: "wallet_debit",
      notifiableType: "User",
      notifiableId: new Types.ObjectId(userId),
      sendPush: true,
      sendEmail: false,
      sendSMS: false,
      data: {
        amount,
        balance: balanceAfter,
      },
    });

    try {
      await this.cacheService.delete(CACHE_KEYS.USER_WALLET(userId.toString()));
    } catch (cacheErr) {
      // Non-critical error logging
    }
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));

    return {
      amount,
      newBalance: balanceAfter,
      reference,
    };
  }

  async updateUserPreferredProvider(userId: string, provider: string | null) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    }
    
    // We use User model directly since userRepository might not have a generic update method exposed, 
    // or we can just use updateOne if it has it. I'll use User model to be safe.
    // Actually, I'll use this.userRepository.updateOne
    const updated = await this.userRepository.updateOne(
      { _id: new Types.ObjectId(userId) },
      { preferredProvider: provider }
    );
    
    // Clear cache
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    
    return updated;
  }

  async updateUserTier(userId: string, tierCode: string, isTierLocked: boolean = true) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const normalizedCode = tierCode.toLowerCase().trim();
    if (normalizedCode !== "regular") {
      const tierDoc = await UserTier.findOne({ code: normalizedCode, isActive: true });
      if (!tierDoc) {
        throw new AppError(`Tier '${tierCode}' is not an active tier`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }
    }

    await this.userRepository.updateOne(
      { _id: new Types.ObjectId(userId) },
      { tierCode: normalizedCode, isTierLocked: Boolean(isTierLocked) }
    );

    // Clear cache
    await this.cacheService.delete(CACHE_KEYS.USER_PROFILE(userId));
    await this.cacheService.delete(`tier:${userId}`);

    return {
      userId,
      tierCode: normalizedCode,
      isTierLocked: Boolean(isTierLocked),
    };
  }

  private applyFilters(query: any, filters: any) {
    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    if (filters.reference) {
      query.reference = { $regex: filters.reference, $options: "i" };
    }

    if (filters.minAmount || filters.maxAmount) {
      query.amount = {};
      if (filters.minAmount) query.amount.$gte = parseFloat(filters.minAmount);
      if (filters.maxAmount) query.amount.$lte = parseFloat(filters.maxAmount);
    }

    if (filters.userId) {
      query.userId = new Types.ObjectId(filters.userId);
    }
  }
}
