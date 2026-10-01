import { prisma } from "./src/db";

async function check() {
  const rooms = await prisma.room.findMany({ include: { host: true } });
  console.log("All Rooms in DB:", rooms.map(r => ({ id: r.id, title: r.title, hostId: r.hostId, hostName: r.host?.name })));

  const users = await prisma.user.findMany();
  console.log("All Users in DB:", users.map(u => ({ id: u.id, name: u.name, phone: u.phone })));
}

check().catch(console.error).finally(() => prisma.$disconnect());
