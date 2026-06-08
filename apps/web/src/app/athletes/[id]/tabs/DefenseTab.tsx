'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips, NotesBox, VideoPlaceholder, VideoBundleCard,
  ReportSelector, TabBarActions, EditProfileButton, DownloadPdfButton, VideosIconButton,
} from '@/components/assessment';
import { NoteBlock } from './SwingTab';
import { INFIELDER_SILHOUETTE, OUTFIELDER_SILHOUETTE } from './defense-silhouettes';
import { generateDefensePdf } from '@/lib/pdf';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import * as api from '@/lib/api';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES, scoreColor,
  getReportVideoIds, getReportContentVideos,
  type ReportSummary,
  /* 7-section defense Coach Grades — saved by the Report modal
     under content.{position}CoachGrades, read back via
     getDefenseCoachGrades on the defense profile tabs. */
  type DefenseCoachGrades, type DefensePosition,
  DEFENSE_COACH_GRADE_SECTIONS, getDefenseCoachGrades,
} from '../helpers';
import { CustomCharts } from '@/components/CustomCharts';
import { bundleVideos, normalizeVideoTitle, splitVideoTitle } from '@/lib/video-titles';

/* ═══════════════════════════════════════════
   SUB-TAB DEFINITIONS
   ═══════════════════════════════════════════ */

type DefenseSubTab = 'catching' | 'infield' | 'outfield' | 'utility';

const ALL_SUB_TABS: { key: DefenseSubTab; label: string; positionCode: string }[] = [
  { key: 'catching', label: 'Catching', positionCode: 'C' },
  { key: 'infield', label: 'Infield', positionCode: 'INF' },
  { key: 'outfield', label: 'Outfield', positionCode: 'OF' },
  { key: 'utility', label: 'Utility', positionCode: 'UTIL' },
];

/* ═══════════════════════════════════════════
   SHARED — Defense Coach Grades read-only display
   ───────────────────────────────────────────
   7-section Coach Grades summary used by every defense profile tab
   (Catching / Infield / Outfield). Reads the grade scores from the
   selected report's content.{position}CoachGrades slot via
   `getDefenseCoachGrades`, then renders them as a 7-column grid of
   title + 20-80 score chips inside a Section bubble.

   Intentionally simpler than the Pitching tab's MechanicalSummaryStrip
   — no per-section descriptor tags, no sub-item breakdown, no
   roll-up to a parent score bar. Just "the 7 Coach Grades from
   Pitching" as the user requested.

   Returns null when there are no graded sections so the bubble
   doesn't render as an empty placeholder.
   ═══════════════════════════════════════════ */
function DefenseCoachGradesPanel({
  report, position, shuffleVelocityMph = null, customGrades, embedded = false,
}: {
  report: ReportSummary | null | undefined;
  position: DefensePosition;
  /** Catching only — shuffle velocity (mph) measured in the report's
   *  Throwing section, surfaced here in the top Coach Grades panel as
   *  a measured readout (NOT a 20-80 grade). */
  shuffleVelocityMph?: number | null;
  /** Caller-supplied grade list — when provided, overrides the
   *  default 5-section `DEFENSE_COACH_GRADE_SECTIONS` read. Used by
   *  the Catching profile to surface its 7 Throwing Grades
   *  (Footwork / Transfer / Accuracy / Arm Path / Foot Strike
   *  Position / Rotation Sequence / Arm Deceleration) sourced from
   *  `catchingAssessment.throwing.*`, matching the catching report
   *  exactly instead of the legacy 5-section Coach Grades blob. */
  customGrades?: { title: string; score: number | null }[];
  /** When true, render flat (no own `Section`/`profilePanel` bubble) for
   *  embedding inside another bubble — used by the Infielder/Outfielder
   *  Snapshot, which hosts Coach Grades below its two-column body. */
  embedded?: boolean;
}) {
  const defaultGrades: DefenseCoachGrades = useMemo(
    () => getDefenseCoachGrades(report ?? null, position),
    [report, position],
  );
  /* Resolve which set of rows to render — caller's customGrades wins,
     otherwise the default 5-section list keyed off the saved
     `*CoachGrades` blob. */
  const rows = customGrades
    ?? DEFENSE_COACH_GRADE_SECTIONS.map(s => ({ title: s.title, score: defaultGrades[s.key] ?? null }));
  const hasAnyData = rows.some(r => typeof r.score === 'number');
  if (!hasAnyData && shuffleVelocityMph == null) return null;
  /* Inner content — the "Coach Grades" header + the chip grid (+ the
     optional Catching shuffle-velocity readout). Shared by both the
     standalone-bubble and embedded render modes below. */
  const body = (
    <>
      <SectionHeader title="Throwing Grades" />
      {/* Grade display.
         • Embedded (Infielder / Outfielder Snapshot) → a vertical LIST:
           one grade per line, label on the left + value on the right, so
           it stacks as a tall list to the right of the metric bubbles.
         • Standalone (Catching) → the original horizontal chip row. */}
      {embedded ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 0,
          /* Grow to fill the stretched bubble; each grade row below is flex:1
             so the grades split the height into equal slots — each with its
             label + value centered between the grey divider lines. */
          flex: 1,
        }}>
          {rows.map((row, i) => {
            const tone = row.score !== null ? scoreColor(row.score) : '#475569';
            const last = i === rows.length - 1;
            return (
              <div
                key={`${row.title}-${i}`}
                style={{
                  /* Each grade fills an equal-height slot (flex:1) with its
                     label + value stacked and centered both horizontally AND
                     vertically — so the metric + label sit centered between
                     the grey divider lines. */
                  flex: 1,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 3,
                  padding: '4px 0',
                  borderBottom: last ? 'none' : '1px solid var(--border)',
                }}
              >
                <span style={{
                  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.03em',
                  textTransform: 'uppercase', color: 'var(--text-bright)', lineHeight: 1.15,
                }}>
                  {row.title}
                </span>
                <span style={{
                  fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 16,
                  color: tone, lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {row.score ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
          gap: 4,
          padding: '6px 0',
          borderBottom: '1px solid var(--border)',
        }}>
          {rows.map((row, i) => {
            const tone = row.score !== null ? scoreColor(row.score) : '#475569';
            return (
              <div
                key={`${row.title}-${i}`}
                style={{
                  padding: '0 4px',
                  display: 'flex', flexDirection: 'column', gap: 4,
                  alignItems: 'center',
                }}
              >
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: 'var(--text-bright)',
                  textAlign: 'center', lineHeight: 1.1,
                }}>
                  {row.title}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 16,
                    color: tone, lineHeight: 1, letterSpacing: '-0.02em',
                  }}>
                    {row.score ?? '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {shuffleVelocityMph != null && (
        <div style={{
          marginTop: 10, display: 'inline-flex', alignItems: 'baseline', gap: 8,
          padding: '6px 12px', borderRadius: 8,
          background: 'var(--defense-inner-bg)',
          border: '1px solid var(--border-light)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>Shuffle Velocity</span>
          <span style={{
            fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 16,
            color: 'var(--text-bright)', lineHeight: 1,
          }}>
            {shuffleVelocityMph}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 3 }}>mph</span>
          </span>
        </div>
      )}
    </>
  );
  /* Embedded (Infielder / Outfielder Snapshot) — render in its own white
     inner bubble below the Defensive Skills + Underlying Metrics columns,
     using the exact same shell chrome those columns wear so Coach Grades
     reads as a matching third bubble inside the snapshot:
       • Infield  → `.innerPanel` + `--bubble-chrome-bg` (near-white Swing
         color in light, graphite gradient in dark).
       • Outfield → `ofInnerBubbleStyle` (resolves to `--defense-inner-bg`,
         the same near-white surface in light). */
  if (embedded) {
    const isOf = position === 'outfield';
    return (
      <div
        className={isOf ? undefined : aStyles.innerPanel}
        /* `alignSelf: stretch` makes the Coach Grades bubble fill the full
           grid-row height too — matching Defensive Skills — so it also
           extends down to the bottom of the Range bubble. The grade list
           inside grows + distributes to use the extra height. */
        style={isOf
          ? { ...ofInnerBubbleStyle, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 14, padding: 14 }
          : { alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 14, padding: 14, background: 'var(--bubble-chrome-bg, var(--card-elev-bg))' }}
      >
        {body}
      </div>
    );
  }
  /* Standalone bubble (Catching profile) — own `profilePanel` matched to
     the Snapshot bubbles. */
  return (
    <Section>
      <div
        className={aStyles.profilePanel}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {body}
      </div>
    </Section>
  );
}

/* ═══════════════════════════════════════════
   SHARED TYPES
   ═══════════════════════════════════════════ */

interface ArmMetric {
  attempts: (number | null)[];
  best: number | null;
  avg: number | null;
  notes: string;
}

interface GradeItem {
  grade: number | null;
  notes: string;
}

/* ── Infield types ── */

/* Persisted shape for the snapshot's four headline groups. Each value
 * is a coach-entered number (or null when blank) and the overall grade
 * is the /80 score. Mirrors the form's DefenseSnapshotGroup. */
interface SnapshotMetricGroup {
  primary: number | null;
  secondary: number | null;
  /* Optional third metric — currently captured only by Arm Strength
     (Pull Down Velocity in the Infield / Outfield reports). Older
     reports won't carry the field, so it's optional/null-safe here. */
  tertiary?: number | null;
  overallGrade: number | null;
  notes: string;
}

interface ManualSnapshotData {
  armStrength: SnapshotMetricGroup;
  glove:       SnapshotMetricGroup;
  range:       SnapshotMetricGroup;
  firstStep:   SnapshotMetricGroup;
}

interface InfieldAssessment {
  arm: {
    velocity: ArmMetric;
    accuracy: ArmMetric;
  };
  rangeFootwork: {
    jumps: GradeItem;
    routes: GradeItem;
    rangeGloveSide: GradeItem;
    rangeArmSide: GradeItem;
    breakdownFootwork: GradeItem;
    athleticism: GradeItem;
    overallGrade: number | null;
  };
  handsGlove: {
    exchanges: GradeItem;
    shortHops: GradeItem;
    forehand: GradeItem;
    backhand: GradeItem;
    doublePlays: GradeItem;
    overallGrade: number | null;
  };
  /* Snapshot extensions */
  positionCode?: '1B' | '2B' | 'SS' | '3B';
  rangeLeft?: GradeItem;
  rangeRight?: GradeItem;
  rangeIn?: GradeItem;
  rangeBack?: GradeItem;
  /* Coach's manual snapshot inputs — preferred over the legacy
   * granular fields when present. */
  manualSnapshot?: ManualSnapshotData;
}

/* ── Outfield types ── */

interface OutfieldAssessment {
  arm: {
    velocity: ArmMetric;
    crowHop: ArmMetric;
    releaseTime: ArmMetric;
    accuracy: ArmMetric;
    overallGrade: number | null;
  };
  routesReads: {
    firstStepJump: GradeItem;
    flyBallBack: GradeItem;
    flyBallIn: GradeItem;
    lineDriveRead: GradeItem;
    routes: GradeItem;
    range: GradeItem;
    gloveWork: GradeItem;
    overallGrade: number | null;
  };
  /* Snapshot extensions */
  positionCode?: 'LF' | 'CF' | 'RF';
  rangeLeft?: GradeItem;
  rangeRight?: GradeItem;
  rangeIn?: GradeItem;
  rangeBack?: GradeItem;
  /* Coach's manual snapshot inputs — preferred over the legacy
   * granular fields when present. */
  manualSnapshot?: ManualSnapshotData;
}

/* ── Catching types ── */

interface ThrowingMetric {
  attempts: (number | null)[];
  best: number | null;
  avg: number | null;
  notes: string;
}

interface CatchingAssessment {
  throwing: {
    popTime2B: ThrowingMetric;
    popTime3B: ThrowingMetric;
    exchangeTime: ThrowingMetric;
    velocity: ThrowingMetric;
    /* Shuffle velocity (mph) — captured in the Catching report's
       Throwing section. Optional: older reports predate the field. */
    shuffleVelocity?: ThrowingMetric;
    overallGrade: number | null;
    /* Coach-graded throwing sub-skills (20-80 scale). Optional because
     * older reports won't carry them — the Underlying Stats row renders
     * each as em-dash when missing. Entered through the report modal.
     * The four delivery-mechanics checkpoints (armPath / footStrike /
     * rotationSeq / decel) used to live under a separate Coach Grades
     * block; they were moved into the Throwing Grades section so
     * everything reads from one place. */
    footwork?: GradeItem;
    transfer?: GradeItem;
    accuracy?: GradeItem;
    armPath?: GradeItem;
    footStrike?: GradeItem;
    rotationSeq?: GradeItem;
    decel?: GradeItem;
  };
  receiving: {
    topOfZone: GradeItem;
    bottomOfZone: GradeItem;
    gloveSide: GradeItem;
    armSide: GradeItem;
    quietHands: GradeItem;
    stanceSetup: GradeItem;
    overallGrade: number | null;
    // Coach-graded receiving sub-skills (20-80 scale). Optional because
    // older reports won't carry them, but the in-bubble "Coaches Grade"
    // panel renders all six rows regardless (em-dash when missing) so
    // the UI always shows the same checklist.
    load?: GradeItem;
    path?: GradeItem;
    accuracy?: GradeItem;
    turn?: GradeItem;
    presentation?: GradeItem;
    timing?: GradeItem;
    // Legacy
    speed?: GradeItem;
    zoneColors?: (0 | 1 | 2)[]; // 9 zones: 0=red, 1=white, 2=green
    /* 16 outer cells for the 5x5 strike-zone heat map. Saved by the
     * Catching report form under `receiving.borderZoneColors`. */
    borderZoneColors?: (0 | 1 | 2)[];
  };
  blocking: {
    range: GradeItem;
    accuracy: GradeItem;
    gloveBodyAngle: GradeItem;
    recoverySpeed: GradeItem;
    overallGrade: number | null;
    blockingRangeFeet?: number | null;
    /* Positional blocking grades for the Catching Snapshot diagram */
    blockLeft?: GradeItem;
    blockCenter?: GradeItem;
    blockRight?: GradeItem;
  };
  /* Optional outer 16 cells for the 5×5 strike-zone heat map */
  borderZoneColors?: (0 | 1 | 2)[];
}

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

const MONO = "'DM Mono', monospace";

/* ── Infield constants ── */

const ARM_METRICS: { key: keyof InfieldAssessment['arm']; label: string; unit: string }[] = [
  { key: 'velocity', label: 'Arm Velocity', unit: 'mph' },
  { key: 'accuracy', label: 'Arm Accuracy', unit: '%' },
];

const RANGE_SKILLS: { key: keyof Omit<InfieldAssessment['rangeFootwork'], 'overallGrade'>; label: string }[] = [
  { key: 'jumps', label: 'Jumps' },
  { key: 'routes', label: 'Routes' },
  { key: 'rangeGloveSide', label: 'Range — Glove Side' },
  { key: 'rangeArmSide', label: 'Range — Arm Side' },
  { key: 'breakdownFootwork', label: 'Break Down Footwork' },
  { key: 'athleticism', label: 'Athleticism' },
];

const HANDS_SKILLS: { key: keyof Omit<InfieldAssessment['handsGlove'], 'overallGrade'>; label: string }[] = [
  { key: 'exchanges', label: 'Exchanges' },
  { key: 'shortHops', label: 'Short Hops' },
  { key: 'forehand', label: 'Forehand' },
  { key: 'backhand', label: 'Backhand' },
  { key: 'doublePlays', label: 'Double Plays' },
];

/* ── Outfield constants ── */

const OF_ARM_METRICS: { key: keyof Omit<OutfieldAssessment['arm'], 'overallGrade'>; label: string; unit: string }[] = [
  { key: 'velocity', label: 'Arm Velocity', unit: 'mph' },
  { key: 'crowHop', label: 'Crow Hop', unit: 'mph' },
  { key: 'releaseTime', label: 'Release Time', unit: 'sec' },
  { key: 'accuracy', label: 'Arm Accuracy', unit: '%' },
];

const OF_ROUTES_SKILLS: { key: keyof Omit<OutfieldAssessment['routesReads'], 'overallGrade'>; label: string }[] = [
  { key: 'firstStepJump', label: 'First-Step Jump' },
  { key: 'flyBallBack', label: 'Fly Ball Read — Going Back' },
  { key: 'flyBallIn', label: 'Fly Ball Read — In' },
  { key: 'lineDriveRead', label: 'Line Drive Read' },
  { key: 'routes', label: 'Routes' },
  { key: 'range', label: 'Range' },
  { key: 'gloveWork', label: 'Glove Work' },
];

/* ── Catching constants ── */

const THROWING_CARDS: {
  key: keyof CatchingAssessment['throwing'];
  label: string;
  unit: string;
  mlbRef: string;
}[] = [
  { key: 'popTime2B', label: 'Pop Time (2B)', unit: 's', mlbRef: 'MLB avg: 1.90\u20132.00s' },
  { key: 'exchangeTime', label: 'Exchange Time', unit: 's', mlbRef: 'MLB avg: 0.65\u20130.75s' },
  { key: 'velocity', label: 'Velocity', unit: 'mph', mlbRef: 'MLB avg: 75\u201380 mph' },
];

/* ── Zone color helpers ── */
const ZONE_FILLS = ['#F87171', '#ffffff', '#4ADE80'] as const; // 0=red, 1=white, 2=green
const ZONE_LABELS_C = ['Bad', 'Average', 'Good'] as const;

/* ═══════════════════════════════════════════
   SHARED GRADE HELPERS
   ═══════════════════════════════════════════ */

/* Three flat bands matching scoreColor() and the rest of the app:
     20–40 → red, 40–60 → yellow, 60–80 → green. */
function gradeColor(grade: number | null): string {
  if (grade === null) return 'var(--faint)';
  if (grade >= 60) return '#22C55E'; // green
  if (grade >= 40) return '#EAB308'; // yellow
  return '#EF4444';                   // red
}

function gradeBg(grade: number | null): string {
  if (grade === null) return 'transparent';
  if (grade >= 60) return 'rgba(34,197,94,0.10)';
  if (grade >= 40) return 'rgba(234,179,8,0.10)';
  return 'rgba(239,68,68,0.12)';
}

function gradeLabel(grade: number | null): string {
  if (grade === null) return '';
  if (grade >= 70) return 'Plus-Plus';
  if (grade >= 60) return 'Plus';
  if (grade >= 55) return 'Above Avg';
  if (grade >= 50) return 'Average';
  if (grade >= 45) return 'Below Avg';
  if (grade >= 40) return 'Fringe';
  return 'Well Below';
}

/* ═══════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ═══════════════════════════════════════════ */

function ArmMetricCard({ metric, label, unit }: {
  metric: ArmMetric; label: string; unit: string;
}) {
  const hasBest = metric.best !== null;
  const hasAvg = metric.avg !== null;
  const attempts = metric.attempts || [];

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 16px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{
        /* Font D — small all-caps Satoshi eyebrow shared across
           every grey-bubble secondary label in the app. */
        fontFamily: 'inherit',
        fontSize: 11.88, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-bright)',
        lineHeight: 1.2,
      }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, fontFamily: 'inherit',
          color: hasBest ? '#4ADE80' : 'var(--faint)',
          lineHeight: 1,
        }}>
          {hasBest ? metric.best! : '\u2014'}
        </span>
        {hasBest && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            {unit} best
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
        {hasAvg ? (
          <>Avg: <span style={{ fontWeight: 700, color: 'var(--accent-light)' }}>{metric.avg}</span> {unit}</>
        ) : (
          'Avg: \u2014'
        )}
      </div>

      {attempts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {attempts.map((val, i) => (
            <span
              key={i}
              title={val !== null ? `#${i + 1}: ${val} ${unit}` : `#${i + 1}: no data`}
              style={{
                minWidth: 36, height: 26, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
                background: val !== null ? 'rgba(74,222,128,0.12)' : 'var(--surface2)',
                color: val !== null ? '#4ADE80' : 'var(--faint)',
                border: val !== null ? '1px solid rgba(74,222,128,0.25)' : '1px solid var(--border)',
                padding: '0 6px',
              }}
            >
              {val !== null ? val : '\u00b7'}
            </span>
          ))}
        </div>
      )}

      {metric.notes && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: 6, marginTop: 2,
          lineHeight: 1.4,
        }}>
          {metric.notes}
        </div>
      )}
    </div>
  );
}

