import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Delete test JoinRequests and RoomParticipants
  await prisma.joinRequest.deleteMany({});
  await prisma.roomParticipant.deleteMany({});
  // Delete test rooms
  const deleteResult = await prisma.room.deleteMany({});

  const userCount = await prisma.user.count();
  const roomCount = await prisma.room.count();

  console.log("==========================================");
  console.log("🧹 CLEANUP COMPLETE");
  console.log("==========================================");
  console.log(`Users remaining: ${userCount}`);
  console.log(`Rooms remaining: ${roomCount}`);
  console.log("==========================================");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
