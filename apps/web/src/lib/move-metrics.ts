/* MOVE Catching Sensor -- the receiving metrics it reports, in display order.
   Shared by the Catching report form (typed entry), the Catching tab's
   Receiving Metrics bubble, and (later) the MOVE API mapping, so a metric is
   named, unit-ed and rounded the same everywhere.

   `better` records which direction is good ('high' / 'low'); null = not
   decided yet. Nothing is colour-coded off it yet -- it's kept here so the
   best/avg rule and colours can switch on later without touching each use. */

export type MoveMetricKind = 'number' | 'clock';

export interface MoveMetricDef {
  key: string;
  label: string;
  /** Unit shown after the value ('' for clock positions). */
  unit: string;
  better: 'high' | 'low' | null;
  kind: MoveMetricKind;
  /** Decimal places shown for number metrics. */
  digits: number;
  /** The MOVE API's per-catch metric key that feeds this metric. */
  moveKey?: string;
}

export const MOVE_RECEIVING_METRICS: MoveMetricDef[] = [
  { key: 'gloveSpeed',             label: 'Glove Speed',                  unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'gloveSpeedMph' },
  { key: 'pocketSpeed',            label: 'Pocket Speed',                 unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'gloveSpeedThruPocketMph' },
  { key: 'peakVerticalGloveSpeed', label: 'Peak Vertical Glove Speed',    unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'peakVertMph' },
  { key: 'timeToStick',            label: 'Time to Stick',                unit: 's',   better: 'low',  kind: 'number', digits: 2, moveKey: 'timeToStickSec' },
  { key: 'holdTime',               label: 'Hold Time',                    unit: 's',   better: null,   kind: 'number', digits: 2, moveKey: 'holdTimeSec' },
  { key: 'stickDistance',          label: 'Stick Distance',               unit: 'in',  better: null,   kind: 'number', digits: 1, moveKey: 'stickDistanceIn' },
  { key: 'approachDistance',       label: 'Approach Distance',            unit: 'in',  better: null,   kind: 'number', digits: 1, moveKey: 'approachDistanceIn' },
  { key: 'approachAngle',          label: 'Approach Angle',               unit: '°',   better: null,   kind: 'number', digits: 1, moveKey: 'approachAngleDeg' },
  { key: 'catchToStickAngle',      label: 'Catch to Stick Angle',         unit: '°',   better: null,   kind: 'number', digits: 1, moveKey: 'catchToStickAngleDeg' },
  /* redirectAngleDeg = the turn between the approach and the stick -- read
     as "Approach to Stick Difference" (to confirm with MOVE). */
  { key: 'approachToStickDiff',    label: 'Approach to Stick Difference', unit: '°',   better: 'low',  kind: 'number', digits: 1, moveKey: 'redirectAngleDeg' },
  { key: 'peakAccel',              label: 'Peak Accel',                   unit: 'g',   better: 'high', kind: 'number', digits: 1, moveKey: 'peakAccelG' },
  { key: 'peakDecel',              label: 'Peak Decel',                   unit: 'g',   better: 'high', kind: 'number', digits: 1, moveKey: 'peakDecelG' },
  /* MOVE sends these as clock degrees (0 = 12 o'clock, 90 = 3). */
  { key: 'catchPosition',          label: 'Catch Position',               unit: '',    better: null,   kind: 'clock',  digits: 0, moveKey: 'catchPositionDeg' },
  { key: 'stickPosition',          label: 'Stick Position',               unit: '',    better: null,   kind: 'clock',  digits: 0, moveKey: 'stickPositionDeg' },
];

/** Saved on the report: number metrics as numbers, clock positions as
 *  "H:MM" strings; null when blank. */
export type ReceivingMetricValues = Record<string, number | string | null>;

/** "2", "2:30", "2.5", "02:30", "2:30 o'clock" -> "2:30" ("12:00" for 0/12).
 *  Returns null for anything that isn't a clock position. */
