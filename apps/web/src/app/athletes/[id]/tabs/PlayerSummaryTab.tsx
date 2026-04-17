'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart, ReferenceLine,
  ScatterChart, Scatter, ZAxis, Legend, Cell,
} from 'recharts';
import {
  SectionHeader, Section,
  VideoPlaceholder, NotesBox, ReportSelector, DownloadPdfButton,
} from '@/components/assessment';
import { MetricChart } from '@/components/MetricChart';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import * as api from '@/lib/api';
import { generateSummaryPdf } from '@/lib/pdf';
import {
  TabProps, METRIC_LABELS,
  getBadgeLevel, getBadgeText, CHART_COLORS,
  formatHeight, getAge,
  type ReportSummary,
} from '../helpers';

/* ═══════════════════════════════════════════
   POSITION DETECTION
   ═══════════════════════════════════════════ */

function parsePositions(posStr: string | null | undefined) {
  const positions = posStr?.split(',').map(p => p.trim()).filter(Boolean) || [];
  return {
    list: positions,
    isHitter: positions.some(p => ['C', 'INF', 'OF', 'UTIL'].includes(p)),
    isPitcher: positions.includes('P'),
    isCatcher: positions.includes('C'),
    isInfielder: positions.includes('INF'),
    isOutfielder: positions.includes('OF'),
  };
}

/* ═══════════════════════════════════════════
   CONDENSE PROGRESS DATA — ONE MAX PER SESSION
   ═══════════════════════════════════════════ */

/** Takes raw progress data (many points per session) and returns one max per unique date.
 *  For "lower is better" metrics (pop_time, exchange_time, sprint_60), takes the min instead. */
const LOWER_IS_BETTER = new Set(['pop_time', 'exchange_time', 'sprint_60']);

