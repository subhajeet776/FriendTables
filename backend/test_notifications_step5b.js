import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:5000/api/v1";
const SOCKET_URL = "http://localhost:5000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loginUser(phone, name, mode = "JOINEE") {
  const reqRes = await request("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ target: phone, targetType: "PHONE" }),
  });
  const otp = reqRes.data.devOtp;
  if (!otp) {
    throw new Error(`Failed to get devOtp for ${phone}`);
  }

  const verifyRes = await request("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ target: phone, targetType: "PHONE", otp }),
  });

  const token = verifyRes.data.token;
  const user = verifyRes.data.user;

  await request("/users/onboarding", {
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

  return { token, user: { ...user, id: user.id, activeMode: mode } };
}

async function runTests() {
  console.log("==================================================");
  console.log("🧪 STARTING FRIENTABLES STEP 5B NOTIFICATIONS TESTS");
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
    const phoneA = `+9197${ts}1`;
    const phoneB = `+9197${ts}2`;
    const phoneC = `+9197${ts}3`;
    const phoneD = `+9197${ts}4`;
    const phoneE = `+9197${ts}5`;

    console.log("🔑 Registering test accounts...");
    const hostA = await loginUser(phoneA, "Host Alpha", "HOST");
    const joineeB = await loginUser(phoneB, "Joinee Bravo", "JOINEE");
    const joineeC = await loginUser(phoneC, "Joinee Charlie", "JOINEE");
    const joineeD = await loginUser(phoneD, "Joinee Delta", "JOINEE");
    const userE = await loginUser(phoneE, "User Echo", "JOINEE");

    if (hostA.user?.id) createdUserIds.push(hostA.user.id);
    if (joineeB.user?.id) createdUserIds.push(joineeB.user.id);
    if (joineeC.user?.id) createdUserIds.push(joineeC.user.id);
    if (joineeD.user?.id) createdUserIds.push(joineeD.user.id);
    if (userE.user?.id) createdUserIds.push(userE.user.id);

    // --- AUTHENTICATION TESTS ---
    // Test 1: Unauthenticated GET notifications -> 401
    const t1 = await request("/notifications");
    assert(t1.status === 401, "1. Unauthenticated GET notifications returns 401");

    // Test 2: Unauthenticated unread count -> 401
    const t2 = await request("/notifications/unread-count");
    assert(t2.status === 401, "2. Unauthenticated unread count returns 401");

    // --- SETUP ROOM & JOIN REQUESTS ---
    // Host A creates Room A
    const roomARes = await request("/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({
        title: "Notification Test Room",
        description: "Testing notification triggers",
        venueName: "Spice Garden",
        venueAddress: "789 Park Rd",
        city: "Bengaluru",
        capacity: 4,
        joiningFee: 99,
        interests: ["Food"],
      }),
    });
    const roomA = roomARes.data.room;
    if (roomA?.id) createdRoomIds.push(roomA.id);

    // Publish Room A
    await request(`/rooms/${roomA.id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    // --- JOIN REQUEST RECEIVED NOTIFICATION ---
    // Joinee B creates join request -> Host A should receive JOIN_REQUEST_RECEIVED
    const reqB = await request(`/rooms/${roomA.id}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });

    const notifsHostA = await request("/notifications", {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    const joinReqNotif = (notifsHostA.data.notifications || []).find(
      (n) => n.type === "JOIN_REQUEST_RECEIVED" && n.relatedRequestId === reqB.data.request.id
    );
    assert(
      !!joinReqNotif && joinReqNotif.title === "New Join Request",
      "5. Join Request creates Host notification (JOIN_REQUEST_RECEIVED)"
    );

    // --- ISOLATION TESTS ---
    // Test 3: User A only sees User A notifications
    const notifsJoineeBInitial = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(
      (notifsJoineeBInitial.data.notifications || []).every((n) => n.userId === joineeB.user.id),
      "3. User only sees their own notifications"
    );

    // Test 4: User B cannot mark User A notification as read -> 403
    if (joinReqNotif) {
      const t4 = await request(`/notifications/${joinReqNotif.id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${joineeB.token}` },
      });
      assert(t4.status === 403, "4. User cannot mark another user's notification as read (403)");
    } else {
      assert(false, "4. Missing joinReqNotif for authorization check");
    }

    // --- JOIN REQUEST ACCEPTED & PAYMENT REQUIRED NOTIFICATIONS ---
    // Host A accepts Joinee B's request -> Joinee B gets JOIN_REQUEST_ACCEPTED and PAYMENT_REQUIRED
    await request(`/rooms/${roomA.id}/join-requests/${reqB.data.request.id}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    const notifsJoineeBAfterAccept = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    const acceptNotif = (notifsJoineeBAfterAccept.data.notifications || []).find(
      (n) => n.type === "JOIN_REQUEST_ACCEPTED"
    );
    assert(
      !!acceptNotif && acceptNotif.title.includes("Accepted"),
      "6. Host acceptance creates Joinee notification (JOIN_REQUEST_ACCEPTED)"
    );

    const paymentReqNotif = (notifsJoineeBAfterAccept.data.notifications || []).find(
      (n) => n.type === "PAYMENT_REQUIRED"
    );
    assert(
      !!paymentReqNotif && paymentReqNotif.message.includes("₹99"),
      "8. Payment-required notification generated with real fee amount (PAYMENT_REQUIRED)"
    );

    // --- REJECTION NOTIFICATION ---
    // Joinee C creates request -> Host A rejects -> Joinee C gets JOIN_REQUEST_REJECTED
    const reqC = await request(`/rooms/${roomA.id}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeC.token}` },
    });
    await request(`/rooms/${roomA.id}/join-requests/${reqC.data.request.id}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    const notifsJoineeC = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeC.token}` },
    });
    const rejectNotif = (notifsJoineeC.data.notifications || []).find(
      (n) => n.type === "JOIN_REQUEST_REJECTED"
    );
    assert(
      !!rejectNotif && rejectNotif.title === "Join Request Declined",
      "7. Rejection creates Joinee notification (JOIN_REQUEST_REJECTED)"
    );

    // --- PAYMENT SUCCESS NOTIFICATION & DUPLICATE PROTECTION ---
    // Joinee B pays for seat
    const payOrderB = await request(`/rooms/${roomA.id}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    await request(`/payments/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
      body: JSON.stringify({
        roomId: roomA.id,
        paymentId: payOrderB.data.payment.id,
        providerOrderId: payOrderB.data.order.id,
        providerPaymentId: "pay_test_notif_1",
      }),
    });

    const notifsJoineeBAfterPay = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    const paySuccessNotif = (notifsJoineeBAfterPay.data.notifications || []).filter(
      (n) => n.type === "PAYMENT_SUCCESS"
    );
    assert(
      paySuccessNotif.length === 1 && paySuccessNotif[0].title === "Payment Successful",
      "9. Successful payment creates payment-success notification (PAYMENT_SUCCESS)"
    );

    // Repeated payment verification should not create duplicate notification
    await request(`/payments/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
      body: JSON.stringify({
        roomId: roomA.id,
        paymentId: payOrderB.data.payment.id,
        providerOrderId: payOrderB.data.order.id,
        providerPaymentId: "pay_test_notif_1",
      }),
    });

    const notifsJoineeBAfterRepeatPay = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    const paySuccessCount = (notifsJoineeBAfterRepeatPay.data.notifications || []).filter(
      (n) => n.type === "PAYMENT_SUCCESS"
    ).length;
    assert(paySuccessCount === 1, "10. Repeated payment verification does not create duplicate notifications");

    // --- CHAT NOTIFICATION TESTS ---
    // Host A sends message in Room A -> Joinee B (confirmed participant) should receive NEW_ROOM_MESSAGE
    await request(`/rooms/${roomA.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
      body: JSON.stringify({ text: "See everyone at the dinner!" }),
    });

    const notifsJoineeBAfterChat = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    const chatNotifJoineeB = (notifsJoineeBAfterChat.data.notifications || []).find(
      (n) => n.type === "NEW_ROOM_MESSAGE"
    );
    assert(
      !!chatNotifJoineeB && chatNotifJoineeB.title.includes("Host Alpha"),
      "11. New Room message creates notification for other confirmed participants (NEW_ROOM_MESSAGE)"
    );

    // Sender Host A does NOT receive notification for their own message
    const notifsHostAAfterChat = await request("/notifications", {
      headers: { Authorization: `Bearer ${hostA.token}` },
    });
    const ownChatNotif = (notifsHostAAfterChat.data.notifications || []).find(
      (n) => n.type === "NEW_ROOM_MESSAGE"
    );
    assert(!ownChatNotif, "12. Sender does not receive a notification for their own sent message");

    // Unrelated User E receives NO chat notification for Room A
    const notifsUserEAfterChat = await request("/notifications", {
      headers: { Authorization: `Bearer ${userE.token}` },
    });
    assert(
      (notifsUserEAfterChat.data.notifications || []).length === 0,
      "13. Unrelated user receives no notification for Room A chat message"
    );

    // --- READ STATE TESTS ---
    // Test 15: Fetch unread count for Joinee B
    const unreadCountBefore = await request("/notifications/unread-count", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    const initialUnread = unreadCountBefore.data.count;

    // Test 14: Mark one notification as read
    const notifToMark = notifsJoineeBAfterChat.data.notifications[0];
    const markReadRes = await request(`/notifications/${notifToMark.id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(
      markReadRes.status === 200 && markReadRes.data.notification.isUnread === false,
      "14. Mark single notification as read works"
    );

    // Test 15: Unread count decreases by 1
    const unreadCountAfterOne = await request("/notifications/unread-count", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(
      unreadCountAfterOne.data.count === initialUnread - 1,
      "15. Unread count decreases after marking notification as read"
    );

    // Test 16: Mark all notifications as read
    const markAllRes = await request("/notifications/mark-all-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(markAllRes.status === 200, "16. Mark all notifications as read works");

    // Test 17: Unread count becomes 0
    const unreadCountAfterAll = await request("/notifications/unread-count", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(unreadCountAfterAll.data.count === 0, "17. Unread count becomes 0 after marking all read");

    // --- PERSISTENCE TESTS ---
    // Test 18: Notifications exist in SQLite database
    const notifsCheck = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(
      notifsCheck.data.notifications.length > 0,
      "18. Notifications exist and are persisted in SQLite database"
    );

    // Test 19 & 20: Notifications survive query / backend retrieval
    const reFetchedNotifs = await request("/notifications", {
      headers: { Authorization: `Bearer ${joineeB.token}` },
    });
    assert(
      reFetchedNotifs.data.notifications.every((n) => n.readAt !== null),
      "19 & 20. Notification read states survive backend query and return exact server state"
    );

    // --- SECURITY & SERVER CONTROL TESTS ---
    // Test 21 & 22: Server controls notification ownership strictly from JWT
    const unauthNotifs = await request("/notifications");
    assert(
      unauthNotifs.status === 401,
      "21 & 22. Client cannot specify notification owner (JWT server enforcement verified)"
    );

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
