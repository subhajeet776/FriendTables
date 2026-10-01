import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runStep3aTests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 Starting Backend Step 3A (Room Foundation) API Tests...\n");

  const createdUserIds = [];
  const runId = Date.now().toString().slice(-6);

  try {

  // 1. Authenticate Host A
  const phoneA = `+91 98${runId}01`;
  const reqResA = await fetch(`${BASE_URL}/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneA }),
  });
  const reqDataA = await reqResA.json();
  if (!reqDataA.success) throw new Error(`OTP Request A failed: ${reqDataA.message}`);
  const devOtpA = reqDataA.devOtp;

  const verifyResA = await fetch(`${BASE_URL}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneA, otp: devOtpA }),
  });
  const verifyDataA = await verifyResA.json();
  if (!verifyDataA.success || !verifyDataA.token) {
    throw new Error(`OTP Verification A failed: ${verifyDataA.message}`);
  }
  const tokenA = verifyDataA.token;
  const userAId = verifyDataA.user.id;
  createdUserIds.push(userAId);
  console.log("1. Host A authenticated. Token acquired.");

  // Complete onboarding for Host A
  await fetch(`${BASE_URL}/users/onboarding`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      name: "Rohan Varma",
      bio: "Foodie & Movie enthusiast",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400",
      homeCity: "Bengaluru",
      interests: ["Food", "Movies"],
      activeMode: "JOINEE", // Starts in JOINEE mode
    }),
  });

  // 2. Unauthenticated create request -> 401
  const unauthRes = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Test Room" }),
  });
  console.log("2. Unauthenticated Create HTTP Status:", unauthRes.status, "(Expected 401)");
  if (unauthRes.status !== 401) throw new Error("Expected 401 for unauthenticated room create");

  // 3. JOINEE user attempting to create Room -> 403
  const joineeCreateRes = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      title: "Movies & Pizza",
      description: "Cozy dinner",
      venueName: "Truffles",
      venueAddress: "Koramangala",
      city: "Bengaluru",
      capacity: 4,
      joiningFee: 99,
      interests: ["Movies", "Food"],
    }),
  });
  console.log("3. JOINEE Mode Create HTTP Status:", joineeCreateRes.status, "(Expected 403)");
  if (joineeCreateRes.status !== 403) throw new Error("Expected 403 when JOINEE attempts to create room");

  // Switch Host A to HOST mode
  await fetch(`${BASE_URL}/users/mode`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ activeMode: "HOST" }),
  });
  console.log("Switch Host A to HOST mode: SUCCESS");

  // Reset Host A hostLevel to NEW for idempotent fee limit tests
  await prisma.user.update({ where: { id: userAId }, data: { hostLevel: "NEW" } });

  // 4. Host Level Fee Limit Tests (NEW, RISING, ELITE)
  const validRoomPayload = {
    title: "Mind-Bending Movies & Pizza",
    description: "Discussion over wood-fired pizzas!",
    venueName: "Truffles Gourmet",
    venueAddress: "Koramangala 5th Block",
    city: "Bengaluru",
    date: "Sat, 30 Nov 2024",
    time: "8:00 PM - 9:30 PM",
    capacity: 6,
    joiningFee: 99,
    interests: ["Movies", "Food"],
  };

  // 4a. Host level NEW (default) + ₹99 -> 201 Success
  const createRoomRes1 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify(validRoomPayload),
  });
  const roomData1 = await createRoomRes1.json();
  console.log("4a. NEW Host + ₹99 Create Status:", createRoomRes1.status, "State:", roomData1.room?.status);
  if (createRoomRes1.status !== 201 || roomData1.room?.status !== "DRAFT") {
    throw new Error("Failed to create room draft for NEW host at ₹99 limit");
  }
  const roomId1 = roomData1.room.id;

  if (roomData1.room.hostId !== userAId) throw new Error("hostId was not derived from JWT token!");
  if (roomData1.room.confirmedParticipantsCount !== 0) throw new Error("confirmedParticipantsCount did not start at 0!");

  // 4b. NEW Host + ₹100 -> 400 Reject
  const createRoomRes2 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ ...validRoomPayload, joiningFee: 100 }),
  });
  console.log("4b. NEW Host + ₹100 Create Status:", createRoomRes2.status, "(Expected 400)");
  if (createRoomRes2.status !== 400) throw new Error("Expected 400 for NEW host with ₹100 fee");

  // 4c. RISING Host + ₹129 -> 201 Success, ₹130 -> 400 Reject
  await prisma.user.update({ where: { id: userAId }, data: { hostLevel: "RISING" } });
  console.log("Host A manually promoted to RISING in DB");

  const risingRes1 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ ...validRoomPayload, date: "Sun, 01 Dec 2024", joiningFee: 129 }),
  });
  console.log("4c. RISING Host + ₹129 Create Status:", risingRes1.status, "(Expected 201)");
  if (risingRes1.status !== 201) throw new Error("Expected 201 for RISING host at ₹129 fee");

  const risingRes2 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ ...validRoomPayload, date: "Sun, 01 Dec 2024", joiningFee: 130 }),
  });
  console.log("4c. RISING Host + ₹130 Create Status:", risingRes2.status, "(Expected 400)");
  if (risingRes2.status !== 400) throw new Error("Expected 400 for RISING host at ₹130 fee");

  // 4d. ELITE Host + ₹199 -> 201 Success, ₹200 -> 400 Reject
  await prisma.user.update({ where: { id: userAId }, data: { hostLevel: "ELITE" } });
  console.log("Host A manually promoted to ELITE in DB");

  const eliteRes1 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ ...validRoomPayload, date: "Mon, 02 Dec 2024", joiningFee: 199 }),
  });
  console.log("4d. ELITE Host + ₹199 Create Status:", eliteRes1.status, "(Expected 201)");
  if (eliteRes1.status !== 201) throw new Error("Expected 201 for ELITE host at ₹199 fee");

  const eliteRes2 = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ ...validRoomPayload, joiningFee: 200 }),
  });
  console.log("4d. ELITE Host + ₹200 Create Status:", eliteRes2.status, "(Expected 400)");
  if (eliteRes2.status !== 400) throw new Error("Expected 400 for ELITE host at ₹200 fee");

  // 5. Authenticate Host B for Ownership Tests
  const phoneB = `+91 98${runId}02`;
  const reqResB = await fetch(`${BASE_URL}/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneB }),
  });
  const reqDataB = await reqResB.json();
  if (!reqDataB.success) throw new Error(`OTP Request B failed: ${reqDataB.message}`);
  const devOtpB = reqDataB.devOtp;

  const verifyResB = await fetch(`${BASE_URL}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneB, otp: devOtpB }),
  });
  const verifyDataB = await verifyResB.json();
  if (!verifyDataB.success || !verifyDataB.token) {
    throw new Error(`OTP Verification B failed: ${verifyDataB.message}`);
  }
  const tokenB = verifyDataB.token;
  if (verifyDataB.user?.id) createdUserIds.push(verifyDataB.user.id);

  await fetch(`${BASE_URL}/users/onboarding`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      name: "Priya Sharma",
      bio: "Tech enthusiast",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
      homeCity: "Bengaluru",
      interests: ["Technology"],
      activeMode: "HOST",
    }),
  });
  console.log("5. Host B authenticated and onboarded.");

  // 5.1 Host B /my-rooms isolation check (must be empty array 0 rooms)
  const myRoomsResB0 = await fetch(`${BASE_URL}/rooms/my-rooms`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const myRoomsDataB0 = await myRoomsResB0.json();
  console.log("5.1 Host B initial /my-rooms count:", myRoomsDataB0.rooms?.length, "(Expected 0)");
  if (!myRoomsDataB0.success || myRoomsDataB0.rooms?.length !== 0) {
    throw new Error(`Host B should have 0 rooms initially! Got ${myRoomsDataB0.rooms?.length}`);
  }
  const patchResA = await fetch(`${BASE_URL}/rooms/${roomId1}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ title: "Updated Movie Dinner Topic" }),
  });
  console.log("5a. Host A Edit Own Room Status:", patchResA.status, "(Expected 200)");
  if (patchResA.status !== 200) throw new Error("Host A failed to edit own room draft");

  // 5b. Host B cannot edit Host A's room -> 403
  const patchResB = await fetch(`${BASE_URL}/rooms/${roomId1}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({ title: "Hacked Topic" }),
  });
  console.log("5b. Host B Edit Host A's Room Status:", patchResB.status, "(Expected 403)");
  if (patchResB.status !== 403) throw new Error("Expected 403 when Host B tries to edit Host A's room");

  // 5c. Host B cannot publish Host A's room -> 403
  const publishResB = await fetch(`${BASE_URL}/rooms/${roomId1}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenB}`,
    },
  });
  console.log("5c. Host B Publish Host A's Room Status:", publishResB.status, "(Expected 403)");
  if (publishResB.status !== 403) throw new Error("Expected 403 when Host B tries to publish Host A's room");

  // 5d. Host B cannot view Host A's DRAFT room -> 403
  const getDraftResB = await fetch(`${BASE_URL}/rooms/${roomId1}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log("5d. Host B View Host A's Draft Status:", getDraftResB.status, "(Expected 403)");
  if (getDraftResB.status !== 403) throw new Error("Expected 403 when Host B views Host A's draft");

  // 6. Publish Room
  const publishResA = await fetch(`${BASE_URL}/rooms/${roomId1}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenA}`,
    },
  });
  const publishDataA = await publishResA.json();
  console.log("6. Host A Publish Room Status:", publishResA.status, "State:", publishDataA.room?.status, "PublishedAt:", publishDataA.room?.publishedAt);
  if (publishResA.status !== 200 || publishDataA.room?.status !== "PUBLISHED" || !publishDataA.room?.publishedAt) {
    throw new Error("Failed to publish room or state/publishedAt did not update properly!");
  }

  // 7. Reads & My Rooms
  // 7a. Published room can now be retrieved by anyone
  const getPubResB = await fetch(`${BASE_URL}/rooms/${roomId1}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log("7a. Host B View Published Room Status:", getPubResB.status, "(Expected 200)");
  if (getPubResB.status !== 200) throw new Error("Failed to view published room");

  // 7b. /my-rooms returns only authenticated user's rooms
  const myRoomsResA = await fetch(`${BASE_URL}/rooms/my-rooms`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const myRoomsDataA = await myRoomsResA.json();
  console.log("7b. Host A /my-rooms count:", myRoomsDataA.rooms?.length);
  if (!myRoomsDataA.rooms?.every((r) => r.hostId === userAId)) {
    throw new Error("/my-rooms returned rooms belonging to another user!");
  }

  // 8. Data integrity
  // Client cannot change hostId or state via PATCH
  const tamperRes = await fetch(`${BASE_URL}/rooms/${roomId1}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ hostId: "fake-host-id", confirmedParticipantsCount: 99, status: "DRAFT" }),
  });
  const tamperData = await tamperRes.json();
  if (tamperData.room.hostId !== userAId) throw new Error("Client managed to tamper hostId via PATCH!");
  if (tamperData.room.confirmedParticipantsCount === 99) throw new Error("Client managed to tamper confirmedParticipantsCount via PATCH!");
  if (tamperData.room.status === "DRAFT") throw new Error("Client managed to tamper status via PATCH!");

  console.log("8. Data integrity protections verified.");

  // 9. Low Capacity Test (capacity below 4, e.g. capacity = 2)
  const lowCapRes = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      title: "Intimate Dinner for 2",
      description: "Cozy 2-person dinner discussion",
      venueName: "Olive Bar & Kitchen",
      venueAddress: "Indiranagar",
      city: "Bengaluru",
      capacity: 2,
      joiningFee: 99,
      interests: ["Food", "General Conversation"],
    }),
  });
  const lowCapData = await lowCapRes.json();
  console.log("9. Low capacity (capacity = 2) create status:", lowCapRes.status, "capacity:", lowCapData.room?.capacity);
  if (lowCapRes.status !== 201 || lowCapData.room?.capacity !== 2) {
    throw new Error(`Failed to create room with capacity below 4! Expected status 201 and capacity 2, got ${lowCapRes.status}`);
  }

  console.log("\n✅ ALL BACKEND STEP 3A ROOM TESTS PASSED SUCCESSFULLY!");
  } finally {
    await cleanTestFixtureIds(prisma, { userIds: createdUserIds });
    await prisma.$disconnect();
  }
}

runStep3aTests().catch(async (err) => {
  console.error("❌ Test Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
