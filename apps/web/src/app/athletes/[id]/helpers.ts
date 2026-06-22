import type { Player, Metric, Video, AtBatDetail, Pitch } from '@/lib/api';

/* ── Live At-Bat → Swing Decision metrics ──────────────────────────────
   Aggregates per-pitch outcomes from this athlete's saved Live At-Bats
   into the same four percentages the Swing Decision Tool Grades bar
   used to pull from CSV uploads: Barrel %, Whiff %, Chase %, In-Zone
   Swing %. Replaces the FB/OS/Total CSV-derived bucketing now that
   coaches are tracking at-bats live via /live/at-bat.

   Pitch-result classification (matches the `PITCH_RESULTS` constants in
   api.ts and the pitch-tracker buttons over in /live/at-bat):
     • SWUNG  — STRIKE_SWINGING, STRIKE_OUT_SWINGING, FOUL, FLY_BALL,
                GROUND_BALL, LINE_DRIVE, BARREL
     • WHIFF  — STRIKE_SWINGING, STRIKE_OUT_SWINGING (swing-and-miss)
     • BIP    — FLY_BALL, GROUND_BALL, LINE_DRIVE, BARREL (in-play)
     • BARREL — BARREL only

   Zone classification (from each pitch's `callBallStrike` field set by
   the coach during live tracking):
     • STRIKE / 'S' → in-zone
     • BALL   / 'B' → out-of-zone
     • Anything else → unknown; falls back to inferring from result
       (BALL/WALK → out-of-zone; STRIKE_LOOKING/STRIKE_OUT_LOOKING →
       in-zone). Pitches that can't be classified either way are
       excluded from chase / zone-swing percentages but still count
       toward barrel / whiff.

   Returns raw 0-100 percentages (or null when the denominator is 0)
   so the caller can plug them into the existing GRADE_RANGES → 20-80
   converter (`toScoutingGrade`) without changing the grading logic. */
const SWING_RESULTS = new Set<string>([
  'STRIKE_SWINGING', 'STRIKE_OUT_SWINGING', 'FOUL',
  'FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL',
]);
const WHIFF_RESULTS = new Set<string>([
  'STRIKE_SWINGING', 'STRIKE_OUT_SWINGING',
]);
const IN_PLAY_RESULTS = new Set<string>([
  'FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL',
]);

function pitchInZone(p: Pitch): 'in' | 'out' | 'unknown' {
  const c = p.callBallStrike?.toUpperCase();
  if (c === 'STRIKE' || c === 'S') return 'in';
  if (c === 'BALL'   || c === 'B') return 'out';
  /* Fall back to result-based inference for legacy pitches that
     weren't tracking the zone-call field. */
  if (p.result === 'BALL' || p.result === 'WALK') return 'out';
  if (p.result === 'STRIKE_LOOKING' || p.result === 'STRIKE_OUT_LOOKING') return 'in';
  return 'unknown';
}

export interface LiveSwingDecisionStats {
  /** Barrel % across all balls in play (barrels / BIP) — barrels are now
   *  the at-bat's quality of contact, not a batted-ball type. */
  barrelPct: number | null;
  /** Whiff % across all swings (swing-and-miss / total swings). */
  whiffPct: number | null;
  /** Chase % across out-of-zone pitches (out-of-zone swings / oz pitches). */
  chasePct: number | null;
  /** In-Zone Swing % across in-zone pitches (iz swings / iz pitches). */
  inZoneSwingPct: number | null;
  /** Batted-ball type distribution across balls in play (type / BIP).
   *  Now accurate because Barrel is tracked separately from LD/FB/GB. */
  ldPct: number | null;
  fbPct: number | null;
  gbPct: number | null;
  /** Total pitches counted — surfaces "0 pitches" empty state in the UI. */
  pitchCount: number;
}

export function computeLiveSwingDecisionStats(atBats: AtBatDetail[]): LiveSwingDecisionStats {
  let pitchCount = 0;
  let swings = 0;
  let whiffs = 0;
  let inZone = 0;
  let outZone = 0;
  let inZoneSwings = 0;
  let outZoneSwings = 0;
  /* Balls-in-play, quality of contact, and batted-ball type are counted
     PER AT-BAT (one terminal BIP per AB), so Barrel% derives from the
     at-bat's `qualityOfContact` and the LD/FB/GB split from its `outcome`.
     Whiff / chase / zone stay per-pitch below. */
  let bip = 0;
  let barrels = 0;
  let ld = 0;
  let fb = 0;
  let gb = 0;

  for (const ab of atBats) {
    for (const p of ab.pitches || []) {
      pitchCount++;
      const swung = p.result ? SWING_RESULTS.has(p.result) : false;
      if (swung) swings++;
      if (p.result && WHIFF_RESULTS.has(p.result)) whiffs++;
      const zone = pitchInZone(p);
      if (zone === 'in')  { inZone++;  if (swung) inZoneSwings++;  }
      if (zone === 'out') { outZone++; if (swung) outZoneSwings++; }
    }
    const oc = ab.outcome;
    if (oc && IN_PLAY_RESULTS.has(oc)) {
      bip++;
      if (oc === 'LINE_DRIVE') ld++;
      else if (oc === 'FLY_BALL') fb++;
      else if (oc === 'GROUND_BALL') gb++;
      /* `oc === 'BARREL'` is a legacy outcome with no batted-ball type, so
         it's excluded from ld/fb/gb but still counts as a barrel below. */
      if (ab.qualityOfContact === 'BARREL' || oc === 'BARREL') barrels++;
    }
  }

  const pct = (num: number, denom: number): number | null =>
    denom > 0 ? Math.round((num / denom) * 1000) / 10 : null;

  return {
    barrelPct:       pct(barrels, bip),
    whiffPct:        pct(whiffs, swings),
    chasePct:        pct(outZoneSwings, outZone),
    inZoneSwingPct:  pct(inZoneSwings, inZone),
    ldPct:           pct(ld, bip),
    fbPct:           pct(fb, bip),
    gbPct:           pct(gb, bip),
    pitchCount,
  };
}

/* ── Hidden tabs (per-player UI preference) ─────────────────────────────
   Each player profile can hide individual tabs via the Eye toggle in the
   Report modal header — useful for athletes who don't train every
   discipline (e.g. a strict hitter doesn't need Catching / Infield /
   Outfield / S & C surfacing on their profile).

   Stored in localStorage keyed by playerId so the preference persists
   per-browser. Switching to a different machine resets to the defaults;
   moving this to the server would require a Prisma migration + API
   endpoint, which can be done later without changing this surface.

   The four position-specific Defense tabs + S & C default to HIDDEN so
   only Hitting / Pitching surface for a fresh player record. Coaches
   click the eye in the report modal to bring any of them back. */
