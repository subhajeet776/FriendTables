<!-- refreshed: 2026-09-30 -->
# Architecture

**Analysis Date:** 2026-09-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      Mobile Client (Expo / React Native)                 │
├────────────────────┬────────────────────┬───────────────────────────────┤
│ Navigation & Views │ State Stores       │ Design System & Components    │
│ `app/`             │ `src/state/`       │ `src/design-system/`          │
│ - (auth), (app)    │ - authStore.tsx    │ - primitives (Button, Card...)│
│ - (onboarding)     │ - modeStore.tsx    │ - domain (RoomCard, Passport) │
│ - room, chat, check│ - cityStore.tsx    │ - tokens.ts (Colors, Spacing) │
└─────────┬──────────┴─────────┬──────────┴───────────────┬───────────────┘
          │                    │                          │
          ▼                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Client Services & Network Transport                      │
│ `src/services/`                                                         │
│ - authApi.ts, roomApi.ts, requestApi.ts, paymentApi.ts, checkInApi.ts   │
│ - chatSocket.ts (Socket.IO client)                                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTP REST / WebSocket (Port 5000)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Backend Server (Node.js / Express / Socket.IO)           │
├────────────────────┬────────────────────┬───────────────────────────────┤
│ API Routers        │ Domain Services    │ Real-time & Sockets           │
│ `backend/src/routes` `backend/src/services` `backend/src/socket.ts`     │
│ - auth.ts, user.ts │ - reputationService│ - room channels               │
│ - room.ts, chat.ts │ - checkInService   │ - user notifications          │
│ - payment.ts       │ - roomConflictServ │ - check-in broadcasts         │
│ - checkin.ts       │ - loyaltyService   │                               │
│ - loyalty.ts       │ - noShowService    │                               │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Prisma ORM
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Data Persistence (SQLite / PostgreSQL)                   │
│ `backend/prisma/schema.prisma`                                          │
│ - User, Room, JoinRequest, Payment, Attendance, Rating, Loyalty, Penalty│
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root Navigator | App initialization, session loading guard, and routing flow | `app/_layout.tsx`, `app/index.tsx` |
| Auth & Session Store | Token persistence, login, logout, current user profile | `src/state/authStore.tsx` |
| Mode Context | Toggles user experience between Joinee Mode and Host Mode | `src/state/modeStore.tsx` |
| City Context | Multi-city browsing state ("Bengaluru", "Mumbai", etc.) | `src/state/cityStore.tsx` |
| Design System | Reusable UI primitives, styling tokens, and domain widgets | `src/design-system/` |
| Client API Layer | Typed HTTP requests to Express backend endpoints | `src/services/` |
| Express App Entry | Server setup, middleware, CORS, routing mounts, auto-close timer | `backend/src/index.ts` |
| Socket Manager | Authenticated WebSockets, room channels, and event push | `backend/src/socket.ts` |
| Room Timing Engine | Scheduled start/end calculation and auto-closure of expired rooms | `backend/src/utils/roomTiming.ts` |
| Host Reputation Service | Calculates ratings, applies 0.25 penalty deductions, determines host tiers | `backend/src/services/reputationService.ts` |
| Check-In Service | Generates cryptographically secure QR tokens and records attendance | `backend/src/services/checkInService.ts` |
| Conflict Prevention | Ensures users cannot book overlapping rooms concurrently | `backend/src/services/roomConflictService.ts` |
| Loyalty Engine | Computes attended dines milestone rewards (free dine every 5) | `backend/src/services/loyaltyService.ts` |

## Pattern Overview

**Overall:** Modular Layered Client-Server Architecture with Dual-Mode Frontend and Event-Driven Sockets.

**Key Characteristics:**
- **Single Account Dual-Mode:** Users switch seamlessly between "JOINEE" and "HOST" modes without separate logins (`src/state/modeStore.tsx`).
- **Thin Controller / Rich Service Layer:** Express routers validate incoming payloads with Zod and delegate business logic (reputation, conflict checking, payments, timing) to isolated domain services in `backend/src/services/`.
- **Atomic Operations & Consistency:** Critical transitions (e.g. accepting join requests, processing payments, checking in) utilize Prisma queries and checks to prevent race conditions.
- **Offline & Cross-Network Auto-Configuration:** Mobile client dynamically resolves backend IP across physical phone, emulator, and web targets in `src/services/authApi.ts`.

