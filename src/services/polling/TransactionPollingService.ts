import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletService } from "../client/wallet/WalletService";
import { NigeriaSmmService } from "../client/providers/smm/NigeriaSmmService";
import { getProviderConfig } from "@/config/providers";
import logger from "@/logger";
import { Types } from "mongoose";
import { EmailService } from "../core/EmailService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { getTransactionStateValidator } from "../client/utility/TransactionStateValidator";
import { ITransaction } from "@/models/wallet/Transaction";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { NotificationService } from "../client/notifications/NotificationService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import Sentry from "@/config/sentry";
import { UserRepository } from "@/repositories/client/UserRepository";
import { Notification } from "@/models/core/Notification";
import ServiceContainer from "../client/container";

export class TransactionPollingService {
  private readonly MAX_POLL_ATTEMPTS = 100;
  private readonly TIMEOUT_MINUTES = 30;
  private validator = getTransactionStateValidator();

  constructor(
    private transactionRepository: TransactionRepository,
    private nigeriaSmmService: NigeriaSmmService,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private auditLoggingService: AuditLoggingService,
    private userRepository: UserRepository,
  ) { }

  // PROFIT CALCULATION HELPER
  // Same formula as TransactionProcessor and WebhookService, but this one
  // also handles ClubKonnect's amountcharged field which is only available
  // in the polling query result.
  private calculateProfit(params: {
    chargeInfo: any;
    provider: string;
    queryResult: any;

    transactionAmount: number; //transactionAmount: chargeInfo?.baseAmount ?? transaction.amount,
    // baseAmount = what user paid for the product = what was sent to provider
    // NOT totalAmount which includes serviceCharge
    transaction?: any;
  }): { profit: number; providerCharge?: number } {
    const { chargeInfo, provider, queryResult, transactionAmount, transaction } = params;

    if (!chargeInfo) {
      logger.warn(
        "TransactionPollingService.calculateProfit: no chargeInfo, profit = 0",
      );
      return { profit: 0 };
    }

    // 1. Service charge — always present
    const serviceCharge: number = chargeInfo.serviceCharge ?? 0;

    // 3. Provider net — depends on provider
    let providerNet = 0;
    // The actual amount the provider charged/debited us — undefined means
    // "not known from this query result", not "charged 0".
    let providerCharge: number | undefined;
    const providerLower = (
      provider ||
      transaction?.provider ||
      transaction?.polling?.pollingProvider ||
      ""
    ).toLowerCase();

    if (providerLower === "nigeriasmm" || providerLower === "smmfollows" || providerLower === "smmresellerpanel") {
      const chargeUsd = parseFloat(String(queryResult?.charge ?? "0")) || 0;
      const usdToNgnRate = chargeInfo?.usdToNgnRate ? Number(chargeInfo.usdToNgnRate) : null;
      if (chargeUsd > 0 && usdToNgnRate && usdToNgnRate > 0) {
        const chargeNgn = chargeUsd * usdToNgnRate;
        providerNet = (chargeInfo?.baseAmount ?? transactionAmount) - chargeNgn;
        providerCharge = chargeNgn;
      } else if (chargeUsd > 0 && (!usdToNgnRate || usdToNgnRate <= 0)) {
        logger.warn(
          "TransactionPollingService.calculateProfit: USD order has no locked usdToNgnRate in chargeInfo. Profit cannot convert USD charge to NGN without rate.",
          { provider: providerLower, reference: transaction?.reference, chargeUsd },
        );
      }
    } else if (providerLower === "owlet" || providerLower === "owlet_talktiyu") {
      const chargeNgn = parseFloat(String(queryResult?.charge ?? "0")) || 0;
      if (chargeNgn > 0) {
        providerNet = (chargeInfo?.baseAmount ?? transactionAmount) - chargeNgn;
        providerCharge = chargeNgn;
      }
    } else if (providerLower === "savehaven" || providerLower === "safehaven") {
      if (queryResult?.saveHavenDebitedAmount != null && queryResult?.saveHavenDebitedAmount !== "") {
        const shDebited = parseFloat(String(queryResult?.saveHavenDebitedAmount));
        if (!isNaN(shDebited)) {
          providerNet = (chargeInfo?.baseAmount ?? transactionAmount) - shDebited;
          providerCharge = shDebited;
        }
      }
    } else if (providerLower === "textverified") {
      const chargeCredits = parseFloat(String(queryResult?.totalCost ?? queryResult?.charge ?? "0")) || 0;
      const usdToNgnRate = chargeInfo?.usdToNgnRate ? Number(chargeInfo.usdToNgnRate) : null;
      if (chargeCredits > 0 && usdToNgnRate && usdToNgnRate > 0) {
        const chargeNgn = chargeCredits * usdToNgnRate;
        providerNet = (chargeInfo?.baseAmount ?? transactionAmount) - chargeNgn;
        providerCharge = chargeNgn;
      }
    }

    // General fallback: if providerCharge is still undefined, extract from queryResult
    if (providerCharge === undefined && queryResult) {
      const fallbackCost =
        queryResult.total_amount ??
        queryResult.amountcharged ??
        queryResult.amount_charged ??
        queryResult.paid_amount ??
        queryResult.data?.total_amount ??
        queryResult.data?.amount_charged ??
        queryResult.data?.paid_amount;

      if (fallbackCost != null) {
        const cost = parseFloat(String(fallbackCost));
        if (!isNaN(cost) && cost > 0) {
          providerNet = (chargeInfo?.baseAmount ?? transactionAmount) - cost;
          providerCharge = cost;
        }
      }
    }

    const amountSaved: number = chargeInfo.amountSaved ?? 0;
    const profit = serviceCharge + providerNet - amountSaved;

    logger.info("TransactionPollingService.calculateProfit result", {
      provider,
      serviceCharge,
      providerNet,
      providerCharge,
      amountSaved,
      transactionAmount,
      profit,
    });

    return { profit, providerCharge };
  }

  // POLL ALL PENDING TRANSACTIONS
  async pollPendingTransactions(): Promise<void> {
    try {
      const now = new Date();
      const maxTimeoutMinutes = 7 * 24 * 60;
      const timeoutThreshold = new Date(
        now.getTime() - maxTimeoutMinutes * 60 * 1000,
      );

      const pendingTransactions = await this.transactionRepository.find({
        status: "pending",
        "polling.nextPollAt": { $lte: now },
        "polling.stoppedAt": { $exists: false },
        createdAt: { $gte: timeoutThreshold },
      });

      if (pendingTransactions.length > 0) {
        logger.info(
          `Polling ${pendingTransactions.length} pending transactions from various providers`,
        );
      }

      for (const transaction of pendingTransactions) {
        await this.pollSingleTransaction(transaction);
      }
    } catch (error: any) {
      logger.error("Error in pollPendingTransactions", error);
      Sentry.captureException(error, {
        tags: { operation: "pollPendingTransactions" },
      });
    }
  }

