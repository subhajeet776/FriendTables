import { PrismaClient } from "@prisma/client";
import { signToken } from "./src/utils/jwt.ts";
import crypto from "crypto";
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

async function runStep6aTests() {
  console.log("\n==================================================");
  console.log("🧪 STARTING FRIENTABLES STEP 6A AUTOMATED TESTS");
  console.log("==================================================\n");

  const timestamp = Date.now();

  // Create test users
  const hostUser = await prisma.user.create({
    data: {
      phone: `+91987${timestamp.toString().slice(-7)}`,
      name: `Host User ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "HOST",
    },
  });

  const otherHostUser = await prisma.user.create({
    data: {
      phone: `+91986${timestamp.toString().slice(-7)}`,
      name: `Other Host User ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "HOST",
    },
  });

  const confirmedUser = await prisma.user.create({
    data: {
      phone: `+91985${timestamp.toString().slice(-7)}`,
      name: `Confirmed Joinee ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const pendingUser = await prisma.user.create({
    data: {
      phone: `+91984${timestamp.toString().slice(-7)}`,
      name: `Pending Joinee ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const acceptedUnpaidUser = await prisma.user.create({
    data: {
      phone: `+91983${timestamp.toString().slice(-7)}`,
      name: `Accepted Unpaid ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const rejectedUser = await prisma.user.create({
    data: {
      phone: `+91982${timestamp.toString().slice(-7)}`,
      name: `Rejected User ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const unrelatedUser = await prisma.user.create({
    data: {
      phone: `+91981${timestamp.toString().slice(-7)}`,
      name: `Unrelated User ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  // JWT Tokens
  const hostToken = signToken({ userId: hostUser.id });
  const otherHostToken = signToken({ userId: otherHostUser.id });
  const confirmedToken = signToken({ userId: confirmedUser.id });
  const pendingToken = signToken({ userId: pendingUser.id });
  const acceptedUnpaidToken = signToken({ userId: acceptedUnpaidUser.id });
  const rejectedToken = signToken({ userId: rejectedUser.id });
  const unrelatedToken = signToken({ userId: unrelatedUser.id });

  // Create Room A (Host's Room)
  const roomA = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Test Dinner CheckIn Room A",
      description: "Step 6A Test Room A",
      venueName: "The Courtyard",
      venueAddress: "Indiranagar, Bengaluru",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 250,
      status: "PUBLISHED",
    },
  });

  // Create Room B (Host B's Room)
  const roomB = await prisma.room.create({
    data: {
      hostId: otherHostUser.id,
      title: "Test Dinner CheckIn Room B",
      description: "Step 6A Test Room B",
      venueName: "Smoke House Deli",
      venueAddress: "Indiranagar, Bengaluru",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 300,
      status: "PUBLISHED",
    },
  });

  // Set up Join Requests & RoomParticipant state for Room A
  // 1. Confirmed Participant (Accepted + Paid -> RoomParticipant)
  await prisma.roomParticipant.create({
    data: {
      roomId: roomA.id,
      userId: confirmedUser.id,
    },
  });
  await prisma.room.update({
    where: { id: roomA.id },
    data: { confirmedParticipantsCount: 1 },
  });

  // 2. Pending Request
  await prisma.joinRequest.create({
    data: {
      roomId: roomA.id,
      joineeId: pendingUser.id,
      status: "PENDING",
    },
  });

  // 3. Accepted but Unpaid Request
  await prisma.joinRequest.create({
    data: {
      roomId: roomA.id,
      joineeId: acceptedUnpaidUser.id,
      status: "ACCEPTED",
    },
  });

  // 4. Rejected Request
  await prisma.joinRequest.create({
    data: {
      roomId: roomA.id,
      joineeId: rejectedUser.id,
      status: "REJECTED",
    },
  });

  try {
    // TEST 2: Unauthenticated verification -> 401
  const res2 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrToken: "FRIENTABLES:dummy:dummy" }),
  });
  assert(res2.status === 401, "Unauthenticated verification -> 401");

  // TEST 3: Host can create check-in session
  const res3 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  const data3 = await res3.json();
  assert(
    res3.status === 200 && data3.success && data3.data?.qrPayload,
    "Host can create check-in session"
  );
  const activeQrPayload = data3.data?.qrPayload;

  // TEST 4: Non-host cannot create check-in session -> 403
  const res4 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${confirmedToken}` },
  });
  assert(res4.status === 403, "Non-host cannot create check-in session -> 403");

  // TEST 5: Confirmed participant can verify QR
  const res5 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${confirmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  const data5 = await res5.json();
  assert(
    res5.status === 200 && data5.success && data5.data?.checkedInAt,
    "Confirmed participant can verify QR"
  );

  // TEST 6: Pending participant cannot verify -> 403
  const res6 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pendingToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  assert(res6.status === 403, "Pending participant cannot verify -> 403");

  // TEST 7: Accepted-but-unpaid user cannot verify -> 403
  const res7 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${acceptedUnpaidToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  assert(res7.status === 403, "Accepted-but-unpaid user cannot verify -> 403");

  // TEST 8: Rejected user cannot verify -> 403
  const res8 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rejectedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  assert(res8.status === 403, "Rejected user cannot verify -> 403");

  // TEST 9: Unrelated user cannot verify -> 403
  const res9 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${unrelatedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  assert(res9.status === 403, "Unrelated user cannot verify -> 403");

  // TEST 10: Valid QR succeeds (already verified for confirmedUser)
  assert(data5.success === true, "Valid QR succeeds");

  // TEST 11: Invalid QR fails -> 400
  const res11 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${confirmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: "FRIENTABLES:" + roomA.id + ":invalidtoken123" }),
  });
  assert(res11.status === 400, "Invalid QR fails -> 400");

  // TEST 12: Expired QR fails -> 400
  // Insert manually an expired session in db
  const expiredSecret = "expiredsecrettoken1234567890";
  const expiredHash = crypto.createHash("sha256").update(expiredSecret).digest("hex");
  await prisma.roomCheckInSession.create({
    data: {
      roomId: roomA.id,
      createdByUserId: hostUser.id,
      tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 60000), // 1 min ago
    },
  });
  const res12 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${confirmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: `FRIENTABLES:${roomA.id}:${expiredSecret}` }),
  });
  assert(res12.status === 400, "Expired QR fails -> 400");

  // TEST 13: Room A QR cannot check into Room B -> 400
  const res13 = await fetch(`${API_BASE}/rooms/${roomB.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${confirmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  assert(res13.status === 400, "Room A QR cannot check into Room B -> 400");

  // TEST 14: Attendance record created
  const dbAttendance = await prisma.roomAttendance.findUnique({
    where: {
      roomId_userId: {
        roomId: roomA.id,
        userId: confirmedUser.id,
      },
    },
  });
  assert(Boolean(dbAttendance), "Attendance record created");

  // TEST 15: checkedInAt stored
  assert(Boolean(dbAttendance && dbAttendance.checkedInAt), "checkedInAt stored");

  // TEST 16: Attendance survives backend query via GET /attendance
  const res16 = await fetch(`${API_BASE}/rooms/${roomA.id}/attendance`, {
    headers: { Authorization: `Bearer ${confirmedToken}` },
  });
  const data16 = await res16.json();
  assert(
    res16.status === 200 && data16.data?.checkedIn === true && data16.data?.checkedInAt,
    "Attendance survives backend query via GET /attendance"
  );

  // TEST 17: Repeated scan does not create another attendance record (Idempotency)
  const res17 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${confirmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ qrToken: activeQrPayload }),
  });
  const data17 = await res17.json();
  const attCount = await prisma.roomAttendance.count({
    where: { roomId: roomA.id, userId: confirmedUser.id },
  });
  assert(
    res17.status === 200 && data17.alreadyCheckedIn === true && attCount === 1,
    "Repeated scan does not create another attendance record"
  );

  // TEST 18: Host A cannot manage Host B's Room check-in -> 403
  const res18 = await fetch(`${API_BASE}/rooms/${roomB.id}/check-in/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  assert(res18.status === 403, "Host A cannot manage Host B's Room check-in -> 403");

  // TEST 19: Participant A cannot mark Participant B as checked in -> 403
  const res19 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pendingToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qrToken: activeQrPayload,
      userId: confirmedUser.id,
      participantId: "fake-id",
    }),
  });
  assert(res19.status === 403, "Participant A cannot mark Participant B as checked in -> 403");

  // TEST 20: Client cannot provide arbitrary userId -> 403
  const res20 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${unrelatedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qrToken: activeQrPayload,
      userId: confirmedUser.id,
    }),
  });
  assert(res20.status === 403, "Client cannot provide arbitrary userId -> 403");

  // TEST 21: Client cannot provide arbitrary participantId -> 403
  const res21 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${unrelatedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qrToken: activeQrPayload,
      participantId: "arbitrary-id",
    }),
  });
  assert(res21.status === 403, "Client cannot provide arbitrary participantId -> 403");

  // TEST 22: Client cannot directly set checkedIn=true -> 403
  const res22 = await fetch(`${API_BASE}/rooms/${roomA.id}/check-in/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${unrelatedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      checkedIn: true,
      qrToken: activeQrPayload,
    }),
  });
  assert(res22.status === 403, "Client cannot directly set checkedIn=true -> 403");
  } finally {
    const testUserIds = [hostUser.id, otherHostUser.id, confirmedUser.id, pendingUser.id, acceptedUnpaidUser.id, rejectedUser.id, unrelatedUser.id];
    const testRoomIds = [roomA.id, roomB.id];
    await cleanTestFixtureIds(prisma, { userIds: testUserIds, roomIds: testRoomIds });
  }

  console.log("\n==================================================");
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runStep6aTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