## Layers

**UI Layer (`app/` and `src/design-system/`):**
- Purpose: Render accessible, theme-consistent dark-mode mobile screens.
- Location: `app/` (routes) and `src/design-system/` (components and tokens).
- Contains: React Native components, NativeWind Tailwind styles, Reanimated transitions.
- Depends on: `src/state/`, `src/services/`, `src/types/`.
- Used by: Mobile application users on iOS, Android, and Web.

**Client State & Services Layer (`src/state/`, `src/services/`):**
- Purpose: Manage in-memory state, authentication tokens, and API communication.
- Location: `src/state/`, `src/services/`.
- Contains: React Context providers, AsyncStorage wrappers, REST fetch calls, Socket.IO listeners.
- Depends on: Backend HTTP REST and WebSocket server endpoints.
- Used by: UI screens in `app/`.

**Backend Route Layer (`backend/src/routes/`):**
- Purpose: Ingest incoming HTTP requests, enforce JWT authentication, validate schemas with Zod, and dispatch responses.
- Location: `backend/src/routes/`.
- Contains: Express routers (`authRouter`, `roomRouter`, `paymentRouter`, `checkInRouter`, etc.).
- Depends on: `backend/src/middleware/auth.ts`, `backend/src/services/`, `backend/src/db.ts`.
- Used by: Client HTTP requests.

**Domain Services Layer (`backend/src/services/`, `backend/src/utils/`):**
- Purpose: Enforce business rules, reputation math, fee limits, QR crypto, and room lifecycle schedules.
- Location: `backend/src/services/`, `backend/src/utils/`.
- Contains: Pure functions and Prisma query orchestration.
- Depends on: `backend/src/db.ts`, `backend/src/socket.ts`.
- Used by: Route handlers and background intervals.

**Data Layer (`backend/prisma/`):**
- Purpose: Relational persistence and schema migrations.
- Location: `backend/prisma/schema.prisma`.
- Contains: Prisma models, indices, relational cascades.
- Used by: All backend services and route controllers.

## Data Flow

### Primary Request Path: Discovering & Joining a Dining Room
1. User browses rooms in home/discover tab (`app/(app)/(tabs)/discover.tsx`).
2. Client queries `getPublishedRoomsApi({ city })` in `src/services/roomApi.ts`.
3. Express route `GET /api/v1/rooms` validates query and retrieves published rooms from Prisma (`backend/src/routes/room.ts:168`).
4. Joinee selects room and clicks "Request to Join" (`app/room/[id].tsx`).
5. Client sends `POST /api/v1/rooms/:roomId/join-requests` (`src/services/requestService.ts`).
6. Backend checks user overlap conflicts via `checkUserRoomConflict()` in `backend/src/services/roomConflictService.ts`.
7. Join request created in Prisma, and Host is notified via `createNotification()` and WebSocket (`backend/src/services/notificationService.ts`).
8. Host accepts request (`app/host/requests.tsx`). Joinee receives notification to complete payment.
9. Joinee completes payment (`src/services/paymentApi.ts` -> `POST /api/v1/rooms/:roomId/payment/order` -> verify).
10. Server creates `RoomParticipant` entry, updates room confirmed count, and unlocks room group chat.

### Secondary Flow: QR Code Check-In & Attendance
1. At venue, Host opens Check-In (`app/check-in/[roomId].tsx`) -> calls `POST /api/v1/rooms/:roomId/check-in/sessions`.
2. `createCheckInSession()` in `backend/src/services/checkInService.ts` creates random 32-byte opaque token, hashes with SHA-256, sets 3-minute expiry, and updates room status to `CHECK_IN_OPEN`.
3. Host displays QR code (`react-native-qrcode-svg`).
4. Joinee scans QR code via `expo-camera` -> calls `POST /api/v1/rooms/:roomId/check-in/verify`.
5. Server verifies token hash, marks `RoomAttendance`, and emits `participant_checked_in` over WebSocket channel `room:${roomId}`.
6. Real-time attendee list immediately refreshes on both Host and Joinee screens.

