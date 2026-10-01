import { prisma } from "../db.js";
import { getRoomTimeInfo } from "../utils/roomTiming.js";
import { createNotification } from "./notificationService.js";

/**
 * Checks and processes no-show penalties for all closed rooms.
 * Idempotently applies -0.25 penalty (type: "JOINEE_NO_SHOW") to confirmed/paid joinees
 * who failed to check in before the room closed.
 */
export async function processNoShowsForExpiredRooms(): Promise<void> {
  try {
    const rooms = await prisma.room.findMany({
      where: {
        status: { not: "CANCELLED" },
      },
      include: {
        attendances: true,
        joinRequests: {
          where: {
            status: { in: ["ACCEPTED", "CONFIRMED"] },
          },
          include: {
            payments: true,
          },
        },
      },
    });

    const now = new Date();

    for (const room of rooms) {
      const timing = getRoomTimeInfo(room);
      if (!timing.isClosed) {
        // Room is not closed yet (scheduled end + 30 min grace period has not passed)
        continue;
      }

      const attendedUserIds = new Set(room.attendances.map((a) => a.userId));

      for (const req of room.joinRequests) {
        const joineeId = req.joineeId;

        // Check if joinee paid successfully
        const hasSuccessfulPayment = req.payments.some((p) => p.status === "SUCCESS");
        if (!hasSuccessfulPayment) {
          // Unpaid / pending / rejected users do not get no-show penalty
          continue;
        }

        // Check if joinee checked in
        if (attendedUserIds.has(joineeId)) {
          // Successfully checked in -> no penalty
          continue;
        }

        // Idempotently apply penalty
        const existingPenalty = await prisma.penalty.findUnique({
          where: {
            userId_roomId_type: {
              userId: joineeId,
              roomId: room.id,
              type: "JOINEE_NO_SHOW",
            },
          },
        });

        if (!existingPenalty) {
          await prisma.penalty.create({
            data: {
              userId: joineeId,
              roomId: room.id,
              type: "JOINEE_NO_SHOW",
              deduction: 0.25,
              reason: "No-show for confirmed dinner room",
            },
          });

          // Create notification for Joinee
          await createNotification({
            userId: joineeId,
            type: "JOINEE_NO_SHOW_PENALTY",
            title: "No-Show Penalty",
            message: `You were marked as a no-show for "${room.title}". Reputation reduced by 0.25.`,
            roomId: room.id,
          });
        }
      }
    }
  } catch (err) {
    console.error("Error in processNoShowsForExpiredRooms:", err);
  }
}
