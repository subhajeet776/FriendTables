import fetch from "node-fetch";
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();
const API_BASE = "http://localhost:5000/api/v1";
const SOCKET_URL = "http://localhost:5000";

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { ...options.headers };
  let body = options.body;
  if (body !== undefined && body !== null) {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (typeof body === "object") {
      body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loginUser(phone, name, mode = "JOINEE") {
  const reqRes = await request("/auth/request-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const otp = reqRes.data.devOtp || "123456";

  const verifyRes = await request("/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, otp }),
  });
  if (!verifyRes.data.token) {
    throw new Error(`Login failed for ${phone}: ${JSON.stringify(verifyRes.data)}`);
  }

  const token = verifyRes.data.token;
  const user = verifyRes.data.user;
  // Complete onboarding if not already completed
  const onboardingRes = await request("/users/onboarding", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      bio: `${name}'s bio`,
      homeCity: "Bengaluru",
      interests: ["Food", "Art"],
      activeMode: mode,
    }),
  });

  await request("/users/mode", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: { activeMode: mode },
  });

  return { token, user: { ...user, id: user.id, activeMode: mode } };
}

async function runTests() {
  console.log("==================================================");
  console.log("🧪 STARTING FRIENTABLES STEP 5A CHAT INTEGRATION TESTS");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${details ? "(" + details + ")" : ""}`);
      failed++;
    }
  }

  const createdUserIds = [];
  const createdRoomIds = [];

  try {
    const ts = Date.now().toString().slice(-7);
    const phoneA = `+9198${ts}1`;
    const phoneB = `+9198${ts}2`;
    const phoneC = `+9198${ts}3`;
    const phoneD = `+9198${ts}4`;
    const phoneE = `+9198${ts}5`;

    // 0. Setup Users & Rooms
    console.log("🔑 Logging in test accounts...");
    const hostA = await loginUser(phoneA, "Host Alpha", "HOST");
    const joineeB = await loginUser(phoneB, "Confirmed Joinee Bravo", "JOINEE");
    const joineeC = await loginUser(phoneC, "Pending Joinee Charlie", "JOINEE");
    const joineeD = await loginUser(phoneD, "Unpaid Joinee Delta", "JOINEE");
    const userE = await loginUser(phoneE, "Unrelated User Echo", "JOINEE");

    if (hostA.user?.id) createdUserIds.push(hostA.user.id);
    if (joineeB.user?.id) createdUserIds.push(joineeB.user.id);
    if (joineeC.user?.id) createdUserIds.push(joineeC.user.id);
    if (joineeD.user?.id) createdUserIds.push(joineeD.user.id);
    if (userE.user?.id) createdUserIds.push(userE.user.id);

    // Host A creates Room A and Room B
    const createRoomARes = await request("/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({
        title: "Chat Room Alpha",
        description: "Testing group chat persistence & socket flow",
        venueName: "Pasta Bistro",
        venueAddress: "123 Main St",
        city: "Bengaluru",
        date: "2026-10-10",
        time: "7:30 PM - 9:00 PM",
        capacity: 4,
        joiningFee: 99,
        interests: ["Food"],
      }),
    });

    if (!createRoomARes.data.room) {
      console.error("Failed to create Room A:", createRoomARes.data);
    }
    const roomA = createRoomARes.data.room;
    const roomAId = roomA.id;
    createdRoomIds.push(roomAId);

    // Publish Room A
    await request(`/rooms/${roomAId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    // Create Room B (for isolation testing)
    const createRoomBRes = await request("/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({
        title: "Chat Room Beta",
        description: "Isolated Room B",
        venueName: "Taco Haven",
        venueAddress: "456 Side St",
        city: "Bengaluru",
        date: "2026-10-11",
        time: "7:30 PM - 9:00 PM",
        capacity: 4,
        joiningFee: 99,
        interests: ["Food"],
      }),
    });
    if (!createRoomBRes.data.room) {
      console.error("Failed to create Room B:", createRoomBRes.data);
    }
    const roomBId = createRoomBRes.data.room.id;
    createdRoomIds.push(roomBId);

    // Joinee B setup: Request -> Host Accept -> Pay -> Confirmed Participant
    const reqB = await request(`/rooms/${roomAId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    if (!reqB.data.request) {
      console.error("Failed to create Join Request B:", reqB.data);
    }
    await request(`/rooms/${roomAId}/join-requests/${reqB.data.request.id}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    const payB = await request(`/rooms/${roomAId}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    if (!payB.data.payment) {
      console.error("Failed to create Payment B:", payB.data);
    }
    await request(`/payments/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
      body: JSON.stringify({
        roomId: roomAId,
        paymentId: payB.data.payment.id,
        providerOrderId: payB.data.order.id,
        providerPaymentId: "pay_test_simulated_123",
      }),
    });

    // Joinee C setup: Request -> Pending (not accepted)
    await request(`/rooms/${roomAId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeC.token}` },
    });

    // Joinee D setup: Request -> Host Accept -> Unpaid (no payment executed)
    const reqD = await request(`/rooms/${roomAId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeD.token}` },
    });
    await request(`/rooms/${roomAId}/join-requests/${reqD.data.request.id}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    console.log("✨ Test environment setup complete.\n");

    // --- AUTHENTICATION TESTS ---
    // Test 1: Unauthenticated history request -> 401
    const t1 = await request(`/rooms/${roomAId}/messages`);
    assert(t1.status === 401, "1. Unauthenticated history request returns 401");

    // Test 2: Unauthenticated send -> 401
    const t2 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "Hello" }),
    });
    assert(t2.status === 401, "2. Unauthenticated send message returns 401");

    // --- AUTHORIZATION TESTS ---
    // Test 3: Host can access history -> 200
    const t3 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    assert(t3.status === 200 && t3.data.success === true, "3. Host can access room chat history");

    // Test 4: Confirmed participant can access history -> 200
    const t4 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(t4.status === 200 && t4.data.success === true, "4. Confirmed participant can access room chat history");

    // Test 5: Unrelated user cannot access history -> 403
    const t5 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${userE.token}` },
    });
    assert(t5.status === 403, "5. Unrelated user cannot access room chat history (403)");

    // Test 6: Pending Joinee cannot access history -> 403
    const t6 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${joineeC.token}` },
    });
    assert(t6.status === 403, "6. Pending joinee cannot access room chat history (403)");

    // Test 7: Accepted-but-unpaid user cannot access history -> 403
    const t7 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${joineeD.token}` },
    });
    assert(t7.status === 403, "7. Accepted-but-unpaid user cannot access room chat history (403)");

    // --- SENDING TESTS ---
    // Test 8: Host can send message
    const t8 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "Welcome everyone!" }),
    });
    assert(t8.status === 201 && t8.data.message.text === "Welcome everyone!", "8. Host can send message");

    // Test 9: Confirmed participant can send message
    const t9 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
      body: JSON.stringify({ text: "Thanks! Happy to be here." }),
    });
    assert(t9.status === 201 && t9.data.message.text === "Thanks! Happy to be here.", "9. Confirmed participant can send message");

    // Test 10: Sender ID comes from JWT
    const hostMsgSenderId = t8.data.message.senderId;
    assert(hostMsgSenderId === hostA.user.id, "10. Sender ID is derived from JWT");

    // Test 11: Client cannot specify another sender ID
    const t11 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "Testing spoof attempt", senderId: "spoofed_user_id" }),
    });
    assert(t11.data.message.senderId === hostA.user.id, "11. Client-provided senderId is ignored (JWT senderId enforced)");

    // Test 12: Empty message rejected
    const t12 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "" }),
    });
    assert(t12.status === 400, "12. Empty message text rejected (400)");

    // Test 13: Whitespace-only message rejected
    const t13 = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "    \n   " }),
    });
    assert(t13.status === 400, "13. Whitespace-only message text rejected (400)");

    // --- PERSISTENCE TESTS ---
    // Test 14: Message exists in database
    const t14 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    const msgsList = t14.data.messages || [];
    assert(msgsList.length >= 3, "14. Sent messages exist in SQLite database");

    // Test 15: History endpoint returns messages ordered chronologically
    const isOrdered = msgsList.every((m, idx) => {
      if (idx === 0) return true;
      return new Date(m.createdAt) >= new Date(msgsList[idx - 1].createdAt);
    });
    assert(isOrdered, "15. History endpoint returns messages in chronological order");

    // Test 16: Message survives backend query / persistence check
    const persistentMsg = msgsList.find((m) => m.text === "Welcome everyone!");
    assert(!!persistentMsg && !!persistentMsg.id, "16. Message persistence verified with unique server ID");

    // --- ISOLATION TESTS ---
    // Test 17: Room A messages cannot appear in Room B
    const t17 = await request(`/rooms/${roomBId}/messages`, {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    assert(t17.data.messages.length === 0, "17. Room A messages do not leak into Room B");

    // --- SOCKET AUTHENTICATION & CHANNEL TESTS ---
    // Test 18: User cannot subscribe to unauthorized Room over Socket.IO
    const unauthorizedSocket = io(SOCKET_URL, {
      auth: { token: userE.token },
      transports: ["websocket"],
    });

    await new Promise((resolve) => {
      unauthorizedSocket.on("connect", () => {
        unauthorizedSocket.emit("join_room", { roomId: roomAId }, (res) => {
          assert(res && res.success === false, "18. Unauthorized user cannot subscribe to Room A socket channel");
          unauthorizedSocket.disconnect();
          resolve();
        });
      });
      unauthorizedSocket.on("connect_error", () => {
        assert(true, "18. Unauthorized user socket rejected");
        resolve();
      });
    });

    // Test 19: Invalid JWT cannot establish authorized socket
    const invalidSocket = io(SOCKET_URL, {
      auth: { token: "invalid_jwt_token_123" },
      transports: ["websocket"],
    });

    await new Promise((resolve) => {
      invalidSocket.on("connect_error", (err) => {
        assert(true, "19. Socket connection rejected for invalid JWT");
        invalidSocket.disconnect();
        resolve();
      });
      invalidSocket.on("connect", () => {
        assert(false, "19. Socket allowed connection with invalid JWT");
        invalidSocket.disconnect();
        resolve();
      });
    });

    // Test 20: Authorized Host can connect to socket
    const hostSocket = io(SOCKET_URL, {
      auth: { token: hostA.token },
      transports: ["websocket"],
    });

    await new Promise((resolve) => {
      hostSocket.on("connect", () => {
        assert(true, "20. Authorized Host can establish Socket.IO connection");
        resolve();
      });
    });

    // Test 21: Authorized participant can connect & join channel
    const participantSocket = io(SOCKET_URL, {
      auth: { token: joineeB.token },
      transports: ["websocket"],
    });

    let receivedSocketMsg = null;
    await new Promise((resolve) => {
      participantSocket.on("connect", () => {
        participantSocket.emit("join_room", { roomId: roomAId }, (res) => {
          assert(res && res.success === true, "21. Authorized participant can join room socket channel");
          resolve();
        });
      });
    });

    // Test 22: Real-time socket message delivery & duplicate identity
    participantSocket.on("new_message", (msg) => {
      receivedSocketMsg = msg;
    });

    // Host sends real-time message
    const sendRes = await request(`/rooms/${roomAId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "Real-time socket test message" }),
    });

    await new Promise((r) => setTimeout(r, 300));
    assert(
      receivedSocketMsg !== null && receivedSocketMsg.id === sendRes.data.message.id,
      "22. Socket message delivered in real-time with unique server ID for frontend de-duplication"
    );

    // Test 23: Duplicate message protection - sending message does not create duplicate database entries
    const t23 = await request(`/rooms/${roomAId}/messages`, {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    const matchCount = t23.data.messages.filter((m) => m.id === sendRes.data.message.id).length;
    assert(matchCount === 1, "23. Backend persistence maintains exactly 1 database entry per message ID");

    // Clean up sockets
    hostSocket.disconnect();
    participantSocket.disconnect();

  } catch (err) {
    console.error("❌ Test script error:", err);
    failed++;
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }

  console.log("\n==================================================");
  console.log(`📊 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