function condenseToSessionMax(
  data: { value: number; recordedAt: string }[],
  metricKey?: string,
): { value: number; recordedAt: string }[] {
  const byDate: Record<string, { value: number; recordedAt: string }[]> = {};
  for (const d of data) {
    const date = d.recordedAt.slice(0, 10); // group by YYYY-MM-DD
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  }

  const useLower = metricKey ? LOWER_IS_BETTER.has(metricKey) : false;

  return Object.entries(byDate)
    .map(([date, points]) => {
      const best = useLower
        ? points.reduce((a, b) => (a.value < b.value ? a : b))
        : points.reduce((a, b) => (a.value > b.value ? a : b));
      return { value: best.value, recordedAt: best.recordedAt };
    })
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/* ═══════════════════════════════════════════
   REPORT DATA EXTRACTION HELPERS
   ═══════════════════════════════════════════ */

interface ArmMetricData {
  best: number | null;
  avg: number | null;
}

interface CatchingSummary {
  popTime: ArmMetricData;
  exchangeTime: ArmMetricData;
  catcherVelo: ArmMetricData;
  receivingOverall: number | null;
  blockingOverall: number | null;
}

interface InfieldSummary {
  armVelocity: ArmMetricData;
  armAccuracy: ArmMetricData;
  rangeFootworkOverall: number | null;
  handsGloveOverall: number | null;
}

interface OutfieldSummary {
  armVelocity: ArmMetricData;
  armAccuracy: ArmMetricData;
  routesScore: number | null;
  rangeScore: number | null;
}

function extractCatchingSummary(reports: ReportSummary[]): CatchingSummary {
  const catchingReports = reports
    .filter(r => r.reportType === 'CATCHING' && r.content)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const result: CatchingSummary = {
    popTime: { best: null, avg: null },
    exchangeTime: { best: null, avg: null },
    catcherVelo: { best: null, avg: null },
    receivingOverall: null,
    blockingOverall: null,
  };

  for (const report of catchingReports) {
    try {
      const parsed = JSON.parse(report.content!);
      const ca = parsed.catchingAssessment;
      if (!ca) continue;

      // Pop Time (lower is better, so "best" = lowest)
      if (ca.throwing?.popTime2B?.best !== null && ca.throwing?.popTime2B?.best !== undefined) {
        if (result.popTime.best === null || ca.throwing.popTime2B.best < result.popTime.best) {
          result.popTime.best = ca.throwing.popTime2B.best;
        }
      }
      // Exchange Time
      if (ca.throwing?.exchangeTime?.best !== null && ca.throwing?.exchangeTime?.best !== undefined) {
        if (result.exchangeTime.best === null || ca.throwing.exchangeTime.best < result.exchangeTime.best) {
          result.exchangeTime.best = ca.throwing.exchangeTime.best;
        }
      }
      // Catcher Velocity (higher is better)
      if (ca.throwing?.velocity?.best !== null && ca.throwing?.velocity?.best !== undefined) {
        if (result.catcherVelo.best === null || ca.throwing.velocity.best > result.catcherVelo.best) {
          result.catcherVelo.best = ca.throwing.velocity.best;
        }
      }
      // Receiving and Blocking overall grades (from most recent)
      if (result.receivingOverall === null && ca.receiving?.overallGrade != null) {
        result.receivingOverall = ca.receiving.overallGrade;
      }
      if (result.blockingOverall === null && ca.blocking?.overallGrade != null) {
        result.blockingOverall = ca.blocking.overallGrade;
      }
    } catch { /* skip */ }
  }

  // Avg from most recent report
  if (catchingReports.length > 0) {
    try {
      const latest = JSON.parse(catchingReports[0].content!);
      const ca = latest.catchingAssessment;
      if (ca) {
        if (ca.throwing?.popTime2B?.avg != null) result.popTime.avg = ca.throwing.popTime2B.avg;
        if (ca.throwing?.exchangeTime?.avg != null) result.exchangeTime.avg = ca.throwing.exchangeTime.avg;
        if (ca.throwing?.velocity?.avg != null) result.catcherVelo.avg = ca.throwing.velocity.avg;
      }
    } catch { /* skip */ }
  }

  return result;
}

function extractInfieldSummary(reports: ReportSummary[]): InfieldSummary {
  const infieldReports = reports
    .filter(r => r.reportType === 'INFIELD' && r.content)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const result: InfieldSummary = {
    armVelocity: { best: null, avg: null },
    armAccuracy: { best: null, avg: null },
    rangeFootworkOverall: null,
    handsGloveOverall: null,
  };

  for (const report of infieldReports) {
    try {
      const parsed = JSON.parse(report.content!);
      const ia = parsed.infieldAssessment;
      if (!ia) continue;

      if (ia.arm?.velocity?.best != null) {
        if (result.armVelocity.best === null || ia.arm.velocity.best > result.armVelocity.best) {
          result.armVelocity.best = ia.arm.velocity.best;
        }
      }
      if (ia.arm?.accuracy?.best != null) {
        if (result.armAccuracy.best === null || ia.arm.accuracy.best > result.armAccuracy.best) {
          result.armAccuracy.best = ia.arm.accuracy.best;
        }
      }
      if (result.rangeFootworkOverall === null && ia.rangeFootwork?.overallGrade != null) {
        result.rangeFootworkOverall = ia.rangeFootwork.overallGrade;
      }
      if (result.handsGloveOverall === null && ia.handsGlove?.overallGrade != null) {
        result.handsGloveOverall = ia.handsGlove.overallGrade;
      }
    } catch { /* skip */ }
  }

  // Avg from most recent report
  if (infieldReports.length > 0) {
    try {
      const latest = JSON.parse(infieldReports[0].content!);
      const ia = latest.infieldAssessment;
      if (ia) {
        if (ia.arm?.velocity?.avg != null) result.armVelocity.avg = ia.arm.velocity.avg;
        if (ia.arm?.accuracy?.avg != null) result.armAccuracy.avg = ia.arm.accuracy.avg;
      }
    } catch { /* skip */ }
  }

  return result;
}

function extractOutfieldSummary(reports: ReportSummary[]): OutfieldSummary {
  const outfieldReports = reports
    .filter(r => r.reportType === 'OUTFIELD' && r.content)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const result: OutfieldSummary = {
    armVelocity: { best: null, avg: null },
    armAccuracy: { best: null, avg: null },
    routesScore: null,
    rangeScore: null,
  };

  for (const report of outfieldReports) {
    try {
      const parsed = JSON.parse(report.content!);
      const oa = parsed.outfieldAssessment;
      if (!oa) continue;

      if (oa.arm?.velocity?.best != null) {
        if (result.armVelocity.best === null || oa.arm.velocity.best > result.armVelocity.best) {
          result.armVelocity.best = oa.arm.velocity.best;
        }
      }
      if (oa.arm?.accuracy?.best != null) {
        if (result.armAccuracy.best === null || oa.arm.accuracy.best > result.armAccuracy.best) {
          result.armAccuracy.best = oa.arm.accuracy.best;
        }
      }
      // Routes and Range from most recent report
      if (result.routesScore === null && oa.routesReads?.routes?.grade != null) {
        result.routesScore = oa.routesReads.routes.grade;
      }
      if (result.rangeScore === null && oa.routesReads?.range?.grade != null) {
        result.rangeScore = oa.routesReads.range.grade;
      }
    } catch { /* skip */ }
  }

  // Avg from most recent report
  if (outfieldReports.length > 0) {
    try {
      const latest = JSON.parse(outfieldReports[0].content!);
      const oa = latest.outfieldAssessment;
      if (oa) {
        if (oa.arm?.velocity?.avg != null) result.armVelocity.avg = oa.arm.velocity.avg;
        if (oa.arm?.accuracy?.avg != null) result.armAccuracy.avg = oa.arm.accuracy.avg;
      }
    } catch { /* skip */ }
  }

  return result;
}

/* ═══════════════════════════════════════════
   PITCHER DATA HELPERS
   ═══════════════════════════════════════════ */

interface PitchArsenalRow {
  pitchType: string;
  maxVelo: number;
  avgVelo: number;
  count: number;
  hBreak: number | null;
  ivBreak: number | null;
}

function buildPitchArsenal(pitches: api.TrackmanPitch[]): PitchArsenalRow[] {
  const groups: Record<string, api.TrackmanPitch[]> = {};
  for (const p of pitches) {
    const t = p.pitchType || 'Unknown';
    if (!groups[t]) groups[t] = [];
    groups[t].push(p);
  }

  return Object.entries(groups)
    .map(([type, list]) => {
      const velos = list.map(p => p.relSpeed ?? p.velocity).filter(v => v > 0);
      const hBreaks = list.map(p => p.horzBreak).filter((v): v is number => v !== null);
      const ivBreaks = list.map(p => p.inducedVertBreak).filter((v): v is number => v !== null);

      return {
        pitchType: type,
        maxVelo: velos.length > 0 ? Math.max(...velos) : 0,
        avgVelo: velos.length > 0 ? velos.reduce((a, b) => a + b, 0) / velos.length : 0,
        count: list.length,
        hBreak: hBreaks.length > 0 ? hBreaks.reduce((a, b) => a + b, 0) / hBreaks.length : null,
        ivBreak: ivBreaks.length > 0 ? ivBreaks.reduce((a, b) => a + b, 0) / ivBreaks.length : null,
      };
    })
    .filter(r => r.maxVelo > 0)
    .sort((a, b) => b.avgVelo - a.avgVelo);
}

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

const MONO = "'DM Mono', monospace";

const REPORT_TYPES = ['SUMMARY'];

const PITCH_COLORS: Record<string, string> = {
  Fastball: '#EF4444',
  Sinker: '#F97316',
  Cutter: '#F59E0B',
  Slider: '#3B82F6',
  Curveball: '#8B5CF6',
  Changeup: '#10B981',
  Splitter: '#06B6D4',
  Sweeper: '#6366F1',
  Knuckle: '#A3A3A3',
  Unknown: '#737373',
};

const PITCH_SHORT: Record<string, string> = {
  Fastball: 'FB',
  Sinker: 'SI',
  Cutter: 'FC',
  Slider: 'SL',
  Curveball: 'CB',
  Changeup: 'CH',
  Splitter: 'FS',
  Sweeper: 'SW',
};

function getPitchColor(type: string): string {
  return PITCH_COLORS[type] || '#737373';
}

/* ═══════════════════════════════════════════
   GRADE HELPERS (for scouting grades in defense)
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
  if (grade === null) return '—';
  if (grade >= 70) return 'Plus-Plus';
  if (grade >= 60) return 'Plus';
  if (grade >= 55) return 'Above Avg';
  if (grade >= 50) return 'Average';
  if (grade >= 45) return 'Below Avg';
  if (grade >= 40) return 'Fringe';
  return 'Well Below';
}

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

/** A compact metric card showing "max" + "avg" values */
function DualValueCard({ label, maxVal, maxLabel, avgVal, avgLabel, unit, higherBetter = true }: {
  label: string;
  maxVal: number | null;
  maxLabel?: string;
  avgVal: number | null;
  avgLabel?: string;
  unit: string;
  higherBetter?: boolean;
}) {
  const hasMax = maxVal !== null;
  const hasAvg = avgVal !== null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 26, fontWeight: 800, fontFamily: MONO,
          color: hasMax ? '#FFFFFF' : 'var(--faint)',
          lineHeight: 1,
        }}>
          {hasMax ? maxVal!.toFixed(maxVal! >= 100 ? 0 : maxVal! < 10 ? 2 : 1) : '—'}
        </span>
        {hasMax && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            {unit} {maxLabel || 'best'}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>
        {hasAvg ? (
          <>{avgLabel || 'Avg'}: <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            {avgVal!.toFixed(avgVal! >= 100 ? 0 : avgVal! < 10 ? 2 : 1)}
          </span> {unit}</>
        ) : (
          `${avgLabel || 'Avg'}: —`
        )}
      </div>
    </div>
  );
}

