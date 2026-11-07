import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { PushNotificationService } from "./PushNotificationService";
import logger from "@/logger";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { emailColors } from "@/config/emailColors";
import { EmailService } from "@/services/core/EmailService";
import { SMSService } from "@/services/core/SMSService";
import { stripToPlainText } from "@/utils/sanitizeAlertBody";
import AdminServiceContainer from "@/services/admin/container";
import { Transaction } from "@/models/wallet/Transaction";

export interface CreateNotificationDTO {
  type: string;
  notifiableType: "User" | "Admin";
  notifiableId: Types.ObjectId;
  title?: string;
  message?: string;
  data?: any;
  sendEmail?: boolean;
  sendSMS?: boolean;
  sendPush?: boolean;
  skipInApp?: boolean;
}

interface NotificationContent {
  title: string;
  message: string;
}

export class NotificationService {
  constructor(
    private emailService: EmailService,
    private smsService: SMSService,
    private pushNotificationService: PushNotificationService,
    private notificationRepository: NotificationRepository,
    private userRepository: UserRepository,
    private adminRepository: AdminRepository,
  ) { }

  private generateNotificationContent(
    type: string,
    data: any,
    dtoTitle?: string,
    dtoMessage?: string
  ): NotificationContent {
    let title = `${process.env.APP_NAME} Notification`;
    let message = "";

    switch (type) {
      // GENERAL TRANSACTION NOTIFICATIONS
      case "transaction_success":
        title = "Purchase Successful";
        message = `Your ${data.service_name || data.transactionType || "service"} purchase of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} was successful. Reference: ${data.transaction_reference || data.reference}`;
        break;

      case "transaction_failed":
        title = "Transaction Failed";
        message = `We couldn't complete your ${data.service_name || data.transactionType || "service"} purchase of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()}. Reference: ${data.transaction_reference || data.reference}`;
        break;

      case "transaction_pending":
        title = "Transaction Pending";
        message = `Your ${data.transactionType
          } transaction of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} is pending. Reference: ${data.reference
          }`;
        break;

      case "transaction_processing":
        title = "Transaction Processing";
        message = `Your ${data.transactionType
          } transaction of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} is processing. Reference: ${data.reference
          }`;
        break;

      // PAYMENT NOTIFICATIONS
      case "payment_success":
        title = "Payment Successful";
        message = `Your ${data.transactionType
          } payment of ₦${data.amount?.toLocaleString()} was successful. New balance: ₦${data.balance?.toLocaleString()}.`;
        break;

      case "payment_reversed":
        title = "Payment Reversed";
        message = `Your ${data.transactionType
          } payment of ₦${data.amount?.toLocaleString()} via ${data.provider
          } has been reversed. ${data.reason ? `Reason: ${data.reason}. ` : ""
          }Reference: ${data.reference}`;
        break;

      case "payment_failed":
        title = "Payment Failed";
        message = `Your ${data.transactionType
          } payment of ₦${data.amount?.toLocaleString()} via ${data.provider
          } failed. ${data.reason ? `Reason: ${data.reason}. ` : ""}Reference: ${data.reference
          }`;
        break;

      // WALLET NOTIFICATIONS
      case "wallet_credit":
        title = "Successful Wallet Top Up";
        if (data.isAdmin || data.sender_name === process.env.APP_NAME || data.sender_name === "admin") {
          message = `Your wallet has been credited with ₦${data.amount?.toLocaleString()} by ${process.env.APP_NAME}. Reference: ${data.transaction_id || data.reference}`;
        } else {
          message = `Your wallet has been credited with ₦${data.amount?.toLocaleString()} by ${data.sender_name || 'a user'}. Reference: ${data.transaction_id || data.reference}`;
        }
        break;

      case "wallet_funding_failed":
        title = "Wallet Top Up Failed";
        message = `We couldn't complete your wallet top up of ₦${data.amount?.toLocaleString()}. Reference: ${data.transaction_id || data.reference}`;
        break;

      case "withdrawal_success":
      case "wallet_debit": // Fallback for previous generic debits if needed, though they don't map perfectly to withdrawal.
        if (type === "withdrawal_success" || data.transactionType === "withdrawal") {
          title = "Withdrawal Successful";
          message = `Your withdrawal of ₦${data.amount?.toLocaleString()} to ${data.account_name || 'your account'} was successful. Reference: ${data.transaction_id || data.reference}`;
        } else {
          title = "Wallet Debited";
          message = `Your wallet has been debited with ₦${data.amount?.toLocaleString()}. New balance: ₦${data.balance?.toLocaleString()}`;
        }
        break;

      case "withdrawal_failed":
        title = "Withdrawal Failed";
        message = `We couldn't process your withdrawal of ₦${data.amount?.toLocaleString()} to ${data.account_name || 'your account'}. Reference: ${data.transaction_id || data.reference}`;
        break;

      case "deposit":
        title = "Deposit Received";
        message = `You have received a deposit of ₦${data.amount?.toLocaleString()}. ${data.description ? `Description: ${data.description}. ` : ""
          }New balance: ₦${data.balance?.toLocaleString()}`;
        break;


      case "admin_notification":
        title = data?.title || "Admin Notification";
        message = data?.message;
        break;


      // WITHDRAWAL NOTIFICATIONS
      case "withdrawal_approved":
        title = dtoTitle || "Withdrawal Approved";
        message = dtoMessage || `Your withdrawal of ₦${data.amount?.toLocaleString()} has been approved and is being processed. Reference: ${data.reference
          }`;
        break;

      case "withdrawal_declined":
        title = dtoTitle || "Withdrawal Declined";
        message = dtoMessage || `Your withdrawal of ₦${data.amount?.toLocaleString()} was declined and refunded to your wallet. Reason: ${data.reason
          }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "withdrawal_completed":
        title = dtoTitle || "Withdrawal Completed";
        message = dtoMessage || `Your withdrawal of ₦${data.amount?.toLocaleString()} has been completed successfully. Reference: ${data.reference
          }`;
        break;

      case "withdrawal_failed":
        title = dtoTitle || "Withdrawal Failed";
        message = dtoMessage || `Your withdrawal of ₦${data.amount?.toLocaleString()} failed. ${data.refunded ? "The amount has been refunded to your wallet." : ""
          } Reason: ${data.failureReason || data.reason || "Unknown error"
          }. Reference: ${data.reference}`;
        break;

      case "withdrawal_reversed":
        title = dtoTitle || "Withdrawal Reversed";
        message = dtoMessage || `Your withdrawal of ₦${data.amount?.toLocaleString()} has been reversed by the payment provider. ${data.refunded ? "The amount has been refunded to your wallet." : ""
          } Reference: ${data.reference}`;
        break;

      case "withdrawal_initiated":
        title = dtoTitle || "Withdrawal Initiated";
        message = dtoMessage || `Your withdrawal request of ₦${data.amount?.toLocaleString()} has been initiated. ${data.bankName ? `Bank: ${data.bankName}. ` : ""
          }${data.accountNumber ? `Account: ...${data.accountNumber.slice(-4)}. ` : ""}Reference: ${data.reference}`;
        break;

      case "deposit_request_approved":
        title = "Deposit Request Approved";
        message = `Your deposit request of ₦${data.amount?.toLocaleString()} has been approved. Reference: ${data.reference
          }`;
        break;

      case "deposit_request_rejected":
        title = "Deposit Request Rejected";
        message = `Your deposit request of ₦${data.amount?.toLocaleString()} has been rejected. Reason: ${data.reason
          }. Reference: ${data.reference}`;
        break;

      // TRANSFER NOTIFICATIONS
      case "transfer_sent":
        title = "Transfer Sent";
        message = `You have sent ₦${data.amount?.toLocaleString()} to ${data.recipientName
          }. Reference: ${data.reference
          }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "transfer_received":
        title = "Transfer Received";
        message = `You have received ₦${data.amount?.toLocaleString()} from ${data.senderName
          }. Reference: ${data.reference
          }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      // KYC & VERIFICATION NOTIFICATIONS
      case "kyc_approved":
        title = "KYC Approved";
        message = `Your identity has been verified successfully. You can now enjoy higher transaction limits and access all ${process.env.APP_NAME} services.`;
        break;

      case "kyc_rejected":
        title = "KYC Verification Failed";
        message = `We couldn't verify your identity. Please review the reason provided and submit your KYC again.`;
        break;

      case "bvn_verified":
        title = "BVN Verified";
        message = `Your BVN has been successfully verified. Enhanced security enabled on your account.`;
        break;

      // ALERT NOTIFICATIONS
      case "alert":
        title = data?.title || "Important Alert";
        message = data?.message || "You have an important notification";
        break;

      case "announcement":
        title = data?.title || "Announcement";
        message = data?.message || "You have a new announcement";
        break;

      case "provider_health_alert":
        title = "⚠️ Service Provider Alert";
        message = `${data.provider || "A service provider"
          } is experiencing issues. ${data.status ? `Status: ${data.status}. ` : ""
          }${data.message || "We're working to resolve this."}`;
        break;

      case "transaction_failed":
        title = dtoTitle || data?.title || "Transaction Failed";
        message =
          dtoMessage ||
          data?.message ||
          `Your ${data.transactionType || "bill payment"} of ₦${data.amount?.toLocaleString()} failed. ${data.failureReason || data.reason
            ? `${data.failureReason || data.reason} `
            : ""
          }Your wallet has been refunded. Reference: ${data.reference}`;
        break;

      // DEFAULT FALLBACK
      default:
        title = dtoTitle || data?.title || " Notification";
        message = dtoMessage || data?.message || "You have a new notification";
    }

    return { title, message };
  }

  private static readonly TRANSIENT_NOTIFICATION_TYPES = new Set([
    // Wallet
    "wallet_debit",
    "wallet_credit",
    "refund",
    // Alerts
    "alert",
    // Transactions
    "transaction_success",
    "transaction_failed",
    "transaction_pending",
    "transaction_processing",
    // Payments
    "payment_success",
    "payment_reversed",
    "payment_failed",
    // Withdrawals
    "withdrawal_approved",
    "withdrawal_declined",
    "withdrawal_completed",
    "withdrawal_failed",
    "withdrawal_reversed",
    "withdrawal_initiated",
    // Transfers
    "transfer_sent",
    // Deposits
    "deposit",
  ]);

  async createNotification(
    dto: CreateNotificationDTO,
  ): Promise<any> {
    // Generate title and message
    const { title, message } = this.generateNotificationContent(
      dto.type,
      dto.data,
      dto.title,
      dto.message
    );

    let notification;
    if (dto.skipInApp || NotificationService.TRANSIENT_NOTIFICATION_TYPES.has(dto.type)) {
      notification = {
        type: dto.type,
        notifiableType: dto.notifiableType,
        notifiableId: dto.notifiableId,
        title,
        message,
        data: dto.data,
      };
    } else {
      notification = await this.notificationRepository.create({
        type: dto.type,
        notifiableType: dto.notifiableType,
        notifiableId: dto.notifiableId,
        title,
        message,
        data: dto.data,
      });

      if (dto.notifiableType === "User") {
        await this.notificationRepository.cleanupOldNotifications(dto.notifiableId, 50);
      }
    }

    const criticalEmailTypes = new Set([
      "wallet_credit",
      "wallet_funding_failed",
      "withdrawal_success",
      "withdrawal_failed",
      "kyc_approved",
      "kyc_rejected",
      // NOTE: payment_success and payment_failed are intentionally excluded —
      // these are transient in-app / push-only events and must never email users.
    ]);

    let shouldSendEmail = dto.sendEmail ?? criticalEmailTypes.has(dto.type);

    // Hard-block: these types must NEVER send emails to users regardless of
    // what any caller passes as sendEmail. This is the single source of truth.
    const NEVER_EMAIL_USER_TYPES = new Set([
      "transaction_success",
      "transaction_successful",
      "transaction_failed",
      "transaction_reversed",
      "transaction_pending",
      "transaction_processing",
      "payment_success",
      "payment_failed",
    ]);
    if (dto.notifiableType === "User" && NEVER_EMAIL_USER_TYPES.has(dto.type)) {
      shouldSendEmail = false;
    }

    // Send email if requested
    if (shouldSendEmail && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user && user.email) {
          if (dto.type === "wallet_credit") {
            await this.emailService.sendWalletFundedEmail(
              user.email,
              user.firstname,
              dto.data.amount || 0,
              dto.data.balance || 0,
              new Date().toLocaleString(),
              dto.data.transaction_id || dto.data.reference || "N/A"
            );
          } else if (dto.type === "withdrawal_success") {
            await this.emailService.sendWalletWithdrawalEmail(
              user.email,
              user.firstname,
              dto.data.amount || 0,
              dto.data.bank_name || 'N/A',
              dto.data.account_number || 'N/A',
              dto.data.account_name || 'N/A',
              new Date().toLocaleString(),
              dto.data.transaction_id || dto.data.reference || "N/A"
            );
          } else if (dto.type === "kyc_approved") {
            await this.emailService.sendKycApprovedEmail(user.email, user.firstname);
          } else if (dto.type === "kyc_rejected") {
            await this.emailService.sendKycRejectedEmail(user.email, user.firstname, dto.data.reason || 'Verification failed');
          } else {
            // Alerts compose their own message (with or without a "Hi {name},"
            // prefix, per Alert.isPersonalised) — don't double it up here.
            const greeting =
              dto.type === "alert" ? undefined : `Hello ${user.firstname},`;
            const isRichHtml =
              dto.type === "alert" || dto.type === "announcement";
            await this.sendNotificationEmail(
              user.email,
              title,
              message,
              greeting,
              isRichHtml,
            );
          }
        }
      } catch (error) {
        logger.error("Error sending notification email:", error);
      }
    }

    // Send SMS if requested
    if (dto.sendSMS && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user && user.phone && user.phoneCode) {
          await this.sendNotificationSMS(
            `${user.phoneCode}${user.phone}`,
            message,
          );
        }
      } catch (error) {
        logger.error("Error sending notification SMS:", error);
      }
    }

    // Send Push Notification if requested
    if (dto.sendPush && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user) {
          await this.sendPushNotification(
            dto.notifiableId.toString(),
            title,
            message,
            dto.type,
            dto.data,
          );
        }
      } catch (error) {
        logger.error("Error sending push notification:", error);
      }
    }

    // Use new admin notification logic
    if (dto.sendEmail && dto.notifiableType === "Admin") {
      await this.sendAdminNotificationEmails(
        title,
        message,
      );
    }

    // Global Hook: Automatically notify super admins whenever a user gets a "failed" notification
    const failedTypes = new Set([
      "transaction_failed",
      "payment_failed",
      "withdrawal_failed",
      "withdrawal_declined"
    ]);

    if (failedTypes.has(dto.type) && dto.notifiableType === "User") {
      const ref = dto.data?.reference || dto.data?.transaction_reference || dto.data?.transaction_id;
      if (ref) {
        // Run asynchronously to avoid blocking the user notification flow
        Transaction.findOne({ reference: ref })
          .then((txn) => {
            if (txn) {
              this.notifySuperAdminsOfFailure({
                transaction: txn,
                reason: dto.data?.reason || dto.data?.error || "Transaction failed"
              });
            }
          })
          .catch((err) => {
            logger.error(`Error fetching transaction ${ref} for admin failure notification`, err);
          });
      }
    }

    return notification;
  }

  async bulkCreateNotifications(
    notifiableIds: Types.ObjectId[],
    notifiableType: "User" | "Admin",
    type: string,
    data: any,
    chunkSize: number = 1000,
  ): Promise<void> {
    if (notifiableIds.length === 0) return;

    const { title, message } = this.generateNotificationContent(type, data);

    for (let i = 0; i < notifiableIds.length; i += chunkSize) {
      const chunk = notifiableIds
        .slice(i, i + chunkSize)
        .map((notifiableId) => ({
          type,
          notifiableType,
          notifiableId,
          title,
          message,
          data,
        }));

      await this.notificationRepository.bulkInsert(chunk);
    }
  }

  // Like bulkCreateNotifications, but for cases where every recipient needs
  // distinct title/message text (e.g. a personalised in-app alert) instead
  // of one shared payload reused for every row.
  async bulkCreatePersonalisedNotifications(
    entries: Array<{
      notifiableId: Types.ObjectId;
      title: string;
      message: string;
    }>,
    notifiableType: "User" | "Admin",
    type: string,
    chunkSize: number = 1000,
  ): Promise<void> {
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize).map((entry) => ({
        type,
        notifiableType,
        notifiableId: entry.notifiableId,
        title: entry.title,
        message: entry.message,
        data: { title: entry.title, message: entry.message },
      }));

      await this.notificationRepository.bulkInsert(chunk);
    }
  }

  private async sendNotificationEmail(
    to: string,
    subject: string,
    message: string,
    greeting?: string,
    isPreformattedHtml: boolean = false,
  ): Promise<void> {
    const emailBannerService = AdminServiceContainer.getEmailBannerService();
    const { logoUrl, headerBannerUrl, footerBannerUrl } = await emailBannerService.getEmailBanners();

    const logoHtml = logoUrl
      ? `<div class="logo-section"><img src="${logoUrl}" alt="Logo"></div>`
      : "";

    let headerHtml = `
          <div class="header">
            <h1>${subject}</h1>
          </div>
    `;

    if (headerBannerUrl) {
      headerHtml = `
          <!--[if !mso]><!-->
          <div style="position:relative;">
            <img src="${headerBannerUrl}" style="width:100%; height:auto; display:block;" alt="">
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; width:100%;">
              <h1 style="margin: 0; padding: 0; font-size: 24px; color: white;">${subject}</h1>
            </div>
          </div>
          <!--<![endif]-->
          <!--[if mso]>
          <div>
            <img src="${headerBannerUrl}" style="width:100%; height:auto; display:block;" alt="">
            <div style="text-align: center; padding: 20px 0;">
              <h1 style="margin: 0; padding: 0; font-size: 24px; color: #${emailColors.primary};">${subject}</h1>
            </div>
          </div>
          <![endif]-->
      `;
    }

    let footerHtml = `
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
            ${footerBannerUrl ? `<img src="${footerBannerUrl}" style="width:100%; height:auto; display:block; margin-top:12px;" alt="">` : ""}
          </div>
    `;

    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .logo-section { text-align: center; margin-bottom: 20px; }
          .logo-section img { height: 50px; width: auto; display: block; margin: 0 auto; }
          .header { background-color: #${emailColors.primary}; color: white; padding: 30px 20px; text-align: center; }
          .header h1 { margin: 0; padding: 0; font-size: 24px; }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          ${logoHtml}
          
${headerHtml}
          
          <div class="content">
            ${greeting ? `<p>${greeting}</p>` : ""}
            ${isPreformattedHtml ? message : `<p>${message}</p>`}
          </div>
          
${footerHtml}
        </div>
      </body>
    </html>
  `;

    if (this.isTestEnvironment()) {
      return;
    }

    const plainMessage = isPreformattedHtml
      ? stripToPlainText(message)
      : message;
    const text = greeting ? `${greeting} ${plainMessage}` : plainMessage;
    await this.emailService.sendEmail({ to, subject, html, text });
  }

  private isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.JEST_WORKER_ID !== undefined
    );
  }

  private async sendNotificationSMS(
    to: string,
    message: string,
  ): Promise<void> {
    // Prefix with ${process.env.APP_NAME} and keep it concise for SMS
    const smsMessage = `${process.env.APP_NAME}: ${message}`;
    await this.smsService.sendSMS({ to, message: smsMessage });
  }

  private async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    type: string,
    data: any,
  ): Promise<void> {
    await this.pushNotificationService.sendToUser(userId, {
      title,
      body,
      data: {
        type,
        ...data,
      },
    });
  }

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<any> {
    const { data, total } =
      await this.notificationRepository.findByNotifiableId(userId, page, limit);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async getUnreadNotifications(userId: string): Promise<any> {
    const notifications =
      await this.notificationRepository.findUnreadByNotifiableId(userId);
    return notifications;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await this.notificationRepository.countUnread(userId);
  }

  async markAsRead(notificationId: string): Promise<any> {
    const notification =
      await this.notificationRepository.markAsRead(notificationId);
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.markAllAsRead(userId);
  }

  async getNotificationById(notificationId: string): Promise<any> {
    const notification =
      await this.notificationRepository.findById(notificationId);
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async markAsUnread(notificationId: string): Promise<any> {
    const notification = await this.notificationRepository.update(
      notificationId,
      { read: false, readAt: null },
    );
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await this.notificationRepository.softDelete(notificationId);
  }

  async clearAllNotifications(userId: string): Promise<void> {
    await this.notificationRepository.deleteManyNotifications(userId);
  }

  private async sendAdminNotificationEmails(
    title: string,
    message: string,
  ): Promise<void> {
    try {
      let adminEmails: string[] = [];

      // Generic notification - send to super admin only
      const superAdminEmail = await this.adminRepository.getSuperAdminEmail();
      if (superAdminEmail) {
        adminEmails = [superAdminEmail];
      }

      // Send email to all admins
      if (adminEmails.length > 0) {
        const emailPromises = adminEmails.map((email) =>
          this.sendNotificationEmail(
            email,
            title,
            message,
            "Hello Admin,",
          ).catch((err) => {
            logger.error(`Failed to send admin notification to ${email}:`, err);
          }),
        );

        await Promise.all(emailPromises);
      } else {
        logger.warn(
          `No admin emails found for notification: ${title}`,
        );
      }
    } catch (error) {
      logger.error("Error sending admin notification emails:", error);
    }
  }

  // NOTIFY SUPER ADMINS OF TRANSACTION REVERSALS
  async notifySuperAdminsOfReversal(params: {
    transaction: any;
    reason: string;
    providerResponse?: any;
    reversalReference?: string;
    reversedByAdminName?: string;
    source?: "admin" | "webhook" | "reconciliation" | "system";
  }): Promise<void> {
    try {
      // 1. Find all active super admins
      const superAdmins = await this.adminRepository.findActiveAdmins({
        adminLevel: "super_admin",
      });

      if (!superAdmins || superAdmins.length === 0) {
        logger.warn("notifySuperAdminsOfReversal: No active super admins found");
        return;
      }

      // 2. Resolve customer info
      let customerName = "Customer";
      let customerEmail = "";
      const userId = params.transaction.userId || params.transaction.sourceId;
      if (userId) {
        try {
          const user = await this.userRepository.findById(userId.toString());
          if (user) {
            customerName =
              `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
              user.username ||
              "Customer";
            customerEmail = user.email || "";
          }
        } catch (err) {
          logger.warn(
            "notifySuperAdminsOfReversal: Could not fetch user details",
            err,
          );
        }
      }

      // Format provider response if passed or stored in transaction.meta
      const providerResponse =
        params.providerResponse ||
        params.transaction.meta?.providerResponse ||
        params.transaction.meta?.error ||
        params.transaction.meta?.responseMessage;

      const triggerSource = params.reversedByAdminName
        ? `Admin (${params.reversedByAdminName})`
        : params.source === "webhook"
          ? `Provider Webhook (${params.transaction.provider || "Provider"})`
          : params.source === "reconciliation"
            ? "Reconciliation Engine"
            : "System";

      const formattedAmount = (params.transaction.amount || 0).toLocaleString();

      for (const admin of superAdmins) {
        // A. Store in-app notification for admin
        this.notificationRepository
          .create({
            type: "admin_transaction_reversed",
            notifiableType: "Admin",
            notifiableId: admin._id,
            title: "🚨 Transaction Reversed Alert",
            message: `Transaction ${params.transaction.reference} (₦${formattedAmount}) was reversed. Reason: ${params.reason || "Reversed"}`,
            data: {
              reference: params.transaction.reference,
              reversalReference: params.reversalReference,
              amount: params.transaction.amount,
              type: params.transaction.type,
              provider: params.transaction.provider,
              reason: params.reason,
              providerResponse,
              source: params.source,
            },
          })
          .catch((err) =>
            logger.error(
              "Failed to create admin in-app reversal notification",
              err,
            ),
          );

        // B. Send email alert to super admin
        if (admin.email) {
          this.emailService
            .sendAdminTransactionReversedAlert({
              to: admin.email,
              adminName: admin.firstName || admin.fullName || "Super Admin",
              transactionReference: params.transaction.reference,
              reversalReference: params.reversalReference,
              amount: params.transaction.amount,
              transactionType: params.transaction.type || "Service Transaction",
              customerName,
              customerEmail,
              provider: params.transaction.provider || "N/A",
              reversalReason: params.reason,
              providerResponse,
              reversedBy: triggerSource,
              reversedAt: new Date(),
            })
            .catch((err) =>
              logger.error(
                `Failed to send reversal email to super admin ${admin.email}:`,
                err,
              ),
            );
        }
      }

      logger.info(
        `notifySuperAdminsOfReversal: Dispatched reversal alerts to ${superAdmins.length} super admin(s) for transaction ${params.transaction.reference}`,
      );
    } catch (error) {
      logger.error("Error in notifySuperAdminsOfReversal:", error);
    }
  }

  // NOTIFY SUPER ADMINS OF TRANSACTION FAILURES
  async notifySuperAdminsOfFailure(params: {
    transaction: any;
    reason?: string;
  }): Promise<void> {
    try {
      // 1. Find all active super admins
      const superAdmins = await this.adminRepository.findActiveAdmins({
        adminLevel: "super_admin",
      });

      if (!superAdmins || superAdmins.length === 0) {
        logger.warn("notifySuperAdminsOfFailure: No active super admins found");
        return;
      }

      // 2. Resolve customer info
      let customerName = "Customer";
      let customerEmail = "";
      const userId = params.transaction.userId || params.transaction.sourceId;
      if (userId) {
        try {
          const user = await this.userRepository.findById(userId.toString());
          if (user) {
            customerName =
              `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
              user.username ||
              "Customer";
            customerEmail = user.email || "";
          }
        } catch (err) {
          logger.warn(
            "notifySuperAdminsOfFailure: Could not fetch user details",
            err,
          );
        }
      }

      // Format provider response if passed or stored in transaction.meta
      const providerResponse =
        params.transaction.meta?.providerResponse ||
        params.transaction.meta?.error ||
        params.transaction.meta?.responseMessage ||
        params.transaction.meta;

      const formattedAmount = (params.transaction.amount || 0).toLocaleString();
      const failureReason = params.reason || params.transaction.reason || "Transaction failed";

      for (const admin of superAdmins) {
        // A. Store in-app notification for admin
        this.notificationRepository
          .create({
            type: "admin_transaction_failed",
            notifiableType: "Admin",
            notifiableId: admin._id,
            title: "❌ Transaction Failed Alert",
            message: `Transaction ${params.transaction.reference} (₦${formattedAmount}) failed. Reason: ${failureReason}`,
            data: {
              reference: params.transaction.reference,
              amount: params.transaction.amount,
              type: params.transaction.type,
              provider: params.transaction.provider,
              reason: failureReason,
              providerResponse,
            },
          })
          .catch((err) =>
            logger.error(
              "Failed to create admin in-app failure notification",
              err,
            ),
          );

        // B. Send email alert to super admin
        if (admin.email) {
          this.emailService
            .sendAdminTransactionFailedAlert({
              to: admin.email,
              adminName: admin.firstName || admin.fullName || "Super Admin",
              transactionReference: params.transaction.reference,
              amount: params.transaction.amount,
              transactionType: params.transaction.type || "Service Transaction",
              customerName,
              customerEmail,
              provider: params.transaction.provider || "N/A",
              failureReason,
              providerResponse,
              failedAt: new Date(),
            })
            .catch((err) =>
              logger.error(
                `Failed to send failure email to super admin ${admin.email}:`,
                err,
              ),
            );
        }
      }

      logger.info(
        `notifySuperAdminsOfFailure: Dispatched failure alerts to ${superAdmins.length} super admin(s) for transaction ${params.transaction.reference}`,
      );
    } catch (error) {
      logger.error("Error in notifySuperAdminsOfFailure:", error);
    }
  }
}
