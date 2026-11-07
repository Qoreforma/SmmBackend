import { AppError } from "@/middlewares/shared/errorHandler";
import { ERROR_CODES, HTTP_STATUS } from "@/utils/constants";
import logger from "@/logger";
import axios, { AxiosInstance } from "axios";
import { toLocalPhoneFormat } from "@/utils/helpers";

// ─────────────────────────────────────────────────────────────────────────
// Partner bank codes for Xixapay virtual accounts.
// Hardcoded deliberately — only 3 partners exist, not worth a Bank model migration.
// ─────────────────────────────────────────────────────────────────────────
export const XIXAPAY_PARTNER_BANKS = {
  PALMPAY: "20867",
  KOLOMONI_MFB: "20987",
  // SAFEHAVEN: "29007",
  OPAY: "100004"
} as const;

export type XixapayBankName = keyof typeof XIXAPAY_PARTNER_BANKS;

// Resolves which partner bank rail to use for a new dynamic/static virtual account.
// XIXAPAY_DEFAULT_BANK_NAME in .env pins a specific rail (e.g. "PALMPAY").
// If unset or unrecognized, randomizes across the eligible rails for the given
// accountType — so a retry after a failed attempt has a chance of landing on
// a different rail.
//
// OPAY (100004) is dynamic-only per Xixapay's docs (see partner bank table).
// Confirmed in production 2026-07-16: a static request routed to OPAY via
// XIXAPAY_DEFAULT_BANK_NAME=OPAY returned HTTP 201 / status "success" with
// an empty bankAccounts[] and empty errors[] — Xixapay accepts the customer
// but silently never provisions the bank leg, with nothing to catch as an
// error on our side. So OPAY must never be selected for a static request,
// regardless of what XIXAPAY_DEFAULT_BANK_NAME says.
export function selectXixapayBankCode(
  accountType: "static" | "dynamic" = "dynamic",
): string {
  const defaultName = process.env.XIXAPAY_DEFAULT_BANK_NAME?.toUpperCase() as
    | XixapayBankName
    | undefined;

  if (defaultName && XIXAPAY_PARTNER_BANKS[defaultName]) {
    if (accountType === "static" && defaultName === "OPAY") {
      logger.warn(
        "XIXAPAY_DEFAULT_BANK_NAME=OPAY is dynamic-only; falling back to a static-eligible rail for this static account request",
      );
    } else {
      return XIXAPAY_PARTNER_BANKS[defaultName];
    }
  }

  const staticEligibleCodes = [
    XIXAPAY_PARTNER_BANKS.PALMPAY,
    XIXAPAY_PARTNER_BANKS.KOLOMONI_MFB,
  ];
  const codes =
    accountType === "static"
      ? staticEligibleCodes
      : Object.values(XIXAPAY_PARTNER_BANKS);

  return codes[Math.floor(Math.random() * codes.length)];
}

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface XixapayCustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address: string;
  state: string;
  city: string;
  postal_code: string;
  date_of_birth: string; // YYYY-MM-DD
  id_type: "bvn" | "nin";
  id_number: string;
  businessId?: string; // defaults to XIXAPAY_BUSINESS_ID env if omitted
  // TODO: file upload not yet wired — idCardUrl/utilityBillUrl omitted from the
  // actual request until the ImageKit URL pipeline is connected. Accepted here
  // so updateCustomer can pass them through later without a signature change.
  idCardUrl?: string;
  utilityBillUrl?: string;
}

export interface XixapayCustomerResponse {
  customer_name: string;
  customer_email: string;
  customer_id: string;
}

export interface XixapayBankAccount {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  accountType: "static" | "dynamic";
  Reserved_Account_Id?: string;
}

export interface XixapayVirtualAccountResponse {
  status: string;
  message: string;
  customer: {
    customer_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone_number: string;
  };
  business: {
    business_name: string;
    business_email: string;
    business_phone_number: string;
    business_Id: string | null;
  };
  bankAccounts: XixapayBankAccount[];
}

export interface CreateDynamicAccountData {
  email: string;
  name: string;
  phoneNumber: string;
  amount: number;
  bankCode?: string[]; // defaults to [selectXixapayBankCode()] if omitted
  businessId?: string;
  externalReference?: string;
  callbackUrl?: string;
}

export interface CreateStaticAccountWithCustomerIdData {
  customer_id: string;
  bankCode?: string[];
  businessId?: string;
}

export interface CreateStaticAccountWithRawDataData {
  email: string;
  name: string;
  phoneNumber: string;
  id_type: "bvn" | "nin";
  id_number: string;
  bankCode?: string[];
  businessId?: string;
}

export interface UpdateVirtualAccountStatusData {
  accountNumber: string;
  status: "active" | "deactivated";
  reason?: string;
  businessId?: string;
}