function ThrowingMetricCard({ metric, label, unit, mlbRef }: {
  metric: ThrowingMetric; label: string; unit: string; mlbRef: string;
}) {
  const hasBest = metric.best !== null;
  const hasAvg = metric.avg !== null;
  const attempts = metric.attempts || [];

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 16px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{
        /* Font D — small all-caps Satoshi eyebrow shared across
           every grey-bubble secondary label in the app. */
        fontFamily: 'inherit',
        fontSize: 11.88, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-bright)',
        lineHeight: 1.2,
      }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, fontFamily: 'inherit',
          color: hasBest ? '#4ADE80' : 'var(--faint)',
          lineHeight: 1,
        }}>
          {hasBest ? metric.best!.toFixed(2) : '\u2014'}
        </span>
        {hasBest && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            {unit} best
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
        {hasAvg ? (
          <>Avg: <span style={{ fontWeight: 700, color: 'var(--accent-light)' }}>{metric.avg!.toFixed(2)}</span> {unit}</>
        ) : (
          'Avg: \u2014'
        )}
      </div>

      {attempts.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
          {attempts.map((val, i) => (
            <span
              key={i}
              title={val !== null ? `#${i + 1}: ${val.toFixed(2)} ${unit}` : `#${i + 1}: no data`}
              style={{
                width: 22, height: 22, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, fontFamily: 'inherit',
                background: val !== null ? 'rgba(74,222,128,0.12)' : 'var(--faint)',
                color: val !== null ? '#4ADE80' : 'var(--border)',
                border: val !== null ? '1px solid rgba(74,222,128,0.25)' : '1px solid var(--border)',
              }}
            >
              {val !== null ? (i + 1) : '\u00b7'}
            </span>
          ))}
        </div>
      )}

      <div style={{
        fontSize: 10, color: 'var(--faint)', fontStyle: 'italic', marginTop: 2,
      }}>
        {mlbRef}
      </div>

      {metric.notes && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: 6, marginTop: 2,
          lineHeight: 1.4,
        }}>
          {metric.notes}
        </div>
      )}
    </div>
  );
}

function ScoutingGradeBadge({ grade, size = 'large' }: { grade: number | null; size?: 'large' | 'small' }) {
  const isLarge = size === 'large';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: isLarge ? 64 : 44,
      height: isLarge ? 64 : 44,
      borderRadius: isLarge ? 16 : 10,
      background: gradeBg(grade),
      border: `2px solid ${gradeColor(grade)}`,
    }}>
      <span style={{
        fontSize: isLarge ? 28 : 18,
        fontWeight: 800,
        fontFamily: 'inherit',
        color: gradeColor(grade),
      }}>
        {grade !== null ? grade : '\u2014'}
      </span>
    </div>
  );
}

