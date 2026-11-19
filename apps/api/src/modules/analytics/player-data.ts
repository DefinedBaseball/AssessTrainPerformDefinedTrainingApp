/* ─────────────────────────────────────────────────────────────────────────
   Chart Builder data: "Player Data" columns and uploaded Data Sets.
   Pure helpers -- unit-tested.

   Player Data = every reading the athletes produced, grouped by device:
     TM_PITCH     "<field>|<pitch type or ALL>" -- one TrackMan pitch per
                  reading (from each trackman_pitch row's raw data)
     BLAST_MOTION <metric>                      -- Blast swings
     BATTED_BALL  <metric>                      -- HitTrax + Full Swing balls,
                  pooled like the Hitting report's Batted Ball Metrics
     MANUAL       <metric>                      -- typed in reports (pop time ...)
     LIFTING / BODY_WEIGHT                      -- VALD + typed lifting, weight
   A chart's Daily Value (average / max) turns each day's readings into one
   point.

   Data Sets = reference tables a coach uploads (MLB / college / age-group
   averages ...): rows are groups, columns are numbers; a column can be
   linked to a Player Data metric so an athlete can be compared with it.
   ───────────────────────────────────────────────────────────────────────── */

export const TM_FIELDS: { field: string; label: string; unit: string }[] = [
  { field: 'relSpeed', label: 'Velo', unit: 'mph' },
  { field: 'spinRate', label: 'Spin Rate', unit: 'rpm' },
  { field: 'inducedVertBreak', label: 'Induced Vertical Break', unit: 'in' },
  { field: 'horzBreak', label: 'Horizontal Break', unit: 'in' },
  { field: 'relHeight', label: 'Release Height', unit: 'ft' },
  { field: 'relSide', label: 'Release Side', unit: 'ft' },
  { field: 'extension', label: 'Extension', unit: 'ft' },
  { field: 'vertApprAngle', label: 'Vertical Approach Angle', unit: '°' },
  { field: 'zoneSpeed', label: 'Zone Speed', unit: 'mph' },
];

const LABELS: Record<string, string> = {
  attack_angle: 'Attack Angle', avg_bat_speed: 'Avg Bat Speed', max_bat_speed: 'Bat Speed', bat_speed: 'Bat Speed (Full Swing)',
  connection_at_impact: 'Connection at Impact', connection_score: 'Connection Score', early_connection: 'Early Connection',
  on_plane_efficiency: 'On-Plane Efficiency', peak_hand_speed: 'Peak Hand Speed', plane_angle: 'Plane Angle',
  power_output: 'Power', rotation_score: 'Rotation Score', rotational_accel_g: 'Rotational Acceleration', time_to_contact: 'Time to Contact',
  max_exit_velo: 'Exit Velo', distance: 'Distance', launch_angle: 'Launch Angle', smash_factor: 'Smash Factor', spray_angle: 'Spray Angle',
  squared_up_pct: 'Squared Up %', poi_depth: 'Point of Impact Depth',
  catcher_velo: 'Catcher Velo', exchange_time: 'Exchange Time', infield_velo: 'Infield Velo', outfield_velo: 'Outfield Velo', pop_time: 'Pop Time',
  sprint_60: '60 Yard Sprint', sprint_10: '10 Yard Sprint',
};
export const metricLabel = (key: string) => LABELS[key] ?? key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/* Batted ball rows that aren't a measurement to chart (zone ids, field
   coordinates) or are per-session totals mixed in with per-ball rows. */
export const BATTED_BALL_SKIP = new Set(['ball_type_code', 'strike_zone', 'spray_x', 'spray_z', 'spray_dist', 'avg_exit_velo']);
export const BATTED_BALL_SOURCES = ['HITTRAX', 'FULL_SWING', 'HITTRAX_POI'];

/** "Fastball" -> "Fastball", "ChangeUp" -> "Change Up". */
export const pitchTypeLabel = (t: string) => (t === 'ALL' ? 'All pitches' : t.replace(/([a-z])([A-Z])/g, '$1 $2'));

/** A TrackMan pitch's value for a TM_PITCH column, or null. */
export function tmPitchValue(raw: Record<string, unknown> | null, metricType: string): number | null {
  if (!raw) return null;
  const [field, type] = metricType.split('|');
  if (type && type !== 'ALL' && String(raw.pitchType ?? '') !== type) return null;
  const v = raw[field];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/* ── Data Sets ─────────────────────────────────────────────────────────── */

export interface DataSetColumn {
  key: string;
  name: string;
  unit: string;
  /** The Player Data metric this column compares with (optional). */
  link?: { source: string; metricType: string } | null;
}
export interface DataSetRow { label: string; values: Record<string, number | null> }
export interface CleanDataSet {
  name: string;
  description: string | null;
  source: string | null;
  labelColumn: string;
  columns: DataSetColumn[];
  rows: DataSetRow[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const KEY_RE = /^[a-z0-9_]{1,40}$/;
const LINK_SOURCE_RE = /^[A-Z_]{1,20}$/;
const LINK_METRIC_RE = /^[A-Za-z0-9_:|%/ .-]{1,80}$/;

/** Check an uploaded data set (already read from the file by the page). Throws with the problem. */
export function cleanDataSet(raw: any): CleanDataSet {
  const name = text(raw?.name, 120);
  if (!name) throw new Error('Give the data set a name');
  const columnsIn = Array.isArray(raw?.columns) ? raw.columns : [];
  if (!columnsIn.length) throw new Error('Pick at least one number column');
  if (columnsIn.length > 60) throw new Error('60 number columns at most');
  const seen = new Set<string>();
  const columns: DataSetColumn[] = columnsIn.map((c: any, i: number) => {
    const key = typeof c?.key === 'string' && KEY_RE.test(c.key) && !seen.has(c.key) ? c.key : `c${i}`;
    seen.add(key);
    const colName = text(c?.name, 80) || `Column ${i + 1}`;
    const link = c?.link && LINK_SOURCE_RE.test(String(c.link.source)) && LINK_METRIC_RE.test(String(c.link.metricType))
      ? { source: String(c.link.source), metricType: String(c.link.metricType) } : null;
    return { key, name: colName, unit: text(c?.unit, 16), link };
  });
  const rowsIn = Array.isArray(raw?.rows) ? raw.rows : [];
  if (!rowsIn.length) throw new Error('The file has no rows');
  if (rowsIn.length > 2000) throw new Error('2,000 rows at most');
  const rows: DataSetRow[] = rowsIn.map((r: any, i: number) => {
    const values: Record<string, number | null> = {};
    for (const c of columns) {
      const v = r?.values?.[c.key];
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[%,]/g, '')) : NaN;
      values[c.key] = Number.isFinite(n) && Math.abs(n) < 1e9 ? n : null;
    }
    return { label: text(r?.label, 100) || `Row ${i + 1}`, values };
  });
  return {
    name,
    description: text(raw?.description, 2000) || null,
    source: text(raw?.source, 500) || null,
    labelColumn: text(raw?.labelColumn, 80) || 'Group',
    columns,
    rows,
  };
}

/** One point per day (UTC date, plotted at noon): the day's average or max. */
export function aggregateDaily(points: { date: string; value: number }[], how: 'AVG' | 'MAX' | null | undefined) {
  if (!how) return points;
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    const d = p.date.slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p.value);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({
    date: `${d}T12:00:00.000Z`,
    value: how === 'MAX' ? Math.max(...v) : v.reduce((a, b) => a + b, 0) / v.length,
  }));
}
