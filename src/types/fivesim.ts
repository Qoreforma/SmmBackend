// ============================================================================
// 5SIM — Type Definitions
// ============================================================================

export type FiveSimOrderStatus =
  | "PENDING"
  | "RECEIVED"
  | "CANCELED"
  | "TIMEOUT"
  | "FINISHED"
  | "BANNED";

export interface FiveSimProfileResponse {
  id: number;
  email: string;
  balance: number;
  rating: number;
  default_country?: {
    name: string;
    iso: string;
    prefix: string;
  };
  default_operator?: {
    name: string;
  };
  frozen_balance: number;
  default_forwarding_number?: string;
  vendor?: string;
}

export interface FiveSimCountryItem {
  iso?: Record<string, number>;
  prefix?: Record<string, number>;
  text_en?: string;
  [operator: string]: any;
}

export type FiveSimCountriesResponse = Record<string, FiveSimCountryItem>;

export interface FiveSimProductItem {
  Category: "activation" | "hosting";
  Qty: number;
  Price: number;
}

export type FiveSimProductsResponse = Record<string, FiveSimProductItem>;

export interface FiveSimPriceDetail {
  cost: number;
  count: number;
  rate: number;
}

export interface FiveSimSmsItem {
  id?: number;
  created_at: string;
  date: string;
  sender: string;
  text: string;
  code: string;
}

export interface FiveSimOrderResponse {
  id: number;
  phone: string;
  operator: string;
  product: string;
  price: number;
  status: FiveSimOrderStatus;
  expires: string;
  sms: FiveSimSmsItem[] | null;
  created_at: string;
  forwarding?: boolean;
  forwarding_number?: string;
  country: string;
}

export interface FiveSimInboxSmsItem {
  ID: number;
  created_at: string;
  date: string;
  sender: string;
  text: string;
  code: string;
  is_wave?: boolean;
  wave_uuid?: string;
}

export interface FiveSimInboxResponse {
  Data: FiveSimInboxSmsItem[];
  Total: number;
}

// ============================================================================
// Number Rental — Multi-Provider Normalized Types
// ============================================================================

export interface NumberRentalCountry {
  code: string;
  name: string;
  iso?: string;
  prefix?: string;
}

export interface NumberRentalServiceItem {
  service: string;
  name: string;
  cost: number;
  providerPrice: number;
  availableCount?: number;
  provider: string;
}

export interface RentNumberParams {
  userId: string;
  country: string;
  service: string;
  operator?: string;
  provider?: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface RentNumberResult {
  transaction: any;
  order: {
    reference: string;
    providerOrderId: string;
    number: string;
    status: string;
    service: string;
    country: string;
    provider: string;
    expiresAt?: string;
  };
}

export interface OtpCheckResult {
  status: "received" | "waiting" | "refunded" | "cancelled" | "expired" | "banned" | string;
  number: string;
  code?: string;
  message?: string;
  sms?: Array<{
    sender: string;
    text: string;
    code: string;
    date: string;
  }>;
  completedAt?: Date;
}