  // POLL A SINGLE TRANSACTION
  private async pollSingleTransaction(transaction: any): Promise<void> {
    const transactionId = transaction._id || transaction.id;
    const polling = transaction.polling || {};

    try {
      logger.info(`Polling transaction ${transaction.reference}`, {
        provider: polling.pollingProvider || "unknown",
        pollCount: polling.pollCount,
        providerOrderId: polling.providerOrderId,
      });

      // Check stop conditions
      if (polling.pollCount >= this.MAX_POLL_ATTEMPTS) {
        await this.stopPolling(
          transactionId,
          transaction,
          "max_attempts",
          "Maximum polling attempts reached",
        );
        return;
      }

      const provider = polling.pollingProvider || "nigeriasmm";
      const providerConfig = getProviderConfig(provider);
      const timeoutMinutes = providerConfig?.pollingTimeoutMinutes || this.TIMEOUT_MINUTES;

      const age = Date.now() - new Date(transaction.createdAt).getTime();
      if (age > timeoutMinutes * 60 * 1000) {
        await this.stopPolling(
          transactionId,
          transaction,
          "timeout",
          "Polling timeout reached",
        );
        return;
      }

      const queryResult = await this.queryProviderStatus(
        provider,
        polling.providerOrderId,
        transaction,
      );

      if (!queryResult) {
        logger.warn(
          `No query result for ${transaction.reference} (${provider})`,
        );
        await this.scheduleNextPoll(transactionId, polling);
        return;
      }

      logger.info(
        `Query result for ${transaction.reference} (${provider})`,
        queryResult,
      );

      const { statusCode, status, isThrottled } = this.parseProviderStatus(
        provider,
        queryResult,
      );

      if (
        !isThrottled &&
        this.isSuccessStatus(
          statusCode,
          status,
          provider,
          queryResult,
          transaction,
        )
      ) {
        await this.handleSuccess(
          transactionId,
          transaction,
          queryResult,
          provider,
        );
      } else if (
        !isThrottled &&
        this.isFailureStatus(statusCode, status, provider)
      ) {
        await this.handleFailure(transactionId, transaction, queryResult);
      } else {
        await this.scheduleNextPoll(transactionId, polling);
      }
    } catch (error: any) {
      logger.error(`Error polling transaction ${transaction.reference}`, error);
      await this.scheduleNextPoll(transactionId, polling);
    }
  }

  // QUERY PROVIDER STATUS
  private async queryProviderStatus(
    provider: string,
    providerOrderId: string,
    transaction: ITransaction,
  ): Promise<any> {
    try {
      const providerLower = provider.toLowerCase();

      switch (providerLower) {
        case "nigeriasmm": {
          const orderId = transaction.meta?.providerOrderId ?? providerOrderId;
          if (!orderId) {
            logger.warn(`No providerOrderId for Nigeria SMM transaction ${transaction.reference}`);
            return null;
          }
          return await this.nigeriaSmmService.getOrderStatus(Number(orderId));
        }

        case "smmfollows": {
          const orderId = transaction.meta?.providerOrderId ?? providerOrderId;
          if (!orderId) {
            logger.warn(`No providerOrderId for SmmFollows transaction ${transaction.reference}`);
            return null;
          }
          return await ServiceContainer.getProviderService().getSmmOrderStatus("smmfollows", Number(orderId));
        }

        case "smmresellerpanel": {
          const orderId = transaction.meta?.providerOrderId ?? providerOrderId;
          if (!orderId) {
            logger.warn(`No providerOrderId for SMMResellerPanel transaction ${transaction.reference}`);
            return null;
          }
          return await ServiceContainer.getProviderService().getSmmOrderStatus("smmresellerpanel", Number(orderId));
        }

        case "savehaven":
        case "safehaven": {
          const candidateReferences = [
            providerOrderId,
            transaction.meta?.providerReference,
            (transaction as any).providerReference,
            (transaction as any).providerOrderId,
            transaction.meta?.providerOrderId,
            transaction.meta?.providerResponse?.providerReference,
            transaction.meta?.providerResponse?.reference,
            transaction.polling?.providerOrderId,
            transaction.reference,
          ].filter((ref): ref is string => Boolean(ref && typeof ref === "string"));

          const nonTxnRef = candidateReferences.find((ref) => !ref.startsWith("TXN-"));
          const primaryId = nonTxnRef || candidateReferences[0];
          const fallbackId = candidateReferences.find((ref) => ref !== primaryId) || null;

          if (!primaryId) {
            logger.warn(
              `No query reference for SafeHaven transaction ${transaction.reference}`,
            );
            return null;
          }

          const saveHavenService = ServiceContainer.getSaveHavenService();
          try {
            return await saveHavenService.getVASTransaction(primaryId);
          } catch (err: any) {
            if (fallbackId) {
              logger.warn(
                `SafeHaven VAS query failed for primary reference "${primaryId}". Retrying with fallback reference "${fallbackId}"...`,
              );
              return await saveHavenService.getVASTransaction(fallbackId);
            }
            throw err;
          }
        }

        case "owlet":
        case "owlet_talktiyu": {
          if (
            transaction?.type === "number_rental" ||
            transaction?.meta?.serviceType === "number_rental"
          ) {
            const orderId =
              transaction.meta?.owletOrder ??
              transaction.providerReference ??
              providerOrderId;
            if (!orderId) {
              logger.warn(
                `No owletOrder for Owlet number rental transaction ${transaction.reference}`,
              );
              return null;
            }
            return await ServiceContainer.getProviderService().pollOwletOtp(String(orderId));
          }

          // Default: Owlet SMM
          const orderId = transaction.meta?.providerOrderId ?? providerOrderId;
          if (!orderId) {
            logger.warn(`No providerOrderId for ${provider} transaction ${transaction.reference}`);
            return null;
          }
          return await ServiceContainer.getProviderService().getSmmOrderStatus("owlet", Number(orderId));
        }

        case "5sim":
        case "fivesim": {
          const orderId =
            transaction.meta?.providerOrderId ??
            transaction.providerReference ??
            providerOrderId;
          if (!orderId) {
            logger.warn(
              `No orderId for 5SIM number rental transaction ${transaction.reference}`,
            );
            return null;
          }
          return await ServiceContainer.getProviderService().checkFiveSimOrder(String(orderId));
        }

        case "fleexa":
        case "flexa": {
          const orderId =
            transaction.meta?.providerOrderId ??
            transaction.meta?.emailId ??
            transaction.providerReference ??
            providerOrderId;
          if (!orderId) {
            logger.warn(
              `No orderId for Fleexa transaction ${transaction.reference}`,
            );
            return null;
          }

          if (
            transaction.type === "email_otp" ||
            transaction.meta?.serviceType === "email_otp"
          ) {
            return await ServiceContainer.getProviderService().checkFleexaEmailStatus(String(orderId));
          }

          return await ServiceContainer.getProviderService().checkFleexaSmsStatus(String(orderId));
        }

        case "textverified": {
          const orderId =
            transaction.meta?.providerOrderId ??
            transaction.providerReference ??
            providerOrderId;
          if (!orderId) {
            logger.warn(
              `No orderId for Textverified transaction ${transaction.reference}`,
            );
            return null;
          }
          const verification = await ServiceContainer.getProviderService().checkTextverifiedStatus(String(orderId));
          const smsList = await ServiceContainer.getProviderService()
            .getTextverifiedSms(String(orderId))
            .catch(() => []);
          const firstCode = smsList?.[0]?.parsedCode || "";
          return {
            ...verification,
            sms: (smsList || []).map((m: any) => ({
              sender: m.from || "Textverified",
              text: m.smsContent || "",
              code: m.parsedCode || "",
              date: m.createdAt,
            })),
            parsedCode: firstCode,
            code: firstCode,
          };
        }

        default:
          logger.warn(`No query handler for provider: ${provider}`);
          return null;
      }
    } catch (error: any) {
      logger.error(`Failed to query ${provider} status:`, error);
      return null;
    }
  }

