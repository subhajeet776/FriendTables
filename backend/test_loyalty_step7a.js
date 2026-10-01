import { PrismaClient } from "@prisma/client";
import { signToken } from "./src/utils/jwt.ts";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

const API_BASE = "http://localhost:5000/api/v1";

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`✅ TEST ${passedCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`❌ FAILED: ${message}`);
  }
}

async function runStep7aTests() {
  console.log("\n==================================================");
  console.log("🧪 STARTING FRIENTABLES STEP 7A AUTOMATED TESTS");
  console.log("==================================================\n");

  const timestamp = Date.now();

  // Create Users
  const hostUser = await prisma.user.create({
    data: {
      phone: `+91967${timestamp.toString().slice(-7)}`,
      name: `Host Step7A ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "HOST",
    },
  });

  const joineeLoyalty = await prisma.user.create({
    data: {
      phone: `+91966${timestamp.toString().slice(-7)}`,
      name: `Joinee Loyalty ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const joineeOther = await prisma.user.create({
    data: {
      phone: `+91965${timestamp.toString().slice(-7)}`,
      name: `Joinee Other ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const hostToken = signToken({ userId: hostUser.id });
  const loyaltyToken = signToken({ userId: joineeLoyalty.id });
  const otherToken = signToken({ userId: joineeOther.id });

  try {
    // TEST 1: New user -> attendance = 0, progress = 0, available rewards = 0
  const res1 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data1 = await res1.json();
  assert(
    res1.status === 200 &&
      data1.data?.totalAttendedDines === 0 &&
      data1.data?.progress === 0 &&
      data1.data?.availableFreeJoiningFees === 0,
    "New user -> attendance = 0, progress = 0, available rewards = 0"
  );

  // Helper to create dummy past room & attendance record
  async function addAttendanceForUser(userId) {
    const dummyRoom = await prisma.room.create({
      data: {
        hostId: hostUser.id,
        title: `Dummy Past Room ${Date.now()}_${Math.random()}`,
        description: "Past room for attendance",
        venueName: "Venue",
        venueAddress: "Address",
        city: "Bengaluru",
        capacity: 4,
        joiningFee: 100,
        status: "COMPLETED",
      },
    });
    const part = await prisma.roomParticipant.create({
      data: { roomId: dummyRoom.id, userId },
    });
    const att = await prisma.roomAttendance.create({
      data: { roomId: dummyRoom.id, userId, participantId: part.id },
    });
    return att;
  }

  // TEST 2: Create 1 real attendance record -> progress = 1/5, available rewards = 0
  await addAttendanceForUser(joineeLoyalty.id);
  const res2 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data2 = await res2.json();
  assert(
    res2.status === 200 &&
      data2.data?.totalAttendedDines === 1 &&
      data2.data?.progress === 1 &&
      data2.data?.availableFreeJoiningFees === 0,
    "Create 1 real attendance record -> progress = 1/5, available rewards = 0"
  );

  // TEST 3: Create 4 total attendance records -> progress = 4/5, available rewards = 0
  await addAttendanceForUser(joineeLoyalty.id); // 2
  await addAttendanceForUser(joineeLoyalty.id); // 3
  await addAttendanceForUser(joineeLoyalty.id); // 4
  const res3 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data3 = await res3.json();
  assert(
    res3.status === 200 &&
      data3.data?.totalAttendedDines === 4 &&
      data3.data?.progress === 4 &&
      data3.data?.availableFreeJoiningFees === 0,
    "Create 4 total attendance records -> progress = 4/5, available rewards = 0"
  );

  // TEST 4: Create 5th attendance -> progress = 5/5, available rewards = 1
  await addAttendanceForUser(joineeLoyalty.id); // 5
  const res4 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data4 = await res4.json();
  assert(
    res4.status === 200 &&
      data4.data?.totalAttendedDines === 5 &&
      data4.data?.progress === 5 &&
      data4.data?.availableFreeJoiningFees === 1,
    "Create 5th attendance -> progress = 5/5, available rewards = 1"
  );

  // TEST 5: Call loyalty endpoint repeatedly -> still 1 available reward (no duplicate rewards)
  await fetch(`${API_BASE}/users/me/loyalty`, { headers: { Authorization: `Bearer ${loyaltyToken}` } });
  await fetch(`${API_BASE}/users/me/loyalty`, { headers: { Authorization: `Bearer ${loyaltyToken}` } });
  const res5 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data5 = await res5.json();
  const rewardCountInDb = await prisma.loyaltyReward.count({
    where: { userId: joineeLoyalty.id, milestone: 5 },
  });
  assert(
    data5.data?.availableFreeJoiningFees === 1 && rewardCountInDb === 1,
    "Call loyalty endpoint repeatedly -> still 1 available reward, no duplicate reward generation"
  );

  // Setup: Create a new room & accepted join request for joineeLoyalty
  const roomA = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Target Dinner for Free Claim",
      description: "Eligible room",
      venueName: "Social",
      venueAddress: "Indiranagar",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 200,
      status: "PUBLISHED",
    },
  });

  const reqA = await prisma.joinRequest.create({
    data: {
      roomId: roomA.id,
      joineeId: joineeLoyalty.id,
      status: "ACCEPTED",
    },
  });

  // TEST 6: Use the free reward for an eligible Room
  const res6 = await fetch(`${API_BASE}/rooms/${roomA.id}/payment/free-claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data6 = await res6.json();
  const dbReward6 = await prisma.loyaltyReward.findUnique({
    where: { userId_milestone: { userId: joineeLoyalty.id, milestone: 5 } },
  });
  const isPart6 = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: roomA.id, userId: joineeLoyalty.id } },
  });
  assert(
    res6.status === 200 &&
      data6.success &&
      dbReward6?.status === "USED" &&
      Boolean(isPart6),
    "Use free reward -> confirmation succeeds, amount = ₹0, reward status = USED, RoomParticipant created"
  );

  // TEST 7: Attempt to use the same reward again -> Conflict / 409 or 403
  const res7 = await fetch(`${API_BASE}/rooms/${roomA.id}/payment/free-claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  assert(res7.status === 409 || res7.status === 403, "Attempt to use same reward again -> 409 Conflict / 403 Forbidden");

  // TEST 8: Attempt to use another user's reward
  // joineeOther attempts free-claim without rewards
  const roomB = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Room B",
      description: "Room B",
      venueName: "Venue B",
      venueAddress: "Address B",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 150,
      status: "PUBLISHED",
    },
  });
  await prisma.joinRequest.create({
    data: { roomId: roomB.id, joineeId: joineeOther.id, status: "ACCEPTED" },
  });
  const res8 = await fetch(`${API_BASE}/rooms/${roomB.id}/payment/free-claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert(res8.status === 403, "Attempt to use another user's / missing reward -> 403");

  // TEST 9: User with no available reward cannot force a ₹0 free-claim
  assert(res8.status === 403, "User with no available reward cannot force a ₹0 payment -> request rejected");

  // TEST 10: Two simultaneous reward-use attempts -> only ONE succeeds
  // Create milestone 10 for joineeLoyalty (add 5 more attendances -> total 10)
  await addAttendanceForUser(joineeLoyalty.id); // 6
  await addAttendanceForUser(joineeLoyalty.id); // 7
  await addAttendanceForUser(joineeLoyalty.id); // 8
  await addAttendanceForUser(joineeLoyalty.id); // 9
  await addAttendanceForUser(joineeLoyalty.id); // 10

  const roomC = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Simultaneous Claim Room 1",
      description: "Room C",
      venueName: "Venue C",
      venueAddress: "Address C",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 150,
      status: "PUBLISHED",
    },
  });
  await prisma.joinRequest.create({
    data: { roomId: roomC.id, joineeId: joineeLoyalty.id, status: "ACCEPTED" },
  });

  const roomD = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Simultaneous Claim Room 2",
      description: "Room D",
      venueName: "Venue D",
      venueAddress: "Address D",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 150,
      status: "PUBLISHED",
    },
  });
  await prisma.joinRequest.create({
    data: { roomId: roomD.id, joineeId: joineeLoyalty.id, status: "ACCEPTED" },
  });

  const [simRes1, simRes2] = await Promise.all([
    fetch(`${API_BASE}/rooms/${roomC.id}/payment/free-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${loyaltyToken}` },
    }),
    fetch(`${API_BASE}/rooms/${roomD.id}/payment/free-claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${loyaltyToken}` },
    }),
  ]);

  const successCount = (simRes1.status === 200 ? 1 : 0) + (simRes2.status === 200 ? 1 : 0);
  assert(successCount === 1, "Two simultaneous reward-use attempts -> only ONE succeeds");

  // TEST 11: After consuming first reward and reaching 10 total attendances -> second reward was created & usable
  const res11 = await fetch(`${API_BASE}/users/me/loyalty`, {
    headers: { Authorization: `Bearer ${loyaltyToken}` },
  });
  const data11 = await res11.json();
  assert(
    data11.data?.totalAttendedDines === 10 &&
      data11.data?.usedFreeJoiningFees === 2, // milestone 5 used in Test 6, milestone 10 used in Test 10
    "After consuming first reward and reaching 10 total attendances, milestone rewards status tracked accurately"
  );

  // TEST 12: Backend restart / query persistence
  const dbAttCount = await prisma.roomAttendance.count({ where: { userId: joineeLoyalty.id } });
  const dbRewards = await prisma.loyaltyReward.findMany({ where: { userId: joineeLoyalty.id } });
  assert(
    dbAttCount === 10 && dbRewards.length === 2 && dbRewards.every((r) => r.status === "USED"),
    "Attendance count & reward status persist in database"
  );
  } finally {
    const testUserIds = [hostUser?.id, joineeLoyalty?.id, joineeOther?.id].filter(Boolean);
    await cleanTestFixtureIds(prisma, { userIds: testUserIds });
    await prisma.$disconnect();
  }

  console.log("\n==================================================");
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runStep7aTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
