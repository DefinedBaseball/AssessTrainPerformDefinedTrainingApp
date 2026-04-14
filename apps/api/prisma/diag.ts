import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // 1. All players
  const players = await p.player.findMany({
    select: { id: true, firstName: true, lastName: true, gradYear: true, positions: true },
    orderBy: { gradYear: 'asc' },
  });
  console.log(`\n=== ALL PLAYERS (${players.length}) ===`);
  players.forEach(pl =>
    console.log(`  ${pl.gradYear}  ${pl.firstName} ${pl.lastName}  (${pl.positions})`)
  );

  // 2. Leaderboard for max_exit_velo 2026
  const lb = await p.leaderboardEntry.findMany({
    where: { gradYear: 2026, metricType: 'max_exit_velo' },
    orderBy: { rank: 'asc' },
    include: { player: { select: { firstName: true, lastName: true } } },
  });
  console.log(`\n=== LEADERBOARD: max_exit_velo / 2026 (${lb.length} entries) ===`);
  lb.forEach(e => console.log(`  #${e.rank}  ${e.player.firstName} ${e.player.lastName}  ${e.value}`));

  // 3. Check all 2026 players and their best max_exit_velo
  const p2026 = await p.player.findMany({
    where: { gradYear: 2026 },
    include: {
      metrics: {
        where: { metricType: 'max_exit_velo' },
        orderBy: { value: 'desc' },
        take: 1,
      },
    },
  });
  console.log(`\n=== 2026 CLASS: max_exit_velo per player ===`);
  p2026.forEach(pl => {
    const best = pl.metrics[0];
    console.log(`  ${pl.firstName} ${pl.lastName} (${pl.positions}) -> ${best ? best.value : 'NO DATA'}`);
  });

  // 4. Count metric records per metric type
  const metricCounts = await p.metric.groupBy({
    by: ['metricType'],
    _count: true,
    orderBy: { metricType: 'asc' },
  });
  console.log(`\n=== METRIC RECORD COUNTS ===`);
  metricCounts.forEach(m => console.log(`  ${m.metricType}: ${m._count} records`));

  // 5. Leaderboard totals
  const lbCounts = await p.leaderboardEntry.groupBy({
    by: ['gradYear', 'metricType'],
    _count: true,
    orderBy: [{ gradYear: 'asc' }, { metricType: 'asc' }],
  });
  console.log(`\n=== LEADERBOARD ENTRIES ===`);
  lbCounts.forEach(c => console.log(`  ${c.gradYear} / ${c.metricType}: ${c._count} players`));
}

main().finally(() => p.$disconnect());
