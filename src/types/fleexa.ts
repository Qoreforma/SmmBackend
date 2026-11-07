// ============================================================================
// Fleexa (fleexa.com.ng) — Type Definitions
// ============================================================================

export interface FleexaBaseResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error_code?: string;
}

// ----------------------------------------------------------------------------
// Account
// ----------------------------------------------------------------------------

export interface FleexaProfileData {
  id: string;
  name: string;
  username: string;
  email: string;
  user_type: string;
  api_access_enabled: boolean;
  api_key_status: string;
  wallet_balance: string;
  bonus_balance: string;
  currency: string;
  webhook_url?: string | null;
}

export interface FleexaBalanceData {
  balance: string;
  currency: string;
}

// ----------------------------------------------------------------------------
// SMS OTP 4 (US)
// ----------------------------------------------------------------------------

export interface FleexaSms4Country {
  id: string;
  name: string;
  code: string;
  prefix: string;
}

export interface FleexaSms4App {
  id: string;
  name: string;
  service_name?: string;
  api_rate_usd?: string;
  price_usd?: number;
  price_ngn?: string | number;
  quantity?: number;
  qty?: number;
}

export interface FleexaSms4PriceData {
  serviceName: string;
  price_usd: number;
  price_ngn: string;
  pricing_source?: string;
  exchange_rate?: number;
  margin_percent?: number;
}

export interface FleexaSms4BuyData {
  id?: number | string;
  requestId?: number | string;
  phone?: string;
  number?: string;
  activation_id?: string;
  country?: string;
  service?: string;
  expires_at?: string;
  amount_paid?: number;
  status: string;
}

export interface FleexaSms4CheckData {
  code?: "RECEIVED" | "WAITING" | "CANCELED" | "EXPIRED" | string;
  phone?: string;
  number?: string;
  sms_code?: string;
  sms_text?: string;
  sms?: any;
  status?: string;
  canCancel?: boolean;
}

export interface FleexaSms4ReuseCheckData {
  canReuse: boolean;
  canReactivate: boolean;
  priceNgn: number;
  reuseExpiresAt?: string;
}

// ----------------------------------------------------------------------------
// SMS OTP 5 (US)
// ----------------------------------------------------------------------------

export interface FleexaSms5Product {
  id: string;
  name: string;
  price_ngn: string;
  price_usd: number;
  pricing_source?: string;
  quantity: number;
  margin_percent?: number;
  exchange_rate?: number;
}

export interface FleexaSms5App extends FleexaSms5Product {}

export interface FleexaSms5BuyData {
  id?: string | number;
  requestId?: string | number;
  phone?: string;
  number?: string;
  activation_id?: string;
  country?: string;
  service?: string;
  expires_at?: string;
  amount_paid?: number;
  status: string;
}

export interface FleexaSms5CheckData {
  code: "RECEIVED" | "WAITING" | "CANCELED" | "EXPIRED" | string;
  phone?: string;
  number?: string;
  sms_code?: string;
  sms_text?: string;
  sms?: any;
  status: string;
  canCancel?: boolean;
}

// ----------------------------------------------------------------------------
// Email OTP
// ----------------------------------------------------------------------------

export interface FleexaEmailProduct {
  id: string;
  name: string;
  price_ngn: string | number;
  margin_percent?: number;
  exchange_rate?: number;
}

export interface FleexaEmailDomain {
  name: string;
  cost: number;
  price_ngn: string | number;
  count: number;
  margin_percent?: number;
}

export interface FleexaEmailBuyData {
  email: string;
  emailId: string;
  site: string;
  domain: string;
  amount_paid: number;
  status: string;
}

export interface FleexaEmailCheckData {
  code: "WAITING" | "RECEIVED" | "CANCELED" | "EXPIRED" | string;
  sms?: string;
  code_received?: string;
  email?: string;
}

// ----------------------------------------------------------------------------
// Normalized Client Types for Email OTP
// ----------------------------------------------------------------------------

export interface EmailOtpProductItem {
  id: string;
  name: string;
  cost: number;
  providerPrice: number;
  provider: string;
}

export interface EmailOtpDomainItem {
  domain: string;
  cost: number;
  providerPrice: number;
  availableCount: number;
  provider: string;
}

export interface BuyEmailOtpParams {
  userId: string;
  site: string;
  domain: string;
  provider?: string;
  channel?: "ios" | "android" | "web" | "api" | string;
}

export interface BuyEmailOtpResult {
  transaction: any;
  order: {
    reference: string;
    emailId: string;
    email: string;
    site: string;
    domain: string;
    status: string;
    provider: string;
  };
}

export interface EmailOtpCheckResult {
  status: "received" | "waiting" | "cancelled" | "expired" | "refunded" | string;
  email: string;
  code?: string;
  smsText?: string;
  message?: string;
  completedAt?: Date;
}
