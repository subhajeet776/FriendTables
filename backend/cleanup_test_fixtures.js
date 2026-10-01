import { prisma } from './dist/db.js';

async function cleanupTestFixtures() {
  console.log('🧹 Cleaning leftover test fixture data from SQLite dev.db...');

  // Identify test hosts and users
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'Step6B' } },
        { name: { contains: 'Step7A' } },
        { name: { contains: 'Step6A' } },
        { name: { contains: 'Joinee Loyalty' } },
        { name: { contains: 'Host Step' } },
        { name: { contains: 'Joinee A' } },
        { name: { contains: 'Joinee B' } },
        { name: { contains: 'Joinee C' } },
        { phone: { startsWith: '+91977' } },
        { phone: { startsWith: '+91976' } },
        { phone: { startsWith: '+91975' } },
        { phone: { startsWith: '+91974' } },
        { phone: { startsWith: '+91967' } },
      ]
    },
    select: { id: true }
  });

  const testUserIds = testUsers.map(u => u.id);

  // Identify test rooms
  const testRooms = await prisma.room.findMany({
    where: {
      OR: [
        { hostId: { in: testUserIds } },
        { title: { contains: 'Step 6B' } },
        { title: { contains: 'Simultaneous Claim' } },
        { title: { contains: 'Dummy Past Room' } },
        { title: { contains: 'Target Dinner for Free Claim' } },
        { title: { contains: 'Room B' } },
      ]
    },
    select: { id: true }
  });

  const testRoomIds = testRooms.map(r => r.id);

  console.log(`Found ${testRoomIds.length} test rooms and ${testUserIds.length} test users.`);

  if (testRoomIds.length > 0 || testUserIds.length > 0) {
    // Delete dependent entities first
    await prisma.rating.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { reviewerId: { in: testUserIds } }] }
    });

    await prisma.roomAttendance.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { userId: { in: testUserIds } }] }
    });

    await prisma.roomCheckInSession.deleteMany({
      where: { roomId: { in: testRoomIds } }
    });

    await prisma.roomParticipant.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { userId: { in: testUserIds } }] }
    });

    await prisma.payment.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { userId: { in: testUserIds } }] }
    });

    await prisma.joinRequest.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { joineeId: { in: testUserIds } }] }
    });

    await prisma.notification.deleteMany({
      where: { userId: { in: testUserIds } }
    });

    await prisma.loyaltyReward.deleteMany({
      where: { userId: { in: testUserIds } }
    });

    await prisma.roomMessage.deleteMany({
      where: { OR: [{ roomId: { in: testRoomIds } }, { senderId: { in: testUserIds } }] }
    });

    // Delete rooms
    await prisma.room.deleteMany({
      where: { id: { in: testRoomIds } }
    });

    // Delete test users
    await prisma.user.deleteMany({
      where: { id: { in: testUserIds } }
    });

    console.log('✅ Leftover test fixtures successfully deleted!');
  } else {
    console.log('No test fixtures found to clean.');
  }

  const remainingRooms = await prisma.room.findMany({ select: { id: true, title: true, status: true, hostId: true } });
  console.log('REMAINING REAL ROOMS IN DB:', remainingRooms);

  const realUserCount = await prisma.user.count();
  console.log('PRESERVED REAL USERS IN DB:', realUserCount);

  await prisma.$disconnect();
}

cleanupTestFixtures().catch(console.error);
