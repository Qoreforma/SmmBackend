
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { CountryRepository } from "@/repositories/shared/CountryRepository";
import { StateRepository } from "@/repositories/shared/StateRepository";
import { CityRepository } from "@/repositories/shared/CityRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { BannerRepository } from "@/repositories/admin/BannerRepository";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";

import {
  FAQRepository,
  FaqCategoryRepository,
} from "@/repositories/shared/FAQRepository";

import { CacheService } from "@/services/core/CacheService";
import { EmailService } from "@/services/core/EmailService";
import { SMSService } from "@/services/core/SMSService";
import { OTPService } from "@/services/core/OTPService";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { MonnifyService } from "@/services/client/providers/payments/MonnifyService";
import { FlutterwaveService } from "@/services/client/providers/payments/FlutterwaveService";
import { PushNotificationService } from "@/services/client/notifications/PushNotificationService";

import { AuthService } from "@/services/client/core/AuthService";
import { BankAccountService } from "@/services/client/wallet/BankAccountService";
import { FAQService } from "@/services/client/FAQService";
import { PaymentService } from "@/services/client/PaymentService";
import { ProfileService } from "@/services/client/core/ProfileService";
import { ReferenceDataService } from "@/services/client/ReferenceDataService";
import { ReferralService } from "@/services/client/ReferralService";
import { VirtualAccountService } from "@/services/client/wallet/VirtualAccountService";
import { WithdrawalService } from "@/services/client/wallet/WithdrawalService";
import { TransactionPollingService } from "@/services/polling/TransactionPollingService";
import { SocialAuthService } from "./core/SocialAuthService";

// Provider API Services (SMM only — bill payment providers removed)

import { ProviderService } from "@/services/client/ProviderService";

// Owlet Provider Service (unified)
import { OwletService } from "@/services/client/providers/owlet/OwletService";
import { FiveSimService } from "@/services/client/providers/fivesim/FiveSimService";
import { FleexaService } from "@/services/client/providers/fleexa/FleexaService";
import { TextverifiedService } from "@/services/client/providers/textverified/TextverifiedService";
import { ChannelIdentityRepository } from "@/repositories/client/ChannelIdentityRepository";
import { TelegramService } from "@/services/client/telegram/TelegramService";

// SMM + Owlet Services
import { ProxyService } from "@/services/client/ProxyService";
import { NumberRentalService } from "@/services/client/NumberRentalService";
import { EmailOtpService } from "@/services/client/EmailOtpService";
import { UserTierProgressionService } from "@/services/client/UserTierProgressionService";
import {
  DepositRepository,
  DepositRequestRepository,
} from "@/repositories/client/DepositRepository";

import { SystemConfigService } from "../core/SystemConfigService";
import { PaymentReconciliationService } from "../admin/finances/PaymentReconciliationService";
import { withProviderMonitoring } from "@/utils/monitoring/providerMonitoring";


import {
  getTransactionStateValidator,
  TransactionStateValidator,
} from "./utility/TransactionStateValidator";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { AuditLogRepository } from "@/repositories/admin/AuditLogRepository";
import { WebhookDeliveryService } from "./webhooks/WebhookDeliveryService";
import { ProviderReconciliationService } from "../ProviderReconciliationService";
import { BiometricService } from "./core/BiometricService";
import { BiometricV2Service } from "./core/BiometricV2Service";
import { DeviceCredentialRepository } from "@/repositories/client/DeviceCredentialRepository";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { IdentityVerificationService } from "./core/IdentityVerificationService";
import { HelperService } from "./utility/HelperService";
import { DepositService } from "./wallet/DepositService";
import { TransactionService } from "./wallet/TransactionService";
import { XixapayService } from "./providers/payments/XixapayService";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { WalletService } from "@/services/client/wallet/WalletService";
import { GameTopupService } from "@/services/client/GameTopupService";
import SocketService from "../core/SocketService";
import { NigeriaSmmService } from "@/services/client/providers/smm/NigeriaSmmService";
import { SmmFollowsService } from "@/services/client/providers/smm/SmmFollowsService";
import { SmmResellerPanelService } from "@/services/client/providers/smm/SmmResellerPanelService";
import { SmmService } from "@/services/client/SmmService";


class ServiceContainer {
  // SINGLETON INSTANCES

