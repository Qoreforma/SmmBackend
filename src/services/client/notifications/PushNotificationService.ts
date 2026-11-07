import admin from "firebase-admin";
import { UserRepository } from "@/repositories/client/UserRepository";
import logger from "@/logger";
import { IUser } from "@/models/core/User";

// Payload structure for push notifications

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}


// Response structure for tracking notification results

export interface NotificationResult {
  userId: string;
  successCount: number;
  failureCount: number;
  removedTokens: number;
}


// Production-grade Firebase Cloud Messaging service
// Handles sending push notifications to users, topics, and batch operations
export class PushNotificationService {
  private readonly maxBatchSize = 500; 

  constructor(private userRepository: UserRepository) {}

  // Send push notification to a specific user (all their devices)
    async sendToUser(
    userId: string,
    payload: PushNotificationPayload,
  ): Promise<NotificationResult> {
    const result: NotificationResult = {
      userId,
      successCount: 0,
      failureCount: 0,
      removedTokens: 0,
    };

    try {
      const user = await this.userRepository.findById(userId);

      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        logger.info(`No FCM tokens found for user: ${userId}`);
        return result;
      }

      const sendResult = await this.sendToTokensForUser(user, payload);
      return { ...result, ...sendResult };
    } catch (error) {
      logger.error(`Error sending push notification to user ${userId}:`, error);
      result.failureCount = 1;
      return result;
    }
  }

  // Send to multiple users efficiently (batch DB fetch + parallel sends)
  
  async sendToMultipleUsers(
    userIds: string[],
    payload: PushNotificationPayload,
  ): Promise<NotificationResult[]> {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    try {
      // Batch fetch all users at once (more efficient than individual queries)
      const users = await this.userRepository.findByIds(userIds);

      if (!users || users.length === 0) {
        logger.warn(`No users found for IDs: ${userIds.join(", ")}`);
        return [];
      }

      // Send in parallel to all users
      const promises = users.map((user) =>
        this.sendToTokensForUser(user, payload)
          .then((result) => ({ userId: user.id, ...result }))
          .catch((error) => {
            logger.error(
              `Error sending to user ${user.id}:`,
              error instanceof Error ? error.message : error,
            );
            return {
              userId: user.id,
              successCount: 0,
              failureCount: user.fcmTokens?.length || 1,
              removedTokens: 0,
            };
          }),
      );

      const results = await Promise.all(promises);
      return results;
    } catch (error) {
      logger.error("Error in sendToMultipleUsers:", error);
      return userIds.map((userId) => ({
        userId,
        successCount: 0,
        failureCount: 1,
        removedTokens: 0,
      }));
    }
  }

  // Send broadcast notification to all users subscribed to a topic
  
  async sendToTopic(
    topic: string,
    payload: PushNotificationPayload,
  ): Promise<string> {
    try {
      const message = this.buildMessage(
        { topic },
        payload,
      ) as admin.messaging.Message;

      const response = await admin.messaging().send(message);
      logger.info(
        `Successfully sent message to topic "${topic}". Message ID: ${response}`,
      );
      return response;
    } catch (error) {
      logger.error(
        `Error sending push notification to topic "${topic}":`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  // Subscribe a user to a topic
  async subscribeToTopic(userId: string, topic: string): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);

      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        logger.warn(`No FCM tokens found for user ${userId}`);
        return;
      }

      // Subscribe only the latest token to the topic
      await admin.messaging().subscribeToTopic(user.fcmTokens.slice(-1), topic);
      logger.info(`User ${userId} subscribed to topic: ${topic}`);
    } catch (error) {
      logger.error(
        `Error subscribing user ${userId} to topic ${topic}:`,
        error,
      );
      throw error;
    }
  }

  // Unsubscribe a user from a topic
  async unsubscribeFromTopic(userId: string, topic: string): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);

      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        logger.warn(`No FCM tokens found for user ${userId}`);
        return;
      }

      await admin.messaging().unsubscribeFromTopic(user.fcmTokens.slice(-1), topic);
      logger.info(`User ${userId} unsubscribed from topic: ${topic}`);
    } catch (error) {
      logger.error(
        `Error unsubscribing user ${userId} from topic ${topic}:`,
        error,
      );
      throw error;
    }
  }

  // Internal: Send to tokens for a specific user (single DB lookup)
  private async sendToTokensForUser(
    user: IUser,
    payload: PushNotificationPayload,
  ): Promise<Omit<NotificationResult, "userId">> {
    const result = {
      successCount: 0,
      failureCount: 0,
      removedTokens: 0,
    };

    const tokens = user.fcmTokens ? user.fcmTokens.slice(-1) : [];
    if (!tokens || tokens.length === 0) {
      return result;
    }

    try {
      // Split into batches if needed (Firebase has limits)
      const batches = this.chunkArray(tokens, this.maxBatchSize);

      for (const batch of batches) {
        const message = this.buildMessage(
          { tokens: batch },
          payload,
        ) as admin.messaging.MulticastMessage;

        const response = await admin.messaging().sendEachForMulticast(message);

        result.successCount += response.successCount;
        result.failureCount += response.failureCount;

        // Handle invalid tokens
        if (response.failureCount > 0) {
          const invalidTokens = this.extractInvalidTokens(
            response.responses,
            batch,
          );

          if (invalidTokens.length > 0) {
            // Update user's token list
            user.fcmTokens = user.fcmTokens.filter(
              (token) => !invalidTokens.includes(token),
            );

            // Single save operation after all batches are processed
            if (batches.indexOf(batch) === batches.length - 1) {
              await this.userRepository.update(user.id.toString(), {
                $pull: { fcmTokens: { $in: invalidTokens } } as any,
              });
              result.removedTokens = invalidTokens.length;
              logger.info(
                `Removed ${invalidTokens.length} invalid FCM tokens for user ${user.id}`,
              );
            }
          }
        }
      }

      logger.info(
        `Push notification sent to user ${user.id}: ${result.successCount}/${tokens.length} successful`,
      );
    } catch (error) {
      logger.error(
        `Error sending push notifications to user ${user.id}:`,
        error instanceof Error ? error.message : error,
      );
      result.failureCount = tokens.length;
    }

    return result;
  }

  // Build message object with common configuration
  private buildMessage(
    target: { tokens?: string[]; topic?: string },
    payload: PushNotificationPayload,
  ): admin.messaging.Message | admin.messaging.MulticastMessage {
    const baseMessage = {
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
      },
      data: this.convertDataToStrings(payload.data || {}),
      android: {
        priority: "high" as const,
        notification: {
          sound: "default",
          channelId: `${process.env.APP_NAME || "app"}_notifications`,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            "mutable-content": 1,
          },
        },
      },
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.imageUrl,
        },
      },
    };

    if (target.tokens) {
      return {
        ...baseMessage,
        tokens: target.tokens,
      } as admin.messaging.MulticastMessage;
    } else {
      return {
        ...baseMessage,
        topic: target.topic,
      } as admin.messaging.Message;
    }
  }

  // Extract invalid token indices from Firebase response
  private extractInvalidTokens(
    responses: admin.messaging.SendResponse[],
    tokens: string[],
  ): string[] {
    const invalidTokens: string[] = [];

    responses.forEach((response, idx) => {
      if (!response.success && response.error) {
        const errorCode = response.error.code;

        // These error codes mean the token is no longer valid
        const invalidErrorCodes = [
          "messaging/invalid-registration-token",
          "messaging/registration-token-not-registered",
          "messaging/mismatched-credential",
          "messaging/unknown-error", // Sometimes returned for permanently invalid tokens
        ];

        if (invalidErrorCodes.includes(errorCode)) {
          invalidTokens.push(tokens[idx]);
          logger.warn(
            `Invalid FCM token (${errorCode}): ${tokens[idx].substring(0, 20)}...`,
          );
        }
      }
    });

    return invalidTokens;
  }

  // Utility: Split array into chunks
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Health check: Verify Firebase Messaging is working
  async healthCheck(): Promise<boolean> {
    try {
      // This will throw if Firebase is not properly initialized
      const messaging = admin.messaging();
      logger.info("Firebase Messaging health check passed");
      return true;
    } catch (error) {
      logger.error("Firebase Messaging health check failed:", error);
      return false;
    }
  }

  private convertDataToStrings(data: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(data)) {
    result[key] = value === null || value === undefined ? "" : String(value);
  }
  
  return result;
}
}
