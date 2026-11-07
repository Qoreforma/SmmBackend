import { DiscountRepository } from "@/repositories/shared/DiscountRepository";
import { DiscountService } from "./finances/DiscountService";
import { EmailBannerService } from "./content/EmailBannerService";
import { DeviceTrustService } from "./auth/DeviceTrustService";
import ServiceContainer from "../client/container";

// Repositories
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { AlertRepository } from "@/repositories/admin/AlertRepository";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { AuditLogRepository } from "@/repositories/admin/AuditLogRepository";
import { BannerRepository } from "@/repositories/admin/BannerRepository";

import { DepositRequestRepository } from "@/repositories/client/DepositRepository";
import {
  FAQRepository,
  FaqCategoryRepository,
} from "@/repositories/shared/FAQRepository";

import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";
import { RoleRepository } from "@/repositories/admin/RoleRepository";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";

import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";

import { TreasuryRepository } from "@/repositories/admin/TreasuryRepository";

// Admin Services
import { AlertService } from "./content/AlertService";
import { AppVersionService } from "./system/AppVersionService";
import { AuditLogService } from "./system/AuditLogService";
import { BannerService } from "./content/BannerService";
import { CashbackRuleService } from "./finances/CashbackRuleService";

import { DashboardService } from "./system/DashboardService";
import { AnalyticsService } from "./system/AnalyticsService";
import { TreasuryService } from "./finances/TreasuryService";
import { DepositManagementService } from "./transactions/DepositManagementService";
import { FAQManagementService } from "./content/FAQManagementService";

import { ProductManagementService } from "./products/ProductManagementService";
import { ProviderManagementService } from "./products/ProviderManagementService";
import { ReferralBonusService } from "./finances/ReferralBonusService";
import { ReferralTermsService } from "./content/ReferralTermsService";
import { RoleService } from "./admins/RoleService";
import { ServiceChargeService } from "./finances/ServiceChargeService";
import { ServiceManagementService } from "./products/ServiceManagementService";
import { ServiceTypeService } from "./products/ServiceTypeService";
import { SystemBankAccountService } from "./finances/SystemBankAccountService";
import { TransactionManagementService } from "./transactions/TransactionManagementService";
import { UserManagementService } from "./users/UserManagementService";
import { WithdrawalManagementService } from "./transactions/WithdrawalManagementService";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { ReferralBonusRepository } from "@/repositories/admin/ReferralBonusRepository";
import { ProductSyncService } from "../sync/ProductSyncService";
import { AdminAuthService } from "../admin/auth/AdminAuthService";
import { AdminManagementService } from "./admins/AdminManagementService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { Service } from "@/models/reference/Service";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import { ManualWithdrawalService } from "./finances/Manualwithdrawalservice";
import { PricingRuleService } from "./finances/PricingRuleService";

class AdminServiceContainer {
  private static deviceTrustService?: DeviceTrustService;
  private static emailBannerService?: EmailBannerService;
  private static discountService?: DiscountService;
  // SINGLETON INSTANCES

  // Base Level Services
  private static auditLogService?: AuditLogService;
  private static analyticsService?: AnalyticsService;
  private static treasuryService?: TreasuryService;
  private static auditLoggingService: AuditLoggingService;
  private static bannerService?: BannerService;
  private static cashbackRuleService?: CashbackRuleService;

  private static referralTermsService?: ReferralTermsService;
  private static appVersionService?: AppVersionService;

  // Level 1 Services
  private static authService?: AdminAuthService;
  private static serviceChargeService?: ServiceChargeService;
  private static dashboardService?: DashboardService;
  private static faqManagementService?: FAQManagementService;

  private static adminManagementService?: AdminManagementService;
  private static roleService?: RoleService;

  // Level 2 Services

  private static productManagementService?: ProductManagementService;
  private static systemBankAccountService?: SystemBankAccountService;
  private static alertService?: AlertService;
  private static depositManagementService?: DepositManagementService;
  private static withdrawalManagementService?: WithdrawalManagementService;
  private static transactionManagementService?: TransactionManagementService;
  private static userManagementService?: UserManagementService;

  // Level 3 Services
  private static serviceManagementService?: ServiceManagementService;
  private static serviceTypeService?: ServiceTypeService;
  private static providerManagementService?: ProviderManagementService;
  private static referralBonusService?: ReferralBonusService;
  private static pricingRuleService?: PricingRuleService;