export const DEFAULT_HIDDEN_TABS = ['catching', 'infield', 'outfield', 'strength'] as const;

/** Maps a `REPORT_TYPES` id (HITTING, PITCHING, …) to its profile-tab key
 *  (hitting, pitching, …). Used by the Eye toggle to know which tab to
 *  show / hide when the user clicks. */
export const REPORT_TYPE_TO_TAB: Record<string, string> = {
  HITTING: 'hitting',
  PITCHING: 'pitching',
  STRENGTH: 'strength',
  INFIELD: 'infield',
  OUTFIELD: 'outfield',
  CATCHING: 'catching',
};

function hiddenTabsKey(playerId: string): string {
  return `player.${playerId}.hiddenTabs`;
}

/** Read the hidden-tab set for a player from localStorage, falling back
 *  to `DEFAULT_HIDDEN_TABS` when nothing has been saved yet. Returns a
 *  fresh array each call so callers can mutate safely. */
export function getHiddenTabs(playerId: string): string[] {
  if (!playerId || typeof window === 'undefined') return [...DEFAULT_HIDDEN_TABS];
  try {
    const raw = window.localStorage.getItem(hiddenTabsKey(playerId));
    if (raw === null) return [...DEFAULT_HIDDEN_TABS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_TABS];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch { return [...DEFAULT_HIDDEN_TABS]; }
}

/** Persist the hidden-tab set and fire a window event so other live
 *  components (the tab bar over in page.tsx) pick up the change without
 *  needing a full re-render cycle. */
export function setHiddenTabsForPlayer(playerId: string, tabs: string[]): void {
  if (!playerId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(hiddenTabsKey(playerId), JSON.stringify(tabs));
    window.dispatchEvent(new CustomEvent('player:hiddenTabsChanged', {
      detail: { playerId },
    }));
  } catch { /* ignore quota / disabled storage */ }
}

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
  /** Switch the parent profile to the Videos tab. Wired into each tab's
   *  TabBarActions as an icon-only "Videos" button that sits next to
   *  the Download PDF icon, replacing the standalone Videos tab in
   *  the main nav. Works the same way in both player + coach apps. */
  onOpenVideos?: () => void;
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
  /** Coach grade on the hitter's stride — length / direction from load
   *  to launch. Persisted alongside the other Coach Diagnosis keys at
   *  content.manualScores on the HITTING report. */
  stride: number | null;
  /** Coach grade on hand-to-body connection through contact. Persisted at
   *  content.manualScores alongside the other Coach Diagnosis keys. */
  connection: number | null;
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
      /* "Drift" — timing-of-forward-move chip added under Direction. */
      { key: 'drift',               label: 'Drift',                 options: ['Early', 'Behind', 'Good'] },
    ],
  },
  {
    key: 'lhfs', title: 'Lower Half at Foot Strike', icon: '🦵',
    items: [
      /* "Foot Strike Posture" → "Foot Position" rename.
         Storage key also flips (`footStrikePosture` → `footPosition`)
         and the option set is the new toe/heel/orientation taxonomy.
         Old saved reports with `lhfs.footStrikePosture` will read as
         empty for this slot — by design, since the new descriptor
         set is incompatible with the old one. */
      { key: 'footPosition',      label: 'Foot Position',       options: ['Heel', 'Toe', 'Closed', 'Open'] },
      { key: 'kneeFlexion',       label: 'Knee Flexion',         options: ['Stable', 'Stiff', 'Weak'] },
      /* "Stability" chip — coach-specified descriptor set. */
      { key: 'stability',         label: 'Stability',            options: ['Leaked', 'Collapsed', 'Pushy', 'Balanced'] },
      /* `leadLegBlock` moved OUT of this section — it now lives
         under Lower Half Rotation below. */
    ],
  },
  {
    key: 'uhfs', title: 'Upper Half at Foot Strike', icon: '🎯',
    items: [
      { key: 'shoulderPosition',  label: 'Shoulder Position',   options: ['Closed', 'On-Time', 'Early'] },
      { key: 'gloveSide',         label: 'Glove Side',          options: ['Tucks', 'Opens', 'Passive'] },
      /* "Upper Body Posture" chip added per spec. */
      { key: 'upperBodyPosture',  label: 'Upper Body Posture',  options: ['Forward', 'Back', 'Upright', 'Hinged'] },
    ],
  },
  {
    key: 'lhRot', title: 'Lower Half Rotation', icon: '🔄',
    items: [
      { key: 'timing',         label: 'Timing',                  options: ['On-Time', 'Early', 'Late'] },
      { key: 'hipShoulderSep', label: 'Hip / Shoulder Separation', options: ['On-Time', 'Early', 'Late'] },
      /* `leadLegBlock` relocated from `lhfs` per spec. Storage key
         now resolves to `lhRot.leadLegBlock` — any prior reports
         with `lhfs.leadLegBlock` will not surface here. */
      { key: 'leadLegBlock',   label: 'Lead Leg Block',          options: ['On Time', 'Early', 'Late'] },
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
  /* Movement + Execution — two outcome-level Coach Grade bars
     appended after the 7 delivery-mechanics sections. They feed
     the matching Pitching Tool Grades bars on the Player Summary
     (`pit_movement`, `pit_execution` in `computeAggregateScores`)
     while the 7 delivery sections above roll up into the
     `pit_mechanics` bar. Each is a single-item section so it
     renders as one slider in the report modal + one bubble on
     the Coach Grades summary strip. */
  {
    key: 'movement', title: 'Movement', icon: '🌀',
    items: [
      {
        key: 'overall',
        label: 'Movement',
        options: ['Sharp', 'Average', 'Flat', 'Inconsistent'],
      },
    ],
  },
  {
    key: 'execution', title: 'Execution', icon: '🎯',
    items: [
      {
        key: 'overall',
        label: 'Execution',
        options: ['Locked In', 'Spotty', 'Wild', 'Behind in Counts'],
      },
    ],
  },
];

/** Section keys that roll up into the Pitching → Mechanics bar on
 *  the Player Summary Tool Grades card. The two outcome sections
 *  (Movement / Execution) are intentionally EXCLUDED here because
 *  they feed their own Tool Grades bars instead of the mechanics
 *  composite. */
export const PITCHING_MECHANICS_SECTION_KEYS: readonly string[] = [
  'gather', 'armPath', 'direction', 'lhfs', 'uhfs', 'lhRot', 'decel',
];

/** Stable storage key for a pitching grade entry. */
export const pitchingGradeKey = (section: string, item: string) => `${section}.${item}`;

/* ─────────────────────────────────────────────────────────────────────
   DEFENSE COACH GRADES (Catching / Infield / Outfield)
   ─────────────────────────────────────────────────────────────────────
   Per coach-spec, every defense report (CATCHING / INFIELD / OUTFIELD)
   surfaces the SAME 7 Coach Grade categories that the Pitching report
   uses for delivery mechanics — but each category gets a SINGLE
   20-80 slider instead of being broken down into per-item sub-grades.
   The defense form intentionally drops the underlying descriptor
   options too: just the 7 section TITLES, each with one score.

   Storage shape: a flat `Record<sectionKey, number|null>` (e.g.
   `{ gather: 60, armPath: 50, direction: null, ... }`) persisted at
   one of three content slots — `catchingCoachGrades`,
   `infieldCoachGrades`, `outfieldCoachGrades` — alongside the
   existing position-specific assessment blobs. Pitching's grade
   key/section names are reused verbatim so coaches read the same
   vocabulary across all positions; the labels still apply to
   throwing mechanics regardless of position. */
export interface DefenseCoachGradeSectionConfig {
  key: string;
  title: string;
  icon: string;
}
export type DefenseCoachGrades = Record<string, number | null>;

/** 5-section Coach Grade taxonomy used by every defense report
 *  (catching / infield / outfield) — throwing-mechanics checkpoints
 *  graded on the 20-80 scouting scale. `armPath` and `decel` keep
 *  their original keys so existing grades carry over; the other three
 *  use fresh keys for the redefined checkpoints. */
export const DEFENSE_COACH_GRADE_SECTIONS: DefenseCoachGradeSectionConfig[] = [
  { key: 'footWork',    title: 'Foot Work',            icon: '🦵' },
  { key: 'armPath',     title: 'Arm Path',             icon: '🦾' },
  { key: 'footStrike',  title: 'Foot Strike Position', icon: '🎯' },
  { key: 'rotationSeq', title: 'Rotation Sequence',    icon: '🔄' },
  { key: 'decel',       title: 'Arm Deceleration',     icon: '🛑' },
];

/** Defense position discriminator — selects which content slot the
 *  coach-grade reader/writer targets. */
export type DefensePosition = 'catching' | 'infield' | 'outfield';

const DEFENSE_GRADES_CONTENT_KEY: Record<DefensePosition, string> = {
  catching: 'catchingCoachGrades',
  infield:  'infieldCoachGrades',
  outfield: 'outfieldCoachGrades',
};

/** Read defense coach grades off a CATCHING/INFIELD/OUTFIELD report's
 *  content.{position}CoachGrades block. Always returns a Record
 *  (empty when missing/unparseable) so the modal + display can index
 *  into it without null guards. */
export function getDefenseCoachGrades(
  report: ReportSummary | null,
  position: DefensePosition,
): DefenseCoachGrades {
  if (!report?.content) return {};
  try {
    const parsed = JSON.parse(report.content);
    const g = parsed?.[DEFENSE_GRADES_CONTENT_KEY[position]];
    if (!g || typeof g !== 'object') return {};
    const out: DefenseCoachGrades = {};
    for (const [k, v] of Object.entries(g)) {
      /* Coerce every value to either a finite number or null —
         protects against bad legacy data while keeping the read
         side noise-free. */
      out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return out;
  } catch { return {}; }
}

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
    stretch: [], core: [], slot: [], timing: [], stride: [],
    connection: [],
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
    stretch: null, core: null, slot: null, timing: null, stride: null,
    connection: null,
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
      stride:      num(m.stride),
      connection:  num(m.connection),
    };
  } catch { return empty; }
}