export function normalizeClock(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/o'?clock/, '').trim();
  if (!s) return null;
  let h: number;
  let m: number;
  const hm = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (hm) {
    h = Number(hm[1]);
    m = hm[2] != null ? Number(hm[2]) : 0;
  } else if (/^\d{1,2}\.\d+$/.test(s)) {
    const f = Number(s);
    h = Math.floor(f);
    m = Math.round((f - h) * 60);
  } else {
    return null;
  }
  if (m === 60) { h += 1; m = 0; }
  if (h === 0) h = 12;
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Clock position -> angle in degrees clockwise from 12 o'clock. */
export function clockAngle(clock: string): number | null {
  const n = normalizeClock(clock);
  if (!n) return null;
  const [h, m] = n.split(':').map(Number);
  return ((h % 12) + m / 60) * 30;
}

/** Typed form text -> saved values (blank / unreadable entries -> null). */
export function parseReceivingMetrics(typed: Record<string, string> | null | undefined): ReceivingMetricValues {
  const out: ReceivingMetricValues = {};
  for (const def of MOVE_RECEIVING_METRICS) {
    const raw = (typed?.[def.key] ?? '').trim();
    if (!raw) { out[def.key] = null; continue; }
    if (def.kind === 'clock') {
      out[def.key] = normalizeClock(raw);
    } else {
      const n = Number(raw);
      out[def.key] = Number.isFinite(n) ? n : null;
    }
  }
  return out;
}

/** A saved value formatted for display, or null when there isn't one. */
export function formatReceivingMetric(def: MoveMetricDef, v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null;
  if (def.kind === 'clock') return normalizeClock(v);
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(def.digits) : null;
}

/* ── MOVE sessions saved on a report (content.moveReceiving) ── */

export interface MoveFileRef { url: string; contentType: string | null; bytes: number | null; expiresAt: string | null }
export interface MoveCatchRef {
  catchId: string;
  number: number | null;
  withdrawn: boolean;
  reach: boolean;
  contactAt: string | null;
  metrics: Record<string, number>;
  video: MoveFileRef | null;
  /** MOVE's 3D glove path file; our server keeps a copy (MovePath). */
  path3d?: MoveFileRef | null;
}
export interface MoveSessionRef {
  baseSessionId: string;
  revision: number;
  firstCatchAt: string;
  catchCount: number;
  catches: MoveCatchRef[];
}
export interface MoveReceiving { version: 1; sessions: MoveSessionRef[] }

/** Best (by the metric's direction) + average over the counted catches.
 *  Clock positions carry the averaged position as "H:MM" instead. */
export interface MoveMetricSummary { best: number | null; avg: number; n: number; clock?: string }

/** One catch, for the 3D Glove Path pane's picker. */
export interface MoveClip {
  label: string;
  catchId: string;
  /** A 3D path was sent for this catch (drawn from our stored copy). */
  hasPath: boolean;
  video: MoveFileRef | null;
  metrics: Record<string, number>;
}

export interface MoveSummary {
  metrics: Record<string, MoveMetricSummary>;
  /** Catches counted (not withdrawn), across every session on the report. */
  catches: number;
  sessions: number;
  /** Counted catches in session/catch order, for the 3D Glove Path pane. */
  clips: MoveClip[];
}

/** MOVE clock angle (degrees, 0 = 12 o'clock, 90 = 3) -> "H:MM". */
export function degToClock(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  let h = Math.floor(d / 30);
  let m = Math.round((d / 30 - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  h %= 12;
  return `${h === 0 ? 12 : h}:${String(m).padStart(2, '0')}`;
}

/** Average of compass-style angles (so 350 and 10 average to 0, not 180). */
function circularMeanDeg(vals: number[]): number {
  const r = (v: number) => (v * Math.PI) / 180;
  const s = vals.reduce((a, v) => a + Math.sin(r(v)), 0);
  const c = vals.reduce((a, v) => a + Math.cos(r(v)), 0);
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

/** Summarise a report's MOVE sessions, or null when it has none. */
export function summarizeMove(raw: unknown): MoveSummary | null {
  const sessions: MoveSessionRef[] =
    raw && typeof raw === 'object' && Array.isArray((raw as any).sessions) ? (raw as any).sessions : [];
  if (!sessions.length) return null;
  const counted = sessions.flatMap((s) => (Array.isArray(s.catches) ? s.catches : []).filter((c) => c && !c.withdrawn));
  const metrics: Record<string, MoveMetricSummary> = {};
  for (const def of MOVE_RECEIVING_METRICS) {
    if (!def.moveKey) continue;
    const vals = counted.map((c) => c.metrics?.[def.moveKey!]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) continue;
    if (def.kind === 'clock') {
      const mean = circularMeanDeg(vals);
      metrics[def.key] = { best: null, avg: mean, n: vals.length, clock: degToClock(mean) };
      continue;
    }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const best = def.better === 'high' ? Math.max(...vals) : def.better === 'low' ? Math.min(...vals) : null;
    metrics[def.key] = { best, avg, n: vals.length };
  }
  const clips: MoveClip[] = [];
  sessions.forEach((s, si) => {
    (s.catches || []).forEach((c, ci) => {
      if (!c || c.withdrawn) return;
      const hasPath = !!c.path3d?.url;
      if (!hasPath && !c.video?.url) return;
      const n = c.number ?? ci + 1;
      clips.push({
        label: sessions.length > 1 ? `S${si + 1} · Catch ${n}` : `Catch ${n}`,
        catchId: c.catchId,
        hasPath,
        video: c.video?.url ? c.video : null,
        metrics: c.metrics || {},
      });
    });
  });
  return { metrics, catches: counted.length, sessions: sessions.length, clips };
}

/**
 * What a Receiving Metrics cell shows. With MOVE data: best + average (the
 * best is the better of MOVE's best and a typed value -- the HitTrax rule);
 * direction-less metrics show the average only; clock positions show the
 * average position. Without MOVE data: the typed value.
 */
export function receivingCell(def: MoveMetricDef, typed: number | string | null | undefined, move: MoveMetricSummary | undefined):
  { best: number | null; avg: number | null; single: string | null } {
  if (!move) return { best: null, avg: null, single: formatReceivingMetric(def, typed) };
  if (def.kind === 'clock') return { best: null, avg: null, single: move.clock ?? null };
  let best = move.best;
  const t = typeof typed === 'number' ? typed : null;
  if (best != null && t != null) best = def.better === 'low' ? Math.min(best, t) : Math.max(best, t);
  return { best, avg: move.avg, single: null };
}
