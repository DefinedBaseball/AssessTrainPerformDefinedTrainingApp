'use client';

import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import aStyles from '@/components/assessment/assessment.module.css';

/* ─────────────────────────────────────────────────────────────────────────────
   SPRAY CHART VIEW — self-contained
   - Loads Full Swing session data and pairs spray angle / distance / EV / LA / etc.
   - Filter bar (4 min-thresholds) + color-axis selector
   - SVG HUD-style spray chart with dot selection + readout
   ─────────────────────────────────────────────────────────────────────────── */

interface SprayDot {
  angle: number;
  distance: number;
  exitVelo?: number;
  launchAngle?: number;
  batSpeed?: number;
  squaredUp?: number;
}

type FilterKey = 'exitVelo' | 'launchAngle' | 'batSpeed';
interface FilterDef { key: FilterKey; label: string; unit: string; min: number; max: number; step: number; }
interface ColorAxisDef {
  key: FilterKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  ticks: number[];
}

const FILTER_DEFS: FilterDef[] = [
  { key: 'exitVelo',    label: 'Exit Velocity', unit: 'mph', min: 0,   max: 120, step: 1 },
  { key: 'launchAngle', label: 'Launch Angle',  unit: '°',   min: -30, max: 60,  step: 1 },
  { key: 'batSpeed',    label: 'Bat Speed',     unit: 'mph', min: 0,   max: 100, step: 1 },
];

const DEFAULT_FILTERS: Record<FilterKey, number> = {
  exitVelo: 0, launchAngle: -30, batSpeed: 0,
};

const COLOR_AXES: Record<FilterKey, ColorAxisDef> = {
  exitVelo:    { key: 'exitVelo',    label: 'EXIT VELO',    unit: 'mph', min: 75,  max: 105, ticks: [75, 85, 95, 105] },
  launchAngle: { key: 'launchAngle', label: 'LAUNCH ANGLE', unit: '°',   min: -10, max: 30,  ticks: [-10, 0, 15, 30] },
  batSpeed:    { key: 'batSpeed',    label: 'BAT SPEED',    unit: 'mph', min: 55,  max: 80,  ticks: [55, 65, 72, 80] },
};

