import { PROVIDERS } from "@/config";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { ERROR_CODES } from "@/utils/constants";
import { formatPhoneNumber } from "@/utils/helpers";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import axios, { AxiosInstance } from "axios";

export interface FlutterwaveAccountData {
  account_number: string;
  account_reference: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  email: string;
  bvn: string;
  amount?: number;
  split_code?: string;
  tx_ref: string;
  frequency: string;
  duration?: string;
  is_permanent: boolean;
  created_at: string;
  expiry_date?: string;
}

export interface FlutterwaveCreateAccountRes {
  status: string;
  message: string;
  data: FlutterwaveAccountData;
}

export interface FlutterwaveBankData {
  id: number;
  code: string;
  name: string;
}

export interface FlutterwaveTransferData {
  id: number;
  account_number: string;
  bank_code: string;
  full_name: string;
  created_at: string;
  currency: string;
  debit_currency?: string;
  amount: number;
  fee: number;
  status: string;
  reference: string;
  meta?: any;
  narration: string;
  complete_message: string;
  requires_approval: number;
  is_approved: number;
  bank_name: string;
}

export interface FlutterwaveBalanceData {
  currency: string;
  available_balance: number;
  ledger_balance: number;
}

export interface FlutterwavePaymentInitResponse {
  paymentUrl: string;
  reference: string;
  expiresAt: string;
}

export interface FlutterwaveUSSDResponse {
  ussdCode: string;
  paymentCode: string;
  reference: string;
}

