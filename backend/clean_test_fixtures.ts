import { prisma } from "./src/db";

async function cleanTestFixtures() {
  console.log("Cleaning up test fixture rooms and users...");

  // Target test fixture titles created by test_room_lifecycle_timing.js
  const testRoomTitles = ["Expired Past Dinner", "Timing & Grace Period Dinner"];

  const deletedRooms = await prisma.room.deleteMany({
    where: {
      title: { in: testRoomTitles },
    },
  });
  console.log(`Deleted ${deletedRooms.count} test fixture rooms.`);

  // Clean test users created by test scripts (e.g. name "Timing Host", "Joinee One", "Joinee Two")
  const testUserNames = ["Timing Host", "Joinee One", "Joinee Two"];
  const deletedUsers = await prisma.user.deleteMany({
    where: {
      name: { in: testUserNames },
    },
  });
  console.log(`Deleted ${deletedUsers.count} test fixture users.`);

  // Verify real user data remains intact
  const realHost = await prisma.user.findFirst({ where: { name: "Subhajeet " } });
  const realJoinee = await prisma.user.findFirst({ where: { name: "Pragya" } });
  const realRoom = await prisma.room.findUnique({ where: { id: "5ee05314-9763-4335-87c5-7c75873a83e5" } });

  console.log("Real Host:", realHost ? `${realHost.name} (${realHost.id})` : "NOT FOUND");
  console.log("Real Joinee:", realJoinee ? `${realJoinee.name} (${realJoinee.id})` : "NOT FOUND");
  console.log("Real Room:", realRoom ? `${realRoom.title} (${realRoom.id})` : "NOT FOUND");
}

cleanTestFixtures().catch(console.error).finally(() => prisma.$disconnect());