/* navy → light-blue → white ramp */
function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  let r: number, g: number, b: number;
  if (x < 0.5) {
    const u = x * 2;
    r = lerp(30, 96, u); g = lerp(58, 165, u); b = lerp(138, 250, u);
  } else {
    const u = (x - 0.5) * 2;
    r = lerp(96, 255, u); g = lerp(165, 255, u); b = lerp(250, 255, u);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
function rampGlow(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const hue = x < 0.5 ? 222 : 210;
  const sat = x < 0.5 ? 70 - (1 - x * 2) * 25 : 60 - (x - 0.5) * 2 * 55;
  const light = x < 0.5 ? 40 + x * 2 * 25 : 65 + (x - 0.5) * 2 * 25;
  const alpha = 0.30 + Math.abs(x - 0.5) * 0.30;
  return `hsla(${hue}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha.toFixed(2)})`;
}
function rampOpacity(t: number) { return 0.98 - Math.max(0, Math.min(1, t)) * 0.18; }
function rampStrokeWidth(t: number) { return 0.5 + Math.max(0, Math.min(1, t)) * 1.1; }
function rampStroke(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return `rgba(6,8,14,${(0.35 + x * 0.45).toFixed(2)})`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SprayChart — pure SVG, ported from SwingBattedBallTab
   ─────────────────────────────────────────────────────────────────────────── */
function SprayChart({ dots, selected, onSelect, axis }: {
  dots: SprayDot[];
  selected: number | null;
  onSelect: (idx: number | null) => void;
  axis: ColorAxisDef;
}) {
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
  const axisT = (v?: number): number => v == null ? 0 : (v - axis.min) / (axis.max - axis.min);
  const dotColor = (v?: number) => v == null ? 'hsl(0, 0%, 55%)' : rampColor(axisT(v));
  const dotGlow  = (v?: number) => v == null ? 'hsla(0, 0%, 55%, 0.45)' : rampGlow(axisT(v));
  const valueOf = (d: SprayDot): number | undefined => d[axis.key];
  const angularTicks = [-45, -30, -15, 0, 15, 30, 45];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'default' }}>
      <defs>
        <pattern id="spray-scan" x="0" y="0" width="1" height="5" patternUnits="userSpaceOnUse">
          <rect width="1" height="5" fill="transparent" />
          <rect y="0" width="1" height="1" fill="rgba(255,255,255,0.018)" />
        </pattern>
        <radialGradient id="spray-beacon" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(126,182,255,0.50)" />
          <stop offset="40%"  stopColor="rgba(61,139,253,0.20)" />
          <stop offset="100%" stopColor="rgba(61,139,253,0)" />
        </radialGradient>
        <linearGradient id="spray-evScale" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#1E3A8A" />
          <stop offset="50%"  stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>

      <rect width={W} height={H} fill="transparent" onClick={() => onSelect(null)} />
      <rect width={W} height={H} fill="url(#spray-scan)" pointerEvents="none" />
      <circle cx={cx} cy={cy} r={130} fill="url(#spray-beacon)" pointerEvents="none" />

      {/* Distance arcs */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = cx - r * Math.cos(Math.PI / 4);
        const ly = cy - r * Math.sin(Math.PI / 4);
        const rx = cx + r * Math.cos(Math.PI / 4);
        const ry = cy - r * Math.sin(Math.PI / 4);
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

      {/* Angular ticks */}
      {angularTicks.map(deg => {
        const rad = ((90 - deg) * Math.PI) / 180;
        const rInner = (maxDist - 30) * scale;
        const rOuter = (maxDist - 12) * scale;
        const rLabel = (maxDist - 2) * scale;
        const x1 = cx + rInner * Math.cos(rad), y1 = cy - rInner * Math.sin(rad);
        const x2 = cx + rOuter * Math.cos(rad), y2 = cy - rOuter * Math.sin(rad);
        const lx = cx + rLabel * Math.cos(rad), ly = cy - rLabel * Math.sin(rad);
        const isCenter = deg === 0;
        return (
          <g key={`tick${deg}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isCenter ? 'rgba(126,182,255,0.55)' : 'rgba(183,190,201,0.38)'}
              strokeWidth={isCenter ? 1.2 : 0.9} />
            <text x={lx} y={ly}
              fill={isCenter ? 'rgba(126,182,255,0.9)' : 'rgba(183,190,201,0.58)'}
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
              letterSpacing="0.08em" textAnchor="middle" dominantBaseline="central">
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </text>
          </g>
        );
      })}

      {/* Foul rails */}
      {(() => {
        const r = maxDist * scale;
        return (
          <>
            <line x1={cx} y1={cy}
              x2={cx - r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
            <line x1={cx} y1={cy}
              x2={cx + r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
          </>
        );
      })()}

      {/* Bases */}
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
            transform={`rotate(45 ${bx} ${by})`} />
        ));
      })()}

      {/* Home plate */}
      <polygon
        points={`${cx},${cy - 5.5} ${cx + 5.5},${cy - 2} ${cx + 4.5},${cy + 3.5} ${cx - 4.5},${cy + 3.5} ${cx - 5.5},${cy - 2}`}
        fill="rgba(223,227,232,0.92)" stroke="rgba(255,255,255,0.5)" strokeWidth={0.75} />

      {/* Selection vector */}
      {selected !== null && dots[selected] && (() => {
        const dot = dots[selected];
        const [sx, sy] = toXY(dot.angle, dot.distance);
        return (
          <line x1={cx} y1={cy} x2={sx} y2={sy}
            stroke="rgba(255,255,255,0.35)" strokeWidth={0.8}
            strokeDasharray="2 3" pointerEvents="none" />
        );
      })()}

      {/* Dots */}
      {dots.map((dot, i) => {
        const [x, y] = toXY(dot.angle, dot.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const isSelected = selected === i;
        const v = valueOf(dot);
        const t = v == null ? 0 : Math.max(0, Math.min(1, axisT(v)));
        const color = dotColor(v);
        const glow  = dotGlow(v);
        const pointOpacity = v == null ? 0.85 : rampOpacity(t);
        const pointStrokeW = v == null ? 0.75 : rampStrokeWidth(t);
        const pointStroke  = v == null ? 'rgba(6,8,14,0.55)' : rampStroke(t);
        const glowOpacity = isSelected ? 0.95 : 0.40 + t * 0.25;
        return (
          <g key={i} style={{ cursor: 'pointer' }}
             onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : i); }}>
            <circle cx={x} cy={y} r={isSelected ? 15 : 9} fill={glow} opacity={glowOpacity} />
            <circle cx={x} cy={y} r={isSelected ? 6.5 : 4} fill={color}
              fillOpacity={pointOpacity}
              stroke={isSelected ? '#ffffff' : pointStroke}
              strokeWidth={isSelected ? 2 : pointStrokeW}
              style={{ transition: 'all 0.15s ease' }} />
            {isSelected && (
              <circle cx={x - 1.4} cy={y - 1.4} r={1.3} fill="rgba(255,255,255,0.92)" />
            )}
          </g>
        );
      })}

      {/* Top zone labels */}
      {[
        { x: W * 0.22, label: 'LEFT' },
        { x: W * 0.50, label: 'CENTER' },
        { x: W * 0.78, label: 'RIGHT' },
      ].map(z => (
        <text key={z.label} x={z.x} y={18} fill="rgba(183,190,201,0.55)"
          fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
          fontWeight={600} letterSpacing="0.28em" textAnchor="middle">{z.label}</text>
      ))}

      {/* Color-axis legend */}
      <g transform="translate(14, 34)">
        <rect x={-4} y={-13} width={196} height={30} rx={6}
          fill="rgba(10,12,18,0.72)" stroke="rgba(183,190,201,0.15)"
          strokeWidth={0.75} strokeDasharray="2 3" />
        <text x={4} y={-3} fill="rgba(183,190,201,0.65)" fontSize={8}
          fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
          letterSpacing="0.22em">{axis.label}</text>
        <rect x={4} y={3} width={182} height={5} rx={2.5} fill="url(#spray-evScale)" />
        {axis.ticks.map((t, idx, arr) => {
          const x = 4 + ((t - axis.min) / (axis.max - axis.min)) * 182;
          const label = `${t}`;
          const anchor: 'start' | 'middle' | 'end' =
            idx === 0 ? 'start' : idx === arr.length - 1 ? 'end' : 'middle';
          return (
            <g key={t}>
              <line x1={x} y1={9} x2={x} y2={12} stroke="rgba(183,190,201,0.5)" strokeWidth={0.6} />
              <text x={x} y={19.5} fill="rgba(183,190,201,0.62)" fontSize={8}
                fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
                letterSpacing="0.12em" textAnchor={anchor}>{label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SprayChartView — full self-contained widget
   ─────────────────────────────────────────────────────────────────────────── */
export function SprayChartView({
  playerId, refreshKey, reportUploadIds, maxWidth, compact = false,
}: {
  playerId: string;
  refreshKey?: number;
  reportUploadIds?: string[];
  /** Cap the chart's rendered width (px). Defaults to filling the container. */
  maxWidth?: number;
  /** Tighter padding + condensed filter card — for top-of-page placement. */
  compact?: boolean;
}) {
  const [sprayDots, setSprayDots] = useState<SprayDot[]>([]);
  const [dataRange, setDataRange] = useState<{ start: string; end: string } | null>(null);
  const [selectedDot, setSelectedDot] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, number>>(DEFAULT_FILTERS);
  const [colorBy, setColorBy] = useState<FilterKey>('exitVelo');
  const [loading, setLoading] = useState(true);

  const filtersActive = useMemo(
    () => (Object.keys(DEFAULT_FILTERS) as FilterKey[]).some(k => filters[k] !== DEFAULT_FILTERS[k]),
    [filters]
  );

  const filteredDots = useMemo(() => sprayDots.filter(d => {
    if (filters.exitVelo    > DEFAULT_FILTERS.exitVelo    && (d.exitVelo    == null || d.exitVelo    < filters.exitVelo))    return false;
    if (filters.launchAngle > DEFAULT_FILTERS.launchAngle && (d.launchAngle == null || d.launchAngle < filters.launchAngle)) return false;
    if (filters.batSpeed    > DEFAULT_FILTERS.batSpeed    && (d.batSpeed    == null || d.batSpeed    < filters.batSpeed))    return false;
    return true;
  }), [sprayDots, filters]);

  // Reset selection when filters change
  useEffect(() => { setSelectedDot(null); }, [filters]);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    const ids = reportUploadIds && reportUploadIds.length > 0 ? reportUploadIds : undefined;
    api.getSessionData(playerId, 'FULL_SWING', ['spray_angle', 'distance', 'max_exit_velo', 'launch_angle', 'bat_speed', 'squared_up_pct'], { uploadIds: ids })
      .then((data: any[]) => {
        const byTime = new Map<string, { angle?: number; distance?: number; exitVelo?: number; launchAngle?: number; batSpeed?: number; squaredUp?: number }>();
        let minTs: string | null = null;
        let maxTs: string | null = null;
        for (const d of data) {
          const key = d.recordedAt;
          if (!byTime.has(key)) byTime.set(key, {});
          const entry = byTime.get(key)!;
          if (d.metricType === 'spray_angle')      entry.angle = d.value;
          if (d.metricType === 'distance')         entry.distance = d.value;
          if (d.metricType === 'max_exit_velo')    entry.exitVelo = d.value;
          if (d.metricType === 'launch_angle')     entry.launchAngle = d.value;
          if (d.metricType === 'bat_speed')        entry.batSpeed = d.value;
          if (d.metricType === 'squared_up_pct')   entry.squaredUp = d.value;
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
        setLoading(false);
      })
      .catch(() => { setSprayDots([]); setDataRange(null); setLoading(false); });
  }, [playerId, refreshKey, JSON.stringify(reportUploadIds || [])]);

  const activeDot = selectedDot !== null ? filteredDots[selectedDot] : null;
  const dataRangeLabel = dataRange
    ? `${new Date(dataRange.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(dataRange.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : null;

  return (
    <div
      className={aStyles.innerPanel}
      // Outer spray-chart bubble re-toned to match the Movement Plot —
      // shared interior chrome (slight blue/dark hue, faint center
      // highlight, soft inset darken) used across the profile.
      style={{
        padding: compact ? '10px 12px 12px' : '14px 14px 16px',
        display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14,
        maxWidth: maxWidth ?? '100%',
        margin: maxWidth ? '0 auto' : undefined,
      }}
    >
      {/* Header strip — date range + count */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: 'rgba(126,182,255,0.85)',
        }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: 4,
            background: '#7eb6ff', boxShadow: '0 0 8px rgba(126,182,255,0.7)',
          }} />
          Spray Chart
        </div>
        {dataRangeLabel && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.10em',
            padding: '3px 9px', borderRadius: 6,
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
          }}>
            {dataRangeLabel}
          </span>
        )}
      </div>

      {/* Chart frame — transparent container so the SVG sits directly
          on the outer "Spray Chart" bubble's gray surface. The previous
          .innerPanel wrapper was producing a doubled, lighter bubble
          layer over the chart that the user doesn't want. */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          aspectRatio: '520 / 460',
        }}
      >
        {loading ? (
          <SprayEmpty icon="⏳" title="Loading spray data…" hint="" />
        ) : filteredDots.length > 0 ? (
          <SprayChart
            dots={filteredDots}
            selected={selectedDot}
            onSelect={setSelectedDot}
            axis={COLOR_AXES[colorBy]}
          />
        ) : sprayDots.length > 0 ? (
          <SprayEmpty icon="🎯" title="No batted balls match the current filters" hint="Adjust or reset filters below" />
        ) : (
          <SprayEmpty icon="🏟️" title="Spray chart will populate with Full Swing batted-ball data"
            hint="Upload a Full Swing CSV with Direction + Distance" />
        )}
      </div>

      {/* Ball Readout strip — full-width metrics, no header column */}
      {sprayDots.length > 0 && (
        <div
          className={aStyles.innerPanel}
          style={{
            padding: '8px 10px',
            // Override the .innerPanel border color so the active-dot
            // accent still reads (cool-blue rim when a dot is selected).
            borderColor: activeDot ? 'rgba(126,182,255,0.45)' : undefined,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 8,
            transition: 'border-color 0.15s ease',
          }}
        >
          {[
            { label: 'EV',   value: activeDot?.exitVelo,    unit: 'mph', decimals: 1 },
            { label: 'LA',   value: activeDot?.launchAngle, unit: '°',   decimals: 1 },
            { label: 'BS',   value: activeDot?.batSpeed,    unit: 'mph', decimals: 1 },
            { label: 'DIST', value: activeDot?.distance,    unit: 'ft',  decimals: 0 },
            { label: 'SQ%',  value: activeDot?.squaredUp,   unit: '%',   decimals: 1 },
          ].map(p => (
            <div key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
                fontFamily: "'DM Mono', ui-monospace, monospace",
              }}>{p.label}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0 }}>
                <span style={{
                  fontSize: 15, fontWeight: 700, color: 'var(--text)',
                  fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {p.value != null ? p.value.toFixed(p.decimals) : '—'}
                </span>
                {p.value != null && p.unit && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{p.unit}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      {sprayDots.length > 0 && (
        <div
          className={aStyles.innerPanel}
          style={{
            padding: '10px 14px 12px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                background: filtersActive ? '#7eb6ff' : 'rgba(255,255,255,0.40)',
              }} />
              Filters
            </span>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              disabled={!filtersActive}
              style={{
                background: 'none', border: 'none',
                color: filtersActive ? 'var(--accent-light)' : 'var(--text-muted)',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
                cursor: filtersActive ? 'pointer' : 'not-allowed',
                opacity: filtersActive ? 1 : 0.4,
                textTransform: 'uppercase',
              }}
            >Reset</button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 6,
          }}>
            {FILTER_DEFS.map(def => {
              const val = filters[def.key];
              const isActive = val !== DEFAULT_FILTERS[def.key];
              const isColorAxis = colorBy === def.key;
              const shortLabel = def.key === 'exitVelo' ? 'EV'
                : def.key === 'launchAngle' ? 'LA'
                : 'BS';
              return (
                <div
                  key={def.key}
                  style={{
                    padding: '5px 8px',
                    background: isActive ? 'rgba(126,182,255,0.06)' : 'rgba(255,255,255,0.018)',
                    border: '1px solid',
                    borderColor: isColorAxis ? 'rgba(126,182,255,0.55)' : isActive ? 'rgba(126,182,255,0.30)' : 'var(--border)',
                    borderRadius: 7,
                    display: 'flex', flexDirection: 'column', gap: 3,
                    transition: 'all 0.15s ease',
                    minWidth: 0,
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}>
                    <button
                      type="button"
                      onClick={() => setColorBy(def.key)}
                      title={`Color spray by ${def.label}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: 'none', border: 'none', padding: 0,
                        cursor: 'pointer', color: 'var(--text)', minWidth: 0,
                      }}
                    >
                      <span style={{
                        display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                        background: isColorAxis ? '#7eb6ff' : 'rgba(255,255,255,0.20)',
                        boxShadow: isColorAxis ? '0 0 5px rgba(126,182,255,0.6)' : undefined,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.10em',
                        textTransform: 'uppercase',
                        color: isColorAxis ? 'var(--accent-light)' : 'var(--text-muted)',
                        fontFamily: "'DM Mono', ui-monospace, monospace",
                      }}>{shortLabel}</span>
                    </button>
                    {isActive ? (
                      <span style={{
                        fontSize: 10, fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                        color: 'var(--text)', whiteSpace: 'nowrap',
                      }}>
                        ≥ {val}<span style={{ fontSize: 8.5, color: 'var(--text-muted)', marginLeft: 2 }}>{def.unit}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.10em' }}>All</span>
                    )}
                  </div>
                  <input
                    type="range"
                    min={def.min} max={def.max} step={def.step} value={val}
                    onChange={e => setFilters(f => ({ ...f, [def.key]: Number(e.target.value) }))}
                    style={{ width: '100%', height: 4 }}
                  />
                </div>
              );
            })}
          </div>

          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 8,
            fontSize: 10.5, color: 'var(--text-muted)',
            paddingTop: 4, borderTop: '1px solid var(--border)', marginTop: 2,
          }}>
            <span style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>Showing</span>
            <span style={{
              fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--text)',
              fontSize: 13,
            }}>
              {filteredDots.length}
              <span style={{ opacity: 0.45, margin: '0 4px' }}>/</span>
              {sprayDots.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SprayEmpty({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 6, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24,
    }}>
      <div style={{ fontSize: 36, opacity: 0.7 }}>{icon}</div>
      <div>{title}</div>
      {hint && <div style={{ fontSize: 11, opacity: 0.7 }}>{hint}</div>}
    </div>
  );
}
