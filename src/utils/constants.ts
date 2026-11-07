export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  LOCKED: 423,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE_ENTRY: "DUPLICATE_ENTRY",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  TWO_FA_REQUIRED: "TWO_FA_REQUIRED",
  WALLET_LOCKED: "WALLET_LOCKED",
  PROFILE_INCOMPLETE: "PROFILE_INCOMPLETE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_IN_USE: "RESOURCE_IN_USE",
  THIRD_PARTY_ERROR: "THIRD_PARTY_ERROR",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  INVALID_PROVIDER: "INVALID_PROVIDER",
  DATABASE_ERROR: "DATABASE_ERROR",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INVALID_PIN: "INVALID_PIN",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  BAD_REQUEST: "BAD_REQUEST",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  INVALID_STATUS: "INVALID_STATUS",
  INVALID_OPERATION: "INVALID_OPERATION",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  INVALID_PAYMENT_METHOD: "INVALID_PAYMENT_METHOD",
  CANNOT_DELETE_WITH_PENDING_TRANSACTIONS:
    "CANNOT_DELETE_WITH_PENDING_TRANSACTIONS",
  INVALID_REFERRAL_CODE: "INVALID_REFERRAL_CODE",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  ACCOUNT_RESTRICTED: "ACCOUNT_RESTRICTED",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
} as const;


