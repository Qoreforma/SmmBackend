import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { ProviderService } from "@/services/client/ProviderService";
import { Provider } from "@/models/reference/Provider";
import { Transaction } from "@/models/wallet/Transaction";
import { User } from "@/models/core/User";
import {
  NumberRentalCountry,
  NumberRentalServiceItem,
  RentNumberParams,
  RentNumberResult,
  OtpCheckResult,
} from "@/types/fivesim";
import crypto from "crypto";

export interface RentNumberData extends RentNumberParams {
  areaCode?: string;
  carrier?: string;
}

export class NumberRentalService {
  constructor(
    private walletService: WalletService,
    private helperService: HelperService,
    private providerService: ProviderService,
  ) {}

  // -------------------------------------------------------------------------
  // Helper: Resolve Active Provider (Multi-Provider Strategy via Admin Priority)
  // -------------------------------------------------------------------------
  private async resolveProvider(
    requestedProvider?: string,
  ): Promise<{ code: string; providerDoc: any }> {
    if (requestedProvider) {
      let code = requestedProvider.toLowerCase().trim();
      if (code === "5sim") code = "fivesim";
      if (code === "flexa") code = "fleexa";
      if (code === "textverified") code = "textverified";
      const doc = await Provider.findOne({ code, isActive: true }).lean();
      if (!doc) {
        throw new AppError(
          `Provider "${requestedProvider}" is not active or configured.`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.NOT_FOUND,
        );
      }
      return { code, providerDoc: doc };
    }

    // Dynamic resolution based on ServiceTypeProvider priority (like SMM)
    const activeProviders = await this.providerService.getActiveProvidersByServiceTypeCode(
      TRANSACTION_TYPES.NUMBER_RENTAL,
    );

    if (activeProviders && activeProviders.length > 0) {
      const top = activeProviders[0];
      let code = top.code.toLowerCase();
      if (code === "5sim") code = "fivesim";
      if (code === "flexa") code = "fleexa";
      if (code === "textverified") code = "textverified";
      const doc = await Provider.findOne({ code, isActive: true }).lean();
      return { code, providerDoc: doc };
    }

    // Default fallback order: 5SIM -> Textverified -> Fleexa -> Owlet
    const fivesimDoc = await Provider.findOne({ code: "fivesim", isActive: true }).lean();
    if (fivesimDoc) return { code: "fivesim", providerDoc: fivesimDoc };

    const textverifiedDoc = await Provider.findOne({ code: "textverified", isActive: true }).lean();
    if (textverifiedDoc) return { code: "textverified", providerDoc: textverifiedDoc };

    const fleexaDoc = await Provider.findOne({ code: "fleexa", isActive: true }).lean();
    if (fleexaDoc) return { code: "fleexa", providerDoc: fleexaDoc };

    const owletDoc = await Provider.findOne({ code: "owlet", isActive: true }).lean();
    return { code: "owlet", providerDoc: owletDoc };
  }

