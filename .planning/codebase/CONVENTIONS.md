# Coding Conventions

**Analysis Date:** 2026-09-30

## Naming Patterns

**Files:**
- UI components: `PascalCase.tsx` (e.g. `Button.tsx`, `RoomCard.tsx`, `DiningPassport.tsx`).
- Navigation routes: `kebab-case.tsx` or bracket parameter format (e.g. `my-rooms.tsx`, `[roomId].tsx`, `[id].tsx`).
- Services and APIs: `camelCase.ts` with explicit suffix (e.g. `roomApi.ts`, `authApi.ts`, `reputationService.ts`).
- Stores: `camelCase.tsx` ending with Store (e.g. `authStore.tsx`, `modeStore.tsx`, `cityStore.tsx`).
- Type definition files: `index.ts` under `src/types/`.

**Functions:**
- Utility and service functions: `camelCase` (e.g. `computeRoomDateTime`, `getMaximumJoiningFee`, `autoCloseExpiredRooms`, `createCheckInSession`).
- React functional components: `PascalCase` (e.g. `HomeScreen`, `JoineeHomeView`, `HostDashboardView`).
- Custom hooks: Prefixed with `use` (e.g. `useAuth`, `useMode`, `useCity`, `useTour`).
- API wrappers: Postfixed with `Api` (e.g. `fetchUserProfileApi`, `getPublishedRoomsApi`, `verifyCheckInTokenApi`).

**Variables:**
- Local variables and parameters: `camelCase` (e.g. `currentUser`, `roomId`, `isLoadingSession`).
- Global constants & configuration objects: `SCREAMING_SNAKE_CASE` (e.g. `TOKENS`, `SUPPORTED_CITIES`, `HOST_FEE_LIMITS`, `QR_EXPIRATION_SECONDS`).

**Types & Interfaces:**
- Interfaces and type aliases: `PascalCase` without `I` prefix (e.g. `UserProfile`, `Room`, `RoomParticipant`, `ActiveMode`, `HostLevel`, `JoinRequestStatus`).
- Zod schema objects: `camelCase` postfixed with `Schema` (e.g. `requestOtpSchema`, `verifyOtpSchema`, `createOrderSchema`).

## Code Style

**Formatting:**
- Standard TypeScript / React 19 indentation (2 spaces).
- Double quotes used for strings and JSX attributes.
- Semicolons used consistently throughout all TypeScript files.
- Tailwind CSS class names organized logically (layout -> spacing -> colors -> borders -> effects).

**Linting & Type Safety:**
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`).
- Path aliases configured (`@/*` -> `./src/*`).
- No arbitrary `any` where domain types exist; explicit typing for payloads and API return values.

## Import Organization

**Order:**
1. React & framework core imports (`react`, `react-native`, `expo-router`, `express`).
2. Third-party libraries (`lucide-react-native`, `socket.io-client`, `zod`, `crypto`, `@prisma/client`).
3. Internal design system primitives and tokens (`@/design-system/components/...`, `tokens.ts`).
4. Internal state and hooks (`@/state/authStore`, `@/state/modeStore`).
5. Internal services and API clients (`@/services/roomService`, `@/services/authApi`).
6. Internal types and schemas (`@/types`).

**Path Aliases:**
- Client code supports `@/*` pointing to `./src/*`.
- Backend code uses relative path imports with `.js` extensions for ESM compatibility (e.g. `import { prisma } from "../db.js"`).

## Error Handling

**Backend Error Patterns:**
- Route controllers wrap async operations in `try / catch` blocks.
- Input validation failures return `400 Bad Request` with structured error details:
  ```typescript
  res.status(400).json({
    success: false,
    error: "Bad Request",
    message: "Descriptive validation message"
  });
  ```
- Unauthorized calls return `401 Unauthorized`.
- Forbidden operations (e.g. non-host attempting check-in generation) return `403 Forbidden`.
- Missing records return `404 Not Found`.

**Frontend Error Patterns:**
- Services catch network exceptions and return a standardized response object rather than throwing unhandled rejections:
  ```typescript
  try {
    const res = await fetch(...);
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || "Network error" };
  }
  ```
- UI components handle empty or failed responses gracefully with empty states (`EmptyState.tsx`, `Skeleton.tsx`) instead of breaking.

## Logging

**Framework:** Native `console.log` / `console.error` with formatted emojis and structured context.

**Patterns:**
- Server startup outputs clear connection endpoints and dev status flags (`🚀`, `📍`, `🔑`, `🌐`, `📱`).
- Socket connection and room events output user and room IDs (`🔌`, `👤`).
- Avoid logging raw user credentials, secret keys, or passwords.

## Comments

**When to Comment:**
- Above all exported domain functions describing role, preconditions, and constraints.
- To clarify complex business rules (e.g. time window calculations in `roomTiming.ts`, penalty deduction math in `reputationService.ts`).
- Above route handlers documenting HTTP method and endpoint path.

**JSDoc / TSDoc:**
- Concise block comments with parameter descriptions on major exported service methods.

## Function Design

**Size:**
- Single-purpose functions focused on one domain operation.
- Complex screen components split into sub-views (e.g. `HomeScreen` in `app/(app)/(tabs)/index.tsx` split into `JoineeHomeView` and `HostDashboardView`).

**Parameters:**
- Functions with more than 3 parameters use structured payload objects (e.g. `CreateRoomPayload`, `EditRoomPayload`).

**Return Values:**
- Server API routes return strongly typed JSON objects always containing `{ success: boolean, ... }`.
- Client services return typed promises (`Promise<Room[]>`, `Promise<RoomApiResponse>`).

## Module Design

**Exports:**
- Named exports preferred for utilities, types, and API functions (`export const roomService`, `export function getRoomTimeInfo`).
- Default exports reserved for Expo Router screen components (`export default function RoomDetailScreen`).

**Barrel Files:**
- Centralized type barrel file at `src/types/index.ts` exporting all domain models.
- Avoid circular dependency chains between stores and services.

---

*Convention analysis: 2026-09-30*
