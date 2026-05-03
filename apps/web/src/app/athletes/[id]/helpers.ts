import type { Player, Metric, Video } from '@/lib/api';

/* ── Shared Types ── */

export interface ReportSummary {
  id: string;
  reportType: string;
  title?: string | null;
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
  /** Open the New-Report modal on the parent profile. Passed to ReportSelector
   *  so coaches can create a new report straight from the dropdown. */
  onNewReport?: () => void;
  /** Open the Report modal in EDIT mode for an existing report. Plumbed into
   *  ReportSelector so clicking the report name on the bar opens that report. */
  onEditReport?: (report: ReportSummary) => void;
  /** Open the profile-edit modal (Summary form). Used by the player-side
   *  Edit Profile button that replaces Add Report on non-coach views. */
  onEditProfile?: () => void;
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

/** Manual coach-entered "Coach Diagnosis" scores (20-80 scale) — lifted from a
 *  HITTING report's content JSON.  Returns nulls when missing. */
export interface ManualSwingScores {
  forwardMove: number | null;
  posture: number | null;
  stability: number | null;
  direction: number | null;
  stretch: number | null;
  core: number | null;
  slot: number | null;
  timing: number | null;
}

/** Mechanical coach grades for a PITCHING report (20-80 scale). Persisted at
 *  content.mechanicalScores on the report, displayed by the Pitching tab's
 *  Mechanical Coach Grades sub-tab. Eight categories cover the most-graded
 *  delivery checkpoints — coaches can set / unset each independently. */
export interface MechanicalPitchingScores {
  balance:    number | null;
  stride:     number | null;
  armAction:  number | null;
  separation: number | null;
  release:    number | null;
  gloveSide:  number | null;
  frontSide:  number | null;
  tempo:      number | null;
}

/** A single pitching-grade entry: a 20-80 score plus zero or more
 *  descriptive multi-select labels picked off the section's option list. */
export interface PitchingGradeEntry { score: number | null; options: string[]; }

/** All pitching grades for a single PITCHING report, keyed by `${section}.${item}`
 *  (e.g. `gather.legLiftHeight`). Persisted at content.pitchingGrades. */
export type PitchingGrades = Record<string, PitchingGradeEntry>;

/** Config for one graded checkpoint inside a pitching delivery section.
 *  Mirrored between the report modal (where coaches grade) and the Pitching
 *  profile tab's Mechanical Grades panel (where the saved data displays). */
export interface PitchingGradeItemConfig { key: string; label: string; options: string[]; }
export interface PitchingGradeSectionConfig { key: string; title: string; icon: string; items: PitchingGradeItemConfig[]; }

/** Single source of truth for the 7-section pitching delivery grade taxonomy.
 *  Keys flow through both the modal save and the Mechanical Grades read so
 *  any change here propagates to both. Entry-storage key is `${section}.${item}`. */
export const PITCHING_GRADE_SECTIONS: PitchingGradeSectionConfig[] = [
  {
    key: 'gather', title: 'The Gather', icon: '⚙️',
    items: [
      { key: 'legLiftHeight', label: 'Leg Lift Height', options: ['Low', 'Mid', 'High'] },
      { key: 'load',          label: 'Load',            options: ['Smooth', 'Rushed', 'Slow', 'Hitch'] },
      { key: 'tempo',         label: 'Tempo',           options: ['Consistent', 'Rushed', 'Slow'] },
      { key: 'stability',     label: 'Stability',       options: ['+Hinge', '-Hinge', '+Stack', '-Bad'] },
    ],
  },
  {
    key: 'armPath', title: 'Arm Path', icon: '🦾',
    items: [
      { key: 'armSwing',    label: 'Arm Swing',    options: ['Clean', 'Wraps', 'Short', 'Stabs', 'Stuck'] },
      { key: 'armPosition', label: 'Arm Position', options: ['On-Time', 'Late', 'Early'] },
      { key: 'mer',         label: 'MER',          options: ['Stable', 'Hypermobile', 'Limited Mobility'] },
    ],
  },
  {
    key: 'direction', title: 'Direction', icon: '➡️',
    items: [
      { key: 'direction',           label: 'Direction',            options: ['Stuck Back', 'Drift Forward', 'Spin Off', 'Push Off'] },
      { key: 'strideLength',        label: 'Stride Length',        options: ['Short', 'Medium', 'Long'] },
      { key: 'lowerHalfConnection', label: 'Lower Half Connection', options: ['Stable', 'Early Hip Rotation', 'Limited Separation'] },
    ],
  },
  {
    key: 'lhfs', title: 'Lower Half at Foot Strike', icon: '🦵',
    items: [
      { key: 'footStrikePosture', label: 'Foot Strike Posture', options: ['Stacked', 'Early Trunk Tilt', 'Falling Forward', 'Stuck Back'] },
      { key: 'kneeFlexion',       label: 'Knee Flexion',         options: ['Stable', 'Stiff', 'Weak'] },
      { key: 'leadLegBlock',      label: 'Lead Leg Block',       options: ['On Time', 'Early', 'Late'] },
    ],
  },
  {
    key: 'uhfs', title: 'Upper Half at Foot Strike', icon: '🎯',
    items: [
      { key: 'shoulderPosition', label: 'Shoulder Position', options: ['Closed', 'On-Time', 'Early'] },
      { key: 'gloveSide',        label: 'Glove Side',         options: ['Tucks', 'Opens', 'Passive'] },
    ],
  },
  {
    key: 'lhRot', title: 'Lower Half Rotation', icon: '🔄',
    items: [
      { key: 'timing',         label: 'Timing',                  options: ['On-Time', 'Early', 'Late'] },
      { key: 'hipShoulderSep', label: 'Hip / Shoulder Separation', options: ['On-Time', 'Early', 'Late'] },
    ],
  },
  {
    key: 'decel', title: 'Arm Deceleration', icon: '🛑',
    items: [
      { key: 'finish',         label: 'Finish',           options: ['On-Time', 'Early', 'Late'] },
      { key: 'gloveSideBreak', label: 'Glove Side Break', options: ['Tucks/Stabilizes', 'Flies Open', 'Passive', 'Collapse'] },
      { key: 'trunkRotation',  label: 'Trunk Rotation',   options: ['Good', 'Stops Early', 'Over Rotates'] },
    ],
  },
];

/** Stable storage key for a pitching grade entry. */
export const pitchingGradeKey = (section: string, item: string) => `${section}.${item}`;

/** Read pitching grades off a PITCHING report's content.pitchingGrades block.
 *  Always returns a Record (empty when missing/unparseable) so the modal can
 *  index into it without null guards. */
export function getPitchingGrades(report: ReportSummary | null): PitchingGrades {
  if (!report?.content) return {};
  try {
    const parsed = JSON.parse(report.content);
    const g = parsed?.pitchingGrades;
    if (!g || typeof g !== 'object') return {};
    const out: PitchingGrades = {};
    for (const [k, v] of Object.entries(g)) {
      const entry = v as any;
      if (!entry || typeof entry !== 'object') continue;
      const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null;
      const options = Array.isArray(entry.options) ? entry.options.filter((x: any) => typeof x === 'string') : [];
      out[k] = { score, options };
    }
    return out;
  } catch { return {}; }
}

/** Read mechanical scores off a PITCHING report's content.mechanicalScores
 *  block. Returns all-null when missing or unparseable. */
export function getMechanicalPitchingScores(report: ReportSummary | null): MechanicalPitchingScores {
  const empty: MechanicalPitchingScores = {
    balance: null, stride: null, armAction: null, separation: null,
    release: null, gloveSide: null, frontSide: null, tempo: null,
  };
  if (!report?.content) return empty;
  try {
    const parsed = JSON.parse(report.content);
    const m = parsed?.mechanicalScores;
    if (!m || typeof m !== 'object') return empty;
    const pick = (k: keyof MechanicalPitchingScores) =>
      typeof m[k] === 'number' && Number.isFinite(m[k]) ? m[k] : null;
    return {
      balance:    pick('balance'),
      stride:     pick('stride'),
      armAction:  pick('armAction'),
      separation: pick('separation'),
      release:    pick('release'),
      gloveSide:  pick('gloveSide'),
      frontSide:  pick('frontSide'),
      tempo:      pick('tempo'),
    };
  } catch { return empty; }
}

/** Descriptive multi-select tags paired with each manual swing score. Stored
 *  at content.manualOptions on the HITTING report alongside content.manualScores.
 *  An item with no tags simply renders an empty string[]. */
export type ManualSwingOptions = Record<keyof ManualSwingScores, string[]>;

export function getManualSwingOptions(report: ReportSummary | null): ManualSwingOptions {
  const empty: ManualSwingOptions = {
    forwardMove: [], posture: [], stability: [], direction: [],
    stretch: [], core: [], slot: [], timing: [],
  };
  if (!report?.content) return empty;
  try {
    const parsed = JSON.parse(report.content);
    const m = parsed?.manualOptions;
    if (!m || typeof m !== 'object') return empty;
    const result: ManualSwingOptions = { ...empty };
    for (const k of Object.keys(empty) as (keyof ManualSwingOptions)[]) {
      const arr = m[k];
      if (Array.isArray(arr)) {
        result[k] = arr.filter((x: any) => typeof x === 'string');
      }
    }
    return result;
  } catch { return empty; }
}

export function getManualSwingScores(report: ReportSummary | null): ManualSwingScores {
  const empty: ManualSwingScores = {
    forwardMove: null, posture: null, stability: null, direction: null,
    stretch: null, core: null, slot: null, timing: null,
  };
  if (!report?.content) return empty;
  try {
    const parsed = JSON.parse(report.content);
    const m = parsed?.manualScores ?? {};
    const num = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      forwardMove: num(m.forwardMove),
      posture:     num(m.posture),
      stability:   num(m.stability),
      direction:   num(m.direction),
      stretch:     num(m.stretch),
      core:        num(m.core),
      slot:        num(m.slot),
      timing:      num(m.timing),
    };
  } catch { return empty; }
}

