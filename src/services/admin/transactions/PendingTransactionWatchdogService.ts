import logger from "@/logger";
import { Transaction } from "@/models/wallet/Transaction";
import { Notification } from "@/models/core/Notification";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { EmailService } from "@/services/core/EmailService";
import ServiceContainer from "@/services/client/container";

export interface WatchdogResult {
  checkedCount: number;
  alertedCount: number;
  skippedCooldownCount: number;
  alertedReferences: string[];
}

export class PendingTransactionWatchdogService {
  private readonly THIRTY_MINUTES_MS = 30 * 60 * 1000;
  private readonly SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3-hour cooldown before repeating alert

  constructor(
    private transactionRepository: TransactionRepository = ServiceContainer.getTransactionRepository(),
    private adminRepository: AdminRepository = ServiceContainer.getAdminRepository(),
    private emailService: EmailService = ServiceContainer.getEmailService(),
  ) {}

  /**
   * Scans all transactions stuck in pending/processing for 30+ minutes or whose
   * background polling has halted, and alerts super admins via email and in-app notifications.
   */
  async checkAndAlertPendingTransactions(): Promise<WatchdogResult> {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - this.THIRTY_MINUTES_MS);
    const sevenDaysAgo = new Date(now.getTime() - this.SEVEN_DAYS_MS);

    const result: WatchdogResult = {
      checkedCount: 0,
      alertedCount: 0,
      skippedCooldownCount: 0,
      alertedReferences: [],
    };

