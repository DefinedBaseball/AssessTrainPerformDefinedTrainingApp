'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart, ReferenceLine,
  ScatterChart, Scatter, ZAxis, Legend, Cell,
  BarChart, Bar, LabelList,
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
import { CustomCharts } from '@/components/CustomCharts';
import { TabBarActions } from '@/components/assessment';
import VideoThumbnail from '@/components/VideoThumbnail';

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

// scoreColor moved to helpers.ts so the hero Player Score bubble
// can share the same band logic as the per-section summary scores.

/* ═══════════════════════════════════════════
   MAIN COMPONENT — aggregate-score layout
   ═══════════════════════════════════════════ */

import { computeAggregateScores, scoreColor, type AggregateBar, type AggregateSection } from '../helpers';

export function PlayerSummaryTab({
  player, topMetrics, reports,
}: TabProps) {
  const aggregate = useMemo(
    () => computeAggregateScores(player, reports, topMetrics),
    [player, reports, topMetrics],
  );

  // Flat list of every populated (score != null) bar, in visual order.
  // Drives both the auto-cycle and the click-to-pin behavior.
  const populatedBars = useMemo(() => {
    const result: Array<{ section: AggregateSection; bar: AggregateBar }> = [];
    for (const s of aggregate.sections) {
      for (const b of s.bars) {
        if (b.score !== null) result.push({ section: s, bar: b });
      }
    }
    return result;
  }, [aggregate]);

  // The currently-highlighted bar is derived from selectedKey; that key
  // is advanced every 15s by the interval, OR overridden immediately
  // when the athlete clicks a bar (which also flips autoCycle off).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoCycle, setAutoCycle] = useState(true);

  const selected = useMemo(() => {
    if (populatedBars.length === 0) return null;
    const hit = populatedBars.find((p) => p.bar.key === selectedKey);
    return hit ?? populatedBars[0];
  }, [populatedBars, selectedKey]);

  // Auto-cycle — advances to the next populated bar every 15 seconds,
  // loops back to the start. Disabled permanently once the user clicks.
  useEffect(() => {
    if (!autoCycle || populatedBars.length <= 1) return;
    const id = setInterval(() => {
      setSelectedKey((cur) => {
        const idx = populatedBars.findIndex((p) => p.bar.key === cur);
        const next = populatedBars[(idx + 1) % populatedBars.length];
        return next.bar.key;
      });
    }, 15000);
    return () => clearInterval(id);
  }, [autoCycle, populatedBars]);

  function pinSelection(barKey: string): void {
    setAutoCycle(false);
    setSelectedKey(barKey);
  }

  // Per-section chart data + rolled-up section averages.
  const sectionCharts = useMemo(() => {
    return aggregate.sections.map((s) => {
      const rows = s.bars.map((b) => ({
        key: b.key,
        label: b.label,
        // Recharts renders 0-height bars as invisible. Use 20 (chart floor)
        // when the score is null so the column still gets a clickable hit
        // target and a placeholder silhouette. We dim it in <Cell>.
        score: b.score ?? 20,
        realScore: b.score,
      }));
      const scored = s.bars
        .map((b) => b.score)
        .filter((v): v is number => v !== null);
      const avg = scored.length > 0
        ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
        : null;
      return { section: s, rows, avg };
    });
  }, [aggregate]);

  return (
    <>
      {/* ── Download (portaled into TabBar) ── */}
      <TabBarActions>
        <DownloadPdfButton
          label="Download PDF"
          onDownload={() => generateSummaryPdf(player, reports, topMetrics)}
        />
      </TabBarActions>

      {/* ── Per-section bar charts ── */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          marginTop: 4,
          marginBottom: 20,
        }}
      >
        {sectionCharts.map(({ section, rows, avg }) => (
          <div
            key={section.key}
            style={{
              flex: rows.length,
              background: 'var(--card-elev)',
              border: '1px solid var(--border)',
              borderTop: `3px solid ${section.color}`,
              borderRadius: 12,
              padding: '12px 10px 10px',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            {/* Section header: label + overall section score */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px 8px',
                borderBottom: '1px solid var(--border)',
                marginBottom: 8,
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: section.color,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textAlign: 'center',
                }}
              >
                {section.label}
              </div>
              <div
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: avg == null ? 'var(--text-muted)' : scoreColor(avg),
                    letterSpacing: '-0.01em',
                  }}
                >
                  {avg ?? '—'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--faint)' }}>/ 80</span>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rows} margin={{ top: 28, right: 6, bottom: 4, left: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  domain={[20, 80]}
                  ticks={[20, 30, 40, 50, 60, 70, 80]}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  width={30}
                />
                <ReferenceLine y={50} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'var(--card-elev)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(_v: any, _n: any, item: any) => {
                    const row = item?.payload;
                    return [row?.realScore ?? '—', `${section.label} · ${row?.label ?? ''}`];
                  }}
                />
                <Bar
                  dataKey="score"
                  radius={[6, 6, 0, 0]}
                  onClick={(data: any) => {
                    if (data?.payload?.key) pinSelection(data.payload.key);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.realScore == null ? '#6B7280' : scoreColor(row.realScore)}
                      fillOpacity={row.realScore == null ? 0.25 : 1}
                    />
                  ))}
                  <LabelList
                    dataKey="realScore"
                    position="top"
                    style={{ fill: 'var(--text)', fontSize: 15, fontWeight: 700 }}
                    formatter={(v: any) => (v == null ? '—' : v)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          justifyContent: 'center',
          paddingBottom: 16,
          fontSize: 11,
          color: 'var(--text-muted)',
        }}
      >
        <span>Click any bar for details · 20–80 scouting scale · Faded bars have no data yet</span>
      </div>

      {/* ── Bar detail panel ── */}
      {selected && (
        <div
          style={{
            background: 'var(--card-elev)',
            border: `1px solid ${selected.section.color}55`,
            borderLeft: `4px solid ${selected.section.color}`,
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: selected.section.color,
                  marginBottom: 4,
                }}
              >
                {selected.section.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: 'var(--text)',
                  letterSpacing: '-0.01em',
                }}
              >
                {selected.bar.label}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Aggregate:{' '}
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                  {selected.bar.score ?? '—'}
                </span>
                <span style={{ color: 'var(--faint)' }}> / 80</span>
              </div>
            </div>
            {autoCycle && populatedBars.length > 1 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.04em',
                }}
                title="Cycling every 15s — click any bar to pin"
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: selected.section.color,
                    boxShadow: `0 0 6px ${selected.section.color}`,
                  }}
                />
                Auto · 15s
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--faint)',
                  letterSpacing: '0.04em',
                  padding: '4px 10px',
                }}
              >
                Pinned
              </div>
            )}
          </div>

          {selected.bar.subMetrics.length === 0 ? (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                background: 'rgba(0,0,0,0.15)',
                borderRadius: 8,
              }}
            >
              Underlying metric breakdown will populate here once scoring logic is wired in.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              {selected.bar.subMetrics.map((sm) => (
                <div
                  key={sm.key}
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: 4,
                    }}
                  >
                    {sm.label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                    {sm.grade ?? sm.value ?? '—'}
                    {sm.unit && (
                      <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 4 }}>
                        {sm.unit}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CustomCharts section="OVERVIEW" playerId={player.id} />
    </>
  );
}

