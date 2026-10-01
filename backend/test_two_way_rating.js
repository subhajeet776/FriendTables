import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runTwoWayRatingTests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 RUNNING TWO-WAY RATING & COMMENT SYSTEM INTEGRATION TESTS\n");

  const runId = Date.now().toString().slice(-6);
  const createdUserIds = [];
  const createdRoomIds = [];

  try {
    // Helper to authenticate user
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
      createdUserIds.push(userId);

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
          interests: ["Food", "Movies"],
          activeMode: mode,
        }),
      });

      return { userId, token, phone };
    }

    // 1. Setup Host A, Joinee 1, Joinee 2 (unpaid/unattended), Non-Member 3
    const hostA = await authUser("Host Rohan", "HOST", "01");
    const joinee1 = await authUser("Joinee Ananya", "JOINEE", "02");
    const joinee2 = await authUser("Joinee Vikram", "JOINEE", "03");
    const nonMember = await authUser("NonMember Rahul", "JOINEE", "04");

    // Host A creates & publishes Room 1
    const createRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({
        title: "Gourmet Pizza Night",
        description: "Let's taste artisanal wood-fired pizzas and chat!",
        venueName: "Truffles Gourmet",
        venueAddress: "Koramangala 5th Block",
        city: "Bengaluru",
        date: "Sat, 24 Oct",
        time: "8:00 PM - 9:30 PM",
        capacity: 4,
        joiningFee: 99,
        interests: ["Food", "Movies"],
      }),
    });
    const createData = await createRes.json();
    const roomId = createData.room.id;
    createdRoomIds.push(roomId);

    await fetch(`${BASE_URL}/rooms/${roomId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    // Joinee 1 joins & confirms payment
    const j1JoinRes = await fetch(`${BASE_URL}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee1.token}` },
    });
    const j1JoinData = await j1JoinRes.json();
    const j1ReqId = j1JoinData.request.id;

    await fetch(`${BASE_URL}/rooms/${roomId}/join-requests/${j1ReqId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    const j1OrderRes = await fetch(`${BASE_URL}/rooms/${roomId}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee1.token}` },
    });
    const j1OrderData = await j1OrderRes.json();

    await fetch(`${BASE_URL}/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({
        roomId,
        providerOrderId: j1OrderData.order.id,
        providerPaymentId: `pay_j1_${Date.now()}`,
        providerSignature: "test_signature",
      }),
    });

    // Joinee 2 joins & gets accepted but unpaid
    const j2JoinRes = await fetch(`${BASE_URL}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee2.token}` },
    });
    const j2JoinData = await j2JoinRes.json();
    const j2ReqId = j2JoinData.request.id;

    await fetch(`${BASE_URL}/rooms/${roomId}/join-requests/${j2ReqId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    // TEST 1: Joinee rating Host BEFORE attendance status -> 403 Forbidden
    const earlyJoineeRateRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 5 }),
    });
    console.log("1. Joinee rating Host BEFORE attendance status:", earlyJoineeRateRes.status, "(Expected 403)");
    if (earlyJoineeRateRes.status !== 403) throw new Error("Failed test 1");

    // TEST 2: Host rating Joinee BEFORE joinee attendance status -> 403 Forbidden
    const earlyHostRateRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({ revieweeId: joinee1.userId, score: 5 }),
    });
    console.log("2. Host rating Joinee BEFORE joinee attendance status:", earlyHostRateRes.status, "(Expected 403)");
    if (earlyHostRateRes.status !== 403) throw new Error("Failed test 2");

    // Mark Joinee 1 as attended
    const p1 = await prisma.roomParticipant.findFirst({ where: { roomId, userId: joinee1.userId } });
    await prisma.roomAttendance.create({ data: { roomId, userId: joinee1.userId, participantId: p1.id } });

    // TEST 3: Joinee 1 rates Host AFTER attendance status -> 201 Created
    const joineeRateHostRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 5, review: "Amazing host, awesome pizza!" }),
    });
    const joineeRateHostData = await joineeRateHostRes.json();
    console.log("3. Joinee rates Host AFTER attendance status:", joineeRateHostRes.status, "Score:", joineeRateHostData.data?.score);
    if (joineeRateHostRes.status !== 201 || joineeRateHostData.data?.score !== 5) throw new Error("Failed test 3");

    // TEST 4: Host rates attended Joinee 1 -> 201 Created
    const hostRateJoineeRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({ revieweeId: joinee1.userId, score: 4, review: "Great conversation, very friendly." }),
    });
    const hostRateJoineeData = await hostRateJoineeRes.json();
    console.log("4. Host rates attended Joinee status:", hostRateJoineeRes.status, "Score:", hostRateJoineeData.data?.score);
    if (hostRateJoineeRes.status !== 201 || hostRateJoineeData.data?.score !== 4) throw new Error("Failed test 4");

    // TEST 5: Host rates unattended Joinee 2 -> 403 Forbidden
    const hostRateUnattendedRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({ revieweeId: joinee2.userId, score: 4 }),
    });
    console.log("5. Host rates unattended Joinee 2 status:", hostRateUnattendedRes.status, "(Expected 403)");
    if (hostRateUnattendedRes.status !== 403) throw new Error("Failed test 5");

    // TEST 6: Non-member rates Host -> 403 Forbidden
    const nonMemberRateRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nonMember.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 5 }),
    });
    console.log("6. Non-member rates Host status:", nonMemberRateRes.status, "(Expected 403)");
    if (nonMemberRateRes.status !== 403) throw new Error("Failed test 6");

    // TEST 7: User rates self -> 400 Bad Request
    const selfRateRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 5 }),
    });
    console.log("7. User rates self status:", selfRateRes.status, "(Expected 400)");
    if (selfRateRes.status !== 400) throw new Error("Failed test 7");

    // TEST 8: Duplicate rating -> 409 Conflict
    const dupRateRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 5 }),
    });
    console.log("8. Duplicate rating status:", dupRateRes.status, "(Expected 409)");
    if (dupRateRes.status !== 409) throw new Error("Failed test 8");

    // TEST 9: Invalid score validation (0, 6) -> 400 Bad Request
    const scoreZeroRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 0 }),
    });

    const scoreSixRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({ revieweeId: hostA.userId, score: 6 }),
    });

    console.log("9. Invalid score 0 status:", scoreZeroRes.status, "Score 6 status:", scoreSixRes.status, "(Expected 400)");
    if (scoreZeroRes.status !== 400 || scoreSixRes.status !== 400) throw new Error("Failed test 9");

    // TEST 10: Optional comment (omitted review field)
    const createRoom2Res = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({
        title: "Second Dinner",
        description: "Another dinner event",
        venueName: "Truffles Gourmet",
        venueAddress: "Koramangala",
        city: "Bengaluru",
        capacity: 4,
        joiningFee: 99,
        interests: ["Food"],
      }),
    });
    const createRoom2Data = await createRoom2Res.json();
    const room2Id = createRoom2Data.room.id;
    createdRoomIds.push(room2Id);

    await fetch(`${BASE_URL}/rooms/${room2Id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    const j1Join2Res = await fetch(`${BASE_URL}/rooms/${room2Id}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee1.token}` },
    });
    const j1Join2Data = await j1Join2Res.json();
    const j1Req2Id = j1Join2Data.request.id;

    await fetch(`${BASE_URL}/rooms/${room2Id}/join-requests/${j1Req2Id}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hostA.token}` },
    });

    const j1Order2Res = await fetch(`${BASE_URL}/rooms/${room2Id}/payment/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joinee1.token}` },
    });
    const j1Order2Data = await j1Order2Res.json();

    await fetch(`${BASE_URL}/payments/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${joinee1.token}`,
      },
      body: JSON.stringify({
        roomId: room2Id,
        providerOrderId: j1Order2Data.order.id,
        providerPaymentId: `pay_j1_r2_${Date.now()}`,
        providerSignature: "test_signature",
      }),
    });

    const p2 = await prisma.roomParticipant.findFirst({ where: { roomId: room2Id, userId: joinee1.userId } });
    await prisma.roomAttendance.create({ data: { roomId: room2Id, userId: joinee1.userId, participantId: p2.id } });

    const optionalCommentRes = await fetch(`${BASE_URL}/rooms/${room2Id}/rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostA.token}`,
      },
      body: JSON.stringify({ revieweeId: joinee1.userId, score: 5 }),
    });
    const optionalCommentData = await optionalCommentRes.json();
    console.log("10. Optional comment (omitted review) status:", optionalCommentRes.status, "Review:", optionalCommentData.data?.review);
    if (optionalCommentRes.status !== 201 || optionalCommentData.data?.review !== null) {
      throw new Error("Failed optional comment test");
    }

    // TEST 11: Rating aggregate updates correctly
    const userRatingsRes = await fetch(`${BASE_URL}/users/${joinee1.userId}/ratings`);
    const userRatingsData = await userRatingsRes.json();
    console.log("11. Joinee 1 Rating Aggregate:", userRatingsData.data);
    if (userRatingsData.data?.averageScore !== 4.5 || userRatingsData.data?.totalRatingsCount !== 2) {
      throw new Error(`Aggregate mismatch! Expected 4.5 avg and 2 count, got avg ${userRatingsData.data?.averageScore} count ${userRatingsData.data?.totalRatingsCount}`);
    }

    // TEST 12: Existing Host rating behavior still passes
    const hostRatingEligibilityRes = await fetch(`${BASE_URL}/rooms/${roomId}/rating`, {
      headers: { Authorization: `Bearer ${joinee1.token}` },
    });
    const hostEligibilityData = await hostRatingEligibilityRes.json();
    console.log("12. Existing Host rating eligibility endpoint response:", hostEligibilityData.data?.alreadyRated);
    if (!hostEligibilityData.success || !hostEligibilityData.data?.alreadyRated) {
      throw new Error("Failed existing Host rating eligibility compatibility check");
    }

    console.log("\n✅ ALL 12 TWO-WAY RATING INTEGRATION TESTS PASSED SUCCESSFULLY!");
  } finally {
    console.log("\n--- TEARDOWN: Cleaning up test fixture records ---");
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runTwoWayRatingTests().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