  // PARSE PROVIDER STATUS
  private parseProviderStatus(
    provider: string,
    queryResult: any,
  ): { statusCode: number; status: string; isThrottled?: boolean } {
    const providerLower = provider.toLowerCase();

    switch (providerLower) {
      case "nigeriasmm":
      case "smmfollows":
      case "smmresellerpanel": {
        const s = (queryResult?.status || "").toLowerCase();
        let code: number;
        if (s === "completed" || s === "partial") {
          code = 200;
        } else if (s === "canceled" || s === "cancelled") {
          code = 400;
        } else {
          code = 202; // Pending / In progress / Processing
        }
        return { statusCode: code, status: queryResult?.status || "" };
      }

      case "owlet":
      case "owlet_talktiyu": {
        const s = (queryResult?.status || "").toLowerCase();
        if (
          s === "received" ||
          s === "waiting" ||
          s === "expired" ||
          s === "refunded" ||
          queryResult?.code !== undefined ||
          queryResult?.sms !== undefined
        ) {
          let code = 202; // waiting
          if (s === "received" && queryResult?.code) {
            code = 200;
          } else if (s === "refunded" || s === "cancelled" || s === "expired") {
            code = 400;
          }
          return { statusCode: code, status: queryResult?.status || "" };
        }

        let code: number;
        if (s === "completed" || s === "partial") {
          code = 200;
        } else if (s === "canceled" || s === "cancelled") {
          code = 400;
        } else {
          code = 202; // Pending / In progress / Processing
        }
        return { statusCode: code, status: queryResult?.status || "" };
      }

      case "savehaven":
      case "safehaven": {
        const s = (
          queryResult?.status ||
          queryResult?.data?.status ||
          ""
        ).toLowerCase();
        let code: number;
        if (s === "successful" || s === "success" || s === "completed") {
          code = 200;
        } else if (s === "failed" || s === "cancelled" || s === "refunded" || s === "reversed") {
          code = 400;
        } else {
          code = 202; // pending, processing, submitted
        }
        return {
          statusCode: code,
          status: queryResult?.status || queryResult?.data?.status || s,
        };
      }

      case "5sim":
      case "fivesim": {
        const s = (queryResult?.status || "").toUpperCase();
        let code = 202; // PENDING
        if (
          s === "RECEIVED" ||
          s === "FINISHED" ||
          (Array.isArray(queryResult?.sms) && queryResult.sms.length > 0)
        ) {
          code = 200;
        } else if (
          s === "CANCELED" ||
          s === "CANCELLED" ||
          s === "TIMEOUT" ||
          s === "BANNED"
        ) {
          code = 400;
        }
        return { statusCode: code, status: queryResult?.status || "" };
      }

      case "fleexa":
      case "flexa": {
        const s = String(queryResult?.status || queryResult?.code || "").toUpperCase();
        let code = 202; // PENDING / WAITING
        const otpReceived = queryResult?.code_received || queryResult?.sms;
        if (s === "RECEIVED" || (queryResult?.code && queryResult?.code !== "WAITING") || otpReceived) {
          code = 200;
        } else if (
          s === "CANCELLED" ||
          s === "CANCELED" ||
          s === "EXPIRED"
        ) {
          code = 400;
        }
        return { statusCode: code, status: queryResult?.status || queryResult?.code || "" };
      }

      case "textverified": {
        const state = String(queryResult?.state || "").toLowerCase();
        let code = 202; // PENDING
        if (state === "verificationcompleted" || queryResult?.parsedCode || queryResult?.code) {
          code = 200;
        } else if (
          state === "verificationtimedout" ||
          state === "verificationcanceled" ||
          state === "verificationreported" ||
          state === "verificationrefunded"
        ) {
          code = 400;
        }
        return { statusCode: code, status: queryResult?.state || "" };
      }

      default:
        return {
          statusCode: 0,
          status: "",
        };
    }
  }

  // SUCCESS / FAILURE STATUS CHECKS
  private isSuccessStatus(
    statusCode: number,
    status: string,
    provider: string,
    queryResult?: any,
    transaction?: any,
  ): boolean {
    const providerLower = provider.toLowerCase();

    if (providerLower === "savehaven" || providerLower === "safehaven") {
      return (
        status === "success" ||
        status === "successful" ||
        status === "completed" ||
        statusCode === 200 ||
        statusCode === 0
      );
    }

    if (providerLower === "nigeriasmm" || providerLower === "smmfollows" || providerLower === "smmresellerpanel") {
      return (
        status?.toLowerCase() === "completed" ||
        status?.toLowerCase() === "partial" ||
        statusCode === 200
      );
    }

    if (providerLower === "owlet" || providerLower === "owlet_talktiyu") {
      const s = (status || "").toLowerCase();
      return (
        s === "completed" ||
        s === "partial" ||
        s === "received" ||
        statusCode === 200
      );
    }

    if (providerLower === "5sim" || providerLower === "fivesim") {
      const s = (status || "").toUpperCase();
      return (
        s === "RECEIVED" ||
        s === "FINISHED" ||
        statusCode === 200 ||
        (Array.isArray(queryResult?.sms) && queryResult.sms.length > 0)
      );
    }

    if (providerLower === "fleexa" || providerLower === "flexa") {
      const s = String(status || "").toUpperCase();
      return (
        s === "RECEIVED" ||
        statusCode === 200 ||
        Boolean(queryResult?.code_received) ||
        (Array.isArray(queryResult?.sms) && queryResult.sms.length > 0)
      );
    }

    if (providerLower === "textverified") {
      const s = String(status || "").toLowerCase();
      return (
        s === "verificationcompleted" ||
        statusCode === 200 ||
        Boolean(queryResult?.parsedCode) ||
        Boolean(queryResult?.code) ||
        (Array.isArray(queryResult?.sms) && queryResult.sms.length > 0 && Boolean(queryResult.sms[0]?.code))
      );
    }

    return false;
  }

