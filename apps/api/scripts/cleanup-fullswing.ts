/// <reference types="node" />
/**
 * Wipe every FULL_SWING metric row + CsvUpload record. Same purpose as
 * cleanup-blast: the SquaredUp parser fix means existing per-swing
 * squared_up_pct rows (all = 100 because the parser was dropping the
 * non-squared-up swings) need to go away before re-uploading. Once
 * deleted, re-uploading each Full Swing CSV writes the correct mix
 * of 0 / 100 per swing → session mean = real squared-up %.
 *
 * Usage:
 *   cd apps/api
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-fullswing.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-fullswing.ts --confirm # actually delete
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
declare const process: { argv: string[]; exit: (code: number) => never };
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  const count = await prisma.metric.count({ where: { source: 'FULL_SWING' } });
  const uploads = await prisma.csvUpload.count({ where: { source: 'FULL_SWING' } });
  console.log(`Found ${count} FULL_SWING metric rows across ${uploads} CsvUpload records.`);

  if (!CONFIRM) {
    console.log('\nDry run — pass --confirm to actually delete.');
    return;
  }

  const dm = await prisma.metric.deleteMany({ where: { source: 'FULL_SWING' } });
  const du = await prisma.csvUpload.deleteMany({ where: { source: 'FULL_SWING' } });
  console.log(`Deleted ${dm.count} metric rows and ${du.count} CsvUpload rows.`);
  console.log('\nNext: re-upload each player\'s Full Swing CSV. The new parser');
  console.log('writes squared_up_pct = 0 for non-squared-up swings (formerly');
  console.log('dropped), so the session mean equals the true squared-up %.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
