/**
 * Report → trend-metric sync.
 *
 * The Player Summary trend charts must read ONE point per report (the values
 * the player's profile shows). They do that by reading metrics tagged with a
 * per-report source `REPORT_<id>`. This module produces those points from a
 * saved report:
 *   1. MANUAL fields (defense assessments, S&C speed, manual batted-ball /
 *      swing numbers) → taken straight from the report content.
 *   2. CSV uploads (Trackman / Blast / Full Swing / VALD) → each upload is
 *      AGGREGATED to a single value per metric (max / min / avg), so a CSV
 *      with hundreds of rows still contributes exactly one trend point.
 *
 * The raw per-pitch / per-swing Metric rows are left untouched (the profile
 * movement / spray plots read them); only the trend charts read the
 * `REPORT_*` points, so the seeded multi-date demo data never reaches a trend.
 *
 * Kept NestJS-free so both ReportsService and the backfill script can share
 * it. Metric keys mirror the trend-card keys in
 * `apps/web/src/app/athletes/[id]/tabs/PlayerSummaryTab.tsx` and the CSV
 * parser outputs (e.g. trackman-parser emits `fb_max_velo`, `spin_rate`).
 */

export interface ReportMetric {
  metricType: string;
  value: number;
  unit: string;
}

/** Coerce a report field (number | numeric-string | '' | null | undefined)
 *  to a finite number, or null when it isn't a usable reading. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Metrics where 0 is physically impossible, so a stored 0 means "the coach
 *  left it blank", not "the reading was zero".
 *
 *  This matters because a manual field WINS over the CSV aggregate below: a
 *  report carrying `avg_exit_velo: 0` would pin the trend to 0 and suppress
 *  the real value from the upload. Older reports do carry those zeros — the
 *  modal writes null for an untouched field now, but it has not always.
 *
 *  Angles and rates are deliberately NOT in here: a launch angle or a
 *  squared-up rate of 0 is a legitimate reading. */
const ZERO_MEANS_BLANK = new Set([
  'max_exit_velo', 'avg_exit_velo', 'max_bat_speed', 'avg_bat_speed', 'bat_speed',
  'distance', 'smash_factor', 'fb_max_velo',
  'infield_velo', 'outfield_velo', 'catcher_velo',
  'pop_time', 'exchange_time', 'sprint_60', 'sprint_10',
]);

/** Every metric key a trend chart can plot. CSV uploads emit hundreds of
 *  columns; only these are aggregated into per-report trend points. */
export const TREND_METRIC_KEYS: string[] = [
  // Hitting
  'max_exit_velo', 'avg_exit_velo', 'max_bat_speed', 'avg_bat_speed', 'bat_speed',
  'squared_up_pct', 'smash_factor', 'launch_angle', 'attack_angle', 'plane_angle', 'distance',
  // Pitching (Trackman aggregate keys)
  'fb_max_velo', 'fb_avg_velo', 'spin_rate', 'h_break', 'v_break', 'release_height', 'extension',
  // Defense / speed
  'infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time', 'exchange_time',
  'sprint_60', 'sprint_10',
  // Physical
  'jump_height', 'broad_jump', 'squat_max', 'bench_max', 'deadlift_max',
];

/** Display unit per metric key (used when emitting CSV-aggregated points). */
export const UNIT_FOR: Record<string, string> = {
  max_exit_velo: 'mph', avg_exit_velo: 'mph', max_bat_speed: 'mph', avg_bat_speed: 'mph', bat_speed: 'mph',
  squared_up_pct: '%', smash_factor: '', launch_angle: '°', attack_angle: '°', plane_angle: '°', distance: 'ft',
  fb_max_velo: 'mph', fb_avg_velo: 'mph', spin_rate: 'rpm', h_break: 'in', v_break: 'in', release_height: 'ft', extension: 'ft',
  infield_velo: 'mph', outfield_velo: 'mph', catcher_velo: 'mph', pop_time: 's', exchange_time: 's',
  sprint_60: 's', sprint_10: 's',
  jump_height: 'in', broad_jump: 'in', squat_max: 'lb', bench_max: 'lb', deadlift_max: 'lb',
};

/** How to collapse a CSV upload's many rows into one trend value:
 *  time-based metrics (lower is better) → min; bests / velocities → max;
 *  everything else (rates, angles, distances) → average.
 *
 *  `distance` is an average, not a max. It used to sit in the max bucket,
 *  which put the session's longest ball on the trend while the card's own
 *  headline and the Full Swing / HitTrax panels showed mean carry — one card
 *  reading 179 ft and plotting 248. Jump height and broad jump stay maxes:
 *  those genuinely are "best attempt" measurements. */
