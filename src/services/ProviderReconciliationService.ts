import { Transaction } from "@/models/wallet/Transaction";
import { SettlementDiscrepancy } from "@/models/system/SettlementDiscrepancy";
import { SettlementReconciliationRun } from "@/models/system/SettlementReconciliationRun";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { MonnifyService } from "@/services/client/providers/payments/MonnifyService";
import { FlutterwaveService } from "@/services/client/providers/payments/FlutterwaveService";
import { EmailService } from "@/services/core/EmailService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

interface ProviderTransaction {
  reference: string;
  amount: number;
  status: string;
  type: "inbound" | "outbound";
}

interface ReconciliationResult {
  runId: string;
  provider: string;
  date: string;
  status: "completed" | "failed" | "partial";
  startedAt: string;
  completedAt: string;
  totalProviderTransactions: number;
  totalOurTransactions: number;
  matched: number;
  missingInOurDb: number;
  missingInProvider: number;
  amountMismatches: number;
  discrepanciesCreated: number;
  providerApiReachable: boolean;
  durationMs: number;
  errorMessage?: string;
}

export class ProviderReconciliationService {
  constructor(
    private saveHavenService: SaveHavenService,
    private monnifyService: MonnifyService,
    private flutterwaveService: FlutterwaveService,
    private auditLoggingService: AuditLoggingService,
    private emailService: EmailService,
  ) {}

  // Run T+1 reconciliation for all providers
  // Reconciles yesterday's transactions
  async reconcileAllProviders(specificDate?: string): Promise<{
    saveHaven: ReconciliationResult | null;
    monnify: ReconciliationResult | null;
    flutterwave: ReconciliationResult | null;
    totalDiscrepancies: number;
    criticalDiscrepancies: number;
  }> {
    let dateStr: string;
    // T+1 — always reconcile yesterday
    if (specificDate) {
      dateStr = specificDate;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      dateStr = yesterday.toISOString().split("T")[0];
    }

    logger.info(`Starting T+1 settlement reconciliation for ${dateStr}`);

    const [saveHavenResult, monnifyResult, flutterwaveResult] =
      await Promise.all([
        this.reconcileProvider("saveHaven", dateStr).catch((err) => {
          logger.error("SaveHaven reconciliation failed", err);
          return null;
        }),
        this.reconcileProvider("monnify", dateStr).catch((err) => {
          logger.error("Monnify reconciliation failed", err);
          return null;
        }),
        this.reconcileProvider("flutterwave", dateStr).catch((err) => {
          logger.error("Flutterwave reconciliation failed", err);
          return null;
        }),
      ]);

    const totalDiscrepancies =
      (saveHavenResult?.discrepanciesCreated || 0) +
      (monnifyResult?.discrepanciesCreated || 0) +
      (flutterwaveResult?.discrepanciesCreated || 0);

    // Count critical ones created today
    const criticalCount = await SettlementDiscrepancy.countDocuments({
      severity: "critical",
      status: "detected",
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    });

    logger.info("T+1 reconciliation completed", {
      date: dateStr,
      totalDiscrepancies,
      criticalDiscrepancies: criticalCount,
    });

    return {
      saveHaven: saveHavenResult,
      monnify: monnifyResult,
      flutterwave: flutterwaveResult,
      totalDiscrepancies,
      criticalDiscrepancies: criticalCount,
    };
  }

  // Reconcile a single provider for a given date
  private async reconcileProvider(
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay",
    dateStr: string,
  ): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const dateObj = new Date(dateStr);

    logger.info(`Reconciling ${provider} for ${dateStr}`);

    //  Create reconciliation run record
    const reconciliationRun = await SettlementReconciliationRun.create({
      provider,
      date: dateObj,
      status: "partial", // Will update to completed/failed at the end
      startedAt: new Date(),
      totalProviderTransactions: 0,
      totalOurTransactions: 0,
      matched: 0,
      missingInOurDb: 0,
      missingInProvider: 0,
      amountMismatches: 0,
      discrepanciesCreated: 0,
      providerApiReachable: false,
    });