  private static cacheService?: CacheService;
  private static emailService?: EmailService;
  private static smsService?: SMSService;
  private static otpService?: OTPService;
  private static saveHavenService?: SaveHavenService;
  private static xixapayService?: XixapayService;
  private static monnifyService?: MonnifyService;
  private static biometricService?: BiometricService;
  private static biometricV2Service?: BiometricV2Service;
  private static flutterwaveService?: FlutterwaveService;
  private static nigeriaSmmService?: NigeriaSmmService;
  private static smmFollowsService?: SmmFollowsService;
  private static smmResellerPanelService?: SmmResellerPanelService;
  private static owletService?: OwletService;
  private static fiveSimService?: FiveSimService;
  private static fleexaService?: FleexaService;
  private static textverifiedService?: TextverifiedService;
  private static smmService?: SmmService;
  private static proxyService?: ProxyService;
  private static numberRentalService?: NumberRentalService;
  private static emailOtpService?: EmailOtpService;
  private static auditLoggingService?: AuditLoggingService;
  private static webhookdeliveryService?: WebhookDeliveryService;
  private static providerReconciliationService?: ProviderReconciliationService;


  // Repositories

  private static transactionRepository?: TransactionRepository;
  private static manualWithdrawalRepository?: ManualWithdrawalRepository;
  private static bankAccountRepository?: BankAccountRepository;
  private static walletRepository?: WalletRepository;
  private static userRepository?: UserRepository;
  private static adminRepository?: AdminRepository;
  private static notificationRepository?: NotificationRepository;
  private static serviceChargeRepository?: ServiceChargeRepository;
  private static bankRepository?: BankRepository;
  private static virtualAccountRepository?: VirtualAccountRepository;
  private static referralRepository?: ReferralRepository;
  private static countryRepository?: CountryRepository;
  private static stateRepository?: StateRepository;
  private static cityRepository?: CityRepository;
  private static providerRepository?: ProviderRepository;
  private static serviceRepository?: ServiceRepository;
  private static productRepository?: ProductRepository;
  private static bannerRepository?: BannerRepository;
  private static systemBankAccountRepository?: SystemBankAccountRepository;
  private static serviceTypeRepository?: ServiceTypeRepository;
  private static appVersionRepository?: AppVersionRepository;
  private static cashbackRuleRepository?: CashbackRuleRepository;
  private static referralTermsRepository?: ReferralTermsRepository;
  private static deviceCredentialRepository?: DeviceCredentialRepository;

  private static faqRepository?: FAQRepository;
  private static faqCategoryRepository?: FaqCategoryRepository;
  private static depositRequestRepository?: DepositRequestRepository;
  private static depositRepository?: DepositRepository;

  private static providerRateConfigRepository?: ProviderRateConfigRepository;

  // Business Logic Services
  private static pushNotificationService?: PushNotificationService;
  private static notificationService?: NotificationService;
  private static helperService?: HelperService;
  private static systemConfigService?: SystemConfigService;
  private static walletService?: WalletService;
  private static providerService?: ProviderService;
  private static gameTopupService?: GameTopupService;

  private static depositService?: DepositService;
  private static paymentReconciliationService?: PaymentReconciliationService;
  private static socialAuthService?: SocialAuthService;
  private static channelIdentityRepository?: ChannelIdentityRepository;
  private static telegramService?: TelegramService;




  // BASE SERVICES
  static getTransactionStateValidator(): TransactionStateValidator {
    return getTransactionStateValidator();
  }
  static getCacheService(): CacheService {
    if (!this.cacheService) {
      this.cacheService = new CacheService();
    }
    return this.cacheService;
  }

  static getBiometricService(): BiometricService {
    if (!this.biometricService) {
      this.biometricService = new BiometricService();
    }
    return new BiometricService();
  }

  static getDeviceCredentialRepository(): DeviceCredentialRepository {
    if (!this.deviceCredentialRepository) {
      this.deviceCredentialRepository = new DeviceCredentialRepository();
    }
    return this.deviceCredentialRepository;
  }

  static getBiometricV2Service(): BiometricV2Service {
    if (!this.biometricV2Service) {
      this.biometricV2Service = new BiometricV2Service(
        this.getUserRepository(),
        this.getDeviceCredentialRepository(),
        this.getCacheService(),
      );
    }
    return this.biometricV2Service;
  }



  static getEmailService(): EmailService {
    if (!this.emailService) {
      this.emailService = new EmailService();
    }
    return this.emailService;
  }

  static getSMSService(): SMSService {
    if (!this.smsService) {
      this.smsService = new SMSService();
    }
    return this.smsService;
  }

