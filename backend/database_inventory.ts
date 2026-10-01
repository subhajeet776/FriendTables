import { prisma } from "./src/db";

async function runInventory() {
  console.log("=== COMPREHENSIVE DATABASE INVENTORY ===");

  // 1. Model Row Counts
  const counts = {
    User: await prisma.user.count(),
    Room: await prisma.room.count(),
    RoomParticipant: await prisma.roomParticipant.count(),
    JoinRequest: await prisma.joinRequest.count(),
    Payment: await prisma.payment.count(),
    RoomAttendance: await prisma.roomAttendance.count(),
    RoomCheckInSession: await prisma.roomCheckInSession.count(),
    RoomMessage: await prisma.roomMessage.count(),
    Rating: await prisma.rating.count(),
    LoyaltyReward: await prisma.loyaltyReward.count(),
    Notification: await prisma.notification.count(),
    OtpChallenge: await prisma.otpChallenge.count(),
  };

  console.log("--- TABLE ROW COUNTS ---");
  console.log(JSON.stringify(counts, null, 2));

  // 2. All Rooms Detailed Analysis
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
    orderBy: { createdAt: "asc" },
  });

  console.log("\n--- ALL ROOMS IN DATABASE ---");
  for (const r of rooms) {
    console.log(`\nRoom ID: ${r.id}`);
    console.log(`Title: "${r.title}"`);
    console.log(`Host: ${r.host?.name} (${r.host?.phone}) [User ID: ${r.hostId}]`);
    console.log(`Status: ${r.status}`);
    console.log(`Date/Time: Date="${r.date}", Time="${r.time}", DateTime=${r.dateTime?.toISOString()}`);
    console.log(`Created At: ${r.createdAt.toISOString()}`);
    console.log(`Participants (${r.participants.length}):`, r.participants.map(p => `${p.user.name} (${p.userId})`));
    console.log(`Join Requests (${r.joinRequests.length}):`, r.joinRequests.map(jq => `${jq.joinee.name} [Status: ${jq.status}]`));
    console.log(`Payments (${r.payments.length}):`, r.payments.map(p => `${p.user.name} ₹${p.amount} [Status: ${p.status}]`));
    console.log(`Attendances (${r.attendances.length}):`, r.attendances.map(a => `${a.user.name} (${a.userId})`));
    console.log(`Messages (${r.messages.length})`);
    console.log(`CheckInSessions (${r.checkInSessions.length})`);
    console.log(`Ratings (${r.ratings.length}):`, r.ratings.map(rt => `${rt.reviewer.name} -> ${rt.reviewee.name}: ${rt.score}* "${rt.review || ""}"`));
    console.log(`Notifications (${r.notifications.length})`);
  }

  // 3. All Users Detailed Analysis
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
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("\n--- ALL USERS IN DATABASE ---");
  for (const u of users) {
    const activityCount =
      u.hostedRooms.length +
      u.joinRequests.length +
      u.roomParticipants.length +
      u.payments.length +
      u.attendances.length +
      u.givenRatings.length +
      u.receivedRatings.length;

    console.log(`User ID: ${u.id} | Name: "${u.name}" | Phone: ${u.phone} | ActiveMode: ${u.activeMode} | CreatedAt: ${u.createdAt.toISOString()} | Total Activity Rows: ${activityCount}`);
  }
}

runInventory().catch(console.error).finally(() => prisma.$disconnect());
