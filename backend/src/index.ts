import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import os from "os";
import { createServer } from "http";
import { authRouter } from "./routes/auth.js";
import { userRouter } from "./routes/user.js";
import { roomRouter } from "./routes/room.js";
import { paymentRouter } from "./routes/payment.js";
import { chatRouter } from "./routes/chat.js";
import { notificationRouter } from "./routes/notification.js";
import { checkInRouter } from "./routes/checkin.js";
import { ratingRouter } from "./routes/rating.js";
import { loyaltyRouter } from "./routes/loyalty.js";
import { initSocketServer } from "./socket.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const IS_DEV = process.env.NODE_ENV === "development" || process.env.DEV_EXPOSE_OTP === "true";

// Create HTTP Server & attach Socket.IO
const httpServer = createServer(app);
initSocketServer(httpServer);

// Function to resolve local LAN IPv4 address for console display
function getLocalLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const lanIp = getLocalLanIp();

// Middlewares
app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", loyaltyRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/rooms", loyaltyRouter);
app.use("/api/v1/rooms", ratingRouter);
app.use("/api/v1/rooms", checkInRouter);
app.use("/api/v1/rooms", chatRouter); // Mount chat routes under /api/v1/rooms/:roomId/messages
app.use("/api/v1/rooms", roomRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1", paymentRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: "Not Found", message: `Route ${req.method} ${req.path} not found` });
});

import { autoCloseExpiredRooms } from "./utils/roomTiming.js";

// Start HTTP Server listening on 0.0.0.0
httpServer.listen(PORT, HOST, () => {
  console.log("\n==================================================");
  console.log(`🚀 Frientables Backend Server & Socket.IO listening on ${HOST}:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔑 Dev OTP Mode: ${IS_DEV ? "ENABLED (Logged in terminal & returned in dev API response)" : "DISABLED"}`);
  console.log(`🌐 Local URL:   http://localhost:${PORT}/api/v1`);
  console.log(`📱 Phone/LAN:   http://${lanIp}:${PORT}/api/v1`);
  console.log("==================================================\n");

  // Run automatic room closure on startup and every 60 seconds
  autoCloseExpiredRooms();
  setInterval(() => {
    autoCloseExpiredRooms();
  }, 60000);
});
