/* ─────────────────────────────────────────────────────────────────────
   Age-normalized baselines for the green / yellow / red metric colours.

   Covers exit velo, bat speed, fastball velo, infield / outfield /
   catcher throws, pop time, catcher exchange and the 60- / 10-yard
   sprints. Each table is P10 / P25 / P50 / P75 / P90 rows: one per age
   up to 18, then College Yr 1-4. The numbers mirror
   "Benchmark Data Sets/*.csv" (SOURCES.md there explains every one) and
   are mostly MODELED, so treat them as a starting point:
     · Age 18 (seniors) is calibrated to BaseballPath's committed-player
       averages: P75 ≈ the Other D1 commit average, P90 ≈ Power 4.
     · College Yr 1-4 move from the Age-18 row halfway toward the MLB row
       by Yr 4 (or by a flat yearly gain where MLB isn't comparable).

   Colours (via toScoutingGrade → scoreColor):
     below P25 → red (grade < 40) · P25-P75 → yellow · P75+ → green (≥ 60)
   and P90+ is flagged "Top 10%". For TIMES (pop, exchange, 60, 10) lower
   is better: the table's P90 is the FASTEST value.

   Which row an athlete is graded on: high schoolers by age (capped at
   the Age-18 row until they graduate); after their grad year's June 1,
   by years out of high school (College Yr 1-4). No grad year → age
   alone; no birthday → estimated from the grad year. Neither → the old
   fixed GRADE_RANGES apply. usePlayerProfileData and the PDF builders
   call setGradingAthlete before anything grades.
   ───────────────────────────────────────────────────────────────────── */

/** [P10, P25, P50, P75, P90]. */
type Pcts = [number, number, number, number, number];

/** Exit Velocity -- ages 8-18, then College Yr 1-4. */
const EXIT_VELO_MAX: Pcts[] = [
  [34.8, 38.4, 42.0, 45.6, 49.2], // 8
  [38.2, 42.1, 46.0, 49.9, 53.8], // 9
  [41.4, 45.7, 50.0, 54.3, 58.6], // 10
  [45.6, 50.3, 55.0, 59.7, 64.4], // 11
  [49.8, 54.9, 60.0, 65.1, 70.2], // 12
  [53.8, 59.4, 65.0, 70.6, 76.2], // 13
  [58.0, 64.0, 70.0, 76.0, 82.0], // 14
  [64.1, 70.6, 77.0, 82.7, 88.2], // 15
  [68.4, 75.1, 81.8, 86.8, 91.4], // 16
  [72.7, 79.6, 86.5, 90.8, 94.5], // 17
  [77.1, 84.2, 91.3, 94.7, 97.2], // 18
  [78.8, 85.9, 93.0, 96.4, 99.0], // College Yr 1
  [80.6, 87.7, 94.8, 98.2, 100.8], // College Yr 2
  [82.3, 89.4, 96.5, 99.9, 102.5], // College Yr 3
  [84.1, 91.2, 98.3, 101.7, 104.2], // College Yr 4
];

/** Pitch Velocity -- ages 8-18, then College Yr 1-4. */
const PITCH_VELO_MAX: Pcts[] = [
  [35.4, 38.0, 41.0, 44.0, 46.3], // 8
  [38.8, 41.8, 45.0, 48.2, 50.9], // 9
  [43.2, 46.4, 50.0, 53.6, 56.5], // 10
  [47.5, 51.0, 55.0, 59.0, 62.1], // 11
  [51.8, 55.7, 60.0, 64.3, 67.8], // 12
  [56.1, 60.3, 65.0, 69.7, 73.5], // 13
  [60.9, 65.4, 70.5, 75.6, 79.7], // 14
  [65.6, 70.5, 76.0, 81.1, 85.1], // 15
  [67.8, 72.8, 78.5, 83.5, 87.1], // 16
  [69.9, 75.1, 81.0, 85.7, 89.1], // 17
  [72.1, 77.5, 83.5, 88, 91], // 18
  [74.9, 79.7, 85.2, 89.3, 92.1], // College Yr 1
  [77.7, 82.0, 86.9, 90.7, 93.2], // College Yr 2
  [80.4, 84.3, 88.6, 92.0, 94.4], // College Yr 3
  [83.2, 86.5, 90.3, 93.3, 95.5], // College Yr 4
];

