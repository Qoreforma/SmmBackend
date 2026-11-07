import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { ProviderService } from "@/services/client/ProviderService";
import { Transaction } from "@/models/wallet/Transaction";
import crypto from "crypto";

export interface BuyProxyData {
  userId: string;
  product: string;
  plan: string;
  quantity: number;
  location?: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface BuyProxyResult {
  transaction: any;
  order: {
    reference: string;
    owletOrder: string;
    status: string;
    proxies: string[];
  };
}

export class ProxyService {
  constructor(
    private walletService: WalletService,
    private helperService: HelperService,
    private providerService: ProviderService,
  ) {}

  // -------------------------------------------------------------------------
  // Get proxy catalog with dynamic ServiceCharge fee
  // -------------------------------------------------------------------------
  async getCatalog() {
    const rawCatalog = await this.providerService.getOwletProxyCatalog();
    const serviceCharge = await this.helperService.getServiceChargeCached(
      TRANSACTION_TYPES.PROXY,
    );

    return rawCatalog.map((item) => {
      const rawPrice = item.price || 0;
      let finalPrice = rawPrice;
      if (serviceCharge && rawPrice > 0) {
        if (serviceCharge.type === "percentage") {
          const fee = (rawPrice * serviceCharge.value) / 100;
          const cappedFee = serviceCharge.cap > 0 ? Math.min(fee, serviceCharge.cap) : fee;
          finalPrice = Math.ceil(rawPrice + cappedFee);
        } else {
          finalPrice = Math.ceil(rawPrice + serviceCharge.value);
        }
      }
      return {
        ...item,
        price: finalPrice,
        providerPrice: rawPrice,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Buy proxies
  // -------------------------------------------------------------------------
  async buyProxy(data: BuyProxyData): Promise<BuyProxyResult> {
    const reference = `PRX-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    return SentryHelper.trackCriticalOperation("proxy_purchase", async () => {
      // 1. Fetch catalog to determine pricing
      const catalog = await this.getCatalog();
      const product = catalog.find(
        (p) =>
          p.product?.toLowerCase() === data.product.toLowerCase() ||
          (p as any).code?.toLowerCase() === data.product.toLowerCase(),
      );

      // Default unit price if item price not explicitly found per plan (baseAmount is provider cost)
      const unitPrice = product?.providerPrice || product?.price || 1500;
      const baseAmount = unitPrice * data.quantity;

      // 2. Service charge
      const chargeCalculation = await this.helperService.calculateAmountWithCharge(
        baseAmount,
        TRANSACTION_TYPES.PROXY,
      );

      // 3. Check wallet balance
      const wallet = await this.walletService.getWallet(data.userId);
      if (!wallet) {
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
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
        `Proxy purchase: ${data.quantity} × ${data.product}`,
        {
          type: TRANSACTION_TYPES.PROXY,
          provider: "owlet",
          channel: data.channel || "web",
          idempotencyKey: reference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          remark: `Proxy Purchase: ${data.quantity} × ${data.product} (Ref: ${reference})`,
          meta: {
            product: data.product,
            plan: data.plan,
            quantity: data.quantity,
            location: data.location,
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

      // 5. Call Owlet Rhombus buy_proxy action
      try {
        const result = await this.providerService.buyOwletProxy({
          product: data.product,
          plan: data.plan,
          quantity: data.quantity,
          location: data.location,
          reference,
        });

        // 6. Update transaction to success
        const updatedTx = await Transaction.findByIdAndUpdate(
          transaction.id || (transaction as any)._id,
          {
            status: "success",
            providerReference: result.owletOrder,
            meta: {
              ...transaction.meta,
              owletOrder: result.owletOrder,
              proxies: result.proxies,
            },
          },
          { new: true },
        ).lean();

        return {
          transaction: updatedTx || transaction,
          order: {
            reference,
            owletOrder: result.owletOrder,
            status: "success",
            proxies: result.proxies,
          },
        };
      } catch (providerErr: any) {
        logger.error(`Owlet proxy purchase failed for ${reference}`, {
          error: providerErr.message,
          userId: data.userId,
        });

        // Auto-refund user wallet
        try {
          await this.walletService.creditWallet(
            data.userId,
            chargeCalculation.totalAmount,
            `Refund: Proxy purchase failed`,
            {
              type: TRANSACTION_TYPES.PROXY,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: providerErr.message || "Provider proxy purchase failed",
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
          logger.error(`Critical: Refund failed for proxy purchase ${reference}`, refundErr);
        }

        throw new AppError(
          providerErr.message || "Proxy purchase failed. Your wallet has been refunded.",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
    });
  }
}
