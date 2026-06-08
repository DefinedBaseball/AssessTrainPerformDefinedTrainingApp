/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Search EVERY report's content for any sub-1 decimal value, especially
  // the user's 0.924716321 — would tell us if it lives in atBatAssessment
  // or some other JSON block.
  const reports = await prisma.report.findMany({
    select: { id: true, playerId: true, reportType: true, content: true },
  });
  console.log(`Scanning ${reports.length} reports...`);
  for (const r of reports) {
    if (!r.content) continue;
    // Find decimals like 0.92xxxx
    const match = r.content.match(/0\.92[0-9]{2,}/g);
    if (match) {
      const p = await prisma.player.findUnique({ where: { id: r.playerId }, select: { firstName: true, lastName: true } });
      const name = p ? `${p.firstName} ${p.lastName}` : r.playerId;
      console.log(`\n  ${name} (${r.reportType}): ${match.slice(0, 5).join(', ')}`);
      // Show the JSON keys nearby
      try {
        const c = JSON.parse(r.content);
        const walk = (obj: any, path: string[] = []): void => {
          if (obj == null) return;
          if (typeof obj === 'number' && obj > 0.9 && obj < 1) {
            console.log(`    ${path.join('.')} = ${obj}`);
          } else if (typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) walk(v, [...path, k]);
          }
        };
        walk(c);
      } catch {}
    }
  }
}
main().finally(() => prisma.$disconnect());
