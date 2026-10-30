/* Facility schedule -- the weekly time slots an athlete is in the building.
 *
 * Stored on Player.facilitySchedule as a JSON array (one entry per program):
 *   [{ program: "HITTING_PROGRAM", days: { mon: "18:00", wed: "18:00" },
 *      startDate: "2026-11-02", endDate: "2027-03-01" }]
 *
 * A coach sets it (Edit Profile, or the clock on Upcoming Drills); the
 * athlete sees each slot as a coloured, timed chip on Upcoming Drills and on
 * the Training Calendar's Month and Week views.
 *
 * SCHEDULE_PROGRAMS is mirrored by FACILITY_PROGRAMS in the API's
 * players.service.ts -- keep the two in step.
 */

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface FacilitySlot {
  program: string;
  /** Weekday → start time ("HH:MM", 24h). Only the picked days are present. */
  days: Partial<Record<WeekdayKey, string>>;
  /** First day the schedule applies (YYYY-MM-DD). Null = no lower bound. */
  startDate: string | null;
  /** Last day the schedule applies (YYYY-MM-DD), inclusive. */
  endDate: string;
}

/** Monday-first, the order the picker shows them. */
export const WEEKDAYS: { key: WeekdayKey; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday',    short: 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday',  short: 'Thu' },
  { key: 'fri', label: 'Friday',    short: 'Fri' },
  { key: 'sat', label: 'Saturday',  short: 'Sat' },
  { key: 'sun', label: 'Sunday',    short: 'Sun' },
];

/** Date.getDay() (0 = Sunday) → weekday key. */
const DAY_INDEX: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* Colours are muted -- each is the bright base (Tailwind blue/red/orange/
   green/purple 500) with 30% of its saturation taken out. */
/** The workout types a slot can be, with their colour. Deliberately NOT the
 *  athlete-type tags (Winter Program, Summer Program, ...): one season's
 *  program runs Hitting, Pitching and Lifting at different times, so the
 *  calendar is coloured by the workout, while the profile keeps the season
 *  tags. */
export const SCHEDULE_PROGRAMS: { key: string; label: string; color: string }[] = [
  { key: 'HITTING_PROGRAM',  label: 'Hitting Program',  color: '#5789da' }, // blue
  { key: 'PITCHING_PROGRAM', label: 'Pitching Program', color: '#d55e5e' }, // red
  { key: 'LIFTING_PROGRAM',  label: 'Lifting Program',  color: '#d77938' }, // orange
  { key: 'CATCHING_PROGRAM', label: 'Catching Program', color: '#3aad64' }, // green
  { key: 'LESSON',           label: 'Lesson',           color: '#a76ddf' }, // purple
];

export function programColor(key: string): string {
  return SCHEDULE_PROGRAMS.find((p) => p.key === key)?.color ?? '#64748b';
}

export function programLabel(key: string): string {
  return SCHEDULE_PROGRAMS.find((p) => p.key === key)?.label ?? key;
}

export function parseFacilitySchedule(raw: string | null | undefined): FacilitySlot[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && e.days && e.endDate) : [];
  } catch {
    return [];
  }
}

/** "18:00" → "6:00 PM". */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export interface SlotOnDay {
  program: string;
  label: string;
  color: string;
  time: string;
}

/** The facility slots that fall on a local YYYY-MM-DD date, earliest first. */
export function slotsOnDate(schedule: FacilitySlot[], iso: string): SlotOnDay[] {
  if (!schedule.length) return [];
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = DAY_INDEX[new Date(y, m - 1, d).getDay()];
  const out: SlotOnDay[] = [];
  for (const s of schedule) {
    if (s.startDate && iso < s.startDate) continue;
    if (iso > s.endDate) continue;
    const time = s.days[weekday];
    if (!time) continue;
    out.push({ program: s.program, label: programLabel(s.program), color: programColor(s.program), time });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** What's wrong with a schedule before it is saved, or null when it's fine.
 *  The API refuses the same things; checking here first means Edit Profile
 *  can stop before saving anything else. */
export function facilityScheduleProblem(schedule: FacilitySlot[]): string | null {
  for (const s of schedule) {
    const name = programLabel(s.program) || 'A schedule';
    const picked = Object.values(s.days).filter(Boolean);
    if (!s.program) return 'Pick a program for every facility schedule.';
    if (picked.length === 0) return `${name}: pick at least one day.`;
    if (picked.some((t) => !/^\d{2}:\d{2}$/.test(t as string))) return `${name}: every picked day needs a start time.`;
    if (!s.endDate) return `${name}: pick an end date.`;
    if (s.startDate && s.startDate > s.endDate) return `${name}: the end date is before the start date.`;
  }
  return null;
}

/** A new schedule card's starting workout type, read from the athlete's
 *  tags: a Catching Program athlete starts on Catching, a lesson-only athlete
 *  on Lesson, everyone else on Hitting. */
export function defaultProgramFor(athleteTypesCsv: string | null | undefined): string {
  const tags = (athleteTypesCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tags.some((t) => t.startsWith('CATCHING_PROGRAM'))) return 'CATCHING_PROGRAM';
  if (tags.length > 0 && tags.every((t) => t === 'LESSON')) return 'LESSON';
  return 'HITTING_PROGRAM';
}
