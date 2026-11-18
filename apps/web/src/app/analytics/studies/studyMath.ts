/* ─────────────────────────────────────────────────────────────────────────
   Studies maths: turning each athlete's raw points into one number, and the
   statistics each study shows. Pure functions.

   Plain-English rules the page explains:
     - correlation r (-1..1) with a strength word, R² ("explains x%") and
       a p-value from Fisher's z (good enough for a coach's read);
     - effect size d (gap between groups / before-after in spreads):
       0.2 small, 0.5 medium, 0.8 large;
     - fewer than 10 athletes = too few to trust; 10-29 = a hint.
   ───────────────────────────────────────────────────────────────────────── */

export type Summary = 'latest' | 'best' | 'average' | 'first';
export type Better = 'high' | 'low' | null;
/** [athlete index, "YYYY-MM-DD", value] — what the API sends. */
export type RawPoint = [number, string, number];
export interface DateRange { from?: string | null; to?: string | null }

export const SUMMARY_LABEL: Record<Summary, string> = {
  latest: 'Latest',
  best: 'Best',
  average: 'Average',
  first: 'First',
};

export const inRange = (day: string, r?: DateRange | null) =>
  (!r?.from || day >= r.from) && (!r?.to || day <= r.to);

/** One athlete's points (sorted by day) -> one number. */
export function summarize(points: { day: string; value: number }[], summary: Summary, better: Better): number | null {
  if (!points.length) return null;
  if (summary === 'latest') return points[points.length - 1].value;
  if (summary === 'first') return points[0].value;
  if (summary === 'average') return mean(points.map((p) => p.value));
  const vals = points.map((p) => p.value);
  return better === 'low' ? Math.min(...vals) : Math.max(...vals);
}

/** A measure's points -> athlete index -> summarised value, within a date range. */
export function perAthlete(series: RawPoint[] | undefined, summary: Summary, better: Better, range?: DateRange | null, only?: Set<number> | null): Map<number, number> {
  const by = new Map<number, { day: string; value: number }[]>();
  for (const [i, day, value] of series ?? []) {
    if (only && !only.has(i)) continue;
    if (!inRange(day, range)) continue;
    (by.get(i) ?? by.set(i, []).get(i)!).push({ day, value });
  }
  const out = new Map<number, number>();
  for (const [i, pts] of by) {
    pts.sort((a, b) => a.day.localeCompare(b.day));
    const v = summarize(pts, summary, better);
    if (v != null && Number.isFinite(v)) out.set(i, v);
  }
  return out;
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

export function sd(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Standard normal CDF (Abramowitz-Stegun erf). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export interface Fit { n: number; r: number; r2: number; slope: number; intercept: number; p: number }

/** Pearson correlation + least-squares line. Null below 3 pairs or with no spread. */
export function fit(xs: number[], ys: number[]): Fit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const slope = sxy / sxx;
  /* Fisher z -> two-sided p. */
  const p = n > 3 && Math.abs(r) < 1 ? 2 * (1 - normCdf(Math.abs(Math.atanh(r)) * Math.sqrt(n - 3))) : Math.abs(r) === 1 ? 0 : 1;
  return { n, r, r2: r * r, slope, intercept: my - slope * mx, p };
}

export function strengthWord(r: number): string {
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  if (a < 0.1) return 'No real relationship';
  if (a < 0.3) return `Weak ${dir} relationship`;
  if (a < 0.5) return `Moderate ${dir} relationship`;
  if (a < 0.7) return `Strong ${dir} relationship`;
  return `Very strong ${dir} relationship`;
}

export function effectWord(d: number): string {
  const a = Math.abs(d);
  if (!Number.isFinite(a)) return '';
  if (a < 0.2) return 'negligible';
  if (a < 0.5) return 'small';
  if (a < 0.8) return 'medium';
  return 'large';
}

/** How much to trust a result with n athletes. */
export function sampleNote(n: number): { level: 'low' | 'hint' | 'ok'; text: string } {
  if (n < 10) return { level: 'low', text: `Only ${n} athlete${n === 1 ? '' : 's'} — too few to trust. Treat this as a first look.` };
  if (n < 30) return { level: 'hint', text: `${n} athletes — treat this as a hint, not proof.` };
  return { level: 'ok', text: `${n} athletes.` };
}

export const pText = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
export const significant = (p: number) => p < 0.05;

/** Cohen's d between two groups (pooled spread). */
export function cohensD(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return NaN;
  const pooled = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / (a.length + b.length - 2));
  return pooled ? (mean(a) - mean(b)) / pooled : NaN;
}

export interface PairedResult {
  n: number;
  meanBefore: number;
  meanAfter: number;
  meanChange: number;
  pctChange: number;
  improved: number;
  /** Effect size of the change (mean change / spread of changes). */
  dz: number;
  p: number;
}

/** Before/after for the same athletes. "Improved" follows the measure's better direction (higher when none). */
export function paired(before: number[], after: number[], better: Better): PairedResult | null {
  const n = Math.min(before.length, after.length);
  if (!n) return null;
  const diffs = after.slice(0, n).map((v, i) => v - before[i]);
  const md = mean(diffs);
  const s = sd(diffs);
  const dz = s ? md / s : NaN;
  /* Paired t ~ normal for a rough p (n >= 3). */
  const t = s && n >= 3 ? md / (s / Math.sqrt(n)) : NaN;
  const mb = mean(before.slice(0, n));
  return {
    n,
    meanBefore: mb,
    meanAfter: mean(after.slice(0, n)),
    meanChange: md,
    pctChange: mb ? (md / Math.abs(mb)) * 100 : NaN,
    improved: diffs.filter((d) => (better === 'low' ? d < 0 : d > 0)).length,
    dz,
    p: Number.isFinite(t) ? 2 * (1 - normCdf(Math.abs(t))) : 1,
  };
}

/** Where a value sits in a group: % of the group it's better than (ties count half). */
export function percentile(value: number, group: number[], better: Better): number {
  if (!group.length) return NaN;
  let below = 0, same = 0;
  for (const g of group) {
    if (g === value) same += 1;
    else if (better === 'low' ? g > value : g < value) below += 1;
  }
  return ((below + same / 2) / group.length) * 100;
}

/** "2026-03" for a day. */
export const monthOf = (day: string) => day.slice(0, 7);

export interface TrendPoint { month: string; mean: number; sd: number; n: number }

/** Group trend: each athlete's average per month, then the group's mean ± spread per month. */
export function monthlyTrend(series: RawPoint[] | undefined, members: Set<number>, range?: DateRange | null): TrendPoint[] {
  const perAthleteMonth = new Map<string, Map<number, number[]>>();
  for (const [i, day, value] of series ?? []) {
    if (!members.has(i) || !inRange(day, range)) continue;
    const m = monthOf(day);
    const byA = perAthleteMonth.get(m) ?? perAthleteMonth.set(m, new Map()).get(m)!;
    (byA.get(i) ?? byA.set(i, []).get(i)!).push(value);
  }
  return [...perAthleteMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, byA]) => {
      const vals = [...byA.values()].map(mean);
      return { month, mean: mean(vals), sd: vals.length > 1 ? sd(vals) : 0, n: vals.length };
    });
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function signed(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
}

/** Rows -> CSV text (quotes where needed). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = c == null ? '' : typeof c === 'number' ? (Number.isFinite(c) ? String(Math.round(c * 1e4) / 1e4) : '') : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
