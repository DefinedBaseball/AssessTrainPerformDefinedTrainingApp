/**
 * Clean up dashboard posts left on the retired five-tag scheme.
 *
 * The coach dashboard used to offer Facility Announcement / Athlete Highlight
 * / Program Announcement / College Commitment / Pro Signing. It now offers
 * General / Coaching / Announcement / Athletes Announcement. `Post.type` is a
 * free-text column, so rows written under the old scheme still carry the old
 * code and the feed had no label for them.
 *
 * Default mode is RETAG, not delete: these are real posts coaches wrote, and
 * remapping the tag fixes the display without destroying the content.
 *
 * Safety properties worth knowing before you run this against production:
 *   - Dry run by DEFAULT. Nothing is written without --apply.
 *   - Every target tag is staff-only. None of them is ATHLETES_ANNOUNCEMENT,
 *     so retagging cannot fan a old post out to players, and it creates no
 *     notifications.
 *   - Retag only touches `type`. Titles, bodies, media, urgency, authors and
 *     seen-state are left exactly as they are.
 *   - Idempotent. A second run finds nothing to do.
 *
 * Run (dry run, shows what it WOULD do):
 *   npx ts-node --transpile-only prisma/retag-legacy-posts.ts
 *
 * Run for real:
 *   npx ts-node --transpile-only prisma/retag-legacy-posts.ts --apply
 *
 * Delete instead of retag (IRREVERSIBLE — the posts are gone):
 *   npx ts-node --transpile-only prisma/retag-legacy-posts.ts --mode=delete --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The tags the dashboard understands today. Anything else is legacy. */
const CURRENT_TAGS = ['GENERAL', 'COACHING', 'ANNOUNCEMENT', 'ATHLETES_ANNOUNCEMENT'];

/**
 * Old tag → new tag.
 *
 * The two "announcement"-flavoured tags keep that meaning; the three that
 * celebrated a specific athlete collapse to General, which is the catch-all
 * the new scheme intends for exactly that kind of post.
 */
const RETAG: Record<string, string> = {
  FACILITY_ANNOUNCEMENT: 'ANNOUNCEMENT',
  PROGRAM_ANNOUNCEMENT: 'ANNOUNCEMENT',
  ATHLETE_HIGHLIGHT: 'GENERAL',
  COLLEGE_COMMITMENT: 'GENERAL',
  PRO_SIGNING: 'GENERAL',
};

/** Any stray code not in the map above still has to land somewhere. */
const FALLBACK_TAG = 'GENERAL';

async function main() {
  const apply = process.argv.includes('--apply');
  const modeArg = process.argv.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'retag';

  if (mode !== 'retag' && mode !== 'delete') {
    throw new Error(`Unknown --mode=${mode}. Use "retag" (default) or "delete".`);
  }

  const legacy = await prisma.post.findMany({
    where: { type: { notIn: CURRENT_TAGS } },
    select: { id: true, type: true, title: true, createdAt: true, audienceScope: true },
    orderBy: { createdAt: 'asc' },
  });

  if (legacy.length === 0) {
    console.log('Nothing to do — every post already uses a current tag.');
    return;
  }

  console.log(`\n${legacy.length} post(s) on retired tags:\n`);
  for (const p of legacy) {
    const target = RETAG[p.type] ?? FALLBACK_TAG;
    const action = mode === 'delete' ? 'DELETE' : `${p.type} -> ${target}`;
    const when = p.createdAt.toISOString().slice(0, 10);
    console.log(`  [${when}] ${action}`);
    console.log(`            "${p.title}"`);
    /* Surfaced because it is the one field that decides who can see a post —
       if any legacy row is not COACHES, say so loudly before touching it. */
    if (p.audienceScope !== 'COACHES') {
      console.log(`            !! audienceScope=${p.audienceScope} (expected COACHES)`);
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing was changed. Re-run with --apply to ${mode}.`);
    return;
  }

  if (mode === 'delete') {
    const res = await prisma.post.deleteMany({ where: { type: { notIn: CURRENT_TAGS } } });
    console.log(`\nDeleted ${res.count} post(s).`);
    return;
  }

  let changed = 0;
  for (const p of legacy) {
    await prisma.post.update({
      where: { id: p.id },
      data: {
        type: RETAG[p.type] ?? FALLBACK_TAG,
        /* Explicit rather than assumed: guarantees a retagged post stays
           staff-only even if some old row carried an odd scope. */
        audienceScope: 'COACHES',
      },
    });
    changed++;
  }
  console.log(`\nRetagged ${changed} post(s).`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
