/**
 * Hitting PDF Report — mirrors the Hitting tab summary page (white theme):
 *   Page 1 — Hitting Snapshot: Swing / Quality of Contact / Coach Diagnosis
 *            grade rows (composite bar + raw-value chip strip), Diagnosis
 *            Notes, Full Swing + Blast Motion KPI grids, Coach Grades cards.
 *   Page 2 — Swing Decision view: Barrel / Whiff / Chase / Approach grade rows.
 */
import React from 'react';
import { Page, View, Text, Svg, Path, Line, Polygon, Rect, Circle, G } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard,
  PdfNotesBox, PdfPlayerInfoBar, PdfDivider,
} from './components';
import {
  METRIC_LABELS, getBadgeLevel, getBadgeText,
  formatHeight, getAge,
  type ManualSwingScores,
} from '@/app/athletes/[id]/helpers';

/* ─── Metric groupings (mirror SwingTab + SwingDecisionTab) ─── */
// Swing row — Max/Avg Bat Speed first, then mechanics in display order:
// Attack, Tilt (plane_angle), TtC, Plane (on-plane efficiency), Connection,
// Rotation. Blast CSV spec additions appended at the end (Plane Score /
// Connection Score / Rotation Score / Early Connection / Connection at Impact)
// so they flow through every PDF surface that iterates this array.
const SWING_METRIC_KEYS = [
  'max_bat_speed', 'avg_bat_speed',
  'attack_angle', 'plane_angle', 'time_to_contact',
  'on_plane_efficiency', 'power_output', 'peak_hand_speed',
  'plane_score', 'connection_score', 'rotation_score',
  'early_connection', 'connection_at_impact',
] as const;
/* Snapshot "Swing" grade-row chip strip — only the 6 in-bubble keys
   that the in-app SwingTab `SWING_GRADEROW_KEYS` shows. The remaining
   Blast metrics (Plane / Connection / Rotation scores, Early Conn,
   Conn at Impact, on-plane efficiency, peak hand speed) all flow
   through the Blast Motion KPI grid further down the page. */
const SWING_GRADEROW_KEYS = [
  'max_bat_speed', 'avg_bat_speed',
  'attack_angle', 'plane_angle', 'time_to_contact', 'power_output',
] as const;
// Quality of Contact — matches the in-app Hitting Snapshot QoC chips
// exactly: Avg EV, Max EV, Squared Up %, Smash, Miss %, Barrel %, LA, Dist.
// (8 metrics — Smash Factor added per the latest spec.)
const QOC_KEYS = [
  'avg_exit_velo', 'max_exit_velo',
  'squared_up_pct', 'smash_factor',
  'full_swing_miss_pct', 'overall_barrel_pct',
  'launch_angle', 'distance',
] as const;
const SCORE_LABEL_OVERRIDES: Record<string, string> = {
  on_plane_efficiency:    'Plane Score',
  power_output:           'Power',
  peak_hand_speed:        'Peak Hand Speed',
  connection_at_contact:  'Connection Score',  // legacy
  rotational_acceleration:'Rotation Score',    // legacy
};
const SHORT_LABELS: Record<string, string> = {
  /* Labels rewritten to match the in-app `SHORT_LABELS` in
     SwingTab.tsx so the PDF report's chip / KPI labels line up
     with what the coach sees on the profile. */
  max_bat_speed: 'Max Bat Speed',
  avg_bat_speed: 'Avg Bat Speed',
  attack_angle: 'Attack Angle',
  plane_angle: 'Vert Bat Angle',
  time_to_contact: 'Time to Contact',
  on_plane_efficiency: 'Plane Score',
  power_output: 'Power (Kwh)',
  peak_hand_speed: 'Hand Speed',
  connection_at_contact: 'Conn',     // legacy alias
  rotational_acceleration: 'Rot',    // legacy alias
  /* Blast CSV spec additions — same spelled-out labels the in-app
     bubble uses. Long ones may wrap in narrow PDF cells; the cell
     renderer handles overflow. */
  plane_score: 'Plane Score',
  connection_score: 'Connection Score',
  rotation_score: 'Rotation Score',
  early_connection: 'Early Connection',
  connection_at_impact: 'Connection at Impact',
  avg_exit_velo: 'Avg EV',
  max_exit_velo: 'Max EV',
  squared_up_pct: 'Sq-Up',
  smash_factor: 'Smash',
  full_swing_miss_pct: 'Miss',
  overall_whiff_pct: 'Whiff',
  overall_barrel_pct: 'Barrel',
  overall_chase_pct: 'Chase',
  overall_in_zone_swing_pct: 'Zone Sw',
  overall_bb_pct: 'Walk',
  overall_k_pct: 'K%',
  fb_barrel_pct: 'FB Bar',
  os_barrel_pct: 'OS Bar',
  fb_whiff_pct: 'FB Wh',
  os_whiff_pct: 'OS Wh',
  fb_chase_pct: 'FB Ch',
  os_chase_pct: 'OS Ch',
  fb_in_zone_swing_pct: 'FB Zn',
  os_in_zone_swing_pct: 'OS Zn',
  launch_angle: 'LA',
  distance: 'Dist',
};

/* ─── Helpers ─── */

