/* ─────────────────────────────────────────────────────────────────────────
   Schedule drag-reorder math (shared by /program and /training calendar).

   Pure functions only — no React, no dnd-kit event handling. Each "move"
   takes the full ScheduledDrill[] for ONE (player, date, tab) scope and the
   active/over identifiers, and returns:
     • rows    — a new, re-sorted array with updated order / sectionOrder
                 (for optimistic UI state), and
     • payload — the minimal [{ id, order? , sectionOrder? }] list to send to
                 api.reorderScheduledDrills().

   Position model (mirrors prisma ScheduledDrill):
     order        = a drill's rank WITHIN its section (category)
     sectionOrder = the section's rank among the day's sections (shared by
                    every drill in that section)
   Both default 0, so an un-reordered day falls back to time order — these
   helpers only assign explicit values once a coach drags.
   ───────────────────────────────────────────────────────────────────────── */
import { arrayMove } from '@dnd-kit/sortable';
import type { ScheduledDrill } from './api';

const catOf = (r: ScheduledDrill) => r.category || 'Drills';

/** Canonical render order: by section rank, then drill rank, then time. */
export function sortScheduled(rows: ScheduledDrill[]): ScheduledDrill[] {
  return [...rows].sort(
    (a, b) =>
      a.sectionOrder - b.sectionOrder ||
      a.order - b.order ||
      (a.time || '').localeCompare(b.time || ''),
  );
}

/** Distinct section (category) names in current render order. */
export function sectionsOf(rows: ScheduledDrill[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of sortScheduled(rows)) {
    const c = catOf(r);
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export interface DrillReorderResult {
  rows: ScheduledDrill[];
  payload: { id: string; order: number }[];
}
export interface SectionReorderResult {
  rows: ScheduledDrill[];
  payload: { id: string; sectionOrder: number }[];
}

/**
 * Move a drill to a new position within its OWN section.
 * `overId` = the drill it was dropped onto (null → drop at end of section).
 */
export function moveDrillWithinSection(
  all: ScheduledDrill[],
  category: string,
  activeId: string,
  overId: string | null,
): DrillReorderResult {
  const sorted = sortScheduled(all);
  const ids = sorted.filter((r) => catOf(r) === category).map((r) => r.id);
  const from = ids.indexOf(activeId);
  if (from === -1) return { rows: sorted, payload: [] };
  let to = overId ? ids.indexOf(overId) : ids.length - 1;
  if (to === -1) to = ids.length - 1;
  if (from === to) return { rows: sorted, payload: [] };
  const newIds = arrayMove(ids, from, to);
  const orderMap = new Map(newIds.map((id, i) => [id, i]));
  const rows = sorted.map((r) =>
    orderMap.has(r.id) ? { ...r, order: orderMap.get(r.id)! } : r,
  );
  const payload = newIds.map((id, i) => ({ id, order: i }));
  return { rows: sortScheduled(rows), payload };
}

/**
 * Move a whole SECTION (category) to where another section sits.
 * Renumbers every section's `sectionOrder`; all drills in a section share it.
 */
export function moveSection(
  all: ScheduledDrill[],
  fromCategory: string,
  toCategory: string,
): SectionReorderResult {
  const secs = sectionsOf(all);
  const from = secs.indexOf(fromCategory);
  const to = secs.indexOf(toCategory);
  if (from === -1 || to === -1 || from === to) return { rows: sortScheduled(all), payload: [] };
  const newSecs = arrayMove(secs, from, to);
  const rank = new Map(newSecs.map((c, i) => [c, i]));
  const rows = all.map((r) => ({ ...r, sectionOrder: rank.get(catOf(r)) ?? r.sectionOrder }));
  const payload = rows.map((r) => ({ id: r.id, sectionOrder: r.sectionOrder }));
  return { rows: sortScheduled(rows), payload };
}
