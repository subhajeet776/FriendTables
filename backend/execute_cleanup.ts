import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GENUINE_USER_IDS = [
  "b799b475-afa1-4e67-b43f-fdd25de1b62d", // Subhajeet (+916033970835)
  "e1386d78-c286-4207-88e3-d591604b82a5", // Pragya (+916203984168)
];

const GENUINE_ROOM_IDS = [
  "5bae6b5a-af1b-42b4-a617-ad1d97e1d9a2", // Chutpaglus
  "ae075547-d221-4655-919e-a64475f8e7e3", // Bhurchatte
  "fdea1e76-e311-4058-a5f3-9d322065e15b", // Mind-Bending Movies & Italian Pizza
];

async function main() {
  console.log("🧹 Running targeted database cleanup of automated test fixtures...");

  // Find all test users (users NOT in GENUINE_USER_IDS)
  const testUsers = await prisma.user.findMany({
    where: {
      id: { notIn: GENUINE_USER_IDS },
    },
    select: { id: true },
  });
  const testUserIds = testUsers.map((u) => u.id);

  // Find all test rooms (rooms NOT in GENUINE_ROOM_IDS)
  const testRooms = await prisma.room.findMany({
    where: {
      id: { notIn: GENUINE_ROOM_IDS },
    },
    select: { id: true },
  });
  const testRoomIds = testRooms.map((r) => r.id);

  console.log(`Found ${testRoomIds.length} test rooms and ${testUserIds.length} test users to delete.`);

  // Delete associated records for test rooms/users
  const deletedRatings = await prisma.rating.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { reviewerId: { in: testUserIds } },
        { revieweeId: { in: testUserIds } },
      ],
    },
  });

  const deletedAttendances = await prisma.roomAttendance.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { userId: { in: testUserIds } },
      ],
    },
  });

  const deletedCheckIns = await prisma.roomCheckInSession.deleteMany({
    where: {
      roomId: { in: testRoomIds },
    },
  });

  const deletedParticipants = await prisma.roomParticipant.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { userId: { in: testUserIds } },
      ],
    },
  });

  const deletedPayments = await prisma.payment.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { userId: { in: testUserIds } },
      ],
    },
  });

  const deletedJoinRequests = await prisma.joinRequest.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { joineeId: { in: testUserIds } },
      ],
    },
  });

  const deletedNotifications = await prisma.notification.deleteMany({
    where: {
      userId: { in: testUserIds },
    },
  });

  const deletedRewards = await prisma.loyaltyReward.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  const deletedPenalties = await prisma.penalty.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  const deletedMessages = await prisma.roomMessage.deleteMany({
    where: {
      OR: [
        { roomId: { in: testRoomIds } },
        { senderId: { in: testUserIds } },
      ],
    },
  });

  const deletedRooms = await prisma.room.deleteMany({
    where: { id: { in: testRoomIds } },
  });

  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { in: testUserIds } },
  });

  console.log(`✅ CLEANUP COMPLETED SUCCESSFULLY:
- Removed Test Rooms: ${deletedRooms.count}
- Removed Test Users: ${deletedUsers.count}
- Removed Test Payments: ${deletedPayments.count}
- Removed Test Participants: ${deletedParticipants.count}
- Removed Test Join Requests: ${deletedJoinRequests.count}
- Removed Test Attendances: ${deletedAttendances.count}
- Removed Test Ratings: ${deletedRatings.count}
  `);

  // Verify remaining database state
  const remainingUsers = await prisma.user.findMany({ select: { id: true, name: true, phone: true } });
  const remainingRooms = await prisma.room.findMany({ select: { id: true, title: true, status: true } });

  console.log("=== REMAINING DATABASE STATE ===");
  console.log(`Remaining Users (${remainingUsers.length}):`, remainingUsers);
  console.log(`Remaining Rooms (${remainingRooms.length}):`, remainingRooms);
}

main()
  .catch((e) => {
    console.error("Cleanup error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
