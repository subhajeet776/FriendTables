import crypto from "crypto";
import { prisma } from "../db.js";
import { emitParticipantCheckedIn } from "../socket.js";
import { getRoomTimeInfo } from "../utils/roomTiming.js";

export const QR_EXPIRATION_SECONDS = 180; // 3 minutes

export async function createCheckInSession(roomId: string, hostUserId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    throw { status: 404, message: "Room not found" };
  }

  if (room.hostId !== hostUserId) {
    throw { status: 403, message: "Forbidden: Only the room host can create a check-in session" };
  }

  // Update room status to CHECK_IN_OPEN if currently PUBLISHED or UPCOMING
  if (room.status === "PUBLISHED" || room.status === "UPCOMING") {
    await prisma.room.update({
      where: { id: roomId },
      data: { status: "CHECK_IN_OPEN" },
    });
  }

  // Generate cryptographically random opaque secret token (32 hex bytes)
  const randomToken = crypto.randomBytes(32).toString("hex");

  // Hash the token using SHA-256 before storing in database
  const tokenHash = crypto.createHash("sha256").update(randomToken).digest("hex");

  const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECONDS * 1000);

  const session = await prisma.roomCheckInSession.create({
    data: {
      roomId,
      createdByUserId: hostUserId,
      tokenHash,
      expiresAt,
    },
  });

  const qrPayload = `FRIENTABLES:${roomId}:${randomToken}`;

  return {
    sessionId: session.id,
    roomId,
    qrPayload,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: QR_EXPIRATION_SECONDS,
  };
}

export async function verifyCheckInToken(roomId: string, userId: string, qrTokenInput: string) {
  if (!qrTokenInput || typeof qrTokenInput !== "string") {
    throw { status: 400, message: "QR token is required" };
  }

  // Parse payload format "FRIENTABLES:<roomId>:<randomToken>" or direct token string
  let token = qrTokenInput.trim();
  if (token.startsWith("FRIENTABLES:")) {
    const parts = token.split(":");
    if (parts.length >= 3) {
      const payloadRoomId = parts[1];
      token = parts.slice(2).join(":");
      if (payloadRoomId !== roomId) {
        throw { status: 400, message: "QR code is for a different room" };
      }
    }
  }

  // Compute SHA-256 hash of incoming token
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Find active non-expired QR session matching roomId and tokenHash
  const session = await prisma.roomCheckInSession.findFirst({
    where: {
      roomId,
      tokenHash,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    throw { status: 400, message: "Invalid or expired QR code" };
  }

  if (new Date(session.expiresAt) < new Date()) {
    throw { status: 400, message: "QR code has expired" };
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    throw { status: 404, message: "Room not found" };
  }

  const timingInfo = getRoomTimeInfo(room);
  if (timingInfo.isClosed) {
    throw { status: 400, message: "Check-in window for this dinner has closed" };
  }

  // Prevent host from scanning as a joinee attendance record
  if (room.hostId === userId) {
    throw { status: 403, message: "Host cannot check in as a participant" };
  }

  // User must be a confirmed RoomParticipant
  const participant = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
  });

  if (!participant) {
    throw { status: 403, message: "Forbidden: You are not a confirmed participant of this room" };
  }

  // Idempotency: Check if user already checked in
  const existingAttendance = await prisma.roomAttendance.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });

  if (existingAttendance) {
    return {
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendance: {
        id: existingAttendance.id,
        roomId: existingAttendance.roomId,
        userId: existingAttendance.userId,
        checkedInAt: existingAttendance.checkedInAt.toISOString(),
      },
    };
  }

  // Record attendance
  const attendance = await prisma.roomAttendance.create({
    data: {
      roomId,
      userId,
      participantId: participant.id,
      checkedInAt: new Date(),
    },
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });



  const formattedAttendance = {
    id: attendance.id,
    roomId: attendance.roomId,
    userId: attendance.userId,
    userName: attendance.user.name || "Participant",
    avatarUrl: attendance.user.avatarUrl || null,
    checkedInAt: attendance.checkedInAt.toISOString(),
  };

  // Emit live Socket.IO update to host and room listeners
  emitParticipantCheckedIn(roomId, formattedAttendance);

  return {
    message: "Check-in successful",
    alreadyCheckedIn: false,
    attendance: formattedAttendance,
  };
}

export async function getRoomAttendance(roomId: string, userId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      },
      attendances: true,
    },
  });

  if (!room) {
    throw { status: 404, message: "Room not found" };
  }

  const isHost = room.hostId === userId;

  if (isHost) {
    const attendanceMap = new Map<string, Date>();
    room.attendances.forEach((att) => {
      attendanceMap.set(att.userId, att.checkedInAt);
    });

    const participantsList = room.participants.map((p) => {
      const checkedInAt = attendanceMap.get(p.userId) || null;
      return {
        participantId: p.id,
        userId: p.userId,
        name: p.user.name || "Participant",
        avatarUrl: p.user.avatarUrl || null,
        checkedIn: Boolean(checkedInAt),
        checkedInAt: checkedInAt ? checkedInAt.toISOString() : null,
      };
    });

    return {
      isHost: true,
      roomId: room.id,
      roomStatus: room.status,
      totalConfirmed: room.participants.length,
      totalCheckedIn: room.attendances.length,
      participants: participantsList,
    };
  } else {
    // Joinee view: verify user is a confirmed participant
    const isParticipant = room.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      throw { status: 403, message: "Forbidden: You are not a confirmed participant of this room" };
    }

    const userAttendance = room.attendances.find((att) => att.userId === userId);

    return {
      isHost: false,
      roomId: room.id,
      checkedIn: Boolean(userAttendance),
      checkedInAt: userAttendance ? userAttendance.checkedInAt.toISOString() : null,
    };
  }
}

export async function openCheckInStatus(roomId: string, hostUserId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw { status: 404, message: "Room not found" };
  if (room.hostId !== hostUserId) throw { status: 403, message: "Forbidden: Only room host can change check-in status" };

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { status: "CHECK_IN_OPEN" },
  });

  return { roomId: updated.id, status: updated.status };
}

export async function closeCheckInStatus(roomId: string, hostUserId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { attendances: true },
  });
  if (!room) throw { status: 404, message: "Room not found" };
  if (room.hostId !== hostUserId) throw { status: 403, message: "Forbidden: Only room host can change check-in status" };

  const timing = getRoomTimeInfo(room);
  const newStatus = timing.isClosed ? "COMPLETED" : "PUBLISHED";

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { status: newStatus },
  });

  return { roomId: updated.id, status: updated.status };
}
