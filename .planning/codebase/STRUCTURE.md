# Codebase Structure

**Analysis Date:** 2026-09-30

## Directory Layout

```
friend/
├── app/                                 # Expo Router application screens and navigation
│   ├── _layout.tsx                      # Root app provider tree and Stack configuration
│   ├── index.tsx                        # Initial routing decision (auth/onboarding/(app))
│   ├── (app)/                           # Authenticated application shell
│   │   ├── _layout.tsx                  # App layout
│   │   ├── notifications.tsx            # In-app notifications screen
│   │   └── (tabs)/                      # Bottom tab navigation screens
│   │       ├── index.tsx                # Dynamic Home screen (Joinee Home vs Host Dashboard)
│   │       ├── discover.tsx             # Room discovery, city filter, interest search
│   │       ├── create.tsx               # Create dining room experience (Host mode)
│   │       ├── dines.tsx                # User dining commitments & history
│   │       └── profile.tsx              # User profile, host tier, passport, settings
│   ├── (auth)/                          # Authentication screens
│   │   ├── welcome.tsx                  # Welcome splash & entry
│   │   ├── login.tsx                    # Phone/Email input screen
│   │   └── otp.tsx                      # OTP verification code input
│   ├── (onboarding)/                    # First-time user onboarding screens
│   │   ├── index.tsx                    # Step 1: Basic info (name, avatar, bio)
│   │   ├── city.tsx                     # Step 2: Home city selection
│   │   ├── interests.tsx                # Step 3: Dining and social interests
│   │   ├── mode.tsx                     # Step 4: Primary mode choice (Joinee vs Host)
│   │   └── complete.tsx                 # Onboarding celebration and redirect
│   ├── room/                            # Room details screen
│   │   └── [id].tsx                     # Detailed view of a room, participants, join CTA
│   ├── chat/                            # In-room messaging
│   │   └── [roomId].tsx                 # Real-time WebSocket chat room
│   ├── check-in/                        # Real-world dining check-in
│   │   └── [roomId].tsx                 # QR code display (Host) / QR camera scanner (Joinee)
│   ├── rating/                          # Post-event review
│   │   └── [roomId].tsx                 # Two-way rating screen
│   ├── host/                            # Host-specific screens
│   │   ├── dashboard.tsx                # Host management center
│   │   ├── my-rooms.tsx                 # Host room list with status management
│   │   └── requests.tsx                 # Join request review & applicant approvals
│   └── profile/                         # User profile view
│       └── [userId].tsx                 # Public profile inspection
├── backend/                             # Express + Prisma API server
│   ├── prisma/                          # Database schema and migrations
│   │   ├── schema.prisma                # Complete relational schema
│   │   └── dev.db                       # Local SQLite database file
│   ├── src/                             # Backend TypeScript source code
│   │   ├── index.ts                     # Server entry point and HTTP/Socket bootstrap
│   │   ├── db.ts                        # Prisma client singleton
│   │   ├── socket.ts                    # Socket.IO real-time manager and event handlers
│   │   ├── middleware/                  # Express middleware
│   │   │   └── auth.ts                  # JWT authentication middleware (`requireAuth`)
│   │   ├── routes/                      # Route handlers
│   │   │   ├── auth.ts                  # OTP, login, /me, onboarding
│   │   │   ├── user.ts                  # User profiles and update routes
│   │   │   ├── room.ts                  # Room CRUD, join requests, approvals
│   │   │   ├── payment.ts               # Razorpay order generation & verification
│   │   │   ├── chat.ts                  # Message history and message posting
│   │   │   ├── notification.ts          # Notifications fetch and mark-read
│   │   │   ├── checkin.ts               # QR sessions and token verification
│   │   │   ├── rating.ts                # Two-way rating submissions
│   │   │   └── loyalty.ts               # Loyalty reward milestone tracking
│   │   ├── services/                    # Core business logic services
│   │   │   ├── checkInService.ts        # QR token hashing and attendance verification
│   │   │   ├── loyaltyService.ts        # Milestone calculations
│   │   │   ├── noShowService.ts         # No-show penalty handling
│   │   │   ├── notificationService.ts   # System notification dispatch
│   │   │   ├── ratingService.ts         # Score aggregation
│   │   │   ├── reputationService.ts     # Trust scores, penalty deductions, host tiers
│   │   │   └── roomConflictService.ts   # Overlapping schedule prevention
│   │   └── utils/                       # Utility functions
│   │       ├── crypto.ts                # OTP generation and HMAC-SHA256 hashing
│   │       ├── feeLimit.ts              # Server-side maximum joining fee tables
│   │       ├── jwt.ts                   # Token signing and decoding
│   │       └── roomTiming.ts            # Timing calculations and auto-closure job
│   ├── package.json                     # Backend dependencies and scripts
│   ├── tsconfig.json                    # Backend TypeScript configuration
│   └── *.js, *.ts                       # API verification and cleanup test scripts
├── src/                                 # Frontend shared application source
│   ├── design-system/                   # Design system primitives and domain components
│   │   ├── tokens.ts                    # Color, spacing, typography, radii constants
│   │   ├── components/                  # Atomic primitives (Button, Card, Text, Input...)
│   │   └── domain-components/           # Feature widgets (RoomCard, DiningPassport...)
│   ├── services/                        # Client network communication and API wrappers
│   │   ├── authApi.ts                   # Auth endpoints and dynamic host resolution
│   │   ├── roomApi.ts                   # Room endpoints
│   │   ├── roomService.ts               # High-level room business service
│   │   ├── requestApi.ts                # Join request API calls
│   │   ├── requestService.ts            # Join request workflows
│   │   ├── paymentApi.ts                # Payment order and verification client
│   │   ├── checkInApi.ts                # Check-in session and verification client
│   │   ├── chatApi.ts                   # REST chat history fetching
│   │   ├── chatSocket.ts                # Socket.IO client connection manager
│   │   ├── notificationApi.ts           # Notification API calls
│   │   ├── ratingApi.ts                 # Rating submission client
│   │   ├── loyaltyApi.ts                # Loyalty stats client
│   │   └── tourStorage.ts               # Local onboarding tour persistence
│   ├── state/                           # React Context global state stores
│   │   ├── authStore.tsx                # Authentication state, profile, and session restore
│   │   ├── modeStore.tsx                # App active mode (`JOINEE` vs `HOST`)
│   │   ├── cityStore.tsx                # Active browsing city state
│   │   └── tourStore.tsx                # Guided feature tour state
│   ├── types/                           # Global TypeScript interface definitions
│   │   └── index.ts                     # Core domain models and payload types
│   └── mock/                            # Deprecated/isolated reference mock datasets
│       ├── mockUsers.ts
│       ├── mockRooms.ts
│       ├── mockRequests.ts
│       └── mockChats.ts
├── .planning/                           # GSD project plans and codebase documentation
├── app.json                             # Expo app configuration
├── babel.config.js                      # Babel presets for NativeWind and Reanimated
├── global.css                           # Global Tailwind CSS directives
├── metro.config.js                      # Metro bundler config with NativeWind preset
├── package.json                         # Frontend dependencies and run scripts
├── tailwind.config.js                   # Custom design system colors and border radii
└── tsconfig.json                        # Root TypeScript configuration
```

