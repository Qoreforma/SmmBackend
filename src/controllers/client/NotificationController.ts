import { Response, NextFunction } from "express";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthRequest } from "@/middlewares/client/auth";
import ServiceContainer from "@/services/client/container";

export class NotificationController {
  private notificationService: NotificationService;
  constructor() {
    this.notificationService = ServiceContainer.getNotificationService();
  }

  getUserNotifications = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await this.notificationService.getUserNotifications(
        userId,
        page,
        limit
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Notifications retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getUnreadNotifications = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const notifications =
        await this.notificationService.getUnreadNotifications(userId);
      return sendSuccessResponse(
        res,
        notifications,
        "Unread notifications retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  getUnreadCount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      const count = await this.notificationService.getUnreadCount(userId);
      return sendSuccessResponse(
        res,
        { count },
        "Unread count retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  markAsRead = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const notification = await this.notificationService.markAsRead(id);
      return sendSuccessResponse(
        res,
        notification,
        "Notification marked as read"
      );
    } catch (error) {
      next(error);
    }
  };

  markAllAsRead = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      await this.notificationService.markAllAsRead(userId);
      return sendSuccessResponse(res, null, "All notifications marked as read");
    } catch (error) {
      next(error);
    }
  };

  getNotificationById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const notification = await this.notificationService.getNotificationById(
        id
      );
      return sendSuccessResponse(
        res,
        notification,
        "Notification retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  markAsUnread = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const notification = await this.notificationService.markAsUnread(id);
      return sendSuccessResponse(
        res,
        notification,
        "Notification marked as unread"
      );
    } catch (error) {
      next(error);
    }
  };

  deleteNotification = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      await this.notificationService.deleteNotification(id);
      return sendSuccessResponse(
        res,
        null,
        "Notification deleted successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  clearAllNotifications = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;
      await this.notificationService.clearAllNotifications(userId);
      return sendSuccessResponse(
        res,
        null,
        "All notifications cleared successfully"
      );
    } catch (error) {
      next(error);
    }
  };
}
