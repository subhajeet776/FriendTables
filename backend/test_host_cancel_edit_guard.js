import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runHostCancelEditGuardTests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 RUNNING ISSUE #2: HOST CANCEL & SCHEDULE EDIT ATTENDANCE GUARD TESTS\n");

  const runId = Date.now().toString().slice(-6);

  async function authUser(name, mode = "JOINEE", suffix = "01") {
    const phone = `+91 97${runId}${suffix}`;
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
        interests: ["Food"],
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
    console.log("--- Setting up Host & Joinee ---");
    const host = await authUser("Guard Host", "HOST", "11");
    const joinee = await authUser("Guard Joinee", "JOINEE", "12");
    if (host.userId) createdUserIds.push(host.userId);
    if (joinee.userId) createdUserIds.push(joinee.userId);

    // =========================================================================
    // CASE 1: PRE-ATTENDANCE OPERATIONS (MUST BE ALLOWED)
    // =========================================================================
    console.log("\n--- TEST CASE 1: Pre-attendance schedule edit & cancel ---");

    // Create Room A for testing pre-attendance edit & cancel
    const createRoomARes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      },
      body: JSON.stringify({
        title: `Pre-Attendance Room A ${runId}`,
        description: "Testing pre-attendance edit & cancel",
        venueName: "Pasta Bistro",
        venueAddress: "Indiranagar 100ft Rd",
        city: "Bengaluru",
        date: "Tomorrow",
        time: "7:30 PM - 9:00 PM",
        capacity: 4,
        joiningFee: 0,
      }),
    });
    const roomAData = await createRoomARes.json();
    assert(roomAData.success, "Room A created successfully");
    const roomAId = roomAData.room.id;
    if (roomAId) createdRoomIds.push(roomAId);

    // Publish Room A
    const publishARes = await fetch(`${BASE_URL}/rooms/${roomAId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const publishAData = await publishARes.json();
    assert(publishAData.success, "Room A published successfully");

    // 1a. Schedule edit BEFORE attendance -> ALLOWED
    console.log("Testing schedule edit before attendance...");
    const editBeforeRes = await fetch(`${BASE_URL}/rooms/${roomAId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      },
      body: JSON.stringify({
        time: "8:00 PM - 9:30 PM",
      }),
    });
    const editBeforeData = await editBeforeRes.json();
    assert(editBeforeRes.status === 200 && editBeforeData.success, "Schedule edit before attendance is ALLOWED (HTTP 200)");
    assert(editBeforeData.room.time === "8:00 PM - 9:30 PM", "Room time updated to 8:00 PM - 9:30 PM");

    // 1b. Cancel BEFORE attendance -> ALLOWED
    console.log("Testing cancellation before attendance...");
    const cancelBeforeRes = await fetch(`${BASE_URL}/rooms/${roomAId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const cancelBeforeData = await cancelBeforeRes.json();
    assert(cancelBeforeRes.status === 200 && cancelBeforeData.success, "Cancellation before attendance is ALLOWED (HTTP 200)");

    const roomACheck = await prisma.room.findUnique({ where: { id: roomAId } });
    assert(roomACheck.status === "CANCELLED", "Room A status successfully set to CANCELLED");

    // =========================================================================
    // CASE 2: POST-ATTENDANCE OPERATIONS (MUST BE REJECTED)
    // =========================================================================
    console.log("\n--- TEST CASE 2: Post-attendance schedule edit & cancel ---");

    // Create Room B for post-attendance testing
    const createRoomBRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      },
      body: JSON.stringify({
        title: `Post-Attendance Room B ${runId}`,
        description: "Testing post-attendance guard",
        venueName: "Truffles",
        venueAddress: "Koramangala 5th Block",
        city: "Bengaluru",
        date: "Tomorrow",
        time: "7:30 PM - 9:00 PM",
        capacity: 4,
        joiningFee: 0,
      }),
    });
    const roomBData = await createRoomBRes.json();
    assert(roomBData.success, "Room B created successfully");
    const roomBId = roomBData.room.id;
    if (roomBId) createdRoomIds.push(roomBId);

    // Publish Room B
    await fetch(`${BASE_URL}/rooms/${roomBId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });

    // Joinee requests to join Room B
    const joinReqRes = await fetch(`${BASE_URL}/rooms/${roomBId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee.token}` },
    });
    const joinReqData = await joinReqRes.json();
    assert(joinReqData.success && Boolean(joinReqData.request), "Joinee sent join request for Room B");
    const joinRequestId = joinReqData.request.id;

    // Host accepts Joinee
    const acceptRes = await fetch(`${BASE_URL}/rooms/${roomBId}/join-requests/${joinRequestId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    assert((await acceptRes.json()).success, "Host accepted join request");

    // Directly confirm participant for Room B
    await prisma.roomParticipant.create({
      data: {
        roomId: roomBId,
        userId: joinee.userId,
      },
    });

    // Host opens check-in session for Room B
    const sessionRes = await fetch(`${BASE_URL}/rooms/${roomBId}/check-in/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const sessionData = await sessionRes.json();
    assert(sessionData.success, "Host created QR check-in session for Room B");

    // Joinee checks in via QR token
    const verifyRes = await fetch(`${BASE_URL}/rooms/${roomBId}/check-in/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee.token}`,
      },
      body: JSON.stringify({ qrToken: sessionData.data.qrPayload }),
    });
    const verifyData = await verifyRes.json();
    assert(verifyData.success, "Joinee QR check-in recorded successfully");

    // Confirm attendance row exists in DB
    const attendanceCount = await prisma.roomAttendance.count({ where: { roomId: roomBId } });
    assert(attendanceCount === 1, "RoomAttendance row confirmed in database (count = 1)");

    // 2a. Schedule edit AFTER attendance -> MUST BE REJECTED
    console.log("\nTesting schedule edit after attendance...");
    const editAfterRes = await fetch(`${BASE_URL}/rooms/${roomBId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      },
      body: JSON.stringify({
        time: "9:00 PM - 10:30 PM",
      }),
    });
    const editAfterData = await editAfterRes.json();
    assert(editAfterRes.status === 400, "Schedule edit after attendance REJECTED with HTTP 400");
    assert(
      editAfterData.message?.includes("Cannot edit room schedule after participants have already checked in"),
      `Accurate error message returned: "${editAfterData.message}"`
    );

    // Verify room schedule was NOT modified in DB
    const roomBAfterEditAttempt = await prisma.room.findUnique({ where: { id: roomBId } });
    assert(roomBAfterEditAttempt.time === "7:30 PM - 9:00 PM", "Room B time preserved as original 7:30 PM - 9:00 PM");

    // 2b. Cancel AFTER attendance -> MUST BE REJECTED
    console.log("\nTesting cancellation after attendance...");
    const cancelAfterRes = await fetch(`${BASE_URL}/rooms/${roomBId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    const cancelAfterData = await cancelAfterRes.json();
    assert(cancelAfterRes.status === 400, "Cancellation after attendance REJECTED with HTTP 400");
    assert(
      cancelAfterData.message?.includes("Cannot cancel dinner room after participants have already checked in"),
      `Accurate error message returned: "${cancelAfterData.message}"`
    );

    // Verify room status was NOT changed to CANCELLED in DB
    const roomBAfterCancelAttempt = await prisma.room.findUnique({ where: { id: roomBId } });
    assert(roomBAfterCancelAttempt.status !== "CANCELLED", "Room B status preserved (NOT cancelled)");
    assert(roomBAfterCancelAttempt.status === "CHECK_IN_OPEN", "Room B status remains CHECK_IN_OPEN");

    console.log(`\n🎉 ALL ${testPassedCount} ISSUE #2 TESTS PASSED!`);
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runHostCancelEditGuardTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