  // -------------------------------------------------------------------------
  // Get available countries for virtual number rental
  // -------------------------------------------------------------------------
  async getCountries(providerCode?: string): Promise<NumberRentalCountry[]> {
    const { code } = await this.resolveProvider(providerCode);

    if (code === "fivesim") {
      const rawCountries = await this.providerService.getFiveSimCountries();
      if (!rawCountries || typeof rawCountries !== "object") return [];

      return Object.entries(rawCountries)
        .map(([cCode, data]: [string, any]) => {
          const isoKeys = data.iso ? Object.keys(data.iso) : [];
          const prefixKeys = data.prefix ? Object.keys(data.prefix) : [];
          const name = data.text_en || cCode.charAt(0).toUpperCase() + cCode.slice(1);
          return {
            code: cCode,
            name,
            iso: isoKeys[0] || "",
            prefix: prefixKeys[0] || "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (code === "fleexa" || code === "textverified") {
      // Fleexa and Textverified specialize in US virtual numbers
      return [
        { code: "US", name: "United States", iso: "us", prefix: "+1" },
      ];
    }

    // Fallback countries for Owlet
    return [
      { code: "NG", name: "Nigeria", prefix: "+234" },
      { code: "US", name: "United States", prefix: "+1" },
      { code: "GB", name: "United Kingdom", prefix: "+44" },
    ];
  }

  // -------------------------------------------------------------------------
  // Get available services / apps for a country with dynamic ServiceCharge fee
  // -------------------------------------------------------------------------
  async getServices(
    country: string,
    providerCode?: string,
    operator: string = "any",
  ): Promise<NumberRentalServiceItem[]> {
    const { code, providerDoc } = await this.resolveProvider(providerCode);
    const serviceCharge = await this.helperService.getServiceChargeCached(
      TRANSACTION_TYPES.NUMBER_RENTAL,
    );

    if (code === "fivesim") {
      const rawProducts = await this.providerService.getFiveSimProducts(country, operator);

      const rawRate = providerDoc?.usdNgnRate ?? providerDoc?.usd_ngn_rate;
      if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
        throw new AppError(
          `Provider "5SIM" does not have usd_ngn_rate configured in Provider model. Please configure usd_ngn_rate in admin provider settings.`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.CONFIGURATION_ERROR,
        );
      }
      const usdToNgnRate = Number(rawRate);
      const markupPercent = Number(providerDoc?.markupPercent ?? providerDoc?.markup_percent ?? 0);

      const items: NumberRentalServiceItem[] = [];

      for (const [productKey, item] of Object.entries(rawProducts || {})) {
        if (!item || item.Category !== "activation" || item.Qty <= 0) continue;

        // Base price in NGN: USD price * usdToNgnRate
        const rawNgnPrice = item.Price * usdToNgnRate;
        const providerCostNgn =
          markupPercent > 0
            ? Math.ceil(rawNgnPrice * (1 + markupPercent / 100))
            : Math.ceil(rawNgnPrice);

        // Apply service charge
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
          service: productKey,
          name: productKey.charAt(0).toUpperCase() + productKey.slice(1),
          cost: finalCost,
          providerPrice: providerCostNgn,
          availableCount: item.Qty,
          provider: "fivesim",
        });
      }

      return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (code === "fleexa") {
      const rawApps = await this.providerService.getFleexaSmsApps();
      const markupPercent = Number(providerDoc?.markupPercent ?? providerDoc?.markup_percent ?? 0);
      const items: NumberRentalServiceItem[] = [];

      for (const app of rawApps || []) {
        const rawNgn = parseFloat(String(app.price_ngn || "0")) || 0;
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

        const appKey = app.service_name || app.name || app.id;
        items.push({
          service: appKey,
          name: (app.name || app.service_name || app.id || "").toUpperCase(),
          cost: finalCost,
          providerPrice: providerCostNgn,
          availableCount: app.qty ?? 50,
          provider: "fleexa",
        });
      }

      return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (code === "textverified") {
      const rawRate = providerDoc?.usdNgnRate ?? providerDoc?.usd_ngn_rate;
      if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
        throw new AppError(
          `Provider "Textverified" does not have usd_ngn_rate configured in Provider model. Please configure usd_ngn_rate in admin provider settings.`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.CONFIGURATION_ERROR,
        );
      }
      const usdToNgnRate = Number(rawRate);
      const markupPercent = Number(providerDoc?.markupPercent ?? providerDoc?.markup_percent ?? 0);

      const rawServices = await this.providerService.getTextverifiedServices();
      const items: NumberRentalServiceItem[] = [];

      for (const item of rawServices || []) {
        if (!item || !item.serviceName) continue;

        // Base estimated price for US SMS verification: $1.25 USD default
        const estimatedUsd = 1.25;
        const rawNgnPrice = estimatedUsd * usdToNgnRate;
        const providerCostNgn =
          markupPercent > 0
            ? Math.ceil(rawNgnPrice * (1 + markupPercent / 100))
            : Math.ceil(rawNgnPrice);

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

        const name =
          item.description ||
          item.serviceName.charAt(0).toUpperCase() + item.serviceName.slice(1);

        items.push({
          service: item.serviceName,
          name,
          cost: finalCost,
          providerPrice: providerCostNgn,
          availableCount: 50,
          provider: "textverified",
        });
      }

      return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Default: Owlet
    const rawServices = await this.providerService.getOwletNumberServices(country);
    return rawServices.map((s) => {
      let finalCost = s.price;
      if (serviceCharge && s.price > 0) {
        if (serviceCharge.type === "percentage") {
          const fee = (s.price * serviceCharge.value) / 100;
          const cappedFee = serviceCharge.cap > 0 ? Math.min(fee, serviceCharge.cap) : fee;
          finalCost = Math.ceil(s.price + cappedFee);
        } else {
          finalCost = Math.ceil(s.price + serviceCharge.value);
        }
      }
      return {
        service: s.service,
        name: s.name,
        cost: finalCost,
        providerPrice: s.price,
        provider: "owlet",
      };
    });
  }

  // -------------------------------------------------------------------------
  // Rent a virtual phone number
  // -------------------------------------------------------------------------
  async rentNumber(data: RentNumberData): Promise<RentNumberResult> {
    const reference = `NUM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    return SentryHelper.trackCriticalOperation("number_rental", async () => {
      const { code: providerCode, providerDoc } = await this.resolveProvider(data.provider);

      // 1. Fetch available services to find price
      const services = await this.getServices(
        data.country,
        providerCode,
        data.operator || "any",
      );
      const targetService = services.find(
        (s) => s.service.toLowerCase() === data.service.toLowerCase(),
      );

      if (!targetService) {
        throw new AppError(
          `Service "${data.service}" is currently not available for country ${data.country}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // 2. Compute cost & service charge (baseAmount is provider cost in NGN)
      const userDoc = await User.findById(data.userId).select("tierCode").lean();
      const baseAmount = targetService.providerPrice || targetService.cost;
      const chargeCalculation = await this.helperService.calculateAmountWithCharge(
        baseAmount,
        TRANSACTION_TYPES.NUMBER_RENTAL,
        userDoc?.tierCode,
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

      const usdToNgnRate = providerDoc?.usdNgnRate ?? providerDoc?.usd_ngn_rate;

      // 4. Debit wallet (status pending)
      const debitResult = await this.walletService.debitWallet(
        data.userId,
        chargeCalculation.totalAmount,
        `Number rental: ${targetService.name} (${data.country})`,
        {
          type: TRANSACTION_TYPES.NUMBER_RENTAL,
          provider: providerCode,
          channel: data.channel || "web",
          idempotencyKey: reference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          remark: `Number Rental: ${targetService.name} - ${data.country} (Ref: ${reference})`,
          meta: {
            country: data.country,
            serviceCode: data.service,
            serviceName: targetService.name,
            operator: data.operator || "any",
            pollingProvider: providerCode,
            chargeInfo: {
              baseAmount,
              serviceCharge: chargeCalculation.chargeAmount,
              totalAmount: chargeCalculation.totalAmount,
              isServiceChargeCapped: chargeCalculation.isCapped,
              ...(usdToNgnRate ? { usdToNgnRate } : {}),
            },
          },
        },
      );

      const transaction = debitResult.transaction;

      // 5. Call provider to rent the number
      try {
        let providerOrderId: string;
        let phoneNumber: string;
        let expiresAt: string | undefined;

        if (providerCode === "fivesim") {
          const result = await this.providerService.buyFiveSimNumber({
            country: data.country,
            operator: data.operator || "any",
            product: data.service,
            reference,
          });

          providerOrderId = String(result.id);
          phoneNumber = result.phone;
          expiresAt = result.expires;
        } else if (providerCode === "fleexa") {
          const result = await this.providerService.buyFleexaSmsNumber({
            serviceName: data.service,
            areaCode: (data as any).areaCode,
          });

          providerOrderId = String(result.requestId || result.id);
          phoneNumber = String(result.number || result.phone);
          expiresAt = result.expires_at || undefined;
        } else if (providerCode === "textverified") {
          const result = await this.providerService.buyTextverifiedNumber({
            serviceName: data.service,
            areaCode: data.areaCode,
            carrier: data.carrier,
            idempotencyKey: reference,
          });

          providerOrderId = String(result.id);
          phoneNumber = result.number;
          expiresAt = result.endsAt;
        } else {
          // Owlet Talktiyu
          const result = await this.providerService.rentOwletNumber({
            country: data.country,
            service: data.service,
            reference,
          });

          providerOrderId = String(result.owletOrder);
          phoneNumber = result.number;
        }

        // 6. Update transaction with rented number & provider order reference
        const updatedTx = await Transaction.findByIdAndUpdate(
          transaction.id || (transaction as any)._id,
          {
            status: "pending", // Waiting for OTP
            providerReference: providerOrderId,
            meta: {
              ...transaction.meta,
              providerOrderId,
              phoneNumber,
              pollingProvider: providerCode,
              rentedAt: new Date(),
              expiresAt,
            },
            polling: {
              nextPollAt: new Date(Date.now() + 15000), // First poll in 15 seconds
              pollCount: 0,
              providerOrderId,
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
            providerOrderId,
            number: phoneNumber,
            status: "waiting",
            service: targetService.name,
            country: data.country,
            provider: providerCode,
            expiresAt,
          },
        };
      } catch (providerErr: any) {
        logger.error(`Number rental failed for ${reference} on ${providerCode}`, {
          error: providerErr.message,
          userId: data.userId,
        });

        // Auto-refund user wallet
        try {
          await this.walletService.creditWallet(
            data.userId,
            chargeCalculation.totalAmount,
            `Refund: Number rental failed (${targetService.name})`,
            {
              type: TRANSACTION_TYPES.NUMBER_RENTAL,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: providerErr.message || "Provider number rental failed",
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
          logger.error(`Critical: Refund failed for number rental ${reference}`, refundErr);
        }

        throw new AppError(
          providerErr.message || "Number rental failed. Your wallet has been refunded.",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Check / Poll OTP for a rented number
  // -------------------------------------------------------------------------
  async checkOtp(reference: string, userId: string): Promise<OtpCheckResult> {
    const tx = await Transaction.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.NUMBER_RENTAL,
    });

    if (!tx) {
      throw new AppError("Rental transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const meta = tx.meta || {};

    // If OTP already received, return cached
    if (tx.status === "success" && meta.otpCode) {
      return {
        status: "received",
        number: meta.phoneNumber,
        code: meta.otpCode,
        sms: meta.sms,
        completedAt: tx.updatedAt,
      };
    }

    if (tx.status === "reversed" || tx.status === "failed") {
      return {
        status: tx.status,
        number: meta.phoneNumber,
        message: meta.failureReason || "Rental expired or refunded",
      };
    }

    const providerOrderId = meta.providerOrderId || meta.owletOrder || tx.providerReference;
    if (!providerOrderId) {
      throw new AppError(
        "No provider order found for this rental",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const pollingProvider = (meta.pollingProvider || tx.provider || "fivesim").toLowerCase();

    // -----------------------------------------------------------------------
    // 5SIM Status Polling
    // -----------------------------------------------------------------------
    if (pollingProvider === "fivesim" || pollingProvider === "5sim") {
      const order = await this.providerService.checkFiveSimOrder(providerOrderId);
      const rawStatus = String(order.status || "").toUpperCase();

      if (rawStatus === "RECEIVED" || (Array.isArray(order.sms) && order.sms.length > 0)) {
        const firstSms = order.sms && order.sms.length > 0 ? order.sms[0] : null;
        const code = firstSms?.code || "";

        // Mark transaction as success and cache OTP
        await Transaction.findByIdAndUpdate(tx._id, {
          status: "success",
          "polling.stoppedAt": new Date(),
          "polling.stopReason": "completed",
          meta: {
            ...meta,
            otpCode: code,
            sms: order.sms,
            receivedAt: new Date(),
            providerStatus: rawStatus,
          },
        });

        // Auto-finish order on 5SIM to earn +0.5 rating points for account health
        try {
          await this.providerService.finishFiveSimOrder(providerOrderId);
        } catch (finishErr: any) {
          logger.warn(`Could not finish 5SIM order ${providerOrderId} after OTP receipt`, finishErr);
        }

        return {
          status: "received",
          number: order.phone || meta.phoneNumber,
          code,
          sms: (order.sms || []).map((s) => ({
            sender: s.sender,
            text: s.text,
            code: s.code,
            date: s.date,
          })),
        };
      }

      if (rawStatus === "TIMEOUT" || rawStatus === "CANCELED" || rawStatus === "BANNED") {
        const refundAmount = tx.amount;
        try {
          await this.walletService.creditWallet(
            userId,
            refundAmount,
            `Refund: Number rental ${rawStatus.toLowerCase()} (${meta.serviceName || "OTP"})`,
            {
              type: TRANSACTION_TYPES.NUMBER_RENTAL,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: `5SIM order ${rawStatus.toLowerCase()}`,
              },
            },
          );

          await Transaction.findByIdAndUpdate(tx._id, {
            status: "reversed",
            "polling.stoppedAt": new Date(),
            "polling.stopReason": "failed",
            meta: {
              ...meta,
              failureReason: `5SIM order ${rawStatus.toLowerCase()} without receiving OTP`,
              refunded: true,
            },
          });
        } catch (err: any) {
          logger.error(`Failed to refund expired 5SIM rental ${reference}`, err);
        }

        return {
          status: "refunded",
          number: meta.phoneNumber,
          message: `Order was ${rawStatus.toLowerCase()}. Your wallet has been refunded.`,
        };
      }

      return {
        status: "waiting",
        number: order.phone || meta.phoneNumber,
        message: "Still waiting for SMS verification code",
      };
    }

    // -----------------------------------------------------------------------
    // Fleexa Status Polling
    // -----------------------------------------------------------------------
    if (pollingProvider === "fleexa" || pollingProvider === "flexa") {
      const checkData = await this.providerService.checkFleexaSmsStatus(providerOrderId);
      const rawStatus = String(checkData.status || "").toUpperCase();
      const code = checkData.code || (checkData.sms && checkData.sms.length > 0 ? checkData.sms[0].code : "");

      if (rawStatus === "RECEIVED" || code) {
        await Transaction.findByIdAndUpdate(tx._id, {
          status: "success",
          "polling.stoppedAt": new Date(),
          "polling.stopReason": "completed",
          meta: {
            ...meta,
            otpCode: code,
            sms: checkData.sms,
            receivedAt: new Date(),
            providerStatus: rawStatus,
          },
        });

        return {
          status: "received",
          number: meta.phoneNumber,
          code,
          sms: checkData.sms,
        };
      }

      if (rawStatus === "CANCELLED" || rawStatus === "CANCELED" || rawStatus === "EXPIRED") {
        const refundAmount = tx.amount;
        try {
          await this.walletService.creditWallet(
            userId,
            refundAmount,
            `Refund: Number rental ${rawStatus.toLowerCase()} (${meta.serviceName || "OTP"})`,
            {
              type: TRANSACTION_TYPES.NUMBER_RENTAL,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: `Fleexa order ${rawStatus.toLowerCase()}`,
              },
            },
          );

          await Transaction.findByIdAndUpdate(tx._id, {
            status: "reversed",
            "polling.stoppedAt": new Date(),
            "polling.stopReason": "failed",
            meta: {
              ...meta,
              failureReason: `Fleexa order ${rawStatus.toLowerCase()} without receiving OTP`,
              refunded: true,
            },
          });
        } catch (err: any) {
          logger.error(`Failed to refund expired Fleexa rental ${reference}`, err);
        }

        return {
          status: "refunded",
          number: meta.phoneNumber,
          message: `Order was ${rawStatus.toLowerCase()}. Your wallet has been refunded.`,
        };
      }

      return {
        status: "waiting",
        number: meta.phoneNumber,
        message: "Still waiting for SMS verification code",
      };
    }

    // -----------------------------------------------------------------------
    // Textverified Status Polling
    // -----------------------------------------------------------------------
    if (pollingProvider === "textverified") {
      const verification = await this.providerService.checkTextverifiedStatus(providerOrderId);
      const state = String(verification.state || "");

      let code = "";
      let smsList: any[] = [];
      try {
        const messages = await this.providerService.getTextverifiedSms(providerOrderId);
        if (messages && messages.length > 0) {
          smsList = messages.map((m) => ({
            sender: m.from || "Textverified",
            text: m.smsContent || "",
            code: m.parsedCode || "",
            date: m.createdAt,
          }));
          code = messages[0].parsedCode || "";
        }
      } catch (smsErr) {
        logger.warn(`Could not fetch SMS for Textverified ${providerOrderId}:`, smsErr);
      }

      if (state.toLowerCase() === "verificationcompleted" || code) {
        await Transaction.findByIdAndUpdate(tx._id, {
          status: "success",
          "polling.stoppedAt": new Date(),
          "polling.stopReason": "completed",
          meta: {
            ...meta,
            otpCode: code,
            sms: smsList,
            receivedAt: new Date(),
            providerStatus: state,
          },
        });

        return {
          status: "received",
          number: verification.number || meta.phoneNumber,
          code,
          sms: smsList,
        };
      }

      if (
        state.toLowerCase() === "verificationtimedout" ||
        state.toLowerCase() === "verificationcanceled" ||
        state.toLowerCase() === "verificationreported" ||
        state.toLowerCase() === "verificationrefunded"
      ) {
        const refundAmount = tx.amount;
        try {
          await this.walletService.creditWallet(
            userId,
            refundAmount,
            `Refund: Number rental ${state} (${meta.serviceName || "OTP"})`,
            {
              type: TRANSACTION_TYPES.NUMBER_RENTAL,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: `Textverified verification ${state}`,
              },
            },
          );

          await Transaction.findByIdAndUpdate(tx._id, {
            status: "reversed",
            "polling.stoppedAt": new Date(),
            "polling.stopReason": "failed",
            meta: {
              ...meta,
              failureReason: `Textverified verification ${state} without receiving OTP`,
              refunded: true,
            },
          });
        } catch (err: any) {
          logger.error(`Failed to refund expired Textverified rental ${reference}`, err);
        }

        return {
          status: "refunded",
          number: meta.phoneNumber,
          message: `Order was ${state}. Your wallet has been refunded.`,
        };
      }

      return {
        status: "waiting",
        number: verification.number || meta.phoneNumber,
        message: "Still waiting for SMS verification code",
      };
    }

    // -----------------------------------------------------------------------
    // Owlet Status Polling
    // -----------------------------------------------------------------------
    const pollResult = await this.providerService.pollOwletOtp(providerOrderId);
    const normalizedStatus = String(pollResult.status || "").toLowerCase();

    if (normalizedStatus === "received" && pollResult.code) {
      await Transaction.findByIdAndUpdate(tx._id, {
        status: "success",
        "polling.stoppedAt": new Date(),
        "polling.stopReason": "completed",
        meta: {
          ...meta,
          otpCode: pollResult.code,
          receivedAt: new Date(),
        },
      });

      return {
        status: "received",
        number: pollResult.number || meta.phoneNumber,
        code: pollResult.code,
      };
    }

    if (
      normalizedStatus === "refunded" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "expired"
    ) {
      const refundAmount = tx.amount;
      try {
        await this.walletService.creditWallet(
          userId,
          refundAmount,
          `Refund: Number rental expired (${meta.serviceName || "OTP"})`,
          {
            type: TRANSACTION_TYPES.NUMBER_RENTAL,
            provider: "system",
            idempotencyKey: `REFUND-${reference}`,
            initiatedBy: new Types.ObjectId(userId),
            initiatedByType: "system",
            meta: {
              originalReference: reference,
              reason: "Owlet auto-refunded (OTP timed out)",
            },
          },
        );

        await Transaction.findByIdAndUpdate(tx._id, {
          status: "reversed",
          "polling.stoppedAt": new Date(),
          "polling.stopReason": "failed",
          meta: {
            ...meta,
            failureReason: "OTP timed out and was refunded",
            refunded: true,
          },
        });
      } catch (err: any) {
        logger.error(`Failed to refund expired number rental ${reference}`, err);
      }

      return {
        status: "refunded",
        number: meta.phoneNumber,
        message: "No OTP was received. Your wallet has been refunded.",
      };
    }

    return {
      status: "waiting",
      number: meta.phoneNumber,
      message: "Still waiting for SMS verification code",
    };
  }

  // -------------------------------------------------------------------------
  // Cancel a rental (Triggers provider cancellation & immediate wallet refund)
  // -------------------------------------------------------------------------
  async cancelRental(reference: string, userId: string) {
    const tx = await Transaction.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.NUMBER_RENTAL,
    });

    if (!tx) {
      throw new AppError("Rental transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    if (tx.status !== "pending") {
      throw new AppError(
        `Cannot cancel a rental that is in '${tx.status}' status. Only pending rentals can be cancelled.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    const meta = tx.meta || {};
    const providerOrderId = meta.providerOrderId || meta.owletOrder || tx.providerReference;
    const pollingProvider = (meta.pollingProvider || tx.provider || "").toLowerCase();
    const refundAmount = tx.amount;

    // If 5SIM, cancel on provider to release number & reclaim balance
    if ((pollingProvider === "fivesim" || pollingProvider === "5sim") && providerOrderId) {
      try {
        await this.providerService.cancelFiveSimOrder(providerOrderId);
      } catch (err: any) {
        logger.warn(`Could not cancel 5SIM order ${providerOrderId} on provider:`, err);
      }
    } else if ((pollingProvider === "fleexa" || pollingProvider === "flexa") && providerOrderId) {
      try {
        await this.providerService.cancelFleexaSms(providerOrderId);
      } catch (err: any) {
        logger.warn(`Could not cancel Fleexa SMS ${providerOrderId} on provider:`, err);
      }
    } else if (pollingProvider === "textverified" && providerOrderId) {
      try {
        await this.providerService.cancelTextverified(providerOrderId);
      } catch (err: any) {
        logger.warn(`Could not cancel Textverified verification ${providerOrderId} on provider:`, err);
      }
    }

    try {
      await this.walletService.creditWallet(
        userId,
        refundAmount,
        `Refund: Number rental cancelled (${meta.serviceName || "OTP"})`,
        {
          type: TRANSACTION_TYPES.NUMBER_RENTAL,
          provider: "system",
          idempotencyKey: `REFUND-${reference}`,
          initiatedBy: new Types.ObjectId(userId),
          initiatedByType: "system",
          meta: {
            originalReference: reference,
            reason: "User-requested cancellation",
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

      logger.info(`NumberRentalService.cancelRental: cancelled and refunded ${reference}`);

      return {
        status: "cancelled",
        refundedAmount: refundAmount,
        message: "Rental cancelled and wallet refunded successfully.",
      };
    } catch (err: any) {
      logger.error(`NumberRentalService.cancelRental: refund failed for ${reference}`, err);
      throw new AppError(
        "Cancellation failed — please contact support if funds were not returned.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Ban a rental (Report number already used / banned on target app)
  // -------------------------------------------------------------------------
  async banRental(reference: string, userId: string) {
    const tx = await Transaction.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.NUMBER_RENTAL,
    });

    if (!tx) {
      throw new AppError("Rental transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    if (tx.status !== "pending") {
      throw new AppError(
        `Cannot ban a rental that is in '${tx.status}' status. Only pending rentals can be banned.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    const meta = tx.meta || {};
    const providerOrderId = meta.providerOrderId || meta.owletOrder || tx.providerReference;
    const pollingProvider = (meta.pollingProvider || tx.provider || "").toLowerCase();
    const refundAmount = tx.amount;

    if ((pollingProvider === "fivesim" || pollingProvider === "5sim") && providerOrderId) {
      try {
        await this.providerService.banFiveSimOrder(providerOrderId);
      } catch (err: any) {
        logger.warn(`Could not ban 5SIM order ${providerOrderId} on provider:`, err);
      }
    } else if (pollingProvider === "textverified" && providerOrderId) {
      try {
        await this.providerService.reportTextverified(providerOrderId);
      } catch (err: any) {
        logger.warn(`Could not report Textverified verification ${providerOrderId} on provider:`, err);
      }
    }

    try {
      await this.walletService.creditWallet(
        userId,
        refundAmount,
        `Refund: Number reported as banned/taken (${meta.serviceName || "OTP"})`,
        {
          type: TRANSACTION_TYPES.NUMBER_RENTAL,
          provider: "system",
          idempotencyKey: `REFUND-BAN-${reference}`,
          initiatedBy: new Types.ObjectId(userId),
          initiatedByType: "system",
          meta: {
            originalReference: reference,
            reason: "User reported number as banned/already registered",
          },
        },
      );

      await Transaction.findByIdAndUpdate(tx._id, {
        status: "reversed",
        "polling.stoppedAt": new Date(),
        "polling.stopReason": "failed",
        meta: {
          ...meta,
          failureReason: "Reported as banned/already used",
          refunded: true,
          bannedAt: new Date(),
        },
      });

      logger.info(`NumberRentalService.banRental: banned and refunded ${reference}`);

      return {
        status: "banned",
        refundedAmount: refundAmount,
        message: "Number reported as banned/taken. Your wallet has been refunded.",
      };
    } catch (err: any) {
      logger.error(`NumberRentalService.banRental: refund failed for ${reference}`, err);
      throw new AppError(
        "Ban request failed — please contact support if funds were not returned.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }
}
