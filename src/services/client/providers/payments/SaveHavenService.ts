import { PROVIDERS } from "@/config";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ProviderResponse } from "@/types";
import { ERROR_CODES, HTTP_STATUS } from "@/utils/constants";
import { formatPhoneNumber, toLocalPhoneFormat } from "@/utils/helpers";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import axios, { AxiosInstance } from "axios";

export interface SaveHavenAccountData {
  account_number: string;
  account_name: string;
  bank_name?: string;
  bank_code: string;
  reference: string;
  status: string;
  created_at: string;
  expires_at?: string;
  // SafeHaven's internal account _id — needed for GET/PUT /accounts/{id}...
  // Previously discarded; now surfaced so callers can persist it.
  provider_account_id?: string;
  account_balance?: number;
}

export interface SaveHavenCreateAccountRes {
  success: boolean;
  message: string;
  data: SaveHavenAccountData;
}

export interface SaveHavenBankData {
  bank_name: string;
  bank_code: string;
  bank_slug: string;
  name: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  message: string;
}

interface NameEnquiryResponse {
  accountName: string;
  accountNumber: string;
  sessionId: string;
  bankCode: string;
}

interface IdentityInitiateResponse {
  identityId: string;
  message: string;
}

export interface CheckoutInitiationResponse {
  checkoutUrl: string;
  reference: string;
  expiresAt: string;
}

export interface SaveHavenKYCData {
  bvn: string;
  fullName: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string; // Format: DD-MM-YYYY
  phoneNumber1: string;
  phoneNumber2?: string;
  gender?: string; // e.g., "Male", "Female"
  enrollmentBank?: string;
  enrollmentBranch?: string;
  email?: string;
  lgaOfOrigin?: string;
  lgaOfResidence?: string;
  maritalStatus?: string;
  nin?: string;
  nationality?: string;
  residentialAddress?: string;
  stateOfOrigin?: string;
  stateOfResidence?: string;
  title?: string;
  watchListed?: string;
  levelOfAccount?: string;
  registrationDate?: string | null;
  imageBase64?: string; // The user's passport photo in base64
}