/** Infield Velocity -- ages 8-18, then College Yr 1-4. */
const INFIELD_VELO: Pcts[] = [
  [34.9, 38.7, 43.0, 47.3, 48.6], // 8
  [38.2, 42.3, 47.0, 51.7, 53.1], // 9
  [42.2, 46.9, 52.0, 57.1, 58.8], // 10
  [46.3, 51.4, 57.0, 62.6, 64.4], // 11
  [50.3, 55.9, 62.0, 68.1, 70.1], // 12
  [54.4, 60.4, 67.0, 73.6, 75.7], // 13
  [58.5, 64.9, 72.0, 79.1, 81.4], // 14
  [61.3, 68.0, 75.5, 82.2, 84.4], // 15
  [62.4, 69.2, 76.8, 82.8, 85.0], // 16
  [63.5, 70.4, 78.2, 83.4, 85.5], // 17
  [64.6, 71.6, 79.5, 84, 86], // 18
  [66.8, 73.1, 80.4, 84.7, 86.8], // College Yr 1
  [69.0, 74.7, 81.2, 85.4, 87.6], // College Yr 2
  [71.2, 76.2, 82.1, 86.1, 88.4], // College Yr 3
  [73.4, 77.7, 83.0, 86.8, 89.2], // College Yr 4
];

/** Outfield Velocity -- ages 8-18, then College Yr 1-4. */
const OUTFIELD_VELO: Pcts[] = [
  [38.1, 41.9, 46.0, 50.1, 51.8], // 8
  [41.5, 45.5, 50.0, 54.5, 56.2], // 9
  [45.6, 50.0, 55.0, 60.0, 61.9], // 10
  [49.7, 54.6, 60.0, 65.4, 67.5], // 11
  [53.9, 59.1, 65.0, 70.8, 73.1], // 12
  [58.0, 63.7, 70.0, 76.3, 78.8], // 13
  [62.2, 68.2, 75.0, 81.8, 84.4], // 14
  [64.3, 70.5, 77.5, 83.5, 86.0], // 15
  [65.8, 72.2, 79.3, 84.4, 86.7], // 16
  [67.3, 73.9, 81.2, 85.2, 87.4], // 17
  [68.8, 75.5, 83, 86, 88], // 18
  [71.2, 77.5, 84.3, 87.4, 89.5], // College Yr 1
  [73.6, 79.4, 85.7, 88.8, 90.9], // College Yr 2
  [76.0, 81.3, 87.0, 90.2, 92.4], // College Yr 3
  [78.4, 83.3, 88.3, 91.6, 93.8], // College Yr 4
];

/** Catcher Velocity -- ages 8-18, then College Yr 1-4. */
const CATCHER_VELO: Pcts[] = [
  [34.0, 36.3, 39.0, 41.7, 42.9], // 8
  [37.4, 40.1, 43.0, 45.9, 47.3], // 9
  [41.8, 44.7, 48.0, 51.3, 52.8], // 10
  [46.2, 49.4, 53.0, 56.6, 58.3], // 11
  [50.5, 54.1, 58.0, 61.9, 63.8], // 12
  [54.9, 58.7, 63.0, 67.3, 69.3], // 13
  [59.2, 63.4, 68.0, 72.6, 74.8], // 14
  [61.8, 66.2, 71.0, 75.3, 77.5], // 15
  [63.0, 67.4, 72.3, 76.2, 78.4], // 16
  [64.1, 68.7, 73.7, 77.1, 79.2], // 17
  [65.3, 69.9, 75, 78, 80], // 18
  [66.9, 71.3, 76.0, 78.8, 80.7], // College Yr 1
  [68.6, 72.6, 77.0, 79.7, 81.4], // College Yr 2
  [70.2, 74.0, 78.1, 80.5, 82.1], // College Yr 3
  [71.9, 75.4, 79.1, 81.3, 82.8], // College Yr 4
];

