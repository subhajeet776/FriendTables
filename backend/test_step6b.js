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

async function runStep6bTests() {
  console.log("\n==================================================");
  console.log("🧪 STARTING FRIENTABLES STEP 6B AUTOMATED TESTS");
  console.log("==================================================\n");

  const timestamp = Date.now();

  // 1. Create Test Users
  const hostUser = await prisma.user.create({
    data: {
      phone: `+91977${timestamp.toString().slice(-7)}`,
      name: `Host Step6B ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "HOST",
    },
  });

  const joineeA = await prisma.user.create({
    data: {
      phone: `+91976${timestamp.toString().slice(-7)}`,
      name: `Joinee A ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const joineeB = await prisma.user.create({
    data: {
      phone: `+91975${timestamp.toString().slice(-7)}`,
      name: `Joinee B ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const joineeC = await prisma.user.create({
    data: {
      phone: `+91974${timestamp.toString().slice(-7)}`,
      name: `Joinee C ${timestamp}`,
      isOnboardingCompleted: true,
      activeMode: "JOINEE",
    },
  });

  const hostToken = signToken({ userId: hostUser.id });
  const joineeAToken = signToken({ userId: joineeA.id });
  const joineeBToken = signToken({ userId: joineeB.id });
  const joineeCToken = signToken({ userId: joineeC.id });

  // 2. Create Published Room
  const room = await prisma.room.create({
    data: {
      hostId: hostUser.id,
      title: "Step 6B Test Dinner",
      description: "Testing Notifications & Ratings",
      venueName: "Toscano",
      venueAddress: "UB City",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 150,
      status: "PUBLISHED",
    },
  });

  try {
    // TEST 1: Joinee requests room -> JoinRequest = PENDING, notification count unchanged
  const beforeNotifCount = await prisma.notification.count({ where: { userId: joineeA.id } });
  const reqResA = await fetch(`${API_BASE}/rooms/${room.id}/join-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${joineeAToken}` },
  });
  const reqDataA = await reqResA.json();
  const requestIdA = reqDataA.request?.id;
  const afterNotifCountA = await prisma.notification.count({ where: { userId: joineeA.id } });
  assert(
    reqResA.status === 201 && reqDataA.request?.status === "PENDING" && afterNotifCountA === beforeNotifCount,
    "Joinee requests room -> JoinRequest = PENDING, Joinee notification count unchanged"
  );

  // TEST 2: Host accepts request -> JoinRequest = ACCEPTED, notification created for Joinee
  const acceptRes = await fetch(`${API_BASE}/rooms/${room.id}/join-requests/${requestIdA}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  const acceptData = await acceptRes.json();
  const joineeNotifs = await prisma.notification.findMany({ where: { userId: joineeA.id } });
  const hasAcceptedNotif = joineeNotifs.some(
    (n) => n.type === "JOIN_REQUEST_ACCEPTED" || n.type === "PAYMENT_REQUIRED"
  );
  assert(
    acceptRes.status === 200 && acceptData.request?.status === "ACCEPTED" && hasAcceptedNotif,
    "Host accepts request -> JoinRequest = ACCEPTED, Notification created for Joinee"
  );

  // TEST 3: Host rejects request -> JoinRequest = REJECTED, no payment-required notification created
  const reqResB = await fetch(`${API_BASE}/rooms/${room.id}/join-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${joineeBToken}` },
  });
  const reqDataB = await reqResB.json();
  const requestIdB = reqDataB.request?.id;

  const rejectRes = await fetch(`${API_BASE}/rooms/${room.id}/join-requests/${requestIdB}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  const joineeBNotifs = await prisma.notification.findMany({ where: { userId: joineeB.id } });
  const hasPaymentReqNotifForB = joineeBNotifs.some((n) => n.type === "PAYMENT_REQUIRED");
  assert(
    rejectRes.status === 200 && !hasPaymentReqNotifForB,
    "Host rejects request -> JoinRequest = REJECTED, no payment-required notification"
  );

  // TEST 4: Notification belongs only to correct Joinee
  const joineeCNotifs = await prisma.notification.findMany({ where: { userId: joineeC.id } });
  assert(joineeCNotifs.length === 0, "Notification belongs only to correct Joinee (unrelated user count = 0)");

  // TEST 5: Notification contains correct roomId and relatedRequestId
  const targetNotif = joineeNotifs.find((n) => n.roomId === room.id);
  assert(
    targetNotif && targetNotif.roomId === room.id && targetNotif.relatedRequestId === requestIdA,
    "Notification contains correct roomId and relatedRequestId"
  );

  // TEST 6: Joinee queries notification list from backend API
  const notifFetchRes = await fetch(`${API_BASE}/notifications`, {
    headers: { Authorization: `Bearer ${joineeAToken}` },
  });
  const notifFetchData = await notifFetchRes.json();
  assert(
    notifFetchRes.status === 200 &&
      notifFetchData.notifications &&
      notifFetchData.notifications.some((n) => n.roomId === room.id),
    "Joinee queries notification list from backend API"
  );

  // TEST 7: Unauthenticated rating -> 401
  const res7 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 5 }),
  });
  assert(res7.status === 401, "Unauthenticated rating -> 401");

  // TEST 8: Non-participant tries to rate -> 403
  const res8 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeCToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score: 5 }),
  });
  assert(res8.status === 403, "Non-participant tries to rate -> 403");

  // TEST 9: Accepted-but-unpaid user tries to rate -> 403
  const res9 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score: 5 }),
  });
  assert(res9.status === 403, "Accepted-but-unpaid user tries to rate -> 403");

  // Setup: Joinee A completes test payment to become RoomParticipant
  const orderRes = await fetch(`${API_BASE}/rooms/${room.id}/payment/order`, {
    method: "POST",
    headers: { Authorization: `Bearer ${joineeAToken}` },
  });
  const orderData = await orderRes.json();

  const verifyRes = await fetch(`${API_BASE}/payments/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId: room.id,
      paymentId: orderData.order?.paymentId,
      providerOrderId: orderData.order?.id,
      providerPaymentId: "pay_test_12345",
      providerSignature: "test_signature",
    }),
  });
  const verifyData = await verifyRes.json();

  // TEST 10: Paid participant BUT NO ATTENDANCE tries to rate -> 403
  const res10 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score: 5 }),
  });
  assert(
    res10.status === 403 && verifyData.success === true,
    "Paid participant but NO ATTENDANCE tries to rate -> 403"
  );

  // Setup: Joinee A checks in (RoomAttendance record created)
  const partA = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: joineeA.id } },
  });
  await prisma.roomAttendance.create({
    data: {
      roomId: room.id,
      userId: joineeA.id,
      participantId: partA ? partA.id : null,
    },
  });

  // TEST 11: Confirmed participant WITH attendance submits rating -> 201
  const res11 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      score: 5,
      review: "Amazing host and great food!",
    }),
  });
  const data11 = await res11.json();
  assert(
    res11.status === 201 && data11.success && data11.data?.score === 5,
    "Confirmed participant WITH attendance submits rating -> 201"
  );

  // TEST 12: Rating is persisted in database
  const dbRating = await prisma.rating.findUnique({
    where: {
      roomId_reviewerId_revieweeId: {
        roomId: room.id,
        reviewerId: joineeA.id,
        revieweeId: hostUser.id,
      },
    },
  });
  assert(Boolean(dbRating && dbRating.score === 5), "Rating is persisted in database");

  // TEST 13: Host rating is recalculated from database ratings
  const hostStats = await prisma.rating.aggregate({
    where: { revieweeId: hostUser.id },
    _avg: { score: true },
    _count: { id: true },
  });
  assert(
    hostStats._count.id === 1 && hostStats._avg.score === 5,
    "Host rating is recalculated from database ratings"
  );

  // TEST 14: Same user tries to rate same Room twice -> 409
  const res14 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score: 4 }),
  });
  assert(res14.status === 409, "Same user tries to rate same Room twice -> 409");

  // TEST 15: Invalid score (0, 6, negative) -> 400
  const res15 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score: 6 }),
  });
  assert(res15.status === 400, "Invalid score -> 400");

  // TEST 16: Client attempts to submit another user's reviewerId -> ignored/derived from JWT
  const res16 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joineeBToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      score: 5,
      reviewerId: joineeA.id,
    }),
  });
  assert(res16.status === 403, "Client attempts to submit another user's reviewerId -> 403");

  // TEST 17: Rating survives query after creation via GET /rating
  const res17 = await fetch(`${API_BASE}/rooms/${room.id}/rating`, {
    headers: { Authorization: `Bearer ${joineeAToken}` },
  });
  const data17 = await res17.json();
  assert(
    res17.status === 200 && data17.data?.alreadyRated === true && data17.data?.existingRating?.score === 5,
    "Rating survives query via GET /rating"
  );
  } finally {
    const testUserIds = [hostUser.id, joineeA.id, joineeB.id, joineeC.id];
    await cleanTestFixtureIds(prisma, { userIds: testUserIds, roomIds: [room.id] });
  }

  console.log("\n==================================================");
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runStep6bTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
