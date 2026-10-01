import { Router, Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { formatNotification } from "../services/notificationService.js";

export const notificationRouter = Router();

/**
 * GET /api/v1/notifications
 * Fetch notifications for authenticated user, ordered by createdAt DESC.
 */
notificationRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const formatted = notifications.map(formatNotification);

    res.status(200).json({
      success: true,
      notifications: formatted,
      data: formatted,
    });
  } catch (error: any) {
    console.error("Error in GET /notifications:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to fetch notifications",
    });
  }
});

/**
 * GET /api/v1/notifications/unread-count
 * Count unread notifications (readAt = null) for authenticated user.
 */
notificationRouter.get("/unread-count", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const count = await prisma.notification.count({
      where: {
        userId,
        readAt: null,
      },
    });

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error: any) {
    console.error("Error in GET /notifications/unread-count:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to count unread notifications",
    });
  }
});

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a single notification as read for authenticated user.
 */
notificationRouter.patch("/:id/read", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id: string = Array.isArray(rawId) ? rawId[0] : rawId;
    const userId = req.userId!;

    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Notification not found",
      });
      return;
    }

    if (existing.userId !== userId) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "You can only mark your own notifications as read",
      });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt || new Date() },
    });

    const formatted = formatNotification(updated);

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification: formatted,
      data: formatted,
    });
  } catch (error: any) {
    console.error("Error in PATCH /notifications/:id/read:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to mark notification as read",
    });
  }
});

/**
 * POST /api/v1/notifications/mark-all-read
 * Mark all unread notifications as read for authenticated user.
 */
notificationRouter.post("/mark-all-read", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      count: 0,
    });
  } catch (error: any) {
    console.error("Error in POST /notifications/mark-all-read:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to mark all notifications as read",
    });
  }
});