**State Management:**
- Global authentication: `src/state/authStore.tsx`
- App persona mode: `src/state/modeStore.tsx` (`JOINEE` vs `HOST`)
- City browsing: `src/state/cityStore.tsx`
- Interactive onboarding tour: `src/state/tourStore.tsx`

## Key Abstractions

**UserProfile & Mode System:**
- Purpose: Unifies identity with polymorphic behavior depending on active mode.
- Location: `src/types/index.ts`, `backend/prisma/schema.prisma`.
- Pattern: Role-switching state machine.

**Room Lifecycle & Timing Engine:**
- Purpose: Calculates start/end boundaries, enforces fee ceilings based on Host tier, and handles automated status transitions (`DRAFT` -> `PUBLISHED` -> `UPCOMING` -> `CHECK_IN_OPEN` -> `IN_PROGRESS` -> `COMPLETED`).
- Location: `backend/src/utils/roomTiming.ts`, `backend/src/utils/feeLimit.ts`.

**Reputation & Penalty Calculator:**
- Purpose: Applies continuous trust scoring (5-star two-way ratings minus 0.25 penalty per cancellation/no-show).
- Location: `backend/src/services/reputationService.ts`.

## Entry Points

**Frontend Application:**
- `app/_layout.tsx`: Root layout provider wrapping SafeArea, TanStack Query, Auth, Mode, City, Tour providers, and Expo Router Stack.
- `app/index.tsx`: Initial dispatch checking session and redirecting to `/(auth)/welcome`, `/(onboarding)`, or `/(app)/(tabs)`.

**Backend Server:**
- `backend/src/index.ts`: HTTP and WebSocket server initialization, middleware attachment, router mounting, and background auto-close timer.

## Architectural Constraints

- **Single Device Session:** Mobile client relies on single JWT token stored in AsyncStorage.
- **Relational Integrity:** Room cancellations cascade to join requests and participants, with strict refunds and penalty tracking.
- **Fee Limits:** Host fee limits are strictly validated on server-side according to Host level (`getMaximumJoiningFee()`), ignoring client-tampered values.
- **Time Window Overlap:** Users are prevented from joining or hosting simultaneous overlapping dinners.

## Anti-Patterns

### Bypassing Backend Validation in Client
**What happens:** Calculating fee caps, host tiers, or attendance status on client side only.
**Why it's wrong:** Client state can be tampered with or become out of date.
**Do this instead:** Always fetch authoritative computed state from backend (`backend/src/utils/feeLimit.ts`, `backend/src/services/reputationService.ts`).

### Reintroducing Mock Fallbacks
**What happens:** Silently falling back to static mock data (`src/mock/mockRooms.ts`) when API calls fail or return empty arrays.
**Why it's wrong:** Masks network and server errors, showing fictitious data to the user.
**Do this instead:** Follow the established pattern in `src/services/roomService.ts`: return real empty arrays or error states, and use dedicated error handlers.

## Error Handling

**Strategy:** Structured JSON error responses on backend and explicit error state management on client.

**Patterns:**
- Backend: Standardized HTTP status codes (400 Bad Request with Zod issue details, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Internal Error) returning `{ success: false, error: string, message: string }`.
- Frontend: Try/catch blocks in API clients returning `{ success: false, message: string }` without crashing the UI.

## Cross-Cutting Concerns

**Logging:** Console logs with distinct operational emoji prefixes (`🚀`, `🔌`, `👤`, `📍`).
**Validation:** Zod schemas for all request bodies and parameters.
**Authentication:** Stateless JWT bearer authorization middleware (`requireAuth` in `backend/src/middleware/auth.ts`).

---

*Architecture analysis: 2026-09-30*
