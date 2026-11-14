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
  /** The MOVE API's per-catch metric key that feeds this metric, if MOVE
   *  sends it yet (metricsVersion 1 sends six). */
  moveKey?: string;
}

export const MOVE_RECEIVING_METRICS: MoveMetricDef[] = [
  { key: 'gloveSpeed',             label: 'Glove Speed',                  unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'gloveSpeedMph' },
  { key: 'pocketSpeed',            label: 'Pocket Speed',                 unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'approachMph' },  // approachMph = Pocket Speed: UNCONFIRMED with MOVE
  { key: 'peakVerticalGloveSpeed', label: 'Peak Vertical Glove Speed',    unit: 'mph', better: 'high', kind: 'number', digits: 1, moveKey: 'peakVertMph' },
  { key: 'timeToStick',            label: 'Time to Stick',                unit: 's',   better: 'low',  kind: 'number', digits: 2, moveKey: 'timeToStickSec' },
  { key: 'holdTime',               label: 'Hold Time',                    unit: 's',   better: null,   kind: 'number', digits: 2 },
  { key: 'stickDistance',          label: 'Stick Distance',               unit: 'in',  better: null,   kind: 'number', digits: 1 },
  { key: 'approachDistance',       label: 'Approach Distance',            unit: 'in',  better: null,   kind: 'number', digits: 1 },
  { key: 'approachAngle',          label: 'Approach Angle',               unit: '°',   better: null,   kind: 'number', digits: 1 },
  { key: 'catchToStickAngle',      label: 'Catch to Stick Angle',         unit: '°',   better: null,   kind: 'number', digits: 1 },
  { key: 'approachToStickDiff',    label: 'Approach to Stick Difference', unit: '°',   better: 'low',  kind: 'number', digits: 1 },
  { key: 'peakAccel',              label: 'Peak Accel',                   unit: 'g',   better: 'high', kind: 'number', digits: 1, moveKey: 'peakAccelG' },
  { key: 'peakDecel',              label: 'Peak Decel',                   unit: 'g',   better: 'high', kind: 'number', digits: 1, moveKey: 'peakDecelG' },
  { key: 'catchPosition',          label: 'Catch Position',               unit: '',    better: null,   kind: 'clock',  digits: 0 },
  { key: 'stickPosition',          label: 'Stick Position',               unit: '',    better: null,   kind: 'clock',  digits: 0 },
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
}
export interface MoveSessionRef {
  baseSessionId: string;
  revision: number;
  firstCatchAt: string;
  catchCount: number;
  catches: MoveCatchRef[];
}
export interface MoveReceiving { version: 1; sessions: MoveSessionRef[] }

/** Best (by the metric's direction) + average over the counted catches. */
export interface MoveMetricSummary { best: number | null; avg: number; n: number }

export interface MoveSummary {
  metrics: Record<string, MoveMetricSummary>;
  /** Catches counted (not withdrawn), across every session on the report. */
  catches: number;
  sessions: number;
  /** Per-catch videos in session/catch order, for the 3D Glove Path pane. */
  videos: { label: string; url: string; expiresAt: string | null; contentType: string | null }[];
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
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const best = def.better === 'high' ? Math.max(...vals) : def.better === 'low' ? Math.min(...vals) : null;
    metrics[def.key] = { best, avg, n: vals.length };
  }
  const videos: MoveSummary['videos'] = [];
  sessions.forEach((s, si) => {
    (s.catches || []).forEach((c, ci) => {
      if (!c?.video?.url || c.withdrawn) return;
      const n = c.number ?? ci + 1;
      videos.push({
        label: sessions.length > 1 ? `S${si + 1} · Catch ${n}` : `Catch ${n}`,
        url: c.video.url,
        expiresAt: c.video.expiresAt,
        contentType: c.video.contentType,
      });
    });
  });
  return { metrics, catches: counted.length, sessions: sessions.length, videos };
}

/**
 * What a Receiving Metrics cell shows. With MOVE data: best + average (the
 * best is the better of MOVE's best and a typed value -- the HitTrax rule);
 * direction-less metrics show the average only. Without MOVE data: the
 * typed value.
 */
export function receivingCell(def: MoveMetricDef, typed: number | string | null | undefined, move: MoveMetricSummary | undefined):
  { best: number | null; avg: number | null; single: string | null } {
  if (!move) return { best: null, avg: null, single: formatReceivingMetric(def, typed) };
  let best = move.best;
  const t = typeof typed === 'number' ? typed : null;
  if (best != null && t != null) best = def.better === 'low' ? Math.min(best, t) : Math.max(best, t);
  return { best, avg: move.avg, single: null };
}