export function aggRuleFor(key: string): 'max' | 'min' | 'avg' {
  if (key === 'pop_time' || key === 'exchange_time' || key === 'sprint_60' || key === 'sprint_10') return 'min';
  if (key.includes('avg')) return 'avg';
  if (
    key.includes('max') ||
    key.endsWith('_velo') ||
    key === 'jump_height' || key === 'broad_jump'
  ) return 'max';
  return 'avg';
}

/** "Best reading" metrics a coach can also type in by hand (a radar gun,
 *  a ball the tracker missed). For these the report keeps the HIGHER of the
 *  manual number and the CSV max -- a manual entry below the CSV max never
 *  hides the real best. Every other manual field still simply wins. */
export const MANUAL_MAX_KEYS = new Set(['max_exit_velo', 'max_bat_speed', 'fb_max_velo']);

/** Pitch types the Pitching report's manual Max Velo boxes cover, and the
 *  ones that count as fastballs (same set the Trackman parser uses for
 *  `fb_max_velo`). Mirrored in the web's MANUAL_PITCH_TYPES. */
export const MANUAL_PITCH_TYPES = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Curveball', 'ChangeUp', 'Splitter'];
const FASTBALL_TYPES = ['Fastball', 'Sinker', 'Cutter'];

/** Upload IDs referenced by a report's `content.csvUploads`. */
function collectUploadIds(content: any): string[] {
  const ids: string[] = [];
  const cu = content?.csvUploads;
  if (cu && typeof cu === 'object') {
    for (const slot of Object.values(cu) as any[]) {
      // Multi-file slots carry `uploadIds: string[]`; legacy/single-file
      // slots carry one `uploadId`. Gather whichever is present.
      if (Array.isArray(slot?.uploadIds)) ids.push(...slot.uploadIds.filter(Boolean));
      else if (slot?.uploadId) ids.push(slot.uploadId);
    }
  }
  return ids;
}

/**
 * Pull the manually-entered metric values out of a report's parsed content.
 * Null / blank fields are skipped, so a report only ever contributes points
 * for the metrics it actually carries.
 */
export function extractReportMetrics(reportType: string, content: any): ReportMetric[] {
  const out: ReportMetric[] = [];
  const push = (metricType: string, raw: unknown, unit: string) => {
    const v = toNum(raw);
    if (v === null) return;
    /* A zero on a can't-be-zero metric is a blank field, not a reading —
       skip it so the CSV aggregate below can supply the real number. */
    if (v === 0 && ZERO_MEANS_BLANK.has(metricType)) return;
    out.push({ metricType, value: v, unit });
  };
  const c = content || {};

  switch (reportType) {
    case 'CATCHING': {
      const t = c.catchingAssessment?.throwing ?? {};
      push('catcher_velo', t.velocity?.best, 'mph');
      push('pop_time', t.popTime2B?.best, 's');
      push('exchange_time', t.exchangeTime?.best, 's');
      break;
    }
    case 'INFIELD': {
      const a = c.infieldAssessment ?? {};
      const s = a.manualSnapshot ?? {};
      push('infield_velo', s.armStrength?.primary ?? a.arm?.velocity?.best, 'mph');
      push('sprint_60', s.range?.primary, 's');
      // "Acceleration 0-30 ft" == the 10-yard (30 ft) sprint.
      push('sprint_10', s.range?.secondary, 's');
      break;
    }
    case 'OUTFIELD': {
      const a = c.outfieldAssessment ?? {};
      const s = a.manualSnapshot ?? {};
      push('outfield_velo', s.armStrength?.primary ?? a.arm?.velocity?.best, 'mph');
      push('sprint_60', s.range?.primary, 's');
      push('sprint_10', s.range?.secondary, 's');
      break;
    }
    case 'STRENGTH': {
      const sp = c.strengthConditioning?.speed ?? {};
      push('sprint_60', sp.sixty, 's');
      push('sprint_10', sp.ten, 's');
      // jump_height / broad_jump / lifts arrive via the VALD CSV pipeline.
      break;
    }
    case 'HITTING': {
      const bb = c.manualBattedBall ?? {};
      const sw = c.manualSwingMetrics ?? {};
      push('avg_exit_velo', bb.avg_exit_velo, 'mph');
      push('max_exit_velo', bb.max_exit_velo, 'mph');
      push('squared_up_pct', bb.squared_up_pct, '%');
      push('smash_factor', bb.smash_factor, '');
      push('launch_angle', bb.launch_angle, '°');
      push('distance', bb.distance, 'ft');
      push('max_bat_speed', sw.max_bat_speed, 'mph');
      push('avg_bat_speed', sw.avg_bat_speed, 'mph');
      push('attack_angle', sw.attack_angle, '°');
      push('plane_angle', sw.plane_angle, '°');
      break;
    }
    case 'PITCHING': {
      /* The mechanical 20-80 grades aren't trend metrics; velo/spin/break
         come from the Trackman aggregation. The one manual input is the
         per-pitch-type Max Velo -- its fastball-family best is the report's
         manual Max FB Velo. */
      const pm = c.manualPitchMax ?? {};
      const fb = FASTBALL_TYPES.map((t) => toNum(pm[t])).filter((v): v is number => v !== null && v > 0);
      if (fb.length) push('fb_max_velo', Math.max(...fb), 'mph');
      break;
    }
    default:
      break;
  }

  return out;
}

