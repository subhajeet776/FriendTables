import pkgDb from "./dist/db.js";
const { prisma } = pkgDb;

async function resetDevActivity() {
  console.log("\n==================================================");
  console.log("🧹 FRIENTABLES DEV ACTIVITY CLEANUP");
  console.log("==================================================\n");

  // 1. Fetch & Print Current Counts
  const beforeUserCount = await prisma.user.count();
  const beforeRoomCount = await prisma.room.count();
  const beforeParticipantCount = await prisma.roomParticipant.count();
  const beforeRequestCount = await prisma.joinRequest.count();
  const beforePaymentCount = await prisma.payment.count();
  const beforeMessageCount = await prisma.roomMessage.count();
  const beforeAttendanceCount = await prisma.roomAttendance.count();
  const beforeCheckInSessionCount = await prisma.roomCheckInSession.count();
  const beforeNotificationCount = await prisma.notification.count();
  const beforeOtpCount = await prisma.otpChallenge.count();

  console.log("📊 COUNTS BEFORE CLEANUP:");
  console.log(`- Users: ${beforeUserCount} (WILL NOT BE DELETED)`);
  console.log(`- Rooms: ${beforeRoomCount}`);
  console.log(`- RoomParticipants: ${beforeParticipantCount}`);
  console.log(`- JoinRequests: ${beforeRequestCount}`);
  console.log(`- Payments: ${beforePaymentCount}`);
  console.log(`- RoomMessages: ${beforeMessageCount}`);
  console.log(`- RoomAttendance: ${beforeAttendanceCount}`);
  console.log(`- RoomCheckInSessions: ${beforeCheckInSessionCount}`);
  console.log(`- Notifications: ${beforeNotificationCount}`);
  console.log(`- OtpChallenges: ${beforeOtpCount}`);

  console.log("\nDeleting transactional / room activity data...");

  // 2. Perform safe targeted deletes in dependency order
  await prisma.notification.deleteMany({});
  await prisma.roomAttendance.deleteMany({});
  await prisma.roomCheckInSession.deleteMany({});
  await prisma.roomMessage.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.roomParticipant.deleteMany({});
  await prisma.joinRequest.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.otpChallenge.deleteMany({});

  // 3. Reset test-derived user counters / test levels
  await prisma.user.updateMany({
    data: {
      hostLevel: "NEW",
    },
  });

  // 4. Fetch & Print Final Counts
  const afterUserCount = await prisma.user.count();
  const afterRoomCount = await prisma.room.count();
  const afterParticipantCount = await prisma.roomParticipant.count();
  const afterRequestCount = await prisma.joinRequest.count();
  const afterPaymentCount = await prisma.payment.count();
  const afterMessageCount = await prisma.roomMessage.count();
  const afterAttendanceCount = await prisma.roomAttendance.count();
  const afterCheckInSessionCount = await prisma.roomCheckInSession.count();
  const afterNotificationCount = await prisma.notification.count();
  const afterOtpCount = await prisma.otpChallenge.count();

  console.log("\n==================================================");
  console.log("✅ CLEANUP COMPLETE — FINAL DATABASE STATE:");
  console.log("==================================================");
  console.log(`- Users: ${afterUserCount} (PRESERVED: ${afterUserCount === beforeUserCount ? "YES" : "NO"})`);
  console.log(`- Rooms: ${afterRoomCount}`);
  console.log(`- RoomParticipants: ${afterParticipantCount}`);
  console.log(`- JoinRequests: ${afterRequestCount}`);
  console.log(`- Payments: ${afterPaymentCount}`);
  console.log(`- RoomMessages: ${afterMessageCount}`);
  console.log(`- RoomAttendance: ${afterAttendanceCount}`);
  console.log(`- RoomCheckInSessions: ${afterCheckInSessionCount}`);
  console.log(`- Notifications: ${afterNotificationCount}`);
  console.log(`- OtpChallenges: ${afterOtpCount}`);
  console.log("==================================================\n");

  if (afterUserCount !== beforeUserCount) {
    console.error("❌ CRITICAL WARNING: User count changed during cleanup!");
    process.exit(1);
  }
}

resetDevActivity()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup script error:", err);
    process.exit(1);
  });
