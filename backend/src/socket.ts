import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken, JwtPayload } from "./utils/jwt.js";
import { prisma } from "./db.js";
import { canAccessRoomChat } from "./routes/chat.js";
import { notifyRoomMembersOfNewMessage } from "./services/notificationService.js";

let io: Server | null = null;

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Socket Authentication Middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
        (socket.handshake.query?.token as string);

      if (!token) {
        return next(new Error("Unauthorized: Token missing"));
      }

      const decoded: JwtPayload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        return next(new Error("Unauthorized: User not found"));
      }

      socket.data.userId = user.id;
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("Unauthorized: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 Socket connected: ${socket.id} (User: ${userId})`);

    // Automatically join private user channel for personal notifications
    if (userId) {
      socket.join(`user:${userId}`);
    }

    // Join room channel
    socket.on("join_room", async (data: { roomId: string }, callback?: Function) => {
      try {
        const { roomId } = data || {};
        if (!roomId) {
          if (callback) callback({ success: false, message: "Room ID is required" });
          return;
        }

        const allowed = await canAccessRoomChat(userId, roomId);
        if (!allowed) {
          if (callback) callback({ success: false, message: "Forbidden: Access denied to room chat" });
          socket.emit("error", { message: "Forbidden: Access denied to room chat" });
          return;
        }

        const channelName = `room:${roomId}`;
        socket.join(channelName);
        console.log(`👤 User ${userId} joined socket channel ${channelName}`);

        if (callback) callback({ success: true, room: roomId });
      } catch (err: any) {
        if (callback) callback({ success: false, message: err.message });
      }
    });

    // Leave room channel
    socket.on("leave_room", (data: { roomId: string }) => {
      if (data?.roomId) {
        socket.leave(`room:${data.roomId}`);
      }
    });

    // Optional direct socket event to send message
    socket.on("send_message", async (data: { roomId: string; text: string }, callback?: Function) => {
      try {
        const { roomId, text } = data || {};
        if (!roomId || !text || !text.trim()) {
          if (callback) callback({ success: false, message: "Invalid payload" });
          return;
        }

        const allowed = await canAccessRoomChat(userId, roomId);
        if (!allowed) {
          if (callback) callback({ success: false, message: "Forbidden: Access denied" });
          return;
        }

        const message = await prisma.roomMessage.create({
          data: {
            roomId,
            senderId: userId,
            text: text.trim(),
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

        const formatted = {
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

        io?.to(`room:${roomId}`).emit("new_message", formatted);
        io?.to(`room:${roomId}`).emit("message:received", formatted);

        // Create in-app notification for other room members
        await notifyRoomMembersOfNewMessage(roomId, userId, text.trim());

        if (callback) callback({ success: true, message: formatted });
      } catch (err: any) {
        if (callback) callback({ success: false, message: err.message });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

export function emitRoomMessage(roomId: string, message: any) {
  if (io) {
    io.to(`room:${roomId}`).emit("new_message", message);
    io.to(`room:${roomId}`).emit("message:received", message);
  }
}

export function emitUserNotification(userId: string, notification: any) {
  if (io) {
    io.to(`user:${userId}`).emit("new_notification", notification);
    io.to(`user:${userId}`).emit("notification:received", notification);
  }
}

export function emitParticipantCheckedIn(roomId: string, attendance: any) {
  if (io) {
    io.to(`room:${roomId}`).emit("participant_checked_in", attendance);
  }
}
