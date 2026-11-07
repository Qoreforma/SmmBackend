import { PROVIDERS } from "@/config";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ERROR_CODES } from "@/utils/constants";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import axios, { AxiosInstance } from "axios";

export interface MonnifyAccountData {
  contractCode: string;
  accountReference: string;
  accountName: string;
  currencyCode: string;
  customerEmail: string;
  customerName: string;
  accounts: Array<{
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }>;
  collectionChannel: string;
  reservationReference: string;
  reservedAccountType: string;
  status: string;
  createdOn: string;
  bvn?: string;
  nin?: string;
  restrictPaymentSource?: boolean;
}

export interface MonnifyCreateAccountRes {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: MonnifyAccountData;
}

export interface MonnifyBankData {
  name: string;
  code: string;
  ussdTemplate: string;
  baseUssdCode: string;
  transferUssdTemplate: string;
}

export interface MonnifyCheckoutResponse {
  checkoutUrl: string;
  transactionReference: string;
  paymentReference: string;
}

export interface MonnifyUSSDResponse {
  ussdCode: string;
  bankName: string;
  transactionReference: string;
}

export class MonnifyService {
  private client: AxiosInstance;
  private provider = PROVIDERS.MONNIFY;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // Authenticate and get access token
  private async authenticate(): Promise<string | null> {
    try {
      // Check if token is still valid (with 5 min buffer)
      if (this.accessToken && Date.now() < this.tokenExpiry - 300000) {
        return this.accessToken;
      }

      const credentials = Buffer.from(
        `${this.provider.apiKey}:${this.provider.secretKey}`,
      ).toString("base64");

      const response = await axios.post(
        `${this.provider.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
        },
      );

      if (!response.data.requestSuccessful) {
        throw new AppError(
          "Monnify authentication failed",
          401,
          ERROR_CODES.AUTHENTICATION_ERROR,
        );
      }

      this.accessToken = response.data.responseBody.accessToken;
      this.tokenExpiry =
        Date.now() + response.data.responseBody.expiresIn * 1000;

      logger.info("Monnify authentication successful");
      return this.accessToken;
    } catch (error: any) {
      logger.error("Error authenticating with Monnify:", error);
      throw new AppError(
        "Monnify authentication failed",
        401,
        ERROR_CODES.AUTHENTICATION_ERROR,
      );
    }
  }

  // Make authenticated request
  private async makeAuthenticatedRequest(
    method: string,
    url: string,
    data?: any,
  ): Promise<any> {
    const token = await this.authenticate();

    try {
      const response = await this.client.request({
        method,
        url,
        data,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error(
        `Monnify ${method} request error to ${url}:`,
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  //BVN and Account Match Verification
  //Verifies that BVN and account number match
  async verifyBVNAccountMatch(data: {
    bvn: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{
    accountNumber: string;
    accountName: string;
    bvn: string;
    matchStatus: boolean;
  }> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "POST",
        "/api/v1/vas/bvn-account-match",
        {
          bvn: data.bvn,
          accountNumber: data.accountNumber,
          bankCode: data.bankCode,
        },
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: response.responseMessage },
          "BVN-Account match verification",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Verified BVN-Account match: ${data.accountNumber}`);
      return response.responseBody;
    } catch (error: any) {
      this.handleError(
        error,
        "BVN-Account match verification",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
     
    }
  }

  // Verify bank account
  async verifyBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{
    accountName: string;
    accountNumber: string;
    account_name: string;
    account_number: string;
  }> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${bankCode}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: response.responseMessage },
          "Account verification",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Verified account: ${accountNumber}`);
      return {
        account_name: response.responseBody.accountName,
        account_number: accountNumber,
        accountName: response.responseBody.accountName,
        accountNumber: accountNumber,
      };
    } catch (error: any) {
      return this.handleError(
        error,
        "Account verification",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get list of banks
  async getBanks(): Promise<MonnifyBankData[]> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        "/api/v1/banks",
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to fetch banks" },
          "Fetch banks",
          500,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info("Monnify: Fetched banks list");
      return response.responseBody;
    } catch (error: any) {
      return this.handleError(
        error,
        "Fetch banks",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Create reserved account for wallet funding (permanent account)
  async createVirtualAccount(data: {
    email: string;
    firstname: string;
    lastname: string;
    reference: string;
    bvn?: string;
    nin?: string;
    getAllBanks?: boolean;
  }): Promise<MonnifyAccountData> {
    return SentryHelper.trackCriticalOperation(
      "monnify_create_virtual_account",
      async () => {
        try {
          const payload: any = {
            accountReference: data.reference,
            accountName: `${data.firstname} ${data.lastname}`,
            currencyCode: "NGN",
            contractCode: this.provider.contractCode,
            customerEmail: data.email,
            customerName: `${data.firstname} ${data.lastname}`,
            getAllAvailableBanks: data.getAllBanks !== false,
          };

          // Add BVN if provided
          if (data.bvn) {
            payload.bvn = data.bvn;
          }

          // Add NIN if provided (alternative to BVN)
          if (data.nin) {
            payload.nin = data.nin;
          }

          // Don't add preferredBanks when getAllAvailableBanks is true
          if (data.getAllBanks === false) {
            // You can add preferredBanks here if needed
            payload.preferredBanks = ["035", "232", "058"]; // Wema Bank and Sterling Bank
          }

          const response = await this.makeAuthenticatedRequest(
            "POST",
            "/api/v2/bank-transfer/reserved-accounts",
            payload,
          );

          if (!response.requestSuccessful) {
            this.handleError(
              { responseMessage: response.responseMessage },
              "Create virtual account",
              400,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Monnify: Created virtual account for ${data.email}`);
          return response.responseBody;
        } catch (error: any) {
          return this.handleError(
            error,
            "Create virtual account",
            400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  async createVirtualAccountForTransfer(data: {
    email: string;
    firstname: string;
    lastname: string;
    reference: string;
    bvn?: string;
    nin?: string;
    getAllBanks?: boolean;
  }): Promise<MonnifyAccountData> {
    return SentryHelper.trackCriticalOperation(
      "monnify_create_virtual_account",
      async () => {
        try {
          const payload: any = {
            accountReference: data.reference,
            accountName: `${data.firstname} ${data.lastname}`,
            currencyCode: "NGN",
            contractCode: this.provider.contractCode,
            customerEmail: data.email,
            customerName: `${data.firstname} ${data.lastname}`,
            getAllAvailableBanks: data.getAllBanks !== false,
          };

          if (data.bvn) {
            payload.bvn = data.bvn;
          }

          if (data.nin) {
            payload.nin = data.nin;
          }

          if (data.getAllBanks === false) {
            // You can add preferredBanks here if needed
          }

          const response = await this.makeAuthenticatedRequest(
            "POST",
            "/api/v2/bank-transfer/reserved-accounts",
            payload,
          );

          if (!response.requestSuccessful) {
            this.handleError(
              { responseMessage: response.responseMessage },
              "Create virtual account for transfer",
              400,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Monnify: Created virtual account for ${data.email}`);
          return response.responseBody;
        } catch (error: any) {
          return this.handleError(
            error,
            "Create virtual account for transfer",
            400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  //  Initiate Card Payment
  //  Creates a checkout session for card payment
  async initiateCardPayment(data: {
    email: string;
    amount: number;
    reference: string;
    customerName: string;
    redirectUrl?: string;
  }): Promise<MonnifyCheckoutResponse> {
    return SentryHelper.trackCriticalOperation(
      "monnify_payment",
      async () => {
        try {
          const response = await this.makeAuthenticatedRequest(
            "POST",
            "/api/v1/merchant/transactions/init-transaction",
            {
              amount: data.amount,
              customerName: data.customerName,
              customerEmail: data.email,
              paymentReference: data.reference,
              paymentDescription: "Wallet funding",
              currencyCode: "NGN",
              contractCode: this.provider.contractCode,
              redirectUrl:
                data.redirectUrl ||
                `${process.env.BASE_URL}/api/v1/webhooks/monnify/callback`,
            },
          );

          if (!response.requestSuccessful) {
            this.handleError(
              { responseMessage: response.responseMessage },
              "Card payment initiation",
              400,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Monnify: Initiated card payment: ${data.reference}`);
          return {
            checkoutUrl: response.responseBody.checkoutUrl,
            transactionReference: response.responseBody.transactionReference,
            paymentReference: data.reference,
          };
        } catch (error: any) {
          return this.handleError(
            error,
            "Card payment initiation",
            400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  // Verify payment (for wallet funding confirmation)
  async verifyPayment(reference: string): Promise<any> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v2/transactions/${reference}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Payment verification failed" },
          "Payment verification",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Verified payment: ${reference}`);
      return response.responseBody;
    } catch (error: any) {
      return this.handleError(
        error,
        "Payment verification",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Initiate transfer/disbursement (for withdrawal from wallet to bank)
  async initiateTransfer(data: {
    amount: number;
    destinationBankCode: string;
    destinationAccountNumber: string;
    narration: string;
    reference: string;
    currency?: string;
    async?: boolean;
  }): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "monnify_transfer",
      async () => {
        try {
          const payload: any = {
            amount: data.amount,
            reference: data.reference,
            narration: data.narration,
            destinationBankCode: data.destinationBankCode,
            destinationAccountNumber: data.destinationAccountNumber,
            currency: data.currency || "NGN",
            sourceAccountNumber: this.provider.walletAccountNumber,
          };

          // Adding async parameter if provided (defaulting to false for synchronous)
          if (data.async !== undefined) {
            payload.async = data.async;
          }

          const response = await this.makeAuthenticatedRequest(
            "POST",
            "/api/v2/disbursements/single",
            payload,
          );

          // Check if API request itself failed
          if (!response.requestSuccessful) {
            logger.error("Monnify: Transfer request failed:", {
              reference: data.reference,
              responseMessage: response.responseMessage,
              responseCode: response.responseCode,
            });

            this.handleError(
              { responseMessage: response.responseMessage },
              "Transfer",
              400,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          // Check the actual transfer status in responseBody
          const transferStatus = response.responseBody?.status;

          // Handle different status values
          if (transferStatus === "SUCCESS" || transferStatus === "SUCCESSFUL") {
            logger.info(`Monnify: Transfer successful: ${data.reference}`, {
              amount: data.amount,
              destinationAccount: data.destinationAccountNumber,
              destinationBank: response.responseBody.destinationBankName,
              fee: response.responseBody.totalFee,
            });

            return {
              ...response.responseBody,
              status: "success",
              reference: data.reference,
            };
          } else if (
            transferStatus === "PENDING" ||
            transferStatus === "PROCESSING"
          ) {
            logger.warn(`Monnify: Transfer pending: ${data.reference}`, {
              amount: data.amount,
              statusReceived: transferStatus,
            });

            return {
              ...response.responseBody,
              status: "pending",
              reference: data.reference,
            };
          } else if (
            transferStatus === "FAILED" ||
            transferStatus === "FAILURE"
          ) {
            // Transfer was rejected by bank or Monnify
            logger.error(`Monnify: Transfer failed: ${data.reference}`, {
              amount: data.amount,
              status: transferStatus,
              responseBody: response.responseBody,
            });

            this.handleError(
              {
                responseMessage: `Transfer failed: ${
                  response.responseBody.destinationAccountName ||
                  "Bank rejected transaction"
                }`,
              },
              "Transfer",
              400,
              ERROR_CODES.THIRD_PARTY_ERROR,
            );
          } else {
            logger.error(
              `Monnify: Unknown transfer status: ${data.reference}`,
              {
                status: transferStatus,
                fullResponse: response,
              },
            );

            this.handleError(
              { responseMessage: `Unknown transfer status: ${transferStatus}` },
              "Transfer",
              500,
              ERROR_CODES.THIRD_PARTY_ERROR,
            );
          }
        } catch (error: any) {
          if (error instanceof AppError) {
            throw error;
          }

          return this.handleError(
            error,
            "Transfer",
            error.response?.status || 500,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  // Initialize payment (alternative to virtual account - redirect payment)
  async initiatePayment(data: {
    email: string;
    amount: number;
    reference: string;
    customerName: string;
    redirectUrl?: string;
  }): Promise<any> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "POST",
        "/api/v1/merchant/transactions/init-transaction",
        {
          amount: data.amount,
          customerName: data.customerName,
          customerEmail: data.email,
          paymentReference: data.reference,
          paymentDescription: "Wallet funding",
          currencyCode: "NGN",
          contractCode: this.provider.contractCode,
          redirectUrl: data.redirectUrl,
          paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
        },
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: response.responseMessage },
          "Payment initiation",
          400,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Monnify: Initiated payment: ${data.reference}`);
      return response.responseBody;
    } catch (error: any) {
      return this.handleError(
        error,
        "Payment initiation",
        400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Verify transfer status (for withdrawal tracking)
  async verifyTransfer(reference: string): Promise<any> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v2/disbursements/single/summary?reference=${reference}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Transfer verification failed" },
          "Transfer verification",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Verified transfer: ${reference}`);
      return {
        ...response.responseBody,
        _fullResponse: response,
        _provider: "monnify",
        _calculatedFee:
          response.responseBody?.amount -
            response.responseBody?.settlementAmount || 0,
      };
    } catch (error: any) {
      return this.handleError(
        error,
        "Transfer verification",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Delete/Deallocate reserved account
  async deleteVirtualAccount(accountReference: string): Promise<void> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "DELETE",
        `/api/v1/bank-transfer/reserved-accounts/${accountReference}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to delete virtual account" },
          "Delete virtual account",
          400,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Monnify: Deleted virtual account: ${accountReference}`);
    } catch (error: any) {
      this.handleError(
        error,
        "Delete virtual account",
        400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Get wallet balance
  async getWalletBalance(): Promise<number> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v1/disbursements/wallet-balance?accountNumber=${this.provider.walletAccountNumber}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to get wallet balance" },
          "Get wallet balance",
          500,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info("Monnify: Fetched wallet balance");
      return response.responseBody.availableBalance;
    } catch (error: any) {
      return this.handleError(
        error,
        "Get wallet balance",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Get reserved account details
  async getVirtualAccountDetails(
    accountReference: string,
  ): Promise<MonnifyAccountData> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v2/bank-transfer/reserved-accounts/${accountReference}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to get account details" },
          "Get virtual account details",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Retrieved account details: ${accountReference}`);
      return response.responseBody;
    } catch (error: any) {
      return this.handleError(
        error,
        "Get virtual account details",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get all reserved accounts for a customer
  async getCustomerVirtualAccounts(
    customerEmail: string,
  ): Promise<MonnifyAccountData[]> {
    try {
      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v2/bank-transfer/reserved-accounts?customerEmail=${customerEmail}`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to get customer accounts" },
          "Get customer virtual accounts",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Monnify: Retrieved accounts for ${customerEmail}`);
      return response.responseBody;
    } catch (error: any) {
      return this.handleError(
        error,
        "Get customer virtual accounts",
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get transactions for T+1 settlement reconciliation
  async getTransactions(data: {
    startDate: string; // Format: YYYY-MM-DD
    endDate: string; // Format: YYYY-MM-DD
    page?: number;
    pageSize?: number;
  }): Promise<any> {
    try {
      // Convert YYYY-MM-DD to Unix timestamp in milliseconds
      const startDateMs = new Date(data.startDate).getTime();
      const endDateMs = new Date(data.endDate).getTime();

      const pageNo = data.page ?? 0;
      const pageSize = data.pageSize ?? 50;

      const response = await this.makeAuthenticatedRequest(
        "GET",
        `/api/v1/disbursements/wallet/${this.provider.walletAccountNumber}/statement?startDate=${startDateMs}&endDate=${endDateMs}&pageNo=${pageNo}&pageSize=${pageSize}&enableTimeFilter=true`,
      );

      if (!response.requestSuccessful) {
        this.handleError(
          { responseMessage: "Failed to fetch transactions" },
          "Fetch transactions",
          500,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info("Monnify: Fetched transactions", {
        startDate: data.startDate,
        endDate: data.endDate,
        count: response.responseBody?.content?.length || 0,
      });

      return response.responseBody;
    } catch (error: any) {
      this.handleError(
        error,
        "Fetch transactions",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  //  ERROR HANDLING
  // Centralized error gating: any error caught here (or an inline provider
  // failure passed in as { responseMessage }) has its message gated by
  // NODE_ENV before becoming client-facing. statusCode/errorCode are passed
  // per call site to preserve each method's existing status/error code.
  private handleError(
    error: any,
    operationType: string,
    statusCode: number = 400,
    errorCode: string = ERROR_CODES.SERVICE_UNAVAILABLE,
  ): never {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error(`Monnify ${operationType} error:`, {
      status: error?.response?.status,
      data: error?.response?.data,
      message: error?.message,
    });

    const detailedErrorMessage =
      error?.response?.data?.responseMessage ||
      error?.responseMessage ||
      error?.message ||
      `${operationType} failed`;

    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : detailedErrorMessage;

    throw new AppError(finalErrorMessage, statusCode, errorCode);
  }
}
