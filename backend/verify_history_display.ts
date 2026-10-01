import { prisma } from "./src/db";
import { formatRoom, formatJoinRequest } from "./src/routes/room";

async function verify() {
  console.log("=== VERIFYING REAL ROOM HISTORY DISPLAY ===");

  // 1. Host side: Subhajeet (b799b475-afa1-4e67-b43f-fdd25de1b62d)
  const hostRooms = await prisma.room.findMany({
    where: { hostId: "b799b475-afa1-4e67-b43f-fdd25de1b62d" },
    include: {
      host: true,
      participants: { include: { user: true } },
      attendances: true,
    },
  });

  const formattedHostRooms = hostRooms.map(formatRoom);
  console.log("\nHost My-Rooms API Output:");
  for (const r of formattedHostRooms) {
    const isCompletedRoom =
      r.status === "COMPLETED" ||
      Boolean(r.isClosed);

    const isShownInPastTab = isCompletedRoom && r.isWithin90Days !== false;

    console.log(`Room [${r.id}] "${r.title}":`, {
      status: r.status,
      isClosed: r.isClosed,
      isWithin90Days: r.isWithin90Days,
      hasAttendance: r.hasAttendance,
      totalCheckedIn: r.totalCheckedIn,
      isCompletedRoom,
      IS_SHOWN_IN_HOST_PAST_TAB: isShownInPastTab,
    });
  }

  // 2. Joinee side: Pragya (e1386d78-c286-4207-88e3-d591604b82a5)
  const joineeRequests = await prisma.joinRequest.findMany({
    where: { joineeId: "e1386d78-c286-4207-88e3-d591604b82a5" },
    include: {
      room: { include: { host: true, attendances: true } },
      joinee: true,
    },
  });

  const formattedJoineeRequests = joineeRequests.map(formatJoinRequest);
  console.log("\nJoinee User-Requests API Output:");
  for (const req of formattedJoineeRequests) {
    const isShownInCompletedTab =
      Boolean(req.isCompleted || (req.status === "CONFIRMED" && req.roomStatus === "COMPLETED") || (req.status === "CONFIRMED" && req.isClosed)) &&
      req.isWithin90Days !== false;

    console.log(`Request [${req.id}] for Room "${req.roomTitle}":`, {
      status: req.status,
      roomStatus: req.roomStatus,
      hasAttended: req.hasAttended,
      isCompleted: req.isCompleted,
      isClosed: req.isClosed,
      isWithin90Days: req.isWithin90Days,
      IS_SHOWN_IN_JOINEE_COMPLETED_TAB: isShownInCompletedTab,
    });
  }
}

verify().catch(console.error).finally(() => prisma.$disconnect());