function GradeRow({ label, item }: { label: string; item: GradeItem }) {
  const pct = item.grade !== null ? Math.min((item.grade / 80) * 100, 100) : 0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 50px 1fr',
      alignItems: 'center',
      gap: 14,
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {label}
      </span>
      <span style={{
        fontSize: 16, fontWeight: 800, fontFamily: 'inherit',
        color: gradeColor(item.grade),
        textAlign: 'center',
      }}>
        {item.grade !== null ? item.grade : '\u2014'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          height: 8, borderRadius: 4,
          background: 'var(--border)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {item.grade !== null && (
            <div style={{
              position: 'absolute', top: 0, left: 0, height: '100%',
              width: `${pct}%`,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${gradeColor(item.grade)}88, ${gradeColor(item.grade)})`,
              transition: 'width 0.5s ease',
            }} />
          )}
        </div>
        {item.notes && (
          <span style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.3 }}>
            {item.notes}
          </span>
        )}
      </div>
    </div>
  );
}

function OverallGradeCard({ label, grade }: { label: string; grade: number | null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 20px',
      background: gradeBg(grade),
      borderRadius: 10,
      border: `1px solid ${gradeColor(grade)}33`,
      marginTop: 4,
    }}>
      <ScoutingGradeBadge grade={grade} size="small" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          /* Font D */
          fontFamily: 'inherit',
          fontSize: 11.88, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-bright)',
          lineHeight: 1.2,
        }}>
          Overall {label}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: gradeColor(grade),
        }}>
          {grade !== null ? `${grade} \u2014 ${gradeLabel(grade)}` : 'Not Graded'}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CATCHING SUB-COMPONENTS
   ═══════════════════════════════════════════ */

/* ── Interactive 9-Zone Strike Zone ── */
function ReceivingZone({ zoneColors, onToggle }: {
  zoneColors: (0 | 1 | 2)[];
  onToggle: (idx: number) => void;
}) {
  const W = 300, H = 320;
  const szLeft = 60, szTop = 40, szW = 180, szH = 240;
  const cellW = szW / 3, cellH = szH / 3;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', margin: '0 auto', cursor: 'pointer', maxWidth: W }}>
      <rect width={W} height={H} fill="transparent" />
      {/* 9 zones */}
      {[0,1,2,3,4,5,6,7,8].map(i => {
        const row = Math.floor(i / 3), col = i % 3;
        const x = szLeft + col * cellW, y = szTop + row * cellH;
        const fill = ZONE_FILLS[zoneColors[i]] || '#ffffff';
        return (
          <g key={i} onClick={() => onToggle(i)}>
            <rect x={x} y={y} width={cellW} height={cellH} fill={fill} stroke="var(--border)" strokeWidth={1.5} rx={3} opacity={0.85} />
            <text x={x + cellW / 2} y={y + cellH / 2 + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={zoneColors[i] === 1 ? 'var(--text-muted)' : '#000'}>
              {i + 1}
            </text>
          </g>
        );
      })}
      {/* Strike zone border */}
      <rect x={szLeft} y={szTop} width={szW} height={szH} fill="none" stroke="var(--text-muted)" strokeWidth={2} rx={4} />
      {/* Home plate */}
      <polygon points={`${W/2 - 20},${szTop + szH + 15} ${W/2 + 20},${szTop + szH + 15} ${W/2 + 12},${szTop + szH + 28} ${W/2},${szTop + szH + 35} ${W/2 - 12},${szTop + szH + 28}`}
        fill="none" stroke="var(--text-muted)" strokeWidth={1.5} />
      {/* Legend */}
      {[2, 1, 0].map((v, i) => (
        <g key={v} transform={`translate(${szLeft + i * 70}, ${H - 12})`}>
          <rect width={12} height={12} rx={2} fill={ZONE_FILLS[v]} stroke="var(--border)" strokeWidth={0.5} />
          <text x={16} y={10} fontSize={10} fill="var(--text-muted)">{ZONE_LABELS_C[v]}</text>
        </g>
      ))}
    </svg>
  );
}

/* ── Receiving Score Row ── */
function ReceivingScoreRow({ label, item }: { label: string; item?: GradeItem }) {
  const grade = item?.grade ?? null;
  const pct = grade !== null ? Math.min((grade / 80) * 100, 100) : 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 44px 1fr', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'inherit', color: gradeColor(grade), textAlign: 'center' }}>
        {grade !== null ? grade : '\u2014'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
          {grade !== null && (
            <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, borderRadius: 4,
              background: `linear-gradient(90deg, ${gradeColor(grade)}88, ${gradeColor(grade)})`, transition: 'width 0.5s ease' }} />
          )}
        </div>
        {item?.notes && <span style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.3 }}>{item.notes}</span>}
      </div>
    </div>
  );
}

/* ── Blocking Score Row ── */
function BlockingScoreRow({ label, item }: { label: string; item?: GradeItem }) {
  const grade = item?.grade ?? null;
  const pct = grade !== null ? Math.min((grade / 80) * 100, 100) : 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '160px 44px 1fr', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'inherit', color: gradeColor(grade), textAlign: 'center' }}>
        {grade !== null ? grade : '\u2014'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
          {grade !== null && (
            <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, borderRadius: 4,
              background: `linear-gradient(90deg, ${gradeColor(grade)}88, ${gradeColor(grade)})`, transition: 'width 0.5s ease' }} />
          )}
        </div>
        {item?.notes && <span style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.3 }}>{item.notes}</span>}
      </div>
    </div>
  );
}

/* ── Blocking Range Visual ── */
function BlockingRangeVisual({ rangeFeet }: { rangeFeet: number | null }) {
  const W = 500, H = 220;
  const plateY = 50, catcherY = 160;
  const cx = W / 2;
  // Scale: 1 foot ≈ 30px
  const scale = 30;
  const rangeRadius = rangeFeet ? rangeFeet * scale : 0;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', margin: '0 auto', maxWidth: W }}>
      {/* Home plate */}
      <polygon
        points={`${cx - 16},${plateY} ${cx + 16},${plateY} ${cx + 10},${plateY + 10} ${cx},${plateY + 16} ${cx - 10},${plateY + 10}`}
        fill="none" stroke="var(--text-muted)" strokeWidth={1.5}
      />
      <text x={cx} y={plateY - 8} textAnchor="middle" fontSize={9} fill="var(--text-muted)" fontWeight={600}>HOME</text>

      {/* LHH batter's box */}
      <rect x={cx - 90} y={plateY - 18} width={50} height={52} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="4 3" rx={2} />
      <text x={cx - 65} y={plateY - 22} textAnchor="middle" fontSize={8} fill="var(--faint)">LHH</text>

      {/* RHH batter's box */}
      <rect x={cx + 40} y={plateY - 18} width={50} height={52} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="4 3" rx={2} />
      <text x={cx + 65} y={plateY - 22} textAnchor="middle" fontSize={8} fill="var(--faint)">RHH</text>

      {/* Catcher icon */}
      <circle cx={cx} cy={catcherY} r={16} fill="var(--surface)" stroke="#4ADE80" strokeWidth={2} />
      <text x={cx} y={catcherY + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#4ADE80">C</text>

      {/* Blocking range arc */}
      {rangeFeet && rangeRadius > 0 && (
        <>
          <path
            d={`M ${cx - rangeRadius},${catcherY} A ${rangeRadius},${rangeRadius} 0 0,1 ${cx + rangeRadius},${catcherY}`}
            fill="rgba(74,222,128,0.12)" stroke="#4ADE80" strokeWidth={2} strokeDasharray="6 3"
          />
          {/* Left label */}
          <line x1={cx - rangeRadius} y1={catcherY - 5} x2={cx - rangeRadius} y2={catcherY + 5} stroke="#4ADE80" strokeWidth={1.5} />
          {/* Right label */}
          <line x1={cx + rangeRadius} y1={catcherY - 5} x2={cx + rangeRadius} y2={catcherY + 5} stroke="#4ADE80" strokeWidth={1.5} />
          {/* Range label */}
          <text x={cx} y={catcherY - rangeRadius / 2 - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#4ADE80">
            {rangeFeet} ft
          </text>
        </>
      )}
      {!rangeFeet && (
        <text x={cx} y={catcherY + 40} textAnchor="middle" fontSize={11} fill="var(--faint)">
          No blocking range data
        </text>
      )}

      {/* Footer label */}
      <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
        Lateral Blocking Range from Home Plate
      </text>
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════
   SHARED SNAPSHOT helpers — used by Catching, Infield, and Outfield
   ════════════════════════════════════════════════════════════════ */

/* Tone-color map for a 20-80 grade — three flat bands matching the
   shared scoreColor() helper:
     20–40 → red    (bad)
     40–60 → yellow (average)
     60–80 → green  (good) */
function gradeTone(g: number | null): { stroke: string; fill: string; text: string } {
  if (g === null) return { stroke: 'rgba(255,255,255,0.18)', fill: 'rgba(255,255,255,0.04)', text: 'rgba(255,255,255,0.40)' };
  if (g >= 60)    return { stroke: '#22C55E', fill: 'rgba(34,197,94,0.16)',  text: '#22C55E' }; // green
  if (g >= 40)    return { stroke: '#EAB308', fill: 'rgba(234,179,8,0.16)',  text: '#EAB308' }; // yellow
  return                  { stroke: '#EF4444', fill: 'rgba(239,68,68,0.16)', text: '#EF4444' }; // red
}

/* Single horizontal bar inside GloveFootworkBars */
function BarRow({ label, grade }: { label: string; grade: number | null }) {
  const t = gradeTone(grade);
  const pct = grade !== null ? Math.max(0, Math.min(((grade - 20) / 60) * 100, 100)) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 36px', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
        {grade !== null && (
          <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, height: '100%', borderRadius: 4,
            background: `linear-gradient(90deg, ${t.text}66, ${t.text})`, transition: 'width 0.5s ease' }} />
        )}
      </div>
      <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'inherit', textAlign: 'right', color: t.text, fontVariantNumeric: 'tabular-nums' }}>
        {grade !== null ? grade : '—'}
      </span>
    </div>
  );
}

/* Glove + Footwork bar chart — replaces the strike-zone heat map for IF/OF */
function GloveFootworkBars({ gloveTitle, gloveItems, footworkTitle, footworkItems }: {
  gloveTitle: string;
  gloveItems: { label: string; grade: number | null }[];
  footworkTitle: string;
  footworkItems: { label: string; grade: number | null }[];
}) {
  return (
    <div style={{ width: '100%', maxWidth: 380, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontFamily: 'inherit', fontSize: 11.88, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--text-bright)', lineHeight: 1.2, marginBottom: 6, paddingBottom: 4, borderBottom: '1px dashed var(--border)' }}>
          {gloveTitle}
        </div>
        {gloveItems.map(item => <BarRow key={item.label} {...item} />)}
      </div>
      <div>
        <div style={{ fontFamily: 'inherit', fontSize: 11.88, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--text-bright)', lineHeight: 1.2, marginBottom: 6, paddingBottom: 4, borderBottom: '1px dashed var(--border)' }}>
          {footworkTitle}
        </div>
        {footworkItems.map(item => <BarRow key={item.label} {...item} />)}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   ReceivingCoachGrades — six-row sub-skill panel rendered to the right
   of the Strike Zone heat map inside the Catching Snapshot bubble.
   Mirrors the dark-navy chip styling used by the pop-time bubble + the
   heat map backdrop so the whole snapshot reads as one palette.

   Each row shows: LABEL · GRADE NUMBER, color-coded by the 20-80 scoring
   bands (green ≥60, yellow 40-59, red <40, gray for missing).
   ───────────────────────────────────────────────────────────────────── */
function ReceivingCoachGrades({
  receiving,
}: {
  receiving: CatchingAssessment['receiving'];
}) {
  /* Six checkpoint grades, in the order coaches scout them: setup-load
   * → glove path → finishing accuracy → frame turn → ball presentation
   * → timing of the whole sequence. */
  const ROWS: { key: string; label: string; grade: number | null }[] = [
    { key: 'path',         label: 'Path',         grade: receiving.path?.grade         ?? null },
    { key: 'accuracy',     label: 'Accuracy',     grade: receiving.accuracy?.grade     ?? null },
    { key: 'turn',         label: 'Turn',         grade: receiving.turn?.grade         ?? null },
    { key: 'presentation', label: 'Presentation', grade: receiving.presentation?.grade ?? null },
    { key: 'timing',       label: 'Timing',       grade: receiving.timing?.grade       ?? null },
  ];

  /* Each receiving sub-grade now renders as a compact chip that
     visually matches the Coach Grade chips on the new 7-section
     Coach Grades panel (above the snapshot) — title + score only,
     no per-row grade bar. The whole panel sits in the same side
     column it always did (alongside the heat map), but now reads
     as a stack of mini Coach Grade chips instead of a tall list
     of label/bar rows. */
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '14px 14px',
      /* Flat fill that matches the Player Name bubble (`.commandDeck`)
         in both themes — `--panel-bg-light` (#dee1e5 cool slate) in
         light theme, `rgba(10,14,20,0.38)` (the same dark-navy base
         the Player Name bubble's radial gradient sits over) in dark.
         The shared `ofCommandDeckChipStyle` recipe was retired here
         because its inset shadow stack
           inset 0 0 24px rgba(0, 0, 0, 0.35)
         produced a heavy vignette that read as a busy gradient on
         the Catching Snapshot's Coaches Grade chip — coach-spec
         called for a flat surface matching the Player Name bubble
         instead. The four Outfield metric chips and other call sites
         still use `ofCommandDeckChipStyle` and keep their radial
         chrome unchanged. */
      background: 'var(--panel-bg-light, rgba(10, 14, 20, 0.38))',
      border: '1px solid var(--border-light)',
      borderRadius: 12,
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
      position: 'relative',
      alignSelf: 'stretch',
      minHeight: '100%',
    }}>
      {/* Section header — kept on its own row so the 6 chips below
          read as one Coach Grades grouping. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        paddingBottom: 6, borderBottom: '1px solid var(--border-light)',
        flex: '0 0 auto',
      }}>
        <span style={{
          fontFamily: 'inherit',
          fontSize: 11.88, fontWeight: 600,
          letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--text-bright)',
          lineHeight: 1.2,
        }}>
          Coaches Grade
        </span>
        <span style={{
          fontSize: 9.5, fontStyle: 'italic',
          /* Theme-aware token (was hardcoded `rgba(255,255,255,0.55)`)
             so the "20–80" legend stays readable on the new flat
             cool-slate surface in light theme. */
          color: 'var(--text-muted)',
        }}>
          20–80
        </span>
      </div>

      {/* Stack of compact title+score chips — same chrome the new
         7-section Coach Grades panel uses on each cell: centered
         title (10 px, weight 600, 0.04em letter-spacing, white)
         + tabular score readout (16 px, weight 700, tone-colored).
         No grade bar — matches the Coach Grades chip exactly. */}
      <div style={{
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 4,
      }}>
        {ROWS.map((r) => {
          const has = r.grade !== null;
          const tone = !has ? '#475569' : scoreColor(r.grade!);
          return (
            <div
              key={r.key}
              style={{
                padding: '0 4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                alignItems: 'center',
                paddingTop: 4,
                paddingBottom: 4,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: 'var(--text-bright)',
                textAlign: 'center', lineHeight: 1.1,
              }}>
                {r.label}
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 16,
                  color: tone, lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {has ? r.grade : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* 5×5 strike-zone heat map with bordered inner 3×3.
 * Outer ring of border cells renders noticeably thinner than the inner
 * 3×3 strike zone so the hierarchy reads at a glance, and a pentagonal
 * home-plate icon sits below the grid as a catcher's-view orientation
 * cue. Per-row/col widths + heights via cumulative-offset arrays let
 * the geometry shift without touching cell indexing. */
function StrikeZoneHeatMap5x5({ zoneColors, borderZoneColors }: {
  zoneColors: (0 | 1 | 2)[];
  borderZoneColors?: (0 | 1 | 2)[];
}) {
  /* Theme-aware color palette for the SVG. Light mode flips the
     Border Zones backdrop from the dark-navy Command-Deck radial to
     the near-white `--bubble-chrome-bg` (#eaeaea) Swing/inner-bubble
     surface, so the heat-map bubble matches the rest of the Catching
     Snapshot's interior chrome in light theme. Every hardcoded
     `rgba(255,255,255,...)` text/stroke color flips to its
     `rgba(0,0,0,...)` counterpart so the labels stay legible against
     the new light fill. Dark theme keeps the original colors. */
  const { theme } = useTheme();
  const isLight = theme === 'light';
  /* Three-stop radial fill — pinned to the SAME flat color across all
     three stops in both themes so the Border Zones bubble matches the
     Coaches Grade chip + the Player Name bubble exactly: `--panel-bg-
     light` (`#dee1e5` cool slate) in light theme, and the `rgba(10,14,
     20,0.38)` navy base the Player Name bubble's radial sits over in
     dark theme. The previous near-white + Command-Deck radial recipes
     were retired per coach-spec — coach wanted one unified surface
     color across all three bubbles in the Catching Snapshot. Equal
     stops mean the radialGradient renders FLAT, so the radial-highlight
     vignette that used to read as a "crazy gradient" on the chip
     surface is gone in both themes. */
  const flatFill = isLight ? '#dee1e5' : 'rgba(10, 14, 20, 0.38)';
  const fillStop1 = flatFill;
  const fillStop2 = flatFill;
  const fillStop3 = flatFill;
  /* Stroke vertical fade — inverted opacity in light so it still
     reads as a soft edge against the near-white surface. */
  const strokeTop = isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.22)';
  const strokeMid = isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.20)';
  const strokeBot = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)';
  /* Inline text + accent colors. */
  const textDim    = isLight ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.50)';
  const textMid    = isLight ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.70)';
  const textBold   = isLight ? 'rgba(0, 0, 0, 0.80)' : 'rgba(255, 255, 255, 0.78)';
  const strikeOutline = isLight ? 'rgba(0, 0, 0, 0.50)' : 'rgba(255, 255, 255, 0.85)';
  const plateStroke   = isLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.55)';
  /* Neutral cell fill (zone value 1 = "Average") — flips dark on
     light so the cell still reads as a soft tint instead of
     disappearing into the white surface. */
  const neutralCellFill = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.18)';
  // Non-uniform cell sizing — outer ring ~55% of inner cell size.
  const COL_WIDTHS  = [28, 52, 52, 52, 28]; // sum = 212
  const ROW_HEIGHTS = [32, 56, 56, 56, 32]; // sum = 232
  const gridW = COL_WIDTHS.reduce((s, n) => s + n, 0);
  const gridH = ROW_HEIGHTS.reduce((s, n) => s + n, 0);

  // Canvas leaves room below the grid for the home-plate icon + legend.
  const W = 290;
  const H = 380;
  const ox = (W - gridW) / 2;
  const oy = 28;

  // Cumulative x/y origins per col/row for non-uniform placement.
  const colX: number[] = [];
  COL_WIDTHS.reduce((acc, w) => { colX.push(acc); return acc + w; }, ox);
  const rowY: number[] = [];
  ROW_HEIGHTS.reduce((acc, h) => { rowY.push(acc); return acc + h; }, oy);

  // Strike-zone box geometry (inner 3×3) — used for the bold outline
  // AND the home-plate icon alignment below.
  const strikeX = colX[1];
  const strikeY = rowY[1];
  const strikeW = COL_WIDTHS[1] + COL_WIDTHS[2] + COL_WIDTHS[3];
  const strikeH = ROW_HEIGHTS[1] + ROW_HEIGHTS[2] + ROW_HEIGHTS[3];

  // Green / red fills made more see-through — the solid #F87171 / #4ADE80
  // hexes used to read as fully opaque tiles, so colored cells dominated
  // the heat map. Dropping to ~55% alpha lets the dark-navy backdrop +
  // grid lines bleed through, keeping the color cue readable without
  // washing out the cell texture underneath.
  const FILLS: Record<number, string> = {
    0: 'rgba(248, 113, 113, 0.55)',
    1: neutralCellFill,
    2: 'rgba(74, 222, 128, 0.55)',
  };
  const cellAt = (r: number, c: number): 0 | 1 | 2 => {
    const isStrike = r >= 1 && r <= 3 && c >= 1 && c <= 3;
    if (isStrike) {
      const inner = (r - 1) * 3 + (c - 1);
      return (zoneColors[inner] ?? 1) as 0 | 1 | 2;
    }
    if (!borderZoneColors) return 1;
    let idx = -1;
    if (r === 0) idx = c;
    else if (r === 4) idx = 5 + c;
    else if (c === 0) idx = 10 + (r - 1);
    else if (c === 4) idx = 13 + (r - 1);
    return (borderZoneColors[idx] ?? 1) as 0 | 1 | 2;
  };
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const v = cellAt(r, c);
      const isStrike = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      cells.push(
        <rect key={`${r}-${c}`}
          x={colX[c]} y={rowY[r]}
          width={COL_WIDTHS[c]} height={ROW_HEIGHTS[r]}
          fill={FILLS[v]} stroke="var(--border)"
          strokeWidth={isStrike ? 0.7 : 0.5} rx={2} opacity={isStrike ? 0.95 : 0.55} />,
      );
    }
  }

  // Home-plate pentagonal path — flat top aligns with strike zone width,
  // point tucks downward (catcher's view). Faint fill + outline so it
  // reads as a guide icon, not a UI surface. Gap below the grid bumped
  // further (16 → 32 → 56) to drop the plate lower inside the bubble.
  const plateTopY = oy + gridH + 56;
  const plateH = 26;
  const plateCx = strikeX + strikeW / 2;
  const plateLeft = strikeX;
  const plateRight = strikeX + strikeW;
  const plateBottom = plateTopY + plateH;
  const platePath = `
    M ${plateLeft} ${plateTopY}
    L ${plateRight} ${plateTopY}
    L ${plateRight} ${plateTopY + plateH * 0.42}
    L ${plateCx} ${plateBottom}
    L ${plateLeft} ${plateTopY + plateH * 0.42}
    Z
  `;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 360, margin: '0 auto' }}>
      <defs>
        {/* Vertical gradient for the bubble's stroke. The top of the
            rect uses the full white-22% line the pop-time chip carries;
            the bottom fades down to a much fainter 4% so the bottom
            edge reads as less defined than the rest of the bubble. The
            side edges transition between the two so the dimming feels
            gradual rather than jumping at a hard boundary. */}
        <linearGradient id="border-zones-stroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={strokeTop} />
          <stop offset="65%" stopColor={strokeMid} />
          <stop offset="100%" stopColor={strokeBot} />
        </linearGradient>
        {/* Command-Deck-style fill — same radial composition the page
            hero `.commandDeck` carries (dark-navy with centered white
            highlight at 50% 35%), minus the `::before` blue corner
            glow. Replaces the previous solid pop-time fill so the
            Border Zones bubble matches the Player Name bubble color. */}
        <radialGradient id="border-zones-cmd-deck" cx="50%" cy="35%" r="60%">
          <stop offset="0%"  stopColor={fillStop1} />
          <stop offset="60%" stopColor={fillStop2} />
          <stop offset="100%" stopColor={fillStop3} />
        </radialGradient>
      </defs>
      {/* Backdrop fill now uses the Command-Deck radial gradient (was
          solid dark navy). Stroke keeps its vertical-fade treatment so
          the bottom edge of the Border Zones bubble still reads softer
          than the rest of the outline. */}
      <rect
        x={0} y={0} width={W} height={H}
        fill="url(#border-zones-cmd-deck)"
        stroke="url(#border-zones-stroke)"
        strokeWidth={1.2}
        rx={4}
      />
      {cells}
      {/* Bold strike-zone outline around the inner 3×3 */}
      <rect x={strikeX} y={strikeY}
        width={strikeW} height={strikeH}
        fill="none" stroke={strikeOutline} strokeWidth={2} rx={2} />
      <text x={W / 2} y={16} textAnchor="middle" fontSize={9} fontFamily={MONO} fontWeight={700}
            fill={textDim} letterSpacing="0.24em">BORDER ZONES</text>
      <text x={W / 2} y={strikeY + 14} textAnchor="middle" fontSize={9} fontFamily={MONO} fontWeight={700}
            fill={textBold} letterSpacing="0.22em">STRIKE ZONE</text>

      {/* Home-plate reference (catcher's view) */}
      <path
        d={platePath}
        fill="var(--border)"
        stroke={plateStroke}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <text x={plateCx} y={plateTopY + plateH * 0.42 + 4} textAnchor="middle"
            fontSize={7} fontFamily={MONO} fontWeight={700}
            fill="var(--text-muted)" letterSpacing="0.20em">HOME</text>

      <g transform={`translate(${ox}, ${H - 8})`}>
        {[
          { v: 2, label: 'Receives well' },
          { v: 1, label: 'Average' },
          { v: 0, label: 'Struggles' },
        ].map((item, i) => (
          <g key={item.v} transform={`translate(${i * 92}, -10)`}>
            <rect width={10} height={10} rx={2} fill={FILLS[item.v]} stroke="var(--border-strong)" />
            <text x={14} y={9} fontSize={10} fill={textMid} fontFamily="inherit">{item.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   FIELD DIAGRAMS — share the spray-chart's HUD aesthetic
   ─────────────────────────────────────────────────────────────────────────── */

const FIELD_W = 520;
const FIELD_H = 460;
const FIELD_CX = FIELD_W / 2;       // 260
const FIELD_CY = FIELD_H - 24;      // 436 = home plate
const FIELD_MAX_DIST = 420;
const FIELD_SCALE = (FIELD_H - 70) / FIELD_MAX_DIST; // ≈ 0.929 px/ft (full field)
/** Infielder mode: zoom the polar mapping so 200 ft fills the same pixel field. */
const IF_MAX_DIST = 200;
const IF_SCALE = (FIELD_H - 70) / IF_MAX_DIST; // ≈ 1.95 px/ft
/** Catcher mode: tighter zoom so 120 ft fills the canvas — keeps the 90 ft
 *  bases prominent while still showing space behind the bag for blocking
 *  range chips. */
const CATCH_MAX_DIST = 120;
const CATCH_SCALE = (FIELD_H - 70) / CATCH_MAX_DIST; // ≈ 3.25 px/ft

function fieldXY(angleDeg: number, dist: number, scale: number = FIELD_SCALE): [number, number] {
  const rad = ((90 - angleDeg) * Math.PI) / 180;
  const r = dist * scale;
  return [FIELD_CX + r * Math.cos(rad), FIELD_CY - r * Math.sin(rad)];
}

/** Shared HUD background — beacon, scan-lines, distance arcs, foul rails, bases, home plate.
 *  Pass `scale` + `distArcs` to render a zoomed-in (e.g. 200-ft "infield only") view. */
function SprayField({
  uid,
  scale = FIELD_SCALE,
  distArcs = [120, 200, 280, 360],
  showZoneLabels = true,
}: {
  uid: string;
  scale?: number;
  distArcs?: number[];
  /** Hides the top-of-field "LEFT / CENTER / RIGHT" zone labels.
   *  Defaults to true (kept on Infield + Outfield diagrams where the
   *  zone labels help with fielder-positioning context). The Catching
   *  Throwing & Blocking diagram passes false because the zones are
   *  irrelevant to a pop-time/blocking readout — the field shape +
   *  base markers already establish orientation. */
  showZoneLabels?: boolean;
}) {
  // Foul lines extend to whatever distance fills the viewBox (same pixel reach in any mode).
  const foulMaxFt = (FIELD_H - 70) / scale;
  return (
    <>
      <defs>
        <pattern id={`scan-${uid}`} x="0" y="0" width="1" height="5" patternUnits="userSpaceOnUse">
          <rect width="1" height="5" fill="transparent" />
          <rect y="0" width="1" height="1" fill="rgba(255,255,255,0.018)" />
        </pattern>
        <radialGradient id={`beacon-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="rgba(126,182,255,0.50)" />
          <stop offset="40%" stopColor="rgba(61,139,253,0.20)" />
          <stop offset="100%" stopColor="rgba(61,139,253,0)" />
        </radialGradient>
      </defs>
      <rect width={FIELD_W} height={FIELD_H} fill={`url(#scan-${uid})`} pointerEvents="none" />
      <circle cx={FIELD_CX} cy={FIELD_CY} r={130} fill={`url(#beacon-${uid})`} pointerEvents="none" />

      {/* Distance arcs — `--spray-gridline-color` matches the
          Movement Plot grid lines exactly. Token: rgba(183,190,201,0.55)
          in dark theme, rgba(80,80,80,0.60) in light, so the dashed
          arcs sit in the same family across the app. */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = FIELD_CX - r * Math.cos(Math.PI / 4);
        const ly = FIELD_CY - r * Math.sin(Math.PI / 4);
        const rx = FIELD_CX + r * Math.cos(Math.PI / 4);
        const ry = FIELD_CY - r * Math.sin(Math.PI / 4);
        return (
          <g key={d}>
            <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`}
              fill="none" stroke="var(--spray-gridline-color)" strokeWidth={0.75} strokeDasharray="3 5" />
            <g transform={`translate(${rx + 6}, ${ry + 4})`}>
              <rect x={-2} y={-9} width={42} height={16} rx={8}
                fill="rgba(10,12,18,0.75)" stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
              <text x={19} y={2.5} fill="rgba(183,190,201,0.8)" fontSize={9}
                fontFamily="'Satoshi', 'DM Sans', sans-serif" fontWeight={600}
                letterSpacing="0.14em" textAnchor="middle">{d}FT</text>
            </g>
          </g>
        );
      })}

      {/* Foul rails — same `--spray-gridline-color` token as the
          distance arcs above so every field line on the diagram
          (foul lines + distance arcs) reads in the same color
          family as the Movement Plot's grid lines. Stroke width
          stays a touch heavier (1.2) than the arcs (0.75) so the
          foul rails still read as the structural major line and
          the arcs as the lighter reference markers. */}
      {(() => {
        const r = foulMaxFt * scale;
        return (
          <>
            <line x1={FIELD_CX} y1={FIELD_CY}
              x2={FIELD_CX - r * Math.cos(Math.PI / 4)}
              y2={FIELD_CY - r * Math.sin(Math.PI / 4)}
              stroke="var(--spray-gridline-color)" strokeWidth={1.2} />
            <line x1={FIELD_CX} y1={FIELD_CY}
              x2={FIELD_CX + r * Math.cos(Math.PI / 4)}
              y2={FIELD_CY - r * Math.sin(Math.PI / 4)}
              stroke="var(--spray-gridline-color)" strokeWidth={1.2} />
          </>
        );
      })()}

      {/* Bases — silver diamonds laid out at real diamond geometry:
            • 1B / 3B at 90 ft, 45° off the foul line
            • 2B at 90√2 ≈ 127 ft straight to center
          Uses the same `scale` as the rest of the field so the diamond
          stays accurate at every zoom level. */}
      {(() => {
        const bases: [number, number, string][] = [
          [...fieldXY(0, 90 * Math.SQRT2, scale), '2B'] as [number, number, string],
          [...fieldXY(-45, 90, scale), '3B'] as [number, number, string],
          [...fieldXY(45, 90, scale), '1B'] as [number, number, string],
        ];
        return bases.map(([bx, by, lbl]) => (
          <rect key={lbl} x={bx - 4} y={by - 4} width={8} height={8}
            fill="rgba(223,227,232,0.82)" stroke="rgba(255,255,255,0.45)" strokeWidth={0.6}
            transform={`rotate(45 ${bx} ${by})`} />
        ));
      })()}

      {/* Home plate — silver pentagon */}
      <polygon
        points={`${FIELD_CX},${FIELD_CY - 6} ${FIELD_CX + 6},${FIELD_CY - 2.5} ${FIELD_CX + 5},${FIELD_CY + 4} ${FIELD_CX - 5},${FIELD_CY + 4} ${FIELD_CX - 6},${FIELD_CY - 2.5}`}
        fill="rgba(223,227,232,0.92)" stroke="rgba(255,255,255,0.5)" strokeWidth={0.75} />

      {/* Top zone labels — gated by `showZoneLabels`. Caller can hide
          them (e.g. the Catching Throwing & Blocking diagram) when
          the zones aren't meaningful for the readout. */}
      {showZoneLabels && (() => {
        const zones = [
          { x: FIELD_W * 0.22, label: 'LEFT' },
          { x: FIELD_W * 0.50, label: 'CENTER' },
          { x: FIELD_W * 0.78, label: 'RIGHT' },
        ];
        return zones.map(z => (
          <text key={z.label} x={z.x} y={18} fill="rgba(183,190,201,0.55)" fontSize={9}
            fontFamily="'Satoshi', 'DM Sans', sans-serif" fontWeight={600}
            letterSpacing="0.28em" textAnchor="middle">{z.label}</text>
        ));
      })()}
    </>
  );
}

/* Catching field with throwing-line stat chips + blocking annotations */
function CatchingFieldDiagram({ popTime, exchange, velocity, leftGrade, centerGrade, rightGrade }: {
  popTime: number | null; exchange: number | null; velocity: number | null;
  leftGrade: number | null; centerGrade: number | null; rightGrade: number | null;
}) {
  /* Theme-aware palette for the six field chips (Pop Time / Velocity /
     Exchange / Block Left / Block Center / Block Right) — flips the
     `catch-cmd-deck-chip` radialGradient to a single FLAT color that
     matches the Coaches Grade chip + the Player Name bubble across
     the Catching Snapshot: `#dee1e5` cool slate in light theme,
     `rgba(10,14,20,0.38)` navy in dark theme. Every hardcoded
     `rgba(255,255,255,…)` text + stroke color used inside this SVG
     flips to its `rgba(0,0,0,…)` counterpart in light so the chip
     values + throw line + "Blocking coverage" caption stay legible
     against the new light surface. Dark theme is unchanged. */
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const flatFill = isLight ? '#dee1e5' : 'rgba(10, 14, 20, 0.38)';
  /* Chip primary value color — replaces the hardcoded `#F1F5F9` so
     it stays readable on the cool-slate light fill. */
  const chipValueColor = isLight ? '#0a0e14' : '#F1F5F9';
  /* Chip secondary text + throw-line + caption — single muted token
     that flips between near-white and near-black so everything stays
     in the same family. */
  const chipMutedColor   = isLight ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.60)';
  const throwLineStroke  = isLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.50)';
  const arrowheadFill    = isLight ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.70)';
  const captionColor     = isLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.40)';
  const L = gradeTone(leftGrade), MID = gradeTone(centerGrade), R = gradeTone(rightGrade);
  const CHIP_FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
  const VBOX_H = 540;          // extra 80 px below home plate for the block fan
  // Catching diagram zooms tighter than the infield view — 120 ft max
  // distance fills the canvas so the 90 ft bases (1B / 2B / 3B) read
  // big and the throw to 2B bag dominates the view. 2B bag pixel
  // position has to use the same scale.
  const [twobX, twobY] = fieldXY(0, 90 * Math.SQRT2, CATCH_SCALE);

  const BlockChip = ({ x, y, label, grade, t }: {
    x: number; y: number; label: string; grade: number | null;
    t: ReturnType<typeof gradeTone>;
  }) => {
    return (
      <g transform={`translate(${x}, ${y})`}>
        {/* Sized 168 × 58 (was 144 × 46) — chips read noticeably bigger
            and still fit inside the 520-wide field viewBox alongside
            the wider fan offset (±172) used by the block trio below. */}
        <rect x="-76" y="-29" width="152" height="58" rx="10"
          fill="url(#catch-cmd-deck-chip)" stroke="var(--border-light)" strokeWidth="1" />
        <text x="0" y="-7" textAnchor="middle" fontSize="12" fontFamily={CHIP_FONT} fontWeight="600"
          fill="var(--text-muted)" letterSpacing="0.12em">{label}</text>
        <text x="0" y="17" textAnchor="middle" fontSize="22" fontFamily={CHIP_FONT} fontWeight="700"
          fill={t.text} letterSpacing="-0.01em" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {grade !== null ? grade : '—'}
        </text>
      </g>
    );
  };

  const StatChip = ({ y, label, value, unit }: {
    y: number; label: string; value: number | null; unit: string;
  }) => (
    <g transform={`translate(${FIELD_CX}, ${y})`}>
      {/* Same bigger chip — 168 × 58 (was 144 × 46) — centered on
          FIELD_CX so label + value both anchor to middle. */}
      <rect x="-76" y="-29" width="152" height="58" rx="10"
        fill="url(#catch-cmd-deck-chip)" stroke="var(--border-light)" strokeWidth="1" />
      <text x="0" y="-7" textAnchor="middle" fontSize="12" fontFamily={CHIP_FONT} fontWeight="600"
        fill="var(--text-muted)" letterSpacing="0.12em">{label}</text>
      <text x="0" y="17" textAnchor="middle" fontSize="22" fontFamily={CHIP_FONT} fontWeight="700"
        fill={chipValueColor} letterSpacing="-0.01em" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value !== null ? (unit === 'mph' ? value.toFixed(0) : value.toFixed(2)) : '—'}
        <tspan fontSize="13" fontFamily={CHIP_FONT} fontWeight="500"
               fill={chipMutedColor} letterSpacing="0.04em" dx="4">{unit}</tspan>
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${FIELD_W} ${VBOX_H}`} preserveAspectRatio="xMidYMid meet"
         style={{
           display: 'block', width: '100%', height: 'auto',
           /* `maxWidth: 420` — at 380 the field came up short, at
              455 it ran tall, so 420 is the midpoint that lines the
              field's rendered height (≈ 436px) with the heat map's
              typical rendered height. The heat map's actual width
              depends on viewport (the 0.61 share of the inner 2-col
              grid), but 420 lands roughly in the middle of where
              that lives at 1200–1440px viewports. */
           maxWidth: 420, margin: '0 auto',
           /* Two-layer drop-shadow that mirrors the canonical
              `--bubble-shadow` token (`0 3px 8px rgba(0,0,0,0.14),
              0 12px 26px rgba(15,20,30,0.16)`) every outer bubble
              across the athlete profile uses. Replaces the previous
              `drop-shadow(0 6px 18px rgba(0,0,0,0.55))` heavy black
              shadow — at 55% opacity it sat 3–4× darker than the
              rest of the app's surfaces, especially noticeable in
              light theme where the surrounding panel chrome already
              carries the same soft canonical lift. Chained
              `drop-shadow()` filters compose the same way the
              `box-shadow` comma stack does on every other surface,
              so the field SVG now reads at the same depth weight as
              its outer pane bubble. */
           filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.14)) drop-shadow(0 12px 26px rgba(15,20,30,0.16))',
         }}>
      <defs>
        {/* Command-Deck-style fill for the StatChip + BlockChip rects
            below. Mimics the page-hero `.commandDeck` background —
            dark-navy with a centered white highlight at 50% 35% —
            minus the `::before` blue corner glow. */}
        <radialGradient id="catch-cmd-deck-chip" cx="50%" cy="35%" r="60%">
          {/* All three stops pinned to the SAME `flatFill` value so
              the gradient renders FLAT — no radial highlight vignette
              — and the six chips read in the exact same surface color
              as the Coaches Grade chip + Player Name bubble. */}
          <stop offset="0%"  stopColor={flatFill} />
          <stop offset="60%" stopColor={flatFill} />
          <stop offset="100%" stopColor={flatFill} />
        </radialGradient>
      </defs>
      {/* `showZoneLabels={false}` strips the LEFT / CENTER / RIGHT
          eyebrow at the top of the field — irrelevant on a Throwing
          & Blocking readout and visually noisy above the Pop Time /
          Velocity / Exchange chips. */}
      <SprayField uid="catch" scale={CATCH_SCALE} distArcs={[30, 60, 90, 120]} showZoneLabels={false} />

      {/* Throwing line — home → 2B-bag, dashed */}
      <line x1={FIELD_CX} y1={FIELD_CY - 8} x2={twobX} y2={twobY + 4}
        stroke={throwLineStroke} strokeWidth="1.6" strokeDasharray="7 5" />
      <polygon points={`${twobX - 6},${twobY + 6} ${twobX + 6},${twobY + 6} ${twobX},${twobY - 2}`}
        fill={arrowheadFill} />

      {/* Stat chips spaced along the throw — Y values driven by actual
          field distances (fieldXY at center / 0°) so they line up with
          the same-distance arcs on the catching field:
            • Pop Time → 120 ft (top arc, just under 2B / Center)
            • Velocity → 60 ft (mid-throw)
            • Exchange → stays close to home plate */}
      <StatChip y={fieldXY(0, 120, CATCH_SCALE)[1]} label="POP TIME" value={popTime} unit="s" />
      {/* Velocity + Exchange nudged up another notch — total ~22px
          higher than their original positions (was -10, now -22 vs the
          field-distance baseline / fixed 400 baseline). Pop Time stays
          anchored at the 120-ft arc. */}
      <StatChip y={fieldXY(0, 60,  CATCH_SCALE)[1] - 22} label="VELOCITY" value={velocity} unit="mph" />
      <StatChip y={378} label="EXCHANGE" value={exchange} unit="s" />

      {/* Block fan beneath home plate — Left/Right pushed further out
          from ±172 → ±184 so each outer chip sits with more breathing
          room from the centered chip. To make that extra spread fit
          inside the 520-wide field viewBox, the chip width was nudged
          from 168 → 152 (half-width 76) — see BlockChip / StatChip
          above. Outer chips still ride lifted vs the centered chip so
          the trio reads as a fan.

          Y-values lifted ~24 px (Left/Right 482 → 458, Center 500 →
          476, fan arc 480/520 → 456/496) so the trio reads as a
          distinct cluster separated from the "Blocking coverage
          behind home plate" caption at the bottom of the viewBox.
          The previous spacing put the center chip at y=500 with the
          caption at y=532 — only ~32 px of breathing room. The new
          y-values give ~56 px of clear space below the trio. */}
      <path d={`M ${FIELD_CX - 184} 456 Q ${FIELD_CX} 496 ${FIELD_CX + 184} 456`}
        fill="none" stroke="var(--border-light)" strokeWidth="1" strokeDasharray="2 4" />
      <BlockChip x={FIELD_CX - 184} y={458} label="BLOCK LEFT"   grade={leftGrade}   t={L} />
      <BlockChip x={FIELD_CX}        y={476} label="BLOCK CENTER" grade={centerGrade} t={MID} />
      <BlockChip x={FIELD_CX + 184} y={458} label="BLOCK RIGHT"  grade={rightGrade}  t={R} />

      <text x={FIELD_CX} y={VBOX_H - 8} textAnchor="middle" fontSize="11" fontFamily={CHIP_FONT} fontWeight="600"
        fill={captionColor} fontStyle="italic">Blocking coverage behind home plate</text>
    </svg>
  );
}

/* Position-aware field for infielders/outfielders */
function PositionFieldDiagram({ mode, positionDot, rangeLeft, rangeRight, rangeIn, rangeBack, armGrade, armVelo, maxWidth = 560 }: {
  mode: 'infield' | 'outfield';
  positionDot: { x: number; y: number; label: string };
  rangeLeft: number | null; rangeRight: number | null; rangeIn: number | null; rangeBack: number | null;
  armGrade: number | null; armVelo: number | null;
  maxWidth?: number;
}) {
  const isOF = mode === 'outfield';
  const CHIP_FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

  // Arm target — IF throws to 1B, OF throws home
  // Use the same scale the field renders at so the arm-strength line lands on 1B.
  const fieldScale = isOF ? FIELD_SCALE : IF_SCALE;
  const [armTargetX, armTargetY] = isOF ? [FIELD_CX, FIELD_CY] : fieldXY(45, 90, IF_SCALE);
  const armTargetLabel = isOF ? 'to Home' : 'to 1B';

  // Player faces home — arrow basis
  const fwdX = FIELD_CX - positionDot.x;
  const fwdY = FIELD_CY - positionDot.y;
  const fwdMag = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1;
  const inUx = fwdX / fwdMag, inUy = fwdY / fwdMag;
  const rightUx = inUy, rightUy = -inUx;

  // Horizontal chips (Left/Right) need more room because the 144-wide
  // chips would overlap the position dot at a shorter offset. Vertical
  // chips (In/Back) only need the chip-half-height of clearance, so
  // they sit much closer to the position dot.
  const ARROW_LEN_H = 100;
  const ARROW_LEN_V = 50;
  const ArrowChip = ({ dir, grade }: { dir: 'L' | 'R' | 'I' | 'B'; grade: number | null }) => {
    const t = gradeTone(grade);
    let dx = 0, dy = 0;
    if (dir === 'L') { dx = -rightUx * ARROW_LEN_H; dy = -rightUy * ARROW_LEN_H; }
    if (dir === 'R') { dx =  rightUx * ARROW_LEN_H; dy =  rightUy * ARROW_LEN_H; }
    if (dir === 'I') { dx =  inUx    * ARROW_LEN_V; dy =  inUy    * ARROW_LEN_V; }
    if (dir === 'B') { dx = -inUx    * ARROW_LEN_V; dy = -inUy    * ARROW_LEN_V; }
    const dirLabel = dir === 'L' ? 'RANGE LEFT' : dir === 'R' ? 'RANGE RIGHT' : dir === 'I' ? 'RANGE IN' : 'RANGE BACK';
    const tipX = positionDot.x + dx;
    const tipY = positionDot.y + dy;
    return (
      <g>
        <line x1={positionDot.x} y1={positionDot.y} x2={tipX} y2={tipY}
          stroke={t.stroke} strokeWidth="1.3" strokeDasharray="3 2" />
        <g transform={`translate(${tipX}, ${tipY})`}>
          {/* Match the Catching Pop Time chip — 144 × 46, neutral fill +
              stroke, 10px centered label + 18px centered value. */}
          <rect x="-72" y="-23" width="144" height="46" rx="9"
            fill="rgba(20,24,32,0.92)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
          <text x="0" y="-5" textAnchor="middle" fontSize="10" fontFamily={CHIP_FONT} fontWeight="600"
            fill="var(--text-muted)" letterSpacing="0.12em">{dirLabel}</text>
          <text x="0" y="15" textAnchor="middle" fontSize="18" fontFamily={CHIP_FONT} fontWeight="700"
            fill={t.text} letterSpacing="-0.01em" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {grade !== null ? grade : '—'}
          </text>
        </g>
      </g>
    );
  };

  const armToneObj = gradeTone(armGrade);
  const armMidX = (positionDot.x + armTargetX) / 2;
  const armMidY = (positionDot.y + armTargetY) / 2;

  return (
    <svg viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth, margin: '0 auto', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.55))' }}>
      <SprayField
        uid={`pos-${mode}`}
        scale={fieldScale}
        distArcs={isOF ? undefined : [60, 120, 200]}
      />

      {/* Arm-strength line + chip */}
      <line x1={positionDot.x} y1={positionDot.y} x2={armTargetX} y2={armTargetY}
        stroke={armToneObj.stroke} strokeWidth="1.7" strokeDasharray="6 4" opacity="0.85" />
      <g transform={`translate(${armMidX}, ${armMidY})`}>
        {/* Match the Catching Pop Time chip — 144 × 46, neutral fill +
            stroke, 10px centered label + 18px centered value. */}
        <rect x="-72" y="-23" width="144" height="46" rx="9"
          fill="rgba(20,24,32,0.92)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
        <text x="0" y="-5" textAnchor="middle" fontSize="10" fontFamily={CHIP_FONT} fontWeight="600"
          fill="var(--text-muted)" letterSpacing="0.12em">
          ARM {armTargetLabel.toUpperCase()}
        </text>
        <text x="0" y="15" textAnchor="middle" fontSize="18" fontFamily={CHIP_FONT} fontWeight="700"
          fill={armToneObj.text} letterSpacing="-0.01em" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {armVelo !== null ? `${armVelo.toFixed(0)} mph` : armGrade !== null ? armGrade : '—'}
        </text>
      </g>

      {/* Range arrows */}
      <ArrowChip dir="L" grade={rangeLeft} />
      <ArrowChip dir="R" grade={rangeRight} />
      <ArrowChip dir="I" grade={rangeIn} />
      <ArrowChip dir="B" grade={rangeBack} />

      {/* Position dot */}
      <circle cx={positionDot.x} cy={positionDot.y} r="16"
        fill="rgba(135,175,255,0.20)" stroke="rgba(135,175,255,0.60)" strokeWidth="1" />
      <circle cx={positionDot.x} cy={positionDot.y} r="9"
        fill="#cfe0ff" stroke="rgba(255,255,255,0.85)" strokeWidth="1.3" />
      <text x={positionDot.x} y={positionDot.y + 3.5} textAnchor="middle"
        fontSize="10" fontFamily={CHIP_FONT} fontWeight="800" fill="#0e1116">{positionDot.label}</text>

      <text x={FIELD_CX} y={FIELD_H - 6} textAnchor="middle" fontSize="11" fontFamily={CHIP_FONT} fontWeight="600"
        fill="rgba(255,255,255,0.40)" fontStyle="italic">
        {mode === 'infield' ? 'Range coverage at the bag · arm strength to 1B' : 'Range coverage in the gap · arm strength to home'}
      </text>
    </svg>
  );
}

/* Default fielder spots — polar (angle, distance) → screen XY in spray-chart coords. */
const INFIELD_POLAR: Record<string, { angle: number; dist: number; label: string }> = {
  '1B': { angle:  42, dist: 96,  label: '1B' },
  '2B': { angle:  22, dist: 115, label: '2B' },
  'SS': { angle: -28, dist: 130, label: 'SS' },   // deeper, behind the 2B-3B baseline
  '3B': { angle: -42, dist: 96,  label: '3B' },
};
const OUTFIELD_POLAR: Record<string, { angle: number; dist: number; label: string }> = {
  'LF': { angle: -22, dist: 260, label: 'LF' },
  'CF': { angle:   0, dist: 290, label: 'CF' },
  'RF': { angle:  22, dist: 260, label: 'RF' },
};
const polarToPos = (p: { angle: number; dist: number; label: string }, scale: number) => {
  const [x, y] = fieldXY(p.angle, p.dist, scale);
  return { x, y, label: p.label };
};
// IF positions render at IF_SCALE so they sit on the 200-ft "infield only" diamond.
const INFIELD_POSITIONS: Record<string, { x: number; y: number; label: string }> =
  Object.fromEntries(Object.entries(INFIELD_POLAR).map(([k, p]) => [k, polarToPos(p, IF_SCALE)]));
const OUTFIELD_POSITIONS: Record<string, { x: number; y: number; label: string }> =
  Object.fromEntries(Object.entries(OUTFIELD_POLAR).map(([k, p]) => [k, polarToPos(p, FIELD_SCALE)]));

/* Underlying stats row — shared */
type StatCell =
  | { kind: 'metric'; label: string; value: number | null; unit: string; decimals?: number }
  | { kind: 'grade'; label: string; grade: number | null };

/* ─────────────────────────────────────────────────────────────────────────
   DefensiveSnapshot — shared two-column snapshot used by the Infielder
   and Outfielder dashboards. Left pane is the silhouette stage with four
   metric callouts (Arm Strength, Glove, Range) anchored to
   body parts via dashed leader lines. Right pane is the Underlying
   Metrics list — same three skills with their composite /80 grade and
   the two sub-metrics that drive it.

   `mode` switches the accent color (infield orange, outfield green) +
   silhouette image so a single component renders both positions.
   ───────────────────────────────────────────────────────────────────── */

interface DefensiveCallout {
  /** Top-line value (e.g. "82" or "0.42"). */
  value: string | number | null;
  /** Unit suffix (e.g. "mph", "grade", "s"). */
  unit: string;
}

interface DefensiveMetricGroup {
  title: string;
  grade: number | null;
  rows: { label: string; value: string | number | null; unit?: string }[];
}

/* ── Pitching color scheme — applied to the Outfielder Snapshot ──
   Three concentric bubble styles mirroring the Pitching tab:
     • Command-Deck (dark navy + radial highlight, inset shadows, 28px
       radius) — used for the OUTER snapshot shell.
     • Pitch-Report (graphite radial gradient, soft border, 12px
       radius) — used for the SECOND-LEVEL cards (Defensive Skills +
       Underlying Metrics shells).
     • Pop-Time chip (solid `rgba(20,24,32,0.92)` + `rgba(255,255,255,0.22)`
       white border, 1.2px stroke) — used for the THIRD-LEVEL cards
       (silhouette stage + the four metric-group cards on the right).

   Only applied when `mode === 'outfield'` so the Infielder Snapshot
   keeps its earlier styling.

   Bubble backgrounds reference theme-aware CSS variables
   (`--defense-outer-bg` / `--defense-inner-bg` /
   `--defense-poptime-bg` — defined in globals.css) so the
   surfaces flip cleanly between the dark Pitching-style chrome
   (dark theme) and the inverted white-shine + `#ededed` palette
   (light theme) used by every other panel on the player profile.
   The dark-navy values still render in dark mode because the
   variables resolve to their dark `:root` defaults there. */
const ofOuterBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-outer-bg)',
  border: '1px solid var(--border-light)',
  borderRadius: 28,
  boxShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.05),' +
    'inset 0 0 24px rgba(0, 0, 0, 0.35),' +
    '0 1px 2px rgba(0, 0, 0, 0.25)',
  overflow: 'hidden',
  position: 'relative',
};

const ofInnerBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-inner-bg)',
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  position: 'relative',
};

const ofPopTimeBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-poptime-bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  position: 'relative',
};

/* Top-right date chip used on every Snapshot/Report header. Takes a
   pre-formatted label (e.g. "Apr 3, 2026") and renders the same
   muted bordered pill that the Hitting Snapshot and Pitch Report
   headers use. Returns null when the label is null/empty so the
   right slot collapses cleanly. */
function SnapshotDateChip({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <span style={{
      alignSelf: 'flex-end',
      marginBottom: 12,
      fontSize: 10,
      color: 'var(--text-muted)',
      letterSpacing: '0.10em',
      padding: '3px 9px',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border)',
      whiteSpace: 'nowrap',
      /* Inherited Satoshi instead of DM Mono — every grey-bubble
         text element now uses the same Font D family. */
      fontFamily: 'inherit',
    }}>
      {label}
    </span>
  );
}

function formatSnapshotDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function DefensiveSnapshot({
  mode, title, subtitle,
  silhouette, anchors,
  callouts, metricGroups,
  coachGrades, notes,
  headerRightSlot,
}: {
  mode: 'infield' | 'outfield';
  title: string;
  subtitle?: string;
  /** Optional right-edge content for the SectionHeader row (e.g. the
   *  data-date-range chip used on every Snapshot/Report header). */
  headerRightSlot?: React.ReactNode;
  /** Data URL or path for the player silhouette PNG/SVG. */
  silhouette: string;
  /** Per-callout body-anchor coordinates in the SVG's viewBox space
   *  (460×320). Each callout's card is fixed; the line + dot positions
   *  are what change per silhouette pose. */
  anchors: {
    armStrength: [number, number];
    glove: [number, number];
    range: [number, number];
  };
  callouts: {
    armStrength: DefensiveCallout;
    glove: DefensiveCallout;
    range: DefensiveCallout;
  };
  metricGroups: DefensiveMetricGroup[];
  /** Optional Coach Grades panel rendered inside the bubble, directly
   *  below the Defensive Skills + Underlying Metrics columns. */
  coachGrades?: React.ReactNode;
  /** Optional Diagnosis Notes block rendered below the section grid.
   *  Coach edits in place; player sees read-only. Same pattern as the
   *  Hitting tab's diagnosis notes and the Catching tab's coaching notes. */
  notes?: React.ReactNode;
}) {
  const accent = mode === 'infield' ? '#F59E0B' : '#22C55E';
  const accentTint = mode === 'infield' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)';
  const accentLine = mode === 'infield' ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.4)';

  const fmt = (v: string | number | null) => v === null || v === undefined ? '—' : String(v);

  // Re-gated to `mode === 'outfield'` per coach-spec: Infielder
  // Snapshot now uses the same `.profilePanel` chrome as Hitting
  // Snapshot (white-shine in light theme, dark navy in dark) so
  // the bubble visually matches every other top-level Snapshot
  // bubble across the player profile. Outfielder keeps its
  // Pitching-style Command-Deck chrome (dark navy + inset shadows
  // + 28 px radius) — its inset dark shadows are essential to the
  // Pitch-Report-style depth treatment.
  const isOutfield = mode === 'outfield';

  return (
    <Section>
      <div
        /* Outfield uses the Pitching Command-Deck chrome (dark navy +
           radial highlight + 28px radius + inset shadows). Infield
           keeps the shared `.profilePanel` chrome. */
        className={isOutfield ? undefined : aStyles.profilePanel}
        /* Outer flex column gap 18 → 14 (≈0.85rem) so the
           SectionHeader's accent line sits the same distance above
           the two-column body grid as the Tool Grades accent line
           sits above its first inner row. */
        style={isOutfield
          ? { ...ofOuterBubbleStyle, display: 'flex', flexDirection: 'column', gap: 14, padding: '10px 18px 18px' }
          : { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10 }}
      >
        {/* Header — italic title only; the leading emoji icon
            (🧤 / 🥎) was retired so the Infielder / Outfielder
            Snapshot reads with title text alone. `rightSlot` is the
            top-right date-range chip set by the parent tab. */}
        <SectionHeader
          title={title}
          subtitle={subtitle}
          rightSlot={headerRightSlot}
        />

        {/* Three-column body — equal 1fr each so Defensive Skills, the
            metric bubbles (Arm Strength / Glove / Range), and Coach Grades
            all render the same width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 18,
          alignItems: 'start',
        }}>
          {/* Left — Defensive Skills */}
          <div
            /* Infield's Defensive Skills shell now wears
               `--bubble-chrome-bg` (the near-white Swing color) in
               light theme — same surface Outfield's shell picks up
               via `ofInnerBubbleStyle` + `--defense-inner-bg`. The
               interior metric chips (Arm Strength / Range / Glove)
               flip to cool-slate `--panel-bg-light` so
               they lift off the white surface and read as Player-
               Name-bubble-colored chips inside a white frame.
               Previously this pane used `--panel-bg-light` (cool
               slate) directly, which made the interior chips
               (which were also near-white) sit on a darker outer —
               the inverse of what coach-spec now calls for.
               Dark theme falls back to the default `.innerPanel`
               chrome (graphite gradient) via the className cascade
               because `--bubble-chrome-bg` is only defined in
               `[data-theme="light"]`. */
            className={isOutfield ? undefined : aStyles.innerPanel}
            /* `alignSelf: stretch` makes the Defensive Skills bubble fill the
               full grid-row height — i.e. extend down to the bottom of the
               Range bubble (the tallest of the three columns) — instead of
               stopping at the silhouette's natural height. The player stage
               below grows to fill the extra space. */
            style={isOutfield
              ? { ...ofInnerBubbleStyle, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }
              : {
                  alignSelf: 'stretch',
                  display: 'flex', flexDirection: 'column', gap: 6, padding: 14,
                  background: 'var(--bubble-chrome-bg, var(--card-elev-bg))',
                }}
          >
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 600, fontStyle: 'normal', letterSpacing: '-0.025em', textTransform: 'uppercase', color: 'var(--text-bright)', lineHeight: 1.05 }}>Defensive Skills</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Foundational tools</span>
            </div>

            <div style={{
                  /* Player Model stage — TRANSPARENT in both
                     Infield + Outfield per coach-spec. The
                     surrounding Defensive Skills bubble (white
                     in light, dark in dark) supplies the stage
                     backdrop; the silhouette image itself
                     carries the blue tint via the `silhouette-
                     blue` SVG filter below so the model reads
                     as a blue figure floating in the white
                     bubble rather than a colored chip sitting
                     in a dark-navy stage. */
                  padding: '0 0 8px',
                  /* flex:1 → the stage grows to fill the now-stretched
                     Defensive Skills bubble (which extends to the bottom of
                     the Range bubble). The player model scales up + centers
                     in the extra height. */
                  flex: 1,
                  minHeight: 200,
                  position: 'relative',
                }}>
              {/* viewBox cropped 460→330 wide (trims the empty right margin
                  past the callout cards) so the player + cards scale up ~1.4×;
                  `xMidYMid` centers them vertically in the taller stage. */}
              <svg width="100%" height="100%" viewBox="0 36 330 240" preserveAspectRatio="xMidYMid meet"
                   style={{ display: 'block', height: '100%' }}>
                <defs>
                  {/* Command-Deck-style fill for the four callout
                      chips. Mimics the page-hero `.commandDeck`
                      background (rgba(10,14,20,0.38) with a centered
                      white radial highlight at 50% 35%) so the chips
                      read with the same dark-navy depth as the Player
                      Name bubble — minus the `::before` blue corner
                      glow, which isn't rendered on these chips. */}
                  <radialGradient id="of-cmd-deck-chip" cx="50%" cy="35%" r="60%">
                    <stop offset="0%"  stopColor="rgba(20, 24, 34, 0.95)" />
                    <stop offset="60%" stopColor="rgba(11, 14, 22, 0.95)" />
                    <stop offset="100%" stopColor="rgba(8, 11, 18, 0.95)" />
                  </radialGradient>
                  {/* Player Model blue tint — matches the SAME 3-stop
                      vertical gradient the player-profile hero
                      `megaName .lastName` uses for the "Brown" half
                      of the player name in light theme. Stops:
                          0%   → #3D8BFD  (bright blue, top)
                          55%  → #1F5FD1  (mid-saturation blue)
                         100%  → #143C82  (deep navy, bottom)
                      Achieved via an alpha-mask + gradient-rect pair
                      rather than the flat-color `feFlood` + feComposite
                      filter from before (feFlood only supports a
                      single solid color so it can't deliver a true
                      gradient). The mask uses the silhouette image's
                      alpha as the visibility map so the body outline
                      stays crisp. */}
                  <linearGradient id="silhouette-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"   stopColor="#3D8BFD"/>
                    <stop offset="55%"  stopColor="#1F5FD1"/>
                    <stop offset="100%" stopColor="#143C82"/>
                  </linearGradient>
                  <mask id="silhouette-mask" style={{ maskType: 'alpha' }}>
                    <image href={silhouette} x="8" y="44" width="180" height="174" preserveAspectRatio="xMidYMid meet" />
                  </mask>
                </defs>
                {/* Callout cards now wear the Player-Name (Command
                    Deck) chrome — dark-navy radial-tinted fill +
                    soft 12%-white border — instead of the pop-time
                    solid + 22% border treatment. */}
                {/* Player Model — a gradient-filled rect masked by
                    the silhouette's alpha so the body outline
                    renders as the same `#3D8BFD → #1F5FD1 → #143C82`
                    vertical gradient as the "Brown" half of the
                    player-profile mega-name in light theme. */}
                <rect
                  x="8" y="44" width="180" height="174"
                  fill="url(#silhouette-gradient)"
                  mask="url(#silhouette-mask)"
                />

                {/* Dashed leader lines from each card to the anchored body
                    part. All three callout chips now sit on the RIGHT of the
                    Player Model (inner edge x=325), stacked Arm Strength /
                    Glove / Range top→bottom, so every leader line starts at
                    x=325 and points left toward its body anchor. */}
                <line x1={196} y1={60}  x2={anchors.armStrength[0]} y2={anchors.armStrength[1]}
                      stroke={accentLine} strokeWidth={0.8} strokeDasharray="3,2" />
                <line x1={196} y1={155} x2={anchors.glove[0]}       y2={anchors.glove[1]}
                      stroke={accentLine} strokeWidth={0.8} strokeDasharray="3,2" />
                <line x1={196} y1={250} x2={anchors.range[0]}       y2={anchors.range[1]}
                      stroke={accentLine} strokeWidth={0.8} strokeDasharray="3,2" />

                {/* Anchor dots */}
                <circle cx={anchors.armStrength[0]} cy={anchors.armStrength[1]} r={3} fill={accent} />
                <circle cx={anchors.glove[0]}       cy={anchors.glove[1]}       r={3} fill={accent} />
                <circle cx={anchors.range[0]}       cy={anchors.range[1]}       r={3} fill={accent} />

                {/* Callout chips — all three stacked just to the RIGHT of the
                    Player Model (inner edge x=185), top→bottom: Arm Strength /
                    Glove / Range. The model + chips were shifted left as a
                    unit so the silhouette sits near the left border; the right
                    of the stage is intentionally open. Fill uses the shared
                    chip background; soft white border mirrors the Spray Chart
                    bubble. */}
                {/* TOP — Arm Strength (moved up; line points at the arm) */}
                <g>
                  <rect x={196} y={40}  width={122} height={40} rx={6}
                        fill="var(--defense-chip-bg)" stroke="var(--border-light)" strokeWidth={1} />
                  <text x={205} y={56} fontSize={11} letterSpacing="2" fill="var(--text-bright)">ARM STRENGTH</text>
                  <text x={205} y={74} fontSize={17} fontWeight={500} fill="var(--text)">
                    {fmt(callouts.armStrength.value)}{' '}
                    <tspan fontSize={11} fill="var(--text-muted)">{callouts.armStrength.unit}</tspan>
                  </text>
                </g>
                {/* MIDDLE — Glove */}
                <g>
                  <rect x={196} y={135} width={122} height={40} rx={6}
                        fill="var(--defense-chip-bg)" stroke="var(--border-light)" strokeWidth={1} />
                  <text x={205} y={151} fontSize={11} letterSpacing="2" fill="var(--text-bright)">GLOVE</text>
                  <text x={205} y={169} fontSize={17} fontWeight={500} fill="var(--text)">
                    {fmt(callouts.glove.value)}{' '}
                    <tspan fontSize={11} fill="var(--text-muted)">{callouts.glove.unit}</tspan>
                  </text>
                </g>
                {/* BOTTOM — Range (moved down; line points at the foot) */}
                <g>
                  <rect x={196} y={230} width={122} height={40} rx={6}
                        fill="var(--defense-chip-bg)" stroke="var(--border-light)" strokeWidth={1} />
                  <text x={205} y={246} fontSize={11} letterSpacing="2" fill="var(--text-bright)">RANGE</text>
                  <text x={205} y={264} fontSize={17} fontWeight={500} fill="var(--text)">
                    {fmt(callouts.range.value)}{' '}
                    <tspan fontSize={11} fill="var(--text-muted)">{callouts.range.unit}</tspan>
                  </text>
                </g>
              </svg>
            </div>

            {/* Arm Strength now lives in the Underlying Metrics column
                (per coach-spec) alongside Glove + Range, so the Defensive
                Skills column is just the Player Model stage. */}
          </div>

          {/* Metric bubbles column — Arm Strength / Glove / Range stacked;
              the 2nd of three equal-width columns (Defensive Skills | metric
              bubbles | Coach Grades). Each card stands alone in the Swing
              bubble color (`--bubble-chrome-bg`). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {metricGroups.map((g) => (
                <div
                  key={g.title}
                  style={{
                    /* Arm Strength / Glove / Range cards now wear the Swing
                       bubble color (`--bubble-chrome-bg` — #eaeaea in light,
                       warm-grey glass in dark), matching the Swing bubble in
                       the Hitting tab. Applied to BOTH Infield + Outfield now
                       that the Underlying Metrics frame is gone, so each card
                       reads as its own standalone Swing-colored bubble. */
                    background: 'var(--bubble-chrome-bg)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 8,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: 8, paddingBottom: 8,
                    /* Divider between the title row and the metrics — uses the
                       shared `--border` token (theme-aware) so it matches the
                       dividers under Coach Grades in both light + dark themes. */
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                    }}>
                      {/* Leading bullet dot removed per coach-spec — the title
                          (Arm Strength / Glove / Range) now starts flush. */}
                      <span style={{
                        /* Font D */
                        fontFamily: 'inherit',
                        fontSize: 11.88, letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: 'var(--text-bright)', fontWeight: 600,
                        lineHeight: 1.2,
                      }}>{g.title}</span>
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-bright)' }}>
                      {g.grade ?? '—'}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 2 }}>/80</span>
                    </span>
                  </div>
                  <div style={{
                    display: 'flex', gap: 14,
                    /* Second divider — under the metrics — same `--border`
                       token as the Coach Grades dividers (theme-aware), so all
                       the lines read identically in light + dark. */
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {/* All metric bubbles (Arm Strength / Glove / Range): the
                        two metrics sit side by side, each a centered
                        label-over-value stack — the label centered on top, the
                        metric value centered directly beneath it. */}
                    {g.rows.map((r, i) => (
                      <div key={i} style={{
                        flex: 1,
                        display: 'flex', flexDirection: 'column', gap: 3,
                        alignItems: 'center', textAlign: 'center',
                        fontSize: 12,
                      }}>
                        {/* Match the Hitting tab's metric text colors: label
                            in `--text-bright`, value in `--text`, unit in
                            `--text-muted`. */}
                        <span style={{ color: 'var(--text-bright)' }}>{r.label}</span>
                        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 16 }}>
                          {r.value == null ? '—' : r.value}
                          {r.value != null && r.unit && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400, marginLeft: 2 }}>{r.unit}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          {/* Coach Grades — the 3rd of three equal-width columns (right of
              the metric bubbles), rendered as a vertical list. */}
          {coachGrades}
        </div>

        {/* Diagnosis Notes — inside the same bubble, below the section grid. */}
        {notes && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            {notes}
          </div>
        )}
        {/* Tiny unused accent ref so the linter doesn't gripe if the
            value isn't read elsewhere; it IS used above for hover/glow
            states the design system can extend later. */}
        {accentTint ? null : null}
      </div>
    </Section>
  );
}

