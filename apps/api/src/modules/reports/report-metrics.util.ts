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
 *  everything else (rates, angles, percentages) → average. */
export function aggRuleFor(key: string): 'max' | 'min' | 'avg' {
  if (key === 'pop_time' || key === 'exchange_time' || key === 'sprint_60' || key === 'sprint_10') return 'min';
  if (key.includes('avg')) return 'avg';
  if (
    key.includes('max') ||
    key.endsWith('_velo') ||
    key === 'distance' || key === 'jump_height' || key === 'broad_jump'
  ) return 'max';
  return 'avg';
}

/** Upload IDs referenced by a report's `content.csvUploads`. */
function collectUploadIds(content: any): string[] {
  const ids: string[] = [];
  const cu = content?.csvUploads;
  if (cu && typeof cu === 'object') {
    for (const slot of Object.values(cu) as any[]) {
      if (slot?.uploadId) ids.push(slot.uploadId);
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
    if (v !== null) out.push({ metricType, value: v, unit });
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
    // PITCHING manual fields are mechanical 20-80 grades, not trend metrics;
    // its velo/spin/break trend points come from the Trackman CSV aggregation.
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
      if (byKey.has(g.metricType)) continue;
      const rule = aggRuleFor(g.metricType);
      const v = rule === 'max' ? g._max?.value : rule === 'min' ? g._min?.value : g._avg?.value;
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        byKey.set(g.metricType, { value: v, unit: UNIT_FOR[g.metricType] ?? '' });
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
