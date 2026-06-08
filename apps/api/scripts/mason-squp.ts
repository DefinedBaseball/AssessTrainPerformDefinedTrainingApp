/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const m = await prisma.player.findFirst({
    where: { firstName: 'Mason', lastName: 'Brown' }, select: { id: true },
  });
  if (!m) { console.log('Mason not found'); return; }
  const rows = await prisma.metric.findMany({
    where: { playerId: m.id, source: 'FULL_SWING', metricType: 'squared_up_pct' },
    orderBy: { recordedAt: 'asc' },
    select: { value: true, recordedAt: true, uploadId: true },
  });
  console.log(`Mason has ${rows.length} squared_up_pct rows:`);
  for (const r of rows) console.log(`  ${r.recordedAt.toISOString()}  value=${r.value}`);
  console.log(`\nMean = ${(rows.reduce((s, r) => s + r.value, 0) / rows.length).toFixed(6)}`);
  console.log(`Count of value > 0: ${rows.filter(r => r.value > 0).length}`);
  console.log(`Count of value > 50: ${rows.filter(r => r.value > 50).length}`);
  console.log(`Count of value === 0: ${rows.filter(r => r.value === 0).length}`);
  console.log(`Count of value === 100: ${rows.filter(r => r.value === 100).length}`);
  console.log(`Proportion with value > 0: ${(rows.filter(r => r.value > 0).length / rows.length).toFixed(6)}`);
  console.log(`Proportion with value > 50: ${(rows.filter(r => r.value > 50).length / rows.length).toFixed(6)}`);
}
main().finally(() => prisma.$disconnect());
