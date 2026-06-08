/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const masons = await prisma.player.findMany({
    where: { OR: [
      { firstName: { contains: 'Mason' } },
      { lastName: { contains: 'Brown' } },
    ] },
    select: { id: true, firstName: true, lastName: true },
  });
  for (const m of masons) {
    console.log(`\n=== ${m.firstName} ${m.lastName} ===`);
    const reports = await prisma.report.findMany({
      where: { playerId: m.id, reportType: 'HITTING' },
      select: { id: true, createdAt: true, notes: true, content: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const r of reports) {
      console.log(`  Report ${r.id} (${r.createdAt.toISOString().slice(0, 10)})`);
      if (!r.content) { console.log('    no content'); continue; }
      try {
        const c = JSON.parse(r.content);
        if (c.manualBattedBall) {
          console.log(`    manualBattedBall: ${JSON.stringify(c.manualBattedBall)}`);
        }
        if (c.manualEntryModes) {
          console.log(`    manualEntryModes: ${JSON.stringify(c.manualEntryModes)}`);
        }
        if (c.csvUploads) {
          const slots = Object.keys(c.csvUploads);
          console.log(`    csvUpload slots: ${slots.join(', ')}`);
        }
      } catch { console.log('    parse error'); }
    }
  }
}
main().finally(() => prisma.$disconnect());