/**
 * Sync ONE report's trend points into the Metric table under `REPORT_<id>`:
 * manual fields + one aggregated value per CSV-upload metric. Idempotent —
 * deletes the report's prior `REPORT_<id>` rows, then re-creates. `prisma`
 * is the Nest PrismaService or a standalone PrismaClient (same API).
 * Returns the number of trend points written.
 */
export async function syncReportMetricsFor(
  prisma: any,
  report: { id: string; playerId: string; reportType: string; content: string; createdAt: Date },
): Promise<number> {
  const source = `REPORT_${report.id}`;

  let content: any = {};
  try {
    content = JSON.parse(report.content || '{}');
    if (typeof content === 'string') content = JSON.parse(content);
  } catch {
    content = {};
  }

  // 1) Manual fields take precedence.
  const byKey = new Map<string, { value: number; unit: string }>();
  for (const m of extractReportMetrics(report.reportType, content)) {
    byKey.set(m.metricType, { value: m.value, unit: m.unit });
  }
  /* Which keys the coach supplied by hand. Needed below to tell a manual
     value apart from a CSV-derived one — the avg-exit-velo derivation may
     override the latter but must never override the former. */
  const manualKeys = new Set(byKey.keys());

  // 2) CSV uploads → one aggregated value per trend metric (manual wins).
  const uploadIds = collectUploadIds(content);
  if (uploadIds.length > 0) {
    const grouped = await prisma.metric.groupBy({
      by: ['metricType'],
      where: { uploadId: { in: uploadIds }, metricType: { in: TREND_METRIC_KEYS } },
      _max: { value: true },
      _min: { value: true },
      _avg: { value: true },
    });
    for (const g of grouped) {
      const rule = aggRuleFor(g.metricType);
      const v = rule === 'max' ? g._max?.value : rule === 'min' ? g._min?.value : g._avg?.value;
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const manual = byKey.get(g.metricType);
      if (manual) {
        /* A manual Max only stands when it beats the CSV's best. */
        if (MANUAL_MAX_KEYS.has(g.metricType) && v > manual.value) byKey.set(g.metricType, { ...manual, value: v });
        continue;
      }
      byKey.set(g.metricType, { value: v, unit: UNIT_FOR[g.metricType] ?? '' });
    }

    /* Avg Exit Velocity has no row of its own to aggregate.
       HitTrax and Full Swing write EVERY SWING's exit velocity under the key
       `max_exit_velo` (one row per swing), so the loop above turns that group
       into a max and the avg trend gets nothing at all. Blast Motion, by
       contrast, emits max_bat_speed AND avg_bat_speed as session aggregates,
       which is why the bat-speed trends never showed this.

       So derive it the same way the profile's Full Swing / HitTrax panels do:
       the mean of those per-swing rows.

       This deliberately OVERRIDES an `avg_exit_velo` group when one exists.
       Some exports carry a handful of per-session "avg exit velocity" summary
       rows, and averaging those averages is not the mean of the swings — it
       gave one athlete a trend of 87.5 against a panel reading 91.4. The
       trend has to agree with the number on the page, and the page averages
       the swings. A value the coach typed in by hand still wins. */
    if (!manualKeys.has('avg_exit_velo')) {
      const swings = grouped.find((g: any) => g.metricType === 'max_exit_velo');
      const mean = swings?._avg?.value;
      if (mean !== null && mean !== undefined && Number.isFinite(mean)) {
        byKey.set('avg_exit_velo', { value: mean, unit: UNIT_FOR.avg_exit_velo });
      }
    }
  }

  // 3) Replace this report's points in place.
  await prisma.metric.deleteMany({ where: { source } });
  if (byKey.size > 0) {
    await prisma.metric.createMany({
      data: Array.from(byKey.entries()).map(([metricType, v]) => ({
        playerId: report.playerId,
        source,
        metricType,
        value: v.value,
        unit: v.unit,
        recordedAt: report.createdAt,
      })),
    });
  }
  return byKey.size;
}
