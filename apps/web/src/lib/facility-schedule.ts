/* Facility schedule -- the weekly time slots an athlete is in the building.
 *
 * Programs (Settings → Programs) are one per workout type -- Hitting,
 * Pitching, Lifting, Catching, plus any a coach adds. Each has a colour, the
 * season's start / end dates and the start times offered on each weekday.
 * They load from GET /facility-programs into the registry below (see
 * useFacilityPrograms); every colour / name / date lookup reads it.
 *
 * An athlete's schedule is stored on Player.facilitySchedule as a JSON array,
 * one entry per program:
 *   [{ program: "HITTING_PROGRAM", days: { mon: "16:00", wed: "16:00" },
 *      startDate: null, endDate: null }]
 * A program entry runs on its PROGRAM's dates; a Lesson (not a program --
 * one-on-one, any time) keeps its own startDate / endDate. Entries saved
 * before Settings → Programs existed carry their own dates, used as a
 * fallback while the program has none.
 *
 * Program weeks run Mon–Sun; Week 1 is the week the program starts in. An
 * athlete's Day 1 / Day 2 / Day 3 are their picked weekdays for that program
 * in Monday-first order -- what Apply Calendar matches between athletes.
 *
 * Mirrored by the API's facility-programs.service.ts.
 */

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface FacilitySlot {
  program: string;
  /** Weekday → start time ("HH:MM", 24h). Only the picked days are present. */
  days: Partial<Record<WeekdayKey, string>>;
  /** Lesson (and legacy) entries only: first day it applies. */
  startDate: string | null;
  /** Lesson (and legacy) entries only: last day it applies, inclusive. */
  endDate: string | null;
}

export interface FacilityProgram {
  key: string;
  label: string;
  color: string;
  startDate: string | null;
  endDate: string | null;
  /** Weekday → start times offered ("HH:MM", sorted). */
  hours: Partial<Record<WeekdayKey, string[]>>;
  /** The four defaults: renamable, not removable. */
  builtIn: boolean;
}

/** Monday-first, the order the pickers show them. */
export const WEEKDAYS: { key: WeekdayKey; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday',    short: 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday',  short: 'Thu' },
  { key: 'fri', label: 'Friday',    short: 'Fri' },
  { key: 'sat', label: 'Saturday',  short: 'Sat' },
  { key: 'sun', label: 'Sunday',    short: 'Sun' },
];
const WEEKDAY_ORDER: WeekdayKey[] = WEEKDAYS.map((d) => d.key);

/** Date.getDay() (0 = Sunday) → weekday key. */
const DAY_INDEX: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const LESSON_KEY = 'LESSON';
/** Lessons aren't a program, so their colour lives here. */
const LESSON = { key: LESSON_KEY, label: 'Lesson', color: '#a76ddf' };

/* Colours are muted -- each is the bright base (Tailwind blue/red/orange/
   green 500) with 30% of its saturation taken out. Same as the API's
   defaults; used until the saved list loads. */
const DEFAULT_PROGRAMS: FacilityProgram[] = [
  { key: 'HITTING_PROGRAM',  label: 'Hitting Program',  color: '#5789da', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'PITCHING_PROGRAM', label: 'Pitching Program', color: '#d55e5e', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'LIFTING_PROGRAM',  label: 'Lifting Program',  color: '#d77938', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'CATCHING_PROGRAM', label: 'Catching Program', color: '#3aad64', startDate: null, endDate: null, hours: {}, builtIn: true },
];

let registry: FacilityProgram[] = DEFAULT_PROGRAMS;

/** Called by useFacilityPrograms once the saved list arrives. */
export function setFacilityPrograms(list: FacilityProgram[]) {
  if (Array.isArray(list) && list.length) registry = list;
}

/** Every program, in Settings order (no Lesson). */
export function getFacilityPrograms(): FacilityProgram[] {
  return registry;
}

export function getProgram(key: string): FacilityProgram | undefined {
  return registry.find((p) => p.key === key);
}

/** Programs plus Lesson -- the athlete schedule dropdown and the legend. */
export function scheduleChoices(): { key: string; label: string; color: string }[] {
  return [...registry.map(({ key, label, color }) => ({ key, label, color })), LESSON];
}

export function programColor(key: string): string {
  if (key === LESSON_KEY) return LESSON.color;
  return getProgram(key)?.color ?? '#64748b';
}

export function programLabel(key: string): string {
  if (key === LESSON_KEY) return LESSON.label;
  return getProgram(key)?.label ?? key;
}