/** Pop Time -- ages 13-18, then College Yr 1-4. */
const POP_TIME: Pcts[] = [
  [2.6, 2.45, 2.28, 2.11, 2.05], // 13
  [2.51, 2.36, 2.2, 2.04, 1.98], // 14
  [2.44, 2.3, 2.14, 2.0, 1.95], // 15
  [2.41, 2.27, 2.12, 2.0, 1.95], // 16
  [2.39, 2.25, 2.09, 2.0, 1.94], // 17
  [2.36, 2.22, 2.06, 1.99, 1.94], // 18
  [2.31, 2.19, 2.05, 1.98, 1.93], // College Yr 1
  [2.27, 2.16, 2.04, 1.97, 1.92], // College Yr 2
  [2.22, 2.13, 2.02, 1.96, 1.92], // College Yr 3
  [2.18, 2.1, 2.01, 1.94, 1.91], // College Yr 4
];

/** 60 Yard Dash -- ages 8-18, then College Yr 1-4. */
const SPRINT_60: Pcts[] = [
  [11.14, 10.62, 10.05, 9.48, 9.25], // 8
  [10.7, 10.2, 9.65, 9.1, 8.88], // 9
  [10.25, 9.78, 9.25, 8.72, 8.51], // 10
  [9.81, 9.35, 8.85, 8.35, 8.14], // 11
  [9.37, 8.93, 8.45, 7.97, 7.77], // 12
  [8.92, 8.51, 8.05, 7.59, 7.41], // 13
  [8.53, 8.14, 7.7, 7.26, 7.08], // 14
  [8.36, 7.98, 7.55, 7.18, 7.02], // 15
  [8.21, 7.84, 7.42, 7.12, 6.98], // 16
  [8.07, 7.7, 7.28, 7.05, 6.93], // 17
  [7.92, 7.56, 7.15, 6.98, 6.88], // 18
  [7.87, 7.51, 7.1, 6.93, 6.83], // College Yr 1
  [7.82, 7.46, 7.05, 6.88, 6.78], // College Yr 2
  [7.77, 7.41, 7.0, 6.83, 6.73], // College Yr 3
  [7.72, 7.36, 6.95, 6.78, 6.68], // College Yr 4
];

/** Bat Speed -- ages 8-18, then College Yr 1-4. */
const BAT_SPEED_AVG: Pcts[] = [
  [37.9, 40.1, 42.5, 44.9, 47.1], // 8
  [40.1, 42.4, 45.0, 47.6, 49.9], // 9
  [42.3, 44.8, 47.5, 50.2, 52.7], // 10
  [44.6, 47.1, 50.0, 52.9, 55.4], // 11
  [46.8, 49.5, 52.5, 55.5, 58.2], // 12
  [49.0, 51.8, 55.0, 58.2, 61.0], // 13
  [51.2, 54.2, 57.5, 60.8, 63.8], // 14
  [53.5, 56.6, 60.0, 63.4, 66.5], // 15
  [55.7, 58.9, 62.5, 66.1, 69.3], // 16
  [57.7, 61.1, 64.8, 68.5, 71.9], // 17
  [59.8, 63.3, 67.1, 70.9, 74.4], // 18
  [60.9, 64.2, 67.7, 71.3, 74.6], // College Yr 1
  [62.0, 65.0, 68.4, 71.8, 74.7], // College Yr 2
  [63.1, 65.9, 69.0, 72.2, 74.9], // College Yr 3
  [64.2, 66.8, 69.7, 72.6, 75.1], // College Yr 4
];

