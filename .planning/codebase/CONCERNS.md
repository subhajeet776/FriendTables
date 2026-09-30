# Codebase Concerns

**Analysis Date:** 2026-09-30

## Tech Debt

**Local SQLite Database in Backend:**
- Issue: SQLite (`file:./dev.db`) is configured as the Prisma database provider in `backend/prisma/schema.prisma`.
- Files: `backend/prisma/schema.prisma:1-4`, `backend/.env`.
- Impact: SQLite locks the database file on writes, causing write bottlenecks and concurrency errors under concurrent check-ins, payments, and messaging.
- Fix approach: Migrate `datasource db` in `schema.prisma` to `provider = "postgresql"` and point `DATABASE_URL` to a managed PostgreSQL instance (e.g. Supabase, Neon, AWS RDS).

**In-Memory Single-Process Socket.IO:**
- Issue: Socket.IO server is attached directly to the local HTTP server without a distributed Pub/Sub adapter.
- Files: `backend/src/socket.ts:1-27`, `backend/src/index.ts:25-27`.
- Impact: Cannot scale backend horizontally across multiple server instances or containers; users connected to instance A will miss messages sent from instance B.
- Fix approach: Integrate `@socket.io/redis-adapter` with a Redis connection for distributed room channel broadcasting.

**Legacy Mock Data Files:**
- Issue: Static mock datasets (`src/mock/mockUsers.ts`, `src/mock/mockRooms.ts`, `src/mock/mockRequests.ts`, `src/mock/mockChats.ts`) remain in the codebase despite the app migrating to live backend APIs.
- Files: `src/mock/`.
- Impact: Dead code creating developer confusion regarding whether mock data is actively queried.
- Fix approach: Remove or archive `src/mock/` once all integration testing is standardized.

**In-Process Interval for Lifecycle Jobs:**
- Issue: Room auto-closure and expiration timing runs via `setInterval` in the main Express process.
- Files: `backend/src/index.ts:83-88`, `backend/src/utils/roomTiming.ts`.
- Impact: Vulnerable to server restarts, memory leaks, and redundant execution if scaled across multiple instances.
- Fix approach: Offload scheduled room lifecycle transitions to a dedicated background worker queue (e.g. BullMQ, Celery, or serverless cron).

## Known Bugs

**Git Repository Not Initialized:**
- Symptoms: `git` commands fail with `fatal: not a git repository (or any of the parent directories): .git`.
- Files: Root project directory.
- Trigger: Running git status, git commit, or git branch commands.
- Workaround / Fix: Run `git init`, add initial commit, and configure remote tracking.

## Security Considerations

**Dev OTP Exposure in Non-Production:**
- Risk: `DEV_EXPOSE_OTP="true"` outputs user OTPs in API responses and console logs.
- Files: `backend/src/routes/auth.ts`, `backend/src/.env`.
- Current mitigation: Guarded by environment flag `DEV_EXPOSE_OTP`.
- Recommendations: Enforce strict check ensuring `DEV_EXPOSE_OTP` is unconditionally `false` whenever `NODE_ENV === "production"`.

**Razorpay Test Secret Keys:**
- Risk: Hardcoded fallback secret string (`"frientables_dev_test_secret_2026"`) in payment route when environment variables are omitted.
- Files: `backend/src/routes/payment.ts:258`.
- Current mitigation: Relies on `process.env.RAZORPAY_KEY_SECRET`.
- Recommendations: Throw a startup error if `RAZORPAY_KEY_SECRET` is undefined in production instead of falling back to a string literal.

## Performance Bottlenecks

**Frequent Full Room List Queries:**
- Problem: Screen focus on `(tabs)/index.tsx` and `(tabs)/discover.tsx` performs frequent room listing requests without cursor pagination.
- Files: `backend/src/routes/room.ts:168`, `src/services/roomService.ts`.
- Cause: `prisma.room.findMany()` loads all matching rooms in the city without limit/offset or cursor slicing.
- Improvement path: Introduce cursor-based pagination (`cursor` and `take`) in `GET /api/v1/rooms`.

## Fragile Areas

**QR Code Expiration Window:**
- Files: `backend/src/services/checkInService.ts:6`, `app/check-in/[roomId].tsx`.
- Why fragile: 3-minute QR token expiration window (`QR_EXPIRATION_SECONDS = 180`) can cause failed check-ins if hosts and joinees experience cellular latency or delay scanning.
- Safe modification: Add client-side visual timer countdown with auto-regeneration button before expiration.
- Test coverage: Covered by `backend/test_checkin_step6a.js`.

**Time Parsing and Date Boundary Handling:**
- Files: `backend/src/utils/roomTiming.ts`, `backend/src/routes/room.ts:23-54`.
- Why fragile: Parsing composite human date/time strings (`"Sat, 16 Nov 2024"`, `"8:00 PM"`) across different timezones can introduce date offset bugs.
- Safe modification: Migrate completely to ISO-8601 UTC timestamps (`dateTime` column on `Room` table) and format client-side using user local timezone.

## Scaling Limits

**Concurrent Check-In Sessions:**
- Current capacity: Up to ~20 concurrent database writes on local SQLite before experiencing busy/lock timeouts.
- Limit: SQLite concurrency wall.
- Scaling path: PostgreSQL migration with connection pooling via PgBouncer.

## Dependencies at Risk

**React 19 & Expo SDK 57 Early Adopter Boundary:**
- Risk: React 19 (`19.2.3`) and Expo SDK 57 (`~57.0.0`) are cutting-edge releases with ongoing ecosystem package compatibility updates (e.g. NativeWind 4 / Reanimated 4 integration).
- Impact: Potential minor warning logs or peer dependency mismatch warnings during npm installs.
- Migration plan: Keep dependencies aligned with Expo official SDK compatibility matrix.

## Missing Critical Features

**Native Push Notifications (APNs / FCM):**
- Problem: Push notifications are currently limited to in-app WebSocket events when the app is active and in foreground.
- Blocks: Joinees receiving dinner approval alerts or payment deadlines while the mobile app is in the background or device is locked.
- Fix approach: Integrate `expo-notifications` with Apple APNs and Firebase Cloud Messaging (FCM).

**Production Identity Verification:**
- Problem: Government ID verification (`isIdentityVerified`) is currently a database flag without an automated verification provider (e.g. DigiLocker or Persona).
- Blocks: Automated host tier advancement to ELITE.

## Test Coverage Gaps

**Automated Frontend Unit / Component Tests:**
- What's not tested: Screen rendering, navigation interactions, and hook state changes under `app/` and `src/design-system/`.
- Files: `app/**/*.tsx`, `src/design-system/**/*.tsx`.
- Risk: UI regressions when modifying design tokens or components.
- Priority: Medium

**CI Automated Regression Pipeline:**
- What's not tested: Backend route integration tests are not automatically run on PR or commit.
- Files: `backend/test_*.js`.
- Risk: Breaking changes pushed without running the verification scripts.
- Priority: High

---

*Concerns audit: 2026-09-30*
