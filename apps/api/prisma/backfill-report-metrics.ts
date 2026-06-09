/**
 * One-off backfill: mirror every EXISTING report's manual metric entries
 * into the Metric table (source `REPORT_<id>`), so the Player Summary trend
 * charts immediately reflect reports saved before report→metric syncing was
 * added. Idempotent — re-running re-syncs each report in place (delete its
 * REPORT_<id> rows, re-create). Does NOT touch CSV / VALD / seed metrics.
 *
 * Run:  npx ts-node prisma/backfill-report-metrics.ts
 */
import { PrismaClient } from '@prisma/client';
import { syncReportMetricsFor } from '../src/modules/reports/report-metrics.util';

const prisma = new PrismaClient();

async function main() {
  const reports = await prisma.report.findMany({
    select: { id: true, playerId: true, reportType: true, content: true, createdAt: true },
  });

  let reportsWithMetrics = 0;
  let totalPoints = 0;

  for (const r of reports) {
    // Same manual + CSV-aggregation sync the live API runs on every save.
    const n = await syncReportMetricsFor(prisma, r);
    if (n > 0) {
      reportsWithMetrics++;
      totalPoints += n;
    }
  }

  console.log(`Backfill complete: ${reportsWithMetrics}/${reports.length} reports → ${totalPoints} metric points.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
