/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Look at every player's squared_up_pct distribution from FULL_SWING source.
  const rows = await prisma.metric.findMany({
    where: { source: 'FULL_SWING', metricType: 'squared_up_pct' },
    select: { value: true, playerId: true, uploadId: true, recordedAt: true },
  });
  console.log(`Total FULL_SWING squared_up_pct rows: ${rows.length}`);
  if (rows.length === 0) return;

  // Group by playerId, summarise distribution
  const byPlayer = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byPlayer.get(r.playerId) ?? [];
    arr.push(r.value);
    byPlayer.set(r.playerId, arr);
  }

  for (const [pid, values] of byPlayer.entries()) {
    const player = await prisma.player.findUnique({
      where: { id: pid }, select: { firstName: true, lastName: true },
    });
    const name = player ? `${player.firstName} ${player.lastName}` : pid;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // Tally the 0 / 100 / other distribution
    const zeros = values.filter(v => v === 0).length;
    const hundreds = values.filter(v => v === 100).length;
    const between = values.length - zeros - hundreds;
    console.log(`\n${name}  (rows=${values.length})`);
    console.log(`  min=${min}  max=${max}  mean=${mean.toFixed(4)}`);
    console.log(`  distribution: ${zeros}× 0   ${hundreds}× 100   ${between}× other`);
    if (between > 0) {
      const others = values.filter(v => v !== 0 && v !== 100).slice(0, 10);
      console.log(`  sample non-binary values: ${others.join(', ')}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