/** 10 Yard Dash -- ages 8-18, then College Yr 1-4. */
const SPRINT_10: Pcts[] = [
  [2.59, 2.47, 2.34, 2.21, 2.16], // 8
  [2.48, 2.37, 2.24, 2.11, 2.07], // 9
  [2.38, 2.27, 2.15, 2.03, 1.98], // 10
  [2.28, 2.18, 2.06, 1.94, 1.9], // 11
  [2.17, 2.07, 1.96, 1.85, 1.81], // 12
  [2.07, 1.97, 1.87, 1.77, 1.72], // 13
  [1.98, 1.89, 1.79, 1.69, 1.65], // 14
  [1.95, 1.86, 1.76, 1.66, 1.62], // 15
  [1.91, 1.83, 1.73, 1.63, 1.6], // 16
  [1.88, 1.8, 1.7, 1.6, 1.57], // 17
  [1.86, 1.77, 1.68, 1.59, 1.55], // 18
  [1.85, 1.76, 1.67, 1.58, 1.54], // College Yr 1
  [1.83, 1.74, 1.65, 1.56, 1.52], // College Yr 2
  [1.82, 1.73, 1.64, 1.55, 1.51], // College Yr 3
  [1.8, 1.71, 1.62, 1.53, 1.49], // College Yr 4
];

/** Exchange Time -- ages 13-18, then College Yr 1-4. */
const EXCHANGE_TIME: Pcts[] = [
  [0.95, 0.89, 0.83, 0.77, 0.75], // 13
  [0.92, 0.86, 0.8, 0.74, 0.72], // 14
  [0.89, 0.84, 0.78, 0.73, 0.71], // 15
  [0.88, 0.83, 0.77, 0.73, 0.71], // 16
  [0.87, 0.82, 0.76, 0.73, 0.71], // 17
  [0.86, 0.81, 0.75, 0.73, 0.71], // 18
  [0.84, 0.79, 0.74, 0.71, 0.69], // College Yr 1
  [0.82, 0.78, 0.73, 0.7, 0.68], // College Yr 2
  [0.8, 0.76, 0.71, 0.69, 0.67], // College Yr 3
  [0.79, 0.74, 0.7, 0.67, 0.65], // College Yr 4
];

interface Spec {
  table: Pcts[];
  /** Age of the table's first row (rows run to Age 18, then College Yr 1-4). */
  firstAge: number;
  /** Multiplier for metrics graded off a related table (see below). */
  scale: number;
  /** Times: smaller is better, P90 is the fastest. */
  lowerBetter: boolean;
}
const spec = (table: Pcts[], o: Partial<Spec> = {}): Spec => ({ table, firstAge: 8, scale: 1, lowerBetter: false, ...o });

/* Scaled estimates for metrics without their own table:
     avg exit velo ≈ 86% of max (typical HitTrax session ratio)
     max bat speed ≈ 107% of a session's average (Blast)
     avg fastball  ≈ 95% of max */
const METRIC_TABLES: Record<string, Spec> = {
  max_exit_velo: spec(EXIT_VELO_MAX),
  avg_exit_velo: spec(EXIT_VELO_MAX, { scale: 0.86 }),
  avg_bat_speed: spec(BAT_SPEED_AVG),
  bat_speed: spec(BAT_SPEED_AVG),
  max_bat_speed: spec(BAT_SPEED_AVG, { scale: 1.07 }),
  fb_max_velo: spec(PITCH_VELO_MAX),
  fb_avg_velo: spec(PITCH_VELO_MAX, { scale: 0.95 }),
  infield_velo: spec(INFIELD_VELO),
  outfield_velo: spec(OUTFIELD_VELO),
  catcher_velo: spec(CATCHER_VELO),
  pop_time: spec(POP_TIME, { firstAge: 13, lowerBetter: true }),
  exchange_time: spec(EXCHANGE_TIME, { firstAge: 13, lowerBetter: true }),
  sprint_60: spec(SPRINT_60, { lowerBetter: true }),
  sixty_yard: spec(SPRINT_60, { lowerBetter: true }),
  sprint_10: spec(SPRINT_10, { lowerBetter: true }),
};