  private static manualWithdrawalService?: ManualWithdrawalService;
  // BASE LEVEL SERVICES

  static getAuditLogService(): AuditLogService {
    if (!this.auditLogService) {
      this.auditLogService = new AuditLogService(new AuditLogRepository());
    }
    return this.auditLogService;
  }
  static getAuditLoggingService(): AuditLoggingService {
    if (!this.auditLoggingService) {
      this.auditLoggingService = new AuditLoggingService(
        new AuditLogRepository(),
      );
    }
    return this.auditLoggingService;
  }


    static getDeviceTrustService() {
    if (!this.deviceTrustService) {
      this.deviceTrustService = new DeviceTrustService();
    }
    return this.deviceTrustService;
  }

  static getEmailBannerService() {
    if (!this.emailBannerService) {
      this.emailBannerService = new EmailBannerService(
        new (require("@/repositories/admin/EmailBannerRepository").EmailBannerRepository)(),
        ServiceContainer.getCacheService()
      );
    }
    return this.emailBannerService;
  }

  static getDiscountService() {
    if (!this.discountService) {
      this.discountService = new DiscountService(
        new DiscountRepository(),
        ServiceContainer.getCacheService()
      );
    }
    return this.discountService;
  }

  static getTreasuryService(): TreasuryService {
    if (!this.treasuryService) {
      this.treasuryService = new TreasuryService(
        new TreasuryRepository(),
        new TransactionRepository(),
        new WalletRepository()
      );
    }
    return this.treasuryService;
  }

  static getBannerService(): BannerService {
    if (!this.bannerService) {
      this.bannerService = new BannerService(new BannerRepository());
    }
    return this.bannerService;
  }

  static getCashbackRuleService(): CashbackRuleService {
    if (!this.cashbackRuleService) {
      this.cashbackRuleService = new CashbackRuleService(
        new CashbackRuleRepository()
      );
    }
    return this.cashbackRuleService;
  }



  static getReferralTermsService(): ReferralTermsService {
    if (!this.referralTermsService) {
      this.referralTermsService = new ReferralTermsService(
        new ReferralTermsRepository(),
      );
    }
    return this.referralTermsService;
  }

  static getAppVersionService(): AppVersionService {
    if (!this.appVersionService) {
      this.appVersionService = new AppVersionService(
        new AppVersionRepository(),
      );
    }
    return this.appVersionService;
  }

  // LEVEL 1 SERVICES

  static getAdminAuthService(): AdminAuthService {
    if (!this.authService) {
      this.authService = new AdminAuthService(
        ServiceContainer.getOTPService(),
        ServiceContainer.getEmailService(),
        ServiceContainer.getCacheService(),
        this.getDeviceTrustService()
      );
    }
    return this.authService;
  }

