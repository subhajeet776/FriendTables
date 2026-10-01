import { prisma } from "./src/db";

async function analyzeAll() {
  console.log("=== COMPREHENSIVE CLASSIFICATION ANALYSIS ===");

  const rooms = await prisma.room.findMany({
    include: {
      host: true,
      participants: { include: { user: true } },
      joinRequests: { include: { joinee: true } },
      payments: { include: { user: true } },
      attendances: { include: { user: true } },
      messages: { include: { sender: true } },
      checkInSessions: true,
      ratings: { include: { reviewer: true, reviewee: true } },
      notifications: true,
    },
  });

  console.log(`\nTOTAL ROOMS: ${rooms.length}`);
  for (const r of rooms) {
    console.log(`Room [${r.id}] "${r.title}" | Host: ${r.host?.name} (${r.host?.phone}) | CreatedAt: ${r.createdAt.toISOString()}`);
  }

  const users = await prisma.user.findMany({
    include: {
      hostedRooms: true,
      joinRequests: true,
      roomParticipants: true,
      payments: true,
      attendances: true,
      givenRatings: true,
      receivedRatings: true,
      loyaltyRewards: true,
      notifications: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nTOTAL USERS: ${users.length}`);

  const realUsers: typeof users = [];
  const testUsers: typeof users = [];

  for (const u of users) {
    const hasActivity =
      u.hostedRooms.length > 0 ||
      u.joinRequests.length > 0 ||
      u.roomParticipants.length > 0 ||
      u.payments.length > 0 ||
      u.attendances.length > 0 ||
      u.givenRatings.length > 0 ||
      u.receivedRatings.length > 0;

    const isSubhajeet = u.phone === "+916033970835" || u.name?.trim() === "Subhajeet";
    const isPragya = u.phone === "+916203984168" || u.name?.trim() === "Pragya";

    if (isSubhajeet || isPragya) {
      realUsers.push(u);
    } else {
      testUsers.push(u);
    }
  }

  console.log("\n--- REAL USERS ---");
  for (const u of realUsers) {
    console.log(`Real User [${u.id}] Name: "${u.name}" | Phone: ${u.phone} | ActiveMode: ${u.activeMode}`);
    console.log(`  Hosted Rooms: ${u.hostedRooms.length}`);
    console.log(`  Join Requests: ${u.joinRequests.length}`);
    console.log(`  Participants: ${u.roomParticipants.length}`);
    console.log(`  Payments: ${u.payments.length}`);
    console.log(`  Attendances: ${u.attendances.length}`);
    console.log(`  Given Ratings: ${u.givenRatings.length}`);
    console.log(`  Received Ratings: ${u.receivedRatings.length}`);
  }

  console.log(`\n--- TEST USERS COUNT: ${testUsers.length} ---`);

  // Count related records for test users vs real users
  const realUserIds = new Set(realUsers.map(u => u.id));
  const realRoomIds = new Set(rooms.filter(r => realUserIds.has(r.hostId)).map(r => r.id));

  const totalNotifications = await prisma.notification.count();
  const realNotifications = await prisma.notification.count({
    where: {
      OR: [
        { userId: { in: Array.from(realUserIds) } },
        { relatedUserId: { in: Array.from(realUserIds) } },
        { roomId: { in: Array.from(realRoomIds) } },
      ],
    },
  });

  const totalOtp = await prisma.otpChallenge.count();
  const realOtp = await prisma.otpChallenge.count({
    where: {
      target: { in: realUsers.map(u => u.phone!).filter(Boolean) },
    },
  });

  console.log({
    totalNotifications,
    realNotifications,
    testNotifications: totalNotifications - realNotifications,
    totalOtp,
    realOtp,
    testOtp: totalOtp - realOtp,
  });
}

analyzeAll().catch(console.error).finally(() => prisma.$disconnect());
