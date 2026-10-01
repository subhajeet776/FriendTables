import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:5000/api/v1";

async function runConflictTests() {
  console.log("🧪 Starting Room Scheduling Conflict & Double-Booking Prevention Integration Tests...\n");

  const runId = Date.now().toString().slice(-6);
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];

  async function createTestUser(phoneSuffix: string, name: string) {
    const phone = `+91 99${runId}${phoneSuffix}`;
    const reqRes = await fetch(`${BASE_URL}/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const reqData = await reqRes.json();
    if (!reqData.success) throw new Error(`OTP Request failed for ${name}: ${reqData.message}`);

    const verifyRes = await fetch(`${BASE_URL}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp: reqData.devOtp }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success || !verifyData.token) {
      throw new Error(`OTP Verification failed for ${name}: ${verifyData.message}`);
    }

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
        bio: "Testing room scheduling conflict",
        avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400",
        homeCity: "Bengaluru",
        interests: ["Food"],
        activeMode: "HOST",
      }),
    });

    return { token, userId, phone };
  }

  // Helper API calls
  async function createRoom(token: string, payload: any) {
    const res = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        venueName: "Test Bistro",
        venueAddress: "123 Indiranagar",
        city: "Bengaluru",
        capacity: 4,
        joiningFee: 99,
        ...payload,
      }),
    });
    const data = await res.json();
    if (data.success && data.room?.id) {
      createdRoomIds.push(data.room.id);
    }
    return { status: res.status, data };
  }

  async function patchRoom(token: string, roomId: string, payload: any) {
    const res = await fetch(`${BASE_URL}/rooms/${roomId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  async function publishRoom(token: string, roomId: string) {
    const res = await fetch(`${BASE_URL}/rooms/${roomId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  async function joinRoom(token: string, roomId: string) {
    const res = await fetch(`${BASE_URL}/rooms/${roomId}/join-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // Setup users
    const host1 = await createTestUser("01", "Host Alpha");
    const host2 = await createTestUser("02", "Host Beta");
    const host3 = await createTestUser("05", "Host Gamma");
    const host4 = await createTestUser("06", "Host Delta");
    const joinee1 = await createTestUser("03", "Joinee One");
    const joinee2 = await createTestUser("04", "Joinee Two");

    console.log("✅ Test users created successfully.\n");

    // 1. Host creates first room -> success
    console.log("--- Test 1: Host creates first room ---");
    const res1 = await createRoom(host1.token, {
      title: "Host1 Room 1",
      description: "First room by Host 1",
      date: "2027-05-10",
      time: "7:30 PM - 9:00 PM",
    });
    if (res1.status !== 201 || !res1.data.success) {
      throw new Error(`Test 1 Failed: Expected 201, got ${res1.status}. ${JSON.stringify(res1.data)}`);
    }
    const room1Id = res1.data.room.id;
    console.log("✅ PASS: Host created first room successfully.");

    // 2. Host attempts overlapping second room -> rejected (409 Conflict)
    console.log("\n--- Test 2: Host attempts overlapping second room ---");
    const res2 = await createRoom(host1.token, {
      title: "Host1 Room 2 Overlapping",
      description: "Overlapping room attempt",
      date: "2027-05-10",
      time: "8:00 PM - 9:30 PM",
    });
    if (res2.status !== 409 || res2.data.success) {
      throw new Error(`Test 2 Failed: Expected 409 Conflict, got ${res2.status}. ${JSON.stringify(res2.data)}`);
    }
    if (!res2.data.message.includes("already have another dining experience scheduled")) {
      throw new Error(`Test 2 Failed: Incorrect error message. Got: ${res2.data.message}`);
    }
    console.log("✅ PASS: Overlapping second room rejected with 409 Conflict.");

    // 3. Host creates non-overlapping second room -> success (Exact boundary touching allowed)
    console.log("\n--- Test 3: Host creates non-overlapping room (exact boundary touching) ---");
    const res3 = await createRoom(host1.token, {
      title: "Host1 Room 3 Adjacent",
      description: "Non-overlapping room starting right when Room 1 ends",
      date: "2027-05-10",
      time: "9:00 PM - 10:30 PM",
    });
    if (res3.status !== 201 || !res3.data.success) {
      throw new Error(`Test 3 Failed: Expected 201, got ${res3.status}. ${JSON.stringify(res3.data)}`);
    }
    console.log("✅ PASS: Non-overlapping adjacent room created successfully.");

    // 4. Host is Joinee in Room A -> cannot create overlapping Host Room B
    console.log("\n--- Test 4: Host is Joinee in Room A -> cannot create overlapping Host Room B ---");
    // Host 2 creates Room A (7:30 PM - 9:00 PM on 2027-06-15) and publishes it
    const resRoomA = await createRoom(host2.token, {
      title: "Host2 Room A",
      description: "Dinner for joinee test",
      date: "2027-06-15",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-06-15T19:30:00.000Z",
    });
    const roomAId = resRoomA.data.room.id;
    await publishRoom(host2.token, roomAId);

    // Make Joinee 1 a confirmed participant in Room A via DB
    await prisma.roomParticipant.create({
      data: {
        roomId: roomAId,
        userId: joinee1.userId,
      },
    });

    // Now Joinee 1 attempts to create a Host Room B (8:00 PM - 9:30 PM on 2027-06-15)
    const resHostB = await createRoom(joinee1.token, {
      title: "Joinee1 Host Room B",
      description: "Attempting to host while confirmed in Room A",
      date: "2027-06-15",
      time: "8:00 PM - 9:30 PM",
      dateTime: "2027-06-15T20:00:00.000Z",
    });
    if (resHostB.status !== 409 || resHostB.data.success) {
      throw new Error(`Test 4 Failed: Expected 409 Conflict, got ${resHostB.status}. ${JSON.stringify(resHostB.data)}`);
    }
    console.log("✅ PASS: Confirmed Joinee cannot create overlapping Host room.");

    // 5. Joinee confirmed in Room A -> cannot join overlapping Room B
    console.log("\n--- Test 5: Joinee confirmed in Room A -> cannot join overlapping Room B ---");
    // Host 3 creates Room B (8:00 PM - 9:30 PM on 2027-06-15) and publishes it
    const resRoomB = await createRoom(host3.token, {
      title: "Host3 Room B",
      description: "Overlapping room for joinee test",
      date: "2027-06-15",
      time: "8:00 PM - 9:30 PM",
      dateTime: "2027-06-15T20:00:00.000Z",
    });
    if (!resRoomB.data.room) {
      throw new Error(`Test 5 Setup Failed: ${JSON.stringify(resRoomB.data)}`);
    }
    const roomBId = resRoomB.data.room.id;
    await publishRoom(host3.token, roomBId);

    // Joinee 1 tries to submit join request for Room B
    const resJoinB = await joinRoom(joinee1.token, roomBId);
    if (resJoinB.status !== 409 || resJoinB.data.success) {
      throw new Error(`Test 5 Failed: Expected 409 Conflict, got ${resJoinB.status}. ${JSON.stringify(resJoinB.data)}`);
    }
    console.log("✅ PASS: Confirmed Joinee cannot join overlapping room.");

    // 6. Joinee confirmed in Room A -> can join non-overlapping Room C
    console.log("\n--- Test 6: Joinee confirmed in Room A -> can join non-overlapping Room C ---");
    // Host 4 creates Room C (9:00 PM - 10:30 PM on 2027-06-15) and publishes it
    const resRoomC = await createRoom(host4.token, {
      title: "Host4 Room C",
      description: "Non-overlapping room for joinee test",
      date: "2027-06-15",
      time: "9:00 PM - 10:30 PM",
      dateTime: "2027-06-15T21:00:00.000Z",
    });
    if (!resRoomC.data.room) {
      throw new Error(`Test 6 Setup Failed: ${JSON.stringify(resRoomC.data)}`);
    }
    const roomCId = resRoomC.data.room.id;
    await publishRoom(host4.token, roomCId);

    // Joinee 1 submits join request for Room C
    const resJoinC = await joinRoom(joinee1.token, roomCId);
    if (resJoinC.status !== 201 || !resJoinC.data.success) {
      throw new Error(`Test 6 Failed: Expected 201, got ${resJoinC.status}. ${JSON.stringify(resJoinC.data)}`);
    }
    console.log("✅ PASS: Confirmed Joinee can join non-overlapping room.");

    // 7. Rejected request does not block another room
    console.log("\n--- Test 7: Rejected request does not block another room ---");
    // Host 2 creates Room D (7:30 PM - 9:00 PM on 2027-07-01) and publishes it
    const resRoomD = await createRoom(host2.token, {
      title: "Host2 Room D",
      description: "Room for rejection test",
      date: "2027-07-01",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-07-01T19:30:00.000Z",
    });
    const roomDId = resRoomD.data.room.id;
    await publishRoom(host2.token, roomDId);

    // Joinee 2 submits join request
    const resJoinD = await joinRoom(joinee2.token, roomDId);
    const reqDId = resJoinD.data.request.id;

    // Host 2 rejects the request
    await fetch(`${BASE_URL}/rooms/${roomDId}/join-requests/${reqDId}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host2.token}` },
    });

    // Joinee 2 creates Host Room E (8:00 PM - 9:30 PM on 2027-07-01)
    const resHostE = await createRoom(joinee2.token, {
      title: "Joinee2 Host Room E",
      description: "Creating room after previous request was rejected",
      date: "2027-07-01",
      time: "8:00 PM - 9:30 PM",
      dateTime: "2027-07-01T20:00:00.000Z",
    });
    if (resHostE.status !== 201 || !resHostE.data.success) {
      throw new Error(`Test 7 Failed: Expected 201, got ${resHostE.status}. ${JSON.stringify(resHostE.data)}`);
    }
    console.log("✅ PASS: Rejected request does not block room creation.");

    // 8. Cancelled room does not block another room
    console.log("\n--- Test 8: Cancelled room does not block another room ---");
    // Host 1 creates Room F
    const resRoomF = await createRoom(host1.token, {
      title: "Host1 Room F",
      description: "To be cancelled",
      date: "2027-08-01",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-08-01T19:30:00.000Z",
    });
    const roomFId = resRoomF.data.room.id;

    // Cancel Room F in DB
    await prisma.room.update({
      where: { id: roomFId },
      data: { status: "CANCELLED" },
    });

    // Host 1 creates Room G at exact same time
    const resRoomG = await createRoom(host1.token, {
      title: "Host1 Room G",
      description: "Created at same time as cancelled room",
      date: "2027-08-01",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-08-01T19:30:00.000Z",
    });
    if (resRoomG.status !== 201 || !resRoomG.data.success) {
      throw new Error(`Test 8 Failed: Expected 201, got ${resRoomG.status}. ${JSON.stringify(resRoomG.data)}`);
    }
    console.log("✅ PASS: Cancelled room does not block new room creation.");

    // 9. Completed room from an earlier date does not block today's room
    console.log("\n--- Test 9: Completed room from earlier date does not block today's room ---");
    // Host 1 creates historical room H on 2027-01-01
    const resRoomH = await createRoom(host1.token, {
      title: "Host1 Yesterday Dinner",
      description: "Past dinner",
      date: "2027-01-01",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-01-01T19:30:00.000Z",
    });
    await prisma.room.update({
      where: { id: resRoomH.data.room.id },
      data: { status: "COMPLETED" },
    });

    // Host 1 creates room I on 2027-01-02
    const resRoomI = await createRoom(host1.token, {
      title: "Host1 Today Dinner",
      description: "New dinner next day",
      date: "2027-01-02",
      time: "7:30 PM - 9:00 PM",
      dateTime: "2027-01-02T19:30:00.000Z",
    });
    if (resRoomI.status !== 201 || !resRoomI.data.success) {
      throw new Error(`Test 9 Failed: Expected 201, got ${resRoomI.status}. ${JSON.stringify(resRoomI.data)}`);
    }
    console.log("✅ PASS: Historical completed room from earlier date does not block today's room.");

    // 10. Room Editing exclude self & block overlap
    console.log("\n--- Test 10: Room Editing excludes self & blocks overlap ---");
    const room3Id = res3.data.room.id;
    const resEditSelf = await patchRoom(host1.token, room3Id, {
      time: "9:15 PM - 10:45 PM",
    });
    if (resEditSelf.status !== 200 || !resEditSelf.data.success) {
      throw new Error(`Test 10 Failed: Room self-edit failed. ${JSON.stringify(resEditSelf.data)}`);
    }

    // Host 1 attempts to edit Room 3 time to 8:30 PM - 10:00 PM -> overlaps Room 1 (7:30-9:00 PM) -> rejected!
    const resEditOverlap = await patchRoom(host1.token, room3Id, {
      time: "8:30 PM - 10:00 PM",
    });
    if (resEditOverlap.status !== 409 || resEditOverlap.data.success) {
      throw new Error(`Test 10 Failed: Expected 409 for overlapping edit, got ${resEditOverlap.status}. ${JSON.stringify(resEditOverlap.data)}`);
    }
    console.log("✅ PASS: Room edit correctly excludes self and rejects overlapping time edits.");

    // 11. Partial overlap conflicts (e.g. 7:30-9:00 PM vs 8:59-10:00 PM)
    console.log("\n--- Test 11: Partial overlap conflicts ---");
    const resPartial = await createRoom(host1.token, {
      title: "Host1 Partial Overlap",
      description: "Starts at 8:59 PM when Room 1 ends at 9:00 PM",
      date: "2027-05-10",
      time: "8:59 PM - 10:00 PM",
    });
    if (resPartial.status !== 409 || resPartial.data.success) {
      throw new Error(`Test 11 Failed: Expected 409 Conflict for partial overlap, got ${resPartial.status}. ${JSON.stringify(resPartial.data)}`);
    }
    console.log("✅ PASS: Partial overlap (8:59 PM vs 9:00 PM boundary) correctly rejected.");

    // 12. Direct API call protection
    console.log("\n--- Test 12: Direct API call protection ---");
    const resDirect = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host1.token}`,
      },
      body: JSON.stringify({
        title: "Direct API Overlap Payload",
        description: "Bypassing frontend checks",
        venueName: "Direct Bistro",
        venueAddress: "Direct St",
        city: "Bengaluru",
        date: "2027-05-10",
        time: "7:30 PM - 9:00 PM",
        capacity: 4,
        joiningFee: 99,
      }),
    });
    const directData = await resDirect.json();
    if (resDirect.status !== 409 || directData.success) {
      throw new Error(`Test 12 Failed: Direct API call bypassed conflict check! Got status ${resDirect.status}`);
    }
    console.log("✅ PASS: Direct API calls cannot bypass scheduling conflict enforcement.");

    // 13. End time required validation
    console.log("\n--- Test 13: End time required validation ---");
    const resNoEnd = await createRoom(host1.token, {
      title: "No End Time Room",
      description: "Only start time specified",
      date: "2027-12-01",
      time: "7:30 PM",
    });
    if (resNoEnd.status !== 400 || resNoEnd.data.success) {
      throw new Error(`Test 13 Failed: Expected 400 for missing end time, got ${resNoEnd.status}`);
    }
    console.log("✅ PASS: Missing end time correctly rejected with 400 Bad Request.");

    // 14. Same start and end time rejected
    console.log("\n--- Test 14: Same start and end time rejected ---");
    const resSameTime = await createRoom(host1.token, {
      title: "Same Time Room",
      description: "Start and end time identical",
      date: "2027-12-01",
      time: "7:30 PM - 7:30 PM",
    });
    if (resSameTime.status !== 400 || resSameTime.data.success) {
      throw new Error(`Test 14 Failed: Expected 400 for equal start/end time, got ${resSameTime.status}`);
    }
    if (!resSameTime.data.message.includes("End time must be later than start time")) {
      throw new Error(`Test 14 Failed: Incorrect message. Got: ${resSameTime.data.message}`);
    }
    console.log("✅ PASS: Identical start and end time rejected with 'End time must be later than start time'.");

    // 15. Earlier end time rejected
    console.log("\n--- Test 15: Earlier end time rejected ---");
    const resEarlierEnd = await createRoom(host1.token, {
      title: "Earlier End Time Room",
      description: "End time before start time",
      date: "2027-12-01",
      time: "8:00 PM - 7:30 PM",
    });
    if (resEarlierEnd.status !== 400 || resEarlierEnd.data.success) {
      throw new Error(`Test 15 Failed: Expected 400 for earlier end time, got ${resEarlierEnd.status}`);
    }
    if (!resEarlierEnd.data.message.includes("End time must be later than start time")) {
      throw new Error(`Test 15 Failed: Incorrect message. Got: ${resEarlierEnd.data.message}`);
    }
    console.log("✅ PASS: Earlier end time rejected with 'End time must be later than start time'.");

    // 16. Start + end time saved and formatted correctly
    console.log("\n--- Test 16: Start + End time range saved correctly ---");
    const resValidRange = await createRoom(host1.token, {
      title: "Valid Range Dinner",
      description: "Dinner with valid start and end time",
      date: "2027-12-01",
      time: "7:30 PM - 9:00 PM",
    });
    if (resValidRange.status !== 201 || !resValidRange.data.success) {
      throw new Error(`Test 16 Failed: Expected 201, got ${resValidRange.status}`);
    }
    if (resValidRange.data.room.time !== "7:30 PM - 9:00 PM") {
      throw new Error(`Test 16 Failed: Expected time '7:30 PM - 9:00 PM', got ${resValidRange.data.room.time}`);
    }
    console.log("✅ PASS: Start + End time range saved and formatted correctly.");

    console.log("\n🎉 ALL 16 ROOM SCHEDULING CONFLICT & TIME VALIDATION INTEGRATION TESTS PASSED PERFECTLY!");
  } catch (error) {
    console.error("❌ Test run failed with error:", error);
    process.exit(1);
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds, roomIds: createdRoomIds });
    await prisma.$disconnect();
  }
}

runConflictTests();
