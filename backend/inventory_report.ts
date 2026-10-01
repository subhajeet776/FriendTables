import { prisma } from "./src/db";

async function detailedReport() {
  console.log("=== FINAL INVENTORY REPORT BUILDER ===");

  const realHostPhone = "+916033970835";
  const realJoineePhone = "+916203984168";

  const realHost = await prisma.user.findFirst({ where: { phone: realHostPhone } });
  const realJoinee = await prisma.user.findFirst({ where: { phone: realJoineePhone } });

  const realUserIds = [realHost?.id, realJoinee?.id].filter(Boolean) as string[];

  const realRooms = await prisma.room.findMany({
    where: { hostId: { in: realUserIds } },
  });
  const realRoomIds = realRooms.map(r => r.id);

  // Model by model counts
  const userTotal = await prisma.user.count();
  const userReal = realUserIds.length;
  const userTest = userTotal - userReal;

  const roomTotal = await prisma.room.count();
  const roomReal = realRoomIds.length;
  const roomTest = roomTotal - roomReal;

  const participantTotal = await prisma.roomParticipant.count();
  const participantReal = await prisma.roomParticipant.count({
    where: { roomId: { in: realRoomIds }, userId: { in: realUserIds } },
  });
  const participantTest = participantTotal - participantReal;

  const requestTotal = await prisma.joinRequest.count();
  const requestReal = await prisma.joinRequest.count({
    where: { roomId: { in: realRoomIds }, joineeId: { in: realUserIds } },
  });
  const requestTest = requestTotal - requestReal;

  const paymentTotal = await prisma.payment.count();
  const paymentReal = await prisma.payment.count({
    where: { roomId: { in: realRoomIds }, userId: { in: realUserIds } },
  });
  const paymentTest = paymentTotal - paymentReal;

  const attendanceTotal = await prisma.roomAttendance.count();
  const attendanceReal = await prisma.roomAttendance.count({
    where: { roomId: { in: realRoomIds }, userId: { in: realUserIds } },
  });
  const attendanceTest = attendanceTotal - attendanceReal;

  const sessionTotal = await prisma.roomCheckInSession.count();
  const sessionReal = await prisma.roomCheckInSession.count({
    where: { roomId: { in: realRoomIds }, createdByUserId: { in: realUserIds } },
  });
  const sessionTest = sessionTotal - sessionReal;

  const messageTotal = await prisma.roomMessage.count();
  const messageReal = await prisma.roomMessage.count({
    where: { roomId: { in: realRoomIds } },
  });
  const messageTest = messageTotal - messageReal;

  const ratingTotal = await prisma.rating.count();
  const ratingReal = await prisma.rating.count({
    where: {
      roomId: { in: realRoomIds },
      reviewerId: { in: realUserIds },
      revieweeId: { in: realUserIds },
    },
  });
  const ratingTest = ratingTotal - ratingReal;

  const rewardTotal = await prisma.loyaltyReward.count();
  const rewardReal = await prisma.loyaltyReward.count({
    where: { userId: { in: realUserIds } },
  });
  const rewardTest = rewardTotal - rewardReal;

  const notificationTotal = await prisma.notification.count();
  const notificationReal = await prisma.notification.count({
    where: {
      OR: [
        { userId: { in: realUserIds } },
        { relatedUserId: { in: realUserIds } },
        { roomId: { in: realRoomIds } },
      ],
    },
  });
  const notificationTest = notificationTotal - notificationReal;

  const otpTotal = await prisma.otpChallenge.count();
  const otpReal = await prisma.otpChallenge.count({
    where: { target: { in: [realHostPhone, realJoineePhone] } },
  });
  const otpTest = otpTotal - otpReal;

  console.log("\n==================================================");
  console.log("DATABASE INVENTORY BY MODEL");
  console.log("==================================================");
  console.table([
    { Model: "User", Total: userTotal, Real: userReal, Test: userTest },
    { Model: "Room", Total: roomTotal, Real: roomReal, Test: roomTest },
    { Model: "RoomParticipant", Total: participantTotal, Real: participantReal, Test: participantTest },
    { Model: "JoinRequest", Total: requestTotal, Real: requestReal, Test: requestTest },
    { Model: "Payment", Total: paymentTotal, Real: paymentReal, Test: paymentTest },
    { Model: "RoomAttendance", Total: attendanceTotal, Real: attendanceReal, Test: attendanceTest },
    { Model: "RoomCheckInSession", Total: sessionTotal, Real: sessionReal, Test: sessionTest },
    { Model: "RoomMessage", Total: messageTotal, Real: messageReal, Test: messageTest },
    { Model: "Rating", Total: ratingTotal, Real: ratingReal, Test: ratingTest },
    { Model: "LoyaltyReward", Total: rewardTotal, Real: rewardReal, Test: rewardTest },
    { Model: "Notification", Total: notificationTotal, Real: notificationReal, Test: notificationTest },
    { Model: "OtpChallenge", Total: otpTotal, Real: otpReal, Test: otpTest },
  ]);

  console.log("\n--- REAL ROOM DETAILS ---");
  for (const r of realRooms) {
    const participants = await prisma.roomParticipant.findMany({ where: { roomId: r.id }, include: { user: true } });
    const requests = await prisma.joinRequest.findMany({ where: { roomId: r.id }, include: { joinee: true } });
    const payments = await prisma.payment.findMany({ where: { roomId: r.id }, include: { user: true } });
    const attendances = await prisma.roomAttendance.findMany({ where: { roomId: r.id }, include: { user: true } });
    const ratings = await prisma.rating.findMany({ where: { roomId: r.id }, include: { reviewer: true, reviewee: true } });

    console.log({
      roomId: r.id,
      title: r.title,
      hostId: r.hostId,
      hostName: realHost?.name,
      hostPhone: realHost?.phone,
      status: r.status,
      date: r.date,
      time: r.time,
      dateTime: r.dateTime?.toISOString(),
      participants: participants.map(p => `${p.user.name} (${p.userId})`),
      requests: requests.map(req => `${req.joinee.name} [Status: ${req.status}]`),
      payments: payments.map(p => `${p.user.name}: ₹${p.amount} [Status: ${p.status}]`),
      attendances: attendances.map(a => `${a.user.name} (${a.userId})`),
      ratings: ratings.map(rt => `${rt.reviewer.name} -> ${rt.reviewee.name}: ${rt.score}★ ("${rt.review || ""}")`),
    });
  }

  console.log("\n--- REAL USER DETAILS ---");
  console.log("Real Host:", {
    id: realHost?.id,
    name: realHost?.name,
    phone: realHost?.phone,
    activeMode: realHost?.activeMode,
    hostLevel: realHost?.hostLevel,
  });
  console.log("Real Joinee:", {
    id: realJoinee?.id,
    name: realJoinee?.name,
    phone: realJoinee?.phone,
    activeMode: realJoinee?.activeMode,
  });
}

detailedReport().catch(console.error).finally(() => prisma.$disconnect());
