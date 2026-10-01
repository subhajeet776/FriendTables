import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userCount = await prisma.user.count();
  const roomCount = await prisma.room.count();
  const joinRequestCount = await prisma.joinRequest.count();
  const participantCount = await prisma.roomParticipant.count();

  console.log("==========================================");
  console.log("📊 DATABASE STATUS IN dev.db");
  console.log("==========================================");
  console.log(`Users remaining: ${userCount}`);
  console.log(`Rooms remaining: ${roomCount}`);
  console.log(`JoinRequests remaining: ${joinRequestCount}`);
  console.log(`RoomParticipants remaining: ${participantCount}`);
  console.log("==========================================");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
