/**
 * One-time reshape of an EXISTING Hitting drill library to the Final Drills
 * List (hitting-drills.v2.ts): Movement Prep / Vision / Drills, where Drills
 * replaces the old Tee / Flips / Batting Practice / Machine / Live library
 * categories (the calendar keeps those as sections, all drawing from Drills).
 *
 * Per listed drill, matched by name (case / punctuation-insensitive) within
 * the old categories it can come from:
 *   - found   → that row is kept (id, video, calendar links) and moved to its
 *               new category with the list's spelling. A drill found in more
 *               than one old section (e.g. "Top Hand" in Tee and Flips) keeps
 *               one row (one with a video first); calendar entries on the
 *               other copies are re-pointed to it, and copies without a
 *               video are removed.
 *   - missing → created.
 * Old hitting drills that are NOT on the list are not deleted: they move to
 * a "Not on List" category (hidden from pickers and the Drill Library, still
 * linked from calendars) and are reported, for the coaches to decide.
 *
 * seed.prod.ts runs this once per database (AppSetting flag); locally:
 *   npx ts-node --transpile-only prisma/migrate-hitting-drills.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { HITTING_DRILLS_V2 } from './hitting-drills.v2';

export const HITTING_V2_FLAG = 'migration.hittingDrillsV2';
/* Holding category for old hitting drills that aren't on the list. */
export const NOT_ON_LIST = 'Not on List';

/* Old library categories each new one can take drills from. */
const SOURCES: Record<string, string[]> = {
  'Movement Prep': ['Movement Prep'],
  Vision: ['Vision'],
  Drills: ['Drills', 'Tee', 'Flips', 'Batting Practice', 'Machine', 'Live', 'Front Toss'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export interface HittingV2Result {
  kept: number;
  created: number;
  mergedCopies: number;
  removedCopies: number;
  repointedSchedule: number;
  leftover: { id: string; name: string; category: string; hasVideo: boolean }[];
}

export async function migrateHittingDrills(prisma: PrismaClient, dryRun = false): Promise<HittingV2Result> {
  const old = await prisma.drill.findMany({ where: { tab: 'hitting' }, orderBy: { createdAt: 'asc' } });
  const used = new Set<string>();
  const result: HittingV2Result = { kept: 0, created: 0, mergedCopies: 0, removedCopies: 0, repointedSchedule: 0, leftover: [] };

  for (const [category, names] of Object.entries(HITTING_DRILLS_V2)) {
    const from = SOURCES[category] || [category];
    for (const name of names) {
      const hits = old.filter((d) => !used.has(d.id) && from.includes(d.category) && norm(d.name) === norm(name));
      if (!hits.length) {
        result.created++;
        if (!dryRun) await prisma.drill.create({ data: { name, tab: 'hitting', category } });
        continue;
      }
      const keep = hits.find((d) => d.videoUrl) || hits[0];
      hits.forEach((d) => used.add(d.id));
      result.kept++;
      if (!dryRun && (keep.name !== name || keep.category !== category)) {
        await prisma.drill.update({ where: { id: keep.id }, data: { name, category } });
      }
      for (const copy of hits.filter((d) => d.id !== keep.id)) {
        result.mergedCopies++;
        const n = await prisma.scheduledDrill.count({ where: { drillId: copy.id } });
        result.repointedSchedule += n;
        if (dryRun) { if (!copy.videoUrl) result.removedCopies++; continue; }
        if (n) await prisma.scheduledDrill.updateMany({ where: { drillId: copy.id }, data: { drillId: keep.id } });
        /* A copy with its own video stays (reported) so no video is lost. */
        if (copy.videoUrl) { used.delete(copy.id); continue; }
        await prisma.drill.delete({ where: { id: copy.id } });
        result.removedCopies++;
      }
    }
  }

  const leftover = old.filter((d) => !used.has(d.id) && d.category !== NOT_ON_LIST);
  result.leftover = leftover.map((d) => ({ id: d.id, name: d.name, category: d.category, hasVideo: !!d.videoUrl }));
  /* Filed under "Not on List" (old section kept in tags as was:<section>):
     out of every picker and the Drill Library, still linked from calendars,
     shown in Settings → Drills for the coaches to decide on. */
  if (!dryRun) {
    for (const d of leftover) {
      const was = `was:${d.category}`;
      await prisma.drill.update({
        where: { id: d.id },
        data: { category: NOT_ON_LIST, tags: d.tags ? `${d.tags},${was}` : was },
      });
    }
  }
  return result;
}

/* Runs once per database: seed.prod calls this on every deploy. */
export async function migrateHittingDrillsOnce(prisma: PrismaClient): Promise<void> {
  const done = await prisma.appSetting.findUnique({ where: { key: HITTING_V2_FLAG } });
  if (done) {
    console.log('[hitting-drills-v2] already applied — skipped');
    return;
  }
  const r = await migrateHittingDrills(prisma);
  await prisma.appSetting.create({
    data: {
      key: HITTING_V2_FLAG,
      value: JSON.stringify({ at: new Date().toISOString(), ...r, leftover: r.leftover.length }),
    },
  });
  console.log(`[hitting-drills-v2] kept ${r.kept}, created ${r.created}, merged ${r.mergedCopies} copies `
    + `(${r.removedCopies} removed, ${r.repointedSchedule} calendar rows re-pointed), ${r.leftover.length} not on the list moved to "${NOT_ON_LIST}"`);
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  (dryRun ? migrateHittingDrills(prisma, true) : migrateHittingDrillsOnce(prisma).then(() => null))
    .then((r) => { if (r) console.log(JSON.stringify({ ...r, leftover: r.leftover.length }, null, 2)); })
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