## Directory Purposes

**`app/`:**
- Purpose: File-based routing for the entire mobile app using Expo Router.
- Contains: Screen components (`.tsx`), stack layouts (`_layout.tsx`), route parameters.
- Key files: `app/_layout.tsx`, `app/index.tsx`, `app/(app)/(tabs)/index.tsx`, `app/room/[id].tsx`.

**`src/design-system/`:**
- Purpose: Reusable, theme-aligned UI components following the dark-mode aesthetic.
- Contains: Primitives (`Button.tsx`, `Card.tsx`, `Text.tsx`, `Input.tsx`, `InterestChip.tsx`, `StatusPill.tsx`, `Modal.tsx`) and domain components (`RoomCard.tsx`, `DiningPassport.tsx`, `HostLevelCard.tsx`, `JoinRequestCard.tsx`).
- Key files: `src/design-system/tokens.ts`.

**`src/services/`:**
- Purpose: Abstraction layer between UI components and backend network APIs.
- Contains: HTTP fetch calls, token management, dynamic API URL discovery, WebSocket client listeners.
- Key files: `src/services/authApi.ts`, `src/services/roomApi.ts`, `src/services/chatSocket.ts`.

**`src/state/`:**
- Purpose: Client-side state orchestration.
- Contains: React context providers and custom hooks (`useAuth`, `useMode`, `useCity`, `useTour`).
- Key files: `src/state/authStore.tsx`, `src/state/modeStore.tsx`.