  static getServiceChargeService(): ServiceChargeService {
    if (!this.serviceChargeService) {
      this.serviceChargeService = new ServiceChargeService(
        new ServiceChargeRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.serviceChargeService;
  }


  static getDashboardService(): DashboardService {
    if (!this.dashboardService) {
      this.dashboardService = new DashboardService(
        new UserRepository(),
        new TransactionRepository(),
        new WalletRepository(),
      );
    }
    return this.dashboardService;
  }

  static getFAQManagementService(): FAQManagementService {
    if (!this.faqManagementService) {
      this.faqManagementService = new FAQManagementService(
        new FAQRepository(),
        new FaqCategoryRepository(),
      );
    }
    return this.faqManagementService;
  }



  static getAdminManagementService(): AdminManagementService {
    if (!this.adminManagementService) {
      this.adminManagementService = new AdminManagementService(
        ServiceContainer.getEmailService(),
        new AdminRepository(),
      );
    }
    return this.adminManagementService;
  }

  static getRoleService(): RoleService {
    if (!this.roleService) {
      this.roleService = new RoleService(
        new RoleRepository(),
        new AdminRepository(),
      );
    }
    return this.roleService;
  }

  // LEVEL 2 SERVICES





  static getProductManagementService(): ProductManagementService {
    if (!this.productManagementService) {
      this.productManagementService = new ProductManagementService(
        new ProductRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.productManagementService;
  }

  static getSystemBankAccountService(): SystemBankAccountService {
    if (!this.systemBankAccountService) {
      this.systemBankAccountService = new SystemBankAccountService(
        new SystemBankAccountRepository(),
        ServiceContainer.getSaveHavenService(),
        new BankRepository()
      );
    }
    return this.systemBankAccountService;
  }

  static getAlertService(): AlertService {
    if (!this.alertService) {
      this.alertService = new AlertService(
        new AlertRepository(),
        ServiceContainer.getNotificationService(),
        new UserRepository(),
      );
    }
    return this.alertService;
  }

  static getDepositManagementService(): DepositManagementService {
    if (!this.depositManagementService) {
      this.depositManagementService = new DepositManagementService(
        new DepositRequestRepository(),
        new WalletRepository(),
        ServiceContainer.getNotificationService(),
        new TransactionRepository(),
        ServiceContainer.getHelperService(),
      );
    }
    return this.depositManagementService;
  }

  static getWithdrawalManagementService(): WithdrawalManagementService {
    if (!this.withdrawalManagementService) {
      this.withdrawalManagementService = new WithdrawalManagementService(
        new TransactionRepository(),
        new WalletRepository(),
        ServiceContainer.getNotificationService(),
      );
    }
    return this.withdrawalManagementService;
  }

  static getTransactionManagementService(): TransactionManagementService {
    if (!this.transactionManagementService) {
      this.transactionManagementService = new TransactionManagementService(
        new TransactionRepository(),
        new WalletRepository(),
        ServiceContainer.getWalletService(),
        this.getDepositManagementService(),
        this.getManualWithdrawalService(),
        ServiceContainer.getTransactionPollingService(),
      );
    }
    return this.transactionManagementService;
  }

  static getUserManagementService(): UserManagementService {
    if (!this.userManagementService) {
      this.userManagementService = new UserManagementService(
        new UserRepository(),
        new WalletRepository(),
        new TransactionRepository(),
        new BankAccountRepository(),
        new VirtualAccountRepository(),
        new ReferralRepository(),
        new AdminRepository(),
        ServiceContainer.getCacheService(),
        this.getAuditLoggingService(),
        ServiceContainer.getNotificationService(),
        new AppVersionRepository(),
      );
    }
    return this.userManagementService;
  }

  // LEVEL 3 SERVICES

  static getServiceManagementService(): ServiceManagementService {
    if (!this.serviceManagementService) {
      this.serviceManagementService = new ServiceManagementService(
        new ServiceRepository(),
        new ServiceTypeRepository(),
        this.getProductManagementService(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.serviceManagementService;
  }

  static getServiceTypeService(): ServiceTypeService {
    if (!this.serviceTypeService) {
      this.serviceTypeService = new ServiceTypeService(
        new ServiceTypeRepository(),
        new ServiceRepository(),
        this.getProductManagementService(),
      );
    }
    return this.serviceTypeService;
  }

  static getProviderManagementService(): ProviderManagementService {
    if (!this.providerManagementService) {
      this.providerManagementService = new ProviderManagementService(
        new ProviderRepository(),
        new ProductRepository(),
        new ServiceTypeRepository(),
        new ProductSyncService(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.providerManagementService;
  }

  static getReferralBonusService(): ReferralBonusService {
    if (!this.referralBonusService) {
      this.referralBonusService = new ReferralBonusService(
        new ReferralBonusRepository(),
        new ReferralRepository(),
        new UserRepository(),
        ServiceContainer.getWalletService(),
      );
    }
    return this.referralBonusService;
  }

  static getPricingRuleService(): PricingRuleService {
    if (!this.pricingRuleService) {
      this.pricingRuleService = new PricingRuleService(
        this.getCashbackRuleService(),
      );
    }
    return this.pricingRuleService;
  }

  // LEVEL 4 SERVICES


  static getManualWithdrawalService(): ManualWithdrawalService {
    if (!this.manualWithdrawalService) {
      this.manualWithdrawalService = new ManualWithdrawalService(
        new ManualWithdrawalRepository(),
        new TransactionRepository(),
        ServiceContainer.getWalletService(),
        ServiceContainer.getNotificationService(),
      );
    }
    return this.manualWithdrawalService;
  }




  static getAnalyticsService(): AnalyticsService {
    if (!this.analyticsService) {
      this.analyticsService = new AnalyticsService(
        ServiceContainer.getTransactionRepository()
      );
    }
    return this.analyticsService;
  }
}

export default AdminServiceContainer;
