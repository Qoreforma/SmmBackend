import { Types } from "mongoose";
import crypto from "crypto";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { ProviderService } from "@/services/client/ProviderService";
import { CacheService } from "@/services/core/CacheService";
import { Provider } from "@/models/reference/Provider";
import { Transaction } from "@/models/wallet/Transaction";
import {
  EmailOtpProductItem,
  EmailOtpDomainItem,
  BuyEmailOtpParams,
  BuyEmailOtpResult,
  EmailOtpCheckResult,
} from "@/types/fleexa";

export class EmailOtpService {
  constructor(
    private walletService: WalletService,
    private helperService: HelperService,
    private providerService: ProviderService,
    private cacheService: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helper: Resolve Active Provider for Email OTP
  // ---------------------------------------------------------------------------
  private async resolveProvider(
    requestedProvider?: string,
  ): Promise<{ code: string; providerDoc: any }> {
    if (requestedProvider) {
      let code = requestedProvider.toLowerCase().trim();
      if (code === "flexa") code = "fleexa";
      const doc = await Provider.findOne({ code, isActive: true }).lean();
      if (!doc) {
        throw new AppError(
          `Provider "${requestedProvider}" is not active or configured for Email OTP.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.NOT_FOUND,
        );
      }
      return { code, providerDoc: doc };
    }

    // Dynamic resolution based on ServiceTypeProvider priority
    const activeProviders = await this.providerService.getActiveProvidersByServiceTypeCode(
      TRANSACTION_TYPES.EMAIL_OTP,
    );

    if (activeProviders && activeProviders.length > 0) {
      const top = activeProviders[0];
      let code = top.code.toLowerCase();
      if (code === "flexa") code = "fleexa";
      const doc = await Provider.findOne({ code, isActive: true }).lean();
      if (doc) return { code, providerDoc: doc };
    }

    // Default fallback to Fleexa
    const fleexaDoc = await Provider.findOne({ code: "fleexa", isActive: true }).lean();
    return { code: "fleexa", providerDoc: fleexaDoc };
  }

  // ---------------------------------------------------------------------------
  // 1. Get Supported Sites / Products
  // ---------------------------------------------------------------------------
  async getProducts(providerCode?: string): Promise<EmailOtpProductItem[]> {
    const { code, providerDoc } = await this.resolveProvider(providerCode);
    const serviceCharge = await this.helperService.getServiceChargeCached(
      TRANSACTION_TYPES.EMAIL_OTP,
    );

    if (code === "fleexa") {
      const rawProducts = await this.providerService.getFleexaEmailProducts();
      const markupPercent = Number(providerDoc?.markupPercent ?? providerDoc?.markup_percent ?? 0);
      const items: EmailOtpProductItem[] = [];

      for (const p of rawProducts || []) {
        const rawNgn = parseFloat(String(p.price_ngn || "0")) || 0;
        const providerCostNgn =
          markupPercent > 0
            ? Math.ceil(rawNgn * (1 + markupPercent / 100))
            : Math.ceil(rawNgn);

        let finalCost = providerCostNgn;
        if (serviceCharge && providerCostNgn > 0) {
          if (serviceCharge.type === "percentage") {
            const fee = (providerCostNgn * serviceCharge.value) / 100;
            const cappedFee = serviceCharge.cap > 0 ? Math.min(fee, serviceCharge.cap) : fee;
            finalCost = Math.ceil(providerCostNgn + cappedFee);
          } else {
            finalCost = Math.ceil(providerCostNgn + serviceCharge.value);
          }
        }

        items.push({
          id: p.id,
          name: (p.name || p.id).toUpperCase(),
          cost: finalCost,
          providerPrice: providerCostNgn,
          provider: "fleexa",
        });
      }

      return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // 2. Get Domains Available for a Site (e.g. telegram -> @outlook.com, @gmail.com)
  // ---------------------------------------------------------------------------
  async getDomains(site: string, providerCode?: string): Promise<EmailOtpDomainItem[]> {
    if (!site) {
      throw new AppError("Site is required", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const { code, providerDoc } = await this.resolveProvider(providerCode);
    const serviceCharge = await this.helperService.getServiceChargeCached(
      TRANSACTION_TYPES.EMAIL_OTP,
    );

    if (code === "fleexa") {
      const rawDomains = await this.providerService.getFleexaEmailDomains(site);
      const markupPercent = Number(providerDoc?.markupPercent ?? providerDoc?.markup_percent ?? 0);
      const items: EmailOtpDomainItem[] = [];

      for (const d of rawDomains || []) {
        const rawNgn = parseFloat(String(d.price_ngn || "0")) || 0;
        const providerCostNgn =
          markupPercent > 0
            ? Math.ceil(rawNgn * (1 + markupPercent / 100))
            : Math.ceil(rawNgn);

        let finalCost = providerCostNgn;
        if (serviceCharge && providerCostNgn > 0) {
          if (serviceCharge.type === "percentage") {
            const fee = (providerCostNgn * serviceCharge.value) / 100;
            const cappedFee = serviceCharge.cap > 0 ? Math.min(fee, serviceCharge.cap) : fee;
            finalCost = Math.ceil(providerCostNgn + cappedFee);
          } else {
            finalCost = Math.ceil(providerCostNgn + serviceCharge.value);
          }
        }

        items.push({
          domain: d.name,
          cost: finalCost,
          providerPrice: providerCostNgn,
          availableCount: d.count ?? 50,
          provider: "fleexa",
        });
      }

      return items.sort((a, b) => a.cost - b.cost);
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // 3. Search Site Support
  // ---------------------------------------------------------------------------
  async searchSite(query: string, providerCode?: string) {
    if (!query) {
      throw new AppError("Search query is required", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const { code } = await this.resolveProvider(providerCode);
    if (code === "fleexa") {
      return await this.providerService.searchFleexaEmailSite(query);
    }

    return { valid: false, site: query, domains: [] };
  }

  // ---------------------------------------------------------------------------
  // 4. Buy Disposable Email for OTP
  // ---------------------------------------------------------------------------
  async buyEmailOtp(data: BuyEmailOtpParams): Promise<BuyEmailOtpResult> {
    const reference = `EML-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    return SentryHelper.trackCriticalOperation("email_otp_buy", async () => {
      const { code: providerCode } = await this.resolveProvider(data.provider);

      // 1. Fetch available domains for the site to resolve pricing
      const domains = await this.getDomains(data.site, providerCode);
      const targetDomain = domains.find(
        (d) => d.domain.toLowerCase() === data.domain.toLowerCase(),
      );

      if (!targetDomain) {
        throw new AppError(
          `Domain "${data.domain}" is currently not available for site "${data.site}". Available domains: ${domains.map((d) => d.domain).join(", ")}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // 2. Compute cost and service charge
      const baseAmount = targetDomain.providerPrice || targetDomain.cost;
      const chargeCalculation = await this.helperService.calculateAmountWithCharge(
        baseAmount,
        TRANSACTION_TYPES.EMAIL_OTP,
      );

      // 3. Check wallet balance
      const wallet = await this.walletService.getWallet(data.userId);
      if (!wallet) {
        throw new AppError("Wallet not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
      }

      if (wallet.balance < chargeCalculation.totalAmount) {
        throw new AppError(
          "Insufficient wallet balance",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      // 4. Debit wallet
      const debitResult = await this.walletService.debitWallet(
        data.userId,
        chargeCalculation.totalAmount,
        `Email OTP: ${data.site} (${data.domain})`,
        {
          type: TRANSACTION_TYPES.EMAIL_OTP,
          provider: providerCode,
          channel: (data.channel as any) || "web",
          idempotencyKey: reference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          remark: `Email OTP: ${data.site} (${data.domain}) (Ref: ${reference})`,
          meta: {
            site: data.site,
            domain: data.domain,
            pollingProvider: providerCode,
            chargeInfo: {
              baseAmount,
              serviceCharge: chargeCalculation.chargeAmount,
              totalAmount: chargeCalculation.totalAmount,
              isServiceChargeCapped: chargeCalculation.isCapped,
            },
          },
        },
      );

      const transaction = debitResult.transaction;

      // 5. Call provider to purchase email
      try {
        const result = await this.providerService.buyFleexaEmail({
          site: data.site,
          domain: data.domain,
        });

        const emailId = String(result.emailId);
        const emailAddress = result.email;

        // 6. Update transaction with email and polling schedule
        const updatedTx = await Transaction.findByIdAndUpdate(
          transaction.id || (transaction as any)._id,
          {
            status: "pending",
            providerReference: emailId,
            meta: {
              ...transaction.meta,
              providerOrderId: emailId,
              emailId,
              email: emailAddress,
              pollingProvider: providerCode,
              purchasedAt: new Date(),
            },
            polling: {
              nextPollAt: new Date(Date.now() + 15000), // First poll in 15 seconds
              pollCount: 0,
              providerOrderId: emailId,
              pollingProvider: providerCode,
              startedAt: new Date(),
            },
          },
          { new: true },
        ).lean();

        return {
          transaction: updatedTx || transaction,
          order: {
            reference,
            emailId,
            email: emailAddress,
            site: data.site,
            domain: data.domain,
            status: "waiting",
            provider: providerCode,
          },
        };
      } catch (providerErr: any) {
        logger.error(`Email OTP purchase failed for ${reference} on ${providerCode}`, {
          error: providerErr.message,
          userId: data.userId,
        });

        // Auto-refund user wallet
        try {
          await this.walletService.creditWallet(
            data.userId,
            chargeCalculation.totalAmount,
            `Refund: Email OTP purchase failed (${data.site})`,
            {
              type: TRANSACTION_TYPES.EMAIL_OTP,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: providerErr.message || "Provider Email OTP purchase failed",
              },
            },
          );

          await Transaction.findByIdAndUpdate(
            transaction.id || (transaction as any)._id,
            {
              status: "failed",
              meta: {
                ...transaction.meta,
                failureReason: providerErr.message || "Provider error",
                refunded: true,
              },
            },
          );
        } catch (refundErr: any) {
          logger.error(`Critical: Refund failed for Email OTP ${reference}`, refundErr);
        }

        throw new AppError(
          providerErr.message || "Email OTP purchase failed. Your wallet has been refunded.",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Check / Poll Email OTP Status
  // ---------------------------------------------------------------------------
  async checkEmailOtp(reference: string, userId: string): Promise<EmailOtpCheckResult> {
    const tx = await Transaction.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.EMAIL_OTP,
    });

    if (!tx) {
      throw new AppError("Email OTP transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const meta = tx.meta || {};

    if (tx.status === "success" && meta.otpCode) {
      return {
        status: "received",
        email: meta.email || "",
        code: meta.otpCode,
        smsText: meta.sms,
        completedAt: tx.updatedAt,
      };
    }

    if (tx.status === "reversed" || tx.status === "failed") {
      return {
        status: tx.status,
        email: meta.email || "",
        message: meta.failureReason || "Email OTP was cancelled or refunded",
      };
    }

    const emailId = meta.emailId || meta.providerOrderId || tx.providerReference;
    if (!emailId) {
      throw new AppError("No provider order ID found for this email", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    // Query Fleexa Email status
    const checkData = await this.providerService.checkFleexaEmailStatus(emailId);
    const rawCode = String(checkData.code || "").toUpperCase();
    const otp = checkData.code_received || checkData.sms || "";

    if (rawCode === "RECEIVED" || (otp && rawCode !== "WAITING")) {
      await Transaction.findByIdAndUpdate(tx._id, {
        status: "success",
        "polling.stoppedAt": new Date(),
        "polling.stopReason": "completed",
        meta: {
          ...meta,
          otpCode: otp,
          sms: checkData.sms,
          code_received: checkData.code_received,
          receivedAt: new Date(),
          providerStatus: rawCode,
        },
      });

      return {
        status: "received",
        email: checkData.email || meta.email || "",
        code: otp,
        smsText: checkData.sms,
      };
    }

    if (rawCode === "CANCELED" || rawCode === "CANCELLED" || rawCode === "EXPIRED") {
      const refundAmount = tx.amount;
      try {
        await this.walletService.creditWallet(
          userId,
          refundAmount,
          `Refund: Email OTP ${rawCode.toLowerCase()} (${meta.site || "site"})`,
          {
            type: TRANSACTION_TYPES.EMAIL_OTP,
            provider: "system",
            idempotencyKey: `REFUND-${reference}`,
            initiatedBy: new Types.ObjectId(userId),
            initiatedByType: "system",
            meta: {
              originalReference: reference,
              reason: `Email OTP order was ${rawCode.toLowerCase()}`,
            },
          },
        );

        await Transaction.findByIdAndUpdate(tx._id, {
          status: "reversed",
          "polling.stoppedAt": new Date(),
          "polling.stopReason": "failed",
          meta: {
            ...meta,
            failureReason: `Email OTP ${rawCode.toLowerCase()} without receiving code`,
            refunded: true,
          },
        });
      } catch (err: any) {
        logger.error(`Failed to refund expired Email OTP ${reference}`, err);
      }

      return {
        status: "refunded",
        email: meta.email || "",
        message: `Email OTP order was ${rawCode.toLowerCase()}. Your wallet has been refunded.`,
      };
    }

    return {
      status: "waiting",
      email: checkData.email || meta.email || "",
      message: "Waiting for verification code to be received...",
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Cancel Email OTP (Allowed after 2 minutes per Fleexa policy)
  // ---------------------------------------------------------------------------
  async cancelEmailOtp(reference: string, userId: string) {
    const tx = await Transaction.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.EMAIL_OTP,
    });

    if (!tx) {
      throw new AppError("Email OTP transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    if (tx.status !== "pending") {
      throw new AppError(
        `Cannot cancel an Email OTP that is in '${tx.status}' status. Only pending orders can be cancelled.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    // Fleexa policy check: cancellation must be after 2 minutes of purchase
    const createdAt = new Date(tx.createdAt).getTime();
    const elapsedMs = Date.now() - createdAt;
    const twoMinutesMs = 2 * 60 * 1000;

    if (elapsedMs < twoMinutesMs) {
      const remainingSeconds = Math.ceil((twoMinutesMs - elapsedMs) / 1000);
      throw new AppError(
        `Fleexa policy: Email OTP can only be cancelled after 2 minutes of purchase. Please wait another ${remainingSeconds} second(s).`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
      );
    }

    const meta = tx.meta || {};
    const emailId = meta.emailId || meta.providerOrderId || tx.providerReference;
    const refundAmount = tx.amount;

    if (emailId) {
      try {
        await this.providerService.cancelFleexaEmail(emailId);
      } catch (err: any) {
        logger.warn(`Could not cancel Email OTP ${emailId} on Fleexa:`, err);
      }
    }

    try {
      await this.walletService.creditWallet(
        userId,
        refundAmount,
        `Refund: Email OTP cancelled (${meta.site || "site"})`,
        {
          type: TRANSACTION_TYPES.EMAIL_OTP,
          provider: "system",
          idempotencyKey: `REFUND-${reference}`,
          initiatedBy: new Types.ObjectId(userId),
          initiatedByType: "system",
          meta: {
            originalReference: reference,
            reason: "User requested Email OTP cancellation",
          },
        },
      );

      await Transaction.findByIdAndUpdate(tx._id, {
        status: "reversed",
        "polling.stoppedAt": new Date(),
        "polling.stopReason": "failed",
        meta: {
          ...meta,
          failureReason: "Cancelled by user",
          refunded: true,
          cancelledAt: new Date(),
        },
      });

      return {
        status: "cancelled",
        refundedAmount: refundAmount,
        message: "Email OTP cancelled and wallet refunded successfully.",
      };
    } catch (err: any) {
      logger.error(`EmailOtpService.cancelEmailOtp: refund failed for ${reference}`, err);
      throw new AppError(
        "Cancellation failed — please contact support if funds were not returned.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }
}
