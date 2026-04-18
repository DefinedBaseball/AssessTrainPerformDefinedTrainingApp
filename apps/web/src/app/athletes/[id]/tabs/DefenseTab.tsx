'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips, NotesBox, VideoPlaceholder,
  ReportSelector, DownloadPdfButton, TabBarActions,
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
  };
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

/* ═══════════════════════════════════════════
   SUB-TAB: CATCHING
   ═══════════════════════════════════════════ */

function CatchingSubTab({
  player, topMetrics, isCoach, onRefresh, reports, videos: playerVideos,
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
        <ReportSelector
          reports={reports}
          reportTypes={['CATCHING']}
          label="Catching"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
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
      ) : (
        <>
          {/* ═══ SECTION 1: THROWING (no Pop Time 3B, no Overall Grade) ═══ */}
          <Section>
            <SectionHeader icon="🎯" iconColor="teal" title="Throwing & Pop Time" />
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12,
            }}>
              {THROWING_CARDS.map(({ key, label, unit, mlbRef }) => {
                const metric = catchingAssessment.throwing[key];
                if (!metric || typeof metric !== 'object' || !('attempts' in metric)) return null;
                return (
                  <ThrowingMetricCard key={key} metric={metric as ThrowingMetric} label={label} unit={unit} mlbRef={mlbRef} />
                );
              })}
            </div>
          </Section>

          {/* ═══ SECTION 2: RECEIVING — Zone + Scores ═══ */}
          <Section>
            <SectionHeader icon="🧤" iconColor="gold" title="Receiving" />
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Interactive Strike Zone */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '12px', flex: '0 0 auto',
              }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
                  Zone Receiving — Click to Grade
                </div>
                <ReceivingZone zoneColors={zoneColors as (0 | 1 | 2)[]} onToggle={handleZoneToggle} />
              </div>

              {/* Receiving Scores */}
              <div style={{
                flex: 1, minWidth: 280,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                overflow: 'hidden',
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '140px 44px 1fr', gap: 10,
                  padding: '8px 14px', borderBottom: '1px solid var(--border)',
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)',
                }}>
                  <span>Skill</span>
                  <span style={{ textAlign: 'center' }}>Grade</span>
                  <span>Rating</span>
                </div>
                <ReceivingScoreRow label="Path" item={catchingAssessment.receiving.path} />
                <ReceivingScoreRow label="Accuracy" item={catchingAssessment.receiving.accuracy} />
                <ReceivingScoreRow label="Speed" item={catchingAssessment.receiving.speed} />
                <ReceivingScoreRow label="Presentation" item={catchingAssessment.receiving.presentation} />
              </div>
            </div>
          </Section>

          {/* ═══ SECTION 3: BLOCKING — Range Visual + Scores ═══ */}
          <Section>
            <SectionHeader icon="🛡️" iconColor="red" title="Blocking" />

            {/* Blocking Range Visual */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '16px 12px 8px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
                Blocking Range
              </div>
              <BlockingRangeVisual rangeFeet={catchingAssessment.blocking.blockingRangeFeet ?? null} />
            </div>

            {/* Blocking Scores */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '160px 44px 1fr', gap: 10,
                padding: '8px 14px', borderBottom: '1px solid var(--border)',
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)',
              }}>
                <span>Skill</span>
                <span style={{ textAlign: 'center' }}>Grade</span>
                <span>Rating</span>
              </div>
              <BlockingScoreRow label="Blocking Accuracy" item={catchingAssessment.blocking.accuracy} />
              <BlockingScoreRow label="Body Angle & Glove" item={catchingAssessment.blocking.gloveBodyAngle} />
              <BlockingScoreRow label="Recovery Speed" item={catchingAssessment.blocking.recoverySpeed} />
            </div>
          </Section>
        </>
      )}

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
  player, topMetrics, isCoach, onRefresh, reports, videos: playerVideos,
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
        <ReportSelector
          reports={reports}
          reportTypes={['INFIELD']}
          label="Infield"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
      </TabBarActions>

      {infieldAssessment ? (
        <>
          {/* ═══ ARM STRENGTH & ACCURACY ═══ */}
          <Section>
            <SectionHeader icon="💪" iconColor="teal" title="Arm Strength & Accuracy" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
              marginBottom: 8,
            }}>
              {ARM_METRICS.map(({ key, label, unit }) => {
                const metric = infieldAssessment.arm[key];
                if (!metric || typeof metric !== 'object') return null;
                return (
                  <ArmMetricCard
                    key={key}
                    metric={metric as ArmMetric}
                    label={label}
                    unit={unit}
                  />
                );
              })}
            </div>
          </Section>

          {/* ═══ RANGE & FOOTWORK ═══ */}
          <Section>
            <SectionHeader icon="🏃" iconColor="gold" title="Range & Footwork" subtitle="Scouting Grades (20-80)" />
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '180px 50px 1fr',
                gap: 14,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                <span>Skill</span>
                <span style={{ textAlign: 'center' }}>Grade</span>
                <span>Rating</span>
              </div>
              {RANGE_SKILLS.map(({ key, label }) => {
                const item = infieldAssessment.rangeFootwork[key] as GradeItem;
                if (!item) return null;
                return <GradeRow key={key} label={label} item={item} />;
              })}
            </div>
            <OverallGradeCard label="Range / Footwork" grade={infieldAssessment.rangeFootwork.overallGrade} />
          </Section>

          {/* ═══ HANDS & GLOVE WORK ═══ */}
          <Section>
            <SectionHeader icon="🧤" iconColor="red" title="Hands & Glove Work" subtitle="Scouting Grades (20-80)" />
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '180px 50px 1fr',
                gap: 14,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                <span>Skill</span>
                <span style={{ textAlign: 'center' }}>Grade</span>
                <span>Rating</span>
              </div>
              {HANDS_SKILLS.map(({ key, label }) => {
                const item = infieldAssessment.handsGlove[key] as GradeItem;
                if (!item) return null;
                return <GradeRow key={key} label={label} item={item} />;
              })}
            </div>
            <OverallGradeCard label="Hands / Glove" grade={infieldAssessment.handsGlove.overallGrade} />
          </Section>
        </>
      ) : (
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
  player, topMetrics, isCoach, onRefresh, reports, videos: playerVideos,
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
        <ReportSelector
          reports={reports}
          reportTypes={['OUTFIELD']}
          label="Outfield"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
      </TabBarActions>

      {outfieldAssessment ? (
        <>
          {/* ═══ ARM STRENGTH & ACCURACY ═══ */}
          <Section>
            <SectionHeader icon="💪" iconColor="teal" title="Arm Strength & Accuracy" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
              marginBottom: 8,
            }}>
              {OF_ARM_METRICS.map(({ key, label, unit }) => {
                const metric = outfieldAssessment.arm[key];
                if (!metric || typeof metric !== 'object') return null;
                return (
                  <ArmMetricCard
                    key={key}
                    metric={metric as ArmMetric}
                    label={label}
                    unit={unit}
                  />
                );
              })}
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 20,
              padding: '18px 24px',
              background: gradeBg(outfieldAssessment.arm.overallGrade),
              border: `1px solid ${gradeColor(outfieldAssessment.arm.overallGrade)}33`,
              borderRadius: 12,
            }}>
              <ScoutingGradeBadge grade={outfieldAssessment.arm.overallGrade} size="large" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text-muted)',
                }}>
                  Overall Arm Grade
                </span>
                <span style={{
                  fontSize: 18, fontWeight: 800,
                  color: gradeColor(outfieldAssessment.arm.overallGrade),
                }}>
                  {outfieldAssessment.arm.overallGrade !== null
                    ? `${outfieldAssessment.arm.overallGrade} \u2014 ${gradeLabel(outfieldAssessment.arm.overallGrade)}`
                    : 'Not Graded'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--faint)' }}>
                  20-80 scouting scale
                </span>
              </div>
            </div>
          </Section>

          {/* ═══ ROUTES, RANGE, READS & GLOVE ═══ */}
          <Section>
            <SectionHeader icon="🏃" iconColor="gold" title="Routes, Range, Reads & Glove" subtitle="Scouting Grades (20-80)" />
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '180px 50px 1fr',
                gap: 14,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                <span>Skill</span>
                <span style={{ textAlign: 'center' }}>Grade</span>
                <span>Rating</span>
              </div>
              {OF_ROUTES_SKILLS.map(({ key, label }) => {
                const item = outfieldAssessment.routesReads[key] as GradeItem;
                if (!item) return null;
                return <GradeRow key={key} label={label} item={item} />;
              })}
            </div>
            <OverallGradeCard label="Routes / Reads" grade={outfieldAssessment.routesReads.overallGrade} />
          </Section>
        </>
      ) : (
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
      {/* ── Download Button (portaled into TabBar) ── */}
      <TabBarActions>
        <DownloadPdfButton
          label="Download PDF"
          onDownload={() => generateDefensePdf(props.player, props.reports)}
        />
      </TabBarActions>

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