export class SaveHavenService {
  private client: AxiosInstance;
  private provider = PROVIDERS.SAVEHAVEN;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  private tokenRefreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 45000,
      headers: {
        "Content-Type": "application/json",
        ClientID: this.provider.clientId,
      },
      validateStatus: () => true,
    });
  }

  // _doAuthenticate METHOD
  private async _doAuthenticate(): Promise<string> {
    try {
      const response = await axios.post<TokenResponse>(
        `${this.provider.baseUrl}/oauth2/token`,
        {
          grant_type: "client_credentials",
          client_id: this.provider.clientId,
          client_assertion_type:
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: this.provider.clientAssertion,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          validateStatus: () => true,
        },
      );

      if (response.status < 200 || response.status >= 300) {
        logger.error("SafeHaven authentication failed:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Authentication failed";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Service authentication failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.AUTHENTICATION_ERROR,
        );
      }

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;

      this.client.defaults.headers.common["Authorization"] =
        `Bearer ${this.accessToken}`;

      logger.info("SafeHaven authentication successful");
      return this.accessToken;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("SafeHaven authentication error:", error.message);

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Service authentication failed. Please try again later."
          : "Authentication failed";

      throw new AppError(
        finalErrorMessage,
        401,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }
  }

  // nameEnquiry METHOD
  async nameEnquiry(
    accountNumber: string,
    bankCode: string,
  ): Promise<NameEnquiryResponse> {
    try {
      if (this.provider.isSandBox) {
        logger.info("🧪 SANDBOX MODE: Mocking name enquiry");
        const mockResponse = this.getMockResponse("nameEnquiry", {
          accountNumber,
          bankCode,
        });

        return {
          accountName: mockResponse.data.accountName,
          accountNumber: mockResponse.data.accountNumber,
          sessionId: mockResponse.data.sessionId,
          bankCode: mockResponse.data.bankCode,
        };
      }

      const result = await this.executeWithAuth(async () => {
        const response = await this.client.post("/transfers/name-enquiry", {
          accountNumber,
          bankCode,
        });

        if (!this.isSuccessResponse(response)) {
          logger.error("Name enquiry failed:", {
            status: response.status,
            data: response.data,
          });

          // PRODUCTION ERROR HANDLING
          const detailedErrorMessage =
            response.data?.message || "Name enquiry failed";
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Name enquiry failed. Please try again later."
              : detailedErrorMessage;

          throw new AppError(
            finalErrorMessage,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        const data = response.data?.data;
        if (!data?.accountName) {
          logger.error(
            "Unexpected name enquiry response structure:",
            response.data,
          );

          // PRODUCTION ERROR HANDLING
          const detailedErrorMessage =
            response.data?.message || "Invalid account details";
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Invalid account details. Please try again later."
              : detailedErrorMessage;

          throw new AppError(
            finalErrorMessage,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        logger.info(`Name enquiry successful: ${accountNumber}`);
        return {
          accountName: data.accountName,
          accountNumber: data.accountNumber,
          sessionId: data.sessionId,
          bankCode: data.bankCode,
        };
      });

      return result;
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error.response?.data?.message || "Name enquiry failed";
      logger.error("Name enquiry failed:", message);

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Name enquiry failed. Please try again later."
          : message;

      throw new AppError(finalErrorMessage, 400, ERROR_CODES.VALIDATION_ERROR);
    }
  }

  // getBanks METHOD
  async getBanks(country: string = "NG"): Promise<SaveHavenBankData[]> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get("/banks", {
        params: { country },
      });

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch banks:", {
          status: response.status,
          data: response.data,
          endpoint: "/banks",
          params: { country },
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to fetch banks";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch banks. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info(`Fetched banks for ${country}`);
      return response.data.data;
    });
  }

  // initiateIdentityVerification METHOD
  async initiateIdentityVerification(data: {
    identityType: "bvn" | "nin";
    identityNumber: string;
    firstName: string;
    lastName: string;
    middleName?: string;
    dateOfBirth: string;
  }): Promise<{ identityId: string; message: string }> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking identity verification initiation");
      const mockResponse = this.getMockResponse(
        "initiateIdentityVerification",
        {
          type: data.identityType.toUpperCase(),
          number: data.identityNumber,
          debitAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
        },
      );

      return {
        identityId: mockResponse.data._id,
        message: mockResponse.message,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = {
        type: data.identityType.toUpperCase(),
        number: data.identityNumber,
        debitAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
      };

      const response = await this.client.post("/identity/v2", payload);

      logger.info("SafeHaven identity verification response:", {
        status: response.status,
        data: response.data,
      });

      const isHttpSuccess = this.isSuccessResponse(response);
      const safeHavenStatusCode = response.data?.statusCode;
      const innerStatus = response.data?.data?.status; // e.g., "FAILED" or "SUCCESS"

      if (
        !isHttpSuccess ||
        safeHavenStatusCode !== 200 ||
        innerStatus === "FAILED"
      ) {
        const errors = response.data?.error;

        if (Array.isArray(errors)) {
          // PRODUCTION ERROR HANDLING
          const detailedErrorMessage = errors.join(", ");
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Identity verification failed. Please try again later."
              : detailedErrorMessage;

          throw new AppError(
            finalErrorMessage,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // Catch the inner SafeHaven error message (e.g., "Unable to fetch record")
        const detailedErrorMessage =
          response.data?.message || "Identity verification initiation failed";

        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Identity verification failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const identityId = response.data.data?._id;

      return {
        identityId: identityId || "",
        message: response.data.message || "Record fetched successfully",
      };
    });
  }

  // validateIdentity METHOD
  async validateIdentity(data: {
    identityId: string;
    identificationType: string;
    otp: string;
  }): Promise<{
    verified: boolean;
    message: string;
    kycData?: SaveHavenKYCData;
  }> {
    return SentryHelper.trackCriticalOperation(
      "savehaven_identity_validation",
      async () => {
        return this.executeWithAuth(async () => {
          if (this.provider.isSandBox) {
            logger.info("🧪 SANDBOX MODE: Mocking identity validation");
            const mockResponse = this.getMockResponse("validateIdentity", {
              identityId: data.identityId,
              type: data.identificationType,
              otp: data.otp,
            });

            if (mockResponse.statusCode !== 0) {
              // PRODUCTION ERROR HANDLING
              const finalErrorMessage =
                process.env.NODE_ENV === "production"
                  ? "Validation failed. Please try again later."
                  : mockResponse.message;

              throw new AppError(
                finalErrorMessage,
                400,
                ERROR_CODES.VALIDATION_ERROR,
              );
            }

            return {
              verified: true,
              message: mockResponse.message,
              kycData: mockResponse.data?.providerResponse,
            };
          }

          // Ensure the type is uppercase (BVN or NIN) as required by the docs
          const payload = {
            identityId: data.identityId,
            type: data.identificationType.toUpperCase(),
            otp: data.otp,
          };

          const response = await this.client.post(
            "/identity/v2/validate",
            payload,
          );

          // logger.info("SaveHaven validation response:", {
          //   status: response.status,
          //   data: response.data,
          // });

          if (!this.isSuccessResponse(response)) {
            const detailedErrorMessage =
              response.data?.message || "Identity validation failed";

            const finalErrorMessage =
              process.env.NODE_ENV === "production"
                ? "Validation failed. Please try again later."
                : detailedErrorMessage;

            throw new AppError(
              finalErrorMessage,
              response.status,
              ERROR_CODES.VALIDATION_ERROR,
            );
          }

          logger.info(` Identity validated successfully: ${data.identityId}`);

          return {
            verified: true,
            message: response.data.message || "Identity validated successfully",
            kycData: response.data.data?.providerResponse,
          };
        });
      },
      data.identityId,
    );
  }

  // createVirtualAccount METHOD
  async createVirtualAccount(data: {
    email: string;
    firstname: string;
    amount: number;
    lastname: string;
    reference: string;
    phone?: string;
    bvn?: string;
  }): Promise<SaveHavenAccountData> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking virtual account creation");
      const mockResponse = this.getMockResponse("createVirtualAccount", data);

      return {
        account_number: mockResponse.data.accountNumber,
        account_name: mockResponse.data.accountName,
        bank_name: "Safe Haven MFB",
        bank_code: mockResponse.data.bankCode,
        reference: data.reference,
        status: mockResponse.data.status,
        created_at: mockResponse.data.createdAt,
        expires_at: mockResponse.data.expiryDate,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = {
        validFor: 900,
        amountControl: "Fixed",
        amount: data.amount,
        externalReference: data.reference,
        callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven`,
        settlementAccount: {
          bankCode: "090286", // SafeHaven's standard code
          accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
        },
      };

      logger.info("Creating virtual account with payload:", payload);

      const response = await this.client.post("/virtual-accounts", payload);
      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to create virtual account:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to create virtual account";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Account creation failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Created virtual account for ${data.email}`);
      const responseData = response.data.data;

      return {
        account_number: responseData.accountNumber,
        account_name: responseData.accountName,
        bank_name: "Safe Haven MFB",
        bank_code: responseData.bankCode || "090286",
        reference: data.reference,
        status: responseData.status || "active",
        created_at: responseData.createdAt,
        expires_at: responseData.expiryDate,
      };
    });
  }

  // createSubAccount METHOD
  async createSubAccount(data: {
    externalReference: string;
    phoneNumber: string;
    emailAddress: string;
    identityId: string;
  }): Promise<SaveHavenAccountData> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking sub-account creation");
      const mockResponse = this.getMockResponse("createSubAccount", data);

      return {
        account_number: mockResponse.data.accountNumber,
        account_name: mockResponse.data.accountName,
        bank_name: "Safe Haven MFB",
        bank_code: "000",
        reference: data.externalReference,
        status: "active",
        created_at: mockResponse.data.createdAt,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = {
        externalReference: data.externalReference,
        phoneNumber: data.phoneNumber,
        emailAddress: data.emailAddress,
        identityId: data.identityId,
        identityType: "vID",
        callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven/subaccount`,
        autoSweep: true,
        autoSweepDetails: {
          schedule: "Instant",
          accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
          bankCode: "090286",
        },
      };

      logger.info("Creating sub-account with payload:", payload);

      const response = await this.client.post(
        "/accounts/v2/subaccount",
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to create sub-account:", {
          status: response.status,
          data: response.data,
        });

        if (response.status === 403) {
          // PRODUCTION ERROR HANDLING
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Access denied. Please try again later."
              : "Access forbidden. Check API credentials or account permissions.";

          throw new AppError(
            finalErrorMessage,
            403,
            ERROR_CODES.AUTHENTICATION_ERROR,
          );
        }

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to create sub-account";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Account creation failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Created sub-account for ${data.emailAddress}`);
      const responseData = response.data.data;
      return {
        account_number: responseData.accountNumber,
        account_name: responseData.accountName,
        bank_name: "Safe Haven MFB",
        bank_code: "090286",
        reference:
          responseData.subAccountDetails?.externalReference ||
          data.externalReference,
        status: "active",
        created_at: responseData.createdAt,
        provider_account_id: responseData._id,
        account_balance: responseData.accountBalance,
      };
    });
  }

  // updateSubAccount METHOD — used by the autoSweep backfill script to
  // turn autoSweep on for sub-accounts created before this fix shipped.
  // NOTE: per SafeHaven docs this endpoint requires phoneNumber, emailAddress,
  // externalReference, and identityType (+ identityNumber for BVN/NIN) even
  // though we're only changing autoSweep — it behaves like a full replace,
  // not a partial patch.
  async updateSubAccount(
    providerAccountId: string,
    data: {
      phoneNumber: string;
      emailAddress: string;
      externalReference: string;
      identityType: "BVN" | "NIN" | "vNIN" | "BVNUSSD" | "vID";
      identityNumber?: string;
      identityId?: string;
      autoSweep: boolean;
      autoSweepDetails?: {
        schedule: string;
        accountNumber: string;
        bankCode: string;
      };
    },
  ): Promise<{ provider_account_id: string; account_number: string; account_balance?: number }> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking sub-account update", {
        providerAccountId,
      });
      return {
        provider_account_id: providerAccountId,
        account_number: "0000000000",
        account_balance: 0,
      };
    }

    return this.executeWithAuth(async () => {
      const response = await this.client.put(
        `/accounts/${providerAccountId}/subaccount`,
        data,
      );

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to update sub-account:", {
          status: response.status,
          data: response.data,
          providerAccountId,
        });

        const detailedErrorMessage =
          response.data?.message || "Failed to update sub-account";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Account update failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      const responseData = response.data.data;
      logger.info(`Updated sub-account ${providerAccountId}`, {
        autoSweep: responseData.autoSweep,
      });

      return {
        provider_account_id: responseData._id,
        account_number: responseData.accountNumber,
        account_balance: responseData.accountBalance,
      };
    });
  }

  // getAllAccounts METHOD — wraps GET /accounts (used elsewhere only via
  // debugMyAccounts()/getAccountIdByAccountNumber() for the master account).
  // Used by the backfill + recovery scripts to map our accountNumber ->
  // SafeHaven's internal _id (and balance) for every sub-account at once,
  // since we never stored that _id historically.
  async getAllAccounts(): Promise<
    Array<{ _id: string; accountNumber: string; accountBalance: number }>
  > {
    return this.executeWithAuth(async () => {
      const response = await this.client.get("/accounts");

      if (!this.isSuccessResponse(response)) {
        throw new AppError(
          response.data?.message || "Failed to fetch accounts",
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      return response.data.data;
    });
  }

  // verifyPayment METHOD
  async verifyPayment(reference: string): Promise<any> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking payment verification");
      const mockResponse = this.getMockResponse("verifyPayment", { reference });
      return mockResponse.data;
    }

    return this.executeWithAuth(async () => {
      const response = await this.client.get(`/checkout/${reference}/verify`);

      if (!this.isSuccessResponse(response)) {
        logger.error("Payment verification failed:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Payment verification failed";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Verification failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Verified payment: ${reference}`);
      return response.data.data;
    });
  }

  // initiateTransfer METHOD - FIXED v2 (NO NESTED executeWithAuth)
  async initiateTransfer(data: {
    amount: number;
    account_number: string;
    bank_code: string;
    narration: string;
    reference: string;
    sessionId?: string;
    // Optional: defaults to the master/pool account (existing withdrawal
    // behavior, unchanged). Pass a sub-account number here to sweep FROM
    // that sub-account INTO account_number instead — used by the trapped-
    // funds recovery script.
    debitAccountNumber?: string;
  }): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "savehaven_transfer",
      async () => {
        // Handle sandbox mode first
        if (this.provider.isSandBox) {
          logger.info("🧪 SANDBOX MODE: Mocking transfer initiation");
          const mockResponse = this.getMockResponse("initiateTransfer", data);
          return mockResponse.data;
        }

        try {
          await this.ensureAuthenticated();
          logger.info(
            "Token authenticated, proceeding with sequential operations",
          );

          let sessionId = data.sessionId;

          //  Get name enquiry if sessionId not provided
          if (!sessionId) {
            logger.info(
              `Starting name enquiry for account ${data.account_number}...`,
            );
            try {
              // Make the nameEnquiry API call directly with existing authenticated token
              const nameEnquiryResponse = await this.client.post(
                "/transfers/name-enquiry",
                {
                  accountNumber: data.account_number,
                  bankCode: data.bank_code,
                },
              );

              if (!this.isSuccessResponse(nameEnquiryResponse)) {
                logger.error("Name enquiry API failed:", {
                  status: nameEnquiryResponse.status,
                  data: nameEnquiryResponse.data,
                });

                const detailedErrorMessage =
                  nameEnquiryResponse.data?.message || "Name enquiry failed";
                const finalErrorMessage =
                  process.env.NODE_ENV === "production"
                    ? "Name enquiry failed. Please try again later."
                    : detailedErrorMessage;

                throw new AppError(
                  finalErrorMessage,
                  nameEnquiryResponse.status,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }

              // Extract sessionId from response
              const nameEnquiryData = nameEnquiryResponse.data?.data;
              if (!nameEnquiryData?.sessionId) {
                logger.error(
                  "Unexpected name enquiry response structure:",
                  nameEnquiryResponse.data,
                );

                const detailedErrorMessage =
                  nameEnquiryResponse.data?.message ||
                  "Invalid account details";
                const finalErrorMessage =
                  process.env.NODE_ENV === "production"
                    ? "Invalid account details. Please try again later."
                    : detailedErrorMessage;

                throw new AppError(
                  finalErrorMessage,
                  nameEnquiryResponse.data?.statusCode || 400,
                  ERROR_CODES.VALIDATION_ERROR,
                );
              }

              sessionId = nameEnquiryData.sessionId;
              logger.info(`Name enquiry completed successfully`, {
                sessionId,
                accountNumber: data.account_number,
              });
            } catch (enquiryError: any) {
              if (enquiryError instanceof AppError) {
                throw enquiryError;
              }

              logger.error("Name enquiry failed before transfer:", {
                account: data.account_number,
                bankCode: data.bank_code,
                error: enquiryError.message,
                status: enquiryError.response?.status,
              });

              const finalErrorMessage =
                process.env.NODE_ENV === "production"
                  ? "Name enquiry failed. Please try again later."
                  : enquiryError.response?.data?.message ||
                  enquiryError.message ||
                  "Name enquiry failed";

              throw new AppError(
                finalErrorMessage,
                enquiryError.response?.status || 400,
                ERROR_CODES.VALIDATION_ERROR,
              );
            }
          } else {
            logger.info(`Using provided sessionId: ${sessionId}`);
          }

          //  Proceed with transfer using the sessionId from above
          logger.info(`Initiating transfer with reference: ${data.reference}`);

          const payload = {
            nameEnquiryReference: sessionId,
            debitAccountNumber:
              data.debitAccountNumber || process.env.SAFEHAVEN_SWEEP_ACCOUNT,
            beneficiaryBankCode: data.bank_code,
            beneficiaryAccountNumber: data.account_number,
            amount: data.amount,
            saveBeneficiary: false,
            narration: data.narration,
            paymentReference: data.reference,
          };

          logger.debug("Transfer payload:", payload);

          const transferResponse = await this.client.post(
            "/transfers",
            payload,
          );

          logger.debug("Transfer response:", transferResponse.data);

          if (!this.isSuccessResponse(transferResponse)) {
            logger.error("Transfer API failed:", {
              status: transferResponse.status,
              data: transferResponse.data,
              reference: data.reference,
            });

            const detailedErrorMessage =
              transferResponse.data?.message || "Transfer failed";
            const finalErrorMessage =
              process.env.NODE_ENV === "production"
                ? "Transfer failed. Please try again later."
                : detailedErrorMessage;

            throw new AppError(
              finalErrorMessage,
              transferResponse.status,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Transfer initiated successfully: ${data.reference}`, {
            amount: data.amount,
            beneficiary: data.account_number,
            sessionId: sessionId,
          });

          return {
            ...transferResponse.data.data,
            statusCode: transferResponse.data.statusCode,
          };
        } catch (error: any) {
          // Check if it's already an AppError
          if (error instanceof AppError) {
            throw error;
          }

          // Handle token-related errors with retry
          const status = error.response?.status || error.status;
          if (status === 401 || status === 403) {
            logger.warn(
              "Token invalid during transfer, attempting single refresh and retry",
              {
                status,
                message: error.response?.data?.message,
                reference: data.reference,
              },
            );

            // Clear the invalid token
            this.accessToken = null;
            this.tokenExpiry = null;

            try {
              // Get a fresh token
              await this.ensureAuthenticated();
              logger.info("Token refreshed, retrying transfer...");

              // Retry: Do nameEnquiry again if needed
              let sessionId = data.sessionId;
              if (!sessionId) {
                const nameEnquiryResponse = await this.client.post(
                  "/transfers/name-enquiry",
                  {
                    accountNumber: data.account_number,
                    bankCode: data.bank_code,
                  },
                );

                if (!this.isSuccessResponse(nameEnquiryResponse)) {
                  throw new AppError(
                    nameEnquiryResponse.data?.message || "Name enquiry failed",
                    nameEnquiryResponse.status,
                    ERROR_CODES.VALIDATION_ERROR,
                  );
                }

                sessionId = nameEnquiryResponse.data?.data?.sessionId;
              }

              // Retry the transfer with fresh token
              const payload = {
                nameEnquiryReference: sessionId,
                debitAccountNumber:
                  data.debitAccountNumber ||
                  process.env.SAFEHAVEN_SWEEP_ACCOUNT,
                beneficiaryBankCode: data.bank_code,
                beneficiaryAccountNumber: data.account_number,
                amount: data.amount,
                saveBeneficiary: false,
                narration: data.narration,
                paymentReference: data.reference,
              };

              const retryResponse = await this.client.post(
                "/transfers",
                payload,
              );

              if (!this.isSuccessResponse(retryResponse)) {
                throw new AppError(
                  retryResponse.data?.message || "Transfer failed after retry",
                  retryResponse.status,
                  ERROR_CODES.SERVICE_UNAVAILABLE,
                );
              }

              logger.info(
                `Transfer succeeded after token refresh: ${data.reference}`,
              );
              return {
                ...retryResponse.data.data,
                statusCode: retryResponse.data.statusCode,
              };
            } catch (retryError: any) {
              logger.error("Transfer retry failed:", {
                reference: data.reference,
                error: retryError.message,
              });
              throw retryError;
            }
          }

          // Handle other unexpected errors
          logger.error("Transfer initiation error:", {
            reference: data.reference,
            error: error.message,
            status: status,
          });

          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Transfer failed. Please try again later."
              : error.response?.data?.message ||
              error.message ||
              "Transfer failed";

          throw new AppError(
            finalErrorMessage,
            status || HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  // createVirtualAccountForTransfer METHOD
  async createVirtualAccountForTransfer(data: {
    email: string;
    firstname: string;
    amount?: number;
    lastname: string;
    reference: string;
    phone?: string;
    bvn?: string;
  }): Promise<SaveHavenAccountData> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking virtual account creation");
      const mockResponse = this.getMockResponse("createVirtualAccount", data);

      return {
        account_number: mockResponse.data.accountNumber,
        account_name: mockResponse.data.accountName,
        bank_name: "Safe Haven MFB",
        bank_code: mockResponse.data.bankCode,
        reference: data.reference,
        status: mockResponse.data.status,
        created_at: mockResponse.data.createdAt,
        expires_at: mockResponse.data.expiryDate,
      };
    }

    return this.executeWithAuth(async () => {
      const response = await this.client.post("/virtual-accounts", {
        amount: Number(data.amount),
        validFor: 900,
        amountControl: "Fixed",
        externalReference: data.reference,
        callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven`,
        settlementAccount: {
          bankCode: "090286",
          accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT,
        },
      });

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to create virtual account:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to create virtual account";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Account creation failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Created virtual account for ${data.email}`);
      const payload = {
        _id: response.data.data._id,
        account_number: response.data.data.accountNumber,
        account_name: response.data.data.accountName,
        bank_code: response.data.data.bankCode,
        reference: data.reference,
        status: response.data.data.status,
        created_at: response.data.data.createdAt,
        expires_at: response.data.data.expiryDate,
      };
      return payload;
    });
  }

  // initiateCardPayment METHOD
  async initiateCardPayment(data: {
    email: string;
    firstname: string;
    lastname: string;
    amount: number;
    reference: string;
    phone?: string;
  }): Promise<CheckoutInitiationResponse> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking card payment initiation");
      const mockResponse = this.getMockResponse("initiateCardPayment", data);

      return {
        checkoutUrl: mockResponse.data.checkoutUrl,
        reference: data.reference,
        expiresAt: mockResponse.data.expiresAt,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = {
        amount: data.amount,
        customerEmail: data.email,
        customerName: `${data.firstname} ${data.lastname}`,
        reference: data.reference,
        callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven/checkout`,
        channels: ["card"],
        metadata: {
          userId: data.email,
          paymentType: "deposit",
        },
      };

      const response = await this.client.post("/checkout/initialize", payload);

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to initiate card payment:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to initiate card payment";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Payment initialization failed. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Initiated card payment for ${data.email}`);
      return {
        checkoutUrl:
          response.data.data.authorizationUrl || response.data.data.checkoutUrl,
        reference: data.reference,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    });
  }

  // getTransactions METHOD
  async getTransactions(data: {
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    return this.executeWithAuth(async () => {
      let accountId = process.env.SAFEHAVEN_ACCOUNT_ID;
      if (!accountId) {
        accountId = await this.getAccountIdByAccountNumber();
      }

      const response = await this.client.get("/transfers", {
        params: {
          accountId: accountId,
          fromDate: data.fromDate,
          toDate: data.toDate,
          page: data.page ?? 0,
          limit: data.limit ?? 100,
        },
      });

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch transfers:", {
          status: response.status,
          data: response.data,
        });

        const detailedErrorMessage =
          response.data?.message || "Failed to fetch transfers";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch transfers. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info("Fetched transfers", {
        fromDate: data.fromDate,
        toDate: data.toDate,
        count: response.data?.data?.length || 0,
      });

      return response.data.data;
    });
  }

  // getAccountBalance METHOD
  async getAccountBalance(accountId: string): Promise<number> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get(`/accounts/${accountId}`);

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch account details for balance:", {
          status: response.status,
          data: response.data,
          accountId,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to fetch account balance";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch balance. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      const accountData = response.data?.data;

      if (!accountData) {
        throw new AppError("Account details not found", 404);
      }

      logger.info(`Fetched balance for account ID: ${accountId}`);

      return accountData.accountBalance ?? accountData.availableBalance ?? 0;
    });
  }

  // NOTE: VAS purchase methods (airtime, data, cable TV, utility) and their
  // private helpers (handleVASTransactionResponse, handleVASError, getServiceCategoryId)
  // have been removed — bill payments are not supported in PaymintSmm.

  // GET VAS TRANSACTION METHOD (kept — used by polling to requery SafeHaven)
  // id can be the _id or externalReference of the transaction
  async getVASTransaction(id: string): Promise<any> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get(`/vas/transaction/${id}`);

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch VAS transaction:", {
          status: response.status,
          data: response.data,
          id,
        });

        const detailedErrorMessage =
          response.data?.message || "Failed to fetch VAS transaction";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch transaction. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.data?.statusCode || response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
          response.data,
        );
      }

      logger.info(`Fetched VAS transaction: ${id}`);
      return response.data.data;
    });
  }
  // getVASServices METHOD
  async getVASServices(): Promise<any[]> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get("/vas/services");

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch VAS services:", {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to fetch VAS services";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch services. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      return response.data.data;
    });
  }

  // getVASServiceCategories METHOD
  async getVASServiceCategories(serviceId: string): Promise<any[]> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get(
        `/vas/service/${serviceId}/service-categories`,
      );

      if (!this.isSuccessResponse(response)) {
        logger.error(`Failed to fetch categories for service ${serviceId}:`, {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to fetch service categories";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch categories. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      return response.data.data;
    });
  }

  // getVASCategoryProducts METHOD
  async getVASCategoryProducts(categoryId: string): Promise<any[]> {
    return this.executeWithAuth(async () => {
      const response = await this.client.get(
        `/vas/service-category/${categoryId}/products`,
      );

      if (!this.isSuccessResponse(response)) {
        logger.error(`Failed to fetch products for category ${categoryId}:`, {
          status: response.status,
          data: response.data,
        });

        // PRODUCTION ERROR HANDLING
        const detailedErrorMessage =
          response.data?.message || "Failed to fetch category products";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch products. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      return response.data.data;
    });
  }
  private async authenticate(): Promise<string> {
    // If a refresh is already in progress, wait for it
    if (this.tokenRefreshPromise) {
      logger.info("Token refresh already in progress, waiting...");
      return this.tokenRefreshPromise;
    }

    // Start the refresh and store the promise
    this.tokenRefreshPromise = this._doAuthenticate();

    try {
      const token = await this.tokenRefreshPromise;
      return token;
    } finally {
      // Clear the promise when done (success or failure)
      this.tokenRefreshPromise = null;
    }
  }

  // Ensure valid token before making requests
  private async ensureAuthenticated(): Promise<void> {
    if (
      !this.accessToken ||
      !this.tokenExpiry ||
      Date.now() >= this.tokenExpiry - 60000 // Refresh 1 minute before expiry
    ) {
      await this.authenticate();
    }
  }

  // Helper to handle token expiration and retry
  private async executeWithAuth<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.ensureAuthenticated();
      return await operation();
    } catch (error: any) {
      const status = error.response?.status || error.status;

      // Token expired or unauthorized - retry once
      if (status === 401 || status === 403) {
        logger.info("Token expired or unauthorized, refreshing token...");

        this.accessToken = null;
        this.tokenExpiry = null;
        await this.ensureAuthenticated();

        logger.info("Retrying operation with new token...");
        return await operation();
      }
      throw error;
    }
  }

  private isSuccessResponse(response: any): boolean {
    const isHttpSuccess = response.status >= 200 && response.status < 300;

    if (!response.data) return isHttpSuccess;

    const safeHavenStatusCode = response.data.statusCode;
    const isPayloadSuccess =
      safeHavenStatusCode === undefined || // If endpoint doesn't include it, pass
      safeHavenStatusCode === 0 ||
      safeHavenStatusCode === 200;

    const innerStatus = response.data.data?.status;
    const isNotFailed = innerStatus?.toUpperCase() !== "FAILED";

    return isHttpSuccess && isPayloadSuccess && isNotFailed;
  }

  async debugMyAccounts() {
    return this.executeWithAuth(async () => {
      const response = await this.client.get("/accounts");
      return response.data.data;
    });
  }

  async getAccountIdByAccountNumber(): Promise<string> {
    const accountNumber = process.env.SAFEHAVEN_SWEEP_ACCOUNT;
    const accounts = await this.debugMyAccounts();

    const account = accounts.find(
      (acc: any) => acc.accountNumber === accountNumber,
    );

    if (!account) {
      throw new AppError(
        `Account not found with number: ${accountNumber}`,
        404,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return account._id;
  }

  // UPDATED getTransferStatus METHOD
  async getTransferStatus(transferReference: string): Promise<any> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking transfer status check");
      return {
        status: "Completed",
        isReversed: false,
        amount: 0,
        paymentReference: transferReference,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = {
        paymentReference: transferReference,
      };

      const response = await this.client.post("/transfers/status", payload);

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch transfer status:", {
          status: response.status,
          data: response.data,
          transferReference,
        });

        const detailedErrorMessage =
          response.data?.message || "Failed to fetch transfer status";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch transfer status. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info(`Fetched transfer status for: ${transferReference}`);

      const transferData = response.data?.data;

      if (!transferData) {
        logger.warn(`Transfer not found at provider: ${transferReference}`);
        return { status: "unknown" };
      }

      return transferData;
    });
  }

  // VERIFY AN INWARD VIRTUAL-ACCOUNT CREDIT DIRECTLY WITH SAFEHAVEN
  // SafeHaven does not sign its webhooks (confirmed against their published
  // docs — no HMAC/signature header is documented for /reference/webhooks),
  // so webhook payloads must never be trusted on their own for crediting a
  // wallet. This method is the server-side check: given the sessionId from
  // an inward-transfer webhook, it asks SafeHaven directly what actually
  // happened, per their documented endpoint:
  // https://safehavenmfb.readme.io/reference/virtual-account-transfer-status
  //   POST /virtual-accounts/status   Body: { sessionId }   Header: ClientID
  //
  // Response shape confirmed against SafeHaven's published OpenAPI spec/
  // example for this endpoint: { statusCode, responseCode, message, data: {
  // status, isReversed, amount, creditAccountNumber, sessionId,
  // paymentReference, ... } } — same field names already used elsewhere in
  // this file (e.g. getTransferStatus), so isSuccessResponse() below and
  // the parsing in the callers work unchanged.
  async getVirtualAccountTransferStatus(sessionId: string): Promise<any> {
    if (this.provider.isSandBox) {
      logger.info(
        "🧪 SANDBOX MODE: Mocking virtual account transfer status check",
      );
      // Sandbox has no real inward transfer to check against. Returning a
      // permissive "verified" result here preserves existing sandbox/test
      // behavior exactly as it was before this method existed.
      return {
        status: "Completed",
        isReversed: false,
        sessionId,
      };
    }

    return this.executeWithAuth(async () => {
      const payload = { sessionId };

      const response = await this.client.post(
        "/virtual-accounts/status",
        payload,
      );

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch virtual account transfer status:", {
          status: response.status,
          data: response.data,
          sessionId,
        });

        const detailedErrorMessage =
          response.data?.message ||
          "Failed to fetch virtual account transfer status";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch virtual account transfer status. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info(
        `Fetched virtual account transfer status for session: ${sessionId}`,
      );

      const transferData = response.data?.data;

      if (!transferData) {
        logger.warn(
          `Virtual account transfer not found at provider: ${sessionId}`,
        );
        return { status: "unknown" };
      }

      return transferData;
    });
  }

  // VERIFY AN INWARD CREDIT TO A PERMANENT (STATIC) SUB-ACCOUNT
  //
  // Unlike getVirtualAccountTransferStatus above, this one IS confirmed
  // against a real live call (2026-07-25), not just documentation. Two
  // other candidate endpoints were ruled out first for this purpose -
  // /virtual-accounts/status and /virtual-accounts/{id}/transaction both
  // came back empty against a static sub-account (they're scoped to
  // "virtual-accounts" / dynamic accounts, wrong resource type here).
  //
  //   GET /accounts/{accountId}/statement?page=&limit=&type=Credit
  //     Header: ClientID + Bearer token (same as every other call here)
  //   Response (real, observed live):
  //     { statusCode, message, data: [ { _id, type: "Credit", amount,
  //     runningBalance, narration, isReversal, ... } ] }
  //
  // The ledger has no separate success/fail flag of its own - a
  // non-reversed Credit entry appearing here IS the confirmation of a
  // real inward credit. A reversal is expected to show up as a further
  // entry with isReversal: true (matches the one live reversal-shaped
  // check we could do; a real reversed transaction has not been observed
  // end-to-end yet, so keep an eye on this in production).
  //
  // CAVEAT: the exact field carrying our own paymentReference on each
  // ledger line was not fully confirmed - the raw response captured
  // during testing was truncated before we saw a complete entry. What we
  // do know: it matched on a "paymentReference" field, and separately
  // that the value also appears inside "narration" (pipe-delimited). This
  // method checks both. If matching every seems unreliable in production
  // logs, re-confirm the exact field name from one full raw response.
  async getAccountStatement(
    accountId: string,
    paymentReference: string,
    options?: { page?: number; limit?: number },
  ): Promise<{
    found: boolean;
    isReversal?: boolean;
    amount?: number;
    runningBalance?: number;
    raw?: any;
  }> {
    if (this.provider.isSandBox) {
      logger.info("🧪 SANDBOX MODE: Mocking account statement check");
      // Sandbox has no real inward transfer to check against. Returning a
      // permissive "verified" result here preserves existing sandbox/test
      // behavior exactly as it was before this method existed.
      return {
        found: true,
        isReversal: false,
      };
    }

    const page = options?.page ?? 0;
    const limit = options?.limit ?? 50;

    return this.executeWithAuth(async () => {
      const response = await this.client.get(
        `/accounts/${accountId}/statement`,
        { params: { page, limit, type: "Credit" } },
      );

      if (!this.isSuccessResponse(response)) {
        logger.error("Failed to fetch account statement:", {
          status: response.status,
          data: response.data,
          accountId,
          paymentReference,
        });

        const detailedErrorMessage =
          response.data?.message || "Failed to fetch account statement";
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch account statement. Please try again later."
            : detailedErrorMessage;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      const entries: any[] = Array.isArray(response.data?.data)
        ? response.data.data
        : [];

      const match = entries.find((entry) => {
        if (
          entry?.paymentReference &&
          entry.paymentReference === paymentReference
        ) {
          return true;
        }
        return (
          typeof entry?.narration === "string" &&
          entry.narration.includes(paymentReference)
        );
      });

      if (!match) {
        logger.warn(
          `Account statement: no matching credit entry yet for ${paymentReference}`,
          { accountId },
        );
        return { found: false };
      }

      logger.info(
        `Account statement: matched credit entry for ${paymentReference}`,
        { accountId, isReversal: !!match.isReversal },
      );

      return {
        found: true,
        isReversal: !!match.isReversal,
        amount: match.amount,
        runningBalance: match.runningBalance,
        raw: match,
      };
    });
  }

  // HELPER METHODS
  // Fetch all services and their categories in one call
  async getAllVASServicesWithCategories(): Promise<any[]> {
    const services = await this.getVASServices();

    logger.info(
      `Found ${services.length} VAS services, fetching categories...`,
    );

    const servicesWithCategories = await Promise.all(
      services.map(async (service: any) => {
        try {
          const categories = await this.getVASServiceCategories(service._id);
          return {
            serviceId: service._id,
            serviceName: service.name,
            categories: categories.map((cat: any) => ({
              categoryId: cat._id,
              categoryName: cat.name,
              slug: cat.slug,
            })),
          };
        } catch (error) {
          logger.warn(
            `Failed to fetch categories for service ${service._id} (${service.name}), skipping...`,
          );
          return {
            serviceId: service._id,
            serviceName: service.name,
            categories: [],
          };
        }
      }),
    );

    // Log a clean map you can use to update serviceCategoryMap
    logger.info(
      "=== SafeHaven VAS Service Category Map ===",
      JSON.stringify(servicesWithCategories, null, 2),
    );

    console.log(
      "=== SafeHaven VAS Service Category Map ===\n",
      JSON.stringify(servicesWithCategories, null, 2),
    );

    return servicesWithCategories;
  }

  // Mock data generator for sandbox environment
  private getMockResponse(method: string, data?: any): any {
    const timestamp = new Date().toISOString();

    switch (method) {
      case "nameEnquiry":
        return {
          statusCode: 0,
          responseCode: "00",
          message: "Name enquiry successful",
          data: {
            responseCode: "00",
            responseMessage: "Successful",
            sessionId: `SESS_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            bankCode: data?.bankCode || "000",
            accountNumber: data?.accountNumber || "0000000000",
            accountName: "SANDBOX TEST ACCOUNT",
            kycLevel: "3",
            bvn: "22222222222",
          },
        };

      case "initiateIdentityVerification":
        return {
          statusCode: 0,
          data: {
            _id: `ID_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            clientId: "sandbox_client_id",
            identityNumber: data?.number || "22222222222",
            type: data?.type || "BVN",
            amount: 50,
            status: "pending",
            debitAccountNumber: data?.debitAccountNumber || "",
            vat: 0,
            stampDuty: 0,
            isDeleted: false,
            otpVerified: false,
            otpResendCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            __v: 0,
            debitMessage: "Successful",
            debitResponsCode: 0,
            debitSessionId: `SESS_${Date.now()}`,
            otpId: `OTP_${Date.now()}`,
            providerResponse: "OTP sent successfully",
          },
          message: "Record fetched successfully",
        };

      case "validateIdentity":
        // Simulate success if OTP is "123456", failure otherwise
        const isValidOtp = data?.otp === "123456" || data?.otp === "111111";

        if (!isValidOtp) {
          return {
            statusCode: 400,
            message: "Invalid OTP",
            data: null,
          };
        }

        return {
          statusCode: 0,
          message: "Identity validated successfully",
          data: {
            _id: data?.identityId || `ID_${Date.now()}`,
            clientId: "sandbox_client_id",
            identityNumber: "22222222222",
            type: data?.type || "BVN",
            amount: 50,
            status: "verified",
            debitAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
            vat: 0,
            stampDuty: 0,
            isDeleted: false,
            otpVerified: true,
            otpResendCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            __v: 0,
            debitMessage: "Successful",
            debitResponsCode: 0,
            debitSessionId: `SESS_${Date.now()}`,
            otpId: `OTP_${Date.now()}`,
            providerResponse: {
              firstName: "SANDBOX",
              lastName: "USER",
              middleName: "TEST",
              dateOfBirth: "1990-01-01",
              phone: "08012345678",
              bvn: "22222222222",
            },
          },
        };

      case "createVirtualAccount":
        return {
          statusCode: 0,
          message: "Virtual account created successfully",
          data: {
            _id: `VA_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            client: "sandbox_client_id",
            bankCode: "000",
            accountNumber: `90${Math.floor(
              10000000 + Math.random() * 90000000,
            )}`,
            accountName: `${data?.firstname?.toUpperCase() || "SANDBOX"} ${data?.lastname?.toUpperCase() || "USER"
              }`,
            currencyCode: "NGN",
            bvn: data?.bvn || "",
            validFor: 900,
            amountControl: "Fixed",
            amount: data?.amount || 0,
            expiryDate: new Date(Date.now() + 900000).toISOString(), // 15 mins from now
            callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven`,
            settlementAccount: {
              accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
              bankCode: "000",
            },
            status: "active",
            isDeleted: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            __v: 0,
          },
        };

      case "verifyPayment":
        return {
          statusCode: 0,
          message: "Transaction verified successfully",
          data: {
            channels: ["card", "withdrawal"],
            _id: `TXN_${Date.now()}`,
            client: "sandbox_client_id",
            merchantName: "SANDBOX MERCHANT",
            oauthClientId: "sandbox_oauth_client",
            referenceCode: data?.reference || `REF_${Date.now()}`,
            customer: {
              email: "sandbox@example.com",
              name: "Sandbox User",
            },
            currencyCode: "NGN",
            amount: 100000, // 1000 NGN in kobo
            feeBearer: "customer",
            fees: 150,
            vat: 12,
            stampDuty: 50,
            customIconUrl: "",
            redirectUrl: "",
            webhookUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven`,
            settlementAccount: {
              accountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
              bankCode: "000",
            },
            settlementStatus: "settled",
            settlementReference: `SETTLE_${Date.now()}`,
            channelDetails: {
              channel: "withdrawal",
              method: "virtual_account",
            },
            paymentDetails: {
              paidAt: timestamp,
              amount: data?.amount || 100000,
            },
            status: "successful",
            isDeleted: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            __v: 0,
          },
        };

      case "initiateTransfer":
        return {
          statusCode: 0,
          responseCode: "00",
          message: "Transfer initiated successfully",
          data: {
            _id: `TRF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            client: "sandbox_client_id",
            account: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
            type: "transfer",
            sessionId: `SESS_${Date.now()}`,
            nameEnquiryReference: data?.sessionId || `SESS_${Date.now()}`,
            paymentReference: data?.reference || `PAY_${Date.now()}`,
            mandateReference: "",
            isReversed: false,
            reversalReference: "",
            provider: "SafeHaven",
            providerChannel: "NIP",
            providerChannelCode: "03",
            destinationInstitutionCode: data?.bank_code || "000",
            creditAccountName: "SANDBOX BENEFICIARY",
            creditAccountNumber: data?.account_number || "0000000000",
            creditBankVerificationNumber: "",
            creditKYCLevel: "3",
            debitAccountName: "SANDBOX MERCHANT",
            debitAccountNumber: process.env.SAFEHAVEN_SWEEP_ACCOUNT || "",
            debitBankVerificationNumber: "",
            debitKYCLevel: "3",
            transactionLocation: "NG",
            narration: data?.narration || "Transfer",
            amount: data?.amount || 0,
            fees: Math.floor((data?.amount || 0) * 0.001), // 0.1% fee
            vat: Math.floor((data?.amount || 0) * 0.00075), // VAT on fee
            stampDuty: data?.amount >= 1000000 ? 50 : 0, // Stamp duty for amounts >= 10k NGN
            responseCode: "00",
            responseMessage: "Successful",
            status: "success",
            isDeleted: false,
            createdAt: timestamp,
            createdBy: "system",
            updatedAt: timestamp,
            __v: 0,
            approvedAt: timestamp,
            approvedBy: "system",
          },
        };
      case "createSubAccount":
        return {
          statusCode: 0,
          message: "Sub-account created successfully",
          data: {
            _id: `SUB_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            client: "sandbox_client_id",
            accountProduct: "savings",
            accountNumber: `10${Math.floor(
              10000000 + Math.random() * 90000000,
            )}`,
            accountName: `${data?.emailAddress?.split("@")[0]?.toUpperCase() || "SANDBOX"
              } USER`,
            accountType: "subaccount",
            currencyCode: "NGN",
            bvn: "22222222222",
            identityId: data?.identityId || "",
            accountBalance: 0,
            bookBalance: 0,
            callbackUrl: `${process.env.BASE_URL}/api/v1/webhooks/savehaven/subaccount`,
            isSubAccount: true,
            subAccountDetails: {
              externalReference: data?.externalReference || `EXT_${Date.now()}`,
              phoneNumber: data?.phoneNumber || "+2348000000000",
              emailAddress: data?.emailAddress || "sandbox@example.com",
              autoSweep: true,
            },
            createdAt: timestamp,
            updatedAt: timestamp,
            nin: "",
            __v: 0,
            cbaAccountId: `CBA_${Date.now()}`,
          },
        };

      case "initiateCardPayment":
        return {
          statusCode: 0,
          message: "Checkout initialized successfully",
          data: {
            checkoutUrl: `https://checkout-sandbox.safehavenmfb.com/pay/${data.reference}`,
            reference: data.reference,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            amount: data.amount,
          },
        };
      default:
        return null;
    }
  }
}