  static getOTPService(): OTPService {
    if (!this.otpService) {
      this.otpService = new OTPService(this.getCacheService());
    }
    return this.otpService;
  }

  // PAYMENT GATEWAY SERVICES
  static getSaveHavenService(): SaveHavenService {
    if (!this.saveHavenService) {
      this.saveHavenService = withProviderMonitoring(
        new SaveHavenService(),
        "savehaven",
        "payment_gateway",
      );
    }
    return this.saveHavenService;
  }

  static getXixapayService(): XixapayService {
    if (!this.xixapayService) {
      this.xixapayService = withProviderMonitoring(
        new XixapayService(),
        "xixapay",
        "payment_gateway",
      );
    }
    return this.xixapayService;
  }

  static getMonnifyService(): MonnifyService {
    if (!this.monnifyService) {
      this.monnifyService = withProviderMonitoring(
        new MonnifyService(),
        "monnify",
        "payment_gateway",
      );
    }
    return this.monnifyService;
  }

  static getFlutterwaveService(): FlutterwaveService {
    if (!this.flutterwaveService) {
      this.flutterwaveService = withProviderMonitoring(
        new FlutterwaveService(),
        "flutterwave",
        "payment_gateway",
      );
    }
    return this.flutterwaveService;
  }



  static getProviderReconciliationService(): ProviderReconciliationService {
    if (!this.providerReconciliationService) {
      this.providerReconciliationService = new ProviderReconciliationService(
        this.getSaveHavenService(),
        this.getMonnifyService(),
        this.getFlutterwaveService(),
        this.getAuditLoggingService(),
        this.getEmailService(),
      );
    }
    return this.providerReconciliationService;
  }

  static getNigeriaSmmService(): NigeriaSmmService {
    if (!this.nigeriaSmmService) {
      this.nigeriaSmmService = new NigeriaSmmService();
    }
    return this.nigeriaSmmService;
  }

  static getSmmFollowsService(): SmmFollowsService {
    if (!this.smmFollowsService) {
      this.smmFollowsService = new SmmFollowsService();
    }
    return this.smmFollowsService;
  }

  static getSmmResellerPanelService(): SmmResellerPanelService {
    if (!this.smmResellerPanelService) {
      this.smmResellerPanelService = new SmmResellerPanelService();
    }
    return this.smmResellerPanelService;
  }

  static getOwletService(): OwletService {
    if (!this.owletService) {
      this.owletService = new OwletService();
    }
    return this.owletService;
  }

  static getFiveSimService(): FiveSimService {
    if (!this.fiveSimService) {
      this.fiveSimService = new FiveSimService();
    }
    return this.fiveSimService;
  }

  static getFleexaService(): FleexaService {
    if (!this.fleexaService) {
      this.fleexaService = new FleexaService();
    }
    return this.fleexaService;
  }

  static getTextverifiedService(): TextverifiedService {
    if (!this.textverifiedService) {
      this.textverifiedService = new TextverifiedService();
    }
    return this.textverifiedService;
  }

  static getSmmService(): SmmService {
    if (!this.smmService) {
      this.smmService = new SmmService(
        this.getWalletService(),
        this.getHelperService(),
        this.getProviderService(),
      );
    }
    return this.smmService;
  }

  static getAuditLoggingService(): AuditLoggingService {
    if (!this.auditLoggingService) {
      this.auditLoggingService = new AuditLoggingService(
        new AuditLogRepository(),
      );
    }
    return this.auditLoggingService;
  }

  static getWebhookDeliveryService(): WebhookDeliveryService {
    if (!this.webhookdeliveryService) {
      this.webhookdeliveryService = new WebhookDeliveryService(
        this.getWalletService(),
        this.getAuditLoggingService(),
        this.getNotificationService(),
      );
    }
    return this.webhookdeliveryService;
  }
  // REPOSITORIES

  static getTransactionRepository(): TransactionRepository {
    if (!this.transactionRepository) {
      this.transactionRepository = new TransactionRepository();
    }
    return this.transactionRepository;
  }

  static getManualWithdrawalRepository(): ManualWithdrawalRepository {
    if (!this.manualWithdrawalRepository) {
      this.manualWithdrawalRepository = new ManualWithdrawalRepository();
    }
    return this.manualWithdrawalRepository;
  }

  static getBankAccountRepository(): BankAccountRepository {
    if (!this.bankAccountRepository) {
      this.bankAccountRepository = new BankAccountRepository();
    }
    return this.bankAccountRepository;
  }

