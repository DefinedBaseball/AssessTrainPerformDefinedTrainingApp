/* Athlete-type tagging — single source of truth for the categories, their
 * labels, and the filter logic. Stored on Player.athleteTypes as a
 * comma-separated code list (same convention as `positions`), e.g.
 * "WINTER_PROGRAM,MEMBERSHIP".
 *
 * Shared by:
 *   - the athletes-list filter dropdown (apps/web/.../athletes/page.tsx)
 *   - the player-edit multiselect (ReportModal SUMMARY form)
 *   - the new-player form (apps/web/.../players/new/page.tsx)
 *   - Athletes Announcement targeting on the coach dashboard, which sends a
 *     post to every player carrying the chosen tag
 *
 * NOTE ON THE 2026-09 CHANGE: the single `PROGRAM` tag was split into three
 * seasonal programs per coach spec. Two consequences worth knowing:
 *   - Any player still carrying the old `PROGRAM` code matches no filter and
 *     shows no tag; they need re-tagging to a season. Nothing is deleted, so
 *     the old value survives in the DB until the profile is next saved.
 *   - The old "a MEMBERSHIP athlete also matches the PROGRAM filter" rule is
 *     gone. There is no single program for a membership to imply now, and
 *     implying all three seasons would be a guess.
 */

export interface AthleteTypeDef {
  key: string;
  /** Label for the edit multiselect and the announcement targeting list. */
  label: string;
}

/** The selectable types, in display order. */
export const ATHLETE_TYPES: AthleteTypeDef[] = [
  { key: 'WINTER_PROGRAM', label: 'Winter Program' },
  { key: 'SUMMER_PROGRAM', label: 'Summer Program' },
  { key: 'FALL_PROGRAM',   label: 'Fall Program' },
  { key: 'MEMBERSHIP',     label: 'Membership' },
  { key: 'LESSON',         label: 'Lesson' },
  { key: 'REMOTE',         label: 'Remote' },
];

/** Filter dropdown options for the athletes list — every type plus "All". */
export const ATHLETE_TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All Athletes' },
  ...ATHLETE_TYPES.map(t => ({ key: t.key, label: t.label })),
];

/** Parse the CSV athleteTypes field into an array of codes. */
export function parseAthleteTypes(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Label for a single code, falling back to the raw code if unknown. */
export function athleteTypeLabel(key: string): string {
  return ATHLETE_TYPES.find(t => t.key === key)?.label ?? key;
}

/**
 * Does a player (by their athleteTypes CSV) match the given filter key?
 *
 * "ALL" matches everyone regardless of tags. Every other key is a plain
 * membership test — see the note at the top of this file about the retired
 * Membership→Program implication.
 */
export function matchesAthleteTypeFilter(
  csv: string | null | undefined,
  filterKey: string,
): boolean {
  if (!filterKey || filterKey === 'ALL') return true;
  return parseAthleteTypes(csv).includes(filterKey);
}
