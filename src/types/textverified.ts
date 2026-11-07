// ============================================================================
// Textverified (textverified.com) — Public API v2 Types
// ============================================================================

export interface TextverifiedAuthResponse {
  token: string;
  expiresIn: number;
  expiresAt: string;
}

export interface TextverifiedAccountResponse {
  username: string;
  currentBalance: number;
}

export interface TextverifiedServiceItem {
  serviceName: string;
  description: string | null;
  capability: "sms" | "voice" | "smsAndVoiceCombo" | string;
}

export interface TextverifiedAreaCodeItem {
  areaCode: string;
  state: string;
}

export interface TextverifiedPricingRequest {
  serviceName: string;
  areaCode?: boolean;
  carrier?: boolean;
  numberType?: "mobile" | "voip" | "landline" | string;
  capability?: "sms" | "voice" | "smsAndVoiceCombo" | string;
}

export interface TextverifiedPricingResponse {
  serviceName: string;
  price: number;
}

export interface TextverifiedInventoryRequest {
  serviceName: string;
  numberType?: "mobile" | "voip" | "landline" | string;
  capability?: "sms" | "voice" | "smsAndVoiceCombo" | string;
}

export interface TextverifiedInventoryResponse {
  availableQuantity: number;
}

export interface TextverifiedVerificationRequest {
  serviceName: string;
  capability?: "sms" | "voice" | "smsAndVoiceCombo" | string;
  areaCodeSelectOption?: string[];
  carrierSelectOption?: string[];
  serviceNotListedName?: string | null;
  maxPrice?: number | null;
}

export interface TextverifiedActionLink {
  method: string | null;
  href: string | null;
}

export interface TextverifiedVerificationResponse {
  id: string;
  number: string;
  serviceName: string;
  state:
    | "verificationPending"
    | "verificationCompleted"
    | "verificationCanceled"
    | "verificationTimedOut"
    | "verificationReported"
    | "verificationRefunded"
    | "verificationReused"
    | "verificationReactivated"
    | string;
  totalCost: number;
  createdAt: string;
  endsAt: string;
  cancel?: {
    canCancel: boolean;
    link: TextverifiedActionLink;
  };
  report?: {
    canReport: boolean;
    link: TextverifiedActionLink;
  };
  reuse?: {
    reusableUntil: string | null;
    link: TextverifiedActionLink;
  };
  reactivate?: {
    canReactivate: boolean;
    link: TextverifiedActionLink;
  };
  sms?: TextverifiedActionLink;
  calls?: TextverifiedActionLink;
  sale?: TextverifiedActionLink;
}

export interface TextverifiedSmsItem {
  id: string;
  from: string | null;
  to: string;
  createdAt: string;
  smsContent: string | null;
  parsedCode: string | null;
  encrypted?: boolean;
}

export interface TextverifiedSmsListResponse {
  data: TextverifiedSmsItem[];
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  links: {
    current?: TextverifiedActionLink;
    previous?: TextverifiedActionLink;
    next?: TextverifiedActionLink;
  };
}

export interface TextverifiedWebhookPayload<T = any> {
  id: string;
  event:
    | "v2.sms.received"
    | "v2.reservation.created"
    | "v2.rental.billingcycle.renewed"
    | "v2.rental.billingcycle.expired"
    | "v2.rental.backorder.fulfilled"
    | string;
  occurredAt: string;
  attempt: number;
  idempotencyKey?: string;
  data: T;
}

export interface TextverifiedSmsReceivedWebhookData {
  from: string | null;
  to: string;
  createdAt: string;
  smsContent: string | null;
  parsedCode: string | null;
  encrypted: boolean;
  reservationId: string | null;
}