  static getWalletRepository(): WalletRepository {
    if (!this.walletRepository) {
      this.walletRepository = new WalletRepository();
    }
    return this.walletRepository;
  }

  static getUserRepository(): UserRepository {
    if (!this.userRepository) {
      this.userRepository = new UserRepository();
    }
    return this.userRepository;
  }

  static getAdminRepository(): AdminRepository {
    if (!this.adminRepository) {
      this.adminRepository = new AdminRepository();
    }
    return this.adminRepository;
  }

  static getNotificationRepository(): NotificationRepository {
    if (!this.notificationRepository) {
      this.notificationRepository = new NotificationRepository();
    }
    return this.notificationRepository;
  }

  static getServiceChargeRepository(): ServiceChargeRepository {
    if (!this.serviceChargeRepository) {
      this.serviceChargeRepository = new ServiceChargeRepository();
    }
    return this.serviceChargeRepository;
  }


  static getBankRepository(): BankRepository {
    if (!this.bankRepository) {
      this.bankRepository = new BankRepository();
    }
    return this.bankRepository;
  }

  static getVirtualAccountRepository(): VirtualAccountRepository {
    if (!this.virtualAccountRepository) {
      this.virtualAccountRepository = new VirtualAccountRepository();
    }
    return this.virtualAccountRepository;
  }

  static getReferralRepository(): ReferralRepository {
    if (!this.referralRepository) {
      this.referralRepository = new ReferralRepository();
    }
    return this.referralRepository;
  }

  static getCountryRepository(): CountryRepository {
    if (!this.countryRepository) {
      this.countryRepository = new CountryRepository();
    }
    return this.countryRepository;
  }

  static getStateRepository(): StateRepository {
    if (!this.stateRepository) {
      this.stateRepository = new StateRepository();
    }
    return this.stateRepository;
  }

  static getCityRepository(): CityRepository {
    if (!this.cityRepository) {
      this.cityRepository = new CityRepository();
    }
    return this.cityRepository;
  }

  static getProviderRepository(): ProviderRepository {
    if (!this.providerRepository) {
      this.providerRepository = new ProviderRepository();
    }
    return this.providerRepository;
  }

  static getServiceRepository(): ServiceRepository {
    if (!this.serviceRepository) {
      this.serviceRepository = new ServiceRepository();
    }
    return this.serviceRepository;
  }

  static getProductRepository(): ProductRepository {
    if (!this.productRepository) {
      this.productRepository = new ProductRepository();
    }
    return this.productRepository;
  }

  static getBannerRepository(): BannerRepository {
    if (!this.bannerRepository) {
      this.bannerRepository = new BannerRepository();
    }
    return this.bannerRepository;
  }

  static getSystemBankAccountRepository(): SystemBankAccountRepository {
    if (!this.systemBankAccountRepository) {
      this.systemBankAccountRepository = new SystemBankAccountRepository();
    }
    return this.systemBankAccountRepository;
  }

  static getServiceTypeRepository(): ServiceTypeRepository {
    if (!this.serviceTypeRepository) {
      this.serviceTypeRepository = new ServiceTypeRepository();
    }
    return this.serviceTypeRepository;
  }

  static getAppVersionRepository(): AppVersionRepository {
    if (!this.appVersionRepository) {
      this.appVersionRepository = new AppVersionRepository();
    }
    return this.appVersionRepository;
  }

  static getCashbackRuleRepository(): CashbackRuleRepository {
    if (!this.cashbackRuleRepository) {
      this.cashbackRuleRepository = new CashbackRuleRepository();
    }
    return this.cashbackRuleRepository;
  }

  static getReferralTermsRepository(): ReferralTermsRepository {
    if (!this.referralTermsRepository) {
      this.referralTermsRepository = new ReferralTermsRepository();
    }
    return this.referralTermsRepository;
  }


  static getFAQRepository(): FAQRepository {
    if (!this.faqRepository) {
      this.faqRepository = new FAQRepository();
    }
    return this.faqRepository;
  }

  static getFaqCategoryRepository(): FaqCategoryRepository {
    if (!this.faqCategoryRepository) {
      this.faqCategoryRepository = new FaqCategoryRepository();
    }
    return this.faqCategoryRepository;
  }

  static getDepositRequestRepository(): DepositRequestRepository {
    if (!this.depositRequestRepository) {
      this.depositRequestRepository = new DepositRequestRepository();
    }
    return this.depositRequestRepository;
  }

  static getDepositRepository(): DepositRepository {
    if (!this.depositRepository) {
      this.depositRepository = new DepositRepository();
    }
    return this.depositRepository;
  }


