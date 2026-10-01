import { prisma } from "../db.js";

export interface UserReputationStats {
  rawRatingAverage: number | null;
  totalRatingsCount: number;
  totalPenaltiesCount: number;
  noShowCount: number;
  penaltyDeduction: number;
  reputation: number | null;
}

export async function getUserReputationStats(userId: string): Promise<UserReputationStats> {
  const [ratingAggregate, totalPenalties, noShowCount] = await Promise.all([
    prisma.rating.aggregate({
      where: { revieweeId: userId },
      _avg: { score: true },
      _count: { id: true },
    }),
    prisma.penalty.count({
      where: { userId },
    }),
    prisma.penalty.count({
      where: { userId, type: "JOINEE_NO_SHOW" },
    }),
  ]);

  const totalRatingsCount = ratingAggregate._count.id;
  const rawAvg = ratingAggregate._avg.score;
  const rawRatingAverage = rawAvg !== null ? Number(rawAvg.toFixed(2)) : null;

  const penaltyDeduction = Number((totalPenalties * 0.25).toFixed(2));

  let reputation: number | null = null;
  if (rawRatingAverage !== null) {
    reputation = Math.max(0, Number((rawRatingAverage - penaltyDeduction).toFixed(2)));
  }

  return {
    rawRatingAverage,
    totalRatingsCount,
    totalPenaltiesCount: totalPenalties,
    noShowCount,
    penaltyDeduction,
    reputation,
  };
}