/** Average a sparse set of 20-80 grades, ignoring nulls. */
export function averageGrades(values: (number | null | undefined)[]): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (real.length === 0) return null;
  const avg = real.reduce((a, b) => a + b, 0) / real.length;
  return Math.round(avg);
}

/** Convert a metric `topMetrics` reading to a 20-80 grade (clamped, rounded to 5). */
export function metricToGrade(
  topMetrics: Record<string, { value: number }>,
  metricKey: string,
): number | null {
  const m = topMetrics[metricKey];
  if (!m) return null;
  return toScoutingGrade(m.value, metricKey);
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
  overall_barrel_pct: 'Total Barrel%',
  overall_whiff_pct: 'Total Whiff%',
  /** Computed in SwingTab from Full Swing CSV column Q (SquaredUp). A null in
   *  that column = no contact = miss. Miss% = nulls / total swings * 100. */
  full_swing_miss_pct: 'Miss%',
  overall_chase_pct: 'Total Chase%',
  overall_in_zone_swing_pct: 'Total In-Zone Swing%',
  overall_bb_pct: 'Walk%',
  overall_k_pct: 'Strikeout%',
  avg_ev: 'Avg EV',
  // Derived swing-mechanics scores (graded 20-80)
  plane_score: 'Plane Score',
  connection_score: 'Connection Score',
  rotation_score: 'Rotation Score',
  // Manual coach scores (20-80)
  manual_forward_move: 'Forward Move',
  manual_posture: 'Posture',
  manual_stability: 'Stability',
  manual_direction: 'Direction',
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
  /** SWING MECHANICS — Blast Motion + age-adjusted bat speed + 3 derived scores
   *  (Plane / Connection / Rotation) and 4 coach-entered manual grades. */
  swingMech: [
    'attack_angle',          // Avg Attack Angle
    'plane_angle',           // Avg Tilt
    'avg_bat_speed',         // Bat Speed (against age avgs)
    'time_to_contact',
    'on_plane_efficiency',   // → Plane Score
    'connection_at_contact', // → Connection Score
    'rotational_acceleration', // → Rotation Score
  ],
  /** SWING DECISION — plate-discipline rates split by FB / OS / Total */
  swingDecision: [
    'fb_barrel_pct', 'os_barrel_pct', 'overall_barrel_pct',
    'fb_whiff_pct', 'os_whiff_pct', 'overall_whiff_pct',
    'fb_chase_pct', 'os_chase_pct', 'overall_chase_pct',
    'overall_bb_pct', 'overall_k_pct',
    'fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct',
  ],
  /** QUALITY OF CONTACT — outcome metrics from Full Swing / HitTrax */
  qualityOfContact: [
    'avg_exit_velo', 'squared_up_pct', 'smash_factor',
    'overall_whiff_pct', 'overall_barrel_pct',
    'launch_angle', 'distance',
  ],
  /* Legacy groupings — kept so older tab files keep working. */
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
  overall_whiff_pct: [20, 30, false],   // lower is better
  full_swing_miss_pct: [15, 30, false], // lower is better
  overall_chase_pct: [22, 32, false],   // lower is better
  overall_in_zone_swing_pct: [70, 55, true],
  overall_bb_pct: [12, 8, true],
  overall_k_pct: [15, 25, false],  // lower K% is better
  avg_ev: [95, 85, true],
  attack_angle: [15, 8, true],     // sweet-spot ~10-15° (treat higher = better in-window)
  plane_angle: [35, 25, true],     // tilt — higher generally better up to ~35°
  time_to_contact: [0.14, 0.18, false], // faster is better
  connection_at_contact: [88, 78, true],
  rotational_acceleration: [22, 16, true],
  launch_angle: [25, 15, true],   // sweet-spot for damage
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
  // Swing-decision rates (note: lower-is-better metrics use [worst, best])
  fb_barrel_pct: [5, 30],
  os_barrel_pct: [3, 25],
  overall_barrel_pct: [5, 25],
  fb_whiff_pct: [35, 10],         // lower is better
  os_whiff_pct: [40, 15],         // lower is better
  overall_whiff_pct: [35, 12],    // lower is better
  full_swing_miss_pct: [40, 5],   // lower is better — % of swings with no contact
  fb_chase_pct: [40, 10],         // lower is better
  os_chase_pct: [45, 15],         // lower is better
  overall_chase_pct: [42, 12],    // lower is better
  overall_bb_pct: [4, 16],
  overall_k_pct: [35, 8],         // lower is better
  fb_in_zone_swing_pct: [40, 80],
  os_in_zone_swing_pct: [40, 75],
  overall_in_zone_swing_pct: [40, 78],
  squared_up_pct: [10, 45],
  // Swing mechanics
  attack_angle: [-5, 18],          // sweet-spot positive
  plane_angle: [10, 38],
  time_to_contact: [0.20, 0.13],   // lower is better
  on_plane_efficiency: [55, 92],
  connection_at_contact: [70, 95],
  rotational_acceleration: [10, 26],
  launch_angle: [5, 22],
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

/** Aggregate-section keys. Defense was split into per-position sections so
 *  the Tool Grades bubble mirrors the player's actual tab layout (each
 *  position only renders its own defense bar). */
export type AggregateSectionKey =
  | 'hitting'
  | 'pitching'
  | 'defense_infield'
  | 'defense_catching'
  | 'defense_outfield'
  | 'strength';

export interface AggregateSection {
  key: AggregateSectionKey;
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
/** Flat three-stop scoring color: every "bad" grade is the same red, every
 *  "average" grade is the same yellow, every "good" grade is the same green.
 *    < 40 → red,  40-59 → yellow,  ≥ 60 → green. */
export function scoreColor(score: number): string {
  const clamped = Math.max(20, Math.min(80, score));
  if (clamped >= 60) return '#22C55E';   // green = good
  if (clamped >= 40) return '#EAB308';   // yellow = average
  return '#EF4444';                       // red = bad
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

  // Hitting — any position other than pitcher-only.
  // Bars mirror the player's Hitting tab exactly: Swing, Quality of Contact,
  // Swing Decision, Coach Grades. Scores + sub-metric grades are computed
  // here from the real data (topMetrics + latest HITTING report's manual
  // scores) so the Summary view matches what the coach sees on the tab.
  if (hasNonPitcher) {
    /* Locked sub-metric lists per group — these labels populate the
       Sub-Grade Breakdown bubbles regardless of whether the player
       has data for every metric (missing metrics render with no
       grade). Mirrors the exact taxonomy the user requested. */
    const SWING_KEYS_LOCAL = [
      'attack_angle',
      'plane_angle',
      'avg_bat_speed',
      'time_to_contact',
      'on_plane_efficiency',
    ];
    const QOC_KEYS_LOCAL = [
      'avg_exit_velo',
      'squared_up_pct',
      'smash_factor',
      'launch_angle',
      'distance',
    ];
    /* Swing Decision sub-metrics roll up to four aggregate buckets in the
       Sub-Grade Breakdown: Barrel %, Whiff %, Chase %, In Zone Swing %.
       Each bucket averages the FB / OS / Total grades behind it. */
    const DECISION_BUCKETS: { key: string; label: string; sources: string[] }[] = [
      { key: 'decision_barrel',  label: 'Barrel %',         sources: ['fb_barrel_pct', 'os_barrel_pct', 'overall_barrel_pct'] },
      { key: 'decision_whiff',   label: 'Whiff %',          sources: ['fb_whiff_pct',  'os_whiff_pct',  'overall_whiff_pct'] },
      { key: 'decision_chase',   label: 'Chase %',          sources: ['fb_chase_pct',  'os_chase_pct',  'overall_chase_pct'] },
      { key: 'decision_zone_sw', label: 'In Zone Swing %',  sources: ['fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct'] },
    ];

    /* Pull the latest HITTING report's coach-entered manual scores so the
       Coach Grades bar aggregates the eight 20-80 manual checkpoints. */
    const latestHitting = getLatestReport(_reports, ['HITTING']);
    const manual = getManualSwingScores(latestHitting);
    const COACH_GRADE_DEFS: { key: keyof ManualSwingScores; label: string }[] = [
      { key: 'forwardMove', label: 'Forward Move' },
      { key: 'posture',     label: 'Posture' },
      { key: 'stability',   label: 'Stability' },
      { key: 'direction',   label: 'Direction' },
      { key: 'stretch',     label: 'Stretch' },
      { key: 'core',        label: 'Core' },
      { key: 'slot',        label: 'Slot' },
      { key: 'timing',      label: 'Timing' },
    ];

    /* For metric-keyed bars, build sub-metrics with their per-key grade
       so the Section detail card renders one entry per leaf metric.
       Keys without recorded data still surface so each group bubble
       always shows its full label set (Swing: Attack Angle / Plane
       Angle / etc.) — missing metrics simply have no grade. */
    const metricSubs = (keys: string[]): AggregateSubMetric[] =>
      keys.map((k) => {
        const m = _topMetrics[k];
        if (!m) {
          return { key: k, label: METRIC_LABELS[k] || k };
        }
        const grade = toScoutingGrade(m.value, k) ?? undefined;
        return {
          key: k,
          label: METRIC_LABELS[k] || k,
          value: m.value,
          unit: m.unit,
          grade,
        };
      });

    const swingSubs    = metricSubs(SWING_KEYS_LOCAL);
    const qocSubs      = metricSubs(QOC_KEYS_LOCAL);
    /* Build one aggregate sub-metric per decision bucket. Grade is the
       average of every contributing FB/OS/Total key that has a value;
       buckets with zero contributors render with no grade ("—"). */
    const decisionSubs: AggregateSubMetric[] = DECISION_BUCKETS.map((bucket) => {
      const grades = bucket.sources
        .map((k) => (_topMetrics[k] ? toScoutingGrade(_topMetrics[k].value, k) : null))
        .filter((g): g is number => g != null);
      const avg = grades.length > 0
        ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)
        : undefined;
      return { key: bucket.key, label: bucket.label, grade: avg };
    });

    const coachSubs: AggregateSubMetric[] = COACH_GRADE_DEFS.map(({ key, label }) => ({
      key: `manual_${key}`,
      label,
      grade: manual[key] ?? undefined,
    }));

    /* Bar scores are the average of every populated sub-metric grade. */
    const swingScore    = averageGrades(swingSubs.map((s) => s.grade ?? null));
    const qocScore      = averageGrades(qocSubs.map((s) => s.grade ?? null));
    const decisionScore = averageGrades(decisionSubs.map((s) => s.grade ?? null));
    const coachScore    = averageGrades(coachSubs.map((s) => s.grade ?? null));

    sections.push({
      key: 'hitting',
      label: 'Hitting',
      color: '#4ADE80',
      bars: [
        { key: 'hit_swing',          label: 'Swing',              score: swingScore,    subMetrics: swingSubs },
        { key: 'hit_qoc',            label: 'Quality of Contact', score: qocScore,      subMetrics: qocSubs },
        { key: 'hit_swing_decision', label: 'Swing Decision',     score: decisionScore, subMetrics: decisionSubs },
        { key: 'hit_coach',          label: 'Coach Grades',       score: coachScore,    subMetrics: coachSubs },
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

  // Defense — split into one section per position so the Tool Grades
  // bubble lines up 1:1 with the player profile's Infield / Catching /
  // Outfield top-level tabs. A multi-position athlete (e.g. C + INF)
  // gets both rows; a pitcher-only gets none.
  if (isInfielder) {
    sections.push({
      key: 'defense_infield',
      label: 'Infield',
      color: '#F59E0B',
      bars: [
        { key: 'def_range', label: 'Range', score: null, subMetrics: [] },
        { key: 'def_routes', label: 'Routes', score: null, subMetrics: [] },
        { key: 'def_hands', label: 'Hands', score: null, subMetrics: [] },
      ],
    });
  }
  if (isCatcher) {
    sections.push({
      key: 'defense_catching',
      label: 'Catching',
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
  }
  if (isOutfielder) {
    sections.push({
      key: 'defense_outfield',
      label: 'Outfield',
      color: '#F59E0B',
      bars: [
        { key: 'def_range', label: 'Range', score: null, subMetrics: [] },
        { key: 'def_routes', label: 'Routes', score: null, subMetrics: [] },
        { key: 'def_hands', label: 'Hands', score: null, subMetrics: [] },
      ],
    });
  }

  // Cognition / Vision was retired with the Vision tab — no longer
  // surfaced in Tool Grades since there's no profile tab to drill into.

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
    // Hitting bars now match the player's Hitting tab — Swing / QoC /
    // Swing Decision / Coach Grades. Sub-metric keys mirror the Hitting
    // tab's metric keys (snake_case from the metrics pipeline).
    bars: {
      hit_swing: 65,
      hit_qoc: 60,
      hit_swing_decision: 55,
      hit_coach: 60,
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
      hit_swing: {
        attack_angle: 65, plane_angle: 60, avg_bat_speed: 70, time_to_contact: 60,
        on_plane_efficiency: 65, connection_at_contact: 60, rotational_acceleration: 70,
      },
      hit_qoc: {
        avg_exit_velo: 65, squared_up_pct: 60, smash_factor: 60,
        full_swing_miss_pct: 55, overall_barrel_pct: 60, launch_angle: 55, distance: 60,
      },
      hit_swing_decision: {
        decision_barrel: 60, decision_whiff: 55, decision_chase: 55, decision_zone_sw: 60,
      },
      hit_coach: {
        manual_forwardMove: 60, manual_posture: 65, manual_stability: 60, manual_direction: 60,
        manual_stretch: 55, manual_core: 60, manual_slot: 65, manual_timing: 60,
      },
      def_receiving: { recv_path: 55, recv_turn: 50, recv_accuracy: 60, recv_speed: 55 },
      def_blocking: { blk_range: 50, blk_accuracy: 55, blk_decision: 50 },
      def_throwing: { thr_transfer: 60, thr_footwork: 55, thr_arm: 65, thr_accuracy: 60 },
    },
  },
  'mason brown': {
    // Elite pitcher, strong S&C, still hits a little.
    bars: {
      hit_swing: 45,
      hit_qoc: 40,
      hit_swing_decision: 45,
      hit_coach: 45,
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
      hit_swing: {
        attack_angle: 45, plane_angle: 45, avg_bat_speed: 50, time_to_contact: 45,
        on_plane_efficiency: 45, connection_at_contact: 40, rotational_acceleration: 50,
      },
      hit_qoc: {
        avg_exit_velo: 40, squared_up_pct: 45, smash_factor: 40,
        full_swing_miss_pct: 35, overall_barrel_pct: 40, launch_angle: 45, distance: 40,
      },
      hit_swing_decision: {
        decision_barrel: 40, decision_whiff: 45, decision_chase: 45, decision_zone_sw: 50,
      },
      hit_coach: {
        manual_forwardMove: 45, manual_posture: 50, manual_stability: 45, manual_direction: 40,
        manual_stretch: 45, manual_core: 50, manual_slot: 40, manual_timing: 45,
      },
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
      // Demo only fills *unscored* bars — real computed scores always win
      // so the Summary stays in sync with the Hitting tab once data exists.
      if (typeof s === 'number' && bar.score == null) bar.score = s;
      const subMap = profile.subs?.[bar.key];
      if (subMap) {
        for (const sub of bar.subMetrics) {
          const g = subMap[sub.key];
          if (typeof g === 'number' && sub.grade == null) sub.grade = g;
        }
      }
    }
  }
}
