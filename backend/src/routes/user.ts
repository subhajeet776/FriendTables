import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { getMaximumJoiningFee } from "../utils/feeLimit.js";
import { getUserLoyaltyData } from "../services/loyaltyService.js";
import { getUserRatingsAndReviews } from "../services/ratingService.js";
import { getUserReputationStats } from "../services/reputationService.js";

export const userRouter = Router();

const SUPPORTED_CITIES = [
  "Bengaluru",
  "Mumbai",
  "Delhi NCR",
  "Hyderabad",
  "Goa",
  "Pune",
];

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50).optional(),
  bio: z.string().max(500, "Bio max length is 500 characters").optional(),
  avatarUrl: z.string().optional(),
  homeCity: z.string().refine((val) => SUPPORTED_CITIES.includes(val), {
    message: "Invalid home city",
  }).optional(),
  interests: z.array(z.string()).optional(),
});

const onboardingSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50),
  bio: z.string().max(500, "Bio max length is 500 characters"),
  avatarUrl: z.string().optional(),
  homeCity: z.string().refine((val) => SUPPORTED_CITIES.includes(val), {
    message: "Invalid home city",
  }),
  interests: z.array(z.string()).min(1, "At least 1 interest required"),
  activeMode: z.enum(["JOINEE", "HOST"]),
});

const updateModeSchema = z.object({
  activeMode: z.enum(["JOINEE", "HOST"]),
});

/**
 * Count only rooms actually hosted by the user that had verified attendance
 * and were not cancelled.
 */
export async function getHostedDinesCount(userId: string): Promise<number> {
  return prisma.room.count({
    where: {
      hostId: userId,
      status: { not: "CANCELLED" },
      attendances: {
        some: {},
      },
    },
  });
}

export function formatUserProfile(
  user: any,
  hostRatingStats?: { averageScore: number | null; totalRatings: number } | null,
  loyaltyData?: { totalAttendedDines: number; availableFreeJoiningFees: number } | null,
  hostedDinesCountParam?: number
) {
  let parsedInterests: string[] = [];
  try {
    if (user.interests) {
      parsedInterests = typeof user.interests === "string" ? JSON.parse(user.interests) : user.interests;
    }
  } catch {
    parsedInterests = [];
  }

  const hostLevel = user.hostLevel || "NEW";
  const maxJoiningFee = getMaximumJoiningFee(hostLevel);

  let rating: number | null = null;
  let totalRatingsCount = 0;

  if (hostRatingStats) {
    rating = hostRatingStats.averageScore;
    totalRatingsCount = hostRatingStats.totalRatings;
  } else if (user.receivedRatings && Array.isArray(user.receivedRatings)) {
    totalRatingsCount = user.receivedRatings.length;
    if (totalRatingsCount > 0) {
      const sum = user.receivedRatings.reduce((acc: number, r: any) => acc + (r.score || 0), 0);
      rating = Number((sum / totalRatingsCount).toFixed(1));
    }
  }

  const loyaltyAttendedCount = loyaltyData ? loyaltyData.totalAttendedDines : 0;
  const loyaltyFreeDinesAvailable = loyaltyData ? loyaltyData.availableFreeJoiningFees : 0;
  const hostedDinesCount =
    hostedDinesCountParam ??
    (user.hostedRooms
      ? user.hostedRooms.filter(
          (r: any) =>
            r.status !== "CANCELLED" &&
            Array.isArray(r.attendances) &&
            r.attendances.length > 0
        ).length
      : 0);

  return {
    id: user.id,
    phone: user.phone || "",
    email: user.email || "",
    isPhoneVerified: user.isPhoneVerified || false,
    isEmailVerified: user.isEmailVerified || false,
    isIdentityVerified: false,
    isOnboardingCompleted: user.isOnboardingCompleted || false,
    activeMode: user.activeMode || "JOINEE",
    hostLevel,
    maxJoiningFee,
    name: user.name || "Priya Sharma",
    avatarUrl: user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
    bio: user.bio || "",
    homeCity: user.homeCity || "Bengaluru",
    interests: parsedInterests,
    rating,
    totalRatingsCount,
    completedDinesCount: loyaltyAttendedCount,
    hostedDinesCount,
    loyaltyAttendedCount,
    loyaltyFreeDinesAvailable,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * GET /api/v1/users/me/profile
 */
userRouter.get("/me/profile", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { receivedRatings: true },
    });

    if (!user) {
      res.status(404).json({ success: false, error: "Not Found", message: "User not found" });
      return;
    }

    const [loyaltyData, hostedDinesCount] = await Promise.all([
      getUserLoyaltyData(req.userId!),
      getHostedDinesCount(req.userId!),
    ]);

    res.status(200).json({
      success: true,
      profile: formatUserProfile(user, null, loyaltyData, hostedDinesCount),
    });
  } catch (error) {
    console.error("Error in GET /me/profile:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch profile" });
  }
});

