/* ─────────────────────────────────────────────────────────────────────────
   Modular (super-set) days -- shared by the Training calendar and the
   Program board so both group a day the same way.

   A position's day is Modular once any of its scheduled drills carries a
   set number (ScheduledDrill.block); otherwise it's Structured (grouped by
   section). A Modular day reads as Set 1, Set 2 ... in set-number order;
   drills with no set number (pasted in beside a set day) trail as extra
   sets of up to MAX_BLOCK_DRILLS so nothing is hidden.
   ───────────────────────────────────────────────────────────────────────── */

export const MAX_BLOCK_DRILLS = 8;

/** "16:30" -> minutes since midnight (sort helper). */
function minutes(t: string | null | undefined): number {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** A position's day is Modular once any of its rows carries a set number. */
export function isModularRows(rows: { block?: number | null }[]): boolean {
  return rows.some((r) => r.block != null);
}

/** A Modular day's rows as ordered sets (see the note above). */
export function groupBlocks<T extends { block?: number | null; order: number; sectionOrder: number; time: string }>(rows: T[]): T[][] {
  const byBlock = new Map<number, T[]>();
  const loose: T[] = [];
  for (const r of rows) {
    if (r.block == null) { loose.push(r); continue; }
    const arr = byBlock.get(r.block) || [];
    arr.push(r);
    byBlock.set(r.block, arr);
  }
  const byPos = (a: T, b: T) => a.order - b.order || minutes(a.time) - minutes(b.time);
  const out = [...byBlock.entries()].sort((a, b) => a[0] - b[0]).map(([, arr]) => arr.sort(byPos));
  loose.sort((a, b) => a.sectionOrder - b.sectionOrder || byPos(a, b));
  for (let i = 0; i < loose.length; i += MAX_BLOCK_DRILLS) out.push(loose.slice(i, i + MAX_BLOCK_DRILLS));
  return out;
}