export function parseFacilitySchedule(raw: string | null | undefined): FacilitySlot[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((e) => e && typeof e === 'object' && typeof e.program === 'string' && e.days && typeof e.days === 'object')
      : [];
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

/** "2026-11-02" → "Nov 2, 2026". */
export function formatDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The dates an entry is live: its program's season, else its own dates
 *  (Lessons, and entries saved before programs had dates). */
export function entryDates(s: FacilitySlot): { start: string | null; end: string | null } {
  if (s.program !== LESSON_KEY) {
    const p = getProgram(s.program);
    if (p && (p.startDate || p.endDate)) return { start: p.startDate, end: p.endDate };
  }
  return { start: s.startDate ?? null, end: s.endDate ?? null };
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function mondayOf(iso: string): Date {
  const d = isoToDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** An athlete's weekdays for one program, Monday-first: [0] is their Day 1. */
export function programDaysOf(schedule: FacilitySlot[], programKey: string): WeekdayKey[] {
  const days = new Set<WeekdayKey>();
  for (const s of schedule) {
    if (s.program !== programKey) continue;
    for (const d of WEEKDAY_ORDER) if (s.days[d]) days.add(d);
  }
  return WEEKDAY_ORDER.filter((d) => days.has(d));
}

/** Program week of a date: 1 = the Mon–Sun week the program starts in.
 *  Null when the program has no start date or the date is before it. */
export function programWeek(programKey: string, iso: string): number | null {
  const start = getProgram(programKey)?.startDate;
  if (!start || iso < start) return null;
  const ms = mondayOf(iso).getTime() - mondayOf(start).getTime();
  return Math.round(ms / (7 * 24 * 3600 * 1000)) + 1;
}

export interface SlotOnDay {
  program: string;
  label: string;
  color: string;
  time: string;
  /** Program week (1-based), when the program has a start date. */
  week: number | null;
  /** 1st / 2nd / 3rd workout of the athlete's week for this program. */
  day: number | null;
}

/** The facility slots that fall on a local YYYY-MM-DD date, earliest first. */
export function slotsOnDate(schedule: FacilitySlot[], iso: string): SlotOnDay[] {
  if (!schedule.length) return [];
  const weekday = DAY_INDEX[isoToDate(iso).getDay()];
  const out: SlotOnDay[] = [];
  for (const s of schedule) {
    const { start, end } = entryDates(s);
    if (start && iso < start) continue;
    if (end && iso > end) continue;
    const time = s.days[weekday];
    if (!time) continue;
    const isProgram = s.program !== LESSON_KEY;
    const k = isProgram ? programDaysOf(schedule, s.program).indexOf(weekday) : -1;
    out.push({
      program: s.program,
      label: programLabel(s.program),
      color: programColor(s.program),
      time,
      week: isProgram ? programWeek(s.program, iso) : null,
      day: k >= 0 ? k + 1 : null,
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** "Week 3 · Day 1" (or just "Day 1" before the program has dates). */
export function weekDayLabel(sl: { week: number | null; day: number | null }, short = false): string {
  const parts: string[] = [];
  if (sl.week) parts.push(short ? `Wk ${sl.week}` : `Week ${sl.week}`);
  if (sl.day) parts.push(short ? `D${sl.day}` : `Day ${sl.day}`);
  return parts.join(' · ');
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
    if (s.program === LESSON_KEY) {
      if (!s.endDate) return `${name}: pick an end date.`;
      if (s.startDate && s.startDate > s.endDate) return `${name}: the end date is before the start date.`;
    }
  }
  return null;
}

/** A new schedule card's starting program, read from the athlete's tags: a
 *  Catching Program athlete starts on Catching, a lesson-only athlete on
 *  Lesson, everyone else on the first program (Hitting). */
export function defaultProgramFor(athleteTypesCsv: string | null | undefined): string {
  const tags = (athleteTypesCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tags.some((t) => t.startsWith('CATCHING_PROGRAM')) && getProgram('CATCHING_PROGRAM')) return 'CATCHING_PROGRAM';
  if (tags.length > 0 && tags.every((t) => t === 'LESSON')) return LESSON_KEY;
  return registry[0]?.key ?? 'HITTING_PROGRAM';
}

/** Programs an athlete has facility days for that are still running on or
 *  after `fromIso`. Drives the program boxes in Apply Calendar. */
export function activeScheduledPrograms(raw: string | null | undefined, fromIso: string): Set<string> {
  const out = new Set<string>();
  for (const s of parseFacilitySchedule(raw)) {
    if (s.program === LESSON_KEY) continue;
    const { end } = entryDates(s);
    if (end && end < fromIso) continue;
    if (Object.values(s.days).some(Boolean)) out.add(s.program);
  }
  return out;
}

/** The program groups coaches work with (Apply Calendar's program boxes,
 *  Attendance → Facility Check In): every program, never Lesson. */
export function facilityGroups(): { key: string; label: string }[] {
  return registry.map(({ key, label }) => ({ key, label }));
}
