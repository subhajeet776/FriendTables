import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { checkRatingEligibility, submitRating } from "../services/ratingService.js";

export const ratingRouter = Router();

// GET /api/v1/rooms/:roomId/rating - Check rating eligibility & existing rating
ratingRouter.get(
  "/:roomId/rating",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const userId = req.userId!;
      const targetUserId = req.query.targetUserId as string | undefined;

      const result = await checkRatingEligibility(roomId, userId, targetUserId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to check rating eligibility",
      });
    }
  }
);

// POST /api/v1/rooms/:roomId/rating - Submit rating for host or joinee
ratingRouter.post(
  "/:roomId/rating",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const roomId = req.params.roomId as string;
      const userId = req.userId!;
      const { score, review, revieweeId } = req.body || {};

      if (score === undefined || score === null) {
        res.status(400).json({
          success: false,
          error: "Score is required",
        });
        return;
      }

      const result = await submitRating(roomId, userId, revieweeId, Number(score), review);
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.rating,
        hostStats: result.hostStats,
        revieweeStats: result.revieweeStats,
      });
    } catch (err: any) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message || "Failed to submit rating",
      });
    }
  }
);