/** Piecewise bar fill: 20 → 0%, 40 → 50% (halfway), 80 → 100% (full). */
function gradeToBarPct(grade: number | null): number {
  if (grade === null) return 0;
  if (grade <= 20) return 0;
  if (grade >= 80) return 100;
  if (grade <= 40) return (grade - 20) * 2.5;
  return 50 + (grade - 40) * 1.25;
}

function averageGrades(values: (number | null | undefined)[]): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/** Format raw metric value for chip / KPI display (mirrors formatRawChip in SwingTab).
 *  Per design: Attack Angle, Plane Angle (Tilt), Launch Angle, and
 *  On-Plane Efficiency (Plane Score) drop their unit suffixes — the
 *  metric label already implies the unit. */
function formatRawChip(key: string, value: number): string {
  switch (key) {
    case 'attack_angle':            return value.toFixed(1);
    case 'plane_angle':             return value.toFixed(1);
    case 'max_bat_speed':           return value.toFixed(1);
    case 'avg_bat_speed':           return value.toFixed(1);
    case 'time_to_contact':         return value.toFixed(2);
    case 'on_plane_efficiency':     return value.toFixed(0);
    case 'connection_at_contact':   return value.toFixed(0);
    case 'rotational_acceleration': return value.toFixed(1);
    case 'power_output':            return value.toFixed(2);
    case 'peak_hand_speed':         return value.toFixed(1);
    /* Blast CSV spec additions — integer scores for the *_score keys
       (raw 0-100 Blast composite) and one decimal place for the
       connection-degree readings (Early / At-Impact). */
    case 'plane_score':             return value.toFixed(0);
    case 'connection_score':        return value.toFixed(0);
    case 'rotation_score':          return value.toFixed(0);
    case 'early_connection':        return value.toFixed(1);
    case 'connection_at_impact':    return value.toFixed(1);
    case 'avg_exit_velo':           return value.toFixed(1);
    case 'max_exit_velo':           return value.toFixed(1);
    case 'squared_up_pct':          return `${value.toFixed(0)}%`;
    case 'smash_factor':            return value.toFixed(2);
    case 'full_swing_miss_pct':
    case 'overall_whiff_pct':
    case 'overall_barrel_pct':
    case 'overall_chase_pct':
    case 'overall_in_zone_swing_pct':
    case 'overall_bb_pct':
    case 'overall_k_pct':
    case 'fb_barrel_pct':
    case 'fb_whiff_pct':
    case 'fb_chase_pct':
    case 'fb_in_zone_swing_pct':
    case 'os_barrel_pct':
    case 'os_whiff_pct':
    case 'os_chase_pct':
    case 'os_in_zone_swing_pct':    return `${value.toFixed(0)}%`;
    case 'launch_angle':            return value.toFixed(1);
    case 'distance':                return value.toFixed(0);
    default:                        return value.toFixed(1);
  }
}

function metricToGradeFromRanges(value: number, range: [number, number]): number {
  const [min, max] = range;
  const pct = (value - min) / (max - min);
  const raw = 20 + pct * 60;
  return Math.max(20, Math.min(80, Math.round(raw / 10) * 10));
}

/* ─── Bar + chip strip (matches the screen's GradeRow) ─── */

