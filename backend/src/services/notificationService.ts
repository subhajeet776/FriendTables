import { prisma } from "../db.js";
import { emitUserNotification } from "../socket.js";

export interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  message: string;
  roomId?: string;
  relatedUserId?: string;
  relatedRequestId?: string;
  relatedPaymentId?: string;
}

export function formatNotification(notification: any) {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    roomId: notification.roomId || undefined,
    relatedUserId: notification.relatedUserId || undefined,
    relatedRequestId: notification.relatedRequestId || undefined,
    relatedPaymentId: notification.relatedPaymentId || undefined,
    isUnread: notification.readAt === null,
    readAt: notification.readAt ? (notification.readAt instanceof Date ? notification.readAt.toISOString() : new Date(notification.readAt).toISOString()) : null,
    createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : new Date(notification.createdAt).toISOString(),
    updatedAt: notification.updatedAt instanceof Date ? notification.updatedAt.toISOString() : new Date(notification.updatedAt).toISOString(),
  };
}

export async function createNotification(params: CreateNotificationParams) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        roomId: params.roomId || null,
        relatedUserId: params.relatedUserId || null,
        relatedRequestId: params.relatedRequestId || null,
        relatedPaymentId: params.relatedPaymentId || null,
      },
    });

    const formatted = formatNotification(notification);

    // Emit real-time socket event to user's private channel
    emitUserNotification(params.userId, formatted);

    return formatted;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
}

/**
 * Notify all authorized room members (Host + Confirmed Participants) EXCEPT sender of a new message.
 */
export async function notifyRoomMembersOfNewMessage(roomId: string, senderId: string, text: string) {
  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        participants: true,
      },
    });

    if (!room) return;

    const senderUser = await prisma.user.findUnique({
      where: { id: senderId },
      select: { name: true },
    });

    const senderName = senderUser?.name || "Group Member";

    // Collect recipient user IDs (Host + Confirmed Participants) excluding sender
    const recipientIds = new Set<string>();
    if (room.hostId !== senderId) {
      recipientIds.add(room.hostId);
    }
    for (const p of room.participants) {
      if (p.userId !== senderId) {
        recipientIds.add(p.userId);
      }
    }

    for (const recipientId of recipientIds) {
      await createNotification({
        userId: recipientId,
        type: "NEW_ROOM_MESSAGE",
        title: `New Message from ${senderName}`,
        message: `"${text}"`,
        roomId,
        relatedUserId: senderId,
      });
    }
  } catch (error) {
    console.error("Error notifying room members of message:", error);
  }
}
