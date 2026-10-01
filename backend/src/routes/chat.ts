import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { emitRoomMessage } from "../socket.js";
import { notifyRoomMembersOfNewMessage } from "../services/notificationService.js";

export const chatRouter = Router();

/**
 * Reusable backend authorization check for Room Chat access.
 * Rules:
 * 1. Room Host -> access allowed.
 * 2. Confirmed participant (RoomParticipant record exists) -> access allowed.
 * 3. Everyone else -> access denied (403 Forbidden).
 */
export async function canAccessRoomChat(userId: string, roomId: string): Promise<boolean> {
  if (!userId || !roomId) return false;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { hostId: true },
  });

  if (!room) return false;

  // Rule 1: Host access
  if (room.hostId === userId) return true;

  // Rule 2: Confirmed participant access
  const participant = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
  });

  return !!participant;
}

const sendMessageSchema = z.object({
  text: z.string().trim().min(1, "Message text cannot be empty"),
});

/**
 * GET /api/v1/rooms/:roomId/messages
 * Authentication required.
 * Host OR confirmed participant only.
 */
chatRouter.get("/:roomId/messages", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawRoomId = req.params.roomId;
    const roomId: string = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
    const userId = req.userId!;

    const hasAccess = await canAccessRoomChat(userId, roomId);
    if (!hasAccess) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Access denied to room chat",
      });
      return;
    }

    const messages = await prisma.roomMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      roomId: msg.roomId,
      senderId: msg.senderId,
      senderName: msg.sender.name || "Anonymous",
      senderAvatar: msg.sender.avatarUrl || null,
      sender: {
        id: msg.sender.id,
        name: msg.sender.name || "Anonymous",
        avatarUrl: msg.sender.avatarUrl || null,
      },
      text: msg.text,
      createdAt: msg.createdAt.toISOString(),
    }));

    res.status(200).json({
      success: true,
      messages: formattedMessages,
      data: formattedMessages,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to fetch room messages",
    });
  }
});

/**
 * POST /api/v1/rooms/:roomId/messages
 * Authentication required.
 * Host OR confirmed participant only.
 */
chatRouter.post("/:roomId/messages", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawRoomId = req.params.roomId;
    const roomId: string = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
    const userId = req.userId!;

    const hasAccess = await canAccessRoomChat(userId, roomId);
    if (!hasAccess) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Access denied to room chat",
      });
      return;
    }

    const parseResult = sendMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid message text",
      });
      return;
    }

    const text = parseResult.data.text;

    const message = await prisma.roomMessage.create({
      data: {
        roomId,
        senderId: userId,
        text,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    const formattedMessage = {
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      senderName: message.sender.name || "Anonymous",
      senderAvatar: message.sender.avatarUrl || null,
      sender: {
        id: message.sender.id,
        name: message.sender.name || "Anonymous",
        avatarUrl: message.sender.avatarUrl || null,
      },
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    };

    // Emit real-time socket message to room channel
    emitRoomMessage(roomId, formattedMessage);

    // Notify other room members (excluding sender)
    await notifyRoomMembersOfNewMessage(roomId, userId, text);

    res.status(201).json({
      success: true,
      message: formattedMessage,
      data: formattedMessage,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "Failed to send room message",
    });
  }
});