/** Coach-entered batted-ball numbers for a HITTING report. Saved at
 *  content.manualBattedBall when the coach uses the "Manual Entry"
 *  toggle on the Full Swing CSV card instead of uploading a file. */
export type ManualBattedBall = {
  avg_exit_velo: number | null;
  squared_up_pct: number | null;
  smash_factor: number | null;
  launch_angle: number | null;
  distance: number | null;
};

/** Coach-entered Blast Motion swing numbers. Saved at
 *  content.manualSwingMetrics when the coach uses the "Manual Entry"
 *  toggle on the Blast CSV card. */
export type ManualSwingMetrics = {
  max_bat_speed: number | null;
  avg_bat_speed: number | null;
  attack_angle: number | null;
  plane_angle: number | null;
  time_to_contact: number | null;
  on_plane_efficiency: number | null;
  connection_at_contact: number | null;
  rotational_acceleration: number | null;
  /* Rotational Acceleration (g) — its OWN metric, DISTINCT from
     connection_at_contact. Populated by both the Blast CSV "Rotational
     Acceleration (g)" column and the manual-entry field (same key). */
  rotational_accel_g: number | null;
  /* New manual-entry fields added per the Blast CSV spec — these
     mirror the columns in the Blast Motion export so a coach can
     hand-enter them on a report when no CSV is uploaded. The Blast
     CSV → app mapping document (`Blast Motion App Logic.xlsx`)
     calls these out as belonging to the Swing bubble. */
  plane_score: number | null;
  connection_score: number | null;
  rotation_score: number | null;
  early_connection: number | null;
  connection_at_impact: number | null;
};

/** Field configs the report-modal uses to render the manual entry inputs. */
export const MANUAL_BATTED_BALL_FIELDS: { key: keyof ManualBattedBall; label: string; unit: string; step?: number }[] = [
  { key: 'avg_exit_velo',  label: 'Avg Exit Velo',  unit: 'mph', step: 0.1 },
  { key: 'squared_up_pct', label: 'Squared Up %',   unit: '%',   step: 0.1 },
  { key: 'smash_factor',   label: 'Smash Factor',   unit: '',    step: 0.01 },
  { key: 'launch_angle',   label: 'Launch Angle',   unit: '°',   step: 0.1 },
  { key: 'distance',       label: 'Distance',       unit: 'ft',  step: 1 },
];

