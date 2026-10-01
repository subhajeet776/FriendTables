import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runRoomLifecycleAttendanceTests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 RUNNING ROOM LIFECYCLE & QR ATTENDANCE INTEGRATION TESTS\n");

  const runId = Date.now().toString().slice(-6);

  // Helper to authenticate user
  async function authUser(name, mode = "JOINEE", suffix = "01") {
    const phone = `+91 98${runId}${suffix}`;
    const reqRes = await fetch(`${BASE_URL}/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const reqData = await reqRes.json();
    const devOtp = reqData.devOtp;

    const verifyRes = await fetch(`${BASE_URL}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp: devOtp }),
    });
    const verifyData = await verifyRes.json();
    const token = verifyData.token;
    const userId = verifyData.user.id;

    await fetch(`${BASE_URL}/users/onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        bio: `${name}'s bio`,
        avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
        homeCity: "Bengaluru",
        interests: ["Food", "Tech"],
        activeMode: mode,
      }),
    });

    return { userId, token, phone };
  }

  let testPassedCount = 0;
  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    testPassedCount++;
    console.log(`✅ PASSED: ${message}`);
  }

  const createdUserIds = [];
  const createdRoomIds = [];

  try {
    // 1. Setup Host & Joinee
    console.log("--- Setting up users ---");
    const host = await authUser("Lifecycle Host", "HOST", "01");
    const joinee = await authUser("Lifecycle Joinee", "JOINEE", "02");
    if (host.userId) createdUserIds.push(host.userId);
    if (joinee.userId) createdUserIds.push(joinee.userId);

    // 2. Host creates and publishes a room
    console.log("\n--- Creating room ---");
    const createRoomRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      },
      body: JSON.stringify({
        title: `Lifecycle Test Room ${runId}`,
        description: "Testing room lifecycle after QR attendance",
        venueName: "Pasta Bistro",
        venueAddress: "Indiranagar 100ft Rd",
        city: "Bengaluru",
        date: "Tomorrow",
        time: "8:00 PM - 9:30 PM",
        capacity: 4,
        joiningFee: 50,
      }),
    });
    const createRoomData = await createRoomRes.json();
    if (!createRoomData.success) {
      console.error("Room creation error response:", createRoomData);
    }
    assert(createRoomData.success, "Room created successfully");
    const roomId = createRoomData.room.id;
    if (roomId) createdRoomIds.push(roomId);

    // Publish room
    const publishRes = await fetch(`${BASE_URL}/rooms/${roomId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const publishData = await publishRes.json();
    assert(publishData.success && publishData.room.status === "PUBLISHED", "Room published");

    // 3. Joinee requests to join room & Host accepts & Joinee pays
    console.log("\n--- Joinee requesting & confirming ---");
    const joinReqRes = await fetch(`${BASE_URL}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee.token}` },
    });
    const joinReqData = await joinReqRes.json();
    assert(joinReqData.success && Boolean(joinReqData.request), "Join request created");
    const requestId = joinReqData.request.id;

    const acceptRes = await fetch(`${BASE_URL}/rooms/${roomId}/join-requests/${requestId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    assert((await acceptRes.json()).success, "Host accepted join request");

    // Create payment order
    const orderRes = await fetch(`${BASE_URL}/rooms/${roomId}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee.token}` },
    });
    const orderData = await orderRes.json();
    assert(orderData.success && Boolean(orderData.order), "Payment order created");

    // Verify payment
    const payRes = await fetch(`${BASE_URL}/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee.token}`,
      },
      body: JSON.stringify({
        roomId,
        paymentId: orderData.order.paymentId,
        providerOrderId: orderData.order.id,
        providerPaymentId: `pay_test_${runId}`,
        providerSignature: "test_sig",
      }),
    });
    assert((await payRes.json()).success, "Joinee paid and confirmed");

    // 4. TEST 1: Upcoming room before attendance
    console.log("\n--- TEST 1: Checking status BEFORE attendance ---");
    const hostRoomsBefore = await (await fetch(`${BASE_URL}/rooms/my-rooms`, {
      headers: { Authorization: `Bearer ${host.token}` },
    })).json();
    
    const hostRoom = hostRoomsBefore.rooms.find((r) => r.id === roomId);
    assert(hostRoom !== undefined, "Host room exists in GET /my-rooms");
    assert(!hostRoom.hasAttendance, "Host room has no attendance before check-in");
    
    // Frontend host filter logic check
    const isHostUpcomingBefore = (hostRoom.status === "UPCOMING" || hostRoom.status === "PUBLISHED" || hostRoom.status === "CHECK_IN_OPEN") && !hostRoom.hasAttendance && hostRoom.status !== "COMPLETED";
    const isHostPastBefore = hostRoom.status === "COMPLETED" || Boolean(hostRoom.hasAttendance);
    assert(isHostUpcomingBefore, "TEST 1 PASS: Host room classified as Upcoming before attendance");
    assert(!isHostPastBefore, "TEST 1 PASS: Host room NOT classified as Past before attendance");

    const joineeReqsBefore = await (await fetch(`${BASE_URL}/rooms/user/requests`, {
      headers: { Authorization: `Bearer ${joinee.token}` },
    })).json();
    const joineeReq = joineeReqsBefore.requests.find((r) => r.roomId === roomId);
    assert(joineeReq !== undefined, "Joinee request exists in GET /user/requests");
    assert(!joineeReq.hasAttended && !joineeReq.isCompleted, "Joinee not attended/completed before check-in");

    // Frontend joinee filter logic check
    const isJoineeUpcomingBefore = (joineeReq.status === "ACCEPTED" || joineeReq.status === "CONFIRMED") && !joineeReq.isCompleted && !joineeReq.hasAttended;
    const isJoineeCompletedBefore = Boolean(joineeReq.isCompleted || joineeReq.hasAttended || (joineeReq.status === "CONFIRMED" && joineeReq.roomStatus === "COMPLETED"));
    assert(isJoineeUpcomingBefore, "TEST 1 PASS: Joinee room classified as Upcoming before attendance");
    assert(!isJoineeCompletedBefore, "TEST 1 PASS: Joinee room NOT classified as Completed before attendance");

    // 5. TEST 4 (Part 1): Open check-in QR session -> room status becomes CHECK_IN_OPEN, room must NOT disappear
    console.log("\n--- TEST 4 (Part 1): Opening Check-In QR Session ---");
    const sessionRes = await fetch(`${BASE_URL}/rooms/${roomId}/check-in/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const sessionData = await sessionRes.json();
    assert(sessionData.success, "Host created check-in session");

    const hostRoomsAfterSession = await (await fetch(`${BASE_URL}/rooms/my-rooms`, {
      headers: { Authorization: `Bearer ${host.token}` },
    })).json();
    const hostRoomAfterSession = hostRoomsAfterSession.rooms.find((r) => r.id === roomId);
    assert(hostRoomAfterSession !== undefined, "Host room still exists in GET /my-rooms after QR session open");
    const isHostUpcomingInSession = (hostRoomAfterSession.status === "UPCOMING" || hostRoomAfterSession.status === "PUBLISHED" || hostRoomAfterSession.status === "CHECK_IN_OPEN") && !hostRoomAfterSession.hasAttendance && hostRoomAfterSession.status !== "COMPLETED";
    assert(isHostUpcomingInSession, "TEST 4 PASS: Host room stays in Upcoming during CHECK_IN_OPEN, does NOT disappear!");

    // 6. TEST 2 & 3: Joinee checks in -> room moves to Joinee Completed & Host Completed
    console.log("\n--- TEST 2 & 3: Joinee checking in via QR ---");
    const verifyRes = await fetch(`${BASE_URL}/rooms/${roomId}/check-in/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee.token}`,
      },
      body: JSON.stringify({ qrToken: sessionData.data.qrPayload }),
    });
    const verifyData = await verifyRes.json();
    assert(verifyData.success, "Joinee QR check-in successful");

    // Check Joinee GET /user/requests after attendance
    const joineeReqsAfter = await (await fetch(`${BASE_URL}/rooms/user/requests`, {
      headers: { Authorization: `Bearer ${joinee.token}` },
    })).json();
    const joineeReqAfter = joineeReqsAfter.requests.find((r) => r.roomId === roomId);
    assert(joineeReqAfter.hasAttended === true, "Joinee hasAttended is true");
    assert(joineeReqAfter.isCompleted === false, "Joinee isCompleted is false while room is ongoing");
    const isJoineeUpcomingAfter = (joineeReqAfter.status === "ACCEPTED" || joineeReqAfter.status === "CONFIRMED") && !joineeReqAfter.isCompleted && !joineeReqAfter.isClosed;
    const isJoineeCompletedAfter = Boolean(joineeReqAfter.isCompleted || (joineeReqAfter.status === "CONFIRMED" && joineeReqAfter.roomStatus === "COMPLETED") || (joineeReqAfter.status === "CONFIRMED" && joineeReqAfter.isClosed));
    assert(isJoineeUpcomingAfter, "TEST 2 PASS: Joinee room stays in Upcoming during ongoing dinner");
    assert(!isJoineeCompletedAfter, "TEST 2 PASS: Joinee room NOT moved into Completed before closing time");

    // Check Host GET /my-rooms after attendance
    const hostRoomsAfter = await (await fetch(`${BASE_URL}/rooms/my-rooms`, {
      headers: { Authorization: `Bearer ${host.token}` },
    })).json();
    const hostRoomAfter = hostRoomsAfter.rooms.find((r) => r.id === roomId);
    assert(hostRoomAfter !== undefined, "TEST 4 PASS: Host room still exists in GET /my-rooms after attendance");
    assert(hostRoomAfter.hasAttendance === true, "Host room hasAttendance is true");
    assert(hostRoomAfter.status !== "COMPLETED", "Host room status is NOT COMPLETED (remains active CHECK_IN_OPEN)");
    const isCompletedRoom = (hostRoomAfter.status === "COMPLETED" || Boolean(hostRoomAfter.isClosed));
    const isHostUpcomingAfter = (hostRoomAfter.status === "UPCOMING" || hostRoomAfter.status === "PUBLISHED" || hostRoomAfter.status === "CHECK_IN_OPEN") && !isCompletedRoom && !hostRoomAfter.isClosed;
    const isHostPastAfter = isCompletedRoom;
    assert(isHostUpcomingAfter, "TEST 3 PASS: Host room stays in Upcoming during ongoing dinner");
    assert(!isHostPastAfter, "TEST 3 PASS: Host room NOT moved into Past before closing time");

    // Test closeCheckInStatus endpoint: attendance does NOT make status COMPLETED
    console.log("\n--- TEST 4b: Host closes check-in window while dinner is active ---");
    const closeCheckInRes = await fetch(`${BASE_URL}/rooms/${roomId}/check-in/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const closeCheckInData = await closeCheckInRes.json();
    assert(closeCheckInData.success, "Host closed check-in successfully");
    assert(closeCheckInData.data.status === "PUBLISHED", "Active room status becomes PUBLISHED, NOT COMPLETED");

    const hostRoomsAfterClose = await (await fetch(`${BASE_URL}/rooms/my-rooms`, {
      headers: { Authorization: `Bearer ${host.token}` },
    })).json();
    const hostRoomAfterClose = hostRoomsAfterClose.rooms.find((r) => r.id === roomId);
    assert(hostRoomAfterClose.status !== "COMPLETED", "Host room status remains active (PUBLISHED) after closing check-in window");
    assert(!hostRoomAfterClose.isClosed, "Host room isClosed remains false");

    // 7. TEST 5: Rating route still works after completion
    console.log("\n--- TEST 5: Checking rating route after completion ---");
    const ratingResJoinee = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      headers: { Authorization: `Bearer ${joinee.token}` },
    });
    const ratingDataJoinee = await ratingResJoinee.json();
    assert(ratingDataJoinee.success && ratingDataJoinee.data.eligible === true, "TEST 5 PASS: Joinee is eligible to rate Host after completion");

    const ratingResHost = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const ratingDataHost = await ratingResHost.json();
    assert(ratingDataHost.success && ratingDataHost.data.eligible === true, "TEST 5 PASS: Host is eligible to rate Joinee after completion");

    // 8. TEST 6: Loyalty attendance count still works
    console.log("\n--- TEST 6: Checking loyalty attendance count ---");
    const loyaltyRes = await fetch(`${BASE_URL}/users/me/loyalty`, {
      headers: { Authorization: `Bearer ${joinee.token}` },
    });
    const loyaltyData = await loyaltyRes.json();
    assert(loyaltyData.success && loyaltyData.data.totalAttendedDines === 1, "TEST 6 PASS: Loyalty count accurately reflects 1 attended dine");

    console.log(`\n🎉 ALL ${testPassedCount} CHECKS PASSED SUCCESSFULLY!`);
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runRoomLifecycleAttendanceTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