**`backend/src/`:**
- Purpose: Core API server powering all business workflows.
- Contains: Express routing, Prisma database queries, WebSocket handlers, domain services.
- Key files: `backend/src/index.ts`, `backend/src/socket.ts`, `backend/src/db.ts`.

## Key File Locations

**Entry Points:**
- `app/_layout.tsx`: Mobile app root layout and provider hierarchy.
- `app/index.tsx`: Session gatekeeper and entry redirector.
- `backend/src/index.ts`: Backend Express HTTP and Socket.IO server entry point.

**Configuration:**
- `app.json`: Expo application metadata, bundle IDs, and schemes.
- `tailwind.config.js`: Custom color palette (`background`, `brand`, `status`, `host`).
- `metro.config.js`: Metro bundler configuration with NativeWind wrapper.
- `backend/prisma/schema.prisma`: Complete database schema specification.

**Core Logic:**
- `backend/src/utils/roomTiming.ts`: Automated room lifecycle calculation.
- `backend/src/services/reputationService.ts`: Host reputation math and penalty deductions.
- `backend/src/services/checkInService.ts`: Cryptographic check-in QR generation and validation.
- `src/services/roomService.ts`: Frontend room aggregation service.

**Testing:**
- `backend/test_auth.js`: Auth API verification.
- `backend/test_rooms_step3a.js`: Room creation and query tests.
- `backend/test_payments_step4b.js`: Razorpay payment flow tests.
- `backend/test_checkin_step6a.js`: Check-in verification tests.

## Naming Conventions

**Files:**
- React components and screen layouts: `PascalCase.tsx` (e.g. `RoomCard.tsx`, `Button.tsx`) or `kebab-case.tsx` for route files (e.g. `my-rooms.tsx`, `check-in.tsx`).
- Dynamic route parameters: Bracket syntax `[id].tsx`, `[roomId].tsx`, `[userId].tsx`.
- Services and utilities: `camelCase.ts` (e.g. `roomService.ts`, `authApi.ts`, `roomTiming.ts`).
- Documentation: `UPPERCASE.md` (e.g. `STACK.md`, `ARCHITECTURE.md`).

**Directories:**
- Route groups: `(parenthesized)` (e.g. `(app)`, `(auth)`, `(onboarding)`, `(tabs)`).
- Submodules and features: `kebab-case` (e.g. `design-system`, `domain-components`, `check-in`).

## Where to Add New Code

**New Feature (e.g., Dish Ordering or Split Bills):**
- Screen routes: Add route file under `app/feature-name/`.
- UI Components: Place feature-specific UI in `src/design-system/domain-components/`.
- Client API: Create `src/services/featureApi.ts` and add typed contracts in `src/types/index.ts`.
- Backend Routes: Add router in `backend/src/routes/feature.ts` and mount in `backend/src/index.ts`.
- Backend Logic: Add domain service in `backend/src/services/featureService.ts`.
- Database: Add Prisma models in `backend/prisma/schema.prisma` and run `npx prisma db push`.

**New Component/Module:**
- Shared UI primitives: `src/design-system/components/`
- Domain-specific widgets: `src/design-system/domain-components/`

**Utilities:**
- Client helpers: `src/services/` or `src/utils/`
- Backend helpers: `backend/src/utils/`

## Special Directories

**`.planning/`:**
- Purpose: Project roadmap, architectural documentation, and phase plans for GSD workflows.
- Generated: Maintained by GSD commands.
- Committed: Configurable via `.planning/config.json`.

**`backend/prisma/`:**
- Purpose: Database schemas and local SQLite database files.
- Contains: `schema.prisma`, `dev.db` (local database).

---

*Structure analysis: 2026-09-30*
