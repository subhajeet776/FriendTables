import { prisma } from "./src/db";
import { getRoomTimeInfo } from "./src/utils/roomTiming";

async function inspect() {
  console.log("=== STEP 1: DATABASE COUNTS ===");
  const userCount = await prisma.user.count();
  const roomCount = await prisma.room.count();
  const participantCount = await prisma.roomParticipant.count();
  const requestCount = await prisma.joinRequest.count();
  const paymentCount = await prisma.payment.count();
  const attendanceCount = await prisma.roomAttendance.count();
  const ratingCount = await prisma.rating.count();
  const notificationCount = await prisma.notification.count();

  console.log({
    users: userCount,
    rooms: roomCount,
    participants: participantCount,
    joinRequests: requestCount,
    payments: paymentCount,
    attendances: attendanceCount,
    ratings: ratingCount,
    notifications: notificationCount,
  });

  console.log("\n=== STEP 1 (cont): ROOMS WITH ATTENDANCE ===");
  const attendances = await prisma.roomAttendance.findMany({
    include: {
      room: {
        include: {
          host: true,
          participants: { include: { user: true } },
          attendances: true,
        },
      },
      user: true,
    },
  });

  console.log(`Total RoomAttendance rows: ${attendances.length}`);
  for (const att of attendances) {
    console.log("\n--- ATTENDANCE RECORD ---");
    console.log("Attendance ID:", att.id);
    console.log("User (Joinee):", att.user.id, att.user.name, att.user.phone);
    console.log("Room ID:", att.room.id);
    console.log("Room Title:", att.room.title);
    console.log("Host ID:", att.room.hostId);
    console.log("Host Name/Phone:", att.room.host?.name, att.room.host?.phone);
    console.log("Room DB Status:", att.room.status);
    console.log("Room Date:", att.room.date);
    console.log("Room Time:", att.room.time);
    console.log("Room DateTime:", att.room.dateTime);
    console.log("Room PublishedAt:", att.room.publishedAt);
    console.log("Room CreatedAt:", att.room.createdAt);

    const timing = getRoomTimeInfo(att.room);
    console.log("Calculated Timing Info:", {
      scheduledStartTime: timing.scheduledStartTime?.toISOString(),
      scheduledEndTime: timing.scheduledEndTime?.toISOString(),
      closingTime: timing.closingTime?.toISOString(),
      isClosed: timing.isClosed,
      isCompleted: timing.isCompleted,
      isWithin90Days: timing.isWithin90Days,
    });

    const participants = await prisma.roomParticipant.findMany({
      where: { roomId: att.room.id },
      include: { user: true },
    });
    console.log("RoomParticipant rows:", participants.map(p => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
      joinedAt: p.joinedAt,
    })));

    const requests = await prisma.joinRequest.findMany({
      where: { roomId: att.room.id },
      include: { joinee: true },
    });
    console.log("JoinRequest rows:", requests.map(r => ({
      id: r.id,
      joineeId: r.joineeId,
      joineeName: r.joinee.name,
      status: r.status,
    })));

    const payments = await prisma.payment.findMany({
      where: { roomId: att.room.id },
    });
    console.log("Payment rows:", payments.map(p => ({
      id: p.id,
      userId: p.userId,
      amount: p.amount,
      status: p.status,
    })));
  }

  console.log("\n=== ALL USERS IN DB ===");
  const users = await prisma.user.findMany();
  for (const u of users) {
    console.log(`User [${u.id}] Name: "${u.name}" | Phone: ${u.phone} | ActiveMode: ${u.activeMode}`);
  }

  console.log("\n=== ALL ROOMS IN DB ===");
  const allRooms = await prisma.room.findMany({
    include: {
      host: true,
      attendances: true,
    },
    orderBy: { createdAt: "desc" },
  });
  for (const r of allRooms) {
    const timing = getRoomTimeInfo(r);
    console.log(`Room [${r.id}] "${r.title}" | Host: ${r.host?.name || r.hostId} (${r.host?.phone}) | Status: ${r.status} | Date: "${r.date}" | Time: "${r.time}" | DateTime: ${r.dateTime} | Created: ${r.createdAt.toISOString()} | isClosed: ${timing.isClosed} | isWithin90Days: ${timing.isWithin90Days} | Attendances: ${r.attendances.length}`);
  }
}

inspect().catch(console.error).finally(() => prisma.$disconnect());
