import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { Product } from "@/models/reference/Product";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { roundAmount } from "@/utils/helpers";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import { ProviderService } from "@/services/client/ProviderService";
import { SmmOrderData, SmmOrderResult, SmmSabiOrderFields } from "@/types/smm";
import SentryModule from "@/config/sentry";
import ServiceContainer from "@/services/client/container";
import { Transaction } from "@/models/wallet/Transaction";
import { User } from "@/models/core/User";
import crypto from "crypto";

export class SmmService {
  constructor(
    private walletService: WalletService,
    private helperService: HelperService,
    private providerService: ProviderService,
  ) {}

  // -------------------------------------------------------------------------
  // Get SMM Providers / Platforms (Airtime provider design)
  // -------------------------------------------------------------------------
  async getProviders() {
    const serviceType = await ServiceType.findOne({ code: "smm" }).lean();
    if (!serviceType) return [];

    const services = await Service.find({
      serviceTypeId: serviceType._id,
      isActive: true,
      deletedAt: null,
    })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    return services.map((service) => ({
      id: service._id,
      name: service.name,
      code: service.code,
      logo: service.logo,
      serviceTypeCode: "smm",
    }));
  }

  // -------------------------------------------------------------------------
  // Get Product Types for a Platform (e.g. Followers, Likes, Views, Comments)
  // -------------------------------------------------------------------------
  async getProductTypes(serviceCode: string): Promise<string[]> {
    let service: any = await Service.findOne({
      $or: [
        { code: serviceCode },
        ...(Types.ObjectId.isValid(serviceCode) ? [{ _id: new Types.ObjectId(serviceCode) }] : []),
      ],
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!service) {
      throw new AppError(
        "SMM platform service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const rawTypes = (await Product.distinct("productType", {
      serviceId: service._id,
      isActive: true,
    })) as string[];

    const cleaned = [...new Set(rawTypes.filter(Boolean))];
    return cleaned.sort();
  }

