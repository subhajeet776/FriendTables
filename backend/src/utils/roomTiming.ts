import { prisma } from "../db.js";

export const GRACE_PERIOD_MINUTES = 30;
export const HISTORY_DAYS = 90;

export interface RoomTimeInfo {
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  closingTime: Date; // scheduledEndTime + 30 mins
  isClosed: boolean; // now >= closingTime
  isCompleted: boolean; // status === COMPLETED || isClosed
  isWithin90Days: boolean; // closingTime within last 90 days
}

export function parseTimeToMinutes(timeStr: string): number | null {
  const matched = timeStr.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
  if (!matched) return null;
  let hours = parseInt(matched[1], 10);
  const minutes = matched[2] ? parseInt(matched[2], 10) : 0;
  const ampm = matched[3] ? matched[3].toUpperCase() : null;

  if (ampm === "PM" && hours < 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

export function getRoomTimeInfo(room: {
  date?: string | null;
  time?: string | null;
  dateTime?: Date | string | null;
  publishedAt?: Date | string | null;
  createdAt?: Date | string | null;
  status?: string | null;
  attendances?: any[] | null;
}): RoomTimeInfo {
  const now = new Date();

  let start: Date | null = room.dateTime ? new Date(room.dateTime) : null;
  let end: Date | null = null;

  const baseDate = room.publishedAt
    ? new Date(room.publishedAt)
    : room.createdAt
    ? new Date(room.createdAt)
    : new Date();

  if (!start || isNaN(start.getTime())) {
    if (room.date && typeof room.date === "string") {
      const parsedDate = new Date(room.date);
      if (!isNaN(parsedDate.getTime())) {
        if (parsedDate.getFullYear() < baseDate.getFullYear()) {
          parsedDate.setFullYear(baseDate.getFullYear());
        }
        start = parsedDate;
      }
    }

    if (!start || isNaN(start.getTime())) {
      start = baseDate;
    }
  }

  // Determine end time: default 2 hours duration unless a range is given e.g. "8:00 PM - 10:00 PM"
  if (room.time && typeof room.time === "string" && (room.time.includes("–") || room.time.includes("-"))) {
    try {
      const parts = room.time.split(/–|-/);
      if (parts.length >= 2) {
        const startMins = parseTimeToMinutes(parts[0].trim());
        const endMins = parseTimeToMinutes(parts[1].trim());

        if (startMins !== null && endMins !== null) {
          let diffMins = endMins - startMins;
          if (diffMins <= 0) diffMins += 24 * 60; // Overnight range
          end = new Date(start.getTime() + diffMins * 60 * 1000);
        }
      }
    } catch {
      end = null;
    }
  }

  if (!end || isNaN(end.getTime())) {
    end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // Default 2h dinner duration
  }

  // 30-minute grace period after scheduled end time
  const closingTime = new Date(end.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);

  const isCancelled = room.status === "CANCELLED";
  const isClosed = now >= closingTime || isCancelled;
  const hasAttendance = Boolean(room.attendances && room.attendances.length > 0);
  const isCompleted = !isCancelled && (room.status === "COMPLETED" || now >= closingTime);

  const ninetyDaysAgo = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const isWithin90Days = closingTime >= ninetyDaysAgo;

  return {
    scheduledStartTime: start,
    scheduledEndTime: end,
    closingTime,
    isClosed,
    isCompleted,
    isWithin90Days,
  };
}

/**
 * Server-side automatic closing mechanism:
 * Scans active rooms (PUBLISHED, UPCOMING, CHECK_IN_OPEN) whose closing time has passed
 * and updates their status to COMPLETED.
 */
export async function autoCloseExpiredRooms(): Promise<void> {
  try {
    const activeRooms = await prisma.room.findMany({
      where: {
        status: { in: ["PUBLISHED", "UPCOMING", "CHECK_IN_OPEN"] },
      },
    });

    const now = new Date();
    for (const room of activeRooms) {
      const info = getRoomTimeInfo(room);
      if (now >= info.closingTime) {
        await prisma.room.update({
          where: { id: room.id },
          data: { status: "COMPLETED" },
        });
      }
    }

    const { processNoShowsForExpiredRooms } = await import("../services/noShowService.js");
    await processNoShowsForExpiredRooms();
  } catch (err) {
    console.error("Error in autoCloseExpiredRooms:", err);
  }
}