  static getProviderRateConfigRepository(): ProviderRateConfigRepository {
    if (!this.providerRateConfigRepository) {
      this.providerRateConfigRepository = new ProviderRateConfigRepository();
    }
    return this.providerRateConfigRepository;
  }

  // LEVEL 1 SERVICES

  static getPushNotificationService(): PushNotificationService {
    if (!this.pushNotificationService) {
      this.pushNotificationService = new PushNotificationService(
        this.getUserRepository(),
      );
    }
    return this.pushNotificationService;
  }


  static getProviderService(): ProviderService {
    if (!this.providerService) {
      this.providerService = new ProviderService(
        this.getNigeriaSmmService(),
        this.getCacheService(),
        this.getSaveHavenService(),
        this.getOwletService(),
        this.getSmmFollowsService(),
        this.getSmmResellerPanelService(),
        this.getFiveSimService(),
        this.getFleexaService(),
        this.getTextverifiedService(),
      );
    }
    return this.providerService;
  }

  static getProxyService(): ProxyService {
    if (!this.proxyService) {
      this.proxyService = new ProxyService(
        this.getWalletService(),
        this.getHelperService(),
        this.getProviderService(),
      );
    }
    return this.proxyService;
  }

  static getNumberRentalService(): NumberRentalService {
    if (!this.numberRentalService) {
      this.numberRentalService = new NumberRentalService(
        this.getWalletService(),
        this.getHelperService(),
        this.getProviderService(),
      );
    }
    return this.numberRentalService;
  }

  static getEmailOtpService(): EmailOtpService {
    if (!this.emailOtpService) {
      this.emailOtpService = new EmailOtpService(
        this.getWalletService(),
        this.getHelperService(),
        this.getProviderService(),
        this.getCacheService(),
      );
    }
    return this.emailOtpService;
  }

  static getChannelIdentityRepository(): ChannelIdentityRepository {
    if (!this.channelIdentityRepository) {
      this.channelIdentityRepository = new ChannelIdentityRepository();
    }
    return this.channelIdentityRepository;
  }

  static getTelegramService(): TelegramService {
    if (!this.telegramService) {
      this.telegramService = new TelegramService(
        this.getChannelIdentityRepository(),
        this.getWalletService(),
        this.getCacheService(),
      );
    }
    return this.telegramService;
  }

  static getGameTopupService(): GameTopupService {
    if (!this.gameTopupService) {
      this.gameTopupService = new GameTopupService(
        this.getWalletService(),
        this.getHelperService(),
        this.getProviderService(),
      );
    }
    return this.gameTopupService;
  }

  // LEVEL 2 SERVICES

  static getNotificationService(): NotificationService {
    if (!this.notificationService) {
      this.notificationService = new NotificationService(
        this.getEmailService(),
        this.getSMSService(),
        this.getPushNotificationService(),
        this.getNotificationRepository(),
        this.getUserRepository(),
        this.getAdminRepository(),
      );
    }
    return this.notificationService;
  }

  static getHelperService(): HelperService {
    if (!this.helperService) {
      this.helperService = new HelperService(
        this.getCacheService(),
        this.getServiceChargeRepository(),
      );
    }
    return this.helperService;
  }

  static getSystemConfigService(): SystemConfigService {
    if (!this.systemConfigService) {
      this.systemConfigService = new SystemConfigService(
        this.getCacheService(),
      );
    }
    return this.systemConfigService;
  }



  // LEVEL 3 SERVICES

  static getWalletService(): WalletService {
    if (!this.walletService) {
      this.walletService = new WalletService(
        this.getWalletRepository(),
        this.getCacheService(),
        this.getTransactionRepository(),
        this.getUserRepository(),
        this.getNotificationService(),
        this.getHelperService(),
        this.getSystemConfigService(),
        this.getAuditLoggingService(),
      );
    }
    return this.walletService;
  }

  static getDepositService(): DepositService {
    if (!this.depositService) {
      this.depositService = new DepositService(
        this.getDepositRepository(),
        this.getDepositRequestRepository(),
        this.getVirtualAccountRepository(),
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getEmailService(),
        this.getHelperService(),
      );
    }
    return this.depositService;
  }

  static getPaymentReconciliationService(): PaymentReconciliationService {
    if (!this.paymentReconciliationService) {
      this.paymentReconciliationService = new PaymentReconciliationService(
        this.getFlutterwaveService(),
        this.getMonnifyService(),
        this.getSaveHavenService(),
        this.getEmailService(),
        this.getAuditLoggingService(),
        this.getWalletService(),
      );
    }
    return this.paymentReconciliationService;
  }


