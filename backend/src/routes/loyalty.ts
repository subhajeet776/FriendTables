import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { getUserLoyaltyData, claimFreeJoiningFeeReward } from "../services/loyaltyService.js";

export const loyaltyRouter = Router();

// GET /api/v1/users/me/loyalty - Get authenticated user's loyalty progress
loyaltyRouter.get(
  "/me/loyalty",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const data = await getUserLoyaltyData(userId);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to fetch loyalty data",
      });
    }
  }
);

// POST /api/v1/rooms/:roomId/payment/free-claim - Claim free joining fee using available loyalty reward
loyaltyRouter.post(
  "/:roomId/payment/free-claim",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const userId = req.userId!;

      const result = await claimFreeJoiningFeeReward(userId, roomId);
      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to claim free joining fee",
      });
    }
  }
);
