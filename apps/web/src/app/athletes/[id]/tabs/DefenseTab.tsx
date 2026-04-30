'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips, NotesBox, VideoPlaceholder,
  ReportSelector, TabBarActions, AddReportButton,
} from '@/components/assessment';
import { generateDefensePdf } from '@/lib/pdf';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES,
  getReportVideoIds, getReportContentVideos,
  type ReportSummary,
} from '../helpers';
import { CustomCharts } from '@/components/CustomCharts';

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
    overallGrade: number | null;
  };
  receiving: {
    topOfZone: GradeItem;
    bottomOfZone: GradeItem;
    gloveSide: GradeItem;
    armSide: GradeItem;
    quietHands: GradeItem;
    stanceSetup: GradeItem;
    overallGrade: number | null;
    // New fields
    path?: GradeItem;
    accuracy?: GradeItem;
    speed?: GradeItem;
    presentation?: GradeItem;
    zoneColors?: (0 | 1 | 2)[]; // 9 zones: 0=red, 1=white, 2=green
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

function gradeColor(grade: number | null): string {
  if (grade === null) return 'var(--faint)';
  if (grade >= 60) return '#4ADE80';
  if (grade >= 50) return '#FBBF24';
  return '#F87171';
}

function gradeBg(grade: number | null): string {
  if (grade === null) return 'transparent';
  if (grade >= 60) return 'rgba(74,222,128,0.10)';
  if (grade >= 50) return 'rgba(251,191,36,0.10)';
  return 'rgba(248,113,113,0.10)';
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
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)',
      }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, fontFamily: MONO,
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

      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>
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
                fontSize: 10, fontWeight: 700, fontFamily: MONO,
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
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)',
      }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, fontFamily: MONO,
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

      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>
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
                fontSize: 8, fontWeight: 700, fontFamily: MONO,
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
        fontFamily: MONO,
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
        fontSize: 16, fontWeight: 800, fontFamily: MONO,
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
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)',
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
      <span style={{ fontSize: 16, fontWeight: 800, fontFamily: MONO, color: gradeColor(grade), textAlign: 'center' }}>
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
      <span style={{ fontSize: 16, fontWeight: 800, fontFamily: MONO, color: gradeColor(grade), textAlign: 'center' }}>
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

/* Tone-color map for a 20-80 grade */
function gradeTone(g: number | null): { stroke: string; fill: string; text: string } {
  if (g === null) return { stroke: 'rgba(255,255,255,0.18)', fill: 'rgba(255,255,255,0.04)', text: 'rgba(255,255,255,0.40)' };
  if (g >= 60)    return { stroke: '#22C55E', fill: 'rgba(34,197,94,0.16)',   text: '#22C55E' };
  if (g >= 40)    return { stroke: 'rgba(255,255,255,0.65)', fill: 'rgba(255,255,255,0.10)', text: '#F1F5F9' };
  return                  { stroke: '#60A5FA', fill: 'rgba(96,165,250,0.16)', text: '#60A5FA' };
}

/* Single horizontal bar inside GloveFootworkBars */
function BarRow({ label, grade }: { label: string; grade: number | null }) {
  const t = gradeTone(grade);
  const pct = grade !== null ? Math.max(0, Math.min(((grade - 20) / 60) * 100, 100)) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 36px', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
        {grade !== null && (
          <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, height: '100%', borderRadius: 4,
            background: `linear-gradient(90deg, ${t.text}66, ${t.text})`, transition: 'width 0.5s ease' }} />
        )}
      </div>
      <span style={{ fontSize: 14, fontWeight: 800, fontFamily: MONO, textAlign: 'right', color: t.text, fontVariantNumeric: 'tabular-nums' }}>
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
        <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'var(--accent-light)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px dashed rgba(255,255,255,0.08)' }}>
          {gloveTitle}
        </div>
        {gloveItems.map(item => <BarRow key={item.label} {...item} />)}
      </div>
      <div>
        <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'var(--accent-light)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px dashed rgba(255,255,255,0.08)' }}>
          {footworkTitle}
        </div>
        {footworkItems.map(item => <BarRow key={item.label} {...item} />)}
      </div>
    </div>
  );
}

