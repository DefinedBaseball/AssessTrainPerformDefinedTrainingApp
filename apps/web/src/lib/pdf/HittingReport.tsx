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
const SWING_METRIC_KEYS = [
  'attack_angle', 'plane_angle', 'avg_bat_speed', 'time_to_contact',
  'on_plane_efficiency', 'connection_at_contact', 'rotational_acceleration',
] as const;
const QOC_KEYS = [
  'avg_exit_velo', 'squared_up_pct', 'smash_factor',
  'full_swing_miss_pct', 'overall_barrel_pct',
  'launch_angle', 'distance',
] as const;
const SCORE_LABEL_OVERRIDES: Record<string, string> = {
  on_plane_efficiency:    'Plane Score',
  connection_at_contact:  'Connection Score',
  rotational_acceleration:'Rotation Score',
};
const SHORT_LABELS: Record<string, string> = {
  attack_angle: 'Attack',
  plane_angle: 'Tilt',
  avg_bat_speed: 'Bat Spd',
  time_to_contact: 'TtC',
  on_plane_efficiency: 'Plane',
  connection_at_contact: 'Conn',
  rotational_acceleration: 'Rot',
  avg_exit_velo: 'Avg EV',
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

/** Format raw metric value for chip / KPI display (mirrors formatRawChip in SwingTab). */
function formatRawChip(key: string, value: number): string {
  switch (key) {
    case 'attack_angle':            return `${value.toFixed(1)} deg`;
    case 'plane_angle':             return `${value.toFixed(1)} deg`;
    case 'avg_bat_speed':           return value.toFixed(1);
    case 'time_to_contact':         return value.toFixed(2);
    case 'on_plane_efficiency':     return `${value.toFixed(0)}%`;
    case 'connection_at_contact':   return value.toFixed(0);
    case 'rotational_acceleration': return value.toFixed(1);
    case 'avg_exit_velo':           return value.toFixed(1);
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
    case 'launch_angle':            return `${value.toFixed(1)} deg`;
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
  label, grade, chips,
}: {
  label: string;
  grade: number | null;
  chips: { key: string; label: string; grade: number | null; display?: string }[];
}) {
  const fillPct = gradeToBarPct(grade);
  const tone =
    grade === null      ? colors.cardBorder
    : grade >= 60       ? colors.elite        // green = good
    : grade >= 40       ? colors.aboveAvg     // yellow = average
    : colors.developing;                       // red = bad
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 4,
      }}>
        <Text style={{
          fontSize: 8, fontFamily: 'Helvetica-Bold',
          color: colors.textMuted, letterSpacing: 1,
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
      {/* Chip strip */}
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
              <Text style={{
                fontSize: 6, fontFamily: 'Helvetica-Bold',
                color: colors.textMuted, marginBottom: 2,
              }}>
                {c.label}
              </Text>
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

function PdfCoachGradeCard({ label, value }: { label: string; value: number | null }) {
  const tone =
    value === null   ? colors.cardBorder
    : value >= 60    ? colors.elite
    : value >= 50    ? colors.aboveAvg
    : value >= 40    ? colors.teal
    : colors.developing;
  const fillPct = gradeToBarPct(value);
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
          color: colors.textMuted, letterSpacing: 0.5,
        }}>
          {label.toUpperCase()}
        </Text>
        <Text style={{
          fontSize: 14, fontFamily: 'Helvetica-Bold', color: tone,
        }}>
          {value ?? '—'}
        </Text>
      </View>
      <View style={{
        height: 4, borderRadius: 2,
        backgroundColor: colors.tableBg,
        border: `0.5px solid ${colors.cardBorder}`,
        overflow: 'hidden',
      }}>
        <View style={{
          height: '100%', width: `${fillPct}%`,
          backgroundColor: tone,
        }} />
      </View>
    </View>
  );
}

/* ─── Public type ─── */

export interface SprayDot {
  angle: number;
  distance: number;
  exitVelo?: number;
}