function PdfGradeRow({
  label, grade, chips, isLast,
}: {
  label: string;
  grade: number | null;
  chips: { key: string; label: string; grade: number | null; display?: string }[];
  /** When true, drops the bottom margin so the last row's spacing inside
   *  the Hitting Grades bubble matches the top label's spacing — keeps
   *  the bubble's interior padding visually symmetric (top label gap ≈
   *  bottom chip gap). */
  isLast?: boolean;
}) {
  const fillPct = gradeToBarPct(grade);
  const tone =
    grade === null      ? colors.cardBorder
    : grade >= 60       ? colors.elite        // green = good
    : grade >= 40       ? colors.aboveAvg     // yellow = average
    : colors.developing;                       // red = bad
  return (
    <View style={{ marginBottom: isLast ? 0 : 10 }}>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 4,
      }}>
        <Text style={{
          fontSize: 8, fontFamily: 'Helvetica-Bold',
          /* Grade-row title (SWING / QUALITY OF CONTACT / COACH DIAGNOSIS)
             — black to match the other body labels. */
          color: colors.black, letterSpacing: 1,
        }}>
          {label.toUpperCase()}
        </Text>
        <Text style={{
          fontSize: 14, fontFamily: 'Helvetica-Bold', color: tone,
        }}>
          {grade ?? '—'}
        </Text>
      </View>
      {/* Bar with halfway tick */}
      <View style={{
        position: 'relative',
        height: 8, borderRadius: 4,
        backgroundColor: colors.cardBg,
        border: `0.5px solid ${colors.cardBorder}`,
        overflow: 'hidden',
        marginBottom: 5,
      }}>
        <View style={{
          height: '100%', width: `${fillPct}%`,
          backgroundColor: tone, borderRadius: 4,
        }} />
        <View style={{
          position: 'absolute', top: 0, bottom: 0, left: '50%',
          width: 0.5, backgroundColor: colors.textMuted, opacity: 0.4,
        }} />
      </View>
      {/* Chip strip — every chip's label MUST fit on a single line so
          every number lines up at the same y-position across the row.
          We wrap the label in a fixed-height row and force single-line
          rendering with `wrap={false}`; the font size is dialed down
          enough that the longest label ("Max Bat", "Posture", "Timing")
          fits within the chip's flex-share of the row width. */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {chips.map(c => {
          const ct =
            c.grade === null    ? colors.cardBorder
            : c.grade >= 60     ? colors.elite        // green
            : c.grade >= 40     ? colors.aboveAvg     // yellow
            : colors.developing;                       // red
          return (
            <View key={c.key} style={{
              flex: 1,
              backgroundColor: colors.cardBg,
              border: `0.5px solid ${colors.cardBorder}`,
              borderRadius: 4,
              padding: 4,
              alignItems: 'center',
            }}>
              {/* Fixed-height label row — guarantees the value below
                  lands at the same y on every chip, even if a label is
                  edge-of-fit. wrap={false} also prevents react-pdf from
                  breaking words at internal spaces ("Max Bat" stays on
                  one line). */}
              <View style={{
                height: 9,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 2,
              }}>
                <Text
                  wrap={false}
                  style={{
                    fontSize: 5.5, fontFamily: 'Helvetica-Bold',
                    color: colors.black,
                    textAlign: 'center',
                  }}
                >
                  {c.label}
                </Text>
              </View>
              <Text style={{
                fontSize: 9, fontFamily: 'Helvetica-Bold', color: ct,
              }}>
                {c.display ?? (c.grade ?? '—')}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ─── Coach Grade card (single-stat cards for the 8 manual grades) ─── */

function PdfCoachGradeCard({
  label, value, options,
}: {
  label: string;
  value: number | null;
  /** Selected option tags from the in-app multi-select. Renders a row of
   *  small chips beneath the bar so PDF readers see the same checkpoint
   *  labels the coach selected on screen. */
  options?: string[];
}) {
  /* Coach grade color follows the same 3-band scoreColor scale as the
     in-app chips: ≥60 green, 40-59 yellow, <40 red. The previous logic
     had a teal (blue) tier at 40-49 which made low-side coach grades
     read as blue instead of red — fixed by collapsing into three bands. */
  const tone =
    value === null   ? colors.cardBorder
    : value >= 60    ? colors.elite       // green
    : value >= 40    ? colors.aboveAvg    // yellow
    : colors.developing;                  // red
  const opts = (options || []).filter(Boolean);
  return (
    <View style={{
      width: '23%',
      backgroundColor: colors.cardBg,
      border: `1px solid ${colors.cardBorder}`,
      borderRadius: 6,
      padding: 8,
      marginBottom: 8,
    }}>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 4,
      }}>
        <Text style={{
          fontSize: 7, fontFamily: 'Helvetica-Bold',
          /* Coach grade label (Counter / Stride / Posture / Stability /
             Slot / Path / Direction / Timing) — black to match the rest
             of the body labels. */
          color: colors.black, letterSpacing: 0.5,
        }}>
          {label.toUpperCase()}
        </Text>
        <Text style={{
          fontSize: 14, fontFamily: 'Helvetica-Bold', color: tone,
        }}>
          {value ?? '—'}
        </Text>
      </View>
      {/* Score bar removed per spec — Coach Grade cards now read just
          like the Pitching mechanical-grade cards: a numeric score in
          the corner + the selected option chips below, no filled bar
          underneath. Color is still carried by the number itself. */}
      {opts.length > 0 && (
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: 3,
          marginTop: 6,
        }}>
          {opts.map((o, i) => (
            <View key={i} style={{
              backgroundColor: colors.tableBg,
              border: `0.5px solid ${colors.cardBorder}`,
              borderRadius: 8,
              paddingHorizontal: 5, paddingVertical: 1.5,
            }}>
              <Text style={{ fontSize: 6.2, color: colors.black, fontFamily: 'Helvetica-Bold' }}>
                {o}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ─── Public type ─── */

export interface SprayDot {
  angle: number;
  distance: number;
  exitVelo?: number;
  /** HitTrax categorical color: 1=GB (red), 2=LD (blue), 3=FB (green).
   *  When set, overrides the EV-based color ramp so HitTrax dots in the
   *  PDF read the same as on screen. */
  ballTypeCode?: number;
}

export interface HittingPdfData {
  player: any;
  /** topMetrics extended with the synthetic full_swing_miss_pct reading. */
  topMetrics: Record<string, { value: number; unit: string }>;
  /** Per-key 20-80 grades for the swing mechanics inputs. */
  metricGrades: Record<string, number | null>;
  manual: ManualSwingScores;
  /** Multi-select option tags chosen alongside each Coach Grade
   *  (Stuck/Stable/Drift, Tall/Hinged, Steep/Flat/Uphill, etc.). When
   *  present, each Coach Grade card prints its selected tags so the PDF
   *  matches what the coach saw on screen. Optional for backwards
   *  compatibility with older saved reports. */
  manualOptions?: Partial<Record<keyof ManualSwingScores, string[]>>;
  diagnosisNotes: string;
  /** Each batted ball — angle (deg, 0=center, ±=left/right), distance (ft), optional EV. */
  sprayDots: SprayDot[];
  swingNotes: string | null;
  reportDate: string;
  /** HitTrax-source aggregates (avg/max EV, mean LA, mean Dist). The HitTrax
   *  section only renders when this is non-empty — mirroring the in-app
   *  profile where the section auto-hides without source data. */
  hittraxValues?: Record<string, { value: number; unit: string }>;
  /** Full-Swing-source aggregates. Same auto-hide behavior. */
  fullswingValues?: Record<string, { value: number; unit: string }>;
}

/* ─────────────────────────────────────────────────────────────────────────────
   PdfSprayChart — static SVG snapshot of the spray chart, white-paper styled.
   Mirrors SprayChartView's geometry: home plate at bottom-center, ±45° foul
   rails, distance arcs at 120 / 200 / 280 / 360 ft, dots colored by EV.
   ─────────────────────────────────────────────────────────────────────────── */
function PdfSprayChart({ dots }: { dots: SprayDot[] }) {
  const W = 520, H = 460;
  const cx = W / 2, cy = H - 24;
  const maxDist = 420;
  const scale = (H - 70) / maxDist;
  const toXY = (angleDeg: number, dist: number): [number, number] => {
    const rad = ((90 - angleDeg) * Math.PI) / 180;
    const r = dist * scale;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  const distArcs = [120, 200, 280, 360];
  const r45 = Math.cos(Math.PI / 4); // = sin too

  // Dot color:
  //   • HitTrax dots (have ballTypeCode): GB red / LD blue / FB green —
  //     mirrors the in-app SprayChartView's HitTrax mode.
  //   • Otherwise (Full Swing dots): EV-based red/yellow/green ramp.
  const dotColor = (d: SprayDot) => {
    if (d.ballTypeCode != null) {
      if (d.ballTypeCode === 1) return '#EF4444'; // GB
      if (d.ballTypeCode === 2) return '#3B82F6'; // LD
      if (d.ballTypeCode === 3) return '#22C55E'; // FB
    }
    const ev = d.exitVelo;
    if (ev === undefined) return '#94A3B8';
    if (ev >= 95) return '#16A34A';
    if (ev >= 85) return '#CA8A04';
    return '#DC2626';
  };

  /* viewBox is cropped from the top so the action fan (which tops out
     around y≈200 at the d=360 arc) sits near the top of the bubble
     instead of sinking to the bottom half. We chop the top 130 units of
     empty sky, leaving a small breathing margin above the deepest arc. */
  const cropTop = 130;
  const viewH = H - cropTop;
  return (
    <Svg viewBox={`0 ${cropTop} ${W} ${viewH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      {/* outer field background */}
      <Rect x={0} y={cropTop} width={W} height={viewH} fill={colors.cardBg} />

      {/* distance arcs */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = cx - r * r45, ly = cy - r * r45;
        const rx = cx + r * r45, ry = cy - r * r45;
        return (
          <G key={d}>
            <Path d={`M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`}
              fill="none" stroke={colors.cardBorder} strokeWidth={0.7} strokeDasharray="3 4" />
          </G>
        );
      })}

      {/* foul rails */}
      <Line x1={cx} y1={cy} x2={cx - maxDist * scale * r45} y2={cy - maxDist * scale * r45}
        stroke={colors.textMuted} strokeWidth={1.1} />
      <Line x1={cx} y1={cy} x2={cx + maxDist * scale * r45} y2={cy - maxDist * scale * r45}
        stroke={colors.textMuted} strokeWidth={1.1} />

      {/* bases (90 ft × 0.72 stylized) */}
      {(() => {
        const baseDist = 90 * scale * 0.72;
        const bases: [number, number][] = [
          [cx, cy - baseDist],
          [cx - baseDist * 0.7, cy - baseDist * 0.5],
          [cx + baseDist * 0.7, cy - baseDist * 0.5],
        ];
        return bases.map(([bx, by], i) => {
          const half = 4;
          const pts = `${bx},${by - half} ${bx + half},${by} ${bx},${by + half} ${bx - half},${by}`;
          return <Polygon key={i} points={pts} fill={colors.textMuted} stroke={colors.navy} strokeWidth={0.5} />;
        });
      })()}

      {/* home plate */}
      <Polygon
        points={`${cx},${cy - 6} ${cx + 6},${cy - 2} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4} ${cx - 6},${cy - 2}`}
        fill={colors.navy} stroke={colors.navy} strokeWidth={0.5} />

      {/* dots */}
      {dots.map((d, i) => {
        const [x, y] = toXY(d.angle, d.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const fill = dotColor(d);
        return (
          <Circle key={i} cx={x} cy={y} r={3.5} fill={fill}
            stroke="rgba(0,0,0,0.4)" strokeWidth={0.4} />
        );
      })}

      {/* count caption */}
      <Polygon points="0,0 0,0 0,0" fill="transparent" />
    </Svg>
  );
}

/* ─── Document body ─── */

export function HittingReportPages({ data }: { data: HittingPdfData }) {
  const {
    player, topMetrics, metricGrades, manual, diagnosisNotes, sprayDots,
    swingNotes, reportDate,
    hittraxValues, fullswingValues,
  } = data;
  // Per-source presence flags so each section auto-hides exactly the way
  // the in-app profile does — HitTrax block only when HitTrax CSVs have been
  // ingested, Full Swing block only when Full Swing CSVs have been ingested.
  const SOURCE_KEYS: readonly string[] = ['avg_exit_velo', 'max_exit_velo', 'launch_angle', 'distance'];
  const hasHitTrax  = !!hittraxValues  && SOURCE_KEYS.some(k => hittraxValues[k]  !== undefined);
  const hasFullSwing = !!fullswingValues && SOURCE_KEYS.some(k => fullswingValues[k] !== undefined);
  const hasBlast = SWING_METRIC_KEYS.some(k => topMetrics[k] !== undefined);
  const hasCoachGrades = (Object.values(manual) as (number | null)[]).some(v => typeof v === 'number');

  // ── Build chip data for each grade row ────────────────────────────────────
  /* Snapshot Swing row uses the trimmed SWING_GRADEROW_KEYS so only the
     6 core in-bubble metrics chip-render here. The full SWING_METRIC_KEYS
     set still drives the Blast Motion KPI grid further down the page. */
  const swingChips = SWING_GRADEROW_KEYS.map(k => {
    const m = topMetrics[k];
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade: metricGrades[k] ?? null,
      display: m ? formatRawChip(k, m.value) : undefined,
    };
  });
  const swingComposite = averageGrades(swingChips.map(c => c.grade));

  const qocChips = QOC_KEYS.map(k => {
    const m = topMetrics[k];
    const grade = m ? metricToGradeFromMetric(k, m.value) : null;
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade,
      display: m ? formatRawChip(k, m.value) : undefined,
    };
  });
  const qocComposite = averageGrades(qocChips.map(c => c.grade));

  /* Coach Diagnosis chip labels — data keys unchanged so existing
     reports keep their saved grades; display labels rotate per the
     latest spec, mirroring the in-app `diagnosisChips` in SwingTab:
       forwardMove → retired (chip removed entirely)
       stretch     → "Counter"
       stability   → "Slot"
       core        → "Stability"
       slot        → "Path"
     The `manual.forwardMove` value still persists on the
     ManualSwingScores type — only the chip render is gone. */
  const diagnosisChips = [
    { key: 'stride',      label: 'Stride',     grade: manual.stride },
    { key: 'stretch',     label: 'Counter',    grade: manual.stretch },
    { key: 'posture',     label: 'Posture',    grade: manual.posture },
    { key: 'core',        label: 'Stability',  grade: manual.core },
    { key: 'slot',        label: 'Path',       grade: manual.slot },
    { key: 'direction',   label: 'Direction',  grade: manual.direction },
    { key: 'timing',      label: 'Timing',     grade: manual.timing },
    { key: 'stability',   label: 'Adjust', grade: manual.stability },
  ];
  const diagnosisComposite = averageGrades(diagnosisChips.map(c => c.grade));

  // ── Decision groups ──────────────────────────────────────────────────────
  const buildGroup = (keys: string[]) => {
    const chips = keys.map(k => {
      const m = topMetrics[k];
      const grade = m ? metricToGradeFromMetric(k, m.value) : null;
      return {
        key: k,
        label: SHORT_LABELS[k] || k,
        grade,
        display: m ? formatRawChip(k, m.value) : undefined,
      };
    });
    return { chips, composite: averageGrades(chips.map(c => c.grade)) };
  };
  /* Same pitch-family bundling as the in-app Swing-Decision sub-tab:
       Fastballs / Offspeed / Overall (each = barrel + whiff + chase) +
       Decision (zone-swing rates + overall chase + K%). */
  const fastballGroup = buildGroup(['fb_barrel_pct', 'fb_whiff_pct', 'fb_chase_pct']);
  const offspeedGroup = buildGroup(['os_barrel_pct', 'os_whiff_pct', 'os_chase_pct']);
  const overallGroup  = buildGroup(['overall_barrel_pct', 'overall_whiff_pct', 'overall_chase_pct']);
  const decisionGroup = buildGroup(['fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct', 'overall_chase_pct', 'overall_k_pct']);
  const hasDecisionData = [...fastballGroup.chips, ...offspeedGroup.chips, ...overallGroup.chips, ...decisionGroup.chips]
    .some(c => c.grade !== null);

  return (
    <>
      {/* ── Page 1: Hitting Snapshot (Swing view) ──
          Landscape LETTER so this page (PDF page 2) and its sibling
          data-sections page (PDF page 3, created by the `<View break>`
          below) share the same 11" × 8.5" canvas as the Cover Page.
          The top `PdfPlayerInfoBar` (black bar with the player's name
          + vitals) was retired here — the Cover Page already shows
          that information prominently on PDF page 1, so repeating
          it at the top of page 2 was redundant and burned vertical
          budget the snapshot needed. */}
      <Page size="LETTER" orientation="landscape" style={s.page}>
        {/* SNAPSHOT ROW — Spray Chart (left) + Hitting Grades bubble (right).
            Tighter gap + reduced marginBottom so the notes block below
            has more room to fit on page 2. */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'stretch',           // equalize bubble heights so the
                                           // chart's bottom border lines up
                                           // with the Hitting Grades bottom
          gap: 8,
          marginBottom: 8,
        }}>
          {/* Spray Chart panel — left.
              Column flexbox so the inner chart View can claim the
              remaining vertical space (flex: 1) and the bubble's
              bottom border matches the Hitting Grades bubble next to
              it via the parent row's `alignItems: 'stretch'`. */}
          <View style={{
            width: '46%',
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8,
            padding: 6,
            flexDirection: 'column',
          }}>
            <Text style={{
              fontSize: 8, fontFamily: 'Helvetica-Bold',
              color: colors.black, letterSpacing: 1.4, marginBottom: 4,
            }}>
              SPRAY CHART
            </Text>
            {/* Chart fills the remaining height of the bubble (flex: 1)
                so the bubble's bottom border lines up with the Hitting
                Grades bubble. The SVG inside uses preserveAspectRatio
                so the cropped viewBox keeps its shape inside this box. */}
            <View style={{ flex: 1, width: '100%' }}>
              <PdfSprayChart dots={sprayDots} />
            </View>
            {/* Caption removed per design — the chart speaks for itself
                without the "X batted balls · EV color legend" footer. */}
          </View>

          {/* Hitting Grades bubble — right */}
          <View style={{
            flex: 1,
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8,
            padding: 8,
          }}>
            <Text style={{
              fontSize: 8, fontFamily: 'Helvetica-Bold',
              color: colors.black, letterSpacing: 1.4, marginBottom: 6,
            }}>
              HITTING GRADES
            </Text>
            <PdfGradeRow label="Swing"              grade={swingComposite}     chips={swingChips} />
            <PdfGradeRow label="Quality of Contact" grade={qocComposite}       chips={qocChips} />
            {/* `isLast` drops the last row's bottom margin so the
                Stride chip strip sits the same distance from the
                bubble's bottom border as the HITTING GRADES title sits
                from the top border — symmetric interior padding. */}
            <PdfGradeRow label="Mechanical Grades"  grade={diagnosisComposite} chips={diagnosisChips} isLast />
          </View>
        </View>

        {/* Diagnosis Notes — flows directly under the spray-chart /
            hitting-grades row on page 2. */}
        {diagnosisNotes && (
          <PdfNotesBox label="DIAGNOSIS NOTES" text={diagnosisNotes} />
        )}

        {/* Hard page break before the data sections — Coach Grades /
            Full Swing / HitTrax / Blast Motion ALWAYS start on page 3.
            That gives the snapshot + notes the entirety of page 2 to
            themselves, so the notes don't get squeezed by the data
            sections trying to share the page. */}
        <View break>

        {/* Coach Grades cards — only render when at least one manual score is set,
            mirroring the in-app profile's per-section auto-hide. */}
        {hasCoachGrades && (
          <>
            <PdfSectionHeader title="Coach Grades" subtitle="20 - 80 Scale" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {/* Coach Grade cards — order + labels mirror the
                  in-app Coach Grades column tables in SwingTab:
                    "Forward Move" card retired (chip removed app-wide)
                    "Stretch" → "Counter"
                    manual.stability → "Slot"
                    manual.core      → "Stability"
                    manual.slot      → "Path"
                  Data keys are unchanged so saved scores stay attached. */}
              <PdfCoachGradeCard label="Stride"     value={manual.stride}      options={data.manualOptions?.stride} />
              <PdfCoachGradeCard label="Counter"    value={manual.stretch}     options={data.manualOptions?.stretch} />
              <PdfCoachGradeCard label="Posture"    value={manual.posture}     options={data.manualOptions?.posture} />
              <PdfCoachGradeCard label="Stability"  value={manual.core}        options={data.manualOptions?.core} />
              <PdfCoachGradeCard label="Path"       value={manual.slot}        options={data.manualOptions?.slot} />
              <PdfCoachGradeCard label="Direction"  value={manual.direction}   options={data.manualOptions?.direction} />
              <PdfCoachGradeCard label="Timing"     value={manual.timing}      options={data.manualOptions?.timing} />
              <PdfCoachGradeCard label="Adjust" value={manual.stability} options={data.manualOptions?.stability} />
            </View>
          </>
        )}

        {/* Full Swing — only render when Full-Swing-source data exists.
            EV / LA / Dist values come ONLY from fullswingValues so HitTrax
            data never leaks in via topMetrics. Squared Up % and Barrel %
            pull from topMetrics since those are Full-Swing-CSV-only
            metrics that aren't in the per-source override. */}
        {hasFullSwing && (() => {
          const FULLSWING_ONLY_KEYS = new Set([
            'avg_exit_velo', 'max_exit_velo', 'launch_angle', 'distance',
          ]);
          const fsResolvePdf = (k: string) => {
            if (fullswingValues && fullswingValues[k]) return fullswingValues[k];
            if (FULLSWING_ONLY_KEYS.has(k)) return undefined;
            return topMetrics[k];
          };
          return (
            <>
              <PdfSectionHeader title="Full Swing" subtitle="Outcome metrics — Full Swing CSV" />
              <View style={s.kpiGrid}>
                {QOC_KEYS.map(k => {
                  const m = fsResolvePdf(k);
                  const label = METRIC_LABELS[k] || k;
                  if (!m) return <PdfKpiCard key={k} label={label} value="—" badge="No data" badgeLevel="teal" />;
                  /* Color the value via the same grade the Hitting Grades
                     chip uses (metricToGradeFromMetric → 3-band map) so
                     the KPI card and chip agree. Falls back to the
                     vendor THRESHOLDS only when no grade range exists. */
                  const grade = metricToGradeFromMetric(k, m.value);
                  const level = grade !== null
                    ? (grade >= 60 ? 'high' : grade >= 40 ? 'mid' : 'low')
                    : getBadgeLevel(k, m.value);
                  return (
                    <PdfKpiCard
                      key={k}
                      label={label}
                      value={formatRawChip(k, m.value)}
                      badge={grade !== null ? `Grade ${grade}` : (getBadgeText(level) || undefined)}
                      badgeLevel={level}
                    />
                  );
                })}
              </View>
            </>
          );
        })()}

        {/* HitTrax — separate from Full Swing in the PDF the same way the
            profile keeps the two sections apart. Renders only when HitTrax
            CSVs have been ingested. The "Grade XX" badge has been removed
            from this section per design — the value text already
            color-codes by grade band, so the badge was redundant noise. */}
        {hasHitTrax && (
          <>
            <PdfSectionHeader title="HitTrax" subtitle="HitTrax Metrics" />
            <View style={s.kpiGrid}>
              {(['avg_exit_velo', 'max_exit_velo', 'launch_angle', 'distance'] as const).map(k => {
                const m = hittraxValues && hittraxValues[k];
                /* HitTrax-only label overrides — the values in this
                   section are session means, so the cards explicitly
                   say "AVG" instead of inheriting the generic METRIC_LABELS
                   strings used elsewhere ("Launch Angle" / "Distance"). */
                const HITTRAX_OVERRIDES: Record<string, string> = {
                  launch_angle: 'AVG Launch Angle',
                  distance:     'AVG Distance',
                };
                const label = HITTRAX_OVERRIDES[k] || METRIC_LABELS[k] || k;
                if (!m) return <PdfKpiCard key={k} label={label} value="—" badgeLevel="teal" />;
                /* Use the chip's grade-band logic so HitTrax KPI value
                   colors agree with the corresponding Hitting Grades
                   chips (Launch Angle was reading yellow while the chip
                   read green because THRESHOLDS used different cutoffs). */
                const grade = metricToGradeFromMetric(k, m.value);
                const level = grade !== null
                  ? (grade >= 60 ? 'high' : grade >= 40 ? 'mid' : 'low')
                  : getBadgeLevel(k, m.value);
                return (
                  <PdfKpiCard
                    key={k}
                    label={label}
                    value={formatRawChip(k, m.value)}
                    badgeLevel={level}
                  />
                );
              })}
            </View>
          </>
        )}

        {/* Blast Motion — only render when at least one Blast-source mechanic
            has been ingested. Filters to keys WITH data so the section
            mirrors the in-app Blast Motion bubble (empty metrics don't
            print as "—" cards in the PDF). Labels pull from SHORT_LABELS
            (same dictionary the profile chip uses) so report labels match
            profile labels exactly. */}
        {hasBlast && (
          <>
            <PdfSectionHeader title="Blast Motion" subtitle="Swing Metrics" />
            <View style={s.kpiGrid}>
              {SWING_METRIC_KEYS.filter(k => !!topMetrics[k]).map(k => {
                const m = topMetrics[k]!;
                const label = SHORT_LABELS[k] || SCORE_LABEL_OVERRIDES[k] || METRIC_LABELS[k] || k;
                /* Same grade-band → level mapping as HitTrax above so
                   Max Bat Speed (and the other Blast metrics) read the
                   same color in the KPI card as in the Hitting Grades
                   chip. THRESHOLDS-based getBadgeLevel had different
                   cutoffs and was painting cards the wrong color. */
                const grade = metricToGradeFromMetric(k, m.value);
                const level = grade !== null
                  ? (grade >= 60 ? 'high' : grade >= 40 ? 'mid' : 'low')
                  : getBadgeLevel(k, m.value);
                return (
                  <PdfKpiCard
                    key={k}
                    label={label}
                    value={formatRawChip(k, m.value)}
                    badgeLevel={level}
                  />
                );
              })}
            </View>
          </>
        )}

        {/* Second notes block (formerly under Blast Motion) removed —
            the same notes already render once under the Spray Chart as
            "DIAGNOSIS NOTES". A single appearance keeps the report from
            duplicating the same paragraph on the same page. */}

        </View>{/* end of page-3 data sections wrapper */}

        {/* PageFooter removed per design — no "Hitting Assessment" /
            "Generated MM DD" labels in the bottom corners. */}
      </Page>

      {/* ── Page 2: At-Bat Results (Swing Decision data) ──
          Same landscape LETTER canvas as the Cover Page + Snapshot pages
          so the entire deck reads in a single orientation. */}
      {hasDecisionData && (
        <Page size="LETTER" orientation="landscape" style={s.page}>
          <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

          <View style={{
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}>
            <Text style={{
              fontSize: 9, fontFamily: 'Helvetica-Bold',
              color: colors.black, letterSpacing: 1.5, marginBottom: 8,
            }}>
              AT-BAT RESULTS · SWING DECISION
            </Text>
            <PdfGradeRow label="Fastballs" grade={fastballGroup.composite} chips={fastballGroup.chips} />
            <PdfGradeRow label="Offspeed"  grade={offspeedGroup.composite} chips={offspeedGroup.chips} />
            <PdfGradeRow label="Overall"   grade={overallGroup.composite}  chips={overallGroup.chips} />
            <PdfGradeRow label="Decision"  grade={decisionGroup.composite} chips={decisionGroup.chips} />
          </View>

          {/* PageFooter removed per design. */}
        </Page>
      )}
    </>
  );
}

/* Local helper that mirrors metricToGrade in helpers.ts but uses the metric
   key directly to look up its GRADE_RANGES range — avoids passing topMetrics. */
function metricToGradeFromMetric(key: string, value: number): number | null {
  /* Distance uses strict band thresholds (NOT a linear range) to match
     the in-app helpers.ts toScoutingGrade special-case:
       <200 ft  → grade 30 (red)
       200–300  → grade 50 (yellow)
       >300 ft  → grade 70 (green)
     scoreColor bands the result red/yellow/green at <40 / 40-59 / ≥60,
     so 30/50/70 land cleanly inside each color. Without this branch the
     PDF was using a linear [250, 450] range — 214 ft mapped to grade 20
     (red) when it should be yellow. */
  if (key === 'distance') {
    if (value < 200) return 30;
    if (value <= 300) return 50;
    return 70;
  }
  /* Plane Angle / Tilt — Blast CSV imports as POSITIVE values; legacy
     manual entries may be negative. Use absolute value so both grade
     correctly:
       0–10  → red    (30)
       10–20 → yellow (50)
       20–40 → green  (70)
       >40   → red    (30) */
  if (key === 'plane_angle') {
    const v = Math.abs(value);
    if (v < 10) return 30;
    if (v < 20) return 50;
    if (v <= 40) return 70;
    return 30;
  }
  /* Attack Angle — sweet-spot bands match the in-app:
       <0    → red    (30)
       0-15  → green  (70)
       15-20 → yellow (50)
       >20   → red    (30) */
  if (key === 'attack_angle') {
    if (value < 0) return 30;
    if (value <= 15) return 70;
    if (value <= 20) return 50;
    return 30;
  }
  /* Early Connection / Connection at Impact — degree readings with a
     symmetric sweet-spot at 90°. Mirrors helpers.ts toScoutingGrade:
       <70 or >110  → red    (30)
       70-80, 100-110 → yellow (50)
       80-100       → green  (70)
     scoreColor then bands the 30/50/70 results into the correct
     red/yellow/green chip colors. */
  if (key === 'early_connection' || key === 'connection_at_impact') {
    if (value < 70 || value > 110) return 30;
    if (value < 80 || value > 100) return 50;
    return 70;
  }
  /* Plane Score / Connection Score / Rotation Score — raw 0-100
     composite scores from Blast. Clamp to 20-80 and return the value
     itself as the grade so scoreColor's <40/40-59/≥60 bands map to:
       20-40 red, 40-60 yellow, 60-80 green (matches the user spec). */
  if (key === 'plane_score' || key === 'connection_score' || key === 'rotation_score') {
    return Math.max(20, Math.min(80, Math.round(value)));
  }
  // GRADE_RANGES is exported from helpers but importing here would create a
  // circular path. Inline the few we need:
  const RANGES: Record<string, [number, number]> = {
    attack_angle: [-5, 18],
    plane_angle: [10, 38],
    /* Bat speed metrics — were missing from this map, so the chip's
       grade computed to null and the value text rendered in the
       "no grade" cardBorder color (white on a white card). */
    max_bat_speed: [55, 85],
    avg_bat_speed: [50, 80],
    bat_speed: [50, 85],
    time_to_contact: [0.20, 0.13],
    /* Plane Score / Connection / Rotation use a flat 20-80 raw band so
       the chip color flips at 40 (red→yellow) and 60 (yellow→green) —
       matches the user-spec "20-40 red, 40-60 yellow, 60-80 green" and
       the GRADE_RANGES values in helpers.ts. */
    on_plane_efficiency: [20, 80],
    connection_at_contact: [20, 80],   // legacy
    rotational_acceleration: [20, 80], // legacy
    /* Power (Blast column O, kW) — 3 kW grade 20 → 7 kW grade 80. */
    power_output: [3, 7],
    /* Peak Hand Speed (mph). */
    peak_hand_speed: [18, 28],
    avg_exit_velo: [65, 100],
    /* Same fix for max_exit_velo — without this entry the Max EV chip's
       grade was always null, so its value text was white. */
    max_exit_velo: [70, 110],
    squared_up_pct: [10, 45],
    smash_factor: [0.8, 1.5],
    full_swing_miss_pct: [40, 5],
    overall_whiff_pct: [35, 12],
    overall_barrel_pct: [5, 25],
    overall_chase_pct: [42, 12],
    overall_in_zone_swing_pct: [40, 78],
    overall_bb_pct: [4, 16],
    overall_k_pct: [35, 8],
    fb_barrel_pct: [5, 30],
    os_barrel_pct: [3, 25],
    fb_whiff_pct: [35, 10],
    os_whiff_pct: [40, 15],
    fb_chase_pct: [40, 10],
    os_chase_pct: [45, 15],
    fb_in_zone_swing_pct: [40, 80],
    os_in_zone_swing_pct: [40, 75],
    launch_angle: [5, 22],
    distance: [250, 450],
  };
  const r = RANGES[key];
  if (!r) return null;
  return metricToGradeFromRanges(value, r);
}
