import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import {
  createCheckInSession,
  verifyCheckInToken,
  getRoomAttendance,
  openCheckInStatus,
  closeCheckInStatus,
} from "../services/checkInService.js";

export const checkInRouter = Router();

// POST /api/v1/rooms/:roomId/check-in/session - Host creates/refreshes QR session
checkInRouter.post(
  "/:roomId/check-in/session",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const hostUserId = req.userId!;

      const result = await createCheckInSession(roomId, hostUserId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to create check-in session",
      });
    }
  }
);

// POST /api/v1/rooms/:roomId/check-in/verify - Joinee submits QR token for attendance verification
checkInRouter.post(
  "/:roomId/check-in/verify",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const userId = req.userId!;
      const { qrToken } = req.body || {};

      if (!qrToken) {
        res.status(400).json({
          success: false,
          error: "QR token is required in request body",
        });
        return;
      }

      const result = await verifyCheckInToken(roomId, userId, qrToken);
      res.status(200).json({
        success: true,
        message: result.message,
        alreadyCheckedIn: result.alreadyCheckedIn,
        data: result.attendance,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Check-in verification failed",
      });
    }
  }
);

// GET /api/v1/rooms/:roomId/attendance - Get room attendance details
checkInRouter.get(
  "/:roomId/attendance",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const userId = req.userId!;

      const result = await getRoomAttendance(roomId, userId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to fetch room attendance",
      });
    }
  }
);

// POST /api/v1/rooms/:roomId/check-in/open - Host explicitly opens check-in state
checkInRouter.post(
  "/:roomId/check-in/open",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const hostUserId = req.userId!;

      const result = await openCheckInStatus(roomId, hostUserId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to open check-in state",
      });
    }
  }
);

// POST /api/v1/rooms/:roomId/check-in/close - Host explicitly closes check-in state
checkInRouter.post(
  "/:roomId/check-in/close",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const hostUserId = req.userId!;

      const result = await closeCheckInStatus(roomId, hostUserId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to close check-in state",
      });
    }
  }
);
