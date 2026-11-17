/* ─────────────────────────────────────────────────────────────────────────
   Lifting Dashboard maths -- shared by the athlete dashboard and the coach
   Lifting page. A box (KPI) shows the latest session's BEST (the stored
   value) and that session's AVERAGE (stored as "<key>__avg" -- VALD
   sessions have several trials / reps; a typed result has none), plus the
   change since the session before it. A ratio box (ER:IR) divides the
   latest of two metrics. Stored values are multiplied by the box's factor
   for display (1 for VALD results: they keep VALD's own unit).
   ───────────────────────────────────────────────────────────────────────── */
import type { LiftingBubble, LiftingKpi } from './api';

/** One result, as both the athlete and team endpoints return it. */
export interface LiftingResult { testType: string; recordedAt: string; metrics: Record<string, number> }

export interface KpiView {
  kpi: LiftingKpi;
  /** Display units (factor applied). */
  latest: number | null;
  /** The latest session's average (null for typed results / ratios). */
  average: number | null;
  previous: number | null;
  best: number | null;
  /** latest - previous, display units. */
  change: number | null;
  /** The change is in the good direction (null = no direction / no change). */
  improved: boolean | null;
}

export interface BubbleView {
  bubble: LiftingBubble;
  /** Date of the bubble's newest result (ISO), null when none. */
  latestAt: string | null;
  kpis: KpiView[];
  hasData: boolean;
}

/** Results grouped by test code, newest first. */
export function byTest(results: LiftingResult[]): Map<string, LiftingResult[]> {
  const m = new Map<string, LiftingResult[]>();
  for (const r of results) {
    const list = m.get(r.testType) ?? [];
    list.push(r);
    m.set(r.testType, list);
  }
  for (const list of m.values()) list.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return m;
}

/** Suffix the API stores each metric's session average under. */
export const AVG_SUFFIX = '__avg';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The values of one metric across a test's results, newest first. */
function series(tests: Map<string, LiftingResult[]>, test: string, metric: string): number[] {
  return (tests.get(test) ?? []).map((r) => num(r.metrics?.[metric])).filter((v): v is number => v != null);
}

export function kpiView(kpi: LiftingKpi, test: string, tests: Map<string, LiftingResult[]>): KpiView {
  const f = kpi.factor || 1;
  let latest: number | null = null;
  let average: number | null = null;
  let previous: number | null = null;
  let best: number | null = null;
  if (kpi.ratio) {
    const a = series(tests, kpi.ratio.num.test, kpi.ratio.num.metric);
    const b = series(tests, kpi.ratio.den.test, kpi.ratio.den.metric);
    if (a.length && b.length && b[0] !== 0) latest = (a[0] / b[0]) * f;
    if (a.length > 1 && b.length > 1 && b[1] !== 0) previous = (a[1] / b[1]) * f;
  } else if (kpi.metric) {
    const vals = series(tests, test, kpi.metric);
    if (vals.length) {
      latest = vals[0] * f;
      /* The average from the SAME session as the latest best. */
      const session = (tests.get(test) ?? []).find((r) => num(r.metrics?.[kpi.metric!]) != null);
      const avg = num(session?.metrics?.[kpi.metric + AVG_SUFFIX]);
      if (avg != null) average = avg * f;
      if (vals.length > 1) previous = vals[1] * f;
      if (kpi.better === 'high') best = Math.max(...vals) * f;
      else if (kpi.better === 'low') best = Math.min(...vals) * f;
    }
  }
  /* Asymmetries are signed (left / right): what matters is how far from 0,
     so their change is the change in size (smaller = better). */
  const asym = !!kpi.metric && /_ASYM$/.test(kpi.metric);
  const change = latest != null && previous != null
    ? (asym ? Math.abs(latest) - Math.abs(previous) : latest - previous)
    : null;
  const improved = change == null || change === 0 || !kpi.better ? null : (kpi.better === 'high') === change > 0;
  return { kpi, latest, average, previous, best, change, improved };
}

export function bubbleView(bubble: LiftingBubble, tests: Map<string, LiftingResult[]>): BubbleView {
  const kpis = bubble.kpis.map((k) => kpiView(k, bubble.test, tests));
  return {
    bubble,
    latestAt: tests.get(bubble.test)?.[0]?.recordedAt ?? null,
    kpis,
    hasData: kpis.some((k) => k.latest != null),
  };
}

export function fmt(v: number | null, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

export function fmtChange(v: number | null, digits: number): string {
  if (v == null || v === 0) return '';
  return `${v > 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(digits)}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Colour for a change: green better, red worse, muted when no direction. */
export function changeColor(improved: boolean | null): string {
  return improved == null ? 'var(--text-muted)' : improved ? '#16a34a' : '#dc2626';
}