export const CACHE_KEYS = {
  EMAIL_BANNERS: "email_banners",
  CHAT_SESSION: (channel: string, externalId: string) => `chat:session:${channel}:${externalId}`,
  USER_PROFILE: (userId: string) => `user:profile:${userId}`,
  USER_WALLET: (userId: string) => `user:wallet:${userId}`,
  PIN_ATTEMPTS: (userId: string) => `pin:attempts:${userId}`,
  PIN_LOCKOUT: (userId: string) => `pin:lockout:${userId}`,
  OTP: (identifier: string) => `otp:${identifier}`,
  TOKEN_BLACKLIST: (token: string) => `token:blacklist:${token}`,
  RATE_LIMIT: (ip: string, route: string) => `ratelimit:${ip}:${route}`,
  OTP_REGISTRATION: (email: string) => `otp:registration:${email}`,
  OTP_PASSWORD_RESET: (email: string) => `otp:password_reset:${email}`,
  VENDOR_PROFILE: (vendorId: string) => `vendor:profile:${vendorId}`,
  KMS_PENDING_TX: (transactionId: string) => `kms:pending:${transactionId}`,
  REFRESH_TOKEN: (tokenId: string) => `refresh_token:${tokenId}`,
  BLACKLISTED_TOKEN: (tokenId: string) => `blacklist:token:${tokenId}`,
  BLACKLISTED_RESET_TOKEN: (tokenId: string) => `blacklist:token:${tokenId}`,
  ADMIN_REFRESH_TOKEN: (adminId: string, family: string, generation: number) =>
    `admin:refresh_token:${adminId}:${family}:${generation}`,

  ADMIN_REFRESH_USED: (tokenId: string) => `admin:refresh_used:${tokenId}`,

  ADMIN_BLACKLIST_FAMILY: (family: string) =>
    `admin:blacklist_family:${family}`,

  ADMIN_TOKEN_METADATA: (tokenId: string) => `admin:token_meta:${tokenId}`,

  USER_REFRESH_TOKEN: (userId: string, family: string, generation: number) =>
    `user:refresh_token:${userId}:${family}:${generation}`,

  USER_REFRESH_USED: (tokenId: string) => `user:refresh_used:${tokenId}`,

  USER_BLACKLIST_FAMILY: (family: string) => `user:blacklist_family:${family}`,

  // Rate limiting and security
  ADMIN_LOGIN_ATTEMPTS: (email: string) => `admin:login:attempts:${email}`,
  ADMIN_RATE_LIMIT: (adminId: string, action: string) =>
    `admin:rate:${adminId}:${action}`,

  // Session tracking
  ADMIN_ACTIVE_SESSIONS: (adminId: string) => `admin:sessions:${adminId}`,
  ADMIN_LAST_ACTIVITY: (adminId: string) => `admin:activity:${adminId}`,

  // Security alerts and monitoring
  SECURITY_INCIDENT: (adminId: string, type: string) =>
    `security:incident:${adminId}:${type}`,
  SUSPICIOUS_ACTIVITY: (adminId: string) => `security:suspicious:${adminId}`,
  OTP_ATTEMPTS: (email: string, type: string) =>
    `otp_attempts:${type}:${email}`,
  IDENTITY_VALIDATION: "identity:validation",
  BANKS: "banks:all",
  PROVIDERS: "providers:all",
  SERVICES: "services:all",
  PRODUCTS: "products:all",
  COUNTRIES: "countries:all",
  REFERRAL_TERMS: "referral:terms",
  FAQS: "faqs:all",
  FAQ_CATEGORIES: "faq:categories",
  BANNERS: "banners:active",
  SETTINGS: "settings:all",

  // Bill Payment Service Caching
  SERVICE_BY_ID: (serviceId: string) => `service:${serviceId}`,
  SERVICE_BY_CODE: (code: string) => `service:code:${code}`,
  SERVICE_BY_STATUS: (code: string) => `service:status:${code}`,
  SERVICE_WITH_TYPE: (serviceId: string) => `service:with_type:${serviceId}`,
  SERVICES_BY_TYPE_PROVIDER: (typeCode: string, providerId: string) =>
    `services:type:${typeCode}:provider:${providerId}`,
  PRODUCT_BY_ID: (productId: string) => `product:${productId}`,
  PRODUCT_WITH_SERVICE: (productId: string) =>
    `product:with_service:${productId}`,

  PROVIDER_ACTIVE: (serviceTypeCode: string) =>
    `provider:active:${serviceTypeCode}`,
  SERVICES_BY_TYPE: (serviceTypeCode: string) =>
    `services:type:${serviceTypeCode}`,
  PRODUCTS_BY_TYPE: (serviceTypeCode: string) =>
    `products:type:${serviceTypeCode}`,
  PROVIDERS_BY_TYPE: (serviceTypeCode: string) =>
    `providers:type:${serviceTypeCode}`,
  ACTIVE_PROVIDERS_BY_SERVICE_TYPE: (serviceTypeCode: string) =>
    `active_providers:${serviceTypeCode}`,
  PRODUCTS_BY_SERVICE: (serviceId: string, dataType?: string) =>
    `products:service:${serviceId}${dataType ? `:${dataType}` : ""}`,
  DATA_TYPES: "products:data_types",
  DATA_ACTIVE_PROVIDER_IDS: `data:active-provider-ids`,
  DATA_PRODUCTS_ALL_ACTIVE: (serviceId: string, dataType?: string) =>
    `products:data:all-active:${serviceId}${dataType ? `:${dataType}` : ""}`,
  DATA_TYPES_BY_SERVICE_CODE: (serviceCode: string) =>
    `data:types:by-service-code:${serviceCode}`,
  DATA_CATEGORIES_BY_SERVICE_CODE: (serviceCode: string) =>
    `data:categories:by-service-code:${serviceCode}`,

  //SERVICE CHARGE
  SERVICE_CHARGE_BY_CODE: (code: string) => `service_charge:code:${code}`,
  SERVICE_CHARGE_BY_TYPE: (type: string) => `service_charge:type:${type}`,

  SYSTEM_WALLET: "system:wallet",
  SYSTEM_USER: "system:user",

  LOGIN_ATTEMPTS: (identifier: string) => `login:attempts:${identifier}`,
  LOGIN_LOCKOUT: (identifier: string) => `login:lockout:${identifier}`,
} as const;

export const CACHE_TTL = {
  ONE_MINUTE: 60,
  FIVE_MINUTES: 300,
  TEN_MINUTES: 600,
  FIFTEEN_MINUTES: 900,
  THIRTY_MINUTES: 1800,
  ONE_HOUR: 3600,
  ONE_DAY: 86400,
  ONE_WEEK: 604800,
  OTP: 600, // 10 minutes
  USER_PROFILE: 1800, // 30 minutes
  VENDOR_PROFILE: 1800, // 30 minutes
  REFRESH_TOKEN: 2592000, // 30 days
  BLACKLISTED_TOKEN: 1800, // 30 minutes
  RATE_LIMIT: 900, // 15 minutes
  LOGIN_ATTEMPTS: 900, // 15 minutes
  OTP_ATTEMPTS: 3600, // 1 hour
  RESET_TOKEN: 600,

  PIN_ATTEMPTS: 86400, // 24 hours
  PIN_LOCKOUT: 86400, // 24 hours

  DATA_ACTIVE_PROVIDERS: 300, // 5 minutes — reflects provider deactivation quickly
  DATA_PRODUCTS: 900,

  // Bill Payment Service Cache TTLs
  SERVICE: 1800, // 30 minutes (services rarely change)
  PRODUCT: 900, // 15 minutes (products/pricing may change more often)
  SERVICE_LIST: 1800, // 30 minutes
  PRODUCT_LIST: 900, // 15 minutes


  //SERVICE CHARGE
  SERVICE_CHARGE: 3600,

  SYSTEM_WALLET: 3600,

} as const;

export const TRANSACTION_STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILED: "failed",
  REVERSED: "reversed",
  PROCESSING: "processing",
  PENDING_MANUAL: "pending_manual",
} as const;

export const WALLET_TYPES = {
  MAIN: "main",
  BONUS: "bonus",
  COMMISSION: "commission",
} as const;

export const USER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;

export const TRANSACTION_TYPES = {
  // SMM & Digital Services
  SMM: "smm",

  // ---- Owlet modules ----
  // Gamerzone: game top-up (ML Diamonds, PUBG UC, Free Fire) or gaming cards
  GAME_TOPUP: "game_topup",
  // Talktiyu: rent a virtual phone number to receive an OTP/verification SMS
  NUMBER_RENTAL: "number_rental",
  // Rhombus: proxy purchases
  PROXY: "proxy",
  // Fleexa: temporary disposable email addresses for OTP verification
  EMAIL_OTP: "email_otp",

  WALLET_TRANSFER: "wallet_transfer",
  WALLET_CREDIT: "wallet_credit",
  WALLET_DEBIT: "wallet_debit",
  SERVICE_CHARGE: "service_charge",
  SYSTEM_REVENUE: "system_revenue",

  WITHDRAWAL: "withdrawal",
  STAMP_DUTY: "withdrawal_stamp_duty",
  DEPOSIT: "deposit",
  VIRTUAL_ACCOUNT: "virtual_account",

  REFUND: "refund",
  REFERRAL_COMMISSION: "referral_commission",

  CASHBACK_EARNED: "cashback_earned",
  CASHBACK_SPENT: "cashback_spent",
} as const;

