import logger from "@/logger";
import ServiceContainer from "@/services/client/container";

/**
 * Notifies all active super admins of a system action or event.
 * @param title The subject/title of the email.
 * @param metadata Additional data to include in the email body.
 * @param message The detailed message.
 */
export const notifyAdminsOfSystemAction = async (
  title: string,
  metadata: any,
  message: string,
): Promise<void> => {
  try {
    const adminRepository = ServiceContainer.getAdminRepository();
    const adminEmails = await adminRepository.getAllSuperAdminEmails();

    if (!adminEmails || adminEmails.length === 0) {
      logger.warn("No super admin emails found for system notification.");
      return;
    }

    const emailService = ServiceContainer.getEmailService();

    const emailPromises = adminEmails.map((adminEmail) =>
      emailService.sendSystemNotificationToAdmin(
        adminEmail,
        title,
        metadata,
        message,
      ),
    );

    await Promise.allSettled(emailPromises);
  } catch (err) {
    logger.error("Failed to notify admins of system action:", err);
  }
};