  // -------------------------------------------------------------------------
  // Get Products for a Platform and Product Type
  // -------------------------------------------------------------------------
  async getProducts(
    serviceCode: string,
    productType?: string,
    options?: { page?: number; limit?: number },
  ) {
    let service: any = await Service.findOne({
      $or: [
        { code: serviceCode },
        ...(Types.ObjectId.isValid(serviceCode) ? [{ _id: new Types.ObjectId(serviceCode) }] : []),
      ],
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!service) {
      throw new AppError(
        "SMM platform service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const page = options?.page || 1;
    const limit = options?.limit || 100;
    const skip = (page - 1) * limit;

    const productFilter: any = {
      serviceId: service._id,
      isActive: true,
    };

    if (productType && productType.toLowerCase() !== "all") {
      productFilter.productType = new RegExp(`^${productType}$`, "i");
    }

    const [products, total] = await Promise.all([
      Product.find(productFilter)
        .populate("serviceId", "name code logo")
        .sort({ amount: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(productFilter),
    ]);

    return { products, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // List the SMM catalog (active Default-type products only by default)
  // -------------------------------------------------------------------------
  async listCatalog(filters: {
    category?: string;
    platform?: string;
    type?: string;
    page?: number;
    limit?: number;
    includeInactive?: boolean;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const serviceType = await ServiceType.findOne({ code: "smm" }).lean();
    if (!serviceType) {
      throw new AppError(
        "SMM service type not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const serviceFilter: any = { serviceTypeId: serviceType._id };
    const platformQuery = filters.platform || filters.category;
    if (platformQuery) {
      serviceFilter.$or = [
        { name: new RegExp(platformQuery, "i") },
        { code: new RegExp(platformQuery, "i") },
      ];
    }

    const services = await Service.find(serviceFilter).lean();
    const serviceIds = services.map((s) => s._id);

    const productFilter: any = { serviceId: { $in: serviceIds } };
    if (!filters.includeInactive) {
      productFilter.isActive = true;
    }

    if (filters.type && filters.type.toLowerCase() !== "all") {
      productFilter.productType = new RegExp(`^${filters.type}$`, "i");
    }

    const [products, total] = await Promise.all([
      Product.find(productFilter)
        .populate("serviceId", "name code logo")
        .sort({ serviceId: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(productFilter),
    ]);

    return { products, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // Get Categories for a selected provider (e.g., "Instagram Followers")
  // -------------------------------------------------------------------------
  async getCategories(providerCode: string) {
    const service = await Service.findOne({
      code: providerCode,
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!service) {
      throw new AppError(
        "Provider service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const categories = await Product.distinct("category", {
      serviceId: service._id,
      isActive: true,
      category: { $ne: null },
    });

    return categories.filter(Boolean);
  }

  // -------------------------------------------------------------------------
  // Get Services / Products under a Provider + optional category filter
  // -------------------------------------------------------------------------
  async getServices(providerCode: string, category?: string) {
    const service = await Service.findOne({
      code: providerCode,
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!service) {
      throw new AppError(
        "Provider service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const filter: any = {
      serviceId: service._id,
      isActive: true,
    };
    if (category) {
      filter.category = category;
    }

    const products = await Product.find(filter)
      .sort({ "attributes.displayOrder": 1, name: 1 })
      .lean();

    return products.map((product) => ({
      id: product._id,
      name: product.name,
      description: product.description,
      category: product.category,
      ratePer1000: product.amount,
      min: (product.attributes as any)?.min ?? 10,
      max: (product.attributes as any)?.max ?? 100000,
      type: (product.attributes as any)?.type ?? "Default",
      refill: (product.attributes as any)?.refill ?? false,
      cancel: (product.attributes as any)?.cancel ?? false,
      dripfeed: (product.attributes as any)?.dripfeed ?? false,
      isAvailable: product.isActive,
    }));
  }

  // -------------------------------------------------------------------------
  // Get specific SMM product details
  // -------------------------------------------------------------------------
  async getProduct(productId: string) {
    const product = await Product.findById(productId)
      .populate("serviceId", "name code logo")
      .lean();

    if (!product || !product.isActive) {
      throw new AppError(
        "SMM service not found or inactive",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const attrs = product.attributes || {};
    return {
      id: product._id,
      name: product.name,
      description: product.description,
      category: product.category,
      ratePer1000: product.amount,
      min: (attrs as any).min ?? 10,
      max: (attrs as any).max ?? 100000,
      type: (attrs as any).type ?? "Default",
      refill: (attrs as any).refill ?? false,
      cancel: (attrs as any).cancel ?? false,
      dripfeed: (attrs as any).dripfeed ?? false,
      platform: (product.serviceId as any)?.name ?? "",
      platformCode: (product.serviceId as any)?.code ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // Validate / Quote an SMM order before placing
  // Returns: baseAmount, serviceCharge, totalAmount
  // -------------------------------------------------------------------------
  async validateOrder(data: { productId: string; quantity: number }) {
    const product = await Product.findById(data.productId).lean();
    if (!product || !product.isActive) {
      throw new AppError(
        "SMM product not found or inactive",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const attrs = product.attributes || {};
    const minQty = Number((attrs as any).min) || 0;
    const maxQty = Number((attrs as any).max) || Infinity;

    if (data.quantity < minQty || data.quantity > maxQty) {
      throw new AppError(
        `Quantity must be between ${minQty} and ${maxQty}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const baseAmount = roundAmount((product.amount / 1000) * data.quantity);
    const chargeCalculation = await this.helperService.calculateAmountWithCharge(
      baseAmount,
      TRANSACTION_TYPES.SMM,
    );

    return {
      productId: product._id,
      productName: product.name,
      quantity: data.quantity,
      ratePer1000: product.amount,
      baseAmount,
      serviceCharge: chargeCalculation.chargeAmount,
      totalAmount: chargeCalculation.totalAmount,
      isServiceChargeCapped: chargeCalculation.isCapped,
    };
  }

  // -------------------------------------------------------------------------
  // Place SMM Order
  // Flow:
  //   1. Validate product + quantity bounds
  //   2. Calculate NGN total: (product.amount / 1000) × quantity
  //   3. Apply service charge
  //   4. Debit wallet → create transaction (status=pending)
  //   5. Call ProviderService.orderSmm (NON-RETRYABLE)
  //   6a. On success: store providerOrderId in transaction.meta, start polling
  //   6b. On ambiguous (timeout/5xx): set transaction to pending with pendingManualReview: true
  //   6c. On hard provider error: refund wallet, set transaction to failed
  // -------------------------------------------------------------------------
  async placeOrder(data: SmmOrderData): Promise<SmmOrderResult> {
    const reference = `SMM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    return SentryHelper.trackCriticalOperation(
      "smm_place_order",
      async () => {
        // 1. Load product
        const product = await Product.findById(data.productId)
          .populate("serviceId")
          .populate("providerId")
          .lean();

        if (!product || !product.isActive) {
          throw new AppError(
            "SMM product not found or inactive",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        const attrs = product.attributes || {};
        const minQty = Number((attrs as any).min) || 0;
        const maxQty = Number((attrs as any).max) || Infinity;
        const serviceType = (attrs as any).type || "Default";

        // Auto-resolve quantity for Custom Comments from lines count
        if (data.comments && (!data.quantity || data.quantity <= 0)) {
          const lines = data.comments.split("\n").map((l: string) => l.trim()).filter(Boolean);
          data.quantity = lines.length;
        } else if (serviceType === "Package" && (!data.quantity || data.quantity <= 0)) {
          data.quantity = minQty || 1;
        }

        // 2. Validate quantity
        if (data.quantity < minQty || data.quantity > maxQty) {
          throw new AppError(
            `Quantity must be between ${minQty} and ${maxQty}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
          throw new AppError(
            "Quantity must be a positive integer",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // 3. Calculate NGN cost: (product.amount is NGN per 1,000 units)
        const baseAmount = roundAmount((product.amount / 1000) * data.quantity);

        // 4. Apply service charge with user tier discount if applicable
        const userDoc = await User.findById(data.userId).select("tierCode").lean();
        const chargeCalculation = await this.helperService.calculateAmountWithCharge(
          baseAmount,
          TRANSACTION_TYPES.SMM,
          userDoc?.tierCode,
        );

        // 5. Get wallet and check balance
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
        const legacyServiceId = product.legacyProductId
          ? (Number(product.legacyProductId) || Number(String(product.legacyProductId).replace(/^[^0-9]+/, "")))
          : null;

        if (!legacyServiceId) {
          throw new AppError(
            "Product is not linked to a provider service ID",
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            ERROR_CODES.CONFIGURATION_ERROR,
          );
        }

        let providerDoc: any;
        let providerCode: string;
        if (product.providerId && (product.providerId as any).code) {
          providerDoc = product.providerId;
          providerCode = String(providerDoc.code).toLowerCase();
        } else {
          providerDoc = await this.providerService.getActiveApiProvider("smm");
          providerCode = providerDoc.code.toLowerCase();
        }

        // Validate and resolve usd_ngn_rate from Provider model (no env, no fallback — fail loudly if not set)
        let usdToNgnRate: number | undefined;
        const isUsdProvider =
          providerCode === "smmfollows" ||
          providerCode === "smmresellerpanel" ||
          providerCode === "nigeriasmm";

        if (isUsdProvider) {
          const rawRate = providerDoc?.usdNgnRate ?? providerDoc?.usd_ngn_rate;
          if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
            throw new AppError(
              `Provider "${providerDoc?.name || providerCode}" does not have usd_ngn_rate configured in Provider model. Please set usd_ngn_rate via the admin provider update endpoint before placing orders.`,
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              ERROR_CODES.CONFIGURATION_ERROR,
            );
          }
          usdToNgnRate = Number(rawRate);
        }

        // 6. Debit wallet
        const debitResult = await this.walletService.debitWallet(
          data.userId,
          chargeCalculation.totalAmount,
          `SMM order: ${product.name}`,
          {
            type: TRANSACTION_TYPES.SMM,
            provider: providerCode,
            idempotencyKey: reference,
            initiatedBy: new Types.ObjectId(data.userId),
            initiatedByType: "user",
            channel: data.channel,
            suppressNotification: true,
            meta: {
              productId: product._id,
              productName: product.name,
              serviceCategory: service?.name || "",
              link: data.link,
              quantity: data.quantity,
              legacyServiceId,
              remark: `SMM: ${product.name} × ${data.quantity} (Ref: ${reference})`,
              comments: data.comments,
              answer_number: data.answer_number,
              usernames: data.usernames,
              runs: data.runs,
              interval: data.interval,
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

        // 7. Call provider — deliberately NON-RETRYABLE
        let orderResult;
        const sabiFields: SmmSabiOrderFields = data.sabiFields || {
          target: data.target,
          gender: data.gender,
          region: data.region,
          comments: data.comments,
          comment_gender: data.comment_gender,
          comment_instructions: data.comment_instructions,
          duration: data.duration,
          start_count: data.start_count,
          start_screenshot: data.start_screenshot,
        };
        const hasSabi = Object.values(sabiFields).some((v) => v !== undefined && v !== "");

        try {
          orderResult = await this.providerService.orderSmm({
            providerCode,
            service: legacyServiceId,
            link: data.link,
            quantity: data.quantity,
            comments: data.comments,
            runs: data.runs,
            interval: data.interval,
            answer_number: data.answer_number,
            usernames: data.usernames,
            sabiFields: hasSabi ? sabiFields : undefined,
          });
        } catch (error: any) {
          logger.error("SMM addOrder failed with hard error — reversing transaction", {
            reference,
            error: error.message,
          });

          try {
            await this.walletService.creditWallet(
              data.userId,
              chargeCalculation.totalAmount,
              `Refund: SMM order failed (${product.name})`,
              {
                type: TRANSACTION_TYPES.SMM,
                provider: "system",
                idempotencyKey: `REFUND-${reference}`,
                initiatedBy: new Types.ObjectId(data.userId),
                initiatedByType: "system",
                meta: {
                  originalReference: reference,
                  reason: error.message || "Provider error",
                },
              },
            );

            await Transaction.findByIdAndUpdate(
              transaction.id || (transaction as any)._id,
              {
                status: "failed",
                meta: {
                  ...transaction.meta,
                  failureReason: error.message || "Provider error",
                  refunded: true,
                },
              },
            );
          } catch (refundErr: any) {
            logger.error(`Critical: Refund failed for SMM order ${reference}`, refundErr);
          }

          throw error;
        }

        if (orderResult.success) {
          // Happy path — store provider order id and leave as pending (polling will settle it)
          await this.updateTransactionMeta(transaction.id || (transaction as any)._id, {
            providerOrderId: orderResult.orderId,
            pollingProvider: providerCode,
            chargeInfo: {
              ...transaction.meta?.chargeInfo,
              ...(usdToNgnRate ? { usdToNgnRate } : {}),
            },
          });

          logger.info("SMM order placed successfully", {
            reference,
            providerOrderId: orderResult.orderId,
          });

          return {
            transaction,
            providerOrderId: orderResult.orderId as any,
            totalNgn: chargeCalculation.totalAmount,
            status: "pending",
          };
        }

        // Ambiguous — order state unconfirmed, flag for manual review
        logger.error(`SMM addOrder returned ambiguous result from ${providerCode} — flagging for manual review`, {
          reference,
          message: orderResult.message,
        });

        SentryModule.captureException(new Error("SMM addOrder ambiguous"), {
          tags: { operation: "smm_place_order", provider: providerCode },
          extra: { reference, message: orderResult.message },
        });

        // Update transaction meta with manual review flags, status stays "pending"
        await this.updateTransactionMeta(
          transaction.id || (transaction as any)._id,
          {
            pendingManualReview: true,
            ambiguousOrderError: orderResult.message,
          },
          "pending",
        );

        return {
          transaction,
          providerOrderId: 0,
          totalNgn: chargeCalculation.totalAmount,
          status: "pending",
        };
      },
      reference,
    );
  }

  // -------------------------------------------------------------------------
  // Helper: update transaction meta (and optionally status)
  // -------------------------------------------------------------------------
  private async updateTransactionMeta(
    transactionId: any,
    metaPatch: Record<string, any>,
    status?: string,
  ) {
    const update: any = {
      $set: {
        ...Object.fromEntries(
          Object.entries(metaPatch).map(([k, v]) => [`meta.${k}`, v]),
        ),
      },
    };
    if (status) {
      update.$set.status = status;
    }
    await Transaction.findByIdAndUpdate(transactionId, update);
  }

  // -------------------------------------------------------------------------
  // Get provider balance (for health monitoring / admin dashboard)
  // -------------------------------------------------------------------------
  async getProviderBalance(providerCode: string = "nigeriasmm") {
    try {
      return await this.providerService.getSmmBalance(providerCode);
    } catch (e) {
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Client: Request refill for completed/partial SMM order
  // -------------------------------------------------------------------------
  async refillOrder(userId: string, transactionIdOrRef: string) {
    const transaction = await Transaction.findOne({
      $or: [
        { reference: transactionIdOrRef },
        ...(Types.ObjectId.isValid(transactionIdOrRef) ? [{ _id: new Types.ObjectId(transactionIdOrRef) }] : []),
      ],
      initiatedBy: new Types.ObjectId(userId),
    });

    if (!transaction) {
      throw new AppError("Transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    const providerOrderId = transaction.meta?.providerOrderId;
    if (!providerOrderId) {
      throw new AppError("No provider order found for this transaction", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const providerCode = (transaction.meta?.pollingProvider || transaction.provider || "nigeriasmm").toLowerCase();
    const result = await this.providerService.refillSmmOrder(providerCode, providerOrderId);

    await this.updateTransactionMeta(transaction._id, {
      refillRequested: true,
      lastRefillAt: new Date(),
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Client: Request cancel for pending SMM order
  // -------------------------------------------------------------------------
  async cancelOrder(userId: string, transactionIdOrRef: string) {
    const transaction = await Transaction.findOne({
      $or: [
        { reference: transactionIdOrRef },
        ...(Types.ObjectId.isValid(transactionIdOrRef) ? [{ _id: new Types.ObjectId(transactionIdOrRef) }] : []),
      ],
      initiatedBy: new Types.ObjectId(userId),
    });

    if (!transaction) {
      throw new AppError("Transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
    }

    if (!["pending", "processing"].includes(transaction.status)) {
      throw new AppError("Only pending or processing orders can be canceled", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const providerOrderId = transaction.meta?.providerOrderId;
    if (!providerOrderId) {
      throw new AppError("No provider order found for this transaction", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const providerCode = (transaction.meta?.pollingProvider || transaction.provider || "nigeriasmm").toLowerCase();
    const result = await this.providerService.cancelSmmOrder(providerCode, providerOrderId);

    return result;
  }

  // -------------------------------------------------------------------------
  // Client: Get SMM orders with pagination
  // -------------------------------------------------------------------------
  async getUserOrders(userId: string, options: { page?: number; limit?: number; status?: string } = {}) {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const query: any = {
      initiatedBy: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.SMM,
    };

    if (options.status && options.status !== "all") {
      query.status = options.status;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    const orders = transactions.map((tx: any) => ({
      id: tx._id,
      reference: tx.reference,
      orderId: tx.meta?.providerOrderId ? String(tx.meta.providerOrderId) : tx.reference,
      serviceId: String(tx.meta?.productId || tx.meta?.legacyServiceId || ""),
      serviceName: tx.meta?.productName || tx.remark || "SMM Engagement Service",
      platform: tx.meta?.serviceCategory || "",
      link: tx.meta?.link || "—",
      quantity: tx.meta?.quantity || 0,
      chargeNgn: tx.amount || 0,
      startCount: tx.meta?.start_count ?? 0,
      remains: tx.meta?.smmRemains ?? 0,
      status: tx.status,
      refillRequested: Boolean(tx.meta?.refillRequested),
      isPartial: Boolean(tx.meta?.smmPartial),
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
      meta: tx.meta,
    }));

    return { orders, total, page, limit };
  }
}
