# External Integrations

**Analysis Date:** 2026-09-30

## APIs & External Services

**Payment Processing:**
- Razorpay Payments API - Used for Joinee table joining fee payments with automatic 70% Host / 30% Platform split.
  - SDK/Client: `razorpay` (`^2.9.8` in `backend/package.json`) and server-side HMAC-SHA256 signature verification in `backend/src/routes/payment.ts`.
  - Auth / Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
  - Client interface: `src/services/paymentApi.ts` interacting with backend order creation and payment verification endpoints.

**Real-Time Messaging & Sockets:**
- Socket.IO WebSockets - Bi-directional real-time communication for dining room group chat channels, live check-in attendee confirmations, and personal notifications.
  - Server: `backend/src/socket.ts` initialized on HTTP server with JWT handshake authentication.
  - Client: `socket.io-client` (`^4.8.3`) in `src/services/chatSocket.ts`.
  - Channels / Rooms:
    - `room:${roomId}` - Group chat messaging and participant check-in events (`new_message`, `participant_checked_in`).
    - `user:${userId}` - Direct real-time notifications (`new_notification`, `notification:received`).

**Maps & Navigation:**
- Google Maps URL integration (`googleMapsUrl` on `Room` model in `schema.prisma`) allowing joinees and hosts to navigate directly to restaurant venue locations.

## Data Storage

**Databases:**
- SQLite (Development) / PostgreSQL (Production ready via Prisma)
  - Connection: `DATABASE_URL` (configured as `file:./dev.db` in `backend/.env`)
  - Client / ORM: `@prisma/client` (`^5.22.0`) managed via `backend/prisma/schema.prisma` and initialized singleton in `backend/src/db.ts`.
  - Models: `User`, `OtpChallenge`, `Room`, `JoinRequest`, `RoomParticipant`, `Payment`, `RoomMessage`, `Notification`, `RoomAttendance`, `RoomCheckInSession`, `Rating`, `LoyaltyReward`, `Penalty`.

**File Storage:**
- Remote Unsplash / CDN image URLs stored as string attributes (`avatarUrl`, `imageUrl`).
- Local device cache managed via `@react-native-async-storage/async-storage` for tokens, onboarding, and tour flags (`src/services/tourStorage.ts`).

**Caching:**
- In-memory TanStack Query cache (`@tanstack/react-query`) on mobile client (`app/_layout.tsx`).
- No distributed Redis cache currently deployed; state is tracked directly via Prisma transactions.

## Authentication & Identity

**Auth Provider:**
- Custom OTP-based Authentication (Phone & Email) with Stateless JWT:
  - Implementation: `backend/src/routes/auth.ts`, `backend/src/utils/crypto.ts`, `backend/src/utils/jwt.ts`.
  - OTP generation: 6-digit random code hashed using HMAC-SHA256 with `JWT_SECRET` salt and stored in `OtpChallenge` table with expiration and attempt limiting.
  - Development bypass: `DEV_EXPOSE_OTP="true"` outputs OTP in server console and dev API response for friction-free testing.
  - Session Token: Signed HS256 JWT containing `{ userId, phone, email }` with standard 7-day expiration (`JWT_EXPIRES_IN="7d"`).
  - Client Token Storage: `src/services/authApi.ts` using `AsyncStorage` (`@frientables_auth_token`, `@frientables_user_profile`).

## Monitoring & Observability

**Error Tracking:**
- Console logging with structured timestamp formats. Sentry / Datadog not currently integrated.

**Logs:**
- Server startup banner printing LAN IPv4, Host, Port, and mode status (`backend/src/index.ts`).
- Route errors caught and logged via Express try/catch blocks with JSON status payloads.
- Socket connection, disconnection, and room channel join logs in `backend/src/socket.ts`.

## CI/CD & Deployment

**Hosting:**
- Mobile Client: EAS (Expo Application Services) / Metro development server.
- Backend API: Node.js server designed for host execution (`0.0.0.0:${PORT}`).

**CI Pipeline:**
- None configured in repository (no `.github/workflows` detected).

## Environment Configuration

**Required env vars:**
- **Frontend (`.env`):**
  - `EXPO_PUBLIC_API_URL` - Backend API base endpoint (e.g. `http://localhost:5000/api/v1` or `http://<LAN_IP>:5000/api/v1`).
- **Backend (`backend/.env`):**
  - `PORT` - HTTP listening port (default `5000`).
  - `HOST` - Host binding interface (default `0.0.0.0`).
  - `DATABASE_URL` - Database connection string (`file:./dev.db`).
  - `JWT_SECRET` - Cryptographic signing key for JWT tokens and OTP hashing.
  - `JWT_EXPIRES_IN` - Token TTL (e.g. `7d`).
  - `NODE_ENV` - Environment identifier (`development` or `production`).
  - `DEV_EXPOSE_OTP` - Boolean toggle to surface OTP in responses during dev/testing.
  - `RAZORPAY_KEY_ID` - Razorpay merchant key id.
  - `RAZORPAY_KEY_SECRET` - Razorpay merchant secret key.

**Secrets location:**
- Stored locally in `backend/.env` and `.env` (gitignored). `.env.example` templates provided at project root and `backend/.env.example`.

## Webhooks & Callbacks

**Incoming:**
- Payment verification endpoint: `POST /api/v1/payments/verify` and `POST /api/v1/rooms/:roomId/payment/verify` in `backend/src/routes/payment.ts`.

**Outgoing:**
- Real-time WebSocket event broadcasts via Socket.IO:
  - `new_message`: Pushed to room participants upon chat message creation.
  - `new_notification`: Pushed to target user socket upon join request, approval, payment, or room update.
  - `participant_checked_in`: Pushed to room channel when attendee check-in succeeds.

---

*Integration audit: 2026-09-30*