/* Order mirrors the in-app Hitting Snapshot Swing row:
   Max Bat → Avg Bat → Attack → Tilt → TtC → Plane → Conn → Rot. */
export const MANUAL_SWING_METRIC_FIELDS: { key: keyof ManualSwingMetrics; label: string; unit: string; step?: number }[] = [
  { key: 'max_bat_speed',           label: 'Max Bat Speed',          unit: 'mph', step: 0.1 },
  { key: 'avg_bat_speed',           label: 'Avg Bat Speed',          unit: 'mph', step: 0.1 },
  { key: 'attack_angle',            label: 'Attack Angle',           unit: '°',   step: 0.1 },
  { key: 'plane_angle',             label: 'Tilt (Plane Angle)',     unit: '°',   step: 0.1 },
  { key: 'time_to_contact',         label: 'Time to Contact',        unit: 's',   step: 0.001 },
  { key: 'on_plane_efficiency',     label: 'On-Plane Efficiency',    unit: '%',   step: 0.1 },
  /* Rotational Acceleration (g) — a DISTINCT metric, NOT Connection at
     Contact. Uses the clean `rotational_accel_g` key so manual entry and
     the Blast CSV "Rotational Acceleration (g)" column populate the very
     same metric. (The legacy `connection_at_contact` key — abused as a
     Connection Score source elsewhere — is intentionally not used here.) */
  { key: 'rotational_accel_g',      label: 'Rotational Acceleration', unit: 'g',  step: 0.1 },
  /* Display label renamed "Rotational Acceleration" → "Power (Kwh)"
     per coach feedback. Data key (`rotational_acceleration`) and
     persisted reports are untouched — only the label coaches see
     in the manual entry form changes. Unit cleared (the Kwh
     identifier lives inside the label now, matching the
     `SHORT_LABELS.power_output: 'Power (Kwh)'` convention). */
  { key: 'rotational_acceleration', label: 'Power (Kwh)',           unit: '',    step: 0.1 },
  /* Additional metrics from the Blast CSV spec (`Blast Motion App
     Logic.xlsx`) — coaches can hand-enter these on a report when no
     Blast CSV is uploaded. Order follows the spec sheet: composite
     scores first (Plane / Connection / Rotation), then the
     specific connection-degree readings (Early Connection,
     Connection at Impact). */
  { key: 'plane_score',             label: 'Plane Score',            unit: '',    step: 1 },
  { key: 'connection_score',        label: 'Connection Score',       unit: '',    step: 1 },
  { key: 'rotation_score',          label: 'Rotation Score',         unit: '',    step: 1 },
  { key: 'early_connection',        label: 'Early Connection',       unit: '°',   step: 0.1 },
  { key: 'connection_at_impact',    label: 'Connection at Impact',   unit: '°',   step: 0.1 },
];

const EMPTY_MANUAL_BATTED_BALL: ManualBattedBall = {
  avg_exit_velo: null, squared_up_pct: null, smash_factor: null,
  launch_angle: null, distance: null,
};
const EMPTY_MANUAL_SWING: ManualSwingMetrics = {
  max_bat_speed: null, avg_bat_speed: null,
  attack_angle: null, plane_angle: null,
  time_to_contact: null, on_plane_efficiency: null,
  connection_at_contact: null, rotational_acceleration: null, rotational_accel_g: null,
  /* Blast CSV spec fields. Existing reports saved before these were
     added still load — `readManualNumberMap` clones this template
     then overlays whatever values are persisted, leaving the new
     keys as null when absent. */
  plane_score: null, connection_score: null, rotation_score: null,
  early_connection: null, connection_at_impact: null,
};

