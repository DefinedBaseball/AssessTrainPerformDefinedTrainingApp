/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const m = await prisma.player.findFirst({
    where: { firstName: 'Mason', lastName: 'Brown' }, select: { id: true },
  });
  if (!m) { console.log('Mason not found'); return; }

  // ALL squared_up rows regardless of source
  const all = await prisma.metric.findMany({
    where: { playerId: m.id, metricType: 'squared_up_pct' },
    select: { source: true, value: true, recordedAt: true },
  });
  const bySrc = new Map<string, number[]>();
  for (const r of all) {
    const arr = bySrc.get(r.source) ?? [];
    arr.push(r.value);
    bySrc.set(r.source, arr);
  }
  console.log(`Mason squared_up_pct by source:`);
  for (const [src, vals] of bySrc) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    console.log(`  ${src.padEnd(15)}  rows=${vals.length}  min=${min}  max=${max}  mean=${mean.toFixed(6)}`);
  }

  // ALL metric rows for Mason — see if anything in the 0.92 range
  const around = await prisma.metric.findMany({
    where: { playerId: m.id, value: { gte: 0.9, lte: 1 } },
    select: { source: true, metricType: true, value: true },
  });
  console.log(`\nAll Mason metrics with value in [0.9, 1]: ${around.length}`);
  for (const r of around.slice(0, 20)) {
    console.log(`  ${r.source.padEnd(15)}  ${r.metricType.padEnd(20)}  value=${r.value}`);
  }

  // Mason's HITTING report content — check atBatAssessment for high-precision floats
  const reports = await prisma.report.findMany({
    where: { playerId: m.id, reportType: 'HITTING' },
    select: { id: true, createdAt: true, content: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`\nMason HITTING reports: ${reports.length}`);
  for (const r of reports) {
    if (!r.content) continue;
    try {
      const c = JSON.parse(r.content);
      const ab = c?.atBatAssessment;
      if (ab && typeof ab === 'object') {
        console.log(`  Report ${r.createdAt.toISOString().slice(0, 10)}  atBatAssessment keys: ${Object.keys(ab).join(', ')}`);
        if (ab.metrics) console.log(`    metrics: ${JSON.stringify(ab.metrics)}`);
      }
    } catch {}
  }
}
main().finally(() => prisma.$disconnect());
