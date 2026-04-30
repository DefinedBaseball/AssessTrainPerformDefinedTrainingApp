'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips,
  VideoPlaceholder, NotesBox, ReportSelector, TabBarActions,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import s from './SwingBattedBallTab.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES,
  getReportVideoIds, getReportContentVideos,
  getReportUploadIds,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { CustomCharts } from '@/components/CustomCharts';

/* ═══════════════════════════════════════════
   SPRAY CHART COMPONENT (SVG)
   Converts Direction (deg) + Distance (ft)
   into dots on a baseball field diagram.
   ═══════════════════════════════════════════ */

interface SprayDot {
  angle: number;         // spray angle in degrees (-45 to 45, 0 = center)
  distance: number;      // ft
  exitVelo?: number;     // mph
  launchAngle?: number;  // degrees
  batSpeed?: number;     // mph
  squaredUp?: number;    // percentage (0-100)
}

/* Single navy → light-blue → white ramp.  t is clamped to [0,1]:
   0   → navy       (#1E3A8A) = rgb( 30,  58, 138)
   0.5 → light blue (#60A5FA) = rgb( 96, 165, 250)
   1   → white      (#FFFFFF) = rgb(255, 255, 255)
   Two-segment RGB lerp keeps the transitions clean. */
function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  let r: number, g: number, b: number;
  if (x < 0.5) {
    const u = x * 2;                          // navy → light blue
    r = lerp( 30,  96, u);
    g = lerp( 58, 165, u);
    b = lerp(138, 250, u);
  } else {
    const u = (x - 0.5) * 2;                  // light blue → white
    r = lerp( 96, 255, u);
    g = lerp(165, 255, u);
    b = lerp(250, 255, u);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
function rampGlow(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  // Glow hue shifts from deep navy at the low end to a cool white haze at the top.
  const hue = x < 0.5 ? 222 : 210;
  const sat = x < 0.5 ? 70 - (1 - x * 2) * 25 : 60 - (x - 0.5) * 2 * 55;
  const light = x < 0.5 ? 40 + x * 2 * 25 : 65 + (x - 0.5) * 2 * 25;
  const alpha = 0.30 + Math.abs(x - 0.5) * 0.30;
  return `hsla(${hue}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha.toFixed(2)})`;
}
/* Navy points render heavier, white points render bold-stroked so the
   ramp reads at a glance even when EV is bunched in the mid range. */
function rampOpacity(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  // Navy (t=0) stays near full opacity; fades slightly as we climb toward white.
  return 0.98 - x * 0.18;
}
function rampStrokeWidth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  // Thin outline on navy; white gets a bolder ring so it pops on the HUD.
  return 0.5 + x * 1.1;
}
function rampStroke(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const alpha = 0.35 + x * 0.45;
  return `rgba(6,8,14,${alpha.toFixed(2)})`;
}

type ColorAxisKey = 'exitVelo' | 'launchAngle' | 'batSpeed' | 'squaredUp';
interface ColorAxisDef {
  key: ColorAxisKey;
  label: string;
  unit: string;
  min: number;   // maps to red
  max: number;   // maps to green
  ticks: number[];
}
const COLOR_AXES: Record<ColorAxisKey, ColorAxisDef> = {
  exitVelo:    { key: 'exitVelo',    label: 'EXIT VELO',    unit: 'mph', min: 75, max: 105, ticks: [75, 85, 95, 105] },
  launchAngle: { key: 'launchAngle', label: 'LAUNCH ANGLE', unit: '°',   min: -10, max: 30,  ticks: [-10, 0, 15, 30] },
  batSpeed:    { key: 'batSpeed',    label: 'BAT SPEED',    unit: 'mph', min: 55, max: 80,  ticks: [55, 65, 72, 80] },
  squaredUp:   { key: 'squaredUp',   label: 'SQUARED UP',   unit: '%',   min: 40, max: 95,  ticks: [40, 60, 80, 95] },
};

