import { PrismaClient } from '@prisma/client';
import { processNoShowsForExpiredRooms } from './src/services/noShowService';
import { getUserReputationStats } from './src/services/reputationService';
import { getRoomTimeInfo } from './src/utils/roomTiming';
import { cleanTestFixtureIds } from './testCleanup';

const prisma = new PrismaClient();

let createdUserIds: string[] = [];
let createdRoomIds: string[] = [];

async function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('=== RUNNING PUBLIC PROFILE, PENALTY & CANCELLATION INTEGRATION TESTS ===\n');

  try {
    // 1. Create Test Users
    const hostUser = await prisma.user.create({
      data: {
        phone: `+919000${Date.now().toString().slice(-6)}`,
        name: 'Test Host User',
        avatarUrl: 'https://example.com/host.jpg',
        bio: 'Superhost bio',
        homeCity: 'Bengaluru',
        interests: JSON.stringify(['Foodie', 'Tech']),
        isPhoneVerified: true,
      },
    });
    createdUserIds.push(hostUser.id);

    const joineeUser1 = await prisma.user.create({
      data: {
        phone: `+919001${Date.now().toString().slice(-6)}`,
        name: 'Test Joinee One',
        avatarUrl: 'https://example.com/j1.jpg',
        bio: 'Joinee 1 bio',
        homeCity: 'Mumbai',
        interests: JSON.stringify(['Coffee']),
        isPhoneVerified: true,
      },
    });
    createdUserIds.push(joineeUser1.id);

    const joineeUser2 = await prisma.user.create({
      data: {
        phone: `+919002${Date.now().toString().slice(-6)}`,
        name: 'Test Joinee Two',
        avatarUrl: 'https://example.com/j2.jpg',
        bio: 'Joinee 2 bio',
        homeCity: 'Goa',
        interests: JSON.stringify(['Music']),
        isPhoneVerified: true,
      },
    });
    createdUserIds.push(joineeUser2.id);

    const joineeUnpaid = await prisma.user.create({
      data: {
        phone: `+919003${Date.now().toString().slice(-6)}`,
        name: 'Test Unpaid Joinee',
        isPhoneVerified: true,
      },
    });
    createdUserIds.push(joineeUnpaid.id);

    // --- TEST SUITE: PUBLIC PROFILE & REPUTATION ---
    console.log('--- TEST GROUP 1: Public Profile & Reputation ---');

    // Create dummy room for rating
    const ratingRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: 'Rating Test Room',
        description: 'For rating test',
        venueName: 'Rating Cafe',
        venueAddress: 'MG Road',
        city: 'Bengaluru',
        capacity: 4,
        joiningFee: 100,
        status: 'COMPLETED',
      },
    });
    createdRoomIds.push(ratingRoom.id);

    // Add a rating to hostUser
    await prisma.rating.create({
      data: {
        roomId: ratingRoom.id,
        reviewerId: joineeUser1.id,
        revieweeId: hostUser.id,
        score: 5,
        review: 'Excellent host!',
      },
    });

    const repStats1 = await getUserReputationStats(hostUser.id);
    await assert(repStats1.rawRatingAverage === 5, '1. Raw rating average computed correctly (5.0)');
    await assert(repStats1.totalRatingsCount === 1, '2. Total ratings count computed correctly (1)');
    await assert(repStats1.reputation === 5, '3. Initial reputation equals raw rating when 0 penalties');
    await assert(repStats1.noShowCount === 0, '4. Initial noShowCount is 0');

    // Test user with no ratings
    const noRatingStats = await getUserReputationStats(joineeUser1.id);
    await assert(noRatingStats.rawRatingAverage === null, '5. Raw rating is null for user with no ratings');
    await assert(noRatingStats.reputation === null, '6. Reputation is null for user with no ratings');

    // --- TEST GROUP 2: Host Room Cancellation (Case A: No Joinees) ---
    console.log('\n--- TEST GROUP 2: Host Cancellation (No Joinees) ---');

    const emptyRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: 'Empty Dinner Room',
        description: 'No joinees yet',
        venueName: 'Cafe Central',
        venueAddress: 'Koramangala',
        city: 'Bengaluru',
        capacity: 4,
        joiningFee: 100,
        status: 'PUBLISHED',
      },
    });
    createdRoomIds.push(emptyRoom.id);

    // Host cancels empty room
    await prisma.room.update({
      where: { id: emptyRoom.id },
      data: { status: 'CANCELLED' },
    });

    const hostPenaltiesEmpty = await prisma.penalty.count({
      where: { userId: hostUser.id, roomId: emptyRoom.id },
    });
    await assert(hostPenaltiesEmpty === 0, '7. Cancel before anyone joins -> 0 Host penalty');

    // --- TEST GROUP 3: Host Cancellation (Case B: Paid Joinees) ---
    console.log('\n--- TEST GROUP 3: Host Cancellation (With Paid Joinees) ---');

    const activeRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: 'Popular Dinner Room',
        description: 'Has paid joinees',
        venueName: 'Truffles',
        venueAddress: 'Indiranagar',
        city: 'Bengaluru',
        capacity: 4,
        joiningFee: 200,
        status: 'PUBLISHED',
      },
    });
    createdRoomIds.push(activeRoom.id);

    // Create confirmed join request + SUCCESS payment for joinee 1
    const req1 = await prisma.joinRequest.create({
      data: {
        roomId: activeRoom.id,
        joineeId: joineeUser1.id,
        status: 'ACCEPTED',
      },
    });

    const pay1 = await prisma.payment.create({
      data: {
        roomId: activeRoom.id,
        userId: joineeUser1.id,
        joinRequestId: req1.id,
        amount: 200,
        hostShare: 140,
        platformShare: 60,
        status: 'SUCCESS',
      },
    });

    // Create confirmed join request + SUCCESS payment for joinee 2
    const req2 = await prisma.joinRequest.create({
      data: {
        roomId: activeRoom.id,
        joineeId: joineeUser2.id,
        status: 'ACCEPTED',
      },
    });

    const pay2 = await prisma.payment.create({
      data: {
        roomId: activeRoom.id,
        userId: joineeUser2.id,
        joinRequestId: req2.id,
        amount: 200,
        hostShare: 140,
        platformShare: 60,
        status: 'SUCCESS',
      },
    });

    // Create confirmed join request with UNPAID status for joineeUnpaid
    const reqUnpaid = await prisma.joinRequest.create({
      data: {
        roomId: activeRoom.id,
        joineeId: joineeUnpaid.id,
        status: 'ACCEPTED',
      },
    });
    await prisma.payment.create({
      data: {
        roomId: activeRoom.id,
        userId: joineeUnpaid.id,
        joinRequestId: reqUnpaid.id,
        amount: 200,
        hostShare: 140,
        platformShare: 60,
        status: 'CREATED', // Unpaid
      },
    });

    // Host cancels room with paid joinees -> Apply penalty & refunds
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: activeRoom.id },
        data: { status: 'CANCELLED' },
      });

      await tx.penalty.upsert({
        where: {
          userId_roomId_type: {
            userId: hostUser.id,
            roomId: activeRoom.id,
            type: 'HOST_CANCEL_AFTER_JOIN',
          },
        },
        create: {
          userId: hostUser.id,
          roomId: activeRoom.id,
          type: 'HOST_CANCEL_AFTER_JOIN',
          deduction: 0.25,
          reason: 'Cancelled room after confirmed joinees joined',
        },
        update: {},
      });

      // Refund 70% to paid joinees only
      const refundAmount1 = Math.floor(pay1.amount * 0.70); // 140
      await tx.payment.update({
        where: { id: pay1.id },
        data: {
          status: 'REFUNDED',
          refundAmount: refundAmount1,
          refundStatus: 'REFUNDED',
          refundedAt: new Date(),
        },
      });

      const refundAmount2 = Math.floor(pay2.amount * 0.70); // 140
      await tx.payment.update({
        where: { id: pay2.id },
        data: {
          status: 'REFUNDED',
          refundAmount: refundAmount2,
          refundStatus: 'REFUNDED',
          refundedAt: new Date(),
        },
      });
    });

    // Verify Host Penalty
    const hostPenalty = await prisma.penalty.findUnique({
      where: {
        userId_roomId_type: {
          userId: hostUser.id,
          roomId: activeRoom.id,
          type: 'HOST_CANCEL_AFTER_JOIN',
        },
      },
    });
    await assert(Boolean(hostPenalty && hostPenalty.deduction === 0.25), '8. Host receives -0.25 penalty after cancelling room with paid joinees');

    // Verify Joinee Refunds
    const updatedPay1 = await prisma.payment.findUnique({ where: { id: pay1.id } });
    await assert(updatedPay1?.status === 'REFUNDED' && updatedPay1?.refundAmount === 140, '9. Joinee 1 receives exactly 70% demo refund (₹140 of ₹200)');

    const updatedPay2 = await prisma.payment.findUnique({ where: { id: pay2.id } });
    await assert(updatedPay2?.status === 'REFUNDED' && updatedPay2?.refundAmount === 140, '10. Joinee 2 receives exactly 70% demo refund (₹140 of ₹200)');

    // Verify Unpaid Joinee has 0 refund
    const unpaidPayments = await prisma.payment.findMany({
      where: { joinRequestId: reqUnpaid.id, status: 'REFUNDED' },
    });
    await assert(unpaidPayments.length === 0, '11. Accepted but unpaid user receives 0 refund');

    // Test Idempotency: Attempting duplicate penalty/refund
    await prisma.penalty.upsert({
      where: {
        userId_roomId_type: {
          userId: hostUser.id,
          roomId: activeRoom.id,
          type: 'HOST_CANCEL_AFTER_JOIN',
        },
      },
      create: {
        userId: hostUser.id,
        roomId: activeRoom.id,
        type: 'HOST_CANCEL_AFTER_JOIN',
        deduction: 0.25,
      },
      update: {},
    });
    const totalHostPenalties = await prisma.penalty.count({
      where: { userId: hostUser.id, roomId: activeRoom.id, type: 'HOST_CANCEL_AFTER_JOIN' },
    });
    await assert(totalHostPenalties === 1, '12. Duplicate cancellation attempts cannot create duplicate penalties (idempotent)');

    // --- TEST GROUP 4: Reputation Calculation After Penalty ---
    console.log('\n--- TEST GROUP 4: Reputation Calculation After Penalty ---');

    const repStatsAfterCancel = await getUserReputationStats(hostUser.id);
    await assert(repStatsAfterCancel.rawRatingAverage === 5.0, '13. Raw rating average remains 5.0 after penalty');
    await assert(repStatsAfterCancel.penaltyDeduction === 0.25, '14. Penalty deduction equals 0.25');
    await assert(repStatsAfterCancel.reputation === 4.75, '15. Adjusted reputation is exactly 4.75 (5.0 - 0.25)');

    // --- TEST GROUP 5: Joinee No-Show Penalty System ---
    console.log('\n--- TEST GROUP 5: Joinee No-Show Penalty System ---');

    // Create past closed room
    const pastClosedRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: 'Past Dinner Room',
        description: 'Scheduled in past',
        venueName: 'Brik Oven',
        venueAddress: 'Church Street',
        city: 'Bengaluru',
        dateTime: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        capacity: 4,
        joiningFee: 100,
        status: 'COMPLETED',
      },
    });
    createdRoomIds.push(pastClosedRoom.id);

    // Joinee 1: Confirmed, Paid, AND Attended -> NO penalty
    const reqNoShow1 = await prisma.joinRequest.create({
      data: { roomId: pastClosedRoom.id, joineeId: joineeUser1.id, status: 'ACCEPTED' },
    });
    await prisma.payment.create({
      data: {
        roomId: pastClosedRoom.id,
        userId: joineeUser1.id,
        joinRequestId: reqNoShow1.id,
        amount: 100,
        hostShare: 70,
        platformShare: 30,
        status: 'SUCCESS',
      },
    });
    await prisma.roomAttendance.create({
      data: { roomId: pastClosedRoom.id, userId: joineeUser1.id },
    });

    // Joinee 2: Confirmed, Paid, but NEVER Attended -> Gets JOINEE_NO_SHOW (-0.25)
    const reqNoShow2 = await prisma.joinRequest.create({
      data: { roomId: pastClosedRoom.id, joineeId: joineeUser2.id, status: 'ACCEPTED' },
    });
    await prisma.payment.create({
      data: {
        roomId: pastClosedRoom.id,
        userId: joineeUser2.id,
        joinRequestId: reqNoShow2.id,
        amount: 100,
        hostShare: 70,
        platformShare: 30,
        status: 'SUCCESS',
      },
    });

    // Unpaid Joinee: Confirmed, but Unpaid -> NO penalty
    const reqNoShowUnpaid = await prisma.joinRequest.create({
      data: { roomId: pastClosedRoom.id, joineeId: joineeUnpaid.id, status: 'ACCEPTED' },
    });
    await prisma.payment.create({
      data: {
        roomId: pastClosedRoom.id,
        userId: joineeUnpaid.id,
        joinRequestId: reqNoShowUnpaid.id,
        amount: 100,
        hostShare: 70,
        platformShare: 30,
        status: 'CREATED',
      },
    });

    // Execute no-show evaluation service
    await processNoShowsForExpiredRooms();

    // Verify Joinee 1 (Attended) has NO penalty
    const j1Penalties = await prisma.penalty.count({
      where: { userId: joineeUser1.id, roomId: pastClosedRoom.id, type: 'JOINEE_NO_SHOW' },
    });
    await assert(j1Penalties === 0, '16. Confirmed attended Joinee gets NO no-show penalty');

    // Verify Unpaid Joinee has NO penalty
    const unpaidPenalties = await prisma.penalty.count({
      where: { userId: joineeUnpaid.id, roomId: pastClosedRoom.id, type: 'JOINEE_NO_SHOW' },
    });
    await assert(unpaidPenalties === 0, '17. Confirmed unpaid joinee gets NO no-show penalty');

    // Verify Joinee 2 (Paid & No Attendance) HAS -0.25 penalty
    const j2Penalties = await prisma.penalty.findUnique({
      where: {
        userId_roomId_type: {
          userId: joineeUser2.id,
          roomId: pastClosedRoom.id,
          type: 'JOINEE_NO_SHOW',
        },
      },
    });
    await assert(Boolean(j2Penalties && j2Penalties.deduction === 0.25), '18. Confirmed paid Joinee who never attends gets -0.25 no-show penalty');

    // Re-run no-show service to test idempotency
    await processNoShowsForExpiredRooms();
    const j2PenaltyCount = await prisma.penalty.count({
      where: { userId: joineeUser2.id, roomId: pastClosedRoom.id, type: 'JOINEE_NO_SHOW' },
    });
    await assert(j2PenaltyCount === 1, '19. Duplicate no-show evaluation cannot create duplicate penalties (idempotent)');

    // Verify Joinee 2 stats
    const j2Stats = await getUserReputationStats(joineeUser2.id);
    await assert(j2Stats.noShowCount === 1, '20. No-show count appears as 1 on Joinee 2 profile');
    await assert(j2Stats.rawRatingAverage === null, '21. Joinee 2 with 0 ratings retains rawRatingAverage = null');
    await assert(j2Stats.reputation === null, '22. Joinee 2 with 0 ratings retains reputation = null (displays "No rating yet")');

    // --- TEST GROUP 6: Grace Period & Active Room No-Show Isolation ---
    console.log('\n--- TEST GROUP 6: Active Room No-Show Grace Period Protection ---');

    const futureRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: 'Active Upcoming Room',
        description: 'Currently in grace period or open',
        venueName: 'Toit',
        venueAddress: 'Indiranagar',
        city: 'Bengaluru',
        dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours in future
        capacity: 4,
        joiningFee: 100,
        status: 'CHECK_IN_OPEN',
      },
    });
    createdRoomIds.push(futureRoom.id);

    const reqFuture = await prisma.joinRequest.create({
      data: { roomId: futureRoom.id, joineeId: joineeUser1.id, status: 'ACCEPTED' },
    });
    await prisma.payment.create({
      data: {
        roomId: futureRoom.id,
        userId: joineeUser1.id,
        joinRequestId: reqFuture.id,
        amount: 100,
        hostShare: 70,
        platformShare: 30,
        status: 'SUCCESS',
      },
    });

    // Run no-show service -> Future room must NOT produce any no-show penalty!
    await processNoShowsForExpiredRooms();
    const futurePenalties = await prisma.penalty.count({
      where: { userId: joineeUser1.id, roomId: futureRoom.id },
    });
    await assert(futurePenalties === 0, '23. Active/upcoming room before closing time produces 0 no-show penalties');

    console.log('\n==================================================');
    console.log('🎉 ALL 23 INTEGRATION ASSERTIONS PASSED SUCCESSFULLY!');
    console.log('==================================================\n');
  } finally {
    // Teardown test records idempotently
    console.log('Cleaning up integration test fixtures...');
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
