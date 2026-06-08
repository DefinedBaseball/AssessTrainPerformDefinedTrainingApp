/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find any metric value or report content containing 0.924716
  const metrics = await prisma.metric.findMany({
    where: {
      OR: [
        { value: { gte: 0.92, lte: 0.93 } },
        { value: { gte: 92.4, lte: 92.5 } },
        { value: { gte: 0.9247, lte: 0.9248 } },
      ],
    },
    select: { id: true, source: true, metricType: true, value: true, playerId: true, recordedAt: true },
  });
  console.log(`Found ${metrics.length} metric rows in the 0.92 / 92.4 range:`);
  for (const m of metrics) {
    const p = await prisma.player.findUnique({ where: { id: m.playerId }, select: { firstName: true, lastName: true } });
    const name = p ? `${p.firstName} ${p.lastName}` : m.playerId;
    console.log(`  ${name.padEnd(20)}  ${m.source.padEnd(12)}  ${m.metricType.padEnd(20)}  ${m.value}`);
  }

  // Also check report content for "0.924716" string
  const reports = await prisma.report.findMany({
    where: { content: { contains: '0.924716' } },
    select: { id: true, playerId: true, reportType: true, createdAt: true, content: true },
  });
  console.log(`\nReports with "0.924716" in content: ${reports.length}`);
  for (const r of reports) {
    const p = await prisma.player.findUnique({ where: { id: r.playerId }, select: { firstName: true, lastName: true } });
    const name = p ? `${p.firstName} ${p.lastName}` : r.playerId;
    // Find the JSON path containing 0.924716
    const c = r.content || '';
    const idx = c.indexOf('0.924716');
    const snippet = c.slice(Math.max(0, idx - 50), idx + 80);
    console.log(`  ${name}  ${r.reportType}  ...${snippet}...`);
  }
}
main().finally(() => prisma.$disconnect());