    let providerApiReachable = true;
    let errorMessage: string | undefined;

    try {
      //  Fetch provider transactions with retry
      const providerTransactions =
        await this.fetchProviderTransactionsWithRetry(provider, dateStr);

      if (providerTransactions.length === 0) {
        providerApiReachable = false;
        errorMessage = "Provider API unreachable or no transactions returned";
      }

      //  Fetch our transactions with 1-hour buffer on both sides
      // to handle transactions created near midnight that the provider
      // may list under the adjacent day
      const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
      startOfDay.setHours(startOfDay.getHours() - 1);
      const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
      endOfDay.setHours(endOfDay.getHours() + 1);

      const PAYMENT_TYPES = [
        "deposit",
        "withdrawal",
        "bank_transfer",
      ];

      const ourTransactions = await Transaction.find({
        provider,
        type: { $in: PAYMENT_TYPES },
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ["success", "failed", "reversed"] },
      }).lean();

      //  Build lookup maps
      const providerMap = new Map<string, ProviderTransaction>();
      for (const txn of providerTransactions) {
        if (txn.reference) {
          providerMap.set(txn.reference, txn);
        }
      }

      const ourMap = new Map<string, any>();
      for (const txn of ourTransactions) {
        if (txn.reference) ourMap.set(txn.reference, txn);
        if (txn.providerReference) ourMap.set(txn.providerReference, txn);
      }

      let matched = 0;
      let missingInOurDb = 0;
      let missingInProvider = 0;
      let amountMismatches = 0;
      let discrepanciesCreated = 0;

      //  Check every provider transaction against our DB
      for (const providerTxn of providerTransactions) {
        const ourTxn =
          ourMap.get(providerTxn.reference) ||
          ourMap.get(providerTxn.reference?.replace(/^(WTH|BTR|TXN|DEP)_/, ""));

        if (!ourTxn) {
          missingInOurDb++;
          const severity = this.calculateSeverity(providerTxn.amount);

          // Check if already flagged from a previous run (duplicate prevention)
          const existing = await SettlementDiscrepancy.findOne({
            provider,
            type: "missing_in_our_db",
            providerReference: providerTxn.reference,
            reconciliationDate: dateObj,
          });

          if (!existing) {
            await SettlementDiscrepancy.create({
              provider,
              reconciliationDate: dateObj,
              reconciliationRunId: reconciliationRun._id,
              type: "missing_in_our_db",
              providerReference: providerTxn.reference,
              providerAmount: providerTxn.amount,
              providerStatus: providerTxn.status,
              severity,
              status: "detected",
              meta: { providerTransaction: providerTxn },
            });

            discrepanciesCreated++;

            if (severity === "critical" || severity === "high") {
              logger.warn(
                `${severity.toUpperCase()} discrepancy detected: ${provider} - missing_in_our_db`,
                {
                  reference: providerTxn.reference,
                  amount: providerTxn.amount,
                },
              );
              // Alert admin — fire and forget so it never blocks the reconciliation loop
              this.emailService
                .sendSystemNotificationToAdmin(
                  process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
                  `${severity.toUpperCase()} Settlement Discrepancy — ${provider} (missing_in_our_db)`,
                  {
                    severity,
                    provider,
                    discrepancyType: "missing_in_our_db",
                    providerReference: providerTxn.reference,
                    providerAmount: providerTxn.amount,
                    providerStatus: providerTxn.status,
                    reconciliationDate: dateStr,
                    timestamp: new Date().toISOString(),
                  },
                  `A ${severity} discrepancy was detected during T+1 settlement reconciliation for ${provider}. ` +
                    `A transaction with reference ${providerTxn.reference} (₦${providerTxn.amount.toLocaleString()}) exists on the provider side ` +
                    `but was NOT found in our database. Immediate investigation is required.`,
                )
                .catch((alertErr) =>
                  logger.error(
                    `Failed to send discrepancy alert email for ${providerTxn.reference}:`,
                    alertErr,
                  ),
                );
            }
          }

          continue;
        }

        // Check amount mismatch — allow ₦1 tolerance for rounding
        const amountDiff = Math.abs(ourTxn.amount - providerTxn.amount);
        if (amountDiff > 1) {
          amountMismatches++;
          const severity = this.calculateSeverity(amountDiff);

          const existing = await SettlementDiscrepancy.findOne({
            provider,
            type: "amount_mismatch",
            reference: ourTxn.reference,
            reconciliationDate: dateObj,
          });

          if (!existing) {
            await SettlementDiscrepancy.create({
              provider,
              reconciliationDate: dateObj,
              reconciliationRunId: reconciliationRun._id,
              type: "amount_mismatch",
              reference: ourTxn.reference,
              providerReference: providerTxn.reference,
              ourAmount: ourTxn.amount,
              providerAmount: providerTxn.amount,
              ourStatus: ourTxn.status,
              providerStatus: providerTxn.status,
              severity,
              status: "detected",
              meta: {
                difference: amountDiff,
                ourTransaction: { id: ourTxn._id, reference: ourTxn.reference },
              },
            });

            discrepanciesCreated++;
          }

          continue;
        }

        matched++;
      }

