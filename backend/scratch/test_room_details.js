import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testRoomDetails() {
  const room = await prisma.room.findFirst({
    where: { status: "COMPLETED" },
    include: {
      host: true,
      attendances: true,
      participants: { include: { user: true } },
    },
  });

  if (!room) {
    console.log("No completed room found");
    return;
  }

  console.log("Found completed room in DB ID:", room.id);

  const res = await fetch(`http://localhost:5000/api/v1/rooms/${room.id}`);
  const data = await res.json();
  console.log("=== GET /api/v1/rooms/:id RESPONSE ===");
  console.log(JSON.stringify(data, null, 2));
}

testRoomDetails().finally(() => prisma.$disconnect());
