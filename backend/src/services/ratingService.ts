import { prisma } from "../db.js";

export async function checkRatingEligibility(roomId: string, userId: string, targetUserId?: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      host: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });

  if (!room) {
    return { eligible: false, alreadyRated: false, reason: "Room not found" };
  }

  const isHost = room.hostId === userId;

  if (!isHost) {
    // Joinee -> Host rating flow
    const targetId = targetUserId || room.hostId;
    if (targetId !== room.hostId) {
      return { eligible: false, alreadyRated: false, isHost: false, reason: "Joinees can only rate the Host" };
    }

    // Must be a confirmed participant
    const participant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!participant) {
      return { eligible: false, alreadyRated: false, isHost: false, reason: "You must be a confirmed participant of this room" };
    }

    // Must have a persisted attendance record
    const attendance = await prisma.roomAttendance.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!attendance) {
      return { eligible: false, alreadyRated: false, isHost: false, reason: "Rating becomes available after you've attended this dinner." };
    }

    // Check if already rated host
    const existingRating = await prisma.rating.findUnique({
      where: {
        roomId_reviewerId_revieweeId: {
          roomId,
          reviewerId: userId,
          revieweeId: room.hostId,
        },
      },
    });

    if (existingRating) {
      return {
        eligible: false,
        alreadyRated: true,
        isHost: false,
        existingRating: {
          id: existingRating.id,
          score: existingRating.score,
          review: existingRating.review,
          createdAt: existingRating.createdAt.toISOString(),
        },
        reason: "You've already rated this dinner",
        hostId: room.hostId,
        hostName: room.host.name,
      };
    }

    return {
      eligible: true,
      alreadyRated: false,
      isHost: false,
      hostId: room.hostId,
      hostName: room.host.name,
      targetUser: room.host,
    };
  } else {
    // Host -> Joinee rating flow
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId },
      include: {
        user: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    const attendances = await prisma.roomAttendance.findMany({
      where: { roomId },
    });
    const attendedUserIds = new Set(attendances.map((a) => a.userId));

    const ratingsGiven = await prisma.rating.findMany({
      where: { roomId, reviewerId: userId },
    });
    const ratingsMap = new Map(ratingsGiven.map((r) => [r.revieweeId, r]));

    const targets = participants.map((p) => {
      const hasAttended = attendedUserIds.has(p.userId);
      const existing = ratingsMap.get(p.userId);
      const alreadyRated = Boolean(existing);
      const eligible = hasAttended && !alreadyRated;
      return {
        user: p.user,
        hasAttended,
        eligible,
        alreadyRated,
        existingRating: existing
          ? {
              id: existing.id,
              score: existing.score,
              review: existing.review,
              createdAt: existing.createdAt.toISOString(),
            }
          : null,
        reason: !hasAttended
          ? "Joinee has not attended this dinner"
          : alreadyRated
          ? "You've already rated this joinee"
          : undefined,
      };
    });

    if (targetUserId) {
      const t = targets.find((item) => item.user.id === targetUserId);
      if (!t) {
        return {
          eligible: false,
          alreadyRated: false,
          isHost: true,
          reason: "Target user is not a participant of this room",
          targets,
        };
      }
      return {
        eligible: t.eligible,
        alreadyRated: t.alreadyRated,
        isHost: true,
        targetUser: t.user,
        existingRating: t.existingRating,
        reason: t.reason,
        targets,
      };
    }

    return {
      eligible: targets.some((t) => t.eligible),
      alreadyRated: targets.length > 0 && targets.every((t) => t.alreadyRated),
      isHost: true,
      targets,
    };
  }
}

export async function submitRating(
  roomId: string,
  reviewerId: string,
  revieweeId: string | undefined,
  score: number,
  review?: string
) {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
    throw { status: 400, message: "Score must be an integer between 1 and 5" };
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    throw { status: 404, message: "Room not found" };
  }

  const isHost = room.hostId === reviewerId;

  // Determine target reviewee ID if omitted for Joinee rating Host
  const targetRevieweeId = revieweeId || (isHost ? undefined : room.hostId);

  if (!targetRevieweeId) {
    throw { status: 400, message: "Reviewee ID is required" };
  }

  if (reviewerId === targetRevieweeId) {
    throw { status: 400, message: "You cannot rate yourself" };
  }

  if (!isHost) {
    // Joinee rating Host
    if (targetRevieweeId !== room.hostId) {
      throw { status: 403, message: "Joinees can only rate the Host" };
    }

    const participant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: reviewerId,
        },
      },
    });

    if (!participant) {
      throw { status: 403, message: "You must be a confirmed participant of this room" };
    }

    const attendance = await prisma.roomAttendance.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: reviewerId,
        },
      },
    });

    if (!attendance) {
      throw { status: 403, message: "Rating becomes available after you've attended this dinner." };
    }
  } else {
    // Host rating Joinee
    if (targetRevieweeId === room.hostId) {
      throw { status: 400, message: "Host cannot rate themselves" };
    }

    const participant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: targetRevieweeId,
        },
      },
    });

    if (!participant) {
      throw { status: 403, message: "Target user is not a confirmed participant of this room" };
    }

    const attendance = await prisma.roomAttendance.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: targetRevieweeId,
        },
      },
    });

    if (!attendance) {
      throw { status: 403, message: "Target joinee has not attended this dinner" };
    }
  }

  // Check duplicate rating
  const existingRating = await prisma.rating.findUnique({
    where: {
      roomId_reviewerId_revieweeId: {
        roomId,
        reviewerId,
        revieweeId: targetRevieweeId,
      },
    },
  });

  if (existingRating) {
    throw { status: 409, message: "You've already rated this user for this room" };
  }

  const rating = await prisma.rating.create({
    data: {
      roomId,
      reviewerId,
      revieweeId: targetRevieweeId,
      score,
      review: review && typeof review === "string" ? review.trim() : null,
    },
  });

  // Recalculate reviewee rating stats
  const stats = await getUserHostRatingStats(targetRevieweeId);

  return {
    message: "Rating submitted successfully",
    rating: {
      id: rating.id,
      roomId: rating.roomId,
      reviewerId: rating.reviewerId,
      revieweeId: rating.revieweeId,
      score: rating.score,
      review: rating.review,
      createdAt: rating.createdAt.toISOString(),
    },
    hostStats: stats,
    revieweeStats: stats,
  };
}

export async function getUserHostRatingStats(userId: string) {
  const aggregate = await prisma.rating.aggregate({
    where: { revieweeId: userId },
    _avg: { score: true },
    _count: { id: true },
  });

  const totalRatings = aggregate._count.id;
  const averageScore = aggregate._avg.score !== null ? Number(aggregate._avg.score.toFixed(1)) : null;

  return {
    averageScore,
    totalRatings,
  };
}

export async function getUserRatingsAndReviews(userId: string) {
  const stats = await getUserHostRatingStats(userId);
  const receivedRatings = await prisma.rating.findMany({
    where: { revieweeId: userId },
    include: {
      reviewer: {
        select: { id: true, name: true, avatarUrl: true },
      },
      room: {
        select: { id: true, title: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    averageScore: stats.averageScore,
    totalRatingsCount: stats.totalRatings,
    reviews: receivedRatings.map((r) => ({
      id: r.id,
      score: r.score,
      review: r.review,
      createdAt: r.createdAt.toISOString(),
      reviewer: r.reviewer,
      roomTitle: r.room?.title || "Dinner Room",
    })),
  };
}