  static getSocialAuthService(): SocialAuthService {
    if (!this.socialAuthService) {
      this.socialAuthService = new SocialAuthService(
        this.getUserRepository(),
        this.getWalletRepository(),
        this.getCacheService(),
        this.getEmailService(),
      );
    }
    return this.socialAuthService;
  }


  static getAuthService(): AuthService {
    return new AuthService(
      this.getOTPService(),
      this.getEmailService(),
      this.getSMSService(),
      this.getUserRepository(),
      this.getWalletRepository(),
      this.getCacheService(),
      this.getReferralRepository(),
      this.getBiometricService(),
      this.getStateRepository(),
      this.getCountryRepository(),
    );
  }

  static getBankAccountService(): BankAccountService {
    return new BankAccountService(
      this.getBankAccountRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getXixapayService(),
      this.getBankRepository(),
    );
  }

  static getFAQService(): FAQService {
    return new FAQService(
      this.getFAQRepository(),
      this.getFaqCategoryRepository(),
    );
  }


  static getIdentityVerificationService(): IdentityVerificationService {
    return new IdentityVerificationService(
      this.getWalletRepository(),
      this.getCacheService(),
      this.getTransactionRepository(),
      this.getUserRepository(),
      this.getVirtualAccountRepository(),
      this.getNotificationRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getProviderRepository(),
      this.getVirtualAccountService(),
    );
  }

  static getPaymentService(): PaymentService {
    return new PaymentService(
      this.getWalletService(),
      this.getNotificationRepository(),
      this.getSaveHavenService(),
      this.getHelperService(),
      this.getMonnifyService(),
      this.getFlutterwaveService(),
      this.getXixapayService(),
      this.getProviderService(),
      this.getWalletRepository(),
      this.getVirtualAccountRepository(),
      this.getCacheService(),
      this.getBankRepository(),
      this.getSystemBankAccountRepository(),
    );
  }

  static getProfileService(): ProfileService {
    return new ProfileService(this.getUserRepository(), this.getCacheService());
  }

  static getReferenceDataService(): ReferenceDataService {
    return new ReferenceDataService(
      this.getCountryRepository(),
      this.getStateRepository(),
      this.getCityRepository(),
      this.getProviderRepository(),
      this.getServiceRepository(),
      this.getProductRepository(),
      this.getBankAccountRepository(),
      this.getSaveHavenService(),
      this.getBankRepository(),
      this.getBannerRepository(),
      this.getServiceChargeRepository(),
      this.getSystemBankAccountRepository(),
      this.getServiceTypeRepository(),
      this.getAppVersionRepository(),
      this.getCashbackRuleRepository(),
        this.getEmailService(),
      this.getCacheService(),
    );
  }

  static getReferralService(): ReferralService {
    return new ReferralService(
      this.getReferralRepository(),
      this.getUserRepository(),
      this.getWalletService(),
      this.getCacheService(),
      this.getReferralTermsRepository(),
    );
  }

  static getTransactionService(): TransactionService {
    return new TransactionService(
      this.getTransactionRepository(),
      this.getWalletRepository(),
    );
  }


  static getVirtualAccountService(): VirtualAccountService {
    return new VirtualAccountService(
      this.getVirtualAccountRepository(),
      this.getUserRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getXixapayService(),
      this.getCacheService(),
    );
  }

  static getWithdrawalService(): WithdrawalService {
    return new WithdrawalService(
      this.getBankAccountRepository(),
      this.getWalletRepository(),
      this.getNotificationService(),
      this.getEmailService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getBankRepository(),
      this.getSaveHavenService(),
      this.getHelperService(),
      this.getMonnifyService(),
      this.getFlutterwaveService(),
      this.getXixapayService(),
      this.getWalletService(),
      this.getManualWithdrawalRepository(),
    );
  }

  static getTransactionPollingService(): TransactionPollingService {
    return new TransactionPollingService(
      this.getTransactionRepository(),
      this.getNigeriaSmmService(),
      this.getWalletService(),
      this.getNotificationService(),
      this.getEmailService(),
      this.getAuditLoggingService(),
      this.getUserRepository(),
    );
  }

  static getUserTierProgressionService(): UserTierProgressionService {
    return new UserTierProgressionService(
      this.getCacheService(),
      this.getNotificationService(),
    );
  }
}

export default ServiceContainer;