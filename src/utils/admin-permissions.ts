export const ADMIN_PERMISSIONS = {
  // All permission
  ALL: {
    GRANT_ALL: "*",
  },
  // Admin management permissions
  ADMIN: {
    VIEW: "admin.view",
    CREATE: "admin.create",
    UPDATE: "admin.update",
    DELETE: "admin.delete",
    ADMIN_STATS: "admin.admin_stats",
  },
  // User management permissions
  USERS: {
    VIEW: "users.view",
    UPDATE: "users.update",
    SUSPEND_UNSUSPEND: "users.suspend",
    MANAGE_WALLET: "users.manage_wallet",
    VIEW_BVN: "users.view_bvn",
  },

  ROLES: {
    VIEW: "roles.view",
    CREATE: "roles.create",
    UPDATE: "roles.update",
    DELETE: "roles.delete",
    MANAGE: "roles.manage",
  },

  // Transaction permissions
  TRANSACTIONS: {
    VIEW: "transactions.view",
    UPDATE: "transactions.update",
    REVERSE: "transactions.reverse",
    EXPORT: "transactions.export",
  },

  // Finance permissions
  FINANCE: {
    VIEW_DEPOSITS: "finance.view_deposits",
    APPROVE_DEPOSITS: "finance.approve_deposits",
    VIEW_WITHDRAWALS: "finance.view_withdrawals",
    APPROVE_WITHDRAWALS: "finance.approve_withdrawals",
  },



  REFERRAL_TERMS: {
    VIEW: "referral_terms.view",
    CREATE: "referral_terms.create",
    UPDATE: "referral_terms.update",
    DELETE: "referral_terms.delete",
  },

  ALERTS: {
    VIEW: "alerts.view",
    CREATE: "alerts.create",
    UPDATE: "alerts.update",
    DELETE: "alerts.delete",
  },

  BANNERS: {
    VIEW: "banners.view",
    CREATE: "banners.create",
    UPDATE: "banners.update",
    DELETE: "banners.delete",
  },

  EMAIL_BANNERS: {
    VIEW: "email_banners.view",
    UPDATE: "email_banners.update",
  },

  FAQS: {
    VIEW: "faqs.view",
    CREATE: "faqs.create",
    UPDATE: "faqs.update",
    DELETE: "faqs.delete",

    VIEW_CATEGORIES: "faqs_categories.view",
    CREATE_CATEGORIES: "faqs_categories.create",
    UPDATE_CATEGORIES: "faqs_categories.update",
    DELETE_CATEGORIES: "faqs_categories.delete",
  },
  // Settings permissions
  SETTINGS: {
    VIEW: "settings.view",
    UPDATE: "settings.update",
    UPDATE_CONTACT_SUPPORT: "settings.update_contact_support",
    MANAGE_REFERRAL_BONUS: "settings.manage_referral_bonus",
  },
  SYSTEM_BANK_ACCOUNTS: {
    VIEW: "system_bank_accounts.view",
    CREATE: "system_bank_accounts.create",
    UPDATE: "system_bank_accounts.update",
    DELETE: "system_bank_accounts.delete",
  },

  SERVICE_CHARGES: {
    VIEW: "service_charges.view",
    UPDATE: "service_charges.update",
  },



  CASHBACKS: {
    VIEW: "cashbacks.view",
    CREATE: "cashbacks.create",
    UPDATE: "cashbacks.update",
    DELETE: "cashbacks.delete",
  },

  // Discount permissions
  DISCOUNTS: {
    VIEW: "discounts.view",
    CREATE: "discounts.create",
    UPDATE: "discounts.update",
    DELETE: "discounts.delete",
  },

  APP_VERSIONS: {
    VIEW: "app_versions.view",
    CREATE: "app_versions.create",
    UPDATE: "app_versions.update",
    DELETE: "app_versions.delete",
  },
  // System permissions
  SYSTEM: {
    MANAGE_PROVIDERS: "system.manage_providers",
    MANAGE_SERVICES: "system.manage_services",
    MANAGE_PRODUCTS: "system.manage_products",
    SYNC_PROVIDERS: "system.sync_providers",
  },
  CONFIG: {
    VIEW: "config.view",
    UPDATE: "config.update",
  },
  PARTNERS: {
    VIEW: "partners.view",
    APPROVE_SUSPEND: "partners.approve_suspend",
    MANAGE_API_KEYS: "partners.manage_api_keys",
  },
  // // Audit permissions
  // AUDIT: {
  //   VIEW: "audit.view",
  //   EXPORT: "audit.export",
  // },
  SECURITY: {
    VIEW_DEVICE_REQUESTS: "security.view_device_requests",
    APPROVE_DEVICE_REQUESTS: "security.approve_device_requests",
    MANAGE_IP_ALLOWLIST: "security.manage_ip_allowlist",
    MANAGE_IP_BLOCKLIST: "security.manage_ip_blocklist",
    VIEW_DEVICE_TRUST: "security.view_device_trust",
  },

} as const;

// Extract all permission values for validation
export type AdminPermission =
  | (typeof ADMIN_PERMISSIONS.ALL)[keyof typeof ADMIN_PERMISSIONS.ALL]
  | (typeof ADMIN_PERMISSIONS.USERS)[keyof typeof ADMIN_PERMISSIONS.USERS]
  | (typeof ADMIN_PERMISSIONS.ADMIN)[keyof typeof ADMIN_PERMISSIONS.ADMIN]
  | (typeof ADMIN_PERMISSIONS.TRANSACTIONS)[keyof typeof ADMIN_PERMISSIONS.TRANSACTIONS]
  | (typeof ADMIN_PERMISSIONS.FINANCE)[keyof typeof ADMIN_PERMISSIONS.FINANCE]
  | (typeof ADMIN_PERMISSIONS.APP_VERSIONS)[keyof typeof ADMIN_PERMISSIONS.APP_VERSIONS]
  | (typeof ADMIN_PERMISSIONS.SETTINGS)[keyof typeof ADMIN_PERMISSIONS.SETTINGS]
  | (typeof ADMIN_PERMISSIONS.SYSTEM)[keyof typeof ADMIN_PERMISSIONS.SYSTEM]
  | (typeof ADMIN_PERMISSIONS.ALERTS)[keyof typeof ADMIN_PERMISSIONS.ALERTS]
  | (typeof ADMIN_PERMISSIONS.ROLES)[keyof typeof ADMIN_PERMISSIONS.ROLES]
  | (typeof ADMIN_PERMISSIONS.DISCOUNTS)[keyof typeof ADMIN_PERMISSIONS.DISCOUNTS]
  | (typeof ADMIN_PERMISSIONS.FAQS)[keyof typeof ADMIN_PERMISSIONS.FAQS]
  | (typeof ADMIN_PERMISSIONS.BANNERS)[keyof typeof ADMIN_PERMISSIONS.BANNERS]
  | (typeof ADMIN_PERMISSIONS.EMAIL_BANNERS)[keyof typeof ADMIN_PERMISSIONS.EMAIL_BANNERS]
  | (typeof ADMIN_PERMISSIONS.ALERTS)[keyof typeof ADMIN_PERMISSIONS.ALERTS]
  | (typeof ADMIN_PERMISSIONS.CASHBACKS)[keyof typeof ADMIN_PERMISSIONS.CASHBACKS]
  | (typeof ADMIN_PERMISSIONS.SERVICE_CHARGES)[keyof typeof ADMIN_PERMISSIONS.SERVICE_CHARGES]
  | (typeof ADMIN_PERMISSIONS.REFERRAL_TERMS)[keyof typeof ADMIN_PERMISSIONS.REFERRAL_TERMS]
  | (typeof ADMIN_PERMISSIONS.CONFIG)[keyof typeof ADMIN_PERMISSIONS.CONFIG]
  | (typeof ADMIN_PERMISSIONS.PARTNERS)[keyof typeof ADMIN_PERMISSIONS.PARTNERS]
  // | (typeof ADMIN_PERMISSIONS.AUDIT)[keyof typeof ADMIN_PERMISSIONS.AUDIT]
  | (typeof ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS)[keyof typeof ADMIN_PERMISSIONS.SYSTEM_BANK_ACCOUNTS]
  | (typeof ADMIN_PERMISSIONS.SECURITY)[keyof typeof ADMIN_PERMISSIONS.SECURITY];

export const ALL_PERMISSIONS = Object.values(ADMIN_PERMISSIONS).flatMap(
  (category) => Object.values(category),
);

// Helper to get all permissions as an array
export const getAllPermissions = (): string[] => {
  const permissions: string[] = [];
  Object.values(ADMIN_PERMISSIONS).forEach((category) => {
    Object.values(category).forEach((permission) => {
      permissions.push(permission);
    });
  });
  return permissions;
};