export interface HittingPdfData {
  player: any;
  /** topMetrics extended with the synthetic full_swing_miss_pct reading. */
  topMetrics: Record<string, { value: number; unit: string }>;
  /** Per-key 20-80 grades for the swing mechanics inputs. */
  metricGrades: Record<string, number | null>;
  manual: ManualSwingScores;
  diagnosisNotes: string;
  /** Each batted ball — angle (deg, 0=center, ±=left/right), distance (ft), optional EV. */
  sprayDots: SprayDot[];
  swingNotes: string | null;
  reportDate: string;
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

  // EV → color (red/yellow/green at 75 / 90 / 100 mph cutoffs)
  const dotColor = (ev?: number) => {
    if (ev === undefined) return '#94A3B8';
    if (ev >= 95) return '#16A34A';
    if (ev >= 85) return '#CA8A04';
    return '#DC2626';
  };

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      {/* outer field background */}
      <Rect x={0} y={0} width={W} height={H} fill={colors.cardBg} />

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
        const fill = dotColor(d.exitVelo);
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
  const { player, topMetrics, metricGrades, manual, diagnosisNotes, sprayDots, swingNotes, reportDate } = data;

  // ── Build chip data for each grade row ────────────────────────────────────
  const swingChips = SWING_METRIC_KEYS.map(k => {
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

  const diagnosisChips = [
    { key: 'forwardMove', label: 'Fwd Mv',  grade: manual.forwardMove },
    { key: 'posture',     label: 'Posture', grade: manual.posture },
    { key: 'stability',   label: 'Stable',  grade: manual.stability },
    { key: 'direction',   label: 'Direct',  grade: manual.direction },
    { key: 'stretch',     label: 'Stretch', grade: manual.stretch },
    { key: 'core',        label: 'Core',    grade: manual.core },
    { key: 'slot',        label: 'Slot',    grade: manual.slot },
    { key: 'timing',      label: 'Timing',  grade: manual.timing },
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
  const barrelGroup   = buildGroup(['fb_barrel_pct', 'os_barrel_pct', 'overall_barrel_pct']);
  const whiffGroup    = buildGroup(['fb_whiff_pct', 'os_whiff_pct', 'overall_whiff_pct']);
  const chaseGroup    = buildGroup(['fb_chase_pct', 'os_chase_pct', 'overall_chase_pct']);
  const approachGroup = buildGroup(['overall_bb_pct', 'overall_k_pct', 'fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct']);
  const hasDecisionData = [...barrelGroup.chips, ...whiffGroup.chips, ...chaseGroup.chips, ...approachGroup.chips]
    .some(c => c.grade !== null);

  return (
    <>
      {/* ── Page 1: Hitting Snapshot (Swing view) ── */}
      <Page size="LETTER" style={s.page}>
        <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

        {/* SNAPSHOT ROW — Spray Chart (left) + Hitting Grades bubble (right) */}
        <View style={{
          flexDirection: 'row',
          gap: 10,
          marginBottom: 12,
        }}>
          {/* Spray Chart panel — left */}
          <View style={{
            width: '46%',
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8,
            padding: 8,
          }}>
            <Text style={{
              fontSize: 8, fontFamily: 'Helvetica-Bold',
              color: colors.accent, letterSpacing: 1.4, marginBottom: 4,
            }}>
              SPRAY CHART
            </Text>
            <View style={{ aspectRatio: 520 / 460, width: '100%' }}>
              <PdfSprayChart dots={sprayDots} />
            </View>
            <Text style={{
              fontSize: 6.5, color: colors.textMuted,
              marginTop: 3, textAlign: 'center',
            }}>
              {sprayDots.length} batted ball{sprayDots.length === 1 ? '' : 's'}
              {' · '}EV color: red {'<'} 85 · yellow 85-94 · green 95+
            </Text>
          </View>

          {/* Hitting Grades bubble — right */}
          <View style={{
            flex: 1,
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8,
            padding: 10,
          }}>
            <Text style={{
              fontSize: 8, fontFamily: 'Helvetica-Bold',
              color: colors.accent, letterSpacing: 1.4, marginBottom: 6,
            }}>
              HITTING GRADES
            </Text>
            <PdfGradeRow label="Swing"              grade={swingComposite}     chips={swingChips} />
            <PdfGradeRow label="Quality of Contact" grade={qocComposite}       chips={qocChips} />
            <PdfGradeRow label="Coach Diagnosis"    grade={diagnosisComposite} chips={diagnosisChips} />
          </View>
        </View>

        {/* Diagnosis Notes */}
        {diagnosisNotes && (
          <PdfNotesBox label="DIAGNOSIS NOTES" text={diagnosisNotes} />
        )}

        {/* Coach Grades cards — moved above Full Swing / Blast Motion */}
        <PdfSectionHeader title="Coach Grades" subtitle="20-80 manual entries from the coaching staff" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <PdfCoachGradeCard label="Forward Move" value={manual.forwardMove} />
          <PdfCoachGradeCard label="Posture"      value={manual.posture} />
          <PdfCoachGradeCard label="Stability"    value={manual.stability} />
          <PdfCoachGradeCard label="Direction"    value={manual.direction} />
          <PdfCoachGradeCard label="Stretch"      value={manual.stretch} />
          <PdfCoachGradeCard label="Core"         value={manual.core} />
          <PdfCoachGradeCard label="Slot"         value={manual.slot} />
          <PdfCoachGradeCard label="Timing"       value={manual.timing} />
        </View>

        {/* Full Swing inputs */}
        <PdfSectionHeader title="Full Swing" subtitle="Outcome metrics — Full Swing / HitTrax" />
        <View style={s.kpiGrid}>
          {QOC_KEYS.map(k => {
            const m = topMetrics[k];
            const label = METRIC_LABELS[k] || k;
            if (!m) return <PdfKpiCard key={k} label={label} value="—" badge="No data" badgeLevel="teal" />;
            const level = getBadgeLevel(k, m.value);
            const grade = metricToGradeFromMetric(k, m.value);
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

        {/* Blast Motion inputs */}
        <PdfSectionHeader title="Blast Motion" subtitle="Captures + age-adjusted bat speed" />
        <View style={s.kpiGrid}>
          {SWING_METRIC_KEYS.map(k => {
            const m = topMetrics[k];
            const label = SCORE_LABEL_OVERRIDES[k] || METRIC_LABELS[k] || k;
            if (!m) return <PdfKpiCard key={k} label={label} value="—" badge="No data" badgeLevel="teal" />;
            const level = getBadgeLevel(k, m.value);
            const grade = metricGrades[k] ?? null;
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

        {swingNotes && (
          <>
            <PdfDivider />
            <PdfNotesBox label="HITTING REPORT NOTES" text={swingNotes} />
          </>
        )}

        <PageFooter reportTitle="Hitting Assessment" date={reportDate} />
      </Page>

      {/* ── Page 2: At-Bat Results (Swing Decision data) ── */}
      {hasDecisionData && (
        <Page size="LETTER" style={s.page}>
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
              color: colors.accent, letterSpacing: 1.5, marginBottom: 8,
            }}>
              AT-BAT RESULTS · SWING DECISION
            </Text>
            <PdfGradeRow label="Barrel Rate" grade={barrelGroup.composite}   chips={barrelGroup.chips} />
            <PdfGradeRow label="Whiff Rate"  grade={whiffGroup.composite}    chips={whiffGroup.chips} />
            <PdfGradeRow label="Chase Rate"  grade={chaseGroup.composite}    chips={chaseGroup.chips} />
            <PdfGradeRow label="Approach"    grade={approachGroup.composite} chips={approachGroup.chips} />
          </View>

          <PageFooter reportTitle="Hitting Assessment — At-Bat Results" date={reportDate} />
        </Page>
      )}
    </>
  );
}

/* Local helper that mirrors metricToGrade in helpers.ts but uses the metric
   key directly to look up its GRADE_RANGES range — avoids passing topMetrics. */
function metricToGradeFromMetric(key: string, value: number): number | null {
  // GRADE_RANGES is exported from helpers but importing here would create a
  // circular path. Inline the few we need:
  const RANGES: Record<string, [number, number]> = {
    attack_angle: [-5, 18],
    plane_angle: [10, 38],
    avg_bat_speed: [50, 80],
    time_to_contact: [0.20, 0.13],
    on_plane_efficiency: [55, 92],
    connection_at_contact: [70, 95],
    rotational_acceleration: [10, 26],
    avg_exit_velo: [65, 100],
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