      //  Check our success transactions not found in provider
      for (const ourTxn of ourTransactions) {
        if (ourTxn.status !== "success") continue;

        const foundInProvider =
          providerMap.has(ourTxn.reference) ||
          providerMap.has(ourTxn.providerReference || "");

        if (!foundInProvider) {
          missingInProvider++;
          const severity = this.calculateSeverity(ourTxn.amount);

          const existing = await SettlementDiscrepancy.findOne({
            provider,
            type: "missing_in_provider",
            reference: ourTxn.reference,
            reconciliationDate: dateObj,
          });

          if (!existing) {
            await SettlementDiscrepancy.create({
              provider,
              reconciliationDate: dateObj,
              reconciliationRunId: reconciliationRun._id,
              type: "missing_in_provider",
              reference: ourTxn.reference,
              ourAmount: ourTxn.amount,
              ourStatus: ourTxn.status,
              severity,
              status: "detected",
              meta: {
                ourTransaction: { id: ourTxn._id, type: ourTxn.type },
              },
            });

            discrepanciesCreated++;

            if (severity === "critical" || severity === "high") {
              logger.warn(
                `${severity.toUpperCase()} discrepancy detected: ${provider} - missing_in_provider`,
                {
                  reference: ourTxn.reference,
                  amount: ourTxn.amount,
                },
              );
              // Alert admin — fire and forget so it never blocks the reconciliation loop
              this.emailService
                .sendSystemNotificationToAdmin(
                  process.env.SUPER_ADMIN_EMAIL || "opaferanmi01@gmail.com",
                  `${severity.toUpperCase()} Settlement Discrepancy — ${provider} (missing_in_provider)`,
                  {
                    severity,
                    provider,
                    discrepancyType: "missing_in_provider",
                    reference: ourTxn.reference,
                    ourAmount: ourTxn.amount,
                    ourStatus: ourTxn.status,
                    reconciliationDate: dateStr,
                    timestamp: new Date().toISOString(),
                  },
                  `A ${severity} discrepancy was detected during T+1 settlement reconciliation for ${provider}. ` +
                    `Transaction ${ourTxn.reference} (₦${ourTxn.amount.toLocaleString()}) is recorded as SUCCESS in our database ` +
                    `but was NOT found on the provider side. This may indicate a settlement failure or data mismatch requiring urgent review.`,
                )
                .catch((alertErr) =>
                  logger.error(
                    `Failed to send discrepancy alert email for ${ourTxn.reference}:`,
                    alertErr,
                  ),
                );
            }
          }
        }
      }

