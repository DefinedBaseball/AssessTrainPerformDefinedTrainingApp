/**
 * Replace ONLY the drill library with the workbook-generated set (drills.seed.ts).
 * Safe to run against a live DB: deleting Drills sets ScheduledDrill.drillId to
 * null (onDelete: SetNull) but keeps the schedule rows (name/tab/category are
 * denormalised), and it never touches players / reports / videos / metrics.
 *
 *   npx ts-node --transpile-only prisma/reseed-drills.ts
 */
import { PrismaClient } from '@prisma/client';
import { DRILLS } from './drills.seed';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.drill.count();
  await prisma.drill.deleteMany();

  try {
    for (let i = 0; i < DRILLS.length; i += 500) {
      await prisma.drill.createMany({ data: DRILLS.slice(i, i + 500) });
    }
  } catch (e) {
    console.warn('createMany unavailable, falling back to individual inserts:', (e as Error).message);
    for (const d of DRILLS) await prisma.drill.create({ data: d });
  }

  const after = await prisma.drill.count();
  const byTab = await prisma.drill.groupBy({ by: ['tab'], _count: { _all: true } });
  console.log(`Drill library replaced: ${before} -> ${after} drills`);
  for (const row of byTab) console.log(`  ${row.tab}: ${row._count._all}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
