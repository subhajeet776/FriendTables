# Technology Stack

**Analysis Date:** 2026-09-30

## Languages

**Primary:**
- TypeScript 5.7+ / 6.0 (`~6.0.3` in frontend `package.json`, `^5.7.2` in backend `backend/package.json`) - Strict TypeScript used across both mobile client and backend server.
- TSX / JSX - Used for React Native / Expo UI components and navigation layouts across `app/` and `src/`.

**Secondary:**
- JavaScript (Node.js CJS/ESM) - Used for configuration files (`metro.config.js`, `babel.config.js`, `tailwind.config.js`) and database verification/cleanup scripts in `backend/`.

## Runtime

**Environment:**
- Node.js (v18+ / v20+ recommended)
- Mobile Runtime: React Native 0.86.3 with Expo SDK 57 (~57.0.0), React Native Web 0.21.2 for web targets
- Backend Runtime: Node.js executed via `tsx` (v4.19.2) in development, compiled with `tsc` for production

**Package Manager:**
- npm (lockfile `package-lock.json` present at root and in `backend/package-lock.json`)

## Frameworks

**Core:**
- **Frontend / Client:** React 19 (`19.2.3`), React Native (`0.86.3`), Expo (`~57.0.0`), Expo Router (`~57.0.22`) file-system routing.
- **Backend / API:** Express (`^4.21.2`) with Node HTTP server (`http.createServer`).
- **Styling & UI:** NativeWind (`^4.1.23`) with Tailwind CSS (`^3.4.16`), `clsx` (`^2.1.1`), `tailwind-merge` (`^2.5.5`).
- **Animations & Gestures:** React Native Reanimated (`4.5.1`), React Native Gesture Handler (`~2.32.0`), React Native Worklets (`0.10.1`).
- **Icons & Graphics:** Lucide React Native (`^0.469.0`), React Native SVG (`15.15.4`), `react-native-qrcode-svg` (`^6.3.24`).
- **Data Fetching & State:** TanStack React Query (`^5.62.7`), React Context API (`authStore.tsx`, `modeStore.tsx`, `cityStore.tsx`, `tourStore.tsx`), React Hook Form (`^7.54.1`), Zod (`^3.24.1`).

**Testing:**
- Backend Integration / Verification Scripts: Ad-hoc Node.js verification scripts executing native `fetch` tests against running API (`backend/test_auth.js`, `backend/test_rooms_step3a.js`, `backend/test_payments_step4b.js`, etc.).
- Unit / Automated Test Runner: None formally configured (no Jest / Vitest installed in `package.json`).

**Build/Dev:**
- Expo CLI (`expo start`, `expo start --android`, `expo start --ios`, `expo start --web`)
- Metro bundler (`metro.config.js`, `@expo/metro-runtime ~57.0.16`)
- Babel (`@babel/core ^7.25.2`, `babel.config.js`)
- `tsx` (`^4.19.2` in `backend/package.json` for live-reloading TypeScript watcher `tsx watch src/index.ts`)
- Prisma CLI (`^5.22.0` in `backend/package.json`)

## Key Dependencies

**Critical:**
- `expo-router`: Powers the complete screen navigation hierarchy, tab management, dynamic routes (`app/room/[id].tsx`, `app/chat/[roomId].tsx`, `app/check-in/[roomId].tsx`, `app/rating/[roomId].tsx`), and onboarding flows.
- `@prisma/client` (`^5.22.0`): Type-safe ORM for database operations across all models (`User`, `Room`, `JoinRequest`, `Payment`, `RoomAttendance`, `Rating`, etc.).
- `socket.io` (`^4.8.3` server) / `socket.io-client` (`^4.8.3` client): Real-time bidirectional WebSocket communication for in-room group chats, check-in sync, and user notifications.
- `jsonwebtoken` (`^9.0.2`): Stateless JWT token generation and verification for mobile authentication (`Bearer` token header).
- `zod` (`^3.24.1`): Strict runtime input schema validation across backend routes (`auth.ts`, `room.ts`, `payment.ts`, etc.) and frontend forms.
- `@react-native-async-storage/async-storage` (`^2.2.0`): Secure device persistence for JWT tokens, user preferences, and app tour completion state.

**Infrastructure:**
- `cors` (`^2.8.5`): Cross-Origin Resource Sharing middleware for local web and mobile emulator requests.
- `dotenv` (`^16.4.7`): Environment variable loading from `.env` in backend.
- `razorpay` (`^2.9.8`): Payment gateway SDK for order generation and HMAC SHA256 payment signature verification.
- `expo-camera` (`~57.0.5`): QR code camera scanning for dinner attendee check-in.
- `expo-image` (`~57.0.5`): Optimized remote and local image rendering for user avatars and room banners.
- `expo-haptics` (`~57.0.3`): Tactile feedback for mobile interactions.

## Configuration

**Environment:**
- Frontend: Managed through Expo environment variables (`EXPO_PUBLIC_API_URL`), `.env`, and dynamic host resolution in `src/services/authApi.ts` supporting Web localhost, Android emulator `10.0.2.2`, and physical device Wi-Fi LAN IP via `Constants.expoConfig.hostUri`.
- Backend: Configured via `backend/.env` (see `backend/.env.example`).
  - Key configs: `PORT`, `HOST`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `NODE_ENV`, `DEV_EXPOSE_OTP`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.

**Build:**
- Frontend build config: `app.json`, `metro.config.js`, `babel.config.js`, `tailwind.config.js`, `tsconfig.json`.
- Backend build config: `backend/tsconfig.json`, `backend/package.json`.

## Platform Requirements

**Development:**
- Node.js 18+ or 20+
- Expo Go app on iOS/Android, or Android Studio Emulator / Xcode iOS Simulator
- Modern web browser for Expo Web target (`npm run web`)

**Production:**
- Frontend: Standalone native binary builds for Google Play Store (Android APK/AAB) and Apple App Store (iOS IPA) generated via Expo EAS Build (`eas build`).
- Backend: Containerized Node.js service (e.g. Docker, AWS ECS, Railway, Render) connected to PostgreSQL (migrated from SQLite in `schema.prisma`).

---

*Stack analysis: 2026-09-30*