    try {
      // Find all transactions still in "pending" or "processing" that are older than 30 minutes
      const pendingTransactions = await Transaction.find({
        status: { $in: ["pending", "processing"] },
        createdAt: {
          $lte: thirtyMinutesAgo,
          $gte: sevenDaysAgo,
        },
      })
        .populate("sourceId", "firstname lastname email phone")
        .sort({ createdAt: 1 })
        .exec();

      result.checkedCount = pendingTransactions.length;

      if (pendingTransactions.length === 0) {
        logger.debug("[Watchdog] No pending transactions >= 30m found");
        return result;
      }

      logger.info(
        `[Watchdog] Found ${pendingTransactions.length} transactions pending for >= 30 mins`,
      );

      for (const transaction of pendingTransactions) {
        const lastAlertSentAt = transaction.meta?.adminPendingAlertSentAt
          ? new Date(transaction.meta.adminPendingAlertSentAt).getTime()
          : 0;

        // Anti-spam check: skip if an alert was already sent within the cooldown period
        if (lastAlertSentAt && now.getTime() - lastAlertSentAt < this.COOLDOWN_MS) {
          result.skippedCooldownCount++;
          continue;
        }

        await this.dispatchAdminAlert(transaction, now);
        result.alertedCount++;
        result.alertedReferences.push(transaction.reference);
      }

      if (result.alertedCount > 0) {
        logger.warn(
          `[Watchdog] Dispatched alerts for ${result.alertedCount} stuck transactions: ${result.alertedReferences.join(", ")}`,
        );
      }

      return result;
    } catch (error: any) {
      logger.error("[Watchdog] Error in checkAndAlertPendingTransactions:", error);
      throw error;
    }
  }

  /**
   * Dispatches both email and in-app alerts for a stuck transaction,
   * and updates transaction metadata to prevent duplicate alerts.
   */
  private async dispatchAdminAlert(transaction: any, alertTime: Date): Promise<void> {
    const ageMs = alertTime.getTime() - new Date(transaction.createdAt).getTime();
    const ageMinutes = Math.floor(ageMs / (60 * 1000));
    const ageHours = Math.floor(ageMinutes / 60);
    const ageDisplay =
      ageHours > 0 ? `${ageHours}h ${ageMinutes % 60}m` : `${ageMinutes} minutes`;

    const provider =
      transaction.provider ||
      transaction.polling?.pollingProvider ||
      transaction.meta?.providerResponse?.providerCode ||
      transaction.meta?.providerCode ||
      transaction.meta?.provider ||
      "unknown";

    const isPollingStopped = !!transaction.polling?.stoppedAt;
    const stopReason = transaction.polling?.stopReason || (isPollingStopped ? "timeout" : "in_progress");
    const pollCount = transaction.polling?.pollCount || 0;

    const customerDetail =
      transaction.meta?.meterNumber
        ? `Meter: ${transaction.meta.meterNumber} (${transaction.meta.meterType || "prepaid"})`
        : transaction.meta?.phone
          ? `Phone: ${transaction.meta.phone}`
          : transaction.meta?.smartCardNumber
            ? `SmartCard: ${transaction.meta.smartCardNumber}`
            : transaction.meta?.customerId
              ? `Customer ID: ${transaction.meta.customerId}`
              : "N/A";

    const userObj = transaction.sourceId;
    const userName = userObj
      ? `${userObj.firstname || ""} ${userObj.lastname || ""}`.trim()
      : "Unknown";
    const userEmail = userObj?.email || "N/A";
    const userPhone = userObj?.phone || "N/A";

    // 1. Resolve Super Admin emails
    const superAdmins = await this.adminRepository.getAllSuperAdmins();
    const adminEmails = new Set<string>();

    for (const a of superAdmins) {
      if (a.email) adminEmails.add(a.email.toLowerCase().trim());
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

    // Default fallback if no admin email exists
    if (adminEmails.size === 0) {
      adminEmails.add("opaferanmi01@gmail.com");
    }

    const emailSubject = `⚠️ STUCK TRANSACTION: ${transaction.reference} (${transaction.type?.toUpperCase()} - ₦${transaction.amount?.toLocaleString()})`;

    const emailMetadata = {
      severity: "critical",
      Reference: transaction.reference,
      Status: transaction.status,
      Amount: `₦${Number(transaction.amount || 0).toLocaleString()}`,
      "Service Type": transaction.type || "N/A",
      Provider: provider,
      "Customer Info": customerDetail,
      "Time Pending": ageDisplay,
      "Polling Status": isPollingStopped
        ? `Halted (${stopReason}) after ${pollCount} poll(s)`
        : `Active (${pollCount} poll(s) so far)`,
      "User Details": `${userName} | ${userEmail} | ${userPhone}`,
      Created: new Date(transaction.createdAt).toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
      }),
      "Required Action": "Open Admin Dashboard -> Requery Provider or refund user",
    };

    const emailMessage = `A transaction on Paymint has been in '${transaction.status}' status for ${ageDisplay}.${
      isPollingStopped
        ? `\nBackground polling has STOPPED (reason: ${stopReason}).`
        : "\nBackground polling is still active but exceeding normal processing duration."
    }\n\nPlease inspect the transaction in the Admin Portal and click 'Requery Provider' or manually resolve it.`;

    // 2. Send Emails to Super Admins
    const emailPromises = Array.from(adminEmails).map((toEmail) =>
      this.emailService
        .sendSystemNotificationToAdmin(
          toEmail,
          emailSubject,
          emailMetadata,
          emailMessage,
        )
        .catch((err) =>
          logger.error(
            `[Watchdog] Failed to send stuck transaction alert email to ${toEmail}:`,
            err,
          ),
        ),
    );

    // 3. Create In-App Notifications for all Active Super Admins
    const notificationPromises = superAdmins.map((admin) =>
      Notification.create({
        type: "stuck_transaction_alert",
        notifiableType: "Admin",
        notifiableId: admin._id,
        title: `⚠️ Stuck Transaction: ${transaction.reference}`,
        message: `Transaction ${transaction.reference} (₦${Number(transaction.amount || 0).toLocaleString()}) for ${transaction.type} (${provider}) has been pending for ${ageDisplay}.${isPollingStopped ? " Polling has stopped." : ""}`,
        data: {
          transactionId: transaction._id.toString(),
          reference: transaction.reference,
          provider,
          type: transaction.type,
          amount: transaction.amount,
          ageMinutes,
          isPollingStopped,
          stopReason,
        },
        read: false,
      }).catch((err) =>
        logger.error(
          `[Watchdog] Failed to create in-app notification for admin ${admin._id}:`,
          err,
        ),
      ),
    );

    await Promise.allSettled([...emailPromises, ...notificationPromises]);

    // 4. Update transaction metadata to prevent spamming
    await this.transactionRepository.update(transaction._id.toString(), {
      "meta.adminPendingAlertSentAt": alertTime,
      "meta.adminPendingAlertCount":
        (Number(transaction.meta?.adminPendingAlertCount) || 0) + 1,
      "meta.adminPendingAlertLastAge": ageDisplay,
    });
  }
}