/* 5×5 strike-zone heat map with bordered inner 3×3 */
function StrikeZoneHeatMap5x5({ zoneColors, borderZoneColors }: {
  zoneColors: (0 | 1 | 2)[];
  borderZoneColors?: (0 | 1 | 2)[];
}) {
  const W = 290, H = 340;
  const cellW = 52, cellH = 56;
  const gridW = cellW * 5;
  const ox = (W - gridW) / 2;
  const oy = 28;
  const FILLS: Record<number, string> = { 0: '#F87171', 1: 'rgba(255,255,255,0.18)', 2: '#4ADE80' };
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
      const x = ox + c * cellW, y = oy + r * cellH;
      const v = cellAt(r, c);
      const isStrike = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      cells.push(
        <rect key={`${r}-${c}`} x={x} y={y} width={cellW} height={cellH}
          fill={FILLS[v]} stroke="rgba(255,255,255,0.10)"
          strokeWidth={isStrike ? 0.7 : 0.5} rx={2} opacity={isStrike ? 0.95 : 0.55} />,
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 360, margin: '0 auto' }}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.32)" rx={4} />
      {cells}
      <rect x={ox + cellW} y={oy + cellH} width={cellW * 3} height={cellH * 3}
        fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={2} rx={2} />
      <text x={W / 2} y={16} textAnchor="middle" fontSize={9} fontFamily={MONO} fontWeight={700}
            fill="rgba(255,255,255,0.50)" letterSpacing="0.24em">BORDER ZONES</text>
      <text x={W / 2} y={oy + cellH + 14} textAnchor="middle" fontSize={9} fontFamily={MONO} fontWeight={700}
            fill="rgba(255,255,255,0.78)" letterSpacing="0.22em">STRIKE ZONE</text>
      <g transform={`translate(${ox}, ${H - 8})`}>
        {[
          { v: 2, label: 'Receives well' },
          { v: 1, label: 'Average' },
          { v: 0, label: 'Struggles' },
        ].map((item, i) => (
          <g key={item.v} transform={`translate(${i * 92}, -10)`}>
            <rect width={10} height={10} rx={2} fill={FILLS[item.v]} stroke="rgba(255,255,255,0.18)" />
            <text x={14} y={9} fontSize={10} fill="rgba(255,255,255,0.70)" fontFamily="inherit">{item.label}</text>
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
}: {
  uid: string;
  scale?: number;
  distArcs?: number[];
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

      {/* Distance arcs */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = FIELD_CX - r * Math.cos(Math.PI / 4);
        const ly = FIELD_CY - r * Math.sin(Math.PI / 4);
        const rx = FIELD_CX + r * Math.cos(Math.PI / 4);
        const ry = FIELD_CY - r * Math.sin(Math.PI / 4);
        return (
          <g key={d}>
            <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`}
              fill="none" stroke="rgba(183,190,201,0.14)" strokeWidth={0.75} strokeDasharray="3 5" />
            <g transform={`translate(${rx + 6}, ${ry + 4})`}>
              <rect x={-2} y={-9} width={42} height={16} rx={8}
                fill="rgba(10,12,18,0.75)" stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
              <text x={19} y={2.5} fill="rgba(183,190,201,0.8)" fontSize={9}
                fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
                letterSpacing="0.14em" textAnchor="middle">{d}FT</text>
            </g>
          </g>
        );
      })}

      {/* Foul rails — silver hairlines */}
      {(() => {
        const r = foulMaxFt * scale;
        return (
          <>
            <line x1={FIELD_CX} y1={FIELD_CY}
              x2={FIELD_CX - r * Math.cos(Math.PI / 4)}
              y2={FIELD_CY - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
            <line x1={FIELD_CX} y1={FIELD_CY}
              x2={FIELD_CX + r * Math.cos(Math.PI / 4)}
              y2={FIELD_CY - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
          </>
        );
      })()}

      {/* Bases — silver diamonds */}
      {(() => {
        const baseDist = 90 * scale * 0.72;
        const bases: [number, number, string][] = [
          [FIELD_CX, FIELD_CY - baseDist, '2B'],
          [FIELD_CX - baseDist * 0.7, FIELD_CY - baseDist * 0.5, '3B'],
          [FIELD_CX + baseDist * 0.7, FIELD_CY - baseDist * 0.5, '1B'],
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

      {/* Top zone labels */}
      {(() => {
        const zones = [
          { x: FIELD_W * 0.22, label: 'LEFT' },
          { x: FIELD_W * 0.50, label: 'CENTER' },
          { x: FIELD_W * 0.78, label: 'RIGHT' },
        ];
        return zones.map(z => (
          <text key={z.label} x={z.x} y={18} fill="rgba(183,190,201,0.55)" fontSize={9}
            fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
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
  const L = gradeTone(leftGrade), MID = gradeTone(centerGrade), R = gradeTone(rightGrade);
  const CHIP_FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
  const VBOX_H = 540;          // extra 80 px below home plate for the block fan
  const [twobX, twobY] = fieldXY(0, 90 * Math.SQRT2);

  const BlockChip = ({ x, y, label, grade, dir, t }: {
    x: number; y: number; label: string; grade: number | null; dir: -1 | 0 | 1;
    t: ReturnType<typeof gradeTone>;
  }) => {
    const arrow = dir === -1 ? '◀' : dir === 1 ? '▶' : '▼';
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect x="-34" y="-22" width="68" height="44" rx="7" fill={t.fill} stroke={t.stroke} strokeWidth="1.2" />
        <text x="0" y="-9" textAnchor="middle" fontSize="8" fontFamily={CHIP_FONT} fontWeight="600"
          fill="rgba(255,255,255,0.62)" letterSpacing="0.06em">{label}</text>
        <text x="0" y="8" textAnchor="middle" fontSize="15" fontFamily={CHIP_FONT} fontWeight="700"
          fill={t.text} fontVariantNumeric="tabular-nums">{grade !== null ? grade : '—'}</text>
        <text x="0" y="18" textAnchor="middle" fontSize="9" fill={t.stroke}>{arrow}</text>
      </g>
    );
  };

  const StatChip = ({ y, label, value, unit }: {
    y: number; label: string; value: number | null; unit: string;
  }) => (
    <g transform={`translate(${FIELD_CX}, ${y})`}>
      <rect x="-54" y="-14" width="108" height="28" rx="6"
        fill="rgba(20,24,32,0.92)" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      <text x="-46" y="-2" textAnchor="start" fontSize="8" fontFamily={CHIP_FONT} fontWeight="600"
        fill="rgba(255,255,255,0.55)" letterSpacing="0.10em">{label}</text>
      <text x="-46" y="10" textAnchor="start" fontSize="13" fontFamily={CHIP_FONT} fontWeight="700"
        fill="#F1F5F9" fontVariantNumeric="tabular-nums" letterSpacing="-0.01em">
        {value !== null ? (unit === 'mph' ? value.toFixed(0) : value.toFixed(2)) : '—'}
        <tspan fontSize="9" fontFamily={CHIP_FONT} fontWeight="500"
               fill="rgba(255,255,255,0.55)" letterSpacing="0.04em" dx="3">{unit}</tspan>
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${FIELD_W} ${VBOX_H}`} preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 560, margin: '0 auto', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.55))' }}>
      <SprayField uid="catch" />

      {/* Throwing line — home → 2B-bag, dashed */}
      <line x1={FIELD_CX} y1={FIELD_CY - 8} x2={twobX} y2={twobY + 4}
        stroke="rgba(255,255,255,0.50)" strokeWidth="1.6" strokeDasharray="7 5" />
      <polygon points={`${twobX - 6},${twobY + 6} ${twobX + 6},${twobY + 6} ${twobX},${twobY - 2}`}
        fill="rgba(255,255,255,0.70)" />

      {/* Stat chips spaced along the throw */}
      <StatChip y={235} label="POP TIME" value={popTime} unit="s" />
      <StatChip y={325} label="VELOCITY" value={velocity} unit="mph" />
      <StatChip y={400} label="EXCHANGE" value={exchange} unit="s" />

      {/* Block fan beneath home plate */}
      <path d={`M ${FIELD_CX - 130} 480 Q ${FIELD_CX} 520 ${FIELD_CX + 130} 480`}
        fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 4" />
      <BlockChip x={FIELD_CX - 130} y={482} label="BLOCK L" grade={leftGrade}   dir={-1} t={L} />
      <BlockChip x={FIELD_CX}        y={500} label="BLOCK C" grade={centerGrade} dir={0}  t={MID} />
      <BlockChip x={FIELD_CX + 130} y={482} label="BLOCK R" grade={rightGrade}  dir={1}  t={R} />

      <text x={FIELD_CX} y={VBOX_H - 8} textAnchor="middle" fontSize="11" fontFamily={CHIP_FONT} fontWeight="600"
        fill="rgba(255,255,255,0.40)" fontStyle="italic">Blocking coverage behind home plate</text>
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

  const ARROW_LEN = 44;
  const ArrowChip = ({ dir, grade }: { dir: 'L' | 'R' | 'I' | 'B'; grade: number | null }) => {
    const t = gradeTone(grade);
    let dx = 0, dy = 0;
    if (dir === 'L') { dx = -rightUx * ARROW_LEN; dy = -rightUy * ARROW_LEN; }
    if (dir === 'R') { dx =  rightUx * ARROW_LEN; dy =  rightUy * ARROW_LEN; }
    if (dir === 'I') { dx =  inUx    * ARROW_LEN; dy =  inUy    * ARROW_LEN; }
    if (dir === 'B') { dx = -inUx    * ARROW_LEN; dy = -inUy    * ARROW_LEN; }
    const arrow = dir === 'L' ? '◀' : dir === 'R' ? '▶' : dir === 'I' ? '▼' : '▲';
    const dirLabel = dir === 'L' ? 'LEFT' : dir === 'R' ? 'RIGHT' : dir === 'I' ? 'IN' : 'BACK';
    const tipX = positionDot.x + dx;
    const tipY = positionDot.y + dy;
    return (
      <g>
        <line x1={positionDot.x} y1={positionDot.y} x2={tipX} y2={tipY}
          stroke={t.stroke} strokeWidth="1.3" strokeDasharray="3 2" />
        <g transform={`translate(${tipX}, ${tipY})`}>
          <rect x="-22" y="-14" width="44" height="28" rx="5.5" fill={t.fill} stroke={t.stroke} strokeWidth="1.2" />
          <text x="-13" y="-3" textAnchor="middle" fontSize="7" fontFamily={CHIP_FONT} fontWeight="700"
            fill="rgba(255,255,255,0.55)">{arrow}</text>
          <text x="6" y="-3" textAnchor="middle" fontSize="7" fontFamily={CHIP_FONT} fontWeight="600"
            fill="rgba(255,255,255,0.55)">{dirLabel}</text>
          <text x="0" y="10" textAnchor="middle" fontSize="14" fontFamily={CHIP_FONT} fontWeight="700"
            fill={t.text} fontVariantNumeric="tabular-nums">
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
        <rect x="-36" y="-14" width="72" height="28" rx="6"
          fill="rgba(20,24,32,0.92)" stroke={armToneObj.stroke} strokeWidth="1.2" />
        <text x="0" y="-3" textAnchor="middle" fontSize="7.5" fontFamily={CHIP_FONT} fontWeight="600"
          fill="rgba(255,255,255,0.60)" letterSpacing="0.04em">
          ARM {armTargetLabel.toUpperCase()}
        </text>
        <text x="0" y="10" textAnchor="middle" fontSize="13" fontFamily={CHIP_FONT} fontWeight="700"
          fill={armToneObj.text} fontVariantNumeric="tabular-nums" letterSpacing="-0.01em">
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

function StatsRow({ title, icon, cells }: { title: string; icon: string; cells: StatCell[] }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.018)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '14px 18px', marginBottom: 8,
      display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 18, borderRight: '1px solid var(--border)' }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.20em', color: 'var(--text-muted)' }}>Phase</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {cells.map((c, i) => {
          if (c.kind === 'metric') {
            const has = c.value !== null && c.value !== undefined;
            const decimals = c.decimals ?? (c.unit === 'mph' ? 0 : 2);
            return (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-muted)' }}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: has ? 'var(--text)' : 'var(--faint)',
                    letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {has ? c.value!.toFixed(decimals) : '—'}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.10em' }}>{c.unit}</span>
                </span>
              </div>
            );
          } else {
            const grade = c.grade;
            const valueColor = gradeColor(grade);
            const ratingLabel = grade !== null ? gradeLabel(grade) : 'Not graded';
            return (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-muted)' }}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: valueColor,
                    letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {grade !== null ? grade : '—'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {ratingLabel}
                  </span>
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
function SnapshotBubble({ title, subtitle, leftPane, rightPane, statsRows }: {
  title: string;
  subtitle: string;
  leftPane: { title: string; hint: string; node: React.ReactNode };
  rightPane: { title: string; hint: string; node: React.ReactNode };
  statsRows: React.ReactNode;
}) {
  return (
    <Section>
      <SectionHeader icon="🧤" iconColor="teal" title={title} subtitle={subtitle} />
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18,
        padding: '20px 24px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1fr)', gap: 28, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{leftPane.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{leftPane.hint}</span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {leftPane.node}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{rightPane.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{rightPane.hint}</span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {rightPane.node}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0 4px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--text-muted)' }}>Underlying Stats</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Full breakdown</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>{statsRows}</div>
      </div>
    </Section>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: CATCHING
   ═══════════════════════════════════════════ */

function CatchingSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, reports, videos: playerVideos,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Interactive zone state (local override for clicking zones on profile)
  const [localZoneColors, setLocalZoneColors] = useState<(0 | 1 | 2)[]>([1, 1, 1, 1, 1, 1, 1, 1, 1]);

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
        <AddReportButton onClick={onNewReport} show={isCoach} />
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
          <SnapshotBubble
            title="Catching Snapshot"
            subtitle="Charts + underlying breakdown for receiving, throwing, and blocking."
            leftPane={{
              title: 'Receiving Heat Map',
              hint: 'Strike zone & borders',
              node: (
                <StrikeZoneHeatMap5x5
                  zoneColors={zoneColors as (0 | 1 | 2)[]}
                  borderZoneColors={catchingAssessment.borderZoneColors}
                />
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
            statsRows={
              <>
                <StatsRow title="Throwing" icon="🎯"
                  cells={[
                    { kind: 'metric', label: 'Pop Time 2B', value: t.popTime2B?.best    ?? null, unit: 's',   decimals: 2 },
                    { kind: 'metric', label: 'Pop Time 3B', value: t.popTime3B?.best    ?? null, unit: 's',   decimals: 2 },
                    { kind: 'metric', label: 'Exchange',    value: t.exchangeTime?.best ?? null, unit: 's',   decimals: 2 },
                    { kind: 'metric', label: 'Velocity',    value: t.velocity?.best     ?? null, unit: 'mph', decimals: 0 },
                  ]}
                />
                <StatsRow title="Receiving" icon="🧤"
                  cells={[
                    { kind: 'grade', label: 'Path',         grade: catchingAssessment.receiving.path?.grade         ?? null },
                    { kind: 'grade', label: 'Accuracy',     grade: catchingAssessment.receiving.accuracy?.grade     ?? null },
                    { kind: 'grade', label: 'Speed',        grade: catchingAssessment.receiving.speed?.grade        ?? null },
                    { kind: 'grade', label: 'Presentation', grade: catchingAssessment.receiving.presentation?.grade ?? null },
                  ]}
                />
                <StatsRow title="Blocking" icon="🛡️"
                  cells={[
                    { kind: 'grade', label: 'Range',          grade: b.range?.grade          ?? null },
                    { kind: 'grade', label: 'Accuracy',       grade: b.accuracy?.grade       ?? null },
                    { kind: 'grade', label: 'Body & Glove',   grade: b.gloveBodyAngle?.grade ?? null },
                    { kind: 'grade', label: 'Recovery Speed', grade: b.recoverySpeed?.grade  ?? null },
                  ]}
                />
              </>
            }
          />
        );
      })()}

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Catching mechanics, game management, and communication observations.', placeholder: true },
              { text: 'Position-specific drill recommendations and development goals.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="gold" title="Coaching Notes" />
            <NotesBox label="CATCHING ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'CATCHING'
        );
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <SectionHeader icon="🎬" iconColor="teal" title="Video" />
            {hasVideos ? (
              <div className={aStyles.twoCol}>
                {reportVideos.map(v => (
                  <VideoPlaceholder
                    key={v.id} tag={v.category} title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()} size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`} tag="CATCHING"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                    videoUrl={v.url}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyMsg}>No video data.</div>
            )}
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: INFIELD
   ═══════════════════════════════════════════ */

function InfieldSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, reports, videos: playerVideos,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
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

  return (
    <>
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
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

      {infieldAssessment ? (() => {
        const a = infieldAssessment;
        const positionDot = INFIELD_POSITIONS[a.positionCode ?? 'SS'] ?? INFIELD_POSITIONS.SS;
        const rangeLeft  = a.rangeLeft?.grade  ?? a.rangeFootwork.rangeGloveSide?.grade    ?? null;
        const rangeRight = a.rangeRight?.grade ?? a.rangeFootwork.rangeArmSide?.grade      ?? null;
        const rangeIn    = a.rangeIn?.grade    ?? a.rangeFootwork.jumps?.grade             ?? null;
        const rangeBack  = a.rangeBack?.grade  ?? a.rangeFootwork.breakdownFootwork?.grade ?? null;
        const armVelo    = a.arm.velocity?.best ?? null;
        const armGrade   = a.rangeFootwork.overallGrade ?? null;
        return (
          <Section>
            <SectionHeader icon="🧤" iconColor="teal" title="Infielder Snapshot"
              subtitle="A field map showing range coverage and arm strength to 1B, with the glove and footwork breakdown beneath it."
            />
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '28px 32px 24px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}>
              {/* TOP — Field, full width */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                    Range &amp; Arm
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {positionDot.label} · throw to 1B
                  </span>
                </div>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <PositionFieldDiagram
                    mode="infield"
                    positionDot={positionDot}
                    rangeLeft={rangeLeft}
                    rangeRight={rangeRight}
                    rangeIn={rangeIn}
                    rangeBack={rangeBack}
                    armGrade={armGrade}
                    armVelo={armVelo}
                    maxWidth={680}
                  />
                </div>
              </div>

              {/* MIDDLE — Glove & Footwork bars, full width below */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                    Glove &amp; Footwork
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>20-80 sub-scores</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 28,
                  alignItems: 'flex-start',
                }}>
                  <GloveFootworkBars
                    gloveTitle="Hands & Glove"
                    gloveItems={HANDS_SKILLS.map(({ key, label }) => ({
                      label,
                      grade: (a.handsGlove[key] as GradeItem | undefined)?.grade ?? null,
                    }))}
                    footworkTitle="Range & Footwork"
                    footworkItems={RANGE_SKILLS.map(({ key, label }) => ({
                      label,
                      grade: (a.rangeFootwork[key] as GradeItem | undefined)?.grade ?? null,
                    }))}
                  />
                </div>
              </div>

              {/* BOTTOM — Underlying stats */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--text-muted)' }}>
                  Underlying Stats
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Full breakdown</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <StatsRow title="Arm" icon="💪"
                  cells={[
                    { kind: 'metric', label: 'Velocity', value: a.arm.velocity?.best ?? null, unit: 'mph', decimals: 0 },
                    { kind: 'metric', label: 'Accuracy', value: a.arm.accuracy?.best ?? null, unit: '%',   decimals: 0 },
                  ]}
                />
                <StatsRow title="Range / Footwork" icon="🏃"
                  cells={RANGE_SKILLS.map(({ key, label }) => ({
                    kind: 'grade' as const,
                    label,
                    grade: (a.rangeFootwork[key] as GradeItem | undefined)?.grade ?? null,
                  }))}
                />
                <StatsRow title="Hands / Glove" icon="🧤"
                  cells={HANDS_SKILLS.map(({ key, label }) => ({
                    kind: 'grade' as const,
                    label,
                    grade: (a.handsGlove[key] as GradeItem | undefined)?.grade ?? null,
                  }))}
                />
              </div>
            </div>
          </Section>
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
                  return (
                    <KpiCard
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={m.value.toFixed(key === 'exchange_time' ? 2 : 1)}
                      unit={m.unit}
                      badge={getBadgeText(level) || undefined}
                      badgeLevel={level}
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

      {/* ── Scouting Grades (from CSV metrics) ── */}
      {gradeKeys.filter(k => k.includes('infield')).length > 0 && (
        <Section>
          <SectionHeader icon="📊" iconColor="green" title="Infield Grades" subtitle="20-80 Scale" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div className={styles.gradeRow} style={{ background: 'var(--surface2)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
              <span>Tool</span>
              <span style={{ textAlign: 'center' }}>Value</span>
              <span style={{ textAlign: 'center' }}>Grade</span>
              <span>Scale</span>
            </div>
            {gradeKeys.filter(k => k.includes('infield')).map(key => {
              const m = topMetrics[key];
              const grade = toScoutingGrade(m.value, key);
              return (
                <div key={key} className={styles.gradeRow}>
                  <span className={styles.gradeLabel}>{METRIC_LABELS[key]}</span>
                  <span className={styles.gradeValue} style={{ color: 'var(--accent-light)' }}>
                    {m.value.toFixed(key === 'exchange_time' ? 2 : 1)}
                  </span>
                  <span className={styles.gradeValue}>{grade}</span>
                  <ScalePips grade={grade} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Infield mechanics, range, arm accuracy, and transfer observations.', placeholder: true },
              { text: 'Position-specific drill recommendations.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="gold" title="Coaching Notes" />
            <NotesBox label="INFIELD ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'INFIELD'
        );
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <SectionHeader icon="🎬" iconColor="teal" title="Video" />
            {hasVideos ? (
              <div className={aStyles.twoCol}>
                {reportVideos.map(v => (
                  <VideoPlaceholder
                    key={v.id} tag={v.category} title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()} size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`} tag="INFIELD"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                    videoUrl={v.url}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyMsg}>No video data.</div>
            )}
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   SUB-TAB: OUTFIELD
   ═══════════════════════════════════════════ */

function OutfieldSubTab({
  player, topMetrics, isCoach, onRefresh, onNewReport, onEditReport, reports, videos: playerVideos,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
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

  return (
    <>
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
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

      {outfieldAssessment ? (() => {
        const a = outfieldAssessment;
        const positionDot = OUTFIELD_POSITIONS[a.positionCode ?? 'CF'] ?? OUTFIELD_POSITIONS.CF;
        const rangeLeft  = a.rangeLeft?.grade  ?? a.routesReads.routes?.grade        ?? null;
        const rangeRight = a.rangeRight?.grade ?? a.routesReads.range?.grade         ?? null;
        const rangeIn    = a.rangeIn?.grade    ?? a.routesReads.flyBallIn?.grade     ?? null;
        const rangeBack  = a.rangeBack?.grade  ?? a.routesReads.flyBallBack?.grade   ?? null;
        const armVelo    = a.arm.velocity?.best ?? null;
        const armGrade   = a.arm.overallGrade ?? null;
        return (
          <Section>
            <SectionHeader icon="🧤" iconColor="teal" title="Outfielder Snapshot"
              subtitle="A field map showing range coverage and arm strength to home, with the glove and footwork breakdown beneath it."
            />
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '28px 32px 24px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}>
              {/* TOP — Field, full width */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                    Range &amp; Arm
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {positionDot.label} · throw to home
                  </span>
                </div>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <PositionFieldDiagram
                    mode="outfield"
                    positionDot={positionDot}
                    rangeLeft={rangeLeft}
                    rangeRight={rangeRight}
                    rangeIn={rangeIn}
                    rangeBack={rangeBack}
                    armGrade={armGrade}
                    armVelo={armVelo}
                    maxWidth={680}
                  />
                </div>
              </div>

              {/* MIDDLE — Glove & Footwork bars below the field */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                    Glove &amp; Footwork
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>20-80 sub-scores</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 28,
                  alignItems: 'flex-start',
                }}>
                  <GloveFootworkBars
                    gloveTitle="Glove"
                    gloveItems={[
                      { label: 'Glove Work', grade: a.routesReads.gloveWork?.grade ?? null },
                    ]}
                    footworkTitle="Routes & Reads"
                    footworkItems={[
                      { label: 'First-Step Jump', grade: a.routesReads.firstStepJump?.grade ?? null },
                      { label: 'Routes',          grade: a.routesReads.routes?.grade        ?? null },
                      { label: 'Range',           grade: a.routesReads.range?.grade         ?? null },
                      { label: 'Fly Ball In',     grade: a.routesReads.flyBallIn?.grade     ?? null },
                      { label: 'Fly Ball Back',   grade: a.routesReads.flyBallBack?.grade   ?? null },
                      { label: 'Line Drive Read', grade: a.routesReads.lineDriveRead?.grade ?? null },
                    ]}
                  />
                </div>
              </div>

              {/* BOTTOM — Underlying stats */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--text-muted)' }}>
                  Underlying Stats
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Full breakdown</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <StatsRow title="Arm" icon="💪"
                  cells={[
                    { kind: 'metric', label: 'Velocity',     value: a.arm.velocity?.best     ?? null, unit: 'mph', decimals: 0 },
                    { kind: 'metric', label: 'Crow Hop',     value: a.arm.crowHop?.best      ?? null, unit: 'mph', decimals: 0 },
                    { kind: 'metric', label: 'Release Time', value: a.arm.releaseTime?.best  ?? null, unit: 's',   decimals: 2 },
                    { kind: 'metric', label: 'Accuracy',     value: a.arm.accuracy?.best     ?? null, unit: '%',   decimals: 0 },
                  ]}
                />
                <StatsRow title="Routes / Reads" icon="🏃"
                  cells={OF_ROUTES_SKILLS.map(({ key, label }) => ({
                    kind: 'grade' as const,
                    label,
                    grade: (a.routesReads[key] as GradeItem | undefined)?.grade ?? null,
                  }))}
                />
              </div>
            </div>
          </Section>
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
                  return (
                    <KpiCard
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={m.value.toFixed(1)}
                      unit={m.unit}
                      badge={getBadgeText(level) || undefined}
                      badgeLevel={level}
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
            <div className={styles.gradeRow} style={{ background: 'var(--surface2)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
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

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Outfield mechanics, range, arm accuracy, and route observations.', placeholder: true },
              { text: 'Position-specific drill recommendations.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="gold" title="Coaching Notes" />
            <NotesBox label="OUTFIELD ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'OUTFIELD'
        );
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <SectionHeader icon="🎬" iconColor="teal" title="Video" />
            {hasVideos ? (
              <div className={aStyles.twoCol}>
                {reportVideos.map(v => (
                  <VideoPlaceholder
                    key={v.id} tag={v.category} title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()} size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`} tag="OUTFIELD"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                    videoUrl={v.url}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyMsg}>No video data.</div>
            )}
          </Section>
        );
      })()}
    </>
  );
}

/* ═══════════════════════════════════════════
   MAIN DEFENSE TAB (WITH SUB-TABS)
   ═══════════════════════════════════════════ */

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