  private isFailureStatus(
    statusCode: number,
    status: string,
    provider: string,
  ): boolean {
    const providerLower = provider.toLowerCase();

    if (statusCode >= 400 && statusCode < 600) {
      return true;
    }

    if (
      ["failed", "error", "cancelled", "refunded"].includes(
        status?.toLowerCase(),
      )
    ) {
      return true;
    }

    if (providerLower === "nigeriasmm" || providerLower === "smmfollows" || providerLower === "smmresellerpanel") {
      return (
        status?.toLowerCase() === "canceled" ||
        status?.toLowerCase() === "cancelled" ||
        statusCode === 400
      );
    }

    if (providerLower === "owlet" || providerLower === "owlet_talktiyu") {
      const s = (status || "").toLowerCase();
      return (
        s === "canceled" ||
        s === "cancelled" ||
        s === "refunded" ||
        s === "expired" ||
        (statusCode >= 400 && statusCode < 600)
      );
    }

    if (providerLower === "fleexa" || providerLower === "flexa") {
      const s = String(status || "").toUpperCase();
      return (
        s === "CANCELLED" ||
        s === "CANCELED" ||
        s === "EXPIRED" ||
        (statusCode >= 400 && statusCode < 600)
      );
    }

    if (providerLower === "textverified") {
      const s = String(status || "").toLowerCase();
      return (
        s === "verificationtimedout" ||
        s === "verificationcanceled" ||
        s === "verificationreported" ||
        s === "verificationrefunded" ||
        (statusCode >= 400 && statusCode < 600)
      );
    }

    return false;
  }

