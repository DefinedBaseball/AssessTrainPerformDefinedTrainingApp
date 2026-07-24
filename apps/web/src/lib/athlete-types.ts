/* Athlete-type tagging — single source of truth for the 4 categories, their
 * labels, and the filter logic (incl. the Membership→Program implication).
 * Stored on Player.athleteTypes as a comma-separated code list (same
 * convention as `positions`), e.g. "PROGRAM,MEMBERSHIP".
 *
 * Shared by:
 *   - the athletes-list filter dropdown (apps/web/.../athletes/page.tsx)
 *   - the player-edit multiselect (ReportModal SUMMARY form)
 */

export interface AthleteTypeDef {
  key: string;
  /** Long label for the edit multiselect ("Program Athlete"). */
  label: string;
}

/** The 4 selectable types, in display order. */
export const ATHLETE_TYPES: AthleteTypeDef[] = [
  { key: 'PROGRAM',    label: 'Program Athlete' },
  { key: 'LESSON',     label: 'Lesson Athlete' },
  { key: 'MEMBERSHIP', label: 'Membership Athlete' },
  { key: 'REMOTE',     label: 'Remote Athlete' },
];

/** Filter dropdown options for the athletes list — the 4 types plus "All". */
export const ATHLETE_TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'ALL',        label: 'All Athletes' },
  { key: 'PROGRAM',    label: 'Program Athletes' },
  { key: 'LESSON',     label: 'Lesson Athletes' },
  { key: 'MEMBERSHIP', label: 'Membership Athletes' },
  { key: 'REMOTE',     label: 'Remote Athletes' },
];

/** Parse the CSV athleteTypes field into an array of codes. */
export function parseAthleteTypes(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Does a player (by their athleteTypes CSV) match the given filter key?
 *
 * Implements the Membership→Program implication: a MEMBERSHIP athlete also
 * matches the PROGRAM filter (a membership is a superset of a program), but a
 * plain PROGRAM athlete does NOT match the MEMBERSHIP filter. "ALL" matches
 * everyone regardless of tags.
 */
export function matchesAthleteTypeFilter(
  csv: string | null | undefined,
  filterKey: string,
): boolean {
  if (!filterKey || filterKey === 'ALL') return true;
  const types = parseAthleteTypes(csv);
  if (filterKey === 'PROGRAM') {
    return types.includes('PROGRAM') || types.includes('MEMBERSHIP');
  }
  return types.includes(filterKey);
}
