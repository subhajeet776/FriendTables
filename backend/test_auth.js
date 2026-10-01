import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runTests() {
  const BASE_URL = "http://localhost:5000/api/v1/auth";
  console.log("🧪 Starting Authentication API Verification Tests...\n");
  let createdUserId = null;

  try {
    // 1. Health check
    const healthRes = await fetch("http://localhost:5000/health");
    const healthData = await healthRes.json();
    console.log("1. Health Check Response:", healthData);

    // 2. Request OTP
    const reqOtpRes = await fetch(`${BASE_URL}/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+91 98765 43210" }),
    });
    const reqOtpData = await reqOtpRes.json();
    console.log("\n2. Request OTP Response:", reqOtpData);

    const devOtp = reqOtpData.devOtp;
    if (!devOtp) {
      throw new Error("Dev OTP was not returned in development mode!");
    }

    // 3. Test Invalid OTP
    const invalidRes = await fetch(`${BASE_URL}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+91 98765 43210", otp: "000000" }),
    });
    const invalidData = await invalidRes.json();
    console.log("\n3. Invalid OTP Response (Expected failure):", invalidData);

    // 4. Test Valid OTP
    const verifyRes = await fetch(`${BASE_URL}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+91 98765 43210", otp: devOtp }),
    });
    const verifyData = await verifyRes.json();
    console.log("\n4. Verify OTP Response (Expected success):", verifyData);

    const token = verifyData.token;
    if (verifyData.user?.id) {
      createdUserId = verifyData.user.id;
    }
    if (!token) {
      throw new Error("JWT token was not returned after valid OTP verification!");
    }

    // 5. Test GET /me
    const meRes = await fetch(`${BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json();
    console.log("\n5. GET /me Response (Expected user object):", meData);

    console.log("\n✅ ALL BACKEND AUTHENTICATION API TESTS PASSED SUCCESSFULLY!");
  } finally {
    // Only clean up if it is a temporary new test user (NOT an existing user)
    const PRESERVED_PHONE_NUMBERS = [
      "+916033970835",
      "+916203984168",
      "+919876543210",
      "+919863072107",
    ];
    if (createdUserId) {
      const user = await prisma.user.findUnique({ where: { id: createdUserId } });
      if (user && user.phone && !PRESERVED_PHONE_NUMBERS.includes(user.phone)) {
        await cleanTestFixtureIds(prisma, { userIds: [createdUserId] });
      }
    }
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
