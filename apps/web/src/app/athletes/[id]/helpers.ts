import type { Player, Metric, Video } from '@/lib/api';

/* ── Shared Types ── */

export interface ReportSummary {
  id: string;
  reportType: string;
  notes: string | null;
  videoIds: string | null;
  content: string | null;
  createdAt: string;
  createdBy: { id: string; email: string; role: string } | null;
}

export interface TabProps {
  player: Player & { metrics: Metric[] };
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>;
  progressData: Record<string, { value: number; recordedAt: string }[]>;
  videos: Video[];
  reports: ReportSummary[];
  isCoach: boolean;
  onRefresh?: () => void;
  refreshKey?: number;
}

/** Get the latest report matching any of the given types */
export function getLatestReport(reports: ReportSummary[], types: string[]): ReportSummary | null {
  const matching = reports
    .filter(r => types.includes(r.reportType))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return matching[0] || null;
}

/** Get video IDs from a report's videoIds field */
export function getReportVideoIds(report: ReportSummary | null): string[] {
  if (!report?.videoIds) return [];
  return report.videoIds.split(',').map(s => s.trim()).filter(Boolean);
}

/** Get video metadata from report content JSON (includes URL when available) */
export function getReportContentVideos(report: ReportSummary | null): { name: string; size: number; url?: string; id?: string }[] {
  if (!report?.content) return [];
  try {
    const parsed = JSON.parse(report.content);
    if (Array.isArray(parsed.videos)) return parsed.videos;
  } catch { /* ignore */ }
  return [];
}

/** Extract all uploadIds from a report's content JSON (from csvUploads) */
export function getReportUploadIds(report: ReportSummary | null): string[] {
  if (!report?.content) return [];
  try {
    const parsed = JSON.parse(report.content);
    const uploads = parsed.csvUploads;
    if (!uploads || typeof uploads !== 'object') return [];
    const ids: string[] = [];
    for (const val of Object.values(uploads)) {
      const entry = val as any;
      if (entry?.uploadId) ids.push(entry.uploadId);
    }
    return ids;
  } catch { /* ignore */ }
  return [];
}

/* ── Metric Labels ── */

export const METRIC_LABELS: Record<string, string> = {
  // Swing (Blast Motion)
  max_bat_speed: 'Max Bat Speed',
  avg_bat_speed: 'Avg Bat Speed',
  attack_angle: 'Attack Angle',
  plane_angle: 'Plane Angle',
  time_to_contact: 'Time to Contact',
  on_plane_efficiency: 'On-Plane Efficiency',
  peak_hand_speed: 'Peak Hand Speed',
  rotational_acceleration: 'Rotational Accel',
  connection_at_contact: 'Connection at Contact',
  early_connection: 'Early Connection',
  // Batted Ball (Full Swing / HitTrax)
  max_exit_velo: 'Max Exit Velo',
  avg_exit_velo: 'Avg Exit Velo',
  launch_angle: 'Launch Angle',
  bat_speed: 'Bat Speed',
  smash_factor: 'Smash Factor',
  spray_angle: 'Spray Angle',
  squared_up_pct: 'Squared Up %',
  hard_hit_pct: 'Hard Hit %',
  distance: 'Distance',
  // Pitching (Trackman)
  fb_max_velo: 'FB Max Velo',
  fb_avg_velo: 'FB Avg Velo',
  spin_rate: 'Spin Rate',
  h_break: 'H-Break',
  v_break: 'V-Break',
  release_height: 'Release Height',
  extension: 'Extension',
  // Defense
  infield_velo: 'Infield Velo',
  outfield_velo: 'Outfield Velo',
  catcher_velo: 'Catcher Velo',
  pop_time: 'Pop Time',
  exchange_time: 'Exchange Time',
  // Pitch Recognition
  pitch_rec_fb: 'FB Recognition',
  pitch_rec_os: 'Off-Speed Recognition',
  pitch_rec_overall: 'Overall Recognition',
  ab_iq: 'At-Bat IQ',
  // At-Bat Assessment
  fb_barrel_pct: 'FB Barrel%',
  fb_whiff_pct: 'FB Whiff%',
  fb_in_zone_swing_pct: 'FB In-Zone Swing%',
  fb_chase_pct: 'FB Chase%',
  os_barrel_pct: 'OS Barrel%',
  os_whiff_pct: 'OS Whiff%',
  os_in_zone_swing_pct: 'OS In-Zone Swing%',
  os_chase_pct: 'OS Chase%',
  overall_barrel_pct: 'Overall Barrel%',
  overall_bb_pct: 'BB%',
  overall_k_pct: 'K%',
  avg_ev: 'Avg EV',
  // Vision (Vizual Edge)
  vizual_edge_convergence: 'Convergence',
  vizual_edge_divergence: 'Divergence',
  vizual_edge_tracking: 'Tracking',
  vizual_edge_recognition: 'Recognition',
  vizual_edge_overall: 'Overall Score',
  // Strength & Conditioning (VALD)
  jump_height: 'Vertical Jump',
  broad_jump: 'Broad Jump',
  sprint_60: '60-Yard Sprint',
  squat_max: 'Squat Max',
  bench_max: 'Bench Max',
  deadlift_max: 'Deadlift Max',
  grip_strength_l: 'Grip Strength (L)',
  grip_strength_r: 'Grip Strength (R)',
  body_weight: 'Body Weight',
  body_fat_pct: 'Body Fat %',
};

/* ── Metric Keys Grouped by Tab ── */

export const TAB_METRICS = {
  swing: [
    'max_bat_speed', 'avg_bat_speed', 'attack_angle', 'plane_angle',
    'time_to_contact', 'on_plane_efficiency', 'peak_hand_speed',
    'rotational_acceleration', 'connection_at_contact', 'early_connection',
  ],
  battedBall: [
    'max_exit_velo', 'avg_exit_velo', 'launch_angle', 'bat_speed',
    'smash_factor', 'squared_up_pct', 'hard_hit_pct', 'distance',
  ],
  pitchRec: ['pitch_rec_fb', 'pitch_rec_os', 'pitch_rec_overall', 'ab_iq'],
  defense: ['infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time', 'exchange_time'],
  pitching: ['fb_max_velo', 'fb_avg_velo', 'spin_rate', 'h_break', 'v_break', 'release_height', 'extension'],
  vision: [
    'vizual_edge_convergence', 'vizual_edge_divergence',
    'vizual_edge_tracking', 'vizual_edge_recognition', 'vizual_edge_overall',
  ],
  strengthCond: [
    'jump_height', 'broad_jump', 'sprint_60',
    'squat_max', 'bench_max', 'deadlift_max',
    'grip_strength_l', 'grip_strength_r', 'body_weight', 'body_fat_pct',
  ],
};

/* ── Badge / Grading Helpers ── */

// [highThreshold, midThreshold, higherIsBetter]
const THRESHOLDS: Record<string, [number, number, boolean]> = {
  max_exit_velo: [95, 85, true],
  avg_exit_velo: [88, 80, true],
  max_bat_speed: [75, 65, true],
  avg_bat_speed: [70, 62, true],
  squared_up_pct: [40, 25, true],
  hard_hit_pct: [40, 25, true],
  on_plane_efficiency: [85, 70, true],
  bat_speed: [75, 65, true],
  smash_factor: [1.35, 1.2, true],
  distance: [380, 320, true],
  fb_max_velo: [90, 82, true],
  fb_avg_velo: [87, 80, true],
  spin_rate: [2400, 2000, true],
  infield_velo: [85, 78, true],
  outfield_velo: [90, 82, true],
  catcher_velo: [80, 73, true],
  pop_time: [1.9, 2.1, false],
  exchange_time: [0.7, 0.9, false],
  jump_height: [32, 26, true],
  broad_jump: [100, 90, true],
  sprint_60: [6.8, 7.2, false],
  pitch_rec_fb: [85, 70, true],
  pitch_rec_os: [75, 60, true],
  pitch_rec_overall: [80, 65, true],
  ab_iq: [70, 55, true],
  // At-Bat Assessment
  fb_barrel_pct: [25, 15, true],
  fb_whiff_pct: [15, 25, false],   // lower whiff is better
  fb_in_zone_swing_pct: [75, 60, true],
  fb_chase_pct: [20, 30, false],   // lower chase is better
  os_barrel_pct: [20, 10, true],
  os_whiff_pct: [25, 35, false],   // lower whiff is better
  os_in_zone_swing_pct: [65, 50, true],
  os_chase_pct: [25, 35, false],   // lower chase is better
  overall_barrel_pct: [20, 12, true],
  overall_bb_pct: [12, 8, true],
  overall_k_pct: [15, 25, false],  // lower K% is better
  avg_ev: [95, 85, true],
  vizual_edge_overall: [80, 65, true],
  vizual_edge_convergence: [80, 60, true],
  vizual_edge_divergence: [80, 60, true],
  vizual_edge_tracking: [80, 60, true],
  vizual_edge_recognition: [80, 60, true],
};

export type BadgeLevel = 'high' | 'mid' | 'low' | 'teal';

export function getBadgeLevel(metricType: string, value: number): BadgeLevel {
  const t = THRESHOLDS[metricType];
  if (!t) return 'teal';
  const [high, mid, higherBetter] = t;
  if (higherBetter) {
    if (value >= high) return 'high';
    if (value >= mid) return 'mid';
    return 'low';
  } else {
    if (value <= high) return 'high';
    if (value <= mid) return 'mid';
    return 'low';
  }
}

export function getBadgeText(level: BadgeLevel): string {
  switch (level) {
    case 'high': return 'Elite';
    case 'mid': return 'Above Avg';
    case 'low': return 'Developing';
    case 'teal': return '';
  }
}

/* ── 20-80 Scouting Grade ── */

// [min, max] ranges for converting raw values to 20-80 scale
export const GRADE_RANGES: Record<string, [number, number]> = {
  max_bat_speed: [55, 85],
  avg_bat_speed: [50, 80],
  max_exit_velo: [70, 110],
  avg_exit_velo: [65, 100],
  fb_max_velo: [70, 100],
  fb_avg_velo: [68, 97],
  infield_velo: [65, 95],
  outfield_velo: [70, 100],
  catcher_velo: [60, 90],
  pop_time: [2.3, 1.7],      // lower is better, min > max
  exchange_time: [1.2, 0.5],  // lower is better
  sprint_60: [7.8, 6.2],      // lower is better
  jump_height: [18, 40],
  broad_jump: [72, 120],
  bat_speed: [50, 85],
  smash_factor: [0.8, 1.5],
  distance: [250, 450],
  spin_rate: [1600, 2800],
};

export function toScoutingGrade(value: number, metricType: string): number {
  const range = GRADE_RANGES[metricType];
  if (!range) return 50; // default
  const [min, max] = range;
  const pct = (value - min) / (max - min);
  const raw = 20 + pct * 60;
  return Math.max(20, Math.min(80, Math.round(raw / 10) * 10));
}

/* ── Utility Functions ── */

export function formatHeight(inches: number | null): string {
  if (!inches) return '—';
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Calculate age from birthDate string, or estimate from grad year */
export function getAge(birthDate: string | null | undefined, gradYear: number | null | undefined): string {
  if (birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return String(age);
  }
  if (gradYear) {
    // Estimate: players typically turn 18 in their senior year
    const currentYear = new Date().getFullYear();
    return `~${18 - (gradYear - currentYear)}`;
  }
  return '—';
}

/** Extract metrics relevant to a set of keys from topMetrics */
export function getTabMetrics(
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
  keys: string[],
): Record<string, { value: number; unit: string; recordedAt: string }> {
  const result: Record<string, { value: number; unit: string; recordedAt: string }> = {};
  for (const key of keys) {
    if (topMetrics[key]) result[key] = topMetrics[key];
  }
  return result;
}

/** Filter player metrics by source */
export function getMetricsBySource(metrics: Metric[], source: string): Metric[] {
  return metrics.filter(m => m.source.toUpperCase() === source.toUpperCase());
}

/** Progress chart color palette */
export const CHART_COLORS: Record<string, string> = {
  max_exit_velo: '#4A90D9',
  avg_exit_velo: '#3A7BC0',
  max_bat_speed: '#20808D',
  avg_bat_speed: '#5BA3EC',
  infield_velo: '#FF9500',
  outfield_velo: '#FF6B00',
  pop_time: '#FF3B30',
  jump_height: '#AF52DE',
  fb_max_velo: '#6DAA45',
  fb_avg_velo: '#5B9A35',
  sprint_60: '#E8AF34',
  spin_rate: '#DD6974',
  bat_speed: '#E8AF34',
  smash_factor: '#AF52DE',
};

/* ─────────────────────────────────────────────
   AGGREGATE SCORE MODEL (20-80 scouting grade)
   Each section contains exactly 3 aggregate bars;
   each bar is itself an average over its underlying
   sub-metrics. The hero score is the average of
   every visible bar across every visible section.
   Scoring logic from reports/CSVs is added later —
   today this returns nulls so the UI shows "—".
   ───────────────────────────────────────────── */

export interface AggregateSubMetric {
  key: string;
  label: string;
  /** Optional raw numeric value pulled from metrics/reports when available. */
  value?: number;
  unit?: string;
  /** Optional scouting grade (20-80) derived from the raw value. */
  grade?: number;
}

export interface AggregateBar {
  key: string;
  label: string;
  /** Aggregate 20-80 score, or null if not enough data yet. */
  score: number | null;
  subMetrics: AggregateSubMetric[];
}

export interface AggregateSection {
  key: 'hitting' | 'pitching' | 'defense' | 'vision' | 'strength';
  label: string;
  color: string;
  bars: AggregateBar[];
}

export interface AggregateScores {
  sections: AggregateSection[];
  /** Average of every visible bar score, rounded, or null if no scores yet. */
  overall: number | null;
}

/* 20-80 band-based color scale — shared by every UI that surfaces
   a score (hero bubble, per-section summary headers, bar fills).
     20-40 → shades of red
     40-60 → shades of blue
     60-80 → shades of green
   Within each band the shade deepens (higher saturation + lower
   lightness) as the score moves away from the midpoint 50, so a 20
   is noticeably more intense than a 40, an 80 is noticeably deeper
   than a 60, etc. */
export function scoreColor(score: number): string {
  const clamped = Math.max(20, Math.min(80, score));

  let hue: number;
  let t: number; // 0 = band-midpoint (lightest), 1 = band extreme (darkest)

  if (clamped < 40) {
    hue = 0;                          // red
    t = (40 - clamped) / 20;          // 0 at 40, 1 at 20
  } else if (clamped < 60) {
    hue = 220;                        // blue
    t = Math.abs(clamped - 50) / 10;  // 0 at 50, 1 at 40 or 60
  } else {
    hue = 142;                        // green
    t = (clamped - 60) / 20;          // 0 at 60, 1 at 80
  }

  const lightness = 62 - t * 22;      // 62% lightest, 40% deepest
  const saturation = 70 + t * 20;     // 70% → 90%
  return `hsl(${hue}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
}

export function computeAggregateScores(
  player: { positions: string | null; firstName?: string | null; lastName?: string | null },
  _reports: ReportSummary[],
  _topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
): AggregateScores {
  const positions = (player.positions || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const hasNonPitcher = positions.some((p) => ['C', 'INF', 'OF', 'UTIL'].includes(p));
  const isPitcher = positions.includes('P');
  const isCatcher = positions.includes('C');
  const isInfielder = positions.includes('INF');
  const isOutfielder = positions.includes('OF');

  const sections: AggregateSection[] = [];

  // Hitting — any position other than pitcher-only
  if (hasNonPitcher) {
    sections.push({
      key: 'hitting',
      label: 'Hitting',
      color: '#4ADE80',
      bars: [
        {
          key: 'hit_mechanics',
          label: 'Mechanics',
          score: null,
          subMetrics: [
            { key: 'connection', label: 'Connection' },
            { key: 'path', label: 'Path' },
            { key: 'lower_half', label: 'Lower Half' },
            { key: 'breaks', label: 'Breaks' },
          ],
        },
        {
          key: 'hit_consistency',
          label: 'Consistency',
          score: null,
          subMetrics: [
            { key: 'barrel_pct', label: 'Barrel %' },
            { key: 'squared_up_pct', label: 'Squared Up %' },
            { key: 'avg_to_max_ev', label: 'Avg to Max EV' },
            { key: 'whiff_pct', label: 'Whiff %' },
          ],
        },
        {
          key: 'hit_swing_decision',
          label: 'Swing Decision',
          score: null,
          subMetrics: [
            { key: 'chase_pct', label: 'Chase %' },
            { key: 'barrel_pct', label: 'Barrel %' },
            { key: 'whiff_pct', label: 'Whiff %' },
            { key: 'in_zone_swing_pct', label: 'In-Zone Swing %' },
          ],
        },
      ],
    });
  }

  // Pitching — any P in positions
  if (isPitcher) {
    sections.push({
      key: 'pitching',
      label: 'Pitching',
      color: '#60A5FA',
      bars: [
        { key: 'pit_mechanics', label: 'Mechanics', score: null, subMetrics: [] },
        { key: 'pit_movement', label: 'Movement', score: null, subMetrics: [] },
        { key: 'pit_execution', label: 'Execution', score: null, subMetrics: [] },
      ],
    });
  }

  // Defense — position-aware content. Catchers get receiving/blocking/throwing,
  // INF/OF get range/routes/hands. If both flags are present (rare), catcher
  // wins because it's the more specialized role.
  if (isCatcher) {
    sections.push({
      key: 'defense',
      label: 'Defense',
      color: '#F59E0B',
      bars: [
        {
          key: 'def_receiving',
          label: 'Receiving',
          score: null,
          subMetrics: [
            { key: 'recv_path', label: 'Path' },
            { key: 'recv_turn', label: 'Turn' },
            { key: 'recv_accuracy', label: 'Accuracy' },
            { key: 'recv_speed', label: 'Speed' },
          ],
        },
        {
          key: 'def_blocking',
          label: 'Blocking',
          score: null,
          subMetrics: [
            { key: 'blk_range', label: 'Range' },
            { key: 'blk_accuracy', label: 'Accuracy' },
            { key: 'blk_decision', label: 'Decision Making' },
          ],
        },
        {
          key: 'def_throwing',
          label: 'Throwing',
          score: null,
          subMetrics: [
            { key: 'thr_transfer', label: 'Transfer' },
            { key: 'thr_footwork', label: 'Footwork' },
            { key: 'thr_arm', label: 'Arm Strength' },
            { key: 'thr_accuracy', label: 'Accuracy' },
          ],
        },
      ],
    });
  } else if (isInfielder || isOutfielder) {
    sections.push({
      key: 'defense',
      label: 'Defense',
      color: '#F59E0B',
      bars: [
        { key: 'def_range', label: 'Range', score: null, subMetrics: [] },
        { key: 'def_routes', label: 'Routes', score: null, subMetrics: [] },
        { key: 'def_hands', label: 'Hands', score: null, subMetrics: [] },
      ],
    });
  }

  // Vision — same trigger as hitting
  if (hasNonPitcher) {
    sections.push({
      key: 'vision',
      label: 'Vision',
      color: '#A78BFA',
      bars: [
        { key: 'vis_reaction', label: 'Reaction Time', score: null, subMetrics: [] },
        { key: 'vis_tracking', label: 'Tracking', score: null, subMetrics: [] },
        { key: 'vis_decision', label: 'Decision Making', score: null, subMetrics: [] },
      ],
    });
  }

  // S&C — always
  sections.push({
    key: 'strength',
    label: 'S & C',
    color: '#14B8A6',
    bars: [
      { key: 'sc_speed', label: 'Speed', score: null, subMetrics: [] },
      { key: 'sc_power', label: 'Power', score: null, subMetrics: [] },
      { key: 'sc_endurance', label: 'Endurance', score: null, subMetrics: [] },
    ],
  });

  // Demo overlay — populate Cole Anderson / Mason Brown with realistic
  // fake scores so the bar chart visually renders before the real
  // scoring pipeline is wired. Deterministic + name-keyed; goes away
  // the moment we start deriving scores from reports.
  applyDemoScores(player, sections);

  // Overall — average of every bar score that is populated.
  const bars = sections.flatMap((s) => s.bars.map((b) => b.score));
  const scored = bars.filter((v): v is number => v !== null);
  const overall = scored.length > 0
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : null;

  return { sections, overall };
}

/* Demo-only data. Keyed by "first last" (lowercased). Bar scores are
   on the 20-80 scouting scale. Sub-metric grades follow the same
   scale. When the real reports pipeline is in place this overlay can
   be deleted without touching the rest of the function. */
type DemoProfile = {
  bars: Record<string, number>;
  subs?: Record<string, Record<string, number>>;
};

const DEMO_PROFILES: Record<string, DemoProfile> = {
  'cole anderson': {
    // Strong hitter, solid defender, average vision, good athlete.
    bars: {
      hit_mechanics: 65,
      hit_consistency: 60,
      hit_swing_decision: 55,
      def_receiving: 55,
      def_blocking: 50,
      def_throwing: 60,
      def_range: 55,
      def_routes: 50,
      def_hands: 60,
      vis_reaction: 50,
      vis_tracking: 55,
      vis_decision: 50,
      sc_speed: 55,
      sc_power: 65,
      sc_endurance: 55,
    },
    subs: {
      hit_mechanics: { connection: 65, path: 70, lower_half: 60, breaks: 60 },
      hit_consistency: { barrel_pct: 60, squared_up_pct: 65, avg_to_max_ev: 55, whiff_pct: 55 },
      hit_swing_decision: { chase_pct: 50, barrel_pct: 60, whiff_pct: 55, in_zone_swing_pct: 60 },
      def_receiving: { recv_path: 55, recv_turn: 50, recv_accuracy: 60, recv_speed: 55 },
      def_blocking: { blk_range: 50, blk_accuracy: 55, blk_decision: 50 },
      def_throwing: { thr_transfer: 60, thr_footwork: 55, thr_arm: 65, thr_accuracy: 60 },
    },
  },
  'mason brown': {
    // Elite pitcher, strong S&C, still hits a little.
    bars: {
      hit_mechanics: 45,
      hit_consistency: 40,
      hit_swing_decision: 45,
      pit_mechanics: 70,
      pit_movement: 75,
      pit_execution: 65,
      sc_speed: 60,
      sc_power: 70,
      sc_endurance: 65,
      vis_reaction: 55,
      vis_tracking: 50,
      vis_decision: 55,
    },
    subs: {
      hit_mechanics: { connection: 45, path: 45, lower_half: 50, breaks: 40 },
      hit_consistency: { barrel_pct: 40, squared_up_pct: 45, avg_to_max_ev: 40, whiff_pct: 35 },
      hit_swing_decision: { chase_pct: 45, barrel_pct: 40, whiff_pct: 45, in_zone_swing_pct: 50 },
    },
  },
};

function applyDemoScores(
  player: { firstName?: string | null; lastName?: string | null },
  sections: AggregateSection[],
): void {
  const name = `${player.firstName || ''} ${player.lastName || ''}`.trim().toLowerCase();
  const profile = DEMO_PROFILES[name];
  if (!profile) return;

  for (const section of sections) {
    for (const bar of section.bars) {
      const s = profile.bars[bar.key];
      if (typeof s === 'number') bar.score = s;
      const subMap = profile.subs?.[bar.key];
      if (subMap) {
        for (const sub of bar.subMetrics) {
          const g = subMap[sub.key];
          if (typeof g === 'number') sub.grade = g;
        }
      }
    }
  }
}
