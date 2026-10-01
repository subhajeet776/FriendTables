import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rooms = await prisma.room.findMany({ include: { host: true } });
  console.log("==========================================");
  console.log(`Current DB Room Count: ${rooms.length}`);
  rooms.forEach((r) => {
    console.log({
      id: r.id,
      title: r.title,
      status: r.status,
      hostPhone: r.host.phone,
      joiningFee: r.joiningFee,
      publishedAt: r.publishedAt,
    });
  });
  console.log("==========================================");
  await prisma.$disconnect();
}

main();