export interface XixapayIdentityVerificationResponse {
  status: string;
  message: string;
  data: {
    verification_type: string;
    identity_number: string;
    personal_details: {
      first_name: string;
      middle_name?: string;
      last_name: string;
      full_name?: string | null;
      date_of_birth: string;
      gender?: string;
      nationality?: string;
    };
    contact_details: {
      phone_number?: string;
      phone_number2?: string | null;
      email?: string | null;
    };
    biometric_data?: {
      photo?: string;
      photo_available?: boolean;
    };
    verification_metadata: {
      request_id: string;
      timestamp: string;
      cost_charged: number;
    };
  };
}

export interface InitiatePayoutData {
  amount: number;
  bank: string; // bank code — reuses bank.savehavenCode per existing convention
  accountNumber: string;
  narration?: string;
  businessId?: string;
}

export interface XixapayPayoutResponse {
  status: "success" | "failed";
  message: string;
  reference?: string;
}

export interface VerifyBankAccountData {
  bank: string;
  accountNumber: string;
}

export interface XixapayBankVerificationResponse {
  status: string;
  AccountName: string;
  BankName: string;
}

export interface XixapayBank {
  bankName: string;
  bankCode: string;
}

export interface CreateCardData {
  customer_id: string;
  country: "NG" | "US";
  amount: number;
  businessId?: string;
}

export interface XixapayCardResponse {
  status: string;
  message: string;
  data: {
    card_id: string;
    card_number: string;
    expiry: string;
    cvv: string;
    balance: number;
    currency: string;
  };
}

export interface FundCardData {
  cardId: string;
  amount: number;
  businessId?: string;
}

export interface XixapayFundCardResponse {
  status: string;
  message: string;
  data: {
    card_id: string;
    balance: number;
    currency: string;
    status: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────

export class XixapayService {
  private client: AxiosInstance;
  private businessId: string;

  constructor() {
    const apiKey = process.env.XIXAPAY_API_KEY;
    const secretKey = process.env.XIXAPAY_SECRET_KEY;
    const businessId = process.env.XIXAPAY_BUSINESS_ID;

    if (!apiKey || !secretKey || !businessId) {
      logger.warn(
        "XixapayService initialized with missing credentials. Set XIXAPAY_API_KEY, XIXAPAY_SECRET_KEY, XIXAPAY_BUSINESS_ID in env.",
      );
    }

    this.businessId = businessId || "";

    // Xixapay uses static long-lived API key pairs — no OAuth token endpoint,
    // no expiry, no refresh logic needed (unlike SaveHaven's OAuth2 flow).
    this.client = axios.create({
      baseURL: "https://api.xixapay.com",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
        "api-key": apiKey,
      },
      validateStatus: () => true,
    });
  }

  // ── Customer / KYC ───────────────────────────────────────────────────

  async createCustomer(
    data: XixapayCustomerData,
  ): Promise<XixapayCustomerResponse> {
    try {
      const payload: Record<string, any> = {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone_number: toLocalPhoneFormat(data.phone_number),
        address: data.address,
        state: data.state,
        city: data.city,
        postal_code: data.postal_code,
        date_of_birth: data.date_of_birth,
        id_type: data.id_type,
        id_number: data.id_number,
        businessId: data.businessId || this.businessId,
        // TODO: file upload not yet wired — id_card/utility_bill intentionally
        // omitted here. Xixapay's docs mark them required, but per product
        // decision this is treated as a secondary verification step layered
        // on later via updateCustomer(), not a blocker for primary KYC.
      };

      const response = await this.client.post("/api/customer/create", payload);

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Customer creation");
      }

      logger.info(`Xixapay customer created: ${data.email}`);
      return response.data.customer;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Customer creation");
    }
  }

