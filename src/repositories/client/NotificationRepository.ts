import { BaseRepository } from "../BaseRepository";
import { Notification, INotification } from "@/models/core/Notification";
import { Types } from "mongoose";

export class NotificationRepository extends BaseRepository<INotification> {
  constructor() {
    super(Notification);
  }

  async findByNotifiableId(
    notifiableId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10
  ) {
    return this.findWithPagination(
      { notifiableId, notifiableType: "User", type: { $ne: "announcement" } },
      page,
      limit
    );
  }

  async findUnreadByNotifiableId(
    notifiableId: string | Types.ObjectId
  ): Promise<INotification[]> {
    return this.model
      .find({ notifiableId, notifiableType: "User", read: false, type: { $ne: "announcement" } })
      .sort({ createdAt: -1 })
      .exec();
  }

  async markAsRead(notificationId: string): Promise<INotification | null> {
    return this.model
      .findByIdAndUpdate(
        notificationId,
        { readAt: new Date(), read: true },
        { new: true }
      )
      .exec();
  }

  async markAllAsRead(notifiableId: string | Types.ObjectId): Promise<void> {
    await this.model
      .updateMany(
        { notifiableId, read: false },
        { readAt: new Date(), read: true }
      )
      .exec();
  }

  async countUnread(notifiableId: string | Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ notifiableId, read: false, type: { $ne: "announcement" } }).exec();
  }

  async deleteManyNotifications(notifiableId: string | Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ notifiableId }).exec();
  }

    async bulkInsert(notifications: Partial<INotification>[]): Promise<void> {
    if (notifications.length === 0) return;
    await this.model.insertMany(notifications, { ordered: false });
  }

  async cleanupOldNotifications(notifiableId: string | Types.ObjectId, maxLimit: number = 50): Promise<void> {
    try {
      const docs = await this.model
        .find({ notifiableId, notifiableType: "User" })
        .sort({ createdAt: -1 })
        .skip(maxLimit - 1)
        .limit(1)
        .select('createdAt')
        .exec();

      if (docs.length > 0) {
        await this.model.deleteMany({
          notifiableId,
          notifiableType: "User",
          createdAt: { $lt: docs[0].createdAt }
        }).exec();
      }
    } catch (error) {
      // Ignore errors so we don't break main flow
    }
  }
}
