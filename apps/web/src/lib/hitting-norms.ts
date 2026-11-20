/* ─────────────────────────────────────────────────────────────────────
   Age-normalized hitting baselines (exit velo + bat speed).

   Each row is the P10 / P25 / P50 / P75 / P90 for that age, in mph. The
   numbers mirror "Benchmark Data Sets/*.csv" (see SOURCES.md there):
   mostly MODELED from published benchmarks (Eisenmann TrackMan BP
   percentiles 14-18, Driveline aging-curve slopes, BatDigest / Blast
   ranges), so treat them as a starting point, not measured norms.

   Colours (via toScoutingGrade → scoreColor):
     below P25 → red (grade < 40) · P25-P75 → yellow · P75+ → green (≥ 60)
   and P90+ is flagged "Top 10%" for the athlete's age.

   Grading needs the athlete's birthday. usePlayerProfileData sets it
   (setGradingAthlete) while it renders, so every tab / PDF beneath the
   profile grades against the right age without threading a prop through
   dozens of call sites. No birthday → the old fixed GRADE_RANGES apply.
   ───────────────────────────────────────────────────────────────────── */

/** [P10, P25, P50, P75, P90] in mph. */
type Pcts = [number, number, number, number, number];

/** Max exit velocity (BP / front toss / tee), ages 8-18, then College. */
const EXIT_VELO_MAX: Pcts[] = [
  [34.8, 38.4, 42.0, 45.6, 49.2], // 8
  [38.2, 42.1, 46.0, 49.9, 53.8], // 9
  [41.4, 45.7, 50.0, 54.3, 58.6], // 10
  [45.6, 50.3, 55.0, 59.7, 64.4], // 11
  [49.8, 54.9, 60.0, 65.1, 70.2], // 12
  [53.8, 59.4, 65.0, 70.6, 76.2], // 13
  [58.0, 64.0, 70.0, 76.0, 82.0], // 14
  [65.0, 71.0, 77.0, 83.0, 89.0], // 15
  [70.0, 76.0, 82.0, 88.0, 94.0], // 16
  [73.5, 80.0, 86.5, 93.0, 99.5], // 17
  [76.0, 83.0, 90.0, 97.0, 104.0], // 18
  [83.0, 88.5, 94.0, 99.5, 105.0], // College (19+)
];

/** Blast Motion average bat speed, ages 8-18, then College. */
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
  [61.0, 63.8, 67.0, 70.2, 73.0], // College (19+)
];

const FIRST_AGE = 8;

/* Which table grades which metric. The tables are built on MAX exit velo
   and AVERAGE bat speed, so the other two are scaled estimates:
     avg exit velo ≈ 86% of max (typical HitTrax session ratio)
     max bat speed ≈ 107% of a session's average (Blast) */
const METRIC_TABLES: Record<string, { table: Pcts[]; scale: number }> = {
  max_exit_velo: { table: EXIT_VELO_MAX, scale: 1 },
  avg_exit_velo: { table: EXIT_VELO_MAX, scale: 0.86 },
  avg_bat_speed: { table: BAT_SPEED_AVG, scale: 1 },
  bat_speed: { table: BAT_SPEED_AVG, scale: 1 },
  max_bat_speed: { table: BAT_SPEED_AVG, scale: 1.07 },
};

export const AGE_NORMED_METRICS = new Set(Object.keys(METRIC_TABLES));

let gradingBirthDate: string | null = null;

/** Point grading at the athlete whose data is on screen (null = none). */
export function setGradingAthlete(birthDate: string | null | undefined): void {
  gradingBirthDate = birthDate || null;
}

/** Age in fractional years on `at` (ISO string; blank/invalid = today). */
export function ageOn(birthDate: string, at?: string | null): number | null {
  const b = new Date(birthDate.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const d = at ? new Date(at) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const years = (when.getTime() - b.getTime()) / (365.2425 * 86400000);
  return years > 0 ? years : null;
}

/** Percentile row for an age. Row N stands for age N.5 (mid-year), and
 *  ages in between blend the two rows so a 14.9-year-old isn't graded as a
 *  14.0. Under 8 uses age 8; 19+ uses College. */
function rowForAge(table: Pcts[], age: number): Pcts {
  const pos = Math.min(Math.max(age - 0.5 - FIRST_AGE, 0), table.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, table.length - 1);
  const t = pos - lo;
  return table[lo].map((v, i) => v + (table[hi][i] - v) * t) as Pcts;
}

/** The scaled percentile row for this metric + athlete, or null when the
 *  metric isn't age-normed or the athlete has no birthday. */
export function normRow(metricType: string, at?: string | null): { row: Pcts; age: number } | null {
  const spec = METRIC_TABLES[metricType];
  if (!spec || !gradingBirthDate) return null;
  const age = ageOn(gradingBirthDate, at);
  if (age === null) return null;
  const row = rowForAge(spec.table, age).map((v) => v * spec.scale) as Pcts;
  return { row, age };
}

/* Piecewise-linear interpolation through (x, y) knots, extending the end
   segments' slopes past either end. */
function through(x: number, xs: number[], ys: number[]): number {
  const n = xs.length;
  let i = 0;
  if (x >= xs[n - 1]) i = n - 2;
  else while (i < n - 2 && x > xs[i + 1]) i++;
  const span = xs[i + 1] - xs[i] || 1;
  return ys[i] + ((x - xs[i]) / span) * (ys[i + 1] - ys[i]);
}

/** 20-80 grade against the athlete's age group:
 *  P10 → 30, P25 → 40, P50 → 50, P75 → 60, P90 → 70 (floored, so a value
 *  just under P25 stays red and just under P75 stays yellow). */
export function ageNormGrade(value: number, metricType: string, at?: string | null): number | null {
  if (!Number.isFinite(value)) return null;
  const n = normRow(metricType, at);
  if (!n) return null;
  const g = through(value, n.row, [30, 40, 50, 60, 70]);
  return Math.max(20, Math.min(80, Math.floor(g + 1e-9)));
}

/** Estimated percentile (1-99) for the athlete's age, or null. */
export function agePercentile(value: number, metricType: string, at?: string | null): number | null {
  if (!Number.isFinite(value)) return null;
  const n = normRow(metricType, at);
  if (!n) return null;
  const p = through(value, n.row, [10, 25, 50, 75, 90]);
  return Math.max(1, Math.min(99, Math.round(p)));
}

/** True when the value is at or above the 90th percentile for the age. */
export function isTopTenPct(value: number, metricType: string, at?: string | null): boolean {
  const n = normRow(metricType, at);
  return !!n && Number.isFinite(value) && value >= n.row[4];
}

/** Hover text like "82nd percentile for age 15". */
export function percentileLabel(value: number, metricType: string, at?: string | null): string | undefined {
  const p = agePercentile(value, metricType, at);
  const n = normRow(metricType, at);
  if (p === null || !n) return undefined;
  const sfx = p % 100 >= 11 && p % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[p % 10] ?? 'th';
  const group = n.age >= 19 ? 'college' : `age ${Math.floor(n.age)}`;
  return `${p}${sfx} percentile for ${group}`;
}