export class FlutterwaveService {
  private client: AxiosInstance;
  private provider = PROVIDERS.FLUTTERWAVE;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.provider.secretKey}`,
      },
      validateStatus: () => true,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.code === "ECONNABORTED") {
          logger.error("Flutterwave request timeout:", {
            url: error.config?.url,
            timeout: error.config?.timeout,
          });
          throw new AppError(
            "Request timeout - please try again",
            408,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
        throw error;
      },
    );
  }

  private isSuccessResponse(status: string): boolean {
    return status === "success";
  }

  async nameEnquiry(
    accountNumber: string,
    accountBank: string,
  ): Promise<{ accountNumber: string; accountName: string; bankCode: string }> {
    try {
      const response = await this.client.post("/accounts/resolve", {
        account_number: accountNumber,
        account_bank: accountBank,
      });

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Flutterwave name enquiry failed:", {
          status: response.status,
          data: response.data,
        });

        const nameEnquiryFailMessage =
          process.env.NODE_ENV === "production"
            ? "Account verification failed. Please try again later."
            : response.data?.message || "Account verification failed";

        throw new AppError(
          nameEnquiryFailMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Flutterwave: Verified account: ${accountNumber}`);
      return {
        accountNumber: response.data.data.account_number,
        accountName: response.data.data.account_name,
        bankCode: accountBank,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error verifying bank account:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Account verification failed. Please try again later."
          : error.response?.data?.message || "Account verification failed";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get list of Nigerian banks
  async getBanks(country: string = "NG"): Promise<FlutterwaveBankData[]> {
    try {
      const response = await this.client.get(`/banks/${country}`);

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to fetch banks:", {
          status: response.status,
          data: response.data,
        });

        const getBanksFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to fetch banks. Please try again later."
            : response.data?.message || "Failed to fetch banks";

        throw new AppError(
          getBanksFailMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info(`Flutterwave: Fetched banks for ${country}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error fetching banks:", error);
      throw new AppError(
        "Failed to fetch banks",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Create Virtual Account Number (VAN)
  // Can be temporary or permanent based on is_permanent flag
  async createVirtualAccount(data: {
    email: string;
    firstname: string;
    lastname: string;
    reference: string;
    bvn: string;
    phone?: string;
    isPermanent?: boolean;
    amount?: number; // For temporary accounts
  }): Promise<FlutterwaveAccountData> {
    try {
      const payload: any = {
        email: data.email,
        is_permanent: data.isPermanent !== false, // Default to true
        bvn: data.bvn,
        tx_ref: data.reference,
        firstname: data.firstname,
        lastname: data.lastname,
        narration: `${data.firstname} ${data.lastname}`,
      };

      // Add phone if provided
      if (data.phone) {
        payload.phonenumber = data.phone.startsWith("234")
          ? data.phone
          : "234" + data.phone.replace(/^0/, "");
      }

      // For temporary accounts, amount is required
      if (!data.isPermanent && data.amount) {
        payload.amount = data.amount;
      }

      logger.info("Creating Flutterwave virtual account:", {
        email: payload.email,
        isPermanent: payload.is_permanent,
      });

      const response = await this.client.post(
        "/virtual-account-numbers",
        payload,
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to create virtual account:", {
          status: response.status,
          data: response.data,
        });

        const createVAFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to create virtual account. Please try again later."
            : response.data?.message || "Failed to create virtual account";

        throw new AppError(
          createVAFailMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Flutterwave: Created virtual account for ${data.email}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error creating virtual account:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to create virtual account. Please try again later."
          : error.response?.data?.message || "Failed to create virtual account";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  async createVirtualAccountForTransfer(data: {
    email: string;
    firstname: string;
    lastname: string;
    reference: string;
    bvn: string;
    phone?: string;
    isPermanent?: boolean;
    amount?: number;
  }): Promise<FlutterwaveAccountData> {
    try {
      const payload: any = {
        email: data.email,
        is_permanent: data.isPermanent !== false,
        bvn: data.bvn,
        tx_ref: data.reference,
        firstname: data.firstname,
        lastname: data.lastname,
        narration: `${data.firstname} ${data.lastname}`,
      };

      if (data.phone) {
        payload.phonenumber = formatPhoneNumber(data.phone);
        logger.debug("Formatted phone number:", {
          original: data.phone,
          formatted: payload.phonenumber,
        });
      }

      if (!data.isPermanent && data.amount) {
        payload.amount = data.amount;
      }

      const response = await this.client.post(
        "/virtual-account-numbers",
        payload,
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        throw new AppError(
          process.env.NODE_ENV === "production"
            ? "Failed to create virtual account. Please try again later."
            : response.data?.message || "Failed to create virtual account",
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Flutterwave: Created virtual account for ${data.email}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error creating virtual account:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to create virtual account. Please try again later."
          : error.response?.data?.message || "Failed to create virtual account";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Initiate Card Payment
  async initiateCardPayment(data: {
    txRef: string;
    amount: number;
    currency?: string;
    redirectUrl: string;
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
  }): Promise<FlutterwavePaymentInitResponse> {
    return SentryHelper.trackCriticalOperation(
      "flutterwave_card_payment",
      async () => {
        try {
          const payload: any = {
            tx_ref: data.txRef,
            amount: data.amount,
            currency: data.currency || "NGN",
            redirect_url: data.redirectUrl,
            customer: {
              email: data.customerEmail,
              name: data.customerName,
              phonenumber: data.customerPhone,
            },
            customizations: {
              title: "Wallet Funding",
              description: "Fund your wallet",
            },
            payment_options: "card", // Only card
          };

          const response = await this.client.post("/payments", payload);

          if (
            response.status !== 200 ||
            !this.isSuccessResponse(response.data.status)
          ) {
            throw new AppError(
              process.env.NODE_ENV === "production"
                ? "Card payment initiation failed. Please try again later."
                : response.data?.message || "Card payment initiation failed",
              response.status,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Flutterwave: Card payment initiated: ${data.txRef}`);
          return {
            paymentUrl: response.data.data.link,
            reference: data.txRef,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;

          logger.error("Flutterwave: Error initiating card payment:", error);

          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Card payment initiation failed. Please try again later."
              : error.response?.data?.message ||
                "Card payment initiation failed";

          throw new AppError(
            finalErrorMessage,
            error.response?.status || 400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.txRef,
    );
  }

  // Initiate Mobile Money Payment
  async initiateMobileMoneyPayment(data: {
    txRef: string;
    amount: number;
    currency: string; // e.g., "KES" for M-PESA, "GHS" for Ghana Mobile Money
    customerEmail: string;
    customerName: string;
    customerPhone: string;
    network?: string; // e.g., "MTN", "VODAFONE", "TIGO"
  }): Promise<FlutterwavePaymentInitResponse> {
    return SentryHelper.trackCriticalOperation(
      "flutterwave_mobile_money",
      async () => {
        try {
          const payload: any = {
            tx_ref: data.txRef,
            amount: data.amount,
            currency: data.currency,
            redirect_url: `${process.env.BASE_URL}/api/v1/webhooks/flutterwave/callback`,
            customer: {
              email: data.customerEmail,
              name: data.customerName,
              phonenumber: data.customerPhone,
            },
            customizations: {
              title: "Wallet Funding",
              description: "Fund your wallet via Mobile Money",
            },
            payment_options: "mobilemoneyghana", // Or other mobile money options
          };

          if (data.network) {
            payload.network = data.network;
          }

          const response = await this.client.post("/payments", payload);

          if (
            response.status !== 200 ||
            !this.isSuccessResponse(response.data.status)
          ) {
            throw new AppError(
              process.env.NODE_ENV === "production"
                ? "Mobile money payment initiation failed. Please try again later."
                : response.data?.message ||
                    "Mobile money payment initiation failed",
              response.status,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(
            `Flutterwave: Mobile money payment initiated: ${data.txRef}`,
          );
          return {
            paymentUrl: response.data.data.link,
            reference: data.txRef,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          };
        } catch (error: any) {
          if (error instanceof AppError) throw error;

          logger.error(
            "Flutterwave: Error initiating mobile money payment:",
            error,
          );

          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Mobile money payment initiation failed. Please try again later."
              : error.response?.data?.message ||
                "Mobile money payment initiation failed";

          throw new AppError(
            finalErrorMessage,
            error.response?.status || 400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.txRef,
    );
  }

  // Get Virtual Account Details
  async getVirtualAccountDetails(
    orderRef: string,
  ): Promise<FlutterwaveAccountData> {
    try {
      const response = await this.client.get(
        `/virtual-account-numbers/${orderRef}`,
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to get virtual account details:", {
          status: response.status,
          data: response.data,
        });

        const getVADetailsFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to get account details. Please try again later."
            : response.data?.message || "Failed to get account details";

        throw new AppError(
          getVADetailsFailMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Flutterwave: Retrieved account details: ${orderRef}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error getting account details:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to get account details. Please try again later."
          : error.response?.data?.message || "Failed to get account details";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Update BVN for existing virtual account
  async updateVirtualAccountBVN(data: {
    orderRef: string;
    bvn: string;
  }): Promise<FlutterwaveAccountData> {
    try {
      const response = await this.client.put(
        `/virtual-account-numbers/${data.orderRef}`,
        {
          bvn: data.bvn,
        },
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to update virtual account BVN:", {
          status: response.status,
          data: response.data,
        });

        const updateBVNFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to update account BVN. Please try again later."
            : response.data?.message || "Failed to update account BVN";

        throw new AppError(
          updateBVNFailMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Flutterwave: Updated BVN for account: ${data.orderRef}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error updating account BVN:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to update account BVN. Please try again later."
          : error.response?.data?.message || "Failed to update account BVN";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Verify Transaction
  async verifyTransaction(transactionId: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/transactions/${transactionId}/verify`,
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Transaction verification failed:", {
          status: response.status,
          data: response.data,
        });

        const verifyTxFailMessage =
          process.env.NODE_ENV === "production"
            ? "Transaction verification failed. Please try again later."
            : response.data?.message || "Transaction verification failed";

        throw new AppError(
          verifyTxFailMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Flutterwave: Verified transaction: ${transactionId}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error verifying transaction:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction verification failed. Please try again later."
          : error.response?.data?.message || "Transaction verification failed";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Initiate Transfer/Payout
  async initiateTransfer(data: {
    accountBank: string;
    accountNumber: string;
    amount: number;
    narration: string;
    reference: string;
    currency?: string;
    callbackUrl?: string;
    beneficiaryName?: string;
  }): Promise<FlutterwaveTransferData> {
    return SentryHelper.trackCriticalOperation(
      "flutterwave_transfer",
      async () => {
        try {
          const payload: any = {
            account_bank: data.accountBank,
            account_number: data.accountNumber,
            amount: data.amount,
            narration: data.narration,
            currency: data.currency || "NGN",
            reference: data.reference,
            callback_url: data.callbackUrl,
            debit_currency: data.currency || "NGN",
          };

          // Add beneficiary name if provided
          if (data.beneficiaryName) {
            payload.beneficiary_name = data.beneficiaryName;
          }

          logger.info("Initiating Flutterwave transfer:", {
            reference: data.reference,
            amount: data.amount,
            accountNumber: data.accountNumber,
          });

          const response = await this.client.post("/transfers", payload);

          if (
            response.status !== 200 ||
            !this.isSuccessResponse(response.data.status)
          ) {
            logger.error("Transfer initiation failed:", {
              status: response.status,
              data: response.data,
            });

            const initiateTransferFailMessage =
              process.env.NODE_ENV === "production"
                ? "Transfer failed. Please try again later."
                : response.data?.message || "Transfer failed";

            throw new AppError(
              initiateTransferFailMessage,
              response.status,
              ERROR_CODES.SERVICE_UNAVAILABLE,
            );
          }

          logger.info(`Flutterwave: Transfer initiated: ${data.reference}`);
          return response.data.data;
        } catch (error: any) {
          if (error instanceof AppError) throw error;

          logger.error("Flutterwave: Error initiating transfer:", error);

          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Transfer failed. Please try again later."
              : error.response?.data?.message || "Transfer failed";

          throw new AppError(
            finalErrorMessage,
            error.response?.status || 400,
            ERROR_CODES.SERVICE_UNAVAILABLE,
          );
        }
      },
      data.reference,
    );
  }

  // Get Transfer Details/Status
  async getTransferStatus(transferId: string): Promise<any> {
    try {
      const response = await this.client.get(`/transfers/${transferId}`);

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to get transfer status:", {
          status: response.status,
          data: response.data,
        });

        const getTransferStatusFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to get transfer status. Please try again later."
            : response.data?.message || "Failed to get transfer status";

        throw new AppError(
          getTransferStatusFailMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Flutterwave: Retrieved transfer status: ${transferId}`);
      return {
        ...response.data.data,
        _fullResponse: response.data,
        _provider: "flutterwave",
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error getting transfer status:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to get transfer status. Please try again later."
          : error.response?.data?.message || "Failed to get transfer status";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Retry Failed Transfer
  async retryTransfer(transferId: string): Promise<FlutterwaveTransferData> {
    try {
      const response = await this.client.post(
        `/transfers/${transferId}/retries`,
      );

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Transfer retry failed:", {
          status: response.status,
          data: response.data,
        });

        const retryTransferFailMessage =
          process.env.NODE_ENV === "production"
            ? "Transfer retry failed. Please try again later."
            : response.data?.message || "Transfer retry failed";

        throw new AppError(
          retryTransferFailMessage,
          response.status,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      logger.info(`Flutterwave: Retried transfer: ${transferId}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error retrying transfer:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transfer retry failed. Please try again later."
          : error.response?.data?.message || "Transfer retry failed";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Calculate default transfer fee (fallback)
  private calculateDefaultFee(amount: number): number {
    // Flutterwave typical fee structure
    if (amount <= 5000) return 10.75;
    if (amount <= 50000) return 26.88;
    return 53.75;
  }

  // Get Wallet Balance
  async getWalletBalance(
    currency: string = "NGN",
  ): Promise<FlutterwaveBalanceData> {
    try {
      const response = await this.client.get(`/balances/${currency}`);

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to get wallet balance:", {
          status: response.status,
          data: response.data,
        });

        const getWalletBalanceFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to get wallet balance. Please try again later."
            : response.data?.message || "Failed to get wallet balance";

        throw new AppError(
          getWalletBalanceFailMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info(`Flutterwave: Retrieved wallet balance for ${currency}`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error getting wallet balance:", error);
      throw new AppError(
        "Failed to get wallet balance",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }

  // Verify BVN
  async verifyBVN(bvn: string): Promise<any> {
    try {
      const response = await this.client.get(`/kyc/bvns/${bvn}`);

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("BVN verification failed:", {
          status: response.status,
          data: response.data,
        });

        const verifyBVNFailMessage =
          process.env.NODE_ENV === "production"
            ? "BVN verification failed. Please try again later."
            : response.data?.message || "BVN verification failed";

        throw new AppError(
          verifyBVNFailMessage,
          response.status,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      logger.info(`Flutterwave: Verified BVN: ${bvn.substring(0, 3)}***`);
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error verifying BVN:", error);

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "BVN verification failed. Please try again later."
          : error.response?.data?.message || "BVN verification failed";

      throw new AppError(
        finalErrorMessage,
        error.response?.status || 400,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  // Get Transactions
  async getTransactions(params?: {
    from?: string;
    to?: string;
    page?: number;
    currency?: string;
    status?: string;
  }): Promise<any> {
    try {
      const response = await this.client.get("/transactions", {
        params: {
          from: params?.from,
          to: params?.to,
          page: params?.page || 1,
          currency: params?.currency,
          status: params?.status,
        },
      });

      if (
        response.status !== 200 ||
        !this.isSuccessResponse(response.data.status)
      ) {
        logger.error("Failed to get transactions:", {
          status: response.status,
          data: response.data,
        });

        const getTransactionsFailMessage =
          process.env.NODE_ENV === "production"
            ? "Failed to get transactions. Please try again later."
            : response.data?.message || "Failed to get transactions";

        throw new AppError(
          getTransactionsFailMessage,
          response.status,
          ERROR_CODES.THIRD_PARTY_ERROR,
        );
      }

      logger.info("Flutterwave: Retrieved transactions");
      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Flutterwave: Error getting transactions:", error);
      throw new AppError(
        "Failed to get transactions",
        500,
        ERROR_CODES.THIRD_PARTY_ERROR,
      );
    }
  }
}