function readManualNumberMap<T extends Record<string, number | null>>(
  empty: T,
  source: any,
): T {
  if (!source || typeof source !== 'object') return { ...empty };
  const out: any = { ...empty };
  for (const key of Object.keys(empty)) {
    const raw = source[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    out[key] = Number.isFinite(n) ? n : null;
  }
  return out as T;
}

export function getManualBattedBall(report: ReportSummary | null): ManualBattedBall {
  if (!report?.content) return { ...EMPTY_MANUAL_BATTED_BALL };
  try {
    const parsed = JSON.parse(report.content);
    return readManualNumberMap(EMPTY_MANUAL_BATTED_BALL, parsed?.manualBattedBall);
  } catch { return { ...EMPTY_MANUAL_BATTED_BALL }; }
}

export function getManualSwingMetrics(report: ReportSummary | null): ManualSwingMetrics {
  if (!report?.content) return { ...EMPTY_MANUAL_SWING };
  try {
    const parsed = JSON.parse(report.content);
    return readManualNumberMap(EMPTY_MANUAL_SWING, parsed?.manualSwingMetrics);
  } catch { return { ...EMPTY_MANUAL_SWING }; }
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

/** Upload IDs carried by a single csvUploads slot entry. Multi-file slots
 *  store `uploadIds: string[]`; legacy / single-file slots store one
 *  `uploadId`. Either shape resolves to a flat string[]. */
export function slotUploadIds(entry: any): string[] {
  if (Array.isArray(entry?.uploadIds)) return entry.uploadIds.filter(Boolean);
  return entry?.uploadId ? [entry.uploadId] : [];
}

/** Extract all uploadIds from a report's content JSON (from csvUploads) */
export function getReportUploadIds(report: ReportSummary | null): string[] {
  if (!report?.content) return [];
  try {
    const parsed = JSON.parse(report.content);
    const uploads = parsed.csvUploads;
    if (!uploads || typeof uploads !== 'object') return [];
    const ids: string[] = [];
    for (const val of Object.values(uploads)) ids.push(...slotUploadIds(val));
    return ids;
  } catch { /* ignore */ }
  return [];
}

/** Same as `getReportUploadIds` but limits the result to a specific
 *  set of slot keys (the keys used in REPORT_CSV_SLOTS — e.g. `blast`,
 *  `fullswing`, `hittrax`, `atbat`, `atbat_fullswing`). Used by the
 *  Hitting tab to feed the Spray Chart different upload IDs depending
 *  on which sub-tab is active (Swing → assessment uploads,
 *  Swing Decision → the at-bat live-data upload). Returns [] when the
 *  report has no content or none of the requested slots have data. */
export function getReportUploadIdsForKeys(
  report: ReportSummary | null,
  slotKeys: readonly string[],
): string[] {
  if (!report?.content) return [];
  try {
    const parsed = JSON.parse(report.content);
    const uploads = parsed.csvUploads;
    if (!uploads || typeof uploads !== 'object') return [];
    const ids: string[] = [];
    for (const key of slotKeys) ids.push(...slotUploadIds(uploads[key]));
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
  power_output: 'Power',
  rotational_acceleration: 'Rotational Accel', // legacy
  connection_at_contact: 'Connection at Contact', // legacy
  rotational_accel_g: 'Rotational Accel', // Blast CSV "Rotational Acceleration (g)" — clean key (avoids the overloaded legacy ones)
  early_connection: 'Early Connection',
  // Batted Ball (Full Swing / HitTrax)
  max_exit_velo: 'Max EV',
  avg_exit_velo: 'Avg EV',
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
  manual_posture: 'Tilt',
  manual_stability: 'Adjust',
  manual_direction: 'Direct',
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
  /* Plane Score uses the flat 20-80 band: <40 red, 40-60 yellow, ≥60 green. */
  on_plane_efficiency: [60, 40, true],
  bat_speed: [75, 65, true],
  smash_factor: [1.35, 1.2, true],
  /* Distance bands match the in-app strict-threshold logic in
     toScoutingGrade — green ≥ 300 ft, yellow 200-300, red < 200. Was
     [380, 320] which made any session under 320 ft mid (yellow) and
     under 200 stayed low; the snapshot's 200/300 cutoffs are the
     coach-facing rule the rest of the app uses. */
  distance: [300, 200, true],
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
  plane_angle: [35, 25, true],     // tilt — overridden by special-case bands in getBadgeLevel
  time_to_contact: [0.14, 0.18, false], // faster is better
  /* Plane Score / Connection / Rotation — flat 20-80 raw scale.
     Matches the GRADE_RANGES + the user-spec "20-40 red, 40-60 yellow,
     60-80 green" bands. */
  connection_at_contact: [60, 40, true],
  rotational_acceleration: [60, 40, true],
  /* Power (kW) — high ≥ 6 kW, mid ≥ 4, low < 4. */
  power_output: [6, 4, true],
  /* Peak Hand Speed (mph) — high ≥ 25, mid ≥ 21, low < 21. */
  peak_hand_speed: [25, 21, true],
  launch_angle: [25, 15, true],   // sweet-spot for damage
  vizual_edge_overall: [80, 65, true],
  vizual_edge_convergence: [80, 60, true],
  vizual_edge_divergence: [80, 60, true],
  vizual_edge_tracking: [80, 60, true],
  vizual_edge_recognition: [80, 60, true],
};

export type BadgeLevel = 'high' | 'mid' | 'low' | 'teal';

export function getBadgeLevel(metricType: string, value: number): BadgeLevel {
  /* Strict band metrics — these need a sweet-spot rule that the standard
     two-threshold model can't express (red on BOTH ends, yellow in the
     middle, green at the target band). Kept in sync with toScoutingGrade
     so chip color and KPI-card color always agree. */
  if (metricType === 'plane_angle') {
    // Blast CSV imports as positive (0–40+); legacy manual data may be
    // negative. Compare against absolute value so both work:
    //   0–10  → red, 10–20 → yellow, 20–40 → green, >40 → red.
    const v = Math.abs(value);
    if (v < 10) return 'low';
    if (v < 20) return 'mid';
    if (v <= 40) return 'high';
    return 'low';
  }
  if (metricType === 'attack_angle') {
    // Sweet spot 0-15° green, 15-20° yellow, <0 or >20 red.
    if (value < 0) return 'low';
    if (value <= 15) return 'high';
    if (value <= 20) return 'mid';
    return 'low';
  }
  if (metricType === 'distance') {
    // <200 red, 200-300 yellow, >300 green
    if (value < 200) return 'low';
    if (value <= 300) return 'mid';
    return 'high';
  }
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
  /* Plane Score / Connection / Rotation — coaches grade these on a flat
     20-80 raw scale where the value IS the grade band:
       20-40 red · 40-60 yellow · 60-80 green
     A linear range of [20, 80] makes grade(value) ≈ clamp(value, 20, 80),
     so a raw 65 maps to grade 60 (green), a raw 45 maps to grade 50
     (yellow), etc. Mirrors the user-facing band spec exactly. */
  on_plane_efficiency: [20, 80],
  /* Power (Blast column O, kW) — typical amateur swings produce 3-7 kW.
     Linear band: 3 kW = grade 20, 7 kW = grade 80. */
  power_output: [3, 7],
  /* Peak Hand Speed (mph) — typical Blast values 18-28 mph. */
  peak_hand_speed: [18, 28],
  // Legacy keys kept for any historical data still in the DB.
  connection_at_contact: [20, 80],
  rotational_acceleration: [20, 80],
  launch_angle: [5, 22],
};

export function toScoutingGrade(value: number, metricType: string): number {
  /* Distance uses strict band thresholds rather than a linear range so the
     chip color flips on the exact ft cutoffs the coaches grade by:
       <200 ft → red    (grade 30)
       200–300 ft → yellow (grade 50)
       >300 ft → green  (grade 70)
     scoreColor() bands are <40 red, 40-59 yellow, ≥60 green, so 30/50/70
     land cleanly inside each color. */
  if (metricType === 'distance') {
    if (value < 200) return 30;
    if (value <= 300) return 50;
    return 70;
  }
  /* Plane Angle / Tilt — Blast CSV imports this as a POSITIVE number
     (e.g. 28° not -28°), so the bands compare against positive values.
     Strict sweet-spot bands rather than linear:
       0–10  → red    (grade 30) — bat too flat
       10–20 → yellow (grade 50)
       20–40 → green  (grade 70) — sweet-spot tilt
       >40   → red    (grade 30) — overcooked steep
     scoreColor bands <40 red / 40-59 yellow / ≥60 green, so the 30/50/70
     grades land cleanly inside each color band. Works on the absolute
     value so any legacy negative readings still grade correctly. */
  if (metricType === 'plane_angle') {
    const v = Math.abs(value);
    if (v < 10) return 30;
    if (v < 20) return 50;
    if (v <= 40) return 70;
    return 30;
  }
  /* Attack Angle — strict sweet-spot bands:
       <0          → red    (grade 30) — chopping down
       0–15        → green  (grade 70) — productive uppercut
       15–20       → yellow (grade 50) — getting steep
       >20         → red    (grade 30) — overcooked
     Same scoreColor band mapping as the others. */
  if (metricType === 'attack_angle') {
    if (value < 0) return 30;
    if (value <= 15) return 70;
    if (value <= 20) return 50;
    return 30;
  }
  /* Early Connection + Connection at Impact — symmetric sweet-spot
     around 90° per coach spec:
       <70   → red    (grade 30) — body lagging behind the barrel
       70–80 → yellow (grade 50)
       80–100→ green  (grade 70) — ideal connection zone
       100–110→yellow (grade 50)
       >110  → red    (grade 30) — body too far ahead
     scoreColor maps <40 red / 40-59 yellow / ≥60 green, so the
     30/50/70 returns slot into the correct visual zone. Both keys
     share the same band logic. */
  if (metricType === 'early_connection' || metricType === 'connection_at_impact') {
    if (value < 70 || value > 110) return 30;
    if (value < 80 || value > 100) return 50;
    return 70;
  }
  /* Plane Score + Connection Score + Rotation Score — direct
     scouting-scale mapping per coach spec:
       20–40 → red    — fundamentally off
       40–60 → yellow — average / inconsistent
       60–80 → green  — driving consistent quality
     The raw composite score (0–100 from Blast) is clamped to the
     20-80 scouting band and returned as the grade itself — scoreColor
     then maps <40 → red, 40-59 → yellow, ≥60 → green directly. Values
     below 20 lock at red (clamped to 20), above 80 lock at green
     (clamped to 80). All three keys share this band logic. */
  if (metricType === 'plane_score' || metricType === 'connection_score' || metricType === 'rotation_score') {
    return Math.max(20, Math.min(80, Math.round(value)));
  }
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

/**
 * Normalize a player's stored `positions` CSV into the report-display labels
 * the coach expects on the Cover Page and the PdfPlayerInfoBar:
 *
 *   • Any of 1B / 2B / 3B / SS  → "INF"
 *   • Any of LF / CF / RF       → "OF"
 *   • C                          → "Catcher"
 *   • P                          → "Pitcher"
 *   • Literal INF / OF stay as INF / OF (umbrella codes already in use)
 *   • UTIL                       → "UTIL"
 *
 * Groups are deduped and emitted in a stable, baseball-conventional order
 * (Catcher → INF → OF → UTIL → Pitcher). If a player has any infield-
 * specific code (1B/2B/3B/SS) AND the umbrella INF, the result still
 * collapses to a single "INF" so the cover never reads "SS · INF".
 *
 * Returns the joined string, or "—" when no positions are stored.
 */
export function formatPositionsForDisplay(
  positionsCsv: string | null | undefined,
  separator: string = ' · ',
): string {
  const rawPositions = (positionsCsv || '')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (rawPositions.length === 0) return '—';

  /* Display-side normalization — mirrors `normalizePositionsForSave` so
     the PDF cover/info-bar prints the cleaned-up label even when the
     stored value still contains legacy umbrella codes that haven't been
     re-saved through Edit Profile yet. Without this, a player saved
     long ago as `OF,SS,2B,3B` (legacy umbrella from New Player + later
     specific infield codes) would still print "INF · OF" on the PDF
     until the coach manually re-saves their profile. With this, the
     umbrella `OF` is treated as stale the moment any specific code
     appears, so the PDF prints "INF" immediately. */
  const SPECIFIC = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const hasAnySpecific = rawPositions.some((p) => SPECIFIC.includes(p));
  const positions = hasAnySpecific
    ? rawPositions.filter((p) => p !== 'INF' && p !== 'OF')
    : rawPositions;

  const INFIELD = new Set(['1B', '2B', '3B', 'SS', 'INF']);
  const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF']);

  const labels: string[] = [];
  if (positions.includes('C'))                          labels.push('Catcher');
  if (positions.some((p) => INFIELD.has(p)))            labels.push('INF');
  if (positions.some((p) => OUTFIELD.has(p)))           labels.push('OF');
  if (positions.includes('UTIL'))                       labels.push('UTIL');
  if (positions.includes('P'))                          labels.push('Pitcher');

  // Fallback — if none of the recognized buckets matched (e.g. a
  // custom code), keep the raw values rather than print nothing.
  return labels.length > 0 ? labels.join(separator) : positions.join(separator);
}

/**
 * Normalize a player's positions array before persisting it back to the DB,
 * stripping umbrella codes that have been superseded by ANY specific
 * position.
 *
 * The Edit Profile modal is the specific-codes editor (1B/2B/3B/SS/LF/CF/RF),
 * so whenever a coach saves a profile through it WITH at least one
 * specific position selected, the legacy umbrella codes (INF/OF) are
 * treated as vestigial and removed — the specific codes carry the
 * intent now.
 *
 * Example: a player saved as `OF,SS,2B,3B` (umbrella `OF` left over
 * from the New Player form + specific infield codes added later) becomes
 * `SS,2B,3B` the next time their profile is saved, regardless of whether
 * any specific outfield code was added. Legacy data self-heals as
 * coaches re-save profiles.
 *
 * If a coach genuinely wants a two-way designation, they should select
 * specific positions on both sides (e.g. `SS,LF`) — the umbrella codes
 * are intentionally not preserved alongside specifics because the
 * specific codes are the source of truth in this picker.
 *
 * Umbrellas are only kept when NO specific code is present (e.g. a
 * profile with just `OF` and nothing else stays as `OF`).
 */
export function normalizePositionsForSave(positions: string[]): string[] {
  const cleaned = positions.map((p) => p.trim()).filter(Boolean);
  const SPECIFIC = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const hasAnySpecific = cleaned.some((p) => SPECIFIC.includes(p.toUpperCase()));
  if (!hasAnySpecific) return cleaned;

  return cleaned.filter((p) => {
    const u = p.toUpperCase();
    return u !== 'INF' && u !== 'OF';
  });
}

/** Calculate age strictly from the player's birthDate. Returns a
 *  number (whole years since birth, adjusted for whether the
 *  birthday has passed this calendar year) or `null` when no
 *  birthDate is set. Use `getAge` for the formatted-string
 *  variant the profile telemetry strip displays.
 *
 *  The previous implementation fell back to a `gradYear`-based
 *  estimate (~17, ~18) when birthDate was missing — that was
 *  retired per spec because (a) the estimate could mislead by a
 *  year or more when a player's birth month is far from their
 *  grad cohort's average, and (b) the source of truth should be
 *  the explicit birth date the coach enters in the profile. */
export function getAgeFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** Formatted age for the player profile telemetry strip — wraps
 *  `getAgeFromBirthDate` and returns "—" when no birthday is on
 *  file. Birthday is the only source of truth. */
export function getAge(birthDate: string | null | undefined): string {
  const age = getAgeFromBirthDate(birthDate);
  return age === null ? '—' : String(age);
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
  /* Light theme uses deeper shades: the vivid dark-theme band colors
     (esp. the #EAB308 yellow) fall below ~1.5:1 contrast on the pale
     slate / near-white light surfaces. The dark-theme palette is
     unchanged, and PDF output has its own white-page palette (lib/pdf),
     so this only affects on-screen light theme. */
  const light = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light';
  if (clamped >= 60) return light ? '#15803D' : '#22C55E';   // green = good
  if (clamped >= 40) return light ? '#C2A100' : '#EAB308';   // yellow = average
  return light ? '#C2161B' : '#EF4444';                       // red = bad
}

/** Physical (STRENGTH report) coach grades — three 20-80 sliders that drive
 *  the Player Summary → Tool Grades → Physical bars. Persisted at
 *  `content.physicalGrades` on the STRENGTH report. */
export interface PhysicalGrades { speed: number | null; strength: number | null; mobility: number | null }

export function getPhysicalGrades(report: ReportSummary | null): PhysicalGrades {
  const empty: PhysicalGrades = { speed: null, strength: null, mobility: null };
  if (!report?.content) return empty;
  try {
    const c = JSON.parse(report.content);
    const pg = c?.physicalGrades;
    if (!pg || typeof pg !== 'object') return empty;
    const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { speed: num(pg.speed), strength: num(pg.strength), mobility: num(pg.mobility) };
  } catch { return empty; }
}

/* ── Hitting Snapshot composites (shared so the Player Summary Tool Grades
   and the Hitting Snapshot NEVER drift) ──
   These three lists + the calc below mirror HittingGradeStack in SwingTab.
   The Hitting tab computes them and persists the result on the report
   (content.hittingToolGrades); the Player Summary copies that value. */
export const HIT_SWING_KEYS = ['max_bat_speed', 'avg_bat_speed', 'attack_angle', 'plane_angle', 'time_to_contact', 'power_output'] as const;
export const HIT_QOC_KEYS = ['avg_exit_velo', 'max_exit_velo', 'squared_up_pct', 'smash_factor', 'launch_angle', 'distance'] as const;
export const HIT_MANUAL_KEYS = ['stride', 'stretch', 'posture', 'connection', 'slot', 'core', 'direction', 'timing', 'stability'] as const;

export interface HittingComposites { swing: number | null; qoc: number | null; mechanical: number | null; }

/** The exact three grades the Hitting Snapshot shows (Swing / Quality of
 *  Contact / Mechanical Grades). Swing reads the pre-computed `metricGrades`;
 *  QoC grades the pooled HitTrax+Full Swing override merged over topMetrics;
 *  Mechanical averages the 9 manual coach scores. Mirrors HittingGradeStack. */
export function computeHittingComposites(args: {
  topMetrics: Record<string, { value: number } | undefined>;
  metricGrades: Record<string, number | null>;
  qocOverride?: Record<string, { value: number }> | null;
  manual: Record<string, number | null | undefined>;
}): HittingComposites {
  const { topMetrics, metricGrades, qocOverride, manual } = args;
  const qocSource: Record<string, { value: number } | undefined> = qocOverride
    ? { ...topMetrics, ...qocOverride }
    : topMetrics;
  const swing = averageGrades(HIT_SWING_KEYS.map((k) => metricGrades[k] ?? null));
  const qoc = averageGrades(
    HIT_QOC_KEYS.map((k) => {
      const m = qocSource[k];
      return m ? toScoutingGrade(m.value, k) : null;
    }),
  );
  const mechanical = averageGrades(HIT_MANUAL_KEYS.map((k) => manual[k] ?? null));
  return { swing, qoc, mechanical };
}

/** Read persisted Hitting Snapshot composites off a HITTING report's
 *  content.hittingToolGrades (written by the Hitting tab). Returns null
 *  when the report predates the feature / hasn't been synced yet. */
export function getHittingToolGrades(report: ReportSummary | null): HittingComposites | null {
  if (!report?.content) return null;
  try {
    const g = JSON.parse(report.content)?.hittingToolGrades;
    if (g && typeof g === 'object') {
      return {
        swing: typeof g.swing === 'number' ? g.swing : null,
        qoc: typeof g.qoc === 'number' ? g.qoc : null,
        mechanical: typeof g.mechanical === 'number' ? g.mechanical : null,
      };
    }
  } catch { /* ignore */ }
  return null;
}

export function computeAggregateScores(
  player: { positions: string | null; firstName?: string | null; lastName?: string | null },
  _reports: ReportSummary[],
  _topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
  /* Saved live at-bats for this athlete (any time window the caller
     chooses to fetch). When provided AND containing at least one
     pitch, drives the Hitting → Swing Decision bar instead of the
     legacy CSV-derived metrics. Optional so existing callers (and
     surfaces that don't need Swing Decision detail) can omit it. */
  _liveAtBats?: AtBatDetail[],
  /* When provided, the Hitting section's three Tool Grades bars (Swing /
     Quality of Contact / Mechanical Grades) use these persisted Snapshot
     composites verbatim instead of recomputing — so the Player Summary
     mirrors the Hitting Snapshot exactly. */
  hittingToolGrades?: HittingComposites | null,
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
      /* Coach Grade label rename + Stride add — keys stay the same so
         saved data survives, only the display labels rotate:
           data key `stretch`   → label "Counter"
           data key `core`      → label "Stability"
           data key `stability` → label "Slot"
           data key `slot`      → label "Path"
         `forwardMove` retired from the UI but the type field stays
         so older saved reports still load cleanly. `stride` added as
         a new Coach Grade slot — null on legacy reports, persists
         alongside the other manual scores once a coach grades it. */
      { key: 'stride',      label: 'Stride' },
      { key: 'stretch',     label: 'Counter' },
      { key: 'posture',     label: 'Tilt' },
      { key: 'connection',  label: 'Conn' },
      { key: 'slot',        label: 'Path' },
      { key: 'core',        label: 'Stable' },
      { key: 'direction',   label: 'Direct' },
      { key: 'timing',      label: 'Timing' },
      { key: 'stability',   label: 'Adjust' },
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
    /* Swing Decision now sources from saved Live At-Bats instead
       of the legacy Full-Swing-CSV fb/os/overall metric buckets.
       Pitch outcomes the coach tagged in /live/at-bat are rolled
       up into four percentages (Barrel / Whiff / Chase / In-Zone
       Swing), each converted to a 20-80 scouting grade via the
       same `toScoutingGrade` ranges the CSV path used.

       If `_liveAtBats` is empty or unprovided, the four bars stay
       null (the bar renders as "—") instead of silently falling
       back to CSV data — keeps the source-of-truth honest. */
    const coachSubs: AggregateSubMetric[] = COACH_GRADE_DEFS.map(({ key, label }) => ({
      key: `manual_${key}`,
      label,
      grade: manual[key] ?? undefined,
    }));

    /* Bar scores are the average of every populated sub-metric grade. */
    const swingScore    = averageGrades(swingSubs.map((s) => s.grade ?? null));
    const qocScore      = averageGrades(qocSubs.map((s) => s.grade ?? null));
    const coachScore    = averageGrades(coachSubs.map((s) => s.grade ?? null));

    sections.push({
      key: 'hitting',
      label: 'Hitting',
      color: '#3B82F6',
      bars: [
        { key: 'hit_swing',          label: 'Swing',              score: hittingToolGrades?.swing ?? swingScore,      subMetrics: swingSubs },
        { key: 'hit_qoc',            label: 'Quality of Contact', score: hittingToolGrades?.qoc ?? qocScore,          subMetrics: qocSubs },
        /* 3rd bar = "Mechanical Grades" — sourced from the Hitting report's
           coach swing-mechanics grades (Forward Move / Posture / Slot /
           Direction). These are the same grades the Hitting Snapshot shows
           as "Mechanical Grades" and the profile shows lower as "Coach
           Grades", so we surface them as a single bar (replacing the old
           live-at-bat "Swing Decision" bar, which is often empty). */
        { key: 'hit_coach',          label: 'Mechanical Grades',  score: hittingToolGrades?.mechanical ?? coachScore, subMetrics: coachSubs },
      ],
    });
  }

  // Pitching — any P in positions
  if (isPitcher) {
    /* Pull pitching grades off the most recent PITCHING report so
       the three Tool Grades bars (Mechanics / Movement / Execution)
       roll up from the actual coach inputs. */
    const latestPitching = getLatestReport(_reports, ['PITCHING']);
    const pGrades = getPitchingGrades(latestPitching);

    /* Per-section aggregate helper — averages every populated item
       score within `section.items`. Returns null when no items have
       a score so the bar renders as "—" instead of a misleading 0. */
    const sectionAvgFor = (sectionKey: string): number | null => {
      const section = PITCHING_GRADE_SECTIONS.find((s) => s.key === sectionKey);
      if (!section) return null;
      const scores = section.items
        .map((it) => pGrades[pitchingGradeKey(sectionKey, it.key)]?.score)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    };

    /* Mechanics = average of the 7 delivery-mechanics section
       aggregates (Gather / Arm Path / Direction / LHFS / UHFS /
       Lower Half Rotation / Arm Deceleration). Movement +
       Execution are EXCLUDED from this composite — they each feed
       their own dedicated Tool Grades bar below. */
    const mechanicsSubs: AggregateSubMetric[] = PITCHING_MECHANICS_SECTION_KEYS.map((sectionKey) => {
      const section = PITCHING_GRADE_SECTIONS.find((s) => s.key === sectionKey);
      return {
        key: `mech_${sectionKey}`,
        label: section?.title ?? sectionKey,
        grade: sectionAvgFor(sectionKey) ?? undefined,
      };
    });
    const mechanicsScore = averageGrades(mechanicsSubs.map((s) => s.grade ?? null));

    /* Movement + Execution — single-section bars. The aggregate is
       just that section's own average (one item per section, so the
       average IS the item's score). Sub-metrics list the single
       item so the Summary's per-bar drill-down still works. */
    const movementScore = sectionAvgFor('movement');
    const executionScore = sectionAvgFor('execution');
    const movementSection  = PITCHING_GRADE_SECTIONS.find((s) => s.key === 'movement');
    const executionSection = PITCHING_GRADE_SECTIONS.find((s) => s.key === 'execution');
    const movementSubs: AggregateSubMetric[] = (movementSection?.items ?? []).map((it) => ({
      key: `mov_${it.key}`,
      label: it.label,
      grade: pGrades[pitchingGradeKey('movement', it.key)]?.score ?? undefined,
    }));
    const executionSubs: AggregateSubMetric[] = (executionSection?.items ?? []).map((it) => ({
      key: `exec_${it.key}`,
      label: it.label,
      grade: pGrades[pitchingGradeKey('execution', it.key)]?.score ?? undefined,
    }));

    sections.push({
      key: 'pitching',
      label: 'Pitching',
      color: '#F59E0B',
      bars: [
        { key: 'pit_mechanics', label: 'Mechanics', score: mechanicsScore, subMetrics: mechanicsSubs },
        { key: 'pit_movement',  label: 'Movement',  score: movementScore,  subMetrics: movementSubs },
        { key: 'pit_execution', label: 'Execution', score: executionScore, subMetrics: executionSubs },
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
      color: '#22C55E',
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
      color: '#14B8A6',  /* unified Catching turquoise */
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
      color: '#22C55E',
      bars: [
        { key: 'def_range', label: 'Range', score: null, subMetrics: [] },
        { key: 'def_routes', label: 'Routes', score: null, subMetrics: [] },
        { key: 'def_hands', label: 'Hands', score: null, subMetrics: [] },
      ],
    });
  }

  // Cognition / Vision was retired with the Vision tab — no longer
  // surfaced in Tool Grades since there's no profile tab to drill into.

  // Physical (was "S & C") — always. The three bars are driven by the
  // coach's Speed / Strength / Mobility sliders on the latest STRENGTH report.
  {
    const phys = getPhysicalGrades(getLatestReport(_reports, ['STRENGTH']));
    sections.push({
      key: 'strength',
      label: 'Physical',
      color: '#EF4444',
      bars: [
        { key: 'sc_speed',    label: 'Speed',    score: phys.speed,    subMetrics: [] },
        { key: 'sc_strength', label: 'Strength', score: phys.strength, subMetrics: [] },
        { key: 'sc_mobility', label: 'Mobility', score: phys.mobility, subMetrics: [] },
      ],
    });
  }

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
      sc_strength: 65,
      sc_mobility: 55,
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
      sc_strength: 70,
      sc_mobility: 65,
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