export const AGE_NORMED_METRICS = new Set(Object.keys(METRIC_TABLES));

const YEAR_MS = 365.2425 * 86400000;
/** Age a senior is assumed to be on graduation day (used when there's no birthday). */
const GRAD_AGE = 18.4;
const COLLEGE_YEARS = 4;

let gradingBirthDate: string | null = null;
let gradingGradYear: number | null = null;

/** Point grading at the athlete whose data is on screen (nulls = none). */
export function setGradingAthlete(birthDate: string | null | undefined, gradYear?: number | null): void {
  gradingBirthDate = birthDate || null;
  gradingGradYear = gradYear && Number.isFinite(gradYear) ? gradYear : null;
}

function dateOf(at?: string | null): Date {
  const d = at ? new Date(at) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Age in fractional years on `at` (ISO string; blank/invalid = today). */
export function ageOn(birthDate: string, at?: string | null): number | null {
  const b = new Date(birthDate.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const years = (dateOf(at).getTime() - b.getTime()) / YEAR_MS;
  return years > 0 ? years : null;
}

/** Where the athlete sits on the age / college-year scale on `at`:
 *  `step` = 0 at the Age-18 row, negative for younger ages, 1-4 for
 *  College Yr 1-4 (fractions blend neighbouring rows). Null when there's
 *  neither a birthday nor a grad year. */
function gradingStep(at?: string | null): { step: number; age: number | null; collegeYear: number | null } | null {
  const age = gradingBirthDate ? ageOn(gradingBirthDate, at) : null;
  if (gradingGradYear) {
    const grad = new Date(gradingGradYear, 5, 1); // June 1 of the grad year
    const yearsOut = (dateOf(at).getTime() - grad.getTime()) / YEAR_MS;
    if (yearsOut >= 0) {
      /* Graduated: College Yr N stands for the end of the Nth year out. */
      const step = Math.min(yearsOut, COLLEGE_YEARS);
      return { step, age, collegeYear: Math.min(COLLEGE_YEARS, Math.max(1, Math.ceil(yearsOut))) };
    }
    /* Still in high school: grade by age, but never past the Age-18 row. */
    const a = age ?? GRAD_AGE + yearsOut;
    return { step: Math.min(a - 18.5, 0), age: a, collegeYear: null };
  }
  if (age === null) return null;
  /* Age only: row N stands for age N.5; past 18.5 it walks into the
     college rows a year at a time. */
  const step = Math.min(age - 18.5, COLLEGE_YEARS);
  return { step, age, collegeYear: step > 0 ? Math.min(COLLEGE_YEARS, Math.max(1, Math.ceil(step))) : null };
}

/** The scaled percentile row for this metric + athlete, or null when the
 *  metric isn't age-normed, nothing places the athlete, or they're too
 *  young for the table (pop / exchange under 13). */
export function normRow(metricType: string, at?: string | null):
  { row: Pcts; age: number | null; collegeYear: number | null; lowerBetter: boolean } | null {
  const s = METRIC_TABLES[metricType];
  if (!s) return null;
  const g = gradingStep(at);
  if (!g) return null;
  if (s.firstAge > 8 && g.collegeYear === null && g.age !== null && g.age < s.firstAge - 0.5) return null;
  const idx18 = 18 - s.firstAge;
  const pos = Math.min(Math.max(idx18 + g.step, 0), s.table.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.table.length - 1);
  const t = pos - lo;
  const row = s.table[lo].map((v, i) => (v + (s.table[hi][i] - v) * t) * s.scale) as Pcts;
  return { row, age: g.age, collegeYear: g.collegeYear, lowerBetter: s.lowerBetter };
}

/* Piecewise-linear interpolation through ascending (x, y) knots, extending
   the end segments' slopes past either end. */
function through(x: number, xs: number[], ys: number[]): number {
  const n = xs.length;
  let i = 0;
  if (x >= xs[n - 1]) i = n - 2;
  else while (i < n - 2 && x > xs[i + 1]) i++;
  const span = xs[i + 1] - xs[i] || 1;
  return ys[i] + ((x - xs[i]) / span) * (ys[i + 1] - ys[i]);
}

/** Interpolate `ys` (given per percentile P10..P90) at `value`. Time rows
 *  run high → low, so they're flipped to keep the knots ascending. */
function atValue(value: number, n: { row: Pcts; lowerBetter: boolean }, ys: number[]): number {
  return n.lowerBetter
    ? through(value, [...n.row].reverse(), [...ys].reverse())
    : through(value, n.row, ys);
}

/** 20-80 grade against the athlete's age / college-year group:
 *  P10 → 30, P25 → 40, P50 → 50, P75 → 60, P90 → 70 (floored, so a value
 *  just short of P25 stays red and just short of P75 stays yellow). */
export function ageNormGrade(value: number, metricType: string, at?: string | null): number | null {
  if (!Number.isFinite(value)) return null;
  const n = normRow(metricType, at);
  if (!n) return null;
  const g = atValue(value, n, [30, 40, 50, 60, 70]);
  return Math.max(20, Math.min(80, Math.floor(g + 1e-9)));
}

/** Estimated percentile (1-99) for the athlete's group, or null. */
export function agePercentile(value: number, metricType: string, at?: string | null): number | null {
  if (!Number.isFinite(value)) return null;
  const n = normRow(metricType, at);
  if (!n) return null;
  return Math.max(1, Math.min(99, Math.round(atValue(value, n, [10, 25, 50, 75, 90]))));
}

/** True when the value is at or better than the 90th percentile for the group. */
export function isTopTenPct(value: number, metricType: string, at?: string | null): boolean {
  const n = normRow(metricType, at);
  if (!n || !Number.isFinite(value)) return false;
  return n.lowerBetter ? value <= n.row[4] : value >= n.row[4];
}

const COLLEGE_GROUP = ['', 'college freshmen', 'college sophomores', 'college juniors', 'college seniors'];

/** Hover text like "82nd percentile for age 15" / "... for college juniors". */
export function percentileLabel(value: number, metricType: string, at?: string | null): string | undefined {
  const p = agePercentile(value, metricType, at);
  const n = normRow(metricType, at);
  if (p === null || !n) return undefined;
  const sfx = p % 100 >= 11 && p % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[p % 10] ?? 'th';
  const group = n.collegeYear ? COLLEGE_GROUP[n.collegeYear] : n.age !== null ? `age ${Math.min(18, Math.floor(n.age))}` : 'their age';
  return `${p}${sfx} percentile for ${group}`;
}

/** Badge wording for an age-normed value: Top 10% (P90+), Above Avg
 *  (P75+), Average (P25-P75), Developing (below P25). */
export function ageBadgeText(grade: number, top10: boolean): string {
  if (top10) return 'Top 10%';
  return grade >= 60 ? 'Above Avg' : grade >= 40 ? 'Average' : 'Developing';
}

/** Grade + Top-10% flag + hover text in one call, for UI cells. Null when
 *  the metric isn't age-normed for this athlete. */
export function ageNormInfo(value: number | null | undefined, metricType: string, at?: string | null):
  { grade: number; top10: boolean; title: string | undefined } | null {
  if (value == null) return null;
  const grade = ageNormGrade(value, metricType, at);
  if (grade === null) return null;
  return { grade, top10: isTopTenPct(value, metricType, at), title: percentileLabel(value, metricType, at) };
}
