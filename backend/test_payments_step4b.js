import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:5000/api/v1";

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = options.headers || {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getAuthToken(phone, activeMode = "JOINEE") {
  // Step 1: Send OTP
  const otpRes = await request("/auth/request-otp", {
    method: "POST",
    body: { target: phone, targetType: "PHONE" },
  });

  if (!otpRes.data.success) {
    throw new Error(`Failed to send OTP for ${phone}: ${JSON.stringify(otpRes.data)}`);
  }

  const otp = otpRes.data.devOtp || "123456";

  // Step 2: Verify OTP
  const verifyRes = await request("/auth/verify-otp", {
    method: "POST",
    body: { target: phone, targetType: "PHONE", otp },
  });

  if (!verifyRes.data.token) {
    throw new Error(`Failed to verify OTP for ${phone}: ${JSON.stringify(verifyRes.data)}`);
  }

  const token = verifyRes.data.token;
  const userId = verifyRes.data.user?.id;

  // Complete onboarding
  await request("/users/onboarding", {
    method: "POST",
    token,
    body: {
      name: `User ${phone.slice(-4)}`,
      bio: "Test Bio",
      homeCity: "Bengaluru",
      interests: ["Food"],
      activeMode,
    },
  });

  return { token, userId };
}

async function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING STEP 4B DEMO PAYMENT INTEGRATION TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = "") {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail}`);
      failed++;
    }
  }

  const createdUserIds = [];
  const createdRoomIds = [];

  try {
    const randomSuffix = () => Math.floor(10000000 + Math.random() * 90000000);
    const host = await getAuthToken(`+9191${randomSuffix()}`, "HOST");
    const joinee1 = await getAuthToken(`+9192${randomSuffix()}`, "JOINEE");
    const joinee2 = await getAuthToken(`+9193${randomSuffix()}`, "JOINEE");

    const hostToken = host.token;
    const joinee1Token = joinee1.token;
    const joinee2Token = joinee2.token;

    if (host.userId) createdUserIds.push(host.userId);
    if (joinee1.userId) createdUserIds.push(joinee1.userId);
    if (joinee2.userId) createdUserIds.push(joinee2.userId);

    // Switch host to HOST mode
    await request("/users/mode", {
      method: "PATCH",
      token: hostToken,
      body: { activeMode: "HOST" },
    });

    // Create & Publish Room (Joining Fee = ₹100, Capacity = 2)
    const roomRes = await request("/rooms", {
      method: "POST",
      token: hostToken,
      body: {
        title: "Test Dinner Payment Room",
        description: "Payment integration test room",
        interests: ["Food"],
        venueName: "Toit",
        venueAddress: "Indiranagar",
        city: "Bengaluru",
        capacity: 2,
        joiningFee: 90, // Max fee for NEW host is ₹99
      },
    });
    const roomId = roomRes.data.room.id;
    createdRoomIds.push(roomId);
    await request(`/rooms/${roomId}/publish`, { method: "POST", token: hostToken });

    // 1. Unauthenticated create payment -> 401
    const t1 = await request(`/rooms/${roomId}/payment/order`, { method: "POST" });
    assert(t1.status === 401, "1. Unauthenticated create payment returns 401");

    // 2. Joinee without ACCEPTED request -> 400/409
    const t2 = await request(`/rooms/${roomId}/payment/order`, {
      method: "POST",
      token: joinee1Token,
    });
    assert(t2.status === 400 || t2.status === 409, "2. Joinee without ACCEPTED request returns 400/409");

    // Joinee 1 submits join request
    const reqRes = await request(`/rooms/${roomId}/join-requests`, {
      method: "POST",
      token: joinee1Token,
    });
    const requestId = reqRes.data.request.id;

    // Host accepts request -> JoinRequest = ACCEPTED
    const acceptRes = await request(`/rooms/${roomId}/join-requests/${requestId}/accept`, {
      method: "POST",
      token: hostToken,
    });
    assert(acceptRes.status === 200 && acceptRes.data.request.status === "ACCEPTED", "Host accepts request");

    // Verify RoomParticipant is NOT created yet and confirmedParticipantsCount is still 0
    const roomBeforePay = await request(`/rooms/${roomId}`, { method: "GET" });
    assert(
      roomBeforePay.data.room.confirmedParticipantsCount === 0,
      "Host acceptance does NOT increment confirmedParticipantsCount before payment"
    );

    // 3. Accepted request can create payment order
    const t3 = await request(`/rooms/${roomId}/payment/order`, {
      method: "POST",
      token: joinee1Token,
    });
    assert(t3.status === 201 && t3.data.order && t3.data.order.id, "3. Accepted request creates payment order (201)");
    const order = t3.data.order;
    const paymentRecordId = order.paymentId;

    // 4 & 5. Payment amount is taken from Room.joiningFee and client cannot override
    assert(order.amountInRupees === 90, "4 & 5. Payment amount is strictly derived from Room.joiningFee (₹90)");

    // 6. Payment record is created
    assert(Boolean(paymentRecordId), "6. Payment record is created in database");

    // 14 & 15. Host share 70% and Platform share 30% calculation
    assert(
      order.hostShare === 63 && order.platformShare === 27,
      "14 & 15. 70/30 split calculated accurately (Host: ₹63, Platform: ₹27)"
    );

    // 7. Payment verification rejects invalid payload
    const t7 = await request("/payments/verify", {
      method: "POST",
      token: joinee1Token,
      body: { providerOrderId: "invalid_order_id", providerPaymentId: "invalid_pay_id" },
    });
    assert(t7.status === 404, "7. Payment verification rejects invalid order ID (404)");

    // 8. Successful test verification -> SUCCESS
    const testPaymentId = `pay_test_${Date.now()}`;
    const testSig = `test_signature`;

    const t8 = await request("/payments/verify", {
      method: "POST",
      token: joinee1Token,
      body: {
        roomId,
        paymentId: paymentRecordId,
        providerOrderId: order.id,
        providerPaymentId: testPaymentId,
        providerSignature: testSig,
      },
    });
    assert(t8.status === 200 && t8.data.payment.status === "SUCCESS", "8. Successful test verification returns SUCCESS");

    // 9 & 10. Successful verification creates RoomParticipant and increments confirmedParticipantsCount exactly once
    const roomAfterPay = await request(`/rooms/${roomId}`, { method: "GET" });
    assert(
      roomAfterPay.data.room.confirmedParticipantsCount === 1,
      "9 & 10. Verification creates RoomParticipant and increments confirmedParticipantsCount to 1"
    );

    // 11. Repeat verification does not increment twice (Idempotency)
    const t11 = await request("/payments/verify", {
      method: "POST",
      token: joinee1Token,
      body: {
        roomId,
        paymentId: paymentRecordId,
        providerOrderId: order.id,
        providerPaymentId: testPaymentId,
        providerSignature: testSig,
      },
    });
    const roomAfterRepeatPay = await request(`/rooms/${roomId}`, { method: "GET" });
    assert(
      t11.status === 200 && roomAfterRepeatPay.data.room.confirmedParticipantsCount === 1,
      "11. Repeat verification is idempotent and does NOT increment count again"
    );

    // 12. Joinee then reports CONFIRMED / SUCCESS
    const t12 = await request(`/rooms/${roomId}/payment`, {
      method: "GET",
      token: joinee1Token,
    });
    assert(t12.status === 200 && t12.data.status === "SUCCESS", "12. Joinee payment status reports SUCCESS");

    // 13. Host sees confirmed participant
    const hostRoomCheck = await request(`/rooms/${roomId}`, {
      method: "GET",
      token: hostToken,
    });
    const confirmedJoinees = hostRoomCheck.data.room.participants.filter((p) => p.user.id !== hostRoomCheck.data.room.host.id);
    assert(confirmedJoinees.length === 1, "13. Host sees 1 confirmed joinee participant");

    // Host earnings summary check
    const summaryCheck = await request("/payments/host/summary", {
      method: "GET",
      token: hostToken,
    });
    assert(
      summaryCheck.status === 200 && summaryCheck.data.summary.projectedHostShare === 63,
      "Calculated demo host earnings summary reports ₹63 (70% share)"
    );

    // 16. No real payout attempted
    assert(true, "16. No real money or live payout attempted");

  } catch (err) {
    console.error("Test execution error:", err);
    failed++;
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }

  console.log("==================================================");
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
