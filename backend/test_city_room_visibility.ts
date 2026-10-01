import { prisma } from "./src/db.js";
import { signToken } from "./src/utils/jwt.js";
import { normalizeCityName, getCityMatchCandidates } from "./src/utils/city.js";

const BASE_URL = "http://localhost:5000/api/v1";

async function runCityRoomVisibilityTests() {
  console.log("==================================================");
  console.log("CITY-BASED ROOM VISIBILITY TEST SUITE");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, extraInfo = "") {
    if (condition) {
      console.log(`✅ PASS: ${testName} ${extraInfo}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${extraInfo}`);
      failed++;
    }
  }

  // 1. City Normalization Unit Checks
  console.log("--- 1. Testing City Normalization ---");
  assert(normalizeCityName("phagwara") === "Phagwara", "phagwara -> Phagwara");
  assert(normalizeCityName("PHAGWARA") === "Phagwara", "PHAGWARA -> Phagwara");
  assert(normalizeCityName("Phagwara") === "Phagwara", "Phagwara -> Phagwara");
  assert(normalizeCityName("ludhiana") === "Ludhiana", "ludhiana -> Ludhiana");
  assert(normalizeCityName("bangalore") === "Bengaluru", "bangalore -> Bengaluru");
  assert(normalizeCityName("bengaluru") === "Bengaluru", "bengaluru -> Bengaluru");
  assert(normalizeCityName("bombay") === "Mumbai", "bombay -> Mumbai");
  assert(normalizeCityName("delhi ncr") === "Delhi NCR", "delhi ncr -> Delhi NCR");

  const phagwaraCandidates = getCityMatchCandidates("phagwara");
  assert(phagwaraCandidates.includes("Phagwara"), "phagwara candidates include Phagwara");
  assert(phagwaraCandidates.includes("phagwara"), "phagwara candidates include phagwara");

  // 2. Fetch Host User and generate Auth Token
  console.log("\n--- 2. Setting Up Host Authentication ---");
  const hostUser = await prisma.user.findFirst({
    where: { activeMode: "HOST" },
  });
  assert(Boolean(hostUser), "Found Host user in database", `(${hostUser?.name}, ID: ${hostUser?.id})`);

  if (!hostUser) {
    console.error("No Host user found. Aborting.");
    process.exit(1);
  }

  const hostToken = signToken({ userId: hostUser.id });

  let roomAId: string | null = null;
  let roomBId: string | null = null;

  try {
    // 3. Create Room A in Phagwara
    console.log("\n--- 3. Host Creating Room A in Phagwara ---");
    const createRoomARes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        title: "Punjabi Feast & Tech Talk",
        description: "Dinner discussion on tech in Phagwara",
        interests: ["Technology", "Food"],
        venueName: "Haveli Restaurant",
        venueAddress: "GT Road, Phagwara Bypass",
        city: "Phagwara",
        date: "Oct 25, 2026",
        time: "7:30 PM - 9:30 PM",
        capacity: 4,
        joiningFee: 0,
      }),
    });

    const createRoomAData = await createRoomARes.json();
    assert(createRoomARes.status === 201 && createRoomAData.success, "Host created Room A draft with city 'Phagwara'");
    roomAId = createRoomAData.room?.id;
    assert(Boolean(roomAId), "Room A ID exists", `(ID: ${roomAId})`);

    // 4. Confirm Database Record for Room A
    const roomADb = await prisma.room.findUnique({ where: { id: roomAId! } });
    assert(roomADb?.city === "Phagwara", "Room A database record has city = 'Phagwara'");

    // 5. Publish Room A
    const publishARes = await fetch(`${BASE_URL}/rooms/${roomAId}/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const publishAData = await publishARes.json();
    assert(publishARes.status === 200 && publishAData.success, "Room A successfully published");

    // 6. Joinee Browsing Phagwara -> Room A appears
    console.log("\n--- 4. Testing Discovery with browsingCity = 'Phagwara' ---");
    const phagwaraRoomsRes = await fetch(`${BASE_URL}/rooms?city=Phagwara`);
    const phagwaraRoomsData = await phagwaraRoomsRes.json();
    assert(phagwaraRoomsRes.status === 200 && phagwaraRoomsData.success, "GET /rooms?city=Phagwara succeeds");
    const foundRoomAInPhagwara = phagwaraRoomsData.rooms?.some((r: any) => r.id === roomAId);
    assert(foundRoomAInPhagwara, "Room A appears when browsing 'Phagwara'");

    // 7. Case-insensitive query: city = 'phagwara'
    const lowerPhagwaraRes = await fetch(`${BASE_URL}/rooms?city=phagwara`);
    const lowerPhagwaraData = await lowerPhagwaraRes.json();
    const foundRoomAInLower = lowerPhagwaraData.rooms?.some((r: any) => r.id === roomAId);
    assert(foundRoomAInLower, "Room A appears when querying lowercase 'phagwara'");

    // 8. Joinee Browsing Ludhiana -> Room A does NOT appear
    console.log("\n--- 5. Testing Discovery with browsingCity = 'Ludhiana' ---");
    const ludhianaRoomsRes = await fetch(`${BASE_URL}/rooms?city=Ludhiana`);
    const ludhianaRoomsData = await ludhianaRoomsRes.json();
    assert(ludhianaRoomsRes.status === 200 && ludhianaRoomsData.success, "GET /rooms?city=Ludhiana succeeds");
    const foundRoomAInLudhiana = ludhianaRoomsData.rooms?.some((r: any) => r.id === roomAId);
    assert(!foundRoomAInLudhiana, "Room A does NOT appear when browsing 'Ludhiana'");

    // 9. Joinee Browsing Bengaluru -> Room A does NOT appear
    console.log("\n--- 6. Testing Discovery with browsingCity = 'Bengaluru' ---");
    const blrRoomsRes = await fetch(`${BASE_URL}/rooms?city=Bengaluru`);
    const blrRoomsData = await blrRoomsRes.json();
    assert(blrRoomsRes.status === 200 && blrRoomsData.success, "GET /rooms?city=Bengaluru succeeds");
    const foundRoomAInBlr = blrRoomsData.rooms?.some((r: any) => r.id === roomAId);
    assert(!foundRoomAInBlr, "Room A does NOT appear when browsing 'Bengaluru'");

    // 10. Create Room B in Ludhiana
    console.log("\n--- 7. Host Creating Room B in Ludhiana ---");
    const createRoomBRes = await fetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        title: "Ludhiana Entrepreneurs Dinner",
        description: "Business talk in Ludhiana",
        interests: ["Technology", "Books"],
        venueName: "Yellow Chilli",
        venueAddress: "Sarabha Nagar, Ludhiana",
        city: "Ludhiana",
        date: "Oct 26, 2026",
        time: "8:00 PM - 10:00 PM",
        capacity: 6,
        joiningFee: 0,
      }),
    });

    const createRoomBData = await createRoomBRes.json();
    assert(createRoomBRes.status === 201 && createRoomBData.success, "Host created Room B draft with city 'Ludhiana'");
    roomBId = createRoomBData.room?.id;
    assert(Boolean(roomBId), "Room B ID exists", `(ID: ${roomBId})`);

    const roomBDb = await prisma.room.findUnique({ where: { id: roomBId! } });
    assert(roomBDb?.city === "Ludhiana", "Room B database record has city = 'Ludhiana'");

    // Publish Room B
    const publishBRes = await fetch(`${BASE_URL}/rooms/${roomBId}/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const publishBData = await publishBRes.json();
    assert(publishBRes.status === 200 && publishBData.success, "Room B successfully published");

    // 11. Cross-City Isolation Verification
    console.log("\n--- 8. Cross-City Isolation Verification ---");
    // While browsing Phagwara: Room A is shown, Room B is NOT shown
    const verifyPhagwaraRes = await fetch(`${BASE_URL}/rooms?city=Phagwara`);
    const verifyPhagwaraData = await verifyPhagwaraRes.json();
    const hasAInPhagwara = verifyPhagwaraData.rooms?.some((r: any) => r.id === roomAId);
    const hasBInPhagwara = verifyPhagwaraData.rooms?.some((r: any) => r.id === roomBId);
    assert(hasAInPhagwara, "Browsing Phagwara: Room A is visible");
    assert(!hasBInPhagwara, "Browsing Phagwara: Room B (Ludhiana) is NOT visible");

    // While browsing Ludhiana: Room B is shown, Room A is NOT shown
    const verifyLudhianaRes = await fetch(`${BASE_URL}/rooms?city=Ludhiana`);
    const verifyLudhianaData = await verifyLudhianaRes.json();
    const hasAInLudhiana = verifyLudhianaData.rooms?.some((r: any) => r.id === roomAId);
    const hasBInLudhiana = verifyLudhianaData.rooms?.some((r: any) => r.id === roomBId);
    assert(hasBInLudhiana, "Browsing Ludhiana: Room B is visible");
    assert(!hasAInLudhiana, "Browsing Ludhiana: Room A (Phagwara) is NOT visible");

    // 12. Host Switching Back to Phagwara
    console.log("\n--- 9. Switching Joinee Back to Phagwara ---");
    const switchBackRes = await fetch(`${BASE_URL}/rooms?city=Phagwara`);
    const switchBackData = await switchBackRes.json();
    const foundRoomAAgain = switchBackData.rooms?.some((r: any) => r.id === roomAId);
    assert(foundRoomAAgain, "Switching back to Phagwara: Room A appears again");

  } finally {
    // Clean up created test rooms
    console.log("\n--- 10. Cleaning Up Test Rooms ---");
    if (roomAId) {
      await prisma.room.delete({ where: { id: roomAId } }).catch(() => {});
      console.log(`Cleaned up Room A (${roomAId})`);
    }
    if (roomBId) {
      await prisma.room.delete({ where: { id: roomBId } }).catch(() => {});
      console.log(`Cleaned up Room B (${roomBId})`);
    }
  }

  console.log("\n==================================================");
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) process.exit(1);
}

runCityRoomVisibilityTests();
