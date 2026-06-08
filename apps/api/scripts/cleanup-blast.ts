/**
 * Delete every BLAST_MOTION metric row in the database. Pairs with the
 * new session-summary Blast parser — once this runs, every Blast CSV
 * needs to be re-uploaded so the new parser writes one summary row per
 * metric per upload (instead of the old per-swing rows).
 *
 * Read-then-write — prints a count first, then deletes if --confirm is
 * passed on the command line.
 *
 * Usage:
 *   cd apps/api
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-blast.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-blast.ts --confirm # actually delete
 */
/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
declare const process: { argv: string[]; exit: (code: number) => never };
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  const count = await prisma.metric.count({ where: { source: 'BLAST_MOTION' } });
  console.log(`Found ${count} BLAST_MOTION metric rows in the database.`);

  // Also count the affected upload records so we can blank them too.
  const uploads = await prisma.csvUpload.findMany({
    where: { source: 'BLAST_MOTION' },
    select: { id: true, status: true, totalRows: true },
  });
  console.log(`Found ${uploads.length} BLAST_MOTION CsvUpload records.`);

  if (!CONFIRM) {
    console.log('\nDry run — pass --confirm to actually delete. No changes made.');
    return;
  }

  // Delete metrics first, then the upload records (both gone in one shot).
  const deletedMetrics = await prisma.metric.deleteMany({
    where: { source: 'BLAST_MOTION' },
  });
  const deletedUploads = await prisma.csvUpload.deleteMany({
    where: { source: 'BLAST_MOTION' },
  });
  console.log(`Deleted ${deletedMetrics.count} metric rows and ${deletedUploads.count} CsvUpload rows.`);
  console.log('\nNext step: re-upload each player\'s Blast CSV via the report modal.');
  console.log('The new parser will emit one summary metric per type per upload —');
  console.log('the displayed chips will then exactly match the Excel-computed averages.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
