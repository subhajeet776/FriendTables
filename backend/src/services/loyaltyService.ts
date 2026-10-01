import { prisma } from "../db.js";
import { createNotification } from "./notificationService.js";

export async function getUserLoyaltyData(userId: string) {
  const totalAttended = await prisma.roomAttendance.count({
    where: { userId },
  });

  const earnedMilestonesCount = Math.floor(totalAttended / 5);

  // Synchronize LoyaltyReward records for every 5-attendance milestone reached
  for (let i = 1; i <= earnedMilestonesCount; i++) {
    const milestoneValue = i * 5;
    const existingReward = await prisma.loyaltyReward.findUnique({
      where: {
        userId_milestone: {
          userId,
          milestone: milestoneValue,
        },
      },
    });

    if (!existingReward) {
      try {
        await prisma.loyaltyReward.create({
          data: {
            userId,
            milestone: milestoneValue,
            status: "AVAILABLE",
          },
        });
      } catch {
        // Safe catch for potential concurrent creation
      }
    }
  }

  const allRewards = await prisma.loyaltyReward.findMany({
    where: { userId },
    orderBy: { milestone: "asc" },
  });

  const availableRewards = allRewards.filter((r) => r.status === "AVAILABLE");
  const usedRewards = allRewards.filter((r) => r.status === "USED");

  const progress = totalAttended > 0 && totalAttended % 5 === 0 ? 5 : totalAttended % 5;
  const nextRewardAt = (earnedMilestonesCount + 1) * 5;

  return {
    totalAttendedDines: totalAttended,
    milestone: 5,
    progress,
    availableFreeJoiningFees: availableRewards.length,
    usedFreeJoiningFees: usedRewards.length,
    nextRewardAt,
    availableRewards: availableRewards.map((r) => ({
      id: r.id,
      milestone: r.milestone,
      earnedAt: r.earnedAt.toISOString(),
    })),
  };
}

export async function claimFreeJoiningFeeReward(userId: string, roomId: string) {
  // Sync loyalty rewards first
  await getUserLoyaltyData(userId);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { host: true },
  });

  if (!room) {
    throw { status: 404, message: "Room not found" };
  }

  if (room.hostId === userId) {
    throw { status: 403, message: "Host cannot claim a joining fee for their own room" };
  }

  // Verify accepted join request
  const joinRequest = await prisma.joinRequest.findFirst({
    where: {
      roomId,
      joineeId: userId,
      status: "ACCEPTED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!joinRequest) {
    throw { status: 400, message: "Join request must be accepted by host before claiming free joining fee" };
  }

  // Verify not already a confirmed participant
  const existingParticipant = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
  });

  if (existingParticipant) {
    throw { status: 409, message: "You are already a confirmed participant of this room" };
  }

  if (room.confirmedParticipantsCount >= room.capacity) {
    throw { status: 409, message: "Room has reached maximum capacity" };
  }

  // Find oldest available reward
  const availableReward = await prisma.loyaltyReward.findFirst({
    where: {
      userId,
      status: "AVAILABLE",
    },
    orderBy: { milestone: "asc" },
  });

  if (!availableReward) {
    throw { status: 403, message: "No free joining fee rewards available" };
  }

  // Atomic transaction to prevent double-spending / race conditions
  const result = await prisma.$transaction(async (tx) => {
    // 1. Consume reward atomically
    const updateResult = await tx.loyaltyReward.updateMany({
      where: {
        id: availableReward.id,
        userId,
        status: "AVAILABLE",
      },
      data: {
        status: "USED",
        usedAt: new Date(),
        usedForRoomId: roomId,
      },
    });

    if (updateResult.count === 0) {
      throw { status: 409, message: "Reward has already been used or is unavailable" };
    }

    // 2. Create Payment record for ₹0
    const payment = await tx.payment.create({
      data: {
        roomId,
        userId,
        joinRequestId: joinRequest.id,
        amount: 0,
        hostShare: 0,
        platformShare: 0,
        currency: "INR",
        status: "SUCCESS",
        provider: "LOYALTY_REWARD",
        providerOrderId: `reward_${availableReward.id}`,
        providerPaymentId: `free_claim_${Date.now()}`,
        paidAt: new Date(),
      },
    });

    // 3. Create RoomParticipant
    const participant = await tx.roomParticipant.create({
      data: {
        roomId,
        userId,
      },
    });

    // 4. Increment confirmedParticipantsCount
    await tx.room.update({
      where: { id: roomId },
      data: {
        confirmedParticipantsCount: { increment: 1 },
      },
    });

    return { payment, participant };
  });

  // Create notifications
  const user = await prisma.user.findUnique({ where: { id: userId } });
  await createNotification({
    userId,
    type: "PAYMENT_SUCCESS",
    title: "Seat Confirmed! 🎉",
    message: `You claimed your Free Joining Fee for "${room.title}". See you at ${room.venueName}!`,
    roomId,
    relatedPaymentId: result.payment.id,
  });

  await createNotification({
    userId: room.hostId,
    type: "PAYMENT_SUCCESS",
    title: "New Confirmed Joinee 🎉",
    message: `${user?.name || "A participant"} confirmed their seat for "${room.title}".`,
    roomId,
    relatedUserId: userId,
    relatedPaymentId: result.payment.id,
  });

  return {
    message: "Free joining fee claimed successfully! Seat confirmed.",
    participant: result.participant,
    payment: {
      id: result.payment.id,
      amount: 0,
      status: result.payment.status,
      paidAt: result.payment.paidAt?.toISOString(),
    },
  };
}
