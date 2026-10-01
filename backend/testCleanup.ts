import { PrismaClient } from "@prisma/client";

/**
 * Safely clean up specific test fixture records by their IDs.
 * Ensures zero orphan records and zero residual test pollution in SQLite.
 */
export async function cleanTestFixtureIds(
  prisma: PrismaClient,
  { userIds = [], roomIds = [] }: { userIds?: string[]; roomIds?: string[] }
) {
  const uIds = Array.from(new Set(userIds.filter(Boolean)));
  const rIds = Array.from(new Set(roomIds.filter(Boolean)));
  if (uIds.length === 0 && rIds.length === 0) return;

  const rooms = await prisma.room.findMany({
    where: { OR: [{ id: { in: rIds } }, { hostId: { in: uIds } }] },
    select: { id: true },
  });
  const allRoomIds = Array.from(new Set([...rIds, ...rooms.map((r) => r.id)]));

  try {
    await prisma.rating.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { reviewerId: { in: uIds } },
          { revieweeId: { in: uIds } },
        ],
      },
    });
    await prisma.roomAttendance.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { userId: { in: uIds } },
        ],
      },
    });
    await prisma.roomCheckInSession.deleteMany({
      where: {
        roomId: { in: allRoomIds },
      },
    });
    await prisma.roomParticipant.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { userId: { in: uIds } },
        ],
      },
    });
    await prisma.payment.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { userId: { in: uIds } },
        ],
      },
    });
    await prisma.joinRequest.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { joineeId: { in: uIds } },
        ],
      },
    });
    await prisma.notification.deleteMany({
      where: {
        userId: { in: uIds },
      },
    });
    await prisma.loyaltyReward.deleteMany({
      where: { userId: { in: uIds } },
    });
    await prisma.penalty.deleteMany({
      where: { userId: { in: uIds } },
    });
    await prisma.roomMessage.deleteMany({
      where: {
        OR: [
          { roomId: { in: allRoomIds } },
          { senderId: { in: uIds } },
        ],
      },
    });
    if (allRoomIds.length > 0) {
      await prisma.room.deleteMany({ where: { id: { in: allRoomIds } } });
    }
    if (uIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: uIds } } });
    }
  } catch (err) {
    console.error("Error during test cleanup:", err);
  }
}