function SprayChart({ dots, selected, onSelect, axis }: {
  dots: SprayDot[];
  selected: number | null;
  onSelect: (idx: number | null) => void;
  axis: ColorAxisDef;
}) {
  const W = 520;
  const H = 460;
  const cx = W / 2;
  const cy = H - 24;
  const maxDist = 420;
  const scale = (H - 70) / maxDist;

  const toXY = (angleDeg: number, dist: number): [number, number] => {
    const rad = ((90 - angleDeg) * Math.PI) / 180;
    const r = dist * scale;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };

  const distArcs = [120, 200, 280, 360];

  /* Color axis is selectable — the active filter drives a
     shared red → yellow → green gradient normalized to the
     axis's min/max range. */
  const axisT = (v?: number): number => {
    if (v == null) return 0;
    return (v - axis.min) / (axis.max - axis.min);
  };
  const dotColor = (v?: number) => v == null ? 'hsl(0, 0%, 55%)' : rampColor(axisT(v));
  const dotGlow  = (v?: number) => v == null ? 'hsla(0, 0%, 55%, 0.45)' : rampGlow(axisT(v));
  const valueOf = (d: SprayDot): number | undefined => {
    switch (axis.key) {
      case 'exitVelo':    return d.exitVelo;
      case 'launchAngle': return d.launchAngle;
      case 'batSpeed':    return d.batSpeed;
      case 'squaredUp':   return d.squaredUp;
    }
  };

  /* Angular tick marks around the outer rim (±45° in 15° steps) */
  const angularTicks = [-45, -30, -15, 0, 15, 30, 45];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', cursor: 'default' }}>
      <defs>
        {/* Scan-line overlay — gives the HUD its tactical texture
           (canvas itself is transparent so the outer bubble gradient shows through) */}
        <pattern id="scanlines" x="0" y="0" width="1" height="5" patternUnits="userSpaceOnUse">
          <rect width="1" height="5" fill="transparent" />
          <rect y="0" width="1" height="1" fill="rgba(255,255,255,0.018)" />
        </pattern>
        {/* Home-plate beacon glow */}
        <radialGradient id="beacon" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="rgba(126,182,255,0.50)" />
          <stop offset="40%" stopColor="rgba(61,139,253,0.20)" />
          <stop offset="100%" stopColor="rgba(61,139,253,0)" />
        </radialGradient>
        {/* EV legend gradient — navy (low) → light blue (mid) → white (elite) */}
        <linearGradient id="evScale" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#1E3A8A" />
          <stop offset="50%"  stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>

      {/* Transparent click-to-deselect surface — lets the bubble gradient show through */}
      <rect width={W} height={H} fill="transparent" onClick={() => onSelect(null)} />
      <rect width={W} height={H} fill="url(#scanlines)" pointerEvents="none" />

      {/* Home-plate beacon */}
      <circle cx={cx} cy={cy} r={130} fill="url(#beacon)" pointerEvents="none" />

      {/* Distance arcs — silver dashed hairlines, with mono chips anchored on the RIGHT edge */}
      {distArcs.map(d => {
        const r = d * scale;
        const [lx, ly] = [cx - r * Math.cos(Math.PI / 4), cy - r * Math.sin(Math.PI / 4)];
        const [rx, ry] = [cx + r * Math.cos(Math.PI / 4), cy - r * Math.sin(Math.PI / 4)];
        return (
          <g key={d}>
            <path
              d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`}
              fill="none" stroke="rgba(183,190,201,0.14)" strokeWidth={0.75} strokeDasharray="3 5"
            />
            {/* label chip anchored to right edge of arc */}
            <g transform={`translate(${rx + 6}, ${ry + 4})`}>
              <rect x={-2} y={-9} width={42} height={16} rx={8}
                fill="rgba(10,12,18,0.75)"
                stroke="rgba(183,190,201,0.18)"
                strokeWidth={0.6}
              />
              <text x={19} y={2.5}
                fill="rgba(183,190,201,0.8)"
                fontSize={9}
                fontFamily="'DM Mono', ui-monospace, monospace"
                fontWeight={600}
                letterSpacing="0.14em"
                textAnchor="middle">
                {d}FT
              </text>
            </g>
          </g>
        );
      })}

      {/* Angular ticks + degree labels around the ±45° arc rim */}
      {angularTicks.map(deg => {
        const rad = ((90 - deg) * Math.PI) / 180;
        const rInner = (maxDist - 30) * scale;
        const rOuter = (maxDist - 12) * scale;
        const rLabel = (maxDist - 2) * scale;
        const x1 = cx + rInner * Math.cos(rad);
        const y1 = cy - rInner * Math.sin(rad);
        const x2 = cx + rOuter * Math.cos(rad);
        const y2 = cy - rOuter * Math.sin(rad);
        const lx = cx + rLabel * Math.cos(rad);
        const ly = cy - rLabel * Math.sin(rad);
        const isCenter = deg === 0;
        return (
          <g key={`tick${deg}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isCenter ? 'rgba(126,182,255,0.55)' : 'rgba(183,190,201,0.38)'}
              strokeWidth={isCenter ? 1.2 : 0.9}
            />
            <text x={lx} y={ly}
              fill={isCenter ? 'rgba(126,182,255,0.9)' : 'rgba(183,190,201,0.58)'}
              fontSize={9}
              fontFamily="'DM Mono', ui-monospace, monospace"
              fontWeight={600}
              letterSpacing="0.08em"
              textAnchor="middle"
              dominantBaseline="central">
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </text>
          </g>
        );
      })}

      {/* Foul rails — bright silver hairlines (the ±45° boundary) */}
      {(() => {
        const r = maxDist * scale;
        return (
          <>
            <line x1={cx} y1={cy} x2={cx - r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
            <line x1={cx} y1={cy} x2={cx + r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
          </>
        );
      })()}

      {/* Bases — tight silver diamonds */}
      {(() => {
        const baseDist = 90 * scale * 0.72;
        const bases: [number, number][] = [
          [cx, cy - baseDist],
          [cx - baseDist * 0.7, cy - baseDist * 0.5],
          [cx + baseDist * 0.7, cy - baseDist * 0.5],
        ];
        return bases.map(([bx, by], i) => (
          <rect key={`base${i}`} x={bx - 3} y={by - 3} width={6} height={6}
            fill="rgba(223,227,232,0.82)" stroke="rgba(255,255,255,0.45)" strokeWidth={0.6}
            transform={`rotate(45 ${bx} ${by})`}
          />
        ));
      })()}
      {/* Home plate — silver pentagon */}
      <polygon
        points={`${cx},${cy - 5.5} ${cx + 5.5},${cy - 2} ${cx + 4.5},${cy + 3.5} ${cx - 4.5},${cy + 3.5} ${cx - 5.5},${cy - 2}`}
        fill="rgba(223,227,232,0.92)" stroke="rgba(255,255,255,0.5)" strokeWidth={0.75}
      />

      {/* Selected → thin white vector line from home plate to the dot */}
      {selected !== null && dots[selected] && (() => {
        const dot = dots[selected];
        const [sx, sy] = toXY(dot.angle, dot.distance);
        return (
          <line x1={cx} y1={cy} x2={sx} y2={sy}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={0.8}
            strokeDasharray="2 3"
            pointerEvents="none"
          />
        );
      })()}

      {/* Batted-ball dots — fills driven by the active color axis (navy→white).
         Opacity and stroke width ride the same t so navy dots are heavier and
         white dots get a bolder ring. */}
      {dots.map((dot, i) => {
        const [x, y] = toXY(dot.angle, dot.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const isSelected = selected === i;
        const v = valueOf(dot);
        const t = v == null ? 0 : Math.max(0, Math.min(1, axisT(v)));
        const color = dotColor(v);
        const glow  = dotGlow(v);
        const pointOpacity = v == null ? 0.85 : rampOpacity(t);
        const pointStrokeWidth = v == null ? 0.75 : rampStrokeWidth(t);
        const pointStroke = v == null ? 'rgba(6,8,14,0.55)' : rampStroke(t);
        const glowOpacity = isSelected ? 0.95 : 0.40 + t * 0.25;
        return (
          <g key={i}
             style={{ cursor: 'pointer' }}
             onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : i); }}>
            <circle cx={x} cy={y} r={isSelected ? 15 : 9} fill={glow} opacity={glowOpacity} />
            <circle cx={x} cy={y}
              r={isSelected ? 6.5 : 4}
              fill={color}
              fillOpacity={pointOpacity}
              stroke={isSelected ? '#ffffff' : pointStroke}
              strokeWidth={isSelected ? 2 : pointStrokeWidth}
              style={{ transition: 'all 0.15s ease' }}
            />
            {isSelected && (
              <circle cx={x - 1.4} cy={y - 1.4} r={1.3} fill="rgba(255,255,255,0.92)" />
            )}
          </g>
        );
      })}

      {/* Top rim — L/C/R zone labels */}
      {(() => {
        const zones = [
          { x: W * 0.22, label: 'LEFT' },
          { x: W * 0.50, label: 'CENTER' },
          { x: W * 0.78, label: 'RIGHT' },
        ];
        return zones.map(z => (
          <text key={z.label}
            x={z.x} y={18}
            fill="rgba(183,190,201,0.55)"
            fontSize={9}
            fontFamily="'DM Mono', ui-monospace, monospace"
            fontWeight={600}
            letterSpacing="0.28em"
            textAnchor="middle">
            {z.label}
          </text>
        ));
      })()}

      {/* Legend — horizontal gradient bar for the active color axis */}
      <g transform="translate(14, 34)">
        <rect x={-4} y={-13} width={196} height={30} rx={6}
          fill="rgba(10,12,18,0.72)"
          stroke="rgba(183,190,201,0.15)"
          strokeWidth={0.75}
          strokeDasharray="2 3" />
        <text x={4} y={-3}
          fill="rgba(183,190,201,0.65)"
          fontSize={8}
          fontFamily="'DM Mono', ui-monospace, monospace"
          fontWeight={600}
          letterSpacing="0.22em">{axis.label}</text>
        <rect x={4} y={3} width={182} height={5} rx={2.5} fill="url(#evScale)" />
        {/* tick labels — evenly spaced across the axis range */}
        {axis.ticks.map((t, idx, arr) => {
          const x = 4 + ((t - axis.min) / (axis.max - axis.min)) * 182;
          const label = axis.key === 'squaredUp'
            ? `${t}${axis.unit}`
            : `${t}`;
          const anchor: 'start' | 'middle' | 'end' =
            idx === 0 ? 'start' : idx === arr.length - 1 ? 'end' : 'middle';
          return (
            <g key={t}>
              <line x1={x} y1={9} x2={x} y2={12} stroke="rgba(183,190,201,0.5)" strokeWidth={0.6} />
              <text x={x} y={19.5}
                fill="rgba(183,190,201,0.62)"
                fontSize={8}
                fontFamily="'DM Mono', ui-monospace, monospace"
                fontWeight={600}
                letterSpacing="0.12em"
                textAnchor={anchor}>
                {label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* BlastStatBox removed — Blast Motion now uses compact inline row */

/* ═══════════════════════════════════════════
   MAIN TAB
   ═══════════════════════════════════════════ */

const REPORT_TYPES = ['HITTING'];

export function SwingBattedBallTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos, onNewReport,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  const swingMetrics = getTabMetrics(topMetrics, TAB_METRICS.swing);
  const battedMetrics = getTabMetrics(topMetrics, TAB_METRICS.battedBall);
  const hasSwing = Object.keys(swingMetrics).length > 0;
  const hasBatted = Object.keys(battedMetrics).length > 0;

  // Batted ball summary (avg/max from all sessions)
  const [bbSummary, setBbSummary] = useState<Record<string, { avg: number; max: number; min: number; count: number }>>({});
  // Blast Motion summary
  const [blastSummary, setBlastSummary] = useState<Record<string, { avg: number; max: number; min: number; count: number }>>({});
  // Spray chart data points
  const [sprayDots, setSprayDots] = useState<SprayDot[]>([]);
  // Date range of the populated Full Swing session data
  const [dataRange, setDataRange] = useState<{ start: string; end: string } | null>(null);
  // Selected dot + filter thresholds (min-value filters for each metric)
  const [selectedDot, setSelectedDot] = useState<number | null>(null);
  type FilterKey = 'exitVelo' | 'launchAngle' | 'batSpeed' | 'squaredUp';
  interface FilterDef { key: FilterKey; label: string; unit: string; min: number; max: number; step: number; }
  const filterDefs: FilterDef[] = [
    { key: 'exitVelo',    label: 'Exit Velocity', unit: 'mph', min: 0, max: 120, step: 1 },
    { key: 'launchAngle', label: 'Launch Angle',  unit: '°',   min: -30, max: 60, step: 1 },
    { key: 'batSpeed',    label: 'Bat Speed',     unit: 'mph', min: 0, max: 100, step: 1 },
    { key: 'squaredUp',   label: 'Squared Up',    unit: '%',   min: 0, max: 100, step: 1 },
  ];
  const defaultFilters: Record<FilterKey, number> = {
    exitVelo: 0, launchAngle: -30, batSpeed: 0, squaredUp: 0,
  };
  const [filters, setFilters] = useState<Record<FilterKey, number>>(defaultFilters);
  // Which filter drives the color gradient of the spray chart dots
  const [colorBy, setColorBy] = useState<FilterKey>('exitVelo');
  const filtersActive = useMemo(
    () => (Object.keys(defaultFilters) as FilterKey[]).some(k => filters[k] !== defaultFilters[k]),
    [filters]
  );

  const filteredDots = useMemo(() => {
    return sprayDots.filter(d => {
      if (filters.exitVelo    > defaultFilters.exitVelo    && (d.exitVelo    == null || d.exitVelo    < filters.exitVelo))    return false;
      if (filters.launchAngle > defaultFilters.launchAngle && (d.launchAngle == null || d.launchAngle < filters.launchAngle)) return false;
      if (filters.batSpeed    > defaultFilters.batSpeed    && (d.batSpeed    == null || d.batSpeed    < filters.batSpeed))    return false;
      if (filters.squaredUp   > defaultFilters.squaredUp   && (d.squaredUp   == null || d.squaredUp   < filters.squaredUp))   return false;
      return true;
    });
  }, [sprayDots, filters]);

  // Reset selection when filters change
  useEffect(() => { setSelectedDot(null); }, [filters]);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

  useEffect(() => {
    if (!player?.id) return;
    const ids = reportUploadIds.length > 0 ? reportUploadIds : undefined;
    // Fetch aggregated batted ball summary (Full Swing)
    api.getBattedBallSummary(player.id, 'FULL_SWING', ids).then(setBbSummary).catch(() => setBbSummary({}));
    // Fetch aggregated Blast Motion summary
    api.getBattedBallSummary(player.id, 'BLAST_MOTION', ids).then(setBlastSummary).catch(() => setBlastSummary({}));
    // Fetch raw session data for spray chart
    api.getSessionData(player.id, 'FULL_SWING', ['spray_angle', 'distance', 'max_exit_velo', 'launch_angle', 'bat_speed', 'squared_up_pct'], { uploadIds: ids })
      .then(data => {
        // Group data by recordedAt timestamp to pair all metrics per pitch
        const byTime = new Map<string, { angle?: number; distance?: number; exitVelo?: number; launchAngle?: number; batSpeed?: number; squaredUp?: number }>();
        let minTs: string | null = null;
        let maxTs: string | null = null;
        for (const d of data) {
          const key = d.recordedAt;
          if (!byTime.has(key)) byTime.set(key, {});
          const entry = byTime.get(key)!;
          if (d.metricType === 'spray_angle') entry.angle = d.value;
          if (d.metricType === 'distance') entry.distance = d.value;
          if (d.metricType === 'max_exit_velo') entry.exitVelo = d.value;
          if (d.metricType === 'launch_angle') entry.launchAngle = d.value;
          if (d.metricType === 'bat_speed') entry.batSpeed = d.value;
          if (d.metricType === 'squared_up_pct') entry.squaredUp = d.value;
          if (minTs === null || key < minTs) minTs = key;
          if (maxTs === null || key > maxTs) maxTs = key;
        }
        const dots: SprayDot[] = [];
        for (const entry of byTime.values()) {
          if (entry.angle !== undefined && entry.distance !== undefined && entry.distance > 0) {
            dots.push({
              angle: entry.angle, distance: entry.distance,
              exitVelo: entry.exitVelo, launchAngle: entry.launchAngle,
              batSpeed: entry.batSpeed, squaredUp: entry.squaredUp,
            });
          }
        }
        setSprayDots(dots);
        setDataRange(minTs && maxTs ? { start: minTs, end: maxTs } : null);
      })
      .catch(() => { setSprayDots([]); setDataRange(null); });
  }, [player?.id, refreshKey, reportUploadIds]);

  const hasBlast = Object.keys(blastSummary).length > 0;
  const activeDot = selectedDot !== null ? filteredDots[selectedDot] : null;

  /* ── Recompute summary stats from filteredDots when any filter is active ── */
  const displaySummary = useMemo(() => {
    if (!filtersActive) return bbSummary;
    const compute = (values: number[]) => {
      if (values.length === 0) return null;
      const sum = values.reduce((a, b) => a + b, 0);
      return { avg: sum / values.length, max: Math.max(...values), min: Math.min(...values), count: values.length };
    };
    const result: Record<string, { avg: number; max: number; min: number; count: number }> = {};
    const evs = filteredDots.map(d => d.exitVelo).filter((v): v is number => v != null);
    const las = filteredDots.map(d => d.launchAngle).filter((v): v is number => v != null);
    const bss = filteredDots.map(d => d.batSpeed).filter((v): v is number => v != null);
    const dists = filteredDots.map(d => d.distance).filter((v): v is number => v != null);
    const sqs = filteredDots.map(d => d.squaredUp).filter((v): v is number => v != null);
    const sfs = filteredDots.map(d => (d.exitVelo && d.batSpeed && d.batSpeed > 0) ? d.exitVelo / d.batSpeed : null).filter((v): v is number => v != null);
    const r = (k: string, vals: number[]) => { const c = compute(vals); if (c) result[k] = c; };
    r('max_exit_velo', evs); r('launch_angle', las); r('bat_speed', bss);
    r('distance', dists); r('smash_factor', sfs); r('squared_up_pct', sqs);
    return result;
  }, [filtersActive, filteredDots, bbSummary]);

  const hasSummary = Object.keys(displaySummary).length > 0;

  // Scouting grade candidates
  const gradeKeys = ['max_bat_speed', 'avg_bat_speed', 'max_exit_velo', 'avg_exit_velo', 'bat_speed', 'smash_factor', 'distance'];
  const gradeable = gradeKeys.filter(k => topMetrics[k] && GRADE_RANGES[k]);

  /* ── Conditional color logic ── */
  const GREEN = '#4D9B6A';
  const YELLOW = '#B09030';
  const RED = '#B85454';
  const BLUE = '#3B82F6';
  const LIGHT_BLUE = '#7DD3FC';

  /** Pct-of-max helper: returns how much avg is as a % of max */
  const pctOfMax = (avg: number, max: number) => max > 0 ? (avg / max) * 100 : 0;

  const getMetricColor = (key: string, avg: number, max: number): string => {
    switch (key) {
      case 'max_exit_velo': {
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 15) return GREEN;
        if (pctDiff <= 20) return YELLOW;
        return RED;
      }
      case 'launch_angle': {
        if (avg >= 10 && avg <= 25) return GREEN;
        if ((avg >= 1 && avg < 10) || (avg > 25 && avg <= 30)) return YELLOW;
        return RED;
      }
      case 'bat_speed': {
        // Avg within 95% of max = green, 90-94.9% = yellow, <90% = red
        if (max <= 0) return BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      case 'distance': {
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 30) return GREEN;
        if (pctDiff <= 40) return YELLOW;
        return RED;
      }
      case 'smash_factor': {
        if (avg > 1.4) return GREEN;
        if (avg >= 1.0) return YELLOW;
        return RED;
      }
      case 'squared_up_pct': {
        if (avg > 92) return GREEN;
        if (avg >= 80) return YELLOW;
        return RED;
      }
      default:
        return BLUE;
    }
  };

  /** Color logic for Blast Motion metrics */
  const getBlastColor = (key: string, avg: number, max: number): string => {
    switch (key) {
      case 'max_bat_speed': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      case 'peak_hand_speed': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 90) return GREEN;
        if (pct >= 80) return YELLOW;
        return RED;
      }
      case 'attack_angle': {
        if (avg >= 5 && avg <= 15) return GREEN;
        if ((avg >= 0 && avg < 5) || (avg > 15 && avg <= 20)) return YELLOW;
        return RED;
      }
      case 'vertical_bat_angle': {
        if (avg >= 25 && avg <= 40) return GREEN;
        if ((avg >= 15 && avg < 25) || (avg > 40 && avg <= 45)) return YELLOW;
        return RED;
      }
      case 'on_plane_efficiency': {
        if (avg > 85) return GREEN;
        if (avg >= 70) return YELLOW;
        return RED;
      }
      case 'power_output': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 85) return GREEN;
        if (pct >= 70) return YELLOW;
        return RED;
      }
      case 'time_to_contact': {
        if (avg <= 0.16) return GREEN;
        if (avg <= 0.19) return YELLOW;
        return RED;
      }
      default:
        return LIGHT_BLUE;
    }
  };

  /** Color logic for Report Notes scouting cards */
  const getReportCardColor = (key: string, value: number, avg: number, max: number): string => {
    switch (key) {
      case 'plane_score': {
        if (value >= 65 && value <= 80) return GREEN;
        if (value >= 50 && value < 65) return YELLOW;
        return RED;
      }
      case 'squared_up': {
        if (value > 92) return GREEN;
        if (value >= 80) return YELLOW;
        return RED;
      }
      case 'max_ev': {
        // Same as exit velo: avg within 15% of max = green
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 15) return GREEN;
        if (pctDiff <= 20) return YELLOW;
        return RED;
      }
      case 'bat_speed': {
        if (max <= 0) return BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      default:
        return BLUE;
    }
  };

  /* ── Format the data range for display in the stats eyebrow ── */
  const dataRangeLabel = useMemo(() => {
    if (!dataRange) return null;
    const fmt = (iso: string) => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const s = fmt(dataRange.start);
    const e = fmt(dataRange.end);
    if (!s || !e) return null;
    return s === e ? s : `${s} – ${e}`;
  }, [dataRange]);

  /* ── Summary stat definitions ── */
  const summaryStats = [
    { key: 'max_exit_velo', label: 'Exit Velocity', unit: 'mph' },
    { key: 'launch_angle',  label: 'Launch Angle',  unit: '°' },
    { key: 'bat_speed',     label: 'Bat Speed',     unit: 'mph' },
    { key: 'distance',      label: 'Distance',      unit: 'ft' },
    { key: 'smash_factor',  label: 'Smash Factor',  unit: '' },
    { key: 'squared_up_pct',label: 'Square-Up %',   unit: '%' },
  ];

  /* ── Selected-dot bubble definitions ── */
  const dotBubbles = [
    { label: 'Exit Velo',    value: activeDot?.exitVelo,    unit: 'mph', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Launch Angle', value: activeDot?.launchAngle, unit: '°',   color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Bat Speed',    value: activeDot?.batSpeed,    unit: 'mph', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Distance',     value: activeDot?.distance,    unit: 'ft',  color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  ];

  return (
    <>
      {/* ── Report Selector (portaled into TabBar) ── */}
      <TabBarActions>
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Swing / Batted Ball"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
        />
      </TabBarActions>

      {/* ═══ HITTING CONSOLE — Full Swing stats + Spray Chart + Swing Mechanics ═══ */}
      {(() => {
        type BlastExtra = 'max' | 'range' | 'none';
        interface BlastItem {
          metricKey: string; label: string; avg: number; max: number; min: number;
          unit: string; decimals: number; extra: BlastExtra;
        }
        const blastItems: BlastItem[] = [];
        if (hasBlast) {
          if (blastSummary.max_bat_speed) blastItems.push({ metricKey: 'max_bat_speed', label: 'Bat Speed', ...blastSummary.max_bat_speed, unit: 'mph', decimals: 1, extra: 'max' });
          if (blastSummary.peak_hand_speed) blastItems.push({ metricKey: 'peak_hand_speed', label: 'Hand Speed', ...blastSummary.peak_hand_speed, unit: 'mph', decimals: 1, extra: 'max' });
          if (blastSummary.attack_angle) blastItems.push({ metricKey: 'attack_angle', label: 'Attack Angle', ...blastSummary.attack_angle, unit: '°', decimals: 1, extra: 'range' });
          if (blastSummary.vertical_bat_angle) blastItems.push({ metricKey: 'vertical_bat_angle', label: 'Vert Bat Angle', ...blastSummary.vertical_bat_angle, unit: '°', decimals: 1, extra: 'range' });
          if (blastSummary.time_to_contact) blastItems.push({ metricKey: 'time_to_contact', label: 'Time to Contact', ...blastSummary.time_to_contact, unit: 'sec', decimals: 2, extra: 'range' });
          if (blastSummary.on_plane_efficiency) blastItems.push({ metricKey: 'on_plane_efficiency', label: 'On Plane Eff', ...blastSummary.on_plane_efficiency, unit: '%', decimals: 1, extra: 'max' });
          if (blastSummary.power_output) blastItems.push({ metricKey: 'power_output', label: 'Power Output', ...blastSummary.power_output, unit: 'kW', decimals: 2, extra: 'max' });
        }

        return (
          <>
          <section className={s.console}>
            {/* ── Full Swing (left) | Spray Chart (center) | Blast Motion (right) ── */}
            <div className={s.sprayLayout}>
              {/* ── Left column: Full Swing title + metric tiles ── */}
              <div className={s.leftCol}>
                <div className={s.colHead}>
                  <h2 className={s.title}>
                    <span className={s.titleAccentAlt}>Full</span>{' '}
                    <span className={s.titleAccent}>Swing</span>
                  </h2>
                  {dataRangeLabel && (
                    <span className={s.dateBadge}>{dataRangeLabel}</span>
                  )}
                </div>
                <div className={s.statsCol}>
                  <div className={s.statsGrid}>
                    {summaryStats.map(stat => {
                      const data = displaySummary[stat.key];
                      if (!data) {
                        return (
                          <div key={stat.key} className={`${s.stat} ${s.statEmpty}`}>
                            <div className={s.statLabel}>
                              <span className={s.statDot} style={{ background: 'var(--faint)' }} />
                              {stat.label}
                            </div>
                            <div className={s.statValue} style={{ color: 'var(--faint)' }}>—</div>
                            <div className={s.statMeta}>&nbsp;</div>
                          </div>
                        );
                      }
                      const statColor = getMetricColor(stat.key, data.avg, data.max);
                      const decimals = stat.key === 'smash_factor' ? 2 : 1;
                      return (
                        <div key={stat.key} className={s.stat}>
                          <div className={s.statLabel}>
                            <span className={s.statDot} style={{ background: statColor, boxShadow: `0 0 6px ${statColor}` }} />
                            {stat.label}
                          </div>
                          <div className={s.statValue} style={{ color: statColor }}>
                            {data.avg.toFixed(decimals)}
                            <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 4, letterSpacing: '0.06em' }}>
                              {stat.unit}
                            </span>
                          </div>
                          <div className={s.statMeta}>
                            MAX <b>{data.max.toFixed(decimals)}</b>{stat.unit ? ` ${stat.unit}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className={s.chartFrame}>
                <div className={s.chartInner}>
                  {filteredDots.length > 0 ? (
                    <SprayChart
                      dots={filteredDots}
                      selected={selectedDot}
                      onSelect={setSelectedDot}
                      axis={COLOR_AXES[colorBy]}
                    />
                  ) : sprayDots.length > 0 ? (
                    <div className={s.empty}>
                      <div className={s.emptyIcon}>🎯</div>
                      <div>No batted balls match the current filters</div>
                      <div className={s.emptyHint}>Adjust or reset the filters at the top</div>
                    </div>
                  ) : (
                    <div className={s.empty}>
                      <div className={s.emptyIcon}>🏟️</div>
                      <div>Spray chart will populate with Full Swing batted ball data</div>
                      <div className={s.emptyHint}>Upload a Full Swing CSV with Direction + Distance</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right column: Blast Motion title + metric tiles ── */}
              {blastItems.length > 0 && (
                <div className={s.rightCol}>
                  <div className={s.colHead}>
                    <h2 className={s.title}>
                      <span className={s.titleAccent}>Blast</span>{' '}
                      <span className={s.titleAccentAlt}>Motion</span>
                    </h2>
                    {dataRangeLabel && (
                      <span className={s.dateBadge}>{dataRangeLabel}</span>
                    )}
                  </div>

                  <div className={s.blastGrid}>
                    {blastItems.map(item => {
                      const itemColor = getBlastColor(item.metricKey, item.avg, item.max);
                      return (
                        <div key={item.metricKey} className={s.blastTile}>
                          <div className={s.blastLabel}>{item.label} Avg</div>
                          <div className={s.blastValue} style={{ color: itemColor }}>
                            {item.avg.toFixed(item.decimals)}
                            <span className={s.blastValueUnit}>{item.unit}</span>
                          </div>
                          {item.extra === 'max' && (
                            <div className={s.blastMeta}>
                              MAX <b>{item.max.toFixed(item.decimals)}</b>{item.unit ? ` ${item.unit}` : ''}
                            </div>
                          )}
                          {item.extra === 'range' && (
                            <div className={s.blastMeta}>
                              RANGE <b>{item.min.toFixed(item.decimals)}–{item.max.toFixed(item.decimals)}</b>{item.unit ? ` ${item.unit}` : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Ball Readout — horizontal strip below the chart ── */}
            {sprayDots.length > 0 && (
              <div className={s.readoutBar}>
                <div className={s.readoutBarHead}>
                  <span className={s.sideHeadDot} />
                  {activeDot ? 'Selected Ball' : 'Ball Readout'}
                </div>
                <div className={s.readoutBarPods}>
                  {[
                    { label: 'Exit Velo',    value: activeDot?.exitVelo,    unit: 'mph', decimals: 1 },
                    { label: 'Launch Angle', value: activeDot?.launchAngle, unit: '°',   decimals: 1 },
                    { label: 'Bat Speed',    value: activeDot?.batSpeed,    unit: 'mph', decimals: 1 },
                    { label: 'Distance',     value: activeDot?.distance,    unit: 'ft',  decimals: 0 },
                    { label: 'Squared Up',   value: activeDot?.squaredUp,   unit: '%',   decimals: 1 },
                  ].map(p => (
                    <div key={p.label} className={s.sidePod}>
                      <span className={s.sidePodLabel}>{p.label}</span>
                      <span className={s.sidePodValueRow}>
                        <span className={s.sidePodValue}>
                          {p.value != null ? p.value.toFixed(p.decimals) : '—'}
                        </span>
                        {p.value != null && p.unit && (
                          <span className={s.sidePodUnit}>{p.unit}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Filter bar — standalone card beneath the Spray Chart console ── */}
          {sprayDots.length > 0 && (
            <div className={s.filterBar}>
              <div className={s.filterBarHead}>
                <span className={s.filterHeadDot} />
                Filters
                <button
                  type="button"
                  className={s.filterReset}
                  onClick={() => setFilters(defaultFilters)}
                  disabled={!filtersActive}
                >
                  Reset
                </button>
              </div>
              <div className={s.filterBarRows}>
                {filterDefs.map(def => {
                  const val = filters[def.key];
                  const isActive = val !== defaultFilters[def.key];
                  const isColorAxis = colorBy === def.key;
                  return (
                    <div
                      key={def.key}
                      className={`${s.filterRow} ${isActive ? s.active : ''} ${isColorAxis ? s.colorAxis : ''}`}
                    >
                      <div className={s.filterRowHead}>
                        <button
                          type="button"
                          className={s.filterLabelBtn}
                          onClick={() => setColorBy(def.key)}
                          title="Color the spray chart by this metric"
                        >
                          <span
                            className={s.colorAxisDot}
                            aria-hidden="true"
                            data-active={isColorAxis ? 'true' : 'false'}
                          />
                          <span className={s.filterLabel}>{def.label}</span>
                        </button>
                        {isActive ? (
                          <span className={s.filterValue}>
                            ≥ {val}
                            <span className={s.filterValueUnit}>{def.unit}</span>
                          </span>
                        ) : (
                          <span className={s.filterValueOff}>All</span>
                        )}
                      </div>
                      <input
                        type="range"
                        className={s.filterSlider}
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        value={val}
                        onChange={e => setFilters(f => ({ ...f, [def.key]: Number(e.target.value) }))}
                      />
                    </div>
                  );
                })}
              </div>
              <div className={s.filterBarFooter}>
                <span className={s.filterFooterLabel}>Showing</span>
                <span className={s.filterFooterCount}>
                  {filteredDots.length}
                  <span style={{ opacity: 0.45, margin: '0 4px' }}>/</span>
                  {sprayDots.length}
                </span>
              </div>
            </div>
          )}
          </>
        );
      })()}

      {/* ── Report Notes (Scouting Grades + Coaching Notes combined) ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Coaching notes will appear here after assessment review.', placeholder: true },
              { text: 'Bat speed trends, mechanical observations, and drill recommendations.', placeholder: true },
            ];

        // Scouting grade mini-cards: Plane Score, Squared Up %, Max EV, Bat Speed
        const planeAvg = blastSummary.plane_angle?.avg ?? null;
        const planeMax = blastSummary.plane_angle?.max ?? null;
        const sqUpAvg = bbSummary.squared_up_pct?.avg ?? blastSummary.squared_up_pct?.avg ?? null;
        const evMax = bbSummary.max_exit_velo?.max ?? null;
        const evAvg = bbSummary.max_exit_velo?.avg ?? null;
        const bsMax = blastSummary.max_bat_speed?.max ?? bbSummary.bat_speed?.max ?? null;
        const bsAvg = blastSummary.max_bat_speed?.avg ?? bbSummary.bat_speed?.avg ?? null;

        interface ReportCard {
          key: string; label: string; value: number | null; subLabel: string; subValue: number | null; unit: string;
        }
        const scoutingCards: ReportCard[] = [
          {
            key: 'plane_score', label: 'Plane Score',
            value: planeAvg, subLabel: 'Best', subValue: planeMax, unit: '',
          },
          {
            key: 'squared_up', label: 'Squared Up %',
            value: sqUpAvg, subLabel: '', subValue: null, unit: '%',
          },
          {
            key: 'max_ev', label: 'Max EV',
            value: evMax, subLabel: 'Avg', subValue: evAvg, unit: 'mph',
          },
          {
            key: 'bat_speed', label: 'Bat Speed',
            value: bsMax, subLabel: 'Avg', subValue: bsAvg, unit: 'mph',
          },
        ];
        const hasAnyGrade = scoutingCards.some(c => c.value !== null);

        return (
          <Section>
            <SectionHeader icon="📋" iconColor="green" title="Report Notes" />

            {/* Scouting Grade mini-window */}
            {hasAnyGrade && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 10,
                marginBottom: 14,
              }}>
                {scoutingCards.map(card => {
                  const cardColor = card.value !== null
                    ? getReportCardColor(card.key, card.value, card.subValue ?? 0, card.value)
                    : 'var(--faint)';
                  return (
                  <div key={card.label} style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                  }}>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                    }}>
                      {card.label}
                    </span>
                    <span style={{
                      fontSize: 22,
                      fontWeight: 700,
                      fontFamily: "'DM Mono', monospace",
                      color: cardColor,
                    }}>
                      {card.value !== null ? card.value.toFixed(1) : '—'}
                    </span>
                    {card.value !== null && card.unit && (
                      <span style={{ fontSize: 9, color: 'var(--faint)' }}>{card.unit}</span>
                    )}
                    {card.subValue !== null && card.subLabel && (
                      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                        {card.subLabel}: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{card.subValue.toFixed(1)}</span>{card.unit ? ` ${card.unit}` : ''}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            <NotesBox label="SWING ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'HITTING'
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
                    key={v.id}
                    tag={v.category}
                    title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()}
                    size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`}
                    tag="HITTING"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`}
                    size="md"
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

      <CustomCharts section="HITTING" playerId={player.id} />

    </>
  );
}