/**
 * PATCH /api/v1/users/me/profile
 */
userRouter.patch("/me/profile", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid profile data",
      });
      return;
    }

    const data = parseResult.data;
    const updateData: Record<string, any> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;
    if (data.homeCity !== undefined) updateData.homeCity = data.homeCity;
    if (data.interests !== undefined) updateData.interests = JSON.stringify(data.interests);

    const [updatedUser, loyaltyData, hostedDinesCount] = await Promise.all([
      prisma.user.update({
        where: { id: req.userId },
        data: updateData,
        include: { receivedRatings: true },
      }),
      getUserLoyaltyData(req.userId!),
      getHostedDinesCount(req.userId!),
    ]);

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      profile: formatUserProfile(updatedUser, null, loyaltyData, hostedDinesCount),
    });
  } catch (error) {
    console.error("Error in PATCH /me/profile:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to update profile" });
  }
});

/**
 * POST /api/v1/users/onboarding
 */
userRouter.post("/onboarding", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parseResult = onboardingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid onboarding data",
      });
      return;
    }

    const data = parseResult.data;

    const [updatedUser, loyaltyData, hostedDinesCount] = await Promise.all([
      prisma.user.update({
        where: { id: req.userId },
        data: {
          name: data.name,
          bio: data.bio,
          avatarUrl: data.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
          homeCity: data.homeCity,
          interests: JSON.stringify(data.interests),
          activeMode: data.activeMode,
          isOnboardingCompleted: true,
        },
        include: { receivedRatings: true },
      }),
      getUserLoyaltyData(req.userId!),
      getHostedDinesCount(req.userId!),
    ]);

    res.status(200).json({
      success: true,
      message: "Onboarding completed successfully",
      profile: formatUserProfile(updatedUser, null, loyaltyData, hostedDinesCount),
    });
  } catch (error) {
    console.error("Error in POST /onboarding:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to submit onboarding" });
  }
});

/**
 * PATCH /api/v1/users/mode
 */
userRouter.patch("/mode", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parseResult = updateModeSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid mode. Must be JOINEE or HOST.",
      });
      return;
    }

    const { activeMode } = parseResult.data;

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { activeMode },
    });

    res.status(200).json({
      success: true,
      message: "Mode updated successfully",
      activeMode: updatedUser.activeMode,
    });
  } catch (error) {
    console.error("Error in PATCH /mode:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to update mode" });
  }
});

/**
 * GET /api/v1/users/:id/ratings
 */
userRouter.get("/:id/ratings", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params.id as string;
    const result = await getUserRatingsAndReviews(userId);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in GET /users/:id/ratings:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch user ratings" });
  }
});

/**
 * GET /api/v1/users/:id/profile
 * Public User Profile (safe public fields only)
 */
userRouter.get("/:id/profile", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params.id as string;
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ success: false, error: "Not Found", message: "User not found" });
      return;
    }

    const [repStats, reviewsData, hostedCount, attendedCount] = await Promise.all([
      getUserReputationStats(userId),
      getUserRatingsAndReviews(userId),
      getHostedDinesCount(userId),
      prisma.roomAttendance.count({ where: { userId } }),
    ]);

    let parsedInterests: string[] = [];
    try {
      if (user.interests) {
        parsedInterests = typeof user.interests === "string" ? JSON.parse(user.interests) : user.interests;
      }
    } catch {
      parsedInterests = [];
    }

    res.status(200).json({
      success: true,
      profile: {
        id: user.id,
        name: user.name || "Frientables User",
        avatarUrl: user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
        bio: user.bio || "",
        homeCity: user.homeCity || "Bengaluru",
        interests: parsedInterests,
        isPhoneVerified: user.isPhoneVerified || false,
        isIdentityVerified: false,
        hostLevel: user.hostLevel || "NEW",
        hostedDinesCount: hostedCount,
        completedDinesCount: attendedCount,
        noShowCount: repStats.noShowCount,
        totalPenaltiesCount: repStats.totalPenaltiesCount,
        rawRatingAverage: repStats.rawRatingAverage,
        totalRatingsCount: repStats.totalRatingsCount,
        penaltyDeduction: repStats.penaltyDeduction,
        reputation: repStats.reputation,
        recentReviews: reviewsData.reviews,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Error in GET /users/:id/profile:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch public profile" });
  }
});