  // HANDLE SUCCESS
  // Calculates profit and persists it alongside the status update.
  // provider is passed through from pollSingleTransaction so we know
  // which formula to apply (VTPass vs ClubKonnect vs others).
  private async handleSuccess(
    transactionId: string,
    transaction: any,
    queryResult: any,
    provider: string,
  ): Promise<void> {
    logger.info(`Transaction ${transaction.reference} completed successfully`, {
      provider,
    });

    // Calculate profit using chargeInfo stored at debit time
    // and any provider-specific fields from the query result

    const chargeInfo = transaction.meta?.chargeInfo;
    const { profit, providerCharge } = this.calculateProfit({
      chargeInfo,
      provider,
      queryResult,
      transactionAmount: chargeInfo?.baseAmount ?? transaction.amount, // base amount sent to provider
      transaction,
    });

    // Merge, don't replace — keep whatever was captured in providerResponse
    // at purchase time and layer this poll/requery result plus
    // totalProviderCharge on top of it, instead of overwriting it outright.
    const mergedProviderResponse = {
      ...transaction.meta?.providerResponse,
      ...queryResult,
      success: true,
      pending: false,
      message:
        queryResult.message ||
        `${transaction.type || "Transaction"} successful`,
      ...(providerCharge !== undefined && { totalProviderCharge: providerCharge }),
    };

    await this.transactionRepository.update(transactionId, {
      status: "success",
      profit,
      "polling.stoppedAt": new Date(),
      "polling.stopReason": "completed",
      "polling.lastPolledAt": new Date(),
      "meta.providerResponse": mergedProviderResponse,
      "meta.providerResponseAt": new Date(),
      // ClubKonnect fields, now captured regardless of transaction type
      // (previously gated behind type === "electricity" only).
      ...(queryResult.amountcharged != null && {
        "meta.amountcharged": queryResult.amountcharged,
      }),
      ...(queryResult.walletbalance != null && {
        "meta.walletbalance": queryResult.walletbalance,
      }),
      ...(queryResult.remark != null && {
        "meta.remark": queryResult.remark,
      }),
      ...(((provider?.toLowerCase() === "nigeriasmm" || provider?.toLowerCase() === "smmfollows" || provider?.toLowerCase() === "smmresellerpanel" || provider?.toLowerCase() === "owlet") && String(queryResult?.status).toLowerCase() === "partial") && {
        "meta.smmPartial": true,
        "meta.smmRemains": queryResult?.remains,
        "meta.pendingManualRefund": true,
      }),
      ...(transaction.type === "electricity" && {
        "meta.token": (
          queryResult.metertoken ||
          queryResult.data?.metertoken ||
          queryResult.token ||
          queryResult.data?.token ||
          queryResult.utilityToken ||
          queryResult.data?.utilityToken
        )
          ? (
              queryResult.metertoken ||
              queryResult.data?.metertoken ||
              queryResult.token ||
              queryResult.data?.token ||
              queryResult.utilityToken ||
              queryResult.data?.utilityToken
            )
              .replace(/^TOKEN:\s*/i, "")
              .trim()
          : transaction.meta?.token || "",
        "meta.meterNumber":
          queryResult.meterno ||
          queryResult.data?.meterno ||
          transaction.meta?.meterNumber ||
          "",
        "meta.customerName": transaction.meta?.customerName || "",
        "meta.customerAddress": transaction.meta?.customerAddress || "",
        ...((queryResult.units || queryResult.data?.units) && {
          "meta.units": queryResult.units || queryResult.data?.units,
        }),
      }),
      ...(transaction.type === "data_epin" &&
        queryResult.TXN_EPIN_DATABUNDLE?.length && {
        "meta.epins": queryResult.TXN_EPIN_DATABUNDLE,
      }),
      ...((transaction.type === "number_rental" || transaction.meta?.serviceType === "number_rental") && {
        ...(queryResult.sms?.[0]?.code && { "meta.otpCode": queryResult.sms[0].code }),
        ...(queryResult.sms && { "meta.sms": queryResult.sms }),
        ...(queryResult.code && { "meta.otpCode": queryResult.code }),
        ...(queryResult.parsedCode && { "meta.otpCode": queryResult.parsedCode }),
      }),
      ...((transaction.type === "email_otp" || transaction.meta?.serviceType === "email_otp") && {
        ...((queryResult.code_received || queryResult.sms) && { "meta.otpCode": queryResult.code_received || queryResult.sms }),
        ...(queryResult.code_received && { "meta.code_received": queryResult.code_received }),
        ...(queryResult.sms && { "meta.sms": queryResult.sms }),
        ...(queryResult.email && { "meta.email": queryResult.email }),
      }),
    });

    if (
      (provider?.toLowerCase() === "5sim" || provider?.toLowerCase() === "fivesim") &&
      (transaction.type === "number_rental" || transaction.meta?.serviceType === "number_rental")
    ) {
      const orderId = transaction.meta?.providerOrderId || transaction.providerReference;
      if (orderId) {
        ServiceContainer.getProviderService()
          .finishFiveSimOrder(String(orderId))
          .catch((finishErr: any) =>
            logger.warn(`Polling: could not finish 5SIM order ${orderId} on completion:`, finishErr),
          );
      }
    }

    // Award pending cashback if applicable
    if (
      transaction.meta?.cashbackInfo &&
      !transaction.meta.cashbackInfo.credited &&
      transaction.meta.cashbackInfo.amount > 0
    ) {
      const cashbackAmount = transaction.meta.cashbackInfo.amount;
      const serviceName =
        transaction.meta.serviceName ||
        transaction.meta.cashbackInfo.serviceName ||
        "bill";
      const userId = (
        transaction.sourceId || transaction.userId
      )?.toString();

      if (userId) {
        await this.walletService
          .creditBonus(
            userId,
            cashbackAmount,
            `Cashback earned from ${serviceName} purchase`,
            {
              type: "cashback_earned",
              provider: serviceName,
              meta: {
                earningTransactionId:
                  transaction._id?.toString() || transactionId,
              },
              initiatedBy: new Types.ObjectId(userId),
            },
          )
          .then(async () => {
            await this.transactionRepository
              .update(transactionId, {
                "meta.cashbackInfo.credited": true,
                "meta.cashbackInfo.creditedAt": new Date(),
              })
              .catch((err) =>
                logger.error(
                  "Failed to mark cashback as credited in polling",
                  err,
                ),
              );
            logger.info(
              `[Polling] Credited ₦${cashbackAmount} cashback to user ${userId} for transaction ${transaction.reference}`,
            );
          })
          .catch((e) =>
            logger.error("Failed to credit cashback on polling success", e),
          );
      }
    }

    logger.info("Profit set on polling success", {
      reference: transaction.reference,
      profit,
      provider,
    });

    // Trade/referral bonus processing removed (billpayment feature)

    await this.auditLoggingService.logPollingEvent({
      transactionId: transaction._id.toString(),
      transactionReference: transaction.reference,
      pollCount: transaction.polling?.pollCount || 0,
      status: "success",
      details: {
        provider: transaction.polling?.pollingProvider,
        meterToken: queryResult.metertoken,
        cardDetails: queryResult.carddetails,
        profit,
      },
    });

    // Background evaluation of VIP tier status
    const targetUserId = transaction.userId || transaction.sourceId;
    if (targetUserId) {
      ServiceContainer.getUserTierProgressionService()
        .evaluateAndPromoteUser(targetUserId.toString())
        .catch((err) => logger.error("Tier evaluation on poll success failed:", err));
    }

    await this.notificationService
      .createNotification({
        type: "transaction_success",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(transaction.sourceId),
        data: {
          transactionType: this.getTransactionTypeLabel(transaction.type),
          amount: transaction.amount,
          reference: transaction.reference,
          token:
            queryResult.metertoken ||
            queryResult.carddetails ||
            queryResult.utilityToken ||
            queryResult.data?.utilityToken ||
            queryResult.token ||
            queryResult.data?.token ||
            undefined,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("Failed to create success notification", err),
      );

    if ((provider?.toLowerCase() === "nigeriasmm" || provider?.toLowerCase() === "smmfollows" || provider?.toLowerCase() === "smmresellerpanel") && queryResult?.status === "Partial") {
      logger.warn(`${provider} order ${transaction.reference} completed partially. Manual refund of remains needed`, {
        orderId: transaction.meta?.providerOrderId,
        remains: queryResult?.remains,
      });
    }

    // Partner webhook removed (partner system removed)
  }

  // -------------------------------------------------------------------------
  // BATCH POLL NIGERIA SMM
  // Called for all pending nigeriasmm transactions.
  // Uses a single getMultiOrderStatus() call rather than one HTTP request per txn.
  // -------------------------------------------------------------------------
  async pollNigeriaSmmBatch(): Promise<void> {
    try {
      const now = new Date();
      // Use max timeout to catch all transactions that might be pending
      const maxTimeoutMinutes = 7 * 24 * 60; // 7 days
      const timeoutThreshold = new Date(now.getTime() - maxTimeoutMinutes * 60 * 1000);

      const pending = await (this.transactionRepository as any).find({
        status: "pending",
        "polling.pollingProvider": "nigeriasmm",
        "polling.stoppedAt": { $exists: false },
        createdAt: { $gte: timeoutThreshold },
      });

      if (!pending || !pending.length) return;

      logger.info(`Nigeria SMM batch poll: ${pending.length} pending transactions`);

      // Collect order ids — skip any that don't have one yet
      const orderedTxns = pending.filter((t: any) => t.meta?.providerOrderId);
      if (!orderedTxns.length) {
        // No order IDs — just reschedule
        await Promise.all(
          pending.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      const orderIds = orderedTxns.map((t: any) => Number(t.meta!.providerOrderId));

      let multiStatus: Record<string, any> = {};
      try {
        multiStatus = await this.nigeriaSmmService.getMultiOrderStatus(orderIds);
      } catch (err: any) {
        logger.error("Nigeria SMM batch status fetch failed, will retry next poll cycle", {
          error: err.message,
        });
        // Reschedule all; don't mark as failed just because the status call bombed
        await Promise.all(
          orderedTxns.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      await Promise.all(
        orderedTxns.map(async (transaction: any) => {
          const transactionId = transaction._id.toString();
          const orderId = String(transaction.meta!.providerOrderId);
          const statusEntry = multiStatus[orderId];

          // Handle per-order error (e.g. order not found on their side)
          if (!statusEntry || "error" in statusEntry) {
            logger.warn(`Nigeria SMM: no valid status for order ${orderId}`, { statusEntry });
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
            return;
          }

          const { statusCode, status } = this.parseProviderStatus("nigeriasmm", statusEntry);

          if (this.isSuccessStatus(statusCode, status, "nigeriasmm")) {
            await this.handleSuccess(transactionId, transaction, statusEntry, "nigeriasmm");
          } else if (this.isFailureStatus(statusCode, status, "nigeriasmm")) {
            await this.handleFailure(transactionId, transaction, statusEntry);
          } else {
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
          }
        }),
      );

      // Transactions with no orderId yet (still placing) — reschedule
      const noOrderId = pending.filter((t: any) => !t.meta?.providerOrderId);
      await Promise.all(
        noOrderId.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
      );
    } catch (error: any) {
      logger.error("pollNigeriaSmmBatch failed", error);
      Sentry.captureException(error, { tags: { operation: "pollNigeriaSmmBatch" } });
    }
  }

  // -------------------------------------------------------------------------
  // BATCH POLL SMMFOLLOWS
  // -------------------------------------------------------------------------
  async pollSmmFollowsBatch(): Promise<void> {
    try {
      const now = new Date();
      const maxTimeoutMinutes = 7 * 24 * 60; // 7 days
      const timeoutThreshold = new Date(now.getTime() - maxTimeoutMinutes * 60 * 1000);

      const pending = await (this.transactionRepository as any).find({
        status: "pending",
        "polling.pollingProvider": "smmfollows",
        "polling.stoppedAt": { $exists: false },
        createdAt: { $gte: timeoutThreshold },
      });

      if (!pending || !pending.length) return;

      logger.info(`SMMFollows batch poll: ${pending.length} pending transactions`);

      const orderedTxns = pending.filter((t: any) => t.meta?.providerOrderId);
      if (!orderedTxns.length) {
        await Promise.all(
          pending.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      const orderIds = orderedTxns.map((t: any) => Number(t.meta!.providerOrderId));

      let multiStatus: Record<string, any> = {};
      try {
        multiStatus = await ServiceContainer.getProviderService().getSmmMultiOrderStatus("smmfollows", orderIds);
      } catch (err: any) {
        logger.error("SMMFollows batch status fetch failed, will retry next poll cycle", {
          error: err.message,
        });
        await Promise.all(
          orderedTxns.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      await Promise.all(
        orderedTxns.map(async (transaction: any) => {
          const transactionId = transaction._id.toString();
          const orderId = String(transaction.meta!.providerOrderId);
          const statusEntry = multiStatus[orderId];

          if (!statusEntry || "error" in statusEntry) {
            logger.warn(`SMMFollows: no valid status for order ${orderId}`, { statusEntry });
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
            return;
          }

          const { statusCode, status } = this.parseProviderStatus("smmfollows", statusEntry);

          if (this.isSuccessStatus(statusCode, status, "smmfollows")) {
            await this.handleSuccess(transactionId, transaction, statusEntry, "smmfollows");
          } else if (this.isFailureStatus(statusCode, status, "smmfollows")) {
            await this.handleFailure(transactionId, transaction, statusEntry);
          } else {
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
          }
        }),
      );

      const noOrderId = pending.filter((t: any) => !t.meta?.providerOrderId);
      await Promise.all(
        noOrderId.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
      );
    } catch (error: any) {
      logger.error("pollSmmFollowsBatch failed", error);
      Sentry.captureException(error, { tags: { operation: "pollSmmFollowsBatch" } });
    }
  }

  // -------------------------------------------------------------------------
  // BATCH POLL SMMRESELLERPANEL
  // -------------------------------------------------------------------------
  async pollSmmResellerPanelBatch(): Promise<void> {
    try {
      const now = new Date();
      const maxTimeoutMinutes = 7 * 24 * 60; // 7 days
      const timeoutThreshold = new Date(now.getTime() - maxTimeoutMinutes * 60 * 1000);

      const pending = await (this.transactionRepository as any).find({
        status: "pending",
        "polling.pollingProvider": "smmresellerpanel",
        "polling.stoppedAt": { $exists: false },
        createdAt: { $gte: timeoutThreshold },
      });

      if (!pending || !pending.length) return;

      logger.info(`SMMResellerPanel batch poll: ${pending.length} pending transactions`);

      const orderedTxns = pending.filter((t: any) => t.meta?.providerOrderId);
      if (!orderedTxns.length) {
        await Promise.all(
          pending.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      const orderIds = orderedTxns.map((t: any) => Number(t.meta!.providerOrderId));

      let multiStatus: Record<string, any> = {};
      try {
        multiStatus = await ServiceContainer.getProviderService().getSmmMultiOrderStatus("smmresellerpanel", orderIds);
      } catch (err: any) {
        logger.error("SMMResellerPanel batch status fetch failed, will retry next poll cycle", {
          error: err.message,
        });
        await Promise.all(
          orderedTxns.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
        );
        return;
      }

      await Promise.all(
        orderedTxns.map(async (transaction: any) => {
          const transactionId = transaction._id.toString();
          const orderId = String(transaction.meta!.providerOrderId);
          const statusEntry = multiStatus[orderId];

          if (!statusEntry || "error" in statusEntry) {
            logger.warn(`SMMResellerPanel: no valid status for order ${orderId}`, { statusEntry });
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
            return;
          }

          const { statusCode, status } = this.parseProviderStatus("smmresellerpanel", statusEntry);

          if (this.isSuccessStatus(statusCode, status, "smmresellerpanel")) {
            await this.handleSuccess(transactionId, transaction, statusEntry, "smmresellerpanel");
          } else if (this.isFailureStatus(statusCode, status, "smmresellerpanel")) {
            await this.handleFailure(transactionId, transaction, statusEntry);
          } else {
            await this.scheduleNextPoll(transactionId, transaction.polling || {});
          }
        }),
      );

      const noOrderId = pending.filter((t: any) => !t.meta?.providerOrderId);
      await Promise.all(
        noOrderId.map((t: any) => this.scheduleNextPoll(t._id.toString(), t.polling || {})),
      );
    } catch (error: any) {
      logger.error("pollSmmResellerPanelBatch failed", error);
      Sentry.captureException(error, { tags: { operation: "pollSmmResellerPanelBatch" } });
    }
  }



  // HANDLE FAILURE
  // BUG FIX: was refunding transaction.amount (base amount) instead of
  // the full debited amount. Now uses chargeInfo.totalAmount with fallback.
  private async handleFailure(
    transactionId: string,
    transaction: any,
    queryResult: any,
  ): Promise<void> {
    logger.warn(
      `Transaction ${transaction.reference} failed - Status: ${queryResult.status}`,
      queryResult,
    );

    // FIXED: refund the full debited amount (base + serviceCharge),
    // not just the base amount. chargeInfo.totalAmount is what was
    // actually taken from the user's wallet.
    const refundAmount =
      transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

    await this.walletService.creditWallet(
      transaction.sourceId.toString(),
      refundAmount,
      `${this.getTransactionTypeLabel(transaction.type)} refund`,
      {
        type: "refund",
        provider: transaction.polling?.pollingProvider || "system",
        idempotencyKey: `${transaction.reference}_polling_refund`,
        initiatedByType: "system",
        linkedTransactionId: transaction._id as Types.ObjectId, // ← added
        remark: `Refund: ₦${refundAmount} for failed ${this.getTransactionTypeLabel(transaction.type)} (Ref: ${transaction.reference})`,
        meta: {
          originalReference: transaction.reference,
          reason: "polling_failed",
          suppressNotification: true,
        },
      },
    );

    // Merge the provider's failure/reversal response into meta.providerResponse
    const mergedProviderResponse = {
      ...transaction.meta?.providerResponse,
      ...queryResult,
      success: false,
      pending: false,
      message:
        queryResult.message ||
        queryResult.remark ||
        `${transaction.type || "Transaction"} failed`,
    };

    await this.transactionRepository.update(transactionId, {
      status: "failed",
      profit: 0,
      "polling.stoppedAt": new Date(),
      "polling.stopReason": "failed",
      "polling.lastPolledAt": new Date(),
      "meta.providerResponse": mergedProviderResponse,
      "meta.providerResponseAt": new Date(),
      failureReason: queryResult.remark || queryResult.status,
    });

    await this.auditLoggingService.logPollingEvent({
      transactionId: transaction._id.toString(),
      transactionReference: transaction.reference,
      pollCount: transaction.polling?.pollCount || 0,
      status: "failed",
      details: {
        provider: transaction.polling?.pollingProvider,
        failureReason: queryResult.remark || queryResult.status,
        refunded: true,
        refundedAmount: refundAmount,
      },
    });

    await Promise.allSettled([
      this.notificationService.createNotification({
        type: "transaction_failed",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(transaction.sourceId),
        data: {
          transactionType: this.getTransactionTypeLabel(transaction.type),
          amount: transaction.amount,
          reference: transaction.reference,
          reason: queryResult.remark || "Transaction failed",
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      }),
      this.notificationService.notifySuperAdminsOfFailure({
        transaction: {
          ...transaction,
          provider: transaction.polling?.pollingProvider || transaction.provider,
        },
        reason: queryResult.remark || queryResult.status || "Polled transaction failed",
      })
    ]).catch((err) =>
      logger.error("Failed to create failure notifications during polling", err),
    );
  }

  // SCHEDULE NEXT POLL
  private async scheduleNextPoll(
    transactionId: string,
    polling: any,
  ): Promise<void> {
    const pollCount = (polling.pollCount || 0) + 1;

    let nextPollDelay: number;

    if (pollCount <= 12) {
      nextPollDelay = 10 * 1000; // first ~2 minutes: every 10s
    } else if (pollCount <= 18) {
      nextPollDelay = 30 * 1000; // next ~3 minutes: every 30s
    } else if (pollCount <= 28) {
      nextPollDelay = 60 * 1000; // next ~10 minutes: every 60s
    } else {
      nextPollDelay = 5 * 60 * 1000; // after that: every 5 minutes
    }

    const nextPollAt = new Date(Date.now() + nextPollDelay);

    const transaction = await this.transactionRepository.update(transactionId, {
      "polling.pollCount": pollCount,
      "polling.lastPolledAt": new Date(),
      "polling.nextPollAt": nextPollAt,
    });

    await this.auditLoggingService.logPollingEvent({
      transactionId: transactionId,
      transactionReference: transaction?.reference || "unknown",
      pollCount,
      status: "attempt",
      details: {
        nextPollAt: nextPollAt.toISOString(),
        pollDelayMs: nextPollDelay,
      },
    });
  }

  // STOP POLLING
  private async stopPolling(
    transactionId: string,
    transaction: any,
    reason: "completed" | "failed" | "timeout" | "max_attempts",
    message: string,
  ): Promise<void> {
    logger.warn(
      `Stopping polling for transaction ${transaction.reference}: ${message}`,
    );

    await this.transactionRepository.update(transactionId, {
      "polling.stoppedAt": new Date(),
      "polling.stopReason": reason,
      "polling.lastPolledAt": new Date(),
    });

    if (reason === "timeout" || reason === "max_attempts") {
      SentryHelper.captureBusinessError(
        "STUCK_TRANSACTION",
        `Transaction stuck: ${transaction.reference} - ${reason}`,
        transaction.sourceId?.toString(),
        {
          reference: transaction.reference,
          provider: transaction.polling?.pollingProvider,
          pollCount: transaction.polling?.pollCount,
          reason,
          type: transaction.type,
          amount: transaction.amount,
        },
      );

      logger.error(
        `Transaction ${transaction.reference} stuck in pending state`,
        {
          reason,
          provider: transaction.polling?.pollingProvider,
          pollCount: transaction.polling?.pollCount,
          age: Date.now() - new Date(transaction.createdAt).getTime(),
        },
      );

      await this.alertAdminForStuckTransaction({
        reference: transaction.reference,
        transactionId,
        reason,
        provider: transaction.polling?.pollingProvider || "unknown",
        pollCount: transaction.polling?.pollCount || 0,
        transactionAge: Date.now() - new Date(transaction.createdAt).getTime(),
        transaction,
      });

      logger.info(
        `Transaction ${transaction.reference} marked for manual review. Potential refund required.`,
        {
          provider: transaction.polling?.pollingProvider,
          type: transaction.type,
          amount: transaction.amount,
          direction: transaction.direction,
        },
      );
    }
  }

  // HELPERS
  private getTransactionTypeLabel(type: string): string {
    const labels: { [key: string]: string } = {
      smm: "SMM Order",
      game_topup: "Game Top-Up",
      number_rental: "Number Rental",
      proxy: "Proxy Purchase",
    };

    return labels[type] || type;
  }

  private async alertAdminForStuckTransaction(data: {
    reference: string;
    transactionId: string;
    reason: "timeout" | "max_attempts";
    provider: string;
    pollCount: number;
    transactionAge: number;
    transaction: any;
  }): Promise<void> {
    const ageInMinutes = Math.floor(data.transactionAge / 60000);
    const ageInHours = Math.floor(ageInMinutes / 60);

    const notificationData = {
      reference: data.reference,
      transactionId: data.transactionId,
      provider: data.provider,
      reason: data.reason,
      reasonLabel:
        data.reason === "timeout"
          ? "Transaction polling timeout reached"
          : "Maximum polling attempts exceeded",
      pollCount: data.pollCount,
      transactionAge: {
        minutes: ageInMinutes,
        hours: ageInHours,
        milliseconds: data.transactionAge,
      },
      status: data.transaction.status,
      type: data.transaction.type,
      amount: data.transaction.amount,
      direction: data.transaction.direction,
      createdAt: data.transaction.createdAt,
      severity: "critical",
      action: "MANUAL_REVIEW_AND_REFUND_REQUIRED",
      timestamp: new Date().toISOString(),
    };

    const message = `A transaction has been stuck in pending state and polling has stopped.

Provider: ${data.provider}
Reference: ${data.reference}
Reason: ${notificationData.reasonLabel}
Poll Attempts: ${data.pollCount}
Transaction Age: ${ageInHours}h ${ageInMinutes % 60}m
Amount: ₦${Number(data.transaction.amount || 0).toLocaleString()}
Status: ${data.transaction.status}

Manual review and potential refund/requery required.`;

    try {
      // 1. Resolve Super Admin emails
      const adminEmails = new Set<string>();
      let superAdmins: any[] = [];

      try {
        const adminRepo = ServiceContainer.getAdminRepository();
        superAdmins = await adminRepo.getAllSuperAdmins();
        for (const a of superAdmins) {
          if (a.email) adminEmails.add(a.email.toLowerCase().trim());
        }
      } catch (e) {
        logger.error("[Polling] Error loading super admins from DB", e);
      }

      if (process.env.SUPER_ADMIN_EMAIL) {
        adminEmails.add(process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim());
      }
      if (process.env.EMERGENCY_SECURITY_ALERT_EMAIL) {
        adminEmails.add(process.env.EMERGENCY_SECURITY_ALERT_EMAIL.toLowerCase().trim());
      }
      if (process.env.ADMIN_EMAIL) {
        adminEmails.add(process.env.ADMIN_EMAIL.toLowerCase().trim());
      }
      if (adminEmails.size === 0) {
        adminEmails.add("opaferanmi01@gmail.com");
      }

      // 2. Send Emails to All Super Admins
      const emailPromises = Array.from(adminEmails).map((toEmail) =>
        this.emailService
          .sendSystemNotificationToAdmin(
            toEmail,
            `⚠️ CRITICAL: Stuck Transaction - ${data.reference}`,
            notificationData,
            message,
          )
          .catch((err) =>
            logger.error(
              `Failed to alert admin ${toEmail} for stuck transaction: ${data.reference}`,
              err,
            ),
          ),
      );

      // 3. Create In-App Notifications for Super Admins
      const inAppPromises = superAdmins.map((admin) =>
        Notification.create({
          type: "stuck_transaction_alert",
          notifiableType: "Admin",
          notifiableId: admin._id,
          title: `⚠️ Polling Stopped: ${data.reference}`,
          message: `Transaction ${data.reference} (₦${Number(data.transaction?.amount || 0).toLocaleString()}) for ${data.transaction?.type} (${data.provider}) polling stopped (${notificationData.reasonLabel}). Still pending.`,
          data: {
            transactionId: data.transactionId,
            reference: data.reference,
            provider: data.provider,
            reason: data.reason,
            pollCount: data.pollCount,
            amount: data.transaction?.amount,
            status: data.transaction?.status,
          },
          read: false,
        }).catch((e) =>
          logger.error("[Polling] Failed to create in-app alert for admin", e),
        ),
      );

      await Promise.allSettled([...emailPromises, ...inAppPromises]);

      // 4. Update transaction metadata so watchdog recognizes alert was sent
      await this.transactionRepository
        .update(data.transactionId, {
          "meta.adminPendingAlertSentAt": new Date(),
          "meta.adminPendingAlertCount":
            (Number(data.transaction.meta?.adminPendingAlertCount) || 0) + 1,
        })
        .catch(() => {});

      logger.info(
        `CRITICAL ALERT: Stuck Transaction - ${data.reference}`,
        notificationData,
      );
    } catch (err: any) {
      logger.error(
        `Failed to alert admin for stuck transaction: ${data.reference}`,
        err,
      );
    }
  }

  // MANUAL REQUERY — admin-triggered, on-demand check for transactions the
  // automatic poller already gave up on (timeout / max attempts) or that are stuck in pending/processing.
  // Read-only against the provider — never resends the purchase, only asks
  // "what actually happened to this order" and updates our record from the answer.
  async manualRequeryTransaction(
    transactionId: string,
    options?: { silentCooldown?: boolean; cooldownMs?: number },
  ): Promise<{
    outcome: "success" | "failed" | "still_pending" | "escalated";
    message: string;
  }> {
    const transaction =
      await this.transactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (transaction.status !== "pending" && transaction.status !== "processing") {
      if (options?.silentCooldown) {
        return {
          outcome: transaction.status === "success" ? "success" : "failed",
          message: `Transaction is already ${transaction.status}`,
        };
      }
      throw new AppError(
        "Only pending or processing transactions can be requeried",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const polling: any = transaction.polling || {};
    const cooldownLimit = options?.cooldownMs ?? 30 * 1000;

    // Cooldown — block accidental rapid double-clicks hitting the provider
    if (
      polling.lastPolledAt &&
      Date.now() - new Date(polling.lastPolledAt).getTime() < cooldownLimit
    ) {
      if (options?.silentCooldown) {
        return {
          outcome: "still_pending",
          message: "Requery cooldown active, skipping duplicate check",
        };
      }
      throw new AppError(
        "Please wait 30 seconds before requerying this transaction again",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const provider = (
      transaction.provider ||
      polling.pollingProvider ||
      transaction.meta?.providerResponse?.providerCode ||
      transaction.meta?.providerCode ||
      transaction.meta?.provider ||
      ""
    ).toLowerCase();

    if (!provider) {
      throw new AppError(
        "Could not determine provider for this transaction",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const providerOrderId =
      polling.providerOrderId ||
      (transaction as any).providerOrderId ||
      transaction.meta?.providerOrderId ||
      transaction.meta?.providerReference ||
      transaction.meta?.providerResponse?.providerReference ||
      transaction.meta?.providerResponse?.data?.transactionid ||
      transaction.meta?.providerResponse?.data?.orderid ||
      transaction.meta?.providerResponse?.orderId ||
      transaction.meta?.providerResponse?.order_id ||
      transaction.meta?.providerResponse?.reference ||
      transaction.polling?.internalReference ||
      transaction.meta?.internalReference ||
      transaction.reference;

    if (!providerOrderId) {
      throw new AppError(
        "Could not find provider order reference for this transaction",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const queryResult = await this.queryProviderStatus(
      provider,
      providerOrderId,
      transaction,
    );

    await this.transactionRepository.update(transactionId, {
      $set: {
        "polling.lastPolledAt": new Date(),
        ...((queryResult?.providerOrderId || !polling.providerOrderId) && {
          "polling.providerOrderId": queryResult?.providerOrderId || providerOrderId,
        }),
        ...(!polling.pollingProvider && { "polling.pollingProvider": provider }),
      },
    });

    if (!queryResult) {
      return this.handleInconclusiveManualRequery(
        transactionId,
        transaction,
        polling,
      );
    }

    const { statusCode, status, isThrottled } = this.parseProviderStatus(
      provider,
      queryResult,
    );

    if (isThrottled) {
      return {
        outcome: "still_pending",
        message:
          "Provider request throttled. Please wait at least 30 seconds before requerying.",
      };
    }

    if (
      this.isSuccessStatus(
        statusCode,
        status,
        provider,
        queryResult,
        transaction,
      )
    ) {
      await this.handleSuccess(
        transactionId,
        transaction,
        queryResult,
        provider,
      );
      return {
        outcome: "success",
        message:
          "Provider confirms this transaction succeeded — it has been completed and updated.",
      };
    }

    if (this.isFailureStatus(statusCode, status, provider)) {
      await this.handleFailure(transactionId, transaction, queryResult);
      return {
        outcome: "failed",
        message:
          "Provider confirms this transaction failed — it has been marked failed and refunded.",
      };
    }

    return this.handleInconclusiveManualRequery(
      transactionId,
      transaction,
      polling,
      status || queryResult?.message || queryResult?.remark,
    );
  }

  // First stale check after the original timeout → record poll and provide status message.
  private async handleInconclusiveManualRequery(
    transactionId: string,
    transaction: any,
    polling: any,
    providerStatusMsg?: string,
  ): Promise<{ outcome: "still_pending" | "escalated"; message: string }> {
    const manualRequeryCount = (polling.manualRequeryCount || 0) + 1;

    await this.transactionRepository.update(transactionId, {
      $set: {
        "polling.lastPolledAt": new Date(),
        "polling.manualRequeryCount": manualRequeryCount,
      },
    });

    return {
      outcome: "still_pending",
      message: providerStatusMsg
        ? `Provider status: ${providerStatusMsg}. Transaction is still pending at the provider.`
        : "Provider hasn't confirmed a final status yet. Transaction is still pending at the provider.",
    };
  }

  private async notifyAdminsOfStuckTransaction(
    transaction: any,
  ): Promise<void> {
    try {
      await this.emailService.sendSystemNotificationToAdmin(
        process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "",
        `Stuck Transaction Needs Review - ${transaction.reference}`,
        {
          severity: "warning",
          transactionReference: transaction.reference,
          transactionId: transaction._id?.toString(),
          type: transaction.type,
          amount: transaction.amount,
          userId: transaction.userId?.toString(),
          provider: transaction.polling?.pollingProvider,
          providerOrderId: transaction.polling?.providerOrderId,
        },
        "This transaction has now failed to resolve twice — once via automatic polling, once via a manual requery. The provider still hasn't given a clear success/failure answer. It needs a human to check the provider dashboard directly rather than more automated retries.",
      );
    } catch (error) {
      logger.error(
        `Failed to send stuck-transaction admin notification for ${transaction.reference}`,
        error,
      );
    }
  }

  // ALIAS FOR AUTOMATED & JIT REQUERY
  async requeryTransaction(
    transactionId: string,
    options?: { silentCooldown?: boolean; cooldownMs?: number },
  ) {
    return this.manualRequeryTransaction(transactionId, options);
  }
}
