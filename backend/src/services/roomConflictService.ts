import { prisma as defaultPrisma } from "../db.js";
import { getRoomTimeInfo } from "../utils/roomTiming.js";

export interface ConflictCheckResult {
  hasConflict: boolean;
  message?: string;
  role?: "HOST" | "JOINEE";
  conflictingRoomId?: string;
}

/**
 * Checks whether a given user has any active dining commitment (as Host or confirmed Joinee)
 * that overlaps with candidate start and end times.
 *
 * Overlap rule: existingStart < candidateEnd && existingEnd > candidateStart
 *
 * Excludes:
 * - CANCELLED rooms
 * - The room specified by excludeRoomId (used when updating an existing room)
 * - Accepted-but-unpaid join requests (only confirmed RoomParticipant entries count for Joinee state)
 */
export async function checkUserRoomConflict(
  prismaClient: any,
  userId: string,
  candidateStart: Date,
  candidateEnd: Date,
  excludeRoomId?: string
): Promise<ConflictCheckResult> {
  const db = prismaClient || defaultPrisma;

  // 1. Check existing Host rooms for this user
  const hostRooms = await db.room.findMany({
    where: {
      hostId: userId,
      status: { not: "CANCELLED" },
      ...(excludeRoomId ? { id: { not: excludeRoomId } } : {}),
    },
  });

  for (const room of hostRooms) {
    const timing = getRoomTimeInfo(room);
    const existingStart = timing.scheduledStartTime;
    const existingEnd = timing.scheduledEndTime;

    if (existingStart < candidateEnd && existingEnd > candidateStart) {
      return {
        hasConflict: true,
        message: "You already have another dining experience scheduled during this time.",
        role: "HOST",
        conflictingRoomId: room.id,
      };
    }
  }

  // 2. Check existing confirmed Joinee rooms for this user
  const participants = await db.roomParticipant.findMany({
    where: {
      userId: userId,
    },
    include: {
      room: true,
    },
  });

  for (const participant of participants) {
    if (!participant.room || participant.room.status === "CANCELLED") {
      continue;
    }
    if (excludeRoomId && participant.room.id === excludeRoomId) {
      continue;
    }

    const timing = getRoomTimeInfo(participant.room);
    const existingStart = timing.scheduledStartTime;
    const existingEnd = timing.scheduledEndTime;

    if (existingStart < candidateEnd && existingEnd > candidateStart) {
      return {
        hasConflict: true,
        message: "You already have another dining experience scheduled during this time.",
        role: "JOINEE",
        conflictingRoomId: participant.room.id,
      };
    }
  }

  return { hasConflict: false };
}
