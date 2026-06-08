/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // ANY metric whose stored value is a decimal in the 0.9-0.95 range —
  // chasing the "0.924716" the user reported seeing on screen.
  const rows = await prisma.metric.findMany({
    where: { value: { gte: 0.9, lte: 0.95 } },
    select: { source: true, metricType: true, value: true, playerId: true, recordedAt: true },
    take: 50,
  });
  console.log(`Total metrics with value in [0.9, 0.95]: ${rows.length}`);
  for (const r of rows) {
    const p = await prisma.player.findUnique({ where: { id: r.playerId }, select: { firstName: true, lastName: true } });
    const name = p ? `${p.firstName} ${p.lastName}` : r.playerId;
    console.log(`  ${name.padEnd(20)}  ${r.source.padEnd(12)}  ${r.metricType.padEnd(20)}  value=${r.value}`);
  }
}
main().finally(() => prisma.$disconnect());
