import { prisma } from "./src/db";

async function fix() {
  console.log("Updating room 'Chutpaglus' (5ee05314-9763-4335-87c5-7c75873a83e5) canonical dateTime...");
  const updated = await prisma.room.update({
    where: { id: "5ee05314-9763-4335-87c5-7c75873a83e5" },
    data: {
      dateTime: new Date("2026-09-21T18:00:00.000Z"),
      date: "Mon, 21 Sep 2026",
    },
  });
  console.log("Updated Room:", updated);
}

fix().catch(console.error).finally(() => prisma.$disconnect());
