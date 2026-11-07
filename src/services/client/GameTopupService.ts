import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { Product } from "@/models/reference/Product";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { ProviderService } from "@/services/client/ProviderService";
import { Transaction } from "@/models/wallet/Transaction";
import crypto from "crypto";

export interface GameTopupOrderData {
  userId: string;
  productId: string;
  fields: Record<string, string>;
  channel?: "ios" | "android" | "web" | "api";
}

export interface GameTopupOrderResult {
  transaction: any;
  order: {
    reference: string;
    providerReference: string;
    status: string;
    card?: string;
    pin?: string;
  };
}

export class GameTopupService {
  constructor(
    private walletService: WalletService,
    private helperService: HelperService,
    private providerService: ProviderService,
  ) {}

  // -------------------------------------------------------------------------
  // Get all active games (e.g. Mobile Legends, PUBG Mobile, Free Fire)
  // -------------------------------------------------------------------------
  async getGames() {
    const serviceType = await ServiceType.findOne({ code: "game_topup" }).lean();
    if (!serviceType) return [];

    const services = await Service.find({
      serviceTypeId: serviceType._id,
      isActive: true,
      deletedAt: null,
    })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    return services.map((s) => ({
      id: s._id,
      name: s.name,
      code: s.code,
      logo: s.logo,
      serviceTypeCode: "game_topup",
    }));
  }

  // -------------------------------------------------------------------------
  // Get packages / top-up options for a game
  // -------------------------------------------------------------------------
  async getPackages(serviceCode: string) {
    const service: any = await Service.findOne({
      $or: [
        { code: serviceCode },
        ...(Types.ObjectId.isValid(serviceCode) ? [{ _id: new Types.ObjectId(serviceCode) }] : []),
      ],
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!service) {
      throw new AppError(
        "Game service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const products = await Product.find({
      serviceId: service._id,
      isActive: true,
    })
      .sort({ amount: 1 })
      .lean();

    return products.map((p) => ({
      id: p._id,
      name: p.name,
      code: p.code,
      amount: p.amount,
      sku: p.attributes?.sku || p.code,
      fields: p.attributes?.fields || [],
      attributes: p.attributes,
    }));
  }

  // -------------------------------------------------------------------------
  // Order a Game Top-up
  // -------------------------------------------------------------------------
  async orderTopup(data: GameTopupOrderData): Promise<GameTopupOrderResult> {
    const reference = `GMT-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    return SentryHelper.trackCriticalOperation("game_topup_order", async () => {
      // 1. Fetch product
      const product = await Product.findById(data.productId)
        .populate("serviceId")
        .populate("providerId")
        .lean();

      if (!product || !product.isActive) {
        throw new AppError(
          "Game top-up product not found or inactive",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const attrs = product.attributes || {};
      const requiredFields: Array<{ key: string; label: string; required?: boolean }> =
        attrs.fields || [];

      // 2. Validate required dynamic fields (e.g. player_id, server_id)
      for (const field of requiredFields) {
        if (field.required && !data.fields?.[field.key]) {
          throw new AppError(
            `Field "${field.label || field.key}" is required for this game`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      // 3. Compute price breakdown
      const baseAmount = product.amount;
      const chargeCalculation = await this.helperService.calculateAmountWithCharge(
        baseAmount,
        TRANSACTION_TYPES.GAME_TOPUP,
      );

      // 4. Check wallet balance
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

      const service = product.serviceId as any;
      const productToken = attrs.productToken || service?.code || "";
      const sku = attrs.sku || product.legacyProductId || product.code;

      // 5. Debit wallet
      const debitResult = await this.walletService.debitWallet(
        data.userId,
        chargeCalculation.totalAmount,
        `Game top-up: ${product.name}`,
        {
          type: TRANSACTION_TYPES.GAME_TOPUP,
          provider: "owlet",
          channel: data.channel || "web",
          idempotencyKey: reference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          remark: `Game Top-up: ${product.name} (Ref: ${reference})`,
          meta: {
            productId: product._id,
            productName: product.name,
            game: service?.name || "",
            fields: data.fields,
            sku,
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

      // 6. Call Owlet Gamerzone provider dispatch
      try {
        const providerResult = await this.providerService.buyOwletGameTopup({
          product: productToken,
          sku,
          fields: data.fields,
          reference,
        });

        // 7. Update transaction to completed
        const updatedMeta = {
          ...transaction.meta,
          providerReference: providerResult.owletOrder,
          owletOrder: providerResult.owletOrder,
          card: providerResult.card,
          pin: providerResult.pin,
          providerResponse: providerResult.data,
        };

        const updatedTx = await Transaction.findByIdAndUpdate(
          transaction.id || (transaction as any)._id,
          {
            status: "success",
            providerReference: providerResult.owletOrder,
            meta: updatedMeta,
          },
          { new: true },
        ).lean();

        return {
          transaction: updatedTx || transaction,
          order: {
            reference,
            providerReference: providerResult.owletOrder,
            status: "success",
            card: providerResult.card,
            pin: providerResult.pin,
          },
        };
      } catch (providerErr: any) {
        logger.error(`Owlet game topup provider failed for ${reference}`, {
          error: providerErr.message,
          userId: data.userId,
        });

        // Auto-refund wallet on provider failure
        try {
          await this.walletService.creditWallet(
            data.userId,
            chargeCalculation.totalAmount,
            `Refund: Game top-up failed (${product.name})`,
            {
              type: TRANSACTION_TYPES.GAME_TOPUP,
              provider: "system",
              idempotencyKey: `REFUND-${reference}`,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "system",
              meta: {
                originalReference: reference,
                reason: providerErr.message || "Provider purchase failed",
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
          logger.error(`Critical: Refund failed for game topup ${reference}`, refundErr);
        }

        throw new AppError(
          providerErr.message || "Game top-up failed. Your wallet has been refunded.",
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }
    });
  }
}