function StatsRow({ title, icon, cells }: { title: string; icon: string; cells: StatCell[] }) {
  return (
    <div
      className={aStyles.innerPanel}
      style={{
        padding: '14px 18px', marginBottom: 8,
        display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 18, borderRight: '1px solid var(--border)' }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {cells.map((c, i) => {
          /* Each underlying-stat cell uses the same dark slate chrome as
             the Catching Pop Time / Velocity / Exchange chips so the
             whole "underlying stats" strip reads as a row of spotlight
             chips. Hardcoded light text keeps it readable in both themes. */
          const slateChip: React.CSSProperties = {
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'rgba(20, 24, 32, 0.92)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
          };
          const slateLabel: React.CSSProperties = {
            /* Font D treatment for slate-chip label */
            fontFamily: 'inherit',
            fontSize: 11.88, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--text-bright)',
            lineHeight: 1.2,
          };
          const slateUnit: React.CSSProperties = {
            fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
            color: 'rgba(255, 255, 255, 0.55)', letterSpacing: '0.10em',
          };
          const slateRating: React.CSSProperties = {
            fontSize: 11, color: 'rgba(255, 255, 255, 0.55)', fontStyle: 'italic',
          };
          if (c.kind === 'metric') {
            const has = c.value !== null && c.value !== undefined;
            const decimals = c.decimals ?? (c.unit === 'mph' ? 0 : 2);
            return (
              <div key={i} style={slateChip}>
                <span style={slateLabel}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: has ? '#F1F5F9' : 'rgba(255,255,255,0.40)',
                    letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {has ? c.value!.toFixed(decimals) : '—'}
                  </span>
                  <span style={slateUnit}>{c.unit}</span>
                </span>
              </div>
            );
          } else {
            const grade = c.grade;
            const valueColor = gradeColor(grade);
            const ratingLabel = grade !== null ? gradeLabel(grade) : 'Not graded';
            return (
              <div key={i} style={slateChip}>
                <span style={slateLabel}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: valueColor,
                    letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {grade !== null ? grade : '—'}
                  </span>
                  <span style={slateRating}>{ratingLabel}</span>
                </span>
              </div>
            );
          }
        })}
      </div>
    </div>
  );
}

