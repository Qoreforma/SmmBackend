import { Router } from "express";
import { NotificationController } from "@/controllers/client/NotificationController";
import { authenticate } from "@/middlewares/client/auth";
import { validateQuery } from "@/middlewares/shared/validation";
import { paginationSchema } from "@/validations/client/transactionValidation";

const router = Router();

const notificationController = new NotificationController();

// Routes (all protected)
router.use(authenticate);
router.get(
  "/",
  validateQuery(paginationSchema),
  notificationController.getUserNotifications
);
router.get("/unread", notificationController.getUnreadNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.get("/:id", notificationController.getNotificationById);
router.put("/:id/read", notificationController.markAsRead);
router.put("/:id/unread", notificationController.markAsUnread);
router.put("/mark-all-read", notificationController.markAllAsRead);
router.delete("/clear-all", notificationController.clearAllNotifications);
router.delete("/:id", notificationController.deleteNotification);

export default router;
