# Testing Patterns

**Analysis Date:** 2026-09-30

## Test Framework

**Runner:**
- Current Implementation: Standalone Node.js verification scripts executing native ES modules via `node` / `tsx`.
- Automated test suites (Jest / Vitest) are not yet integrated into `package.json`.
- Config: No `jest.config.js` or `vitest.config.ts` currently exists.

**Assertion Library:**
- Native JavaScript runtime assertions (`throw new Error(...)` or `console.assert`) inside verification test scripts.

**Run Commands:**
```bash
# Backend verification scripts (must have backend server running on port 5000):
node backend/test_auth.js                              # Test OTP & auth verification flow
node backend/test_rooms_step3a.js                      # Test room CRUD & queries
node backend/test_join_requests_step4a.js              # Test join requests & host decisions
node backend/test_payments_step4b.js                   # Test Razorpay order & verification
node backend/test_chat_step5a.js                       # Test room chat REST & WebSocket
node backend/test_notifications_step5b.js              # Test notification dispatch
node backend/test_checkin_step6a.js                    # Test QR token generation & check-in
node backend/test_step6b.js                            # Test attendance & room completion
node backend/test_two_way_rating.js                    # Test two-way review calculations
node backend/test_loyalty_step7a.js                    # Test loyalty passport milestone logic
node backend/test_room_conflict_prevention.ts          # Test schedule collision checks
node backend/test_penalty_and_cancellation.ts          # Test host/joinee penalty deductions
```

## Test File Organization

**Location:**
- Located directly in `backend/` as standalone step verification scripts.
- Helper utilities in `backend/testCleanup.ts` and `backend/clean_test_fixtures.ts`.

**Naming:**
- Verification scripts follow the pattern: `test_<feature>_<step>.js` or `test_<feature>.ts` (e.g. `test_auth.js`, `test_checkin_step6a.js`, `test_room_conflict_prevention.ts`).

**Structure:**
```
backend/
├── testCleanup.ts                            # Test data isolation and fixture cleanup utilities
├── clean_test_fixtures.ts                    # Script to purge test data from SQLite
├── test_auth.js                              # Auth flow verification
├── test_rooms_step3a.js                      # Room creation & queries
├── test_join_requests_step4a.js              # Request handling
├── test_payments_step4b.js                   # Payment split & status
├── test_chat_step5a.js                       # Messaging
├── test_notifications_step5b.js              # Push/in-app notifications
├── test_checkin_step6a.js                    # QR check-in
├── test_two_way_rating.js                    # Ratings
└── test_room_conflict_prevention.ts          # Conflict avoidance
```

## Test Structure

**Suite Organization Pattern:**
```javascript
import { PrismaClient } from "@prisma/client";
import { cleanTestFixtureIds } from "./testCleanup.ts";

const prisma = new PrismaClient();

async function runTests() {
  const BASE_URL = "http://localhost:5000/api/v1";
  console.log("🧪 Starting Verification Tests...\n");
  const testIds = [];

  try {
    // 1. Setup & pre-conditions
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("Health check failed");

    // 2. Action under test
    const actionRes = await fetch(`${BASE_URL}/endpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ... }),
    });
    const actionData = await actionRes.json();

    // 3. Assertions
    if (!actionData.success) {
      throw new Error(`Expected success, got: ${JSON.stringify(actionData)}`);
    }

    console.log("✅ All verification tests passed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    // 4. Cleanup
    await cleanTestFixtureIds(testIds);
    await prisma.$disconnect();
  }
}

runTests();
```

## Mocking

**Framework:** None currently used. Tests execute against the live local Express server and local SQLite database (`dev.db`).

**Patterns:**
- `DEV_EXPOSE_OTP="true"`: Eliminates the need to mock SMS or email providers by surfacing the generated OTP in development API responses.
- Razorpay test keys: Uses test merchant key pairs (`rzp_test_*`) with deterministic signature generation for test orders.

**What to Mock (Future Recommendations):**
- External payment gateway network calls (Razorpay Webhooks).
- Camera hardware APIs in mobile component tests (`expo-camera`).
- Expo Haptics and Push Notification services.

**What NOT to Mock:**
- Prisma schema queries and database constraints (must run against SQLite or PostgreSQL).
- Token hashing and HMAC-SHA256 signature verification in `backend/src/utils/crypto.ts`.
- Room schedule conflict logic in `backend/src/services/roomConflictService.ts`.

## Fixtures and Factories

**Test Data Patterns:**
- Dedicated fixture cleanup utility: `backend/testCleanup.ts` tracks created user, room, and session IDs during test execution and guarantees their deletion in `finally` blocks.
- Reference mock fixtures exist in `src/mock/` (`mockUsers.ts`, `mockRooms.ts`, `mockRequests.ts`), but production client code connects directly to real backend endpoints.

## Coverage

**Requirements:** No formal coverage minimum enforced in CI currently.
**Target Recommendation:** Introduce Jest / React Native Testing Library for client components and Supertest + Jest/Vitest for backend route coverage targeting 80%+ on core services.

## Test Types

**Integration Tests:**
- End-to-end HTTP and WebSocket verification scripts (`backend/test_*.js`).
- Tests full lifecycle: User OTP login -> Room creation -> Join request -> Payment -> Check-in -> Chat -> Review.

**Unit Tests:**
- Currently embedded within integration scripts or manual validation. Future goal: isolate domain logic (`roomTiming.ts`, `reputationService.ts`, `feeLimit.ts`) into pure unit tests.

**E2E Tests:**
- Manual verification via Expo Go / mobile simulator.

## Common Patterns

**Async Testing:**
- Standard `async / await` syntax with try/catch wrapping and explicit process exit codes (`process.exit(0)` on success, `process.exit(1)` on error).

**Error Testing:**
- Intentionally submitting invalid credentials (e.g. wrong OTP `000000`, expired tokens, unauthorized room IDs) and verifying that the response code is 400, 401, or 403.

---

*Testing analysis: 2026-09-30*
