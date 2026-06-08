/**
 * Quick read-only diagnostic — lists every BLAST_MOTION metric the database
 * holds for each player, so we can see whether the values match what the
 * latest parser would produce. Read-only, no writes.
 *
 * Usage:
 *   cd apps/api
 *   npx ts-node -r tsconfig-paths/register scripts/inspect-blast.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const players = await prisma.player.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  for (const p of players) {
    const metrics = await prisma.metric.findMany({
      where: { playerId: p.id, source: 'BLAST_MOTION' },
      orderBy: { recordedAt: 'desc' },
    });
    if (metrics.length === 0) continue;
    const uploadIds = new Set(metrics.map(m => m.uploadId));
    console.log(`\n=== ${p.firstName} ${p.lastName} === (${metrics.length} rows across ${uploadIds.size} upload(s))`);
    // Group by metricType, show count and recent values
    const byType = new Map<string, number[]>();
    for (const m of metrics) {
      const arr = byType.get(m.metricType) ?? [];
      arr.push(m.value);
      byType.set(m.metricType, arr);
    }
    const types = Array.from(byType.keys()).sort();
    for (const t of types) {
      const vals = byType.get(t)!;
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      console.log(`  ${t.padEnd(28)}  rows=${String(vals.length).padStart(4)}  min=${min.toFixed(2)}  max=${max.toFixed(2)}  mean=${mean.toFixed(2)}  latest=${vals[0].toFixed(2)}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
