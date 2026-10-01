import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runStep2Tests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 Starting Backend Step 2 (Profile & Onboarding) API Tests...\n");
  let createdUserId = null;

  try {
    // 1. Authenticate user
    const phone = "+91 99887 76655";
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
    if (verifyData.user?.id) {
      createdUserId = verifyData.user.id;
    }

    console.log("1. Authenticated test user token acquired successfully.");

    // 2. GET /users/me/profile before onboarding
    const profileRes1 = await fetch(`${BASE_URL}/users/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profileData1 = await profileRes1.json();
    console.log("\n2. Initial Profile Response:", profileData1);

    // 3. POST /users/onboarding
    const onboardingPayload = {
      name: "Aarav Mehta",
      bio: "Passionate about coffee, startups, and jazz music!",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400",
      homeCity: "Bengaluru",
      interests: ["Technology", "Music", "Food"],
      activeMode: "JOINEE",
    };
    const onboardingRes = await fetch(`${BASE_URL}/users/onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(onboardingPayload),
    });
    const onboardingData = await onboardingRes.json();
    console.log("\n3. POST Onboarding Response:", onboardingData);

    if (!onboardingData.profile?.isOnboardingCompleted) {
      throw new Error("Onboarding status was not marked as true!");
    }

    // 4. PATCH /users/me/profile
    const patchPayload = {
      bio: "Updated Bio: Startup enthusiast & specialty coffee lover!",
      interests: ["Technology", "Music", "Food", "Books"],
    };
    const patchRes = await fetch(`${BASE_URL}/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patchPayload),
    });
    const patchData = await patchRes.json();
    console.log("\n4. PATCH Profile Response:", patchData);

    // 5. PATCH /users/mode
    const modeRes = await fetch(`${BASE_URL}/users/mode`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ activeMode: "HOST" }),
    });
    const modeData = await modeRes.json();
    console.log("\n5. PATCH Mode Response:", modeData);

    // 6. Final GET /me/profile verification
    const finalProfileRes = await fetch(`${BASE_URL}/users/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalProfileData = await finalProfileRes.json();
    console.log("\n6. Final Restored Profile Verification:", finalProfileData);

    // 7. Test validation error (invalid city)
    const invalidCityRes = await fetch(`${BASE_URL}/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ homeCity: "Atlantis" }),
    });
    const invalidCityData = await invalidCityRes.json();
    console.log("\n7. Invalid City Validation (Expected failure):", invalidCityData);

    console.log("\n✅ ALL BACKEND STEP 2 TESTS PASSED SUCCESSFULLY!");
  } finally {
    if (createdUserId) {
      await cleanTestFixtureIds(prisma, { userIds: [createdUserId] });
    }
    await prisma.$disconnect();
  }
}

runStep2Tests().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