export type TransactionType =
  (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

export const TRANSACTION_CATEGORIES = {
  SERVICE_TRANSACTIONS: [
    TRANSACTION_TYPES.SMM,
    TRANSACTION_TYPES.GAME_TOPUP,
    TRANSACTION_TYPES.NUMBER_RENTAL,
    TRANSACTION_TYPES.PROXY,
    TRANSACTION_TYPES.EMAIL_OTP,
  ],

  OTHER_TRANSACTIONS: [],

  WALLET_OPERATIONS: [
    TRANSACTION_TYPES.WALLET_CREDIT,
    TRANSACTION_TYPES.WALLET_DEBIT,
    TRANSACTION_TYPES.WALLET_TRANSFER,
  ],

  BANKING_OPERATIONS: [
    TRANSACTION_TYPES.DEPOSIT,
    TRANSACTION_TYPES.WITHDRAWAL,
    TRANSACTION_TYPES.WALLET_TRANSFER,
  ],

  FINANCIAL_OPERATIONS: [
    TRANSACTION_TYPES.WALLET_CREDIT,
    TRANSACTION_TYPES.WALLET_DEBIT,
    TRANSACTION_TYPES.WALLET_TRANSFER,
    TRANSACTION_TYPES.DEPOSIT,
    TRANSACTION_TYPES.WITHDRAWAL,
  ],

  REFUNDS: [TRANSACTION_TYPES.REFUND],
} as const;

// Alias kept so TransactionService.ts filter still compiles;
// points at the 4 active service types (replaces old bill-payment list)
export const BILL_PAYMENT_TYPES = [
  TRANSACTION_TYPES.SMM,
  TRANSACTION_TYPES.GAME_TOPUP,
  TRANSACTION_TYPES.NUMBER_RENTAL,
  TRANSACTION_TYPES.PROXY,
  TRANSACTION_TYPES.EMAIL_OTP,
] as const;

export const WALLET_OPERATION_TYPES = [
  TRANSACTION_TYPES.WITHDRAWAL,
  TRANSACTION_TYPES.STAMP_DUTY,
  TRANSACTION_TYPES.WALLET_TRANSFER,
  TRANSACTION_TYPES.WALLET_CREDIT,
  TRANSACTION_TYPES.WALLET_DEBIT,
] as const;

// Direction mapping for wallet operations
export const WALLET_OPERATION_DIRECTIONS = {
  [TRANSACTION_TYPES.DEPOSIT]: "CREDIT",
  [TRANSACTION_TYPES.WITHDRAWAL]: "DEBIT",
  [TRANSACTION_TYPES.STAMP_DUTY]: "DEBIT",
  [TRANSACTION_TYPES.WALLET_TRANSFER]: "CREDIT",
} as const;

export const PRODUCT_ATTRIBUTES = {
  DATA_TYPES: [
    "SME",
    "SME2",
    "GIFTING",
    "DIRECT",
    "AWOOF DATA",
    "CORPORATE GIFTING",
    "DIRECT COUPON",
    "SOCIAL",
    "NIGHT",
    "WEEKEND",
    "BROADBAND",
    "ALWAYSON",
    "SPECIAL",
  ] as const,
  PRODUCT_TYPES: [
    "SME",
    "SME2",
    "GIFTING",
    "DIRECT",
    "AWOOF DATA",
    "CORPORATE GIFTING",
    "DIRECT COUPON",
    "SOCIAL",
    "NIGHT",
    "WEEKEND",
    "BROADBAND",
    "ALWAYSON",
    "SPECIAL",
  ] as const,
  VALIDITY_PERIOD_NAMES: ["daily", "weekly", "monthly", "yearly"] as const,
  DATA_CATEGORIES: [
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "night",
    "social",
    "broadband",
    "alwayson",
    "weekend",
    "other",
  ] as const,
  VALIDITY_PERIOD_DAYS: [1, 2, 3, 7, 14, 30, 60, 90] as const,
  METER_TYPES: ["prepaid", "postpaid"] as const,
} as const;

export type DataType = (typeof PRODUCT_ATTRIBUTES.DATA_TYPES)[number];

export type DataCategory = (typeof PRODUCT_ATTRIBUTES.DATA_CATEGORIES)[number];

export type ProductType = (typeof PRODUCT_ATTRIBUTES.PRODUCT_TYPES)[number];

export const SYSTEM = {
  PROVIDER: process.env.APP_NAME,
} as const;
export type SystemProvider =
  | typeof SYSTEM.PROVIDER
  | "user"
  | "system"
  | "admin";

export type ValidityPeriod =
  | (typeof PRODUCT_ATTRIBUTES.VALIDITY_PERIOD_NAMES)[number]
  | (typeof PRODUCT_ATTRIBUTES.VALIDITY_PERIOD_DAYS)[number];

export type MeterType = (typeof PRODUCT_ATTRIBUTES.METER_TYPES)[number];

export const isServiceTransaction = (type: string): boolean => {
  return TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS.includes(type as any);
};

export const isWalletOperation = (type: string): boolean => {
  return TRANSACTION_CATEGORIES.WALLET_OPERATIONS.includes(type as any);
};

export const isBankingOperation = (type: string): boolean => {
  return TRANSACTION_CATEGORIES.BANKING_OPERATIONS.includes(type as any);
};

export const ALL_TRANSACTION_TYPES = Object.values(TRANSACTION_TYPES);



export const TRANSACTION_LIMITS = {
  MAX_DEPOSIT_AMOUNT: 5_000_000,     // ₦5,000,000
  MAX_WITHDRAWAL_AMOUNT: 2_500_000,  // ₦2,500,000
};

export const STAMP_DUTY = {
  WITHDRAWAL_THRESHOLD: 10_000,                  // ₦10,000 — CBN/FIRS EMTL threshold
  SERVICE_CHARGE_CODE: "withdrawal_stamp_duty",  // admin-configurable via existing ServiceCharge CRUD
  DEFAULT_AMOUNT: 50,                            // ₦50 flat fallback if no ServiceCharge record seeded yet
};

// PARTNERS
export const MAX_PARTNER_TRANSACTION_AMOUNT = 1_000_000;