/* Reusable Snapshot bubble — wraps a 2-pane grid + underlying stats rows */
function SnapshotBubble({ title, subtitle, leftPane, rightPane, notes, headerRightSlot }: {
  title: string;
  subtitle?: string;
  leftPane: { title: string; hint: string; node: React.ReactNode };
  rightPane: { title: string; hint: string; node: React.ReactNode };
  /** Optional content rendered between the two panes and the Underlying
   *  Stats section. Used by the Catching snapshot to host its inline
   *  Coaching Notes editor so it sits inside the bubble, directly under
   *  the heat map / field diagram, above the stats breakdown. Other
   *  consumers (Infield/Outfield/Utility) leave this undefined and keep
   *  their original two-row layout. */
  notes?: React.ReactNode;
  /** Optional right-edge content for the SectionHeader row (e.g. the
   *  data-date-range chip used on every Snapshot/Report header). */
  headerRightSlot?: React.ReactNode;
}) {
  return (
    <Section>
      <div
        className={aStyles.profilePanel}
        /* Outer flex column gap 18 → 14 (≈0.85rem) so the
           SectionHeader's accent line sits the same distance above
           the two-pane body as the Tool Grades accent line sits
           above its first inner row. */
        style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10 }}
      >
        {/* Catching Snapshot header — leading 🧤 icon retired so the
            title text reads alone, matching the other three Snapshot
            headers (Hitting / Infielder / Outfielder). `rightSlot`
            hosts the top-right date-range chip set by the parent tab. */}
        <SectionHeader title={title} subtitle={subtitle} rightSlot={headerRightSlot} />
        {/* `alignItems: 'stretch'` — both panes are FORCED to the
            same height regardless of their natural content height.
            The taller pane drives the shared height; the shorter
            pane stretches to match. Trying to dial individual SVG
            maxWidths to match at every viewport was unreliable
            because the heat map's effective width depends on the
            inner 2-col grid share. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1fr)', gap: 28, alignItems: 'stretch' }}>
          {/* Left pane (Receiving Heat Map) — now wears the Pitch Report
              graphite gradient (same `.hudPlotCanvas` background the
              Movement Plot uses) so the Catching Snapshot's two inner
              panes read in the same visual scheme as the Pitching
              charts. The shared `.innerPanel` className was retired.

              `gap: 8` between the title row and the body wrapper
              matches the title row's own `paddingBottom: 8`, so the
              dividing line below the "Receiving Heat Map" label sits
              equidistant from the label above and the Border Zones +
              Coaches Grade bubbles below. */}
          {/* `padding-bottom: 8` matches the title-row's
              `paddingBottom: 8` and the pane's `gap: 8`, so the
              dividing line sits equidistant between the label above
              it and the Border Zones + Coaches Grade bubbles below,
              AND the bottom of the Coaches Grade bubble sits 8px above
              the pane's bottom edge. */}
          <div
            style={{ ...ofInnerBubbleStyle, display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 14px 8px' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 600, fontStyle: 'normal', letterSpacing: '-0.025em', textTransform: 'uppercase', color: 'var(--text-bright)', lineHeight: 1.05 }}>{leftPane.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{leftPane.hint}</span>
            </div>
            {/* Pane body anchors to the TOP of the available space so
                the Border Zones + Coaches Grade bubbles sit
                immediately under the dividing line (with only the
                pane's 8px gap separating them), instead of floating
                vertically centered in the pane. */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              {leftPane.node}
            </div>
          </div>
          {/* Right pane (Throwing & Blocking field) — matches the left
              pane's tighter spacing exactly: `gap: 8` and `padding:
              '14px 14px 8px'` so the dividing line is equidistant from
              the label/field, and the Catching field's bottom sits 8px
              above the pane bottom — same compact rhythm as the
              Receiving Heat Map pane. */}
          <div
            style={{ ...ofInnerBubbleStyle, display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 14px 8px' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 600, fontStyle: 'normal', letterSpacing: '-0.025em', textTransform: 'uppercase', color: 'var(--text-bright)', lineHeight: 1.05 }}>{rightPane.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{rightPane.hint}</span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              {rightPane.node}
            </div>
          </div>
        </div>
        {notes && (
          /* Notes slot — sits between the two visual panes above and
           * the Underlying Stats below. No surrounding divider here
           * because the parent flex already provides 18px gap to its
           * neighbors. */
          <div>{notes}</div>
        )}
        {/* Underlying Stats section (header + StatsRow strip) retired —
            the snapshot now ends at the Coaching Notes block. */}
      </div>
    </Section>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: CATCHING
   ═══════════════════════════════════════════ */

export function CatchingSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, onEditProfile, reports, videos: playerVideos, onOpenVideos,
}: TabProps) {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  /* Re-sync `selectedReport` from the parent's `reports` array whenever
     it updates (e.g. after the report modal saves a CSV removal or
     notes edit). Without this, the local state holds the PRE-save
     snapshot and every derivation below (catchingAssessment, notes,
     video filter, PDF download) reflects stale data until the user
     re-picks the report from the dropdown. */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);

  // Interactive zone state (local override for clicking zones on profile)
  const [localZoneColors, setLocalZoneColors] = useState<(0 | 1 | 2)[]>([1, 1, 1, 1, 1, 1, 1, 1, 1]);

  /* All Catching reports — fed to the bundle modal's Attach-to-Report
     dropdown so coaches can stamp a Coach Review onto a specific
     catching session. */
  const catchingReports = useMemo(
    () => reports.filter((r) => r.reportType === 'CATCHING')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );

  /* Coach Reviews attached to the active CATCHING report. Surface in
     the per-report panel above the main Video gallery; exclude from
     the main gallery so a single clip doesn't double-render. */
  const attachedReviewIds = useMemo(() => {
    if (!selectedReport?.content) return [] as string[];
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed && Array.isArray(parsed.coachReviewVideoIds)) {
        return parsed.coachReviewVideoIds.filter((s: any) => typeof s === 'string') as string[];
      }
    } catch { /* ignore */ }
    return [] as string[];
  }, [selectedReport]);

  /* ── Coaching Notes state ──
   * Mirrors HittingTab's diagnosis-notes pattern: backed by the active
   * report's top-level `notes` field. The NoteBlock below is editable
   * for coaches, read-only for players. Save is a PATCH to the active
   * report — same per-report-edit semantics the Hitting tab uses for
   * persisting notes, but via updateReport instead of createReport so
   * we don't spawn a new Catching report on every save. */
  const persistedNotes = selectedReport?.notes || '';
  const [catchingNotes, setCatchingNotes] = useState(persistedNotes);
  // When the selected report changes, reset the local edit buffer to
  // the new report's persisted notes (so switching reports doesn't
  // leak in-progress edits across them).
  useEffect(() => {
    setCatchingNotes(persistedNotes);
  }, [persistedNotes]);

  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  /* Capture any save failure so the coach sees an inline error
     beside the Save Notes button — previously the catch block only
     logged to console, leaving the coach believing the notes were
     persisted while the server-rejected text was actually lost on
     reload. */
  const [notesError, setNotesError] = useState<string | null>(null);
  const notesDirty = catchingNotes !== persistedNotes;

  const saveCatchingNotes = async () => {
    if (!selectedReport || !user) return;
    setSavingNotes(true);
    setNotesError(null);
    try {
      await api.updateReport(selectedReport.id, { notes: catchingNotes || undefined });
      setNotesSavedAt(Date.now());
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to save catching notes:', err);
      setNotesError(err?.message || 'Failed to save notes — try again.');
    } finally {
      setSavingNotes(false);
      // Clear the "Saved" confirmation after 2.2s — same timing as Hitting.
      setTimeout(() => setNotesSavedAt(null), 2200);
    }
  };

  const catchingAssessment = useMemo<CatchingAssessment | null>(() => {
    if (!selectedReport?.content) return null;
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed.catchingAssessment) return parsed.catchingAssessment as CatchingAssessment;
    } catch { /* skip */ }
    return null;
  }, [selectedReport]);

  // Use report zone colors if available, otherwise use local state
  const zoneColors = catchingAssessment?.receiving?.zoneColors ?? localZoneColors;

  const handleZoneToggle = (idx: number) => {
    const newColors = [...zoneColors] as (0 | 1 | 2)[];
    // Cycle: white(1) → green(2) → red(0) → white(1)
    newColors[idx] = ((newColors[idx] + 1) % 3) as 0 | 1 | 2;
    setLocalZoneColors(newColors);
  };

  return (
    <>
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        {/* Top-level Download PDF — generates a PDF for the currently
            selected CATCHING report. Same icon-only square pattern as
            the Hitting tab. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!selectedReport) return;
            await generateDefensePdf(player, [selectedReport]);
          }}
          disabled={!selectedReport}
        />
        {/* Videos jump — next to Download PDF, replaces standalone tab. */}
        <VideosIconButton onClick={onOpenVideos} />
        <ReportSelector
          reports={reports}
          reportTypes={['CATCHING']}
          label="Catching"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateDefensePdf(player, [r])}
        />
      </TabBarActions>

      {/* ── Coach Grades panel ── rendered above the snapshot
          (and therefore above the Catching Notes block which lives
          INSIDE the snapshot bubble) per coach-spec. The panel
          returns null on its own when the selected report has no
          grades, so it doesn't add visual chrome when there's
          nothing to show. Gated outside the snapshot data check
          because Coach Grades come from a separate content slot
          (`catchingCoachGrades`) and may be present even when the
          throwing/blocking assessment is empty. */}
      <DefenseCoachGradesPanel
        report={selectedReport}
        position="catching"
        /* Shuffle Velocity readout retired from this panel per coach-spec
           — the value is still captured in the report's Throwing section
           and saved on `catchingAssessment.throwing.shuffleVelocity`, so
           it can be surfaced elsewhere later if needed. The Coach Grades
           panel now reads as a clean 7-chip grade row only. */
        /* Catching surfaces its 7 Throwing Grades here so the Coach
           Grades panel mirrors the catching report exactly. Each grade
           reads from `catchingAssessment.throwing.*.grade`; missing
           values render as em-dash. */
        customGrades={[
          { title: 'Footwork',             score: catchingAssessment?.throwing?.footwork?.grade   ?? null },
          { title: 'Transfer',             score: catchingAssessment?.throwing?.transfer?.grade   ?? null },
          { title: 'Accuracy',             score: catchingAssessment?.throwing?.accuracy?.grade   ?? null },
          { title: 'Arm Path',             score: catchingAssessment?.throwing?.armPath?.grade    ?? null },
          { title: 'Foot Strike Position', score: catchingAssessment?.throwing?.footStrike?.grade ?? null },
          { title: 'Rotation Sequence',    score: catchingAssessment?.throwing?.rotationSeq?.grade?? null },
          { title: 'Arm Deceleration',     score: catchingAssessment?.throwing?.decel?.grade      ?? null },
        ]}
      />

      {!catchingAssessment ? (
        <Section>
          <div className={styles.emptyMsg}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>
              <span role="img" aria-label="catcher">&#x1F9E4;</span>
            </div>
            No catching assessment data available.
            <span className={styles.emptyHint}>
              {isCoach
                ? 'Create a Catching report with assessment data to populate this tab.'
                : 'Ask your coach to complete a catching assessment.'}
            </span>
          </div>
        </Section>
      ) : (() => {
        const t = catchingAssessment.throwing;
        const b = catchingAssessment.blocking;
        const popBest = t.popTime2B?.best ?? null;
        const exchangeBest = t.exchangeTime?.best ?? null;
        const veloBest = t.velocity?.best ?? null;
        const leftG   = b.blockLeft?.grade   ?? b.gloveBodyAngle?.grade ?? null;
        const centerG = b.blockCenter?.grade ?? b.accuracy?.grade       ?? null;
        const rightG  = b.blockRight?.grade  ?? b.recoverySpeed?.grade  ?? null;
        return (
          <div data-pdf-section="catching-snapshot">
          <SnapshotBubble
            title="Catching Report"
            headerRightSlot={<SnapshotDateChip label={formatSnapshotDate(selectedReport?.createdAt)} />}
            leftPane={{
              title: 'Receiving Heat Map',
              hint: 'Strike zone & borders',
              node: (
                /* Two-column inner grid — strike-zone heat map on the
                 * left, six-row Coach Grades panel on the right. minmax
                 * lets the heat map shrink when the bubble narrows so
                 * the grade rows always stay readable. */
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.35fr) minmax(150px, 0.85fr)',
                  gap: 14,
                  alignItems: 'stretch',
                  width: '100%',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StrikeZoneHeatMap5x5
                      zoneColors={zoneColors as (0 | 1 | 2)[]}
                      /* The form persists border colors inside
                         `receiving.borderZoneColors` (alongside the
                         inner-zone colors). The legacy top-level
                         `catchingAssessment.borderZoneColors` is kept
                         as a fallback for older reports. */
                      borderZoneColors={
                        catchingAssessment.receiving?.borderZoneColors
                          ?? catchingAssessment.borderZoneColors
                      }
                    />
                  </div>
                  <ReceivingCoachGrades receiving={catchingAssessment.receiving} />
                </div>
              ),
            }}
            rightPane={{
              title: 'Throwing & Blocking',
              hint: 'Home plate to second base',
              node: (
                <CatchingFieldDiagram
                  popTime={popBest}
                  exchange={exchangeBest}
                  velocity={veloBest}
                  leftGrade={leftG}
                  centerGrade={centerG}
                  rightGrade={rightG}
                />
              ),
            }}
            /* Underlying Stats prop retired — the heat map + field
               diagram + Coaching Notes are the entire snapshot now. */
            notes={
              /* Notes block — lives inside the Catching Snapshot bubble,
                 BETWEEN the two visual panes (heat map + field
                 diagram). The previous "Coaching Notes" eyebrow label
                 was retired; the NoteBlock now uses "Catching Notes"
                 as its own label so the section reads with a single
                 title instead of a duplicated header. */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <NoteBlock
                  label="Catching Notes"
                  value={catchingNotes}
                  onChange={setCatchingNotes}
                  placeholder="Catching mechanics, game management, communication, blocking habits, drill recommendations…"
                  editable={isCoach}
                  rows={5}
                />
                {isCoach && (
                  <div style={{
                    marginTop: 8,
                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                  }}>
                    <button
                      type="button"
                      onClick={saveCatchingNotes}
                      disabled={savingNotes || !notesDirty}
                      style={{
                        padding: '9px 22px',
                        borderRadius: 9,
                        background: notesDirty
                          ? 'linear-gradient(135deg, rgba(74,222,128,0.30), rgba(74,222,128,0.18))'
                          : 'rgba(255,255,255,0.04)',
                        border: notesDirty
                          ? '1px solid rgba(74,222,128,0.55)'
                          : '1px solid var(--border)',
                        color: notesDirty ? '#bbf7d0' : 'var(--text-muted)',
                        fontSize: 12.5,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        cursor: notesDirty && !savingNotes ? 'pointer' : 'not-allowed',
                        opacity: notesDirty && !savingNotes ? 1 : 0.6,
                        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                      }}
                    >
                      {savingNotes ? 'Saving…' : 'Save Notes'}
                    </button>
                    {notesSavedAt && !notesDirty && !notesError && (
                      <span style={{
                        fontSize: 11.5, fontWeight: 600, color: '#86efac',
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}>
                        ✓ Saved
                      </span>
                    )}
                    {/* Inline save-failure surface — wired up in
                       saveCatchingNotes' catch block so a server
                       rejection no longer leaves the coach believing
                       the notes were persisted. */}
                    {notesError && (
                      <span style={{
                        fontSize: 11.5, fontWeight: 600, color: '#fca5a5',
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}>
                        ⚠ {notesError}
                      </span>
                    )}
                  </div>
                )}
              </div>
            }
          />
          </div>
        );
      })()}

      {/* ── Coach Reviews — per-report panel that lives directly
          above the main Video gallery. Surfaces only Coach Review
          clips the coach explicitly attached to THIS catching
          report via the bundle modal's Attach-to-Report dropdown. */}
      {(() => {
        if (!selectedReport || attachedReviewIds.length === 0) return null;
        const attachedVideos = playerVideos.filter((v) => attachedReviewIds.includes(v.id));
        if (attachedVideos.length === 0) return null;
        return (
          <Section>
            <div
              className={aStyles.profilePanel}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <SectionHeader title="Coach Reviews — attached to this report" />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gridAutoRows: 'max-content',
                gap: 12,
                maxHeight: 720,
                overflowY: 'auto',
                paddingRight: 4,
              }}>
                {bundleVideos(attachedVideos).map((b) => {
                  const { prefix } = splitVideoTitle(b.videos[0].title || '');
                  return (
                    <VideoBundleCard
                      key={b.key}
                      videos={b.videos}
                      size="md"
                      playerId={player.id}
                      recordingCategory="CATCHING"
                      onUploaded={onRefresh}
                      reports={catchingReports}
                    />
                  );
                })}
              </div>
            </div>
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        /* Exclude Coach Reviews already attached to the active
           Catching report — those surface in the dedicated panel
           directly above. */
        const reportVideos = playerVideos.filter(v =>
          (videoIds.includes(v.id) || v.category === 'CATCHING')
        ).sort((a, b) => {
          /* `startsWith('Coach Review')` matches BOTH the new
             `Coach Review` prefix and the legacy `Coach Reviewed`
             prefix so older clips still float to the top of the
             gallery after the rename. */
          const aR = a.title.startsWith('Coach Review') ? 0 : 1;
          const bR = b.title.startsWith('Coach Review') ? 0 : 1;
          return aR - bR;
        });
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            {/* Video section wrapped in the same Catching Snapshot
                bubble chrome (`aStyles.profilePanel`) so it reads as a
                sibling panel below the snapshot. The empty-state
                "No video data" message keeps its existing `emptyMsg`
                styling unchanged. */}
            <div
              className={aStyles.profilePanel}
              /* gap: 18 → 14 (≈0.85rem) so the SectionHeader's
                 accent line sits the same distance above the first
                 video tile as the Tool Grades accent line sits above
                 its first inner bubble. */
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Leading 🎬 icon retired — Video section header reads
                  with title text alone. */}
              <SectionHeader title="Video" />
              {hasVideos ? (
                /* 5-column grid capped at 3 visible rows — matches
                   the HittingTab gallery. `grid-auto-rows: max-content`
                   keeps each row sized to the bubble's natural height,
                   and `max-height` caps the visible area to roughly
                   three of those rows; anything beyond becomes
                   scrollable within the section so the gallery never
                   grows the page indefinitely. */
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  marginBottom: 24,
                }}>
                  {/* Cap at 10 most-recent tiles (2 rows × 5 cols);
                      overflow lives in the all-videos page. */}
                  {bundleVideos(reportVideos).slice(0, 10).map((b) => {
                    const { prefix } = splitVideoTitle(b.videos[0].title || '');
                    return (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="md"
                        playerId={player.id}
                        recordingCategory="CATCHING"
                        onUploaded={onRefresh}
                        reports={catchingReports}
                      />
                    );
                  })}
                  {reportVideos.length === 0 && contentVideos.map((v, i) => (
                    <VideoPlaceholder
                      key={`content-${i}`} tag="CATCHING"
                      title={v.name.replace(/\.[^.]+$/, '')}
                      subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                      videoUrl={v.url}
                      playerId={player.id}
                      recordingCategory="CATCHING"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyMsg}>No video data.</div>
              )}
            </div>
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: INFIELD
   ═══════════════════════════════════════════ */

export function InfieldSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, onEditProfile, reports, videos: playerVideos, onOpenVideos,
}: TabProps) {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  /* Sync the selected report with the parent's fresh `reports` array
     after every save. Same rationale as the Catching sub-tab — keeps
     infieldAssessment / notes / video filter from rendering stale
     pre-save data. */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);

  /* Reports + attached-Coach-Reviews wiring — same pattern as
     Catching. */
  const infieldReports = useMemo(
    () => reports.filter((r) => r.reportType === 'INFIELD')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const attachedReviewIds = useMemo(() => {
    if (!selectedReport?.content) return [] as string[];
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed && Array.isArray(parsed.coachReviewVideoIds)) {
        return parsed.coachReviewVideoIds.filter((s: any) => typeof s === 'string') as string[];
      }
    } catch { /* ignore */ }
    return [] as string[];
  }, [selectedReport]);

  const defMetrics = getTabMetrics(topMetrics, TAB_METRICS.defense);
  const hasData = Object.keys(defMetrics).length > 0;
  const gradeKeys = TAB_METRICS.defense.filter(k => topMetrics[k] && GRADE_RANGES[k]);

  const infieldAssessment = useMemo<InfieldAssessment | null>(() => {
    if (!selectedReport?.content) return null;
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed.infieldAssessment) return parsed.infieldAssessment as InfieldAssessment;
    } catch { /* skip */ }
    return null;
  }, [selectedReport]);

  /* Diagnosis Notes — same NoteBlock + save pattern as the Catching and
   * Hitting snapshots. Local edit buffer resets when the user switches
   * reports so in-progress edits don't leak across them. */
  const persistedNotes = selectedReport?.notes || '';
  const [diagnosisNotes, setDiagnosisNotes] = useState(persistedNotes);
  useEffect(() => { setDiagnosisNotes(persistedNotes); }, [persistedNotes]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  const notesDirty = diagnosisNotes !== persistedNotes;

  const saveDiagnosisNotes = async () => {
    if (!selectedReport || !user) return;
    setSavingNotes(true);
    try {
      await api.updateReport(selectedReport.id, { notes: diagnosisNotes || undefined });
      setNotesSavedAt(Date.now());
      onRefresh?.();
    } catch (err) {
      console.error('Failed to save infield notes:', err);
    } finally {
      setSavingNotes(false);
      setTimeout(() => setNotesSavedAt(null), 2200);
    }
  };

  return (
    <>
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        {/* Top-level Download PDF — generates a PDF for the currently
            selected INFIELD report. Same icon-only square pattern as
            the Hitting tab. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!selectedReport) return;
            await generateDefensePdf(player, [selectedReport]);
          }}
          disabled={!selectedReport}
        />
        {/* Videos jump — next to Download PDF, replaces standalone tab. */}
        <VideosIconButton onClick={onOpenVideos} />
        <ReportSelector
          reports={reports}
          reportTypes={['INFIELD']}
          label="Infield"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateDefensePdf(player, [r])}
        />
      </TabBarActions>

      {/* Coach Grades moved INTO the Infielder Snapshot bubble (below the
          Defensive Skills + Underlying Metrics columns) — passed as the
          `coachGrades` prop on <DefensiveSnapshot> below. */}
      {infieldAssessment ? (() => {
        const a = infieldAssessment;
        /* Prefer the coach's manual snapshot entries; fall back to
         * the legacy granular fields + topMetrics for older reports. */
        const ms = a.manualSnapshot;
        const armBest = ms?.armStrength.primary ?? a.arm.velocity?.best ?? null;
        const armAvg  = ms?.armStrength.secondary ?? a.arm.velocity?.avg ?? null;
        const armOverall = ms?.armStrength.overallGrade ?? null;
        const gloveGrade = ms?.glove.overallGrade ?? a.handsGlove.overallGrade ?? null;
        const gloveHands = ms?.glove.primary ?? a.handsGlove.exchanges?.grade ?? null;
        const gloveTransfers = ms?.glove.secondary ?? a.handsGlove.shortHops?.grade ?? null;
        const rangeGrade = ms?.range.overallGrade ?? a.rangeFootwork.overallGrade ?? null;
        const range60 = ms?.range.primary ?? topMetrics.sixty_yard?.value ?? null;
        const rangeAccel = ms?.range.secondary ?? null;

        return (
          <div data-pdf-section="infield-snapshot">
          <DefensiveSnapshot
            mode="infield"
            title="Infielder Report"
            headerRightSlot={<SnapshotDateChip label={formatSnapshotDate(selectedReport?.createdAt)} />}
            /* subtitle retired — Infielder Snapshot now reads with
               title only, mirroring the Hitting / Catching headers. */
            silhouette={INFIELDER_SILHOUETTE}
            anchors={{
              armStrength: [81, 117],  // throwing arm
              glove:       [141, 190], // glove
              range:       [98, 209],  // foot
            }}
            callouts={{
              armStrength: { value: armBest != null ? Math.round(armBest) : null, unit: 'mph' },
              glove:       { value: gloveGrade, unit: 'grade' },
              range:       { value: rangeGrade, unit: 'grade' },
            }}
            metricGroups={[
              {
                title: 'Arm Strength',
                grade: armOverall,
                rows: [
                  { label: 'Max velocity', value: armBest != null ? (Number.isInteger(armBest) ? armBest : armBest.toFixed(1)) : null, unit: 'mph' },
                  { label: 'Avg velocity', value: armAvg  != null ? (Number.isInteger(armAvg)  ? armAvg  : armAvg.toFixed(1))  : null, unit: 'mph' },
                ],
              },
              {
                title: 'Glove',
                grade: gloveGrade,
                rows: [
                  { label: 'Hands',     value: gloveHands ?? null,     unit: 'grade' },
                  { label: 'Transfers', value: gloveTransfers ?? null, unit: 'grade' },
                ],
              },
              {
                title: 'Range',
                grade: rangeGrade,
                rows: [
                  { label: '60 yard dash',   value: range60 != null ? range60.toFixed(1) : null, unit: 's' },
                  { label: '10 Yard Sprint', value: rangeAccel != null ? rangeAccel.toFixed(2) : null, unit: 's' },
                ],
              },
            ]}
            coachGrades={<DefenseCoachGradesPanel report={selectedReport} position="infield" embedded />}
            /* Diagnosis Notes block retired from the Infielder
               Snapshot — the bubble now ends with the Coach Grades
               section (above) below the metric groups grid. The
               underlying `diagnosisNotes` state + save handler are
               still wired up at the tab level in case the notes
               editor returns elsewhere. */
          />
          </div>
        );
      })() : (
        <Section>
          <SectionHeader icon="🧤" iconColor="teal" title="Infield Metrics" subtitle="Arm strength & fielding grades" />
          {hasData ? (
            <>
              <KpiGrid>
                {TAB_METRICS.defense.filter(k => k.includes('infield')).map(key => {
                  const m = defMetrics[key];
                  if (!m) return null;
                  const level = getBadgeLevel(key, m.value);
                  const grade = GRADE_RANGES[key] ? toScoutingGrade(m.value, key) : null;
                  return (
                    <KpiCard
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={m.value.toFixed(key === 'exchange_time' ? 2 : 1)}
                      unit={m.unit}
                      badge={getBadgeText(level) || undefined}
                      badgeLevel={level}
                      color={grade !== null ? scoreColor(grade) : undefined}
                    />
                  );
                })}
              </KpiGrid>

              {defMetrics.infield_velo && (
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ScoreBar
                    label="Infield Arm Strength"
                    value={`${defMetrics.infield_velo.value.toFixed(1)} mph`}
                    percent={(defMetrics.infield_velo.value / 95) * 100}
                    level={getBadgeLevel('infield_velo', defMetrics.infield_velo.value) as any}
                  />
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyMsg}>
              No infield metrics available.
              <span className={styles.emptyHint}>
                {isCoach
                  ? 'Create an Infield report with assessment data, or upload tracking data.'
                  : 'Ask your coach to complete an infield assessment.'}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* Infield Grades + Coaching Notes sections removed — grades are
          surfaced in the Infielder Snapshot's metric groups, and notes
          live inline beneath the snapshot via the Diagnosis Notes
          handler. Both legacy sections were redundant on the dashboard. */}

      {/* ── Coach Reviews — per-report panel above the main Video
          gallery. Surfaces only clips attached to THIS Infield
          report. */}
      {(() => {
        if (!selectedReport || attachedReviewIds.length === 0) return null;
        const attachedVideos = playerVideos.filter((v) => attachedReviewIds.includes(v.id));
        if (attachedVideos.length === 0) return null;
        return (
          <Section>
            <div
              className={aStyles.profilePanel}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <SectionHeader title="Coach Reviews — attached to this report" />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gridAutoRows: 'max-content',
                gap: 12,
                maxHeight: 720,
                overflowY: 'auto',
                paddingRight: 4,
              }}>
                {bundleVideos(attachedVideos).map((b) => {
                  const { prefix } = splitVideoTitle(b.videos[0].title || '');
                  return (
                    <VideoBundleCard
                      key={b.key}
                      videos={b.videos}
                      size="md"
                      playerId={player.id}
                      recordingCategory="INFIELD"
                      onUploaded={onRefresh}
                      reports={infieldReports}
                    />
                  );
                })}
              </div>
            </div>
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          (videoIds.includes(v.id) || v.category === 'INFIELD')
        ).sort((a, b) => {
          /* `startsWith('Coach Review')` matches BOTH the new
             `Coach Review` prefix and the legacy `Coach Reviewed`
             prefix so older clips still float to the top of the
             gallery after the rename. */
          const aR = a.title.startsWith('Coach Review') ? 0 : 1;
          const bR = b.title.startsWith('Coach Review') ? 0 : 1;
          return aR - bR;
        });
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            {/* Video section wrapped in the same Catching Snapshot
                bubble chrome (`aStyles.profilePanel`) so it reads as a
                sibling panel below the snapshot. The empty-state
                "No video data" message keeps its existing `emptyMsg`
                styling unchanged. */}
            <div
              className={aStyles.profilePanel}
              /* gap: 18 → 14 (≈0.85rem) so the SectionHeader's
                 accent line sits the same distance above the first
                 video tile as the Tool Grades accent line sits above
                 its first inner bubble. */
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Leading 🎬 icon retired — Video section header reads
                  with title text alone. */}
              <SectionHeader title="Video" />
              {hasVideos ? (
                /* 5-column grid capped at 3 visible rows — matches
                   the HittingTab gallery. `grid-auto-rows: max-content`
                   keeps each row sized to the bubble's natural height,
                   and `max-height` caps the visible area to roughly
                   three of those rows; anything beyond becomes
                   scrollable within the section so the gallery never
                   grows the page indefinitely. */
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  marginBottom: 24,
                }}>
                  {/* Cap at 10 most-recent tiles (2 rows × 5 cols);
                      overflow lives in the all-videos page. */}
                  {bundleVideos(reportVideos).slice(0, 10).map((b) => {
                    const { prefix } = splitVideoTitle(b.videos[0].title || '');
                    return (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="md"
                        playerId={player.id}
                        recordingCategory="INFIELD"
                        onUploaded={onRefresh}
                        reports={infieldReports}
                      />
                    );
                  })}
                  {reportVideos.length === 0 && contentVideos.map((v, i) => (
                    <VideoPlaceholder
                      key={`content-${i}`} tag="INFIELD"
                      title={v.name.replace(/\.[^.]+$/, '')}
                      subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                      videoUrl={v.url}
                      playerId={player.id}
                      recordingCategory="INFIELD"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyMsg}>No video data.</div>
              )}
            </div>
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: OUTFIELD
   ═══════════════════════════════════════════ */

export function OutfieldSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, onEditProfile, reports, videos: playerVideos, onOpenVideos,
}: TabProps) {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  /* Sync the selected report with the parent's fresh `reports` array
     after every save. Same rationale as the other Defense sub-tabs —
     keeps outfieldAssessment / notes / video filter from rendering
     stale pre-save data. */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);

  /* Reports + attached-Coach-Reviews wiring — same pattern as
     Catching / Infield. */
  const outfieldReports = useMemo(
    () => reports.filter((r) => r.reportType === 'OUTFIELD')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const attachedReviewIds = useMemo(() => {
    if (!selectedReport?.content) return [] as string[];
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed && Array.isArray(parsed.coachReviewVideoIds)) {
        return parsed.coachReviewVideoIds.filter((s: any) => typeof s === 'string') as string[];
      }
    } catch { /* ignore */ }
    return [] as string[];
  }, [selectedReport]);

  const defMetrics = getTabMetrics(topMetrics, TAB_METRICS.defense);
  const hasData = Object.keys(defMetrics).length > 0;
  const gradeKeys = TAB_METRICS.defense.filter(k => topMetrics[k] && GRADE_RANGES[k]);

  const outfieldAssessment = useMemo<OutfieldAssessment | null>(() => {
    if (!selectedReport?.content) return null;
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed.outfieldAssessment) return parsed.outfieldAssessment as OutfieldAssessment;
    } catch { /* skip */ }
    return null;
  }, [selectedReport]);

  /* Diagnosis Notes — same pattern as Infield/Catching/Hitting. */
  const persistedNotes = selectedReport?.notes || '';
  const [diagnosisNotes, setDiagnosisNotes] = useState(persistedNotes);
  useEffect(() => { setDiagnosisNotes(persistedNotes); }, [persistedNotes]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  const notesDirty = diagnosisNotes !== persistedNotes;

  const saveDiagnosisNotes = async () => {
    if (!selectedReport || !user) return;
    setSavingNotes(true);
    try {
      await api.updateReport(selectedReport.id, { notes: diagnosisNotes || undefined });
      setNotesSavedAt(Date.now());
      onRefresh?.();
    } catch (err) {
      console.error('Failed to save outfield notes:', err);
    } finally {
      setSavingNotes(false);
      setTimeout(() => setNotesSavedAt(null), 2200);
    }
  };

  return (
    <>
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        {/* Top-level Download PDF — generates a PDF for the currently
            selected OUTFIELD report. Same icon-only square pattern as
            the Hitting tab. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!selectedReport) return;
            await generateDefensePdf(player, [selectedReport]);
          }}
          disabled={!selectedReport}
        />
        {/* Videos jump — next to Download PDF, replaces standalone tab. */}
        <VideosIconButton onClick={onOpenVideos} />
        <ReportSelector
          reports={reports}
          reportTypes={['OUTFIELD']}
          label="Outfield"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateDefensePdf(player, [r])}
        />
      </TabBarActions>

      {/* Coach Grades moved INTO the Outfielder Snapshot bubble (below the
          Defensive Skills + Underlying Metrics columns) — passed as the
          `coachGrades` prop on <DefensiveSnapshot> below. */}
      {outfieldAssessment ? (() => {
        const a = outfieldAssessment;
        /* Manual-snapshot fields first; legacy ArmMetric/routesReads
         * fields and topMetrics fall back when nothing's been entered yet. */
        const ms = a.manualSnapshot;
        const armBest = ms?.armStrength.primary ?? a.arm.velocity?.best ?? null;
        const armAvg  = ms?.armStrength.secondary ?? a.arm.velocity?.avg ?? null;
        const armGrade = ms?.armStrength.overallGrade ?? a.arm.overallGrade ?? null;
        const gloveGrade = ms?.glove.overallGrade ?? a.routesReads.gloveWork?.grade ?? null;
        const gloveHands = ms?.glove.primary ?? a.routesReads.gloveWork?.grade ?? null;
        const gloveTransfers = ms?.glove.secondary ?? null;
        const rangeGrade = ms?.range.overallGrade ?? a.routesReads.range?.grade ?? a.routesReads.overallGrade ?? null;
        const range60 = ms?.range.primary ?? topMetrics.sixty_yard?.value ?? null;
        const rangeAccel = ms?.range.secondary ?? null;
        const releaseT = a.arm.releaseTime?.best ?? null;

        return (
          <div data-pdf-section="outfield-snapshot">
          <DefensiveSnapshot
            mode="outfield"
            title="Outfielder Report"
            headerRightSlot={<SnapshotDateChip label={formatSnapshotDate(selectedReport?.createdAt)} />}
            /* subtitle retired — Outfielder Snapshot now reads with
               title only, mirroring the Hitting / Catching headers. */
            silhouette={OUTFIELDER_SILHOUETTE}
            anchors={{
              armStrength: [104, 106], // throwing shoulder
              glove:       [166, 64],  // raised glove
              range:       [92, 209],  // foot
            }}
            callouts={{
              armStrength: { value: armBest != null ? Math.round(armBest) : null, unit: 'mph' },
              glove:       { value: gloveGrade, unit: '/80' },
              range:       { value: rangeGrade, unit: '/80' },
            }}
            metricGroups={[
              {
                title: 'Arm Strength',
                grade: armGrade,
                rows: [
                  { label: 'Max velocity', value: armBest != null ? (Number.isInteger(armBest) ? armBest : armBest.toFixed(1)) : null, unit: 'mph' },
                  { label: 'Avg velocity', value: armAvg  != null ? (Number.isInteger(armAvg)  ? armAvg  : armAvg.toFixed(1))  : null, unit: 'mph' },
                ],
              },
              {
                title: 'Glove',
                grade: gloveGrade,
                rows: [
                  { label: 'Hands',     value: gloveHands ?? null, unit: '/80' },
                  { label: 'Transfers', value: gloveTransfers != null ? gloveTransfers : (releaseT != null ? releaseT.toFixed(2) : null), unit: gloveTransfers != null ? '/80' : 's' },
                ],
              },
              {
                title: 'Range',
                grade: rangeGrade,
                rows: [
                  { label: '60 yard dash',   value: range60 != null ? range60.toFixed(1) : null, unit: 's' },
                  { label: '10 Yard Sprint', value: rangeAccel != null ? rangeAccel.toFixed(2) : null, unit: 's' },
                ],
              },
            ]}
            coachGrades={<DefenseCoachGradesPanel report={selectedReport} position="outfield" embedded />}
            /* Diagnosis Notes block retired from the Outfielder
               Snapshot — the bubble now ends with the Coach Grades
               section (above) below the metric groups grid. The
               underlying `diagnosisNotes` state + save handler are
               still wired up at the tab level in case the notes
               editor returns elsewhere. */
          />
          </div>
        );
      })() : (
        <Section>
          <SectionHeader icon="🧤" iconColor="teal" title="Outfield Metrics" subtitle="Arm strength & route grades" />
          {hasData ? (
            <>
              <KpiGrid>
                {TAB_METRICS.defense.filter(k => k.includes('outfield')).map(key => {
                  const m = defMetrics[key];
                  if (!m) return null;
                  const level = getBadgeLevel(key, m.value);
                  const grade = GRADE_RANGES[key] ? toScoutingGrade(m.value, key) : null;
                  return (
                    <KpiCard
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={m.value.toFixed(1)}
                      unit={m.unit}
                      badge={getBadgeText(level) || undefined}
                      badgeLevel={level}
                      color={grade !== null ? scoreColor(grade) : undefined}
                    />
                  );
                })}
              </KpiGrid>

              {defMetrics.outfield_velo && (
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ScoreBar
                    label="Outfield Arm Strength"
                    value={`${defMetrics.outfield_velo.value.toFixed(1)} mph`}
                    percent={(defMetrics.outfield_velo.value / 100) * 100}
                    level={getBadgeLevel('outfield_velo', defMetrics.outfield_velo.value) as any}
                  />
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyMsg}>
              No outfield metrics available.
              <span className={styles.emptyHint}>
                {isCoach
                  ? 'Create an Outfield report with assessment data, or upload tracking data.'
                  : 'Ask your coach to complete an outfield assessment.'}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* ── Scouting Grades (from CSV metrics) ── */}
      {gradeKeys.filter(k => k.includes('outfield')).length > 0 && (
        <Section>
          <SectionHeader icon="📊" iconColor="green" title="Outfield Grades" subtitle="20-80 Scale" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div className={styles.gradeRow} style={{ background: 'var(--surface2)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-bright)' }}>
              <span>Tool</span>
              <span style={{ textAlign: 'center' }}>Value</span>
              <span style={{ textAlign: 'center' }}>Grade</span>
              <span>Scale</span>
            </div>
            {gradeKeys.filter(k => k.includes('outfield')).map(key => {
              const m = topMetrics[key];
              const grade = toScoutingGrade(m.value, key);
              return (
                <div key={key} className={styles.gradeRow}>
                  <span className={styles.gradeLabel}>{METRIC_LABELS[key]}</span>
                  <span className={styles.gradeValue} style={{ color: 'var(--accent-light)' }}>
                    {m.value.toFixed(1)}
                  </span>
                  <span className={styles.gradeValue}>{grade}</span>
                  <ScalePips grade={grade} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Coaching Notes section removed — notes flow through the
          Diagnosis Notes box rendered inside the Outfielder Snapshot. */}

      {/* ── Coach Reviews — per-report panel above the main Video
          gallery. Surfaces only clips attached to THIS Outfield
          report. */}
      {(() => {
        if (!selectedReport || attachedReviewIds.length === 0) return null;
        const attachedVideos = playerVideos.filter((v) => attachedReviewIds.includes(v.id));
        if (attachedVideos.length === 0) return null;
        return (
          <Section>
            <div
              className={aStyles.profilePanel}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <SectionHeader title="Coach Reviews — attached to this report" />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gridAutoRows: 'max-content',
                gap: 12,
                maxHeight: 720,
                overflowY: 'auto',
                paddingRight: 4,
              }}>
                {bundleVideos(attachedVideos).map((b) => {
                  const { prefix } = splitVideoTitle(b.videos[0].title || '');
                  return (
                    <VideoBundleCard
                      key={b.key}
                      videos={b.videos}
                      size="md"
                      playerId={player.id}
                      recordingCategory="OUTFIELD"
                      onUploaded={onRefresh}
                      reports={outfieldReports}
                    />
                  );
                })}
              </div>
            </div>
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          (videoIds.includes(v.id) || v.category === 'OUTFIELD')
        ).sort((a, b) => {
          /* `startsWith('Coach Review')` matches BOTH the new
             `Coach Review` prefix and the legacy `Coach Reviewed`
             prefix so older clips still float to the top of the
             gallery after the rename. */
          const aR = a.title.startsWith('Coach Review') ? 0 : 1;
          const bR = b.title.startsWith('Coach Review') ? 0 : 1;
          return aR - bR;
        });
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            {/* Video section wrapped in the same Catching Snapshot
                bubble chrome (`aStyles.profilePanel`) so it reads as a
                sibling panel below the Outfielder Snapshot. The
                empty-state "No video data" message keeps its existing
                `emptyMsg` styling unchanged. */}
            <div
              className={aStyles.profilePanel}
              /* gap: 18 → 14 (≈0.85rem) so the SectionHeader's
                 accent line sits the same distance above the first
                 video tile as the Tool Grades accent line sits above
                 its first inner bubble. */
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Leading 🎬 icon retired — Video section header reads
                  with title text alone. */}
              <SectionHeader title="Video" />
              {hasVideos ? (
                /* 5-column grid capped at 3 visible rows — matches
                   the HittingTab gallery. `grid-auto-rows: max-content`
                   keeps each row sized to the bubble's natural height,
                   and `max-height` caps the visible area to roughly
                   three of those rows; anything beyond becomes
                   scrollable within the section so the gallery never
                   grows the page indefinitely. */
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  marginBottom: 24,
                }}>
                  {/* Cap at 10 most-recent tiles (2 rows × 5 cols);
                      overflow lives in the all-videos page. */}
                  {bundleVideos(reportVideos).slice(0, 10).map((b) => {
                    const { prefix } = splitVideoTitle(b.videos[0].title || '');
                    return (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="md"
                        playerId={player.id}
                        recordingCategory="OUTFIELD"
                        onUploaded={onRefresh}
                        reports={outfieldReports}
                      />
                    );
                  })}
                  {reportVideos.length === 0 && contentVideos.map((v, i) => (
                    <VideoPlaceholder
                      key={`content-${i}`} tag="OUTFIELD"
                      title={v.name.replace(/\.[^.]+$/, '')}
                      subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                      videoUrl={v.url}
                      playerId={player.id}
                      recordingCategory="OUTFIELD"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyMsg}>No video data.</div>
              )}
            </div>
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   MAIN DEFENSE TAB (WITH SUB-TABS)
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   Top-level position tabs — each only renders
   when the player has that position. Page-level
   tab list wires these in directly so coaches
   pick "Catching" / "Infield" / "Outfield" from
   the main nav instead of through a parent
   "Defense" tab + sub-tab nav.
   ═══════════════════════════════════════════ */
export function CatchingTab(props: TabProps) {
  return (
    <>
      <CatchingSubTab {...props} />
      <CustomCharts section="DEFENSE" playerId={props.player.id} />
    </>
  );
}

export function InfieldTab(props: TabProps) {
  return (
    <>
      <InfieldSubTab {...props} />
      <CustomCharts section="DEFENSE" playerId={props.player.id} />
    </>
  );
}

export function OutfieldTab(props: TabProps) {
  return (
    <>
      <OutfieldSubTab {...props} />
      <CustomCharts section="DEFENSE" playerId={props.player.id} />
    </>
  );
}

/** @deprecated The combined Defense tab + sub-tab nav has been split into
 *  three position-specific top-level tabs (CatchingTab / InfieldTab /
 *  OutfieldTab). Kept around for back-compat with anything still importing
 *  the old name. */
export function DefenseTab(props: TabProps) {
  // Filter sub-tabs to only those matching the player's selected positions.
  // C → Catching, INF → Infield, OF → Outfield, UTIL → Utility.
  const visibleSubTabs = useMemo(() => {
    const positions = (props.player.positions || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return ALL_SUB_TABS.filter((st) => positions.includes(st.positionCode));
  }, [props.player.positions]);

  const [activeSubTab, setActiveSubTab] = useState<DefenseSubTab>(
    () => (visibleSubTabs[0]?.key ?? 'catching') as DefenseSubTab,
  );

  // Auto-correct activeSubTab if the filter list changes (e.g. position edited)
  useEffect(() => {
    if (visibleSubTabs.length === 0) return;
    if (!visibleSubTabs.some((st) => st.key === activeSubTab)) {
      setActiveSubTab(visibleSubTabs[0].key);
    }
  }, [visibleSubTabs, activeSubTab]);

  return (
    <>
      {/* Each Defense sub-tab below provides its own AddReportButton +
          ReportSelector (with per-report download) — no parent-level
          actions, since the sub-tab nav already drives the active context. */}

      {visibleSubTabs.length === 0 ? (
        <div className={styles.emptyMsg} style={{ padding: 48, textAlign: 'center' }}>
          No defensive positions selected for this athlete. Add a position (C, INF, OF, UTIL) in
          the player profile to see defensive assessments.
        </div>
      ) : (
      <>
      {/* ── Sub-Tab Bar ── */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--border)',
        marginBottom: 20,
        marginTop: 4,
      }}>
        {visibleSubTabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSubTab(key)}
            style={{
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'inherit',
              color: activeSubTab === key ? '#FFFFFF' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeSubTab === key
                ? '2px solid #FFFFFF'
                : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              letterSpacing: '0.01em',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Sub-Tab Content ── */}
      {activeSubTab === 'catching' && <CatchingSubTab {...props} />}
      {activeSubTab === 'infield' && <InfieldSubTab {...props} />}
      {activeSubTab === 'outfield' && <OutfieldSubTab {...props} />}
      {activeSubTab === 'utility' && <UtilitySubTab {...props} />}

      <CustomCharts section="DEFENSE" playerId={props.player.id} />
      </>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════
   UTILITY SUB-TAB (multi-position athletes)
   ═══════════════════════════════════════════ */

function UtilitySubTab(props: TabProps) {
  return (
    <>
      <SectionHeader
        icon="🛠️"
        iconColor="gold"
        title="Utility Profile"
        subtitle="Multi-position flexibility & cross-position grades"
      />
      <div className={styles.emptyMsg} style={{ padding: 32, textAlign: 'center' }}>
        Utility assessment UI coming soon. This section will summarize cross-position metrics and
        flexibility grades for athletes listed as UTIL in their profile.
      </div>
      <NotesBox
        label="Coach Notes — Utility"
        notes={[
          { text: 'Versatility observations across multiple defensive positions.', placeholder: true },
        ]}
      />
    </>
  );
}
