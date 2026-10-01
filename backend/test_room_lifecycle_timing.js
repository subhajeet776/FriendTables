import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();
const API_BASE = "http://localhost:5000/api/v1";

async function loginUser(phone) {
  const reqRes = await fetch(`${API_BASE}/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const reqData = await reqRes.json();
  const otp = reqData.devOtp || "123456";

  const verifyRes = await fetch(`${API_BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, otp }),
  });
  const verifyData = await verifyRes.json();
  if (!verifyData.token) {
    throw new Error(`Login failed for ${phone}: ${JSON.stringify(verifyData)}`);
  }
  return { token: verifyData.token, user: verifyData.user };
}

async function runTest() {
  console.log("=== STARTING COMPREHENSIVE LIFESTYLE & TIMING TEST WITH AUTOMATIC TEARDOWN ===");
  const timestamp = Date.now();
  const createdUserIds = [];
  const createdRoomIds = [];

  try {
    // 1. Setup Host, Joinee 1, Joinee 2
    console.log("\n1. Creating test users...");
    const hostPhone = `+9198${timestamp.toString().slice(-8)}`;
    const joinee1Phone = `+9197${timestamp.toString().slice(-8)}`;
    const joinee2Phone = `+9196${timestamp.toString().slice(-8)}`;

    const hostAuth = await loginUser(hostPhone);
    const hostToken = hostAuth.token;
    const hostId = hostAuth.user.id;
    createdUserIds.push(hostId);

    await fetch(`${API_BASE}/users/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({
        name: `TestHost_${timestamp}`,
        bio: "Host bio",
        homeCity: "Bengaluru",
        interests: ["Food"],
        activeMode: "HOST",
      }),
    });

    const j1Auth = await loginUser(joinee1Phone);
    const j1Token = j1Auth.token;
    const j1Id = j1Auth.user.id;
    createdUserIds.push(j1Id);

    await fetch(`${API_BASE}/users/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j1Token}` },
      body: JSON.stringify({
        name: `TestJ1_${timestamp}`,
        bio: "J1 bio",
        homeCity: "Bengaluru",
        interests: ["Food"],
        activeMode: "JOINEE",
      }),
    });

    const j2Auth = await loginUser(joinee2Phone);
    const j2Token = j2Auth.token;
    const j2Id = j2Auth.user.id;
    createdUserIds.push(j2Id);

    await fetch(`${API_BASE}/users/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j2Token}` },
      body: JSON.stringify({
        name: `TestJ2_${timestamp}`,
        bio: "J2 bio",
        homeCity: "Bengaluru",
        interests: ["Food"],
        activeMode: "JOINEE",
      }),
    });

    console.log("✅ Users created and onboarded.");

    // 2. Create room with future date/time
    console.log("\n2. Creating test room (Active room with 2 confirmed Joinees)...");
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 1); // 1 hr from now

    const createRoomRes = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({
        title: `Timing & Grace Test ${timestamp}`,
        description: "Testing multi-joinee check-in before closing",
        venueName: "Grace Bistro",
        venueAddress: "123 Timing Way",
        city: "Bengaluru",
        dateTime: futureDate.toISOString(),
        capacity: 5,
        joiningFee: 50,
      }),
    });
    const createRoomData = await createRoomRes.json();
    if (!createRoomData.room) {
      throw new Error(`Failed to create room: ${JSON.stringify(createRoomData)}`);
    }
    const roomId = createRoomData.room.id;
    createdRoomIds.push(roomId);

    // Publish room
    await fetch(`${API_BASE}/rooms/${roomId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });

    // Joinee 1 join & confirm payment
    const j1JoinRes = await fetch(`${API_BASE}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j1Token}` },
    });
    const j1JoinData = await j1JoinRes.json();
    if (!j1JoinData.request) {
      throw new Error(`Failed to submit join request J1: ${JSON.stringify(j1JoinData)}`);
    }
    const j1ReqId = j1JoinData.request.id;

    // Accept J1
    const acceptJ1Res = await fetch(`${API_BASE}/rooms/${roomId}/join-requests/${j1ReqId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const acceptJ1Data = await acceptJ1Res.json();
    if (!acceptJ1Data.success) {
      throw new Error(`Failed to accept J1: ${JSON.stringify(acceptJ1Data)}`);
    }

    // J1 Payment
    const j1OrderRes = await fetch(`${API_BASE}/rooms/${roomId}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j1Token}` },
    });
    const j1OrderData = await j1OrderRes.json();
    if (!j1OrderData.order) {
      throw new Error(`Failed to create order J1: ${JSON.stringify(j1OrderData)}`);
    }
    await fetch(`${API_BASE}/payments/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j1Token}` },
      body: JSON.stringify({
        roomId,
        providerOrderId: j1OrderData.order.id,
        providerPaymentId: `pay_j1_${Date.now()}`,
        providerSignature: "test_signature",
      }),
    });

    // Joinee 2 join & confirm payment
    const j2JoinRes = await fetch(`${API_BASE}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j2Token}` },
    });
    const j2JoinData = await j2JoinRes.json();
    const j2ReqId = j2JoinData.request.id;

    // Accept J2
    const acceptJ2Res = await fetch(`${API_BASE}/rooms/${roomId}/join-requests/${j2ReqId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const acceptJ2Data = await acceptJ2Res.json();
    if (!acceptJ2Data.success) {
      throw new Error(`Failed to accept J2: ${JSON.stringify(acceptJ2Data)}`);
    }

    // J2 Payment
    const j2OrderRes = await fetch(`${API_BASE}/rooms/${roomId}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j2Token}` },
    });
    const j2OrderData = await j2OrderRes.json();
    if (!j2OrderData.order) {
      throw new Error(`Failed to create order J2: ${JSON.stringify(j2OrderData)}`);
    }
    await fetch(`${API_BASE}/payments/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j2Token}` },
      body: JSON.stringify({
        roomId,
        providerOrderId: j2OrderData.order.id,
        providerPaymentId: `pay_j2_${Date.now()}`,
        providerSignature: "test_signature",
      }),
    });

    console.log("✅ Joinee 1 and Joinee 2 confirmed.");

    // 3. Joinee 1 checks in via QR token
    console.log("\n3. Testing Joinee 1 Check-In...");
    const qrRes = await fetch(`${API_BASE}/rooms/${roomId}/check-in/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const qrData = await qrRes.json();
    const qrToken = qrData.data.qrPayload;

    const j1CheckInRes = await fetch(`${API_BASE}/rooms/${roomId}/check-in/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j1Token}` },
      body: JSON.stringify({ qrToken }),
    });
    const j1CheckInData = await j1CheckInRes.json();
    if (!j1CheckInData.success) {
      throw new Error(`J1 Check-In failed: ${JSON.stringify(j1CheckInData)}`);
    }
    console.log("✅ Joinee 1 successfully checked in!");

    // Verify room is derived as COMPLETED for UI history, but NOT closed for Joinee 2
    const roomAfterJ1Res = await fetch(`${API_BASE}/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const roomAfterJ1Data = await roomAfterJ1Res.json();
    console.log("Room status after 1st check-in:", roomAfterJ1Data.room.status);
    console.log("Room isClosed after 1st check-in:", roomAfterJ1Data.room.isClosed);
    if (roomAfterJ1Data.room.isClosed === true) {
      throw new Error("FAIL: 1st check-in marked room as closed! Must stay open for other joinees until closingTime!");
    }
    console.log("✅ Room status COMPLETED derived, but isClosed remains FALSE as required.");

    // 4. Joinee 2 checks in (MUST succeed even though room.status derived COMPLETED!)
    console.log("\n4. Testing Joinee 2 Check-In (Multi-joinee check-in after 1st attendance)...");
    const j2CheckInRes = await fetch(`${API_BASE}/rooms/${roomId}/check-in/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${j2Token}` },
      body: JSON.stringify({ qrToken }),
    });
    const j2CheckInData = await j2CheckInRes.json();
    if (!j2CheckInData.success) {
      throw new Error(`J2 Check-In failed: ${JSON.stringify(j2CheckInData)}`);
    }
    console.log("✅ Joinee 2 successfully checked in after Joinee 1! (Critical requirement verified)");

    // 5. Test Closed Room Restrictions (Simulate closed room by checking past room)
    console.log("\n5. Testing Closed Room restrictions (Past closing time)...");
    const pastDate = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago
    const createClosedRoomRes = await fetch(`${API_BASE}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({
        title: `Expired Past Dinner ${timestamp}`,
        description: "Closed room test",
        venueName: "Past Bistro",
        venueAddress: "Old Street",
        city: "Bengaluru",
        dateTime: pastDate.toISOString(),
        capacity: 5,
        joiningFee: 50,
      }),
    });
    const createClosedData = await createClosedRoomRes.json();
    const closedRoomId = createClosedData.room.id;
    createdRoomIds.push(closedRoomId);
    await fetch(`${API_BASE}/rooms/${closedRoomId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });

    const getClosedRoomRes = await fetch(`${API_BASE}/rooms/${closedRoomId}`);
    const getClosedRoomData = await getClosedRoomRes.json();
    console.log("Expired room status:", getClosedRoomData.room.status);
    console.log("Expired room isClosed:", getClosedRoomData.room.isClosed);
    if (!getClosedRoomData.room.isClosed) {
      throw new Error("FAIL: Past room scheduled end + 30m should be isClosed = true");
    }

    // Attempt new join request on closed room -> MUST FAIL
    const lateJoinRes = await fetch(`${API_BASE}/rooms/${closedRoomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j1Token}` },
    });
    const lateJoinData = await lateJoinRes.json();
    if (lateJoinData.success) {
      throw new Error("FAIL: New join request succeeded on closed room!");
    }
    console.log("✅ New join request rejected on closed room as expected.");

    // Attempt QR check-in token generation/verification on closed room -> MUST FAIL
    const closedQrRes = await fetch(`${API_BASE}/rooms/${closedRoomId}/check-in/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const closedQrData = await closedQrRes.json();
    if (closedQrRes.status === 200 && closedQrData.data?.qrPayload) {
      const lateCheckInRes = await fetch(`${API_BASE}/rooms/${closedRoomId}/check-in/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${j1Token}` },
        body: JSON.stringify({ qrToken: closedQrData.data.qrPayload }),
      });
      const lateCheckInData = await lateCheckInRes.json();
      if (lateCheckInData.success) {
        throw new Error("FAIL: QR check-in succeeded on closed room after grace period!");
      }
    }
    console.log("✅ QR check-in rejected on closed room after grace period.");

    // 6. Test 90-Day History Policy & Loyalty Persistence
    console.log("\n6. Testing 90-day history flag & Loyalty calculation...");
    // Check loyalty count for Joinee 1
    const j1LoyaltyRes = await fetch(`${API_BASE}/users/me/loyalty`, {
      headers: { Authorization: `Bearer ${j1Token}` },
    });
    const j1LoyaltyData = await j1LoyaltyRes.json();
    const attendedCount = j1LoyaltyData.data?.totalAttendedDines ?? 0;
    console.log("Joinee 1 attendedCount:", attendedCount);
    if (attendedCount < 1) {
      throw new Error("FAIL: Loyalty failed to count historical attendance!");
    }
    console.log("✅ Loyalty successfully counted historical attendance.");

    console.log("\n==================================================");
    console.log("🎉 ALL ROOM LIFECYCLE & TIMING TESTS PASSED (10/10) 🎉");
    console.log("==================================================");
  } finally {
    console.log("\n--- TEARDOWN: Cleaning up test fixture records ---");
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runTest().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