      //  Update reconciliation run with final stats
      const durationMs = Date.now() - startTime;
      const status =
        providerApiReachable && providerTransactions.length > 0
          ? "completed"
          : "failed";

      await SettlementReconciliationRun.findByIdAndUpdate(
        reconciliationRun._id,
        {
          status,
          completedAt: new Date(),
          totalProviderTransactions: providerTransactions.length,
          totalOurTransactions: ourTransactions.length,
          matched,
          missingInOurDb,
          missingInProvider,
          amountMismatches,
          discrepanciesCreated,
          providerApiReachable,
          errorMessage,
          durationMs,
        },
      );

      await this.auditLoggingService.logAdminAction({
        adminId: "system",
        action: "settlement_reconciliation_completed",
        resource: "Provider",
        resourceId: provider,
        reason: `T+1 reconciliation for ${dateStr}: ${matched} matched, ${discrepanciesCreated} discrepancies`,
        status: discrepanciesCreated > 0 ? "failed" : "success",
      });

      const result: ReconciliationResult = {
        runId: reconciliationRun._id.toString(),
        provider,
        date: dateStr,
        status,
        startedAt: reconciliationRun.startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalProviderTransactions: providerTransactions.length,
        totalOurTransactions: ourTransactions.length,
        matched,
        missingInOurDb,
        missingInProvider,
        amountMismatches,
        discrepanciesCreated,
        providerApiReachable,
        durationMs,
      };

      logger.info(`${provider} reconciliation complete`, result);
      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      errorMessage = error.message;

      // Update run with failed status
      await SettlementReconciliationRun.findByIdAndUpdate(
        reconciliationRun._id,
        {
          status: "failed",
          completedAt: new Date(),
          providerApiReachable: false,
          errorMessage,
          durationMs,
        },
      );

      logger.error(`${provider} reconciliation failed`, error);

      logger.error(`CRITICAL: Reconciliation failed for ${provider}`, error);
      SentryHelper.captureBusinessError(
        "RECONCILIATION_FAILED",
        `T+1 reconciliation failed for ${provider} on ${dateStr}`,
        undefined,
        { provider, dateStr, error: error.message },
      );

      const result: ReconciliationResult = {
        runId: reconciliationRun._id.toString(),
        provider,
        date: dateStr,
        status: "failed",
        startedAt: reconciliationRun.startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalProviderTransactions: 0,
        totalOurTransactions: 0,
        matched: 0,
        missingInOurDb: 0,
        missingInProvider: 0,
        amountMismatches: 0,
        discrepanciesCreated: 0,
        providerApiReachable: false,
        durationMs,
        errorMessage,
      };

