import { prisma } from "./src/db.js";

/**
 * ONE-TIME LOCAL DEVELOPMENT CLEANUP SCRIPT
 * Target: backend/prisma/dev.db (SQLite)
 * 
 * Purpose:
 * Cleans all room and room-dependent test data causing time/schedule conflicts.
 * PRESERVES ALL User accounts and OtpChallenge records untouched.
 */
export async function executeRoomCleanup(dryRun = false) {
  console.log(`\n--- Starting Development DB Cleanup (dryRun: ${dryRun}) ---`);

  const initialCounts = {
    users: await prisma.user.count(),
    otpChallenges: await prisma.otpChallenge.count(),
    rooms: await prisma.room.count(),
    joinRequests: await prisma.joinRequest.count(),
    participants: await prisma.roomParticipant.count(),
    payments: await prisma.payment.count(),
    messages: await prisma.roomMessage.count(),
    notifications: await prisma.notification.count(),
    attendances: await prisma.roomAttendance.count(),
    checkInSessions: await prisma.roomCheckInSession.count(),
    ratings: await prisma.rating.count(),
    loyaltyRewards: await prisma.loyaltyReward.count(),
    penalties: await prisma.penalty.count(),
  };

  console.log("Initial database state:", initialCounts);

  if (dryRun) {
    console.log("DRY RUN ONLY. No changes made.");
    return initialCounts;
  }

  // Execute deletion inside atomic transaction in strict dependency order
  await prisma.$transaction(async (tx) => {
    // 1. Delete notifications related to rooms, requests, payments
    const deletedNotifications = await tx.notification.deleteMany({});
    console.log(`Deleted notifications: ${deletedNotifications.count}`);

    // 2. Delete room ratings
    const deletedRatings = await tx.rating.deleteMany({});
    console.log(`Deleted ratings: ${deletedRatings.count}`);

    // 3. Delete room attendances
    const deletedAttendances = await tx.roomAttendance.deleteMany({});
    console.log(`Deleted room attendances: ${deletedAttendances.count}`);

    // 4. Delete room check-in sessions
    const deletedSessions = await tx.roomCheckInSession.deleteMany({});
    console.log(`Deleted check-in sessions: ${deletedSessions.count}`);

    // 5. Delete room messages
    const deletedMessages = await tx.roomMessage.deleteMany({});
    console.log(`Deleted room messages: ${deletedMessages.count}`);

    // 6. Delete penalties linked to rooms
    const deletedPenalties = await tx.penalty.deleteMany({});
    console.log(`Deleted penalties: ${deletedPenalties.count}`);

    // 7. Delete payments linked to rooms & requests
    const deletedPayments = await tx.payment.deleteMany({});
    console.log(`Deleted payments: ${deletedPayments.count}`);

    // 8. Delete room participants
    const deletedParticipants = await tx.roomParticipant.deleteMany({});
    console.log(`Deleted room participants: ${deletedParticipants.count}`);

    // 9. Delete join requests
    const deletedRequests = await tx.joinRequest.deleteMany({});
    console.log(`Deleted join requests: ${deletedRequests.count}`);

    // 10. Delete loyalty rewards used for rooms (or all loyalty rewards)
    const deletedLoyalty = await tx.loyaltyReward.deleteMany({});
    console.log(`Deleted loyalty rewards: ${deletedLoyalty.count}`);

    // 11. Finally delete all rooms
    const deletedRooms = await tx.room.deleteMany({});
    console.log(`Deleted rooms: ${deletedRooms.count}`);
  });

  const finalCounts = {
    users: await prisma.user.count(),
    otpChallenges: await prisma.otpChallenge.count(),
    rooms: await prisma.room.count(),
    joinRequests: await prisma.joinRequest.count(),
    participants: await prisma.roomParticipant.count(),
    payments: await prisma.payment.count(),
    messages: await prisma.roomMessage.count(),
    notifications: await prisma.notification.count(),
    attendances: await prisma.roomAttendance.count(),
    checkInSessions: await prisma.roomCheckInSession.count(),
    ratings: await prisma.rating.count(),
    loyaltyRewards: await prisma.loyaltyReward.count(),
    penalties: await prisma.penalty.count(),
  };

  console.log("Post-cleanup database state:", finalCounts);

  // Assert user safety
  if (finalCounts.users !== initialCounts.users) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: User count changed from ${initialCounts.users} to ${finalCounts.users}!`);
  }

  return finalCounts;
}

if (process.argv[1] && process.argv[1].endsWith("cleanup_rooms_dev.ts")) {
  // Only execute when run directly and explicit --execute flag is passed
  const shouldExecute = process.argv.includes("--execute");
  executeRoomCleanup(!shouldExecute)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