/** A scouting grade badge inline */
function GradeBadge({ grade, label }: { grade: number | null; label: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      minWidth: 0,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: gradeBg(grade),
        border: `2px solid ${gradeColor(grade)}`,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 18, fontWeight: 800, fontFamily: MONO,
          color: gradeColor(grade),
        }}>
          {grade !== null ? grade : '—'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)',
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: gradeColor(grade),
        }}>
          {gradeLabel(grade)}
        </span>
      </div>
    </div>
  );
}

/** Collapsible section wrapper */
function Collapsible({ title, count, defaultOpen = false, children }: {
  title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: open ? '10px 10px 0 0' : 10,
          color: 'var(--text)',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'border-radius 0.15s',
        }}
      >
        <span>{title} ({count})</span>
        <span style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▼
        </span>
      </button>
      {open && (
        <div style={{
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 10px 10px',
          maxHeight: 400,
          overflowY: 'auto',
        }}>
          {children}
        </div>
      )}
    </Section>
  );
}

/** Tooltip for recharts */
function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--card, #1A1A1A)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.name}</span>
        </div>
      ))}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
        {label && new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
}

/** Movement plot scatter chart for pitcher */
function MovementPlot({ pitches, title }: { pitches: api.TrackmanPitch[]; title: string }) {
  const data = pitches
    .filter(p => p.horzBreak !== null && p.inducedVertBreak !== null)
    .map(p => ({
      x: p.horzBreak!,
      y: p.inducedVertBreak!,
      type: p.pitchType || 'Unknown',
    }));

  if (data.length === 0) return null;

  const types = [...new Set(data.map(d => d.type))];

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Horizontal Break vs Induced Vertical Break (inches)
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name="H-Break"
            stroke="#666"
            fontSize={11}
            tickLine={false}
            label={{ value: 'H-Break (in)', position: 'bottom', fill: '#666', fontSize: 10, offset: -2 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="IVB"
            stroke="#666"
            fontSize={11}
            tickLine={false}
            label={{ value: 'IVB (in)', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 10 }}
          />
          <ReferenceLine x={0} stroke="#444" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="#444" strokeDasharray="4 4" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{
                  background: '#1A1A1A', border: '1px solid #333', borderRadius: 8,
                  padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: getPitchColor(d.type) }}>{d.type}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>H-Break: {d.x.toFixed(1)}" | IVB: {d.y.toFixed(1)}"</div>
                </div>
              );
            }}
          />
          {types.map(type => (
            <Scatter
              key={type}
              name={PITCH_SHORT[type] || type}
              data={data.filter(d => d.type === type)}
              fill={getPitchColor(type)}
              opacity={0.8}
              r={5}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
        {types.map(t => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: getPitchColor(t) }} />
            {PITCH_SHORT[t] || t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Multi-line pitch velocity chart */
function PitchVelocityChart({ progressByType }: {
  progressByType: { type: string; data: { date: string; max: number }[] }[];
}) {
  // Merge all dates into unified chart data
  const allDates = new Set<string>();
  for (const { data } of progressByType) {
    for (const d of data) allDates.add(d.date);
  }
  const sortedDates = [...allDates].sort();

  const chartData = sortedDates.map(date => {
    const entry: Record<string, any> = { date };
    for (const { type, data } of progressByType) {
      const match = data.find(d => d.date === date);
      if (match) entry[type] = match.max;
    }
    return entry;
  });

  if (chartData.length === 0) return null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Pitch Velocity Growth
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Max velocity per session by pitch type
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; }}
            stroke="#666"
            fontSize={11}
            tickLine={false}
          />
          <YAxis stroke="#666" fontSize={11} tickLine={false} />
          <Tooltip content={<ChartTooltip unit="mph" />} />
          {progressByType.map(({ type }) => (
            <Line
              key={type}
              type="monotone"
              dataKey={type}
              name={PITCH_SHORT[type] || type}
              stroke={getPitchColor(type)}
              strokeWidth={2.5}
              dot={{ r: 3, fill: getPitchColor(type), strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
        {progressByType.map(({ type }) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: getPitchColor(type) }} />
            {PITCH_SHORT[type] || type}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Dual-metric chart (e.g. Pop-Time + Exchange Time on one chart, or Velo + Accuracy) */
function DualMetricChart({ title, subtitle, data1, data2, label1, label2, color1, color2, unit }: {
  title: string;
  subtitle?: string;
  data1: { value: number; recordedAt: string }[];
  data2: { value: number; recordedAt: string }[];
  label1: string;
  label2: string;
  color1: string;
  color2: string;
  unit?: string;
}) {
  const allDates = new Set<string>();
  data1.forEach(d => allDates.add(d.recordedAt));
  data2.forEach(d => allDates.add(d.recordedAt));
  const sorted = [...allDates].sort();

  const chartData = sorted.map(date => {
    const entry: Record<string, any> = { date };
    const m1 = data1.find(d => d.recordedAt === date);
    const m2 = data2.find(d => d.recordedAt === date);
    if (m1) entry[label1] = m1.value;
    if (m2) entry[label2] = m2.value;
    return entry;
  });

  if (chartData.length === 0) return null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: subtitle ? 2 : 12 }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>{subtitle}</div>}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; }}
            stroke="#666"
            fontSize={11}
            tickLine={false}
          />
          <YAxis stroke="#666" fontSize={11} tickLine={false} />
          <Tooltip content={<ChartTooltip unit={unit || ''} />} />
          <Line type="monotone" dataKey={label1} name={label1} stroke={color1} strokeWidth={2.5}
            dot={{ r: 3, fill: color1, strokeWidth: 0 }} connectNulls />
          <Line type="monotone" dataKey={label2} name={label2} stroke={color2} strokeWidth={2.5}
            dot={{ r: 3, fill: color2, strokeWidth: 0 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color1 }} /> {label1}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color2 }} /> {label2}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   VISION SCORE TABLE
   ═══════════════════════════════════════════ */

const VISION_METRICS = [
  { key: 'vizual_edge_convergence', label: 'Convergence' },
  { key: 'vizual_edge_divergence', label: 'Divergence' },
  { key: 'vizual_edge_tracking', label: 'Tracking' },
  { key: 'vizual_edge_recognition', label: 'Recognition' },
  // Future metrics — will render when data exists
  { key: 'vizual_edge_alignment', label: 'Alignment' },
  { key: 'vizual_edge_depth_perception', label: 'Depth Perception' },
  { key: 'vizual_edge_pursuits', label: 'Pursuits' },
  { key: 'vizual_edge_contrast_sensitivity', label: 'Contrast Sensitivity' },
  { key: 'vizual_edge_multi_object_tracking', label: 'Multi-Object Tracking' },
];

function scoreColor(score: number): string {
  if (score >= 80) return '#4ADE80';
  if (score >= 60) return '#FBBF24';
  if (score >= 40) return '#F97316';
  return '#F87171';
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export function PlayerSummaryTab({
  player, topMetrics, progressData, videos, reports, isCoach, onRefresh,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Position detection
  const pos = useMemo(() => parsePositions(player.positions), [player.positions]);

  // TrackMan data for pitchers
  const [pitches, setPitches] = useState<api.TrackmanPitch[]>([]);
  useEffect(() => {
    if (pos.isPitcher && player.id) {
      api.getTrackmanPitches(player.id).then(setPitches).catch(() => {});
    }
  }, [pos.isPitcher, player.id]);

  // Report-derived summaries
  const catchingSummary = useMemo(() => pos.isCatcher ? extractCatchingSummary(reports) : null, [reports, pos.isCatcher]);
  const infieldSummary = useMemo(() => pos.isInfielder ? extractInfieldSummary(reports) : null, [reports, pos.isInfielder]);
  const outfieldSummary = useMemo(() => pos.isOutfielder ? extractOutfieldSummary(reports) : null, [reports, pos.isOutfielder]);

  // Pitcher arsenal
  const arsenal = useMemo(() => pos.isPitcher ? buildPitchArsenal(pitches) : [], [pitches, pos.isPitcher]);

  // Pitcher velocity progress (group pitches by type + date for growth chart)
  const pitchVeloProgress = useMemo(() => {
    if (!pos.isPitcher || pitches.length === 0) return [];
    const groups: Record<string, Record<string, number[]>> = {};
    for (const p of pitches) {
      const type = p.pitchType || 'Unknown';
      const date = p.recordedAt.slice(0, 10);
      const velo = p.relSpeed ?? p.velocity;
      if (velo <= 0) continue;
      if (!groups[type]) groups[type] = {};
      if (!groups[type][date]) groups[type][date] = [];
      groups[type][date].push(velo);
    }
    return Object.entries(groups).map(([type, dateMap]) => ({
      type,
      data: Object.entries(dateMap)
        .map(([date, velos]) => ({ date, max: Math.max(...velos) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
  }, [pitches, pos.isPitcher]);

  // Most recent session pitches for movement plot
  const recentSessionPitches = useMemo(() => {
    if (pitches.length === 0) return [];
    const sortedByDate = [...pitches].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
    const latestDate = sortedByDate[0].recordedAt.slice(0, 10);
    return sortedByDate.filter(p => p.recordedAt.slice(0, 10) === latestDate);
  }, [pitches]);

  // First session pitches for movement plot comparison
  const firstSessionPitches = useMemo(() => {
    if (pitches.length === 0) return [];
    const sortedByDate = [...pitches].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );
    const firstDate = sortedByDate[0].recordedAt.slice(0, 10);
    return sortedByDate.filter(p => p.recordedAt.slice(0, 10) === firstDate);
  }, [pitches]);

  // Helper: get most recent session avg from progress data
  const getLatestAvg = (key: string): number | null => {
    const d = progressData[key];
    if (!d || d.length === 0) return null;
    return d[d.length - 1].value;
  };

  // Vision metrics
  const edgeScore = topMetrics['vizual_edge_overall'];
  const visionScores = VISION_METRICS
    .map(vm => ({ ...vm, metric: topMetrics[vm.key] }))
    .filter(vm => vm.metric);

  const hasVisionData = !!edgeScore || visionScores.length > 0;

  /* ─────────────────────────────────────
     RENDER
     ───────────────────────────────────── */

  return (
    <>
      {/* ── Report Selector + Download ── */}
      <div className={aStyles.reportSelectorRow}>
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Player Summary"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
        <DownloadPdfButton
          label="Summary PDF"
          onDownload={() => generateSummaryPdf(player, reports, topMetrics)}
        />
      </div>

      {/* ══════════════════════════════════════
         KEY METRICS: HITTING
         ══════════════════════════════════════ */}
      {pos.isHitter && (
        <Section>
          <SectionHeader icon="⚾" iconColor="gold" title="Hitting" subtitle="Best recorded & most recent session" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}>
            <DualValueCard
              label="Exit Velocity"
              maxVal={topMetrics['max_exit_velo']?.value ?? null}
              avgVal={getLatestAvg('avg_exit_velo')}
              avgLabel="Avg (last session)"
              unit="mph"
            />
            <DualValueCard
              label="Bat Speed"
              maxVal={topMetrics['max_bat_speed']?.value ?? null}
              avgVal={getLatestAvg('avg_bat_speed')}
              avgLabel="Avg (last session)"
              unit="mph"
            />
            <DualValueCard
              label="Launch Angle"
              maxVal={topMetrics['launch_angle']?.value ?? null}
              maxLabel="avg"
              avgVal={topMetrics['attack_angle']?.value ?? null}
              avgLabel="Attack Angle"
              unit="°"
            />
            <DualValueCard
              label="Distance"
              maxVal={topMetrics['distance']?.value ?? null}
              avgVal={getLatestAvg('distance')}
              avgLabel="Avg (last session)"
              unit="ft"
            />
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: PITCHING
         ══════════════════════════════════════ */}
      {pos.isPitcher && (
        <Section>
          <SectionHeader icon="⚾" iconColor="red" title="Pitching Arsenal" subtitle="Most recent TrackMan session" />
          {arsenal.length > 0 ? (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              {/* Table Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '130px 80px 80px 80px 80px',
                gap: 8,
                padding: '10px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                <span>Pitch</span>
                <span style={{ textAlign: 'center' }}>Max Velo</span>
                <span style={{ textAlign: 'center' }}>Avg Velo</span>
                <span style={{ textAlign: 'center' }}>H-Break</span>
                <span style={{ textAlign: 'center' }}>IVB</span>
              </div>
              {/* Rows */}
              {arsenal.map(row => (
                <div
                  key={row.pitchType}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '130px 80px 80px 80px 80px',
                    gap: 8,
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border)',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: getPitchColor(row.pitchType), flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {row.pitchType}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--faint)' }}>({row.count})</span>
                  </span>
                  <span style={{
                    fontSize: 15, fontWeight: 800, fontFamily: MONO,
                    color: '#FFFFFF', textAlign: 'center',
                  }}>
                    {row.maxVelo.toFixed(1)}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 600, fontFamily: MONO,
                    color: 'var(--text-secondary)', textAlign: 'center',
                  }}>
                    {row.avgVelo.toFixed(1)}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 600, fontFamily: MONO,
                    color: 'var(--text-secondary)', textAlign: 'center',
                  }}>
                    {row.hBreak !== null ? `${row.hBreak.toFixed(1)}"` : '—'}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 600, fontFamily: MONO,
                    color: 'var(--text-secondary)', textAlign: 'center',
                  }}>
                    {row.ivBreak !== null ? `${row.ivBreak.toFixed(1)}"` : '—'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyMsg}>
              No TrackMan pitch data available.
              <span className={styles.emptyHint}>
                {isCoach ? 'Upload TrackMan CSV to populate pitching metrics.' : 'Ask your coach to upload pitch data.'}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: DEFENSE — CATCHER
         ══════════════════════════════════════ */}
      {pos.isCatcher && catchingSummary && (
        <Section>
          <SectionHeader icon="🎯" iconColor="teal" title="Catching" subtitle="Best from all reports & most recent session" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            <DualValueCard
              label="Pop Time"
              maxVal={catchingSummary.popTime.best}
              maxLabel="best"
              avgVal={catchingSummary.popTime.avg}
              avgLabel="Avg (last)"
              unit="s"
              higherBetter={false}
            />
            <DualValueCard
              label="Exchange Time"
              maxVal={catchingSummary.exchangeTime.best}
              maxLabel="best"
              avgVal={catchingSummary.exchangeTime.avg}
              avgLabel="Avg (last)"
              unit="s"
              higherBetter={false}
            />
            <DualValueCard
              label="Catcher Velocity"
              maxVal={catchingSummary.catcherVelo.best}
              avgVal={catchingSummary.catcherVelo.avg}
              avgLabel="Avg (last)"
              unit="mph"
            />
            <GradeBadge label="Overall Receiving" grade={catchingSummary.receivingOverall} />
            <GradeBadge label="Overall Blocking" grade={catchingSummary.blockingOverall} />
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: DEFENSE — INFIELD
         ══════════════════════════════════════ */}
      {pos.isInfielder && infieldSummary && (
        <Section>
          <SectionHeader icon="🧤" iconColor="gold" title="Infield" subtitle="Best from all reports & most recent session" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            <DualValueCard
              label="Arm Strength"
              maxVal={infieldSummary.armVelocity.best}
              avgVal={infieldSummary.armVelocity.avg}
              avgLabel="Avg (last)"
              unit="mph"
            />
            <DualValueCard
              label="Arm Accuracy"
              maxVal={infieldSummary.armAccuracy.best}
              avgVal={infieldSummary.armAccuracy.avg}
              avgLabel="Avg (last)"
              unit="%"
            />
            <GradeBadge label="Range / Footwork" grade={infieldSummary.rangeFootworkOverall} />
            <GradeBadge label="Hands / Glove" grade={infieldSummary.handsGloveOverall} />
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: DEFENSE — OUTFIELD
         ══════════════════════════════════════ */}
      {pos.isOutfielder && outfieldSummary && (
        <Section>
          <SectionHeader icon="🏃" iconColor="green" title="Outfield" subtitle="Best from all reports & most recent session" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            <DualValueCard
              label="Arm Strength"
              maxVal={outfieldSummary.armVelocity.best}
              avgVal={outfieldSummary.armVelocity.avg}
              avgLabel="Avg (last)"
              unit="mph"
            />
            <DualValueCard
              label="Arm Accuracy"
              maxVal={outfieldSummary.armAccuracy.best}
              avgVal={outfieldSummary.armAccuracy.avg}
              avgLabel="Avg (last)"
              unit="%"
            />
            <GradeBadge label="Routes" grade={outfieldSummary.routesScore} />
            <GradeBadge label="Range" grade={outfieldSummary.rangeScore} />
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: VISION
         ══════════════════════════════════════ */}
      {hasVisionData && (
        <Section>
          <SectionHeader icon="👁️" iconColor="teal" title="Vision" subtitle="Vizual Edge scores (1-100)" />

          {/* Edge Score — prominent */}
          {edgeScore && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 20,
              padding: '20px 24px',
              background: 'var(--surface)',
              border: `1px solid ${scoreColor(edgeScore.value)}33`,
              borderRadius: 12,
              marginBottom: 16,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${scoreColor(edgeScore.value)}18`,
                border: `2px solid ${scoreColor(edgeScore.value)}`,
              }}>
                <span style={{
                  fontSize: 26, fontWeight: 800, fontFamily: MONO,
                  color: scoreColor(edgeScore.value),
                }}>
                  {edgeScore.value.toFixed(0)}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text-muted)',
                }}>
                  Edge Score
                </span>
                <span style={{
                  fontSize: 18, fontWeight: 800,
                  color: scoreColor(edgeScore.value),
                }}>
                  {edgeScore.value.toFixed(0)} / 100
                </span>
                <span style={{ fontSize: 10, color: 'var(--faint)' }}>
                  Overall visual performance
                </span>
              </div>
            </div>
          )}

          {/* Detailed scores table */}
          {visionScores.length > 0 && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 70px 1fr',
                gap: 8,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                <span>Metric</span>
                <span style={{ textAlign: 'center' }}>Score</span>
                <span>Rating</span>
              </div>
              {visionScores.map(({ key, label, metric }) => {
                const val = metric!.value;
                const pct = Math.min(val, 100);
                return (
                  <div key={key} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 70px 1fr',
                    gap: 8,
                    padding: '8px 16px',
                    borderBottom: '1px solid var(--border)',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
                    <span style={{
                      fontSize: 15, fontWeight: 800, fontFamily: MONO,
                      color: scoreColor(val), textAlign: 'center',
                    }}>
                      {val.toFixed(0)}
                    </span>
                    <div style={{
                      height: 6, borderRadius: 3, background: 'var(--border)',
                      overflow: 'hidden', position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute', top: 0, left: 0, height: '100%',
                        width: `${pct}%`, borderRadius: 3,
                        background: `linear-gradient(90deg, ${scoreColor(val)}88, ${scoreColor(val)})`,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* ══════════════════════════════════════
         KEY METRICS: STRENGTH & CONDITIONING
         ══════════════════════════════════════ */}
      <Section>
        <SectionHeader icon="💪" iconColor="red" title="Strength & Conditioning" subtitle="VALD Performance data" />
        {(() => {
          const strengthKeys = [
            'jump_height', 'broad_jump', 'sprint_60',
            'squat_max', 'bench_max', 'deadlift_max',
            'grip_strength_l', 'grip_strength_r', 'body_weight',
          ];
          const available = strengthKeys.filter(k => topMetrics[k]);

          if (available.length === 0) {
            return (
              <div className={styles.emptyMsg}>
                No strength & conditioning data available yet.
                <span className={styles.emptyHint}>
                  This section will populate with VALD performance data when available.
                </span>
              </div>
            );
          }

          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}>
              {available.map(key => {
                const m = topMetrics[key];
                return (
                  <DualValueCard
                    key={key}
                    label={METRIC_LABELS[key] || key}
                    maxVal={m.value}
                    maxLabel=""
                    avgVal={getLatestAvg(key)}
                    avgLabel="Latest"
                    unit={m.unit}
                  />
                );
              })}
            </div>
          );
        })()}
      </Section>

      {/* ══════════════════════════════════════
         GROWTH CHARTS
         ══════════════════════════════════════ */}

      {/* ── Hitter Graphs ── */}
      {pos.isHitter && (progressData['max_exit_velo'] || progressData['max_bat_speed']) && (
        <Section>
          <SectionHeader icon="📈" iconColor="gold" title="Hitting Growth" subtitle="Max values per session" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {progressData['max_exit_velo'] && (
              <MetricChart
                title="Max Exit Velocity"
                unit="mph"
                data={condenseToSessionMax(progressData['max_exit_velo'], 'max_exit_velo')}
                color="#4A90D9"
              />
            )}
            {progressData['max_bat_speed'] && (
              <MetricChart
                title="Max Bat Speed"
                unit="mph"
                data={condenseToSessionMax(progressData['max_bat_speed'], 'max_bat_speed')}
                color="#E8AF34"
              />
            )}
          </div>
        </Section>
      )}

      {/* ── Pitcher Graphs ── */}
      {pos.isPitcher && pitchVeloProgress.length > 0 && (
        <Section>
          <SectionHeader icon="📈" iconColor="red" title="Pitching Growth" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <PitchVelocityChart progressByType={pitchVeloProgress} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {firstSessionPitches.length > 0 && recentSessionPitches.length > 0 && firstSessionPitches[0].recordedAt.slice(0, 10) !== recentSessionPitches[0].recordedAt.slice(0, 10) ? (
                <>
                  <MovementPlot
                    pitches={firstSessionPitches}
                    title={`Initial Assessment (${new Date(firstSessionPitches[0].recordedAt).toLocaleDateString()})`}
                  />
                  <MovementPlot
                    pitches={recentSessionPitches}
                    title={`Most Recent (${new Date(recentSessionPitches[0].recordedAt).toLocaleDateString()})`}
                  />
                </>
              ) : recentSessionPitches.length > 0 ? (
                <MovementPlot
                  pitches={recentSessionPitches}
                  title={`Movement Plot (${new Date(recentSessionPitches[0].recordedAt).toLocaleDateString()})`}
                />
              ) : null}
            </div>
          </div>
        </Section>
      )}

      {/* ── Catcher Graphs ── */}
      {pos.isCatcher && (progressData['pop_time'] || progressData['exchange_time'] || progressData['catcher_velo']) && (
        <Section>
          <SectionHeader icon="📈" iconColor="teal" title="Catching Growth" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {(progressData['pop_time'] || progressData['exchange_time']) && (
              <DualMetricChart
                title="Pop Time & Exchange Time"
                subtitle="Best per assessment"
                data1={condenseToSessionMax(progressData['pop_time'] || [], 'pop_time')}
                data2={condenseToSessionMax(progressData['exchange_time'] || [], 'exchange_time')}
                label1="Pop Time"
                label2="Exchange"
                color1="#EF4444"
                color2="#F97316"
                unit="s"
              />
            )}
            {progressData['catcher_velo'] && (
              <MetricChart
                title="Catcher Arm Velocity"
                unit="mph"
                data={condenseToSessionMax(progressData['catcher_velo'], 'catcher_velo')}
                color="#3B82F6"
              />
            )}
          </div>
        </Section>
      )}

      {/* ── Infield Graphs ── */}
      {pos.isInfielder && progressData['infield_velo'] && (
        <Section>
          <SectionHeader icon="📈" iconColor="gold" title="Infield Growth" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 600 }}>
            <MetricChart
              title="Max Infield Arm Velocity"
              unit="mph"
              data={condenseToSessionMax(progressData['infield_velo'], 'infield_velo')}
              color="#FF9500"
            />
          </div>
        </Section>
      )}

      {/* ── Outfield Graphs ── */}
      {pos.isOutfielder && progressData['outfield_velo'] && (
        <Section>
          <SectionHeader icon="📈" iconColor="green" title="Outfield Growth" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 600 }}>
            <MetricChart
              title="Max Outfield Arm Velocity"
              unit="mph"
              data={condenseToSessionMax(progressData['outfield_velo'], 'outfield_velo')}
              color="#FF6B00"
            />
          </div>
        </Section>
      )}

      {/* ── Vision Graphs ── */}
      {progressData['vizual_edge_overall'] && (
        <Section>
          <SectionHeader icon="📈" iconColor="teal" title="Vision Growth" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 600 }}>
            <MetricChart
              title="Edge Score"
              unit="score"
              data={condenseToSessionMax(progressData['vizual_edge_overall'], 'vizual_edge_overall')}
              color="#06B6D4"
            />
          </div>
        </Section>
      )}

      {/* ── VALD Graphs Placeholder ── */}
      <Section>
        <SectionHeader icon="📈" iconColor="red" title="Strength Growth" subtitle="VALD Performance trends" />
        {(() => {
          const valdKeys = ['jump_height', 'broad_jump', 'squat_max', 'bench_max', 'deadlift_max'];
          const available = valdKeys.filter(k => progressData[k]);

          if (available.length === 0) {
            return (
              <div className={styles.emptyMsg}>
                No strength trend data available yet.
                <span className={styles.emptyHint}>
                  Strength growth charts will populate as VALD data is recorded over time.
                </span>
              </div>
            );
          }

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {available.map(key => (
                <MetricChart
                  key={key}
                  title={METRIC_LABELS[key] || key}
                  unit={topMetrics[key]?.unit || ''}
                  data={condenseToSessionMax(progressData[key], key)}
                  color={CHART_COLORS[key] || '#AF52DE'}
                />
              ))}
            </div>
          );
        })()}
      </Section>

      {/* ══════════════════════════════════════
         REPORTS (COLLAPSIBLE)
         ══════════════════════════════════════ */}
      <Collapsible title="Reports" count={reports.length}>
        {reports.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No reports yet.
          </div>
        ) : (
          <div>
            {[...reports]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(r => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                      color: '#FFFFFF', letterSpacing: '0.5px',
                      padding: '3px 8px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.08)',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {r.reportType}
                    </span>
                    {r.notes && (
                      <span style={{
                        fontSize: 12, color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.notes}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                    {new Date(r.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Collapsible>

      {/* ══════════════════════════════════════
         VIDEOS (COLLAPSIBLE)
         ══════════════════════════════════════ */}
      <Collapsible title="Videos" count={videos.length}>
        {videos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No videos uploaded yet.
          </div>
        ) : (
          <div>
            {[...videos]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(v => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    cursor: v.originalUrl ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (v.originalUrl) window.open(v.originalUrl, '_blank');
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                      color: '#FFFFFF', letterSpacing: '0.5px',
                      padding: '3px 8px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.08)',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {v.category}
                    </span>
                    <span style={{
                      fontSize: 13, fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {v.title}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                    {new Date(v.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Collapsible>
    </>
  );
}