      return result;
    }
  }

  // Fetch and normalize transactions from each provider
  // Retry wrapper — if provider API is down at 2AM, retries 3 times
  // with exponential backoff before giving up for that provider
  private async fetchProviderTransactionsWithRetry(
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay",
    dateStr: string,
    maxRetries: number = 3,
  ): Promise<ProviderTransaction[]> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetchAllProviderTransactions(provider, dateStr);
      } catch (error: any) {
        lastError = error;
        logger.warn(
          `${provider} transaction fetch failed (attempt ${attempt}/${maxRetries})`,
          { error: error.message },
        );

        if (attempt < maxRetries) {
          // Exponential backoff: 5s, 10s, 20s
          const delay = 5000 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      `${provider} transaction fetch failed after ${maxRetries} attempts`,
      lastError,
    );

    logger.error(`${provider} API was unreachable for ${dateStr}`);
    SentryHelper.captureBusinessError(
      "PROVIDER_API_UNREACHABLE",
      `${provider} API unreachable after ${maxRetries} attempts during reconciliation`,
      undefined,
      { provider, dateStr, maxRetries },
    );
    return []; // Return empty — reconciliation still runs for other providers
  }

  // Fetch ALL pages from provider — handles pagination
  private async fetchAllProviderTransactions(
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay",
    dateStr: string,
  ): Promise<ProviderTransaction[]> {
    const allTransactions: ProviderTransaction[] = [];
    let page = 1;
    let hasMore = true;
    const pageSize = 100;

    while (hasMore) {
      const batch = await this.fetchProviderTransactionPage(
        provider,
        dateStr,
        page,
        pageSize,
      );

      allTransactions.push(...batch.transactions);

      // Stop if we got fewer than pageSize — means last page
      hasMore = batch.transactions.length === pageSize;
      page++;

      // Safety cap — never fetch more than 50 pages (5000 transactions)
      // If you ever hit this, something is wrong
      if (page > 50) {
        logger.warn(`${provider} pagination safety cap hit for ${dateStr}`);
        break;
      }
    }

    logger.info(
      `${provider}: fetched ${allTransactions.length} transactions for ${dateStr}`,
    );
    return allTransactions;
  }

  // Fetch a single page from provider
  private async fetchProviderTransactionPage(
    provider: "saveHaven" | "monnify" | "flutterwave" | "xixapay",
    dateStr: string,
    page: number,
    pageSize: number,
  ): Promise<{ transactions: ProviderTransaction[] }> {
    switch (provider) {
      case "saveHaven": {
        const data = await this.saveHavenService.getTransactions({
          fromDate: dateStr,
          toDate: dateStr,
          page,
          limit: pageSize,
        });

        const transactions = data?.transactions || data || [];
        return {
          transactions: transactions.map((t: any) => ({
            reference: t.paymentReference || t.reference || t._id,
            amount: Number(t.amount) || 0,
            status: t.status?.toLowerCase() || "unknown",
            type: t.type === "Inwards" ? "inbound" : "outbound",
          })),
        };
      }

      case "monnify": {
        const data = await this.monnifyService.getTransactions({
          startDate: dateStr,
          endDate: dateStr,
          page: page - 1, // Monnify is 0-indexed
          pageSize,
        });

        const transactions = data?.content || data || [];
        return {
          transactions: transactions.map((t: any) => ({
            reference:
              t.paymentReference || t.transactionReference || t.reference || "",
            amount: Number(t.settlementAmount || t.amount) || 0,
            status: t.paymentStatus?.toLowerCase() || "unknown",
            type: "inbound",
          })),
        };
      }

      case "flutterwave": {
        const data = await this.flutterwaveService.getTransactions({
          from: dateStr,
          to: dateStr,
          page,
        });

        const transactions = data || [];
        return {
          transactions: transactions.map((t: any) => ({
            reference: t.tx_ref || t.reference || t.id?.toString() || "",
            amount: Number(t.amount) || 0,
            status: t.status?.toLowerCase() || "unknown",
            type: t.type === "debit" ? "outbound" : "inbound",
          })),
        };
      }

      default:
        return { transactions: [] };
    }
  }

  private calculateSeverity(
    amount: number,
  ): "low" | "medium" | "high" | "critical" {
    if (amount > 100000) return "critical";
    if (amount > 50000) return "high";
    if (amount > 10000) return "medium";
    return "low";
  }

  // Mark discrepancy resolved — called from admin endpoint
  async markDiscrepancyResolved(
    discrepancyId: string,
    resolution: string,
    rootCause?: string,
  ): Promise<void> {
    await SettlementDiscrepancy.findByIdAndUpdate(discrepancyId, {
      status: "resolved",
      resolvedAt: new Date(),
      resolution,
      rootCause,
    });

    logger.info(`Settlement discrepancy resolved: ${discrepancyId}`);
  }

  // Get unresolved discrepancies — called from admin endpoint
  async getUnresolvedDiscrepancies(limit: number = 20) {
    return SettlementDiscrepancy.find({
      status: { $in: ["detected", "investigating"] },
    })
      .sort({ severity: -1, createdAt: -1 })
      .limit(limit);
  }
}