  async updateCustomer(
    data: XixapayCustomerData & { customer_id?: string },
  ): Promise<XixapayCustomerResponse> {
    try {
      const payload: Record<string, any> = {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone_number: toLocalPhoneFormat(data.phone_number),
        address: data.address,
        state: data.state,
        city: data.city,
        postal_code: data.postal_code,
        date_of_birth: data.date_of_birth,
        id_type: data.id_type,
        id_number: data.id_number,
        businessId: data.businessId || this.businessId,
      };

      // This is the designated reuse point for attaching document URLs later —
      // once the ImageKit upload pipeline exists, idCardUrl/utilityBillUrl get
      // passed straight through here without changing this method's signature.
      if (data.idCardUrl) payload.id_card = data.idCardUrl;
      if (data.utilityBillUrl) payload.utility_bill = data.utilityBillUrl;

      const response = await this.client.post("/api/customer/update", payload);

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Customer update");
      }

      logger.info(`Xixapay customer updated: ${data.email}`);
      return response.data.customer;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Customer update");
    }
  }

  async verifyIdentity(data: {
    id_type: "bvn" | "nin";
    id_number: string;
    businessId?: string;
  }): Promise<XixapayIdentityVerificationResponse> {
    try {
      const payload = {
        businessId: data.businessId || this.businessId,
        id_number: data.id_number,
        id_type: data.id_type,
      };

      const response = await this.client.post("/api/identity/verify", payload);

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Identity verification");
      }

      logger.info(`Xixapay identity verified: ${data.id_type}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Identity verification");
    }
  }

  // ── Virtual Accounts ─────────────────────────────────────────────────

  // Dynamic (temporary) account — no KYC/customer_id required.
  // Used for one-off deposits, mirrors SaveHaven's createVirtualAccountForTransfer.
  async createDynamicVirtualAccount(
    data: CreateDynamicAccountData,
  ): Promise<XixapayVirtualAccountResponse> {
    try {
      const payload = {
        email: data.email,
        name: data.name,
        phoneNumber: toLocalPhoneFormat(data.phoneNumber),
        bankCode: data.bankCode || [selectXixapayBankCode()],
        businessId: data.businessId || this.businessId,
        accountType: "dynamic" as const,
        amount: data.amount,
        ...(data.externalReference && {
          externalReference: data.externalReference,
        }),
        ...(data.callbackUrl && { callbackUrl: data.callbackUrl }),
      };

      logger.info("Creating Xixapay dynamic virtual account", {
        email: data.email,
        bankCode: payload.bankCode,
      });

      const response = await this.client.post(
        "/api/v1/createVirtualAccount",
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Dynamic virtual account creation");
      }

      logger.info(`Xixapay dynamic virtual account created: ${data.email}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(
        error,
        error?.response,
        "Dynamic virtual account creation",
      );
    }
  }

  // Static (permanent) account using an existing KYC'd customer_id.
  async createStaticVirtualAccountWithCustomerId(
    data: CreateStaticAccountWithCustomerIdData,
  ): Promise<XixapayVirtualAccountResponse> {
    try {
      const payload = {
        customer_id: data.customer_id,
        bankCode: data.bankCode || [selectXixapayBankCode("static")],
        businessId: data.businessId || this.businessId,
        accountType: "static" as const,
      };

      logger.info("Creating Xixapay static virtual account (customer_id)", {
        customer_id: data.customer_id,
      });

      const response = await this.client.post(
        "/api/v1/createVirtualAccount",
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Static virtual account creation");
      }

      logger.info(
        `Xixapay static virtual account created for customer: ${data.customer_id}`,
      );
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(
        error,
        error?.response,
        "Static virtual account creation",
      );
    }
  }

  // Static (permanent) account using raw data — id_type/id_number required by
  // Xixapay for static accounts even on this path.
  async createStaticVirtualAccountWithRawData(
    data: CreateStaticAccountWithRawDataData,
  ): Promise<XixapayVirtualAccountResponse> {
    try {
      const payload = {
        email: data.email,
        name: data.name,
        phoneNumber: toLocalPhoneFormat(data.phoneNumber),
        bankCode: data.bankCode || [selectXixapayBankCode("static")],
        businessId: data.businessId || this.businessId,
        accountType: "static" as const,
        id_type: data.id_type,
        id_number: data.id_number,
      };

      logger.info("Creating Xixapay static virtual account (raw data)", {
        email: data.email,
      });

      const response = await this.client.post(
        "/api/v1/createVirtualAccount",
        payload,
      );

      // TEMP DEBUG — remove once static-account rail selection has proven
      // stable in production for a few days.
      logger.info("Xixapay raw createVirtualAccount response", {
        status: response.status,
        data: response.data,
      });

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Static virtual account creation");
      }

      logger.info(`Xixapay static virtual account created: ${data.email}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(
        error,
        error?.response,
        "Static virtual account creation",
      );
    }
  }

  // Static accounts only — Xixapay rejects this call for dynamic accounts.
  async updateVirtualAccountStatus(
    data: UpdateVirtualAccountStatusData,
  ): Promise<any> {
    try {
      const payload = {
        businessId: data.businessId || this.businessId,
        accountNumber: data.accountNumber,
        status: data.status,
        ...(data.reason && { reason: data.reason }),
      };

      const response = await this.client.patch(
        "/api/v1/updateVirtualAccountStatus",
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Virtual account status update");
      }

      logger.info(
        `Xixapay virtual account status updated: ${data.accountNumber} -> ${data.status}`,
      );
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(
        error,
        error?.response,
        "Virtual account status update",
      );
    }
  }

  // ── Payouts / Withdrawals ────────────────────────────────────────────

  async getBanks(): Promise<XixapayBank[]> {
    try {
      const response = await this.client.get("/api/get/banks");

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Fetch banks");
      }

      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Fetch banks");
    }
  }

  // Single-call verify — NOT session-bound like SaveHaven's name-enquiry.
  // Per Xixapay's documented "Recommended Payout Flow", this is step 2
  // (fetch banks -> verify bank -> deduct -> transfer -> store -> mark -> refund).
  async verifyBankAccount(
    data: VerifyBankAccountData,
  ): Promise<XixapayBankVerificationResponse> {
    try {
      const payload = {
        bank: String(data.bank),
        accountNumber: String(data.accountNumber),
      };

      const response = await this.client.post("/api/verify/bank", payload);

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Bank account verification");
      }

      logger.info(`Xixapay bank account verified: ${data.accountNumber}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Bank account verification");
    }
  }

  // Synchronous — Xixapay's docs show no async webhook for payout status.
  // The response here is treated as authoritative by WithdrawalService.
  //
  // IMPORTANT: Xixapay can return status: "failed" as a normal HTTP 200
  // response (not a thrown error) — this is promoted to a thrown AppError
  // here so every caller (WithdrawalService, or anything else that calls
  // this method later) automatically falls into its existing error-handling
  // path (manual fallback / reversal) without needing to know Xixapay's
  // specific response shape or add its own status check.
  async initiatePayout(data: InitiatePayoutData): Promise<XixapayPayoutResponse> {
    try {
      const payload = {
        businessId: data.businessId || this.businessId,
        amount: data.amount,
        bank: String(data.bank),
        accountNumber: String(data.accountNumber),
        ...(data.narration && { narration: data.narration }),
      };

      logger.info("Initiating Xixapay payout", {
        amount: data.amount,
        accountNumber: data.accountNumber,
      });

      const response = await this.client.post("/api/v1/transfer", payload);

      if (response.status < 200 || response.status >= 300) {
        this.handleError(null, response, "Payout");
      }

      logger.info(`Xixapay payout response: ${response.data.status}`, {
        reference: response.data.reference,
      });

      if (response.data.status === "failed") {
        logger.error("Xixapay payout returned failed status", {
          accountNumber: data.accountNumber,
          amount: data.amount,
          message: response.data.message,
        });

        const failureError = new AppError(
          response.data.message || "Xixapay payout failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
        // Attach the raw response so the caller can still store it in
        // transaction.meta even on the failure path, same as a success.
        (failureError as any).providerResponse = response.data;
        throw failureError;
      }

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Payout");
    }
  }

  // ── Card Issuing (USD/NGN) — side priority ──────────────────────────

  async createCard(data: CreateCardData): Promise<XixapayCardResponse> {
    try {
      const payload = {
        customer_id: data.customer_id,
        businessId: data.businessId || this.businessId,
        country: data.country,
        amount: data.amount,
      };

      const response = await this.client.post("/api/card/create", payload);

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Card creation");
      }

      logger.info(`Xixapay card created for customer: ${data.customer_id}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Card creation");
    }
  }

  async fundCard(data: FundCardData): Promise<XixapayFundCardResponse> {
    try {
      const payload = {
        amount: data.amount,
        businessId: data.businessId || this.businessId,
      };

      const response = await this.client.post(
        `/api/card/${data.cardId}/fund`,
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        this.handleError(null, response, "Card funding");
      }

      logger.info(`Xixapay card funded: ${data.cardId}`);
      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      this.handleError(error, error?.response, "Card funding");
    }
  }

  // NOTE: updateCardStatus, withdrawFromCard, and refreshCardDetails are not
  // yet implemented — their exact endpoint paths/payloads have not been
  // fetched from Xixapay's docs. Per the agreed plan, card issuing is a side
  // priority; these will be added once those 3 docs pages are pulled rather
  // than guessed at here.

  // ── Internal helpers ─────────────────────────────────────────────────

  private isSuccessResponse(response: any): boolean {
    const isHttpSuccess = response.status >= 200 && response.status < 300;
    if (!response.data) return isHttpSuccess;

    const payloadStatus = response.data.status;
    const isPayloadSuccess =
      payloadStatus === undefined ||
      payloadStatus === true ||
      payloadStatus === "success";

    return isHttpSuccess && isPayloadSuccess;
  }

  private handleError(
    error: any,
    response: any,
    operationType: string,
  ): never {
    const detailedErrorMessage =
      response?.data?.message || error?.message || `${operationType} failed`;
    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : detailedErrorMessage;

    logger.error(`Xixapay ${operationType} failed:`, {
      status: response?.status,
      data: response?.data,
      error: error?.message,
    });

    throw new AppError(
      finalErrorMessage,
      response?.status || HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.THIRD_PARTY_ERROR,
    );
  }
}