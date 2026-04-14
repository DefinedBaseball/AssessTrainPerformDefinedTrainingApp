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
