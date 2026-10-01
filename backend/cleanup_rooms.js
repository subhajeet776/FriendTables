import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanupOldRooms() {
  console.log("🧹 Cleaning up old development Room records...");
  const deleteResult = await prisma.room.deleteMany({});
  console.log(`✅ Successfully removed ${deleteResult.count} old Room record(s) from dev.db.`);

  const remainingUsersCount = await prisma.user.count();
  console.log(`ℹ️ Preserved ${remainingUsersCount} existing User account(s) and profile data.`);

  await prisma.$disconnect();
}

cleanupOldRooms().catch(async (err) => {
  console.error("❌ Cleanup failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
