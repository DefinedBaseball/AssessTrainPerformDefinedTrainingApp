'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import aStyles from '@/components/assessment/assessment.module.css';
import { spraySliceAggregate, type SprayAggregate } from '@/lib/pitchAggregation';

/* Single source of truth for the surface color of the two horizontal
 * bars (Ball Readout + Filter Bar) under the spray chart. Pinned as
 * inline-style constants instead of via the .innerPanel class so the
 * two bars are guaranteed to render identically regardless of how
 * CSS-variable cascades resolve in different theme contexts. */
const SPRAY_BAR_BG = 'rgba(20, 24, 32, 0.92)';
const SPRAY_BAR_BORDER = '1px solid rgba(255, 255, 255, 0.10)';

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
  /** HitTrax dots carry a categorical ball type — used to color the dot
   *  instead of the EV/LA/BS ramp. 1=GB (red), 2=LD (blue), 3=FB (green). */
  ballTypeCode?: number;
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
function SprayChart({ dots, selected, onSelect, axis, sliceAgg = null }: {
  dots: SprayDot[];
  selected: number | null;
  onSelect: (idx: number | null) => void;
  axis: ColorAxisDef;
  /** Big One average mode: five 18° field slices (LF/LC/CF/RC/RF) shaded +
   *  labeled with the PERCENTAGE of batted balls landing in each — replaces
   *  the individual dots. */
  sliceAgg?: SprayAggregate | null;
}) {
  const W = 520, H = 460;
  const cx = W / 2, cy = H - 24;
  // Outfield fence distance (was 420). Dropped to 400 so the
  // spray chart fence radius matches the requested park dimensions.
  const maxDist = 400;
  const scale = (H - 70) / maxDist;
  const toXY = (angleDeg: number, dist: number): [number, number] => {
    const rad = ((90 - angleDeg) * Math.PI) / 180;
    const r = dist * scale;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  // Per coach-spec the spray chart now carries seven distance
  // arcs: 90 / 140 / 200 / 250 / 300 / 350 / 400. The 400-ft
  // arc still renders alongside the outfield fence so the
  // fence wears the same "400FT" label chip the interior arcs
  // do.
  const distArcs = [90, 140, 200, 250, 300, 350, 400];
  const axisT = (v?: number): number => v == null ? 0 : (v - axis.min) / (axis.max - axis.min);
  /* Categorical color overrides for HitTrax dots:
       1 = GB → red
       2 = LD → blue
       3 = FB → green
     Glow uses a translucent matching tone so the halo stays cohesive. */
  const ballTypeColor = (code: number): { fill: string; glow: string } => {
    switch (code) {
      case 1: return { fill: '#ef4444', glow: 'rgba(239,68,68,0.45)' };
      case 2: return { fill: '#3b82f6', glow: 'rgba(59,130,246,0.45)' };
      case 3: return { fill: '#22c55e', glow: 'rgba(34,197,94,0.45)' };
      default: return { fill: 'hsl(0, 0%, 55%)', glow: 'hsla(0, 0%, 55%, 0.45)' };
    }
  };
  const dotColor = (d: SprayDot) => {
    if (d.ballTypeCode != null) return ballTypeColor(d.ballTypeCode).fill;
    const v = d[axis.key];
    return v == null ? 'hsl(0, 0%, 55%)' : rampColor(axisT(v));
  };
  const dotGlow = (d: SprayDot) => {
    if (d.ballTypeCode != null) return ballTypeColor(d.ballTypeCode).glow;
    const v = d[axis.key];
    return v == null ? 'hsla(0, 0%, 55%, 0.45)' : rampGlow(axisT(v));
  };
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
      {/* In-SVG scan-line overlay retired — the outer SprayChartView
          panel now carries a CSS scan-line texture that shows through
          the chart's transparent backdrop, giving the entire bubble one
          continuous pattern instead of stacking two. */}
      {/* Home-plate beacon retired from inside the SVG. The radial
          blue glow used to be a `<circle fill="url(#spray-beacon)">`
          here, but the SVG's drawing area ends at the chart's
          bottom edge — just above the Filter row — so the glow
          clipped abruptly where the filters began. The beacon now
          lives as a CSS `radial-gradient` on the spray-chart
          BUBBLE'S backgroundImage (see SprayChartView's outer
          bubble style below), which sits beneath every child of
          the bubble (chart + filters), letting the same glow
          continue smoothly behind the filter row all the way to
          the bubble's bottom edge. */}

      {/* Distance arcs */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = cx - r * Math.cos(Math.PI / 4);
        const ly = cy - r * Math.sin(Math.PI / 4);
        const rx = cx + r * Math.cos(Math.PI / 4);
        const ry = cy - r * Math.sin(Math.PI / 4);
        return (
          <g key={d}>
            {/* Distance arc — theme-aware grey gridline via
               `--spray-gridline-color` (the lighter sibling of
               `--spray-label-color`, alpha multiplied by 0.70)
               so the field geometry sits behind the labels
               visually instead of competing with them. */}
            <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`}
              fill="none" stroke="var(--spray-gridline-color)" strokeWidth={1} strokeDasharray="3 5" />
            {/* Distance label pill — light fill + grey border so the
               black label text reads at full contrast in both themes.
               Previous dark-navy pill (rgba(10,12,18,0.75)) was
               retired so the spray chart no longer carries dark
               chips against the off-white bubble chrome in light mode. */}
            <g transform={`translate(${rx + 6}, ${ry + 4})`}>
              <rect x={-2} y={-9} width={42} height={16} rx={8}
                fill="rgba(255,255,255,0.92)" stroke="var(--spray-gridline-color)" strokeWidth={0.6} />
              <text x={19} y={2.5} fill="#000000" fontSize={9}
                fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
                letterSpacing="0.14em" textAnchor="middle"
                className={aStyles.sprayLightText}
              >{d}FT</text>
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
            {/* Angular tick — theme-aware grey gridline via
               `--spray-gridline-color` (30 % lighter than the
               labels). Center stroke remains heavier than the
               off-center ticks (via stroke width, not color) so
               the 0° marker still anchors the eye while every
               tick line sits behind the label layer. */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="var(--spray-gridline-color)"
              strokeWidth={isCenter ? 1.4 : 1.0} />
            {/* Angular degree label — theme-aware via
               `--spray-label-color`: muted blue-grey in dark mode
               (matches the Exit Velo color-axis label tone), clean
               medium grey in light mode (still readable on the
               off-white spray-chart bubble without going solid
               black). */}
            <text x={lx} y={ly}
              style={{ fill: 'var(--spray-label-color)' }}
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace" fontWeight={600}
              letterSpacing="0.08em" textAnchor="middle" dominantBaseline="central">
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </text>
          </g>
        );
      })}

      {/* Foul rails — theme-aware via `--spray-gridline-color`
         (30 % lighter than the labels) so the two diagonal
         foul-line boundaries read as part of the field's
         gridline geometry layer instead of competing with the
         labels' tone. Stroke width matches the angular ticks
         (1.0) so the rails render at the same visual weight as
         the rest of the gridline system. */}
      {(() => {
        const r = maxDist * scale;
        return (
          <>
            <line x1={cx} y1={cy}
              x2={cx - r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="var(--spray-gridline-color)" strokeWidth={1.0} />
            <line x1={cx} y1={cy}
              x2={cx + r * Math.cos(Math.PI / 4)} y2={cy - r * Math.sin(Math.PI / 4)}
              stroke="var(--spray-gridline-color)" strokeWidth={1.0} />
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

      {/* ── Big One average mode: five 18° slice wedges with landing %s.
          Slice boundaries −45°…+45° in 18° steps (LF, LC, CF, RC, RF —
          matches spraySliceAggregate). Fill intensity is normalized to
          the hottest slice; labels sit at ~2/3 field depth. */}
      {sliceAgg && (() => {
        const r = maxDist * scale;
        const maxPct = Math.max(...sliceAgg.pcts, 1);
        const names = ['LF', 'LC', 'CF', 'RC', 'RF'];
        const pt = (a: number, rr: number): [number, number] => {
          const rad = ((90 - a) * Math.PI) / 180;
          return [cx + rr * Math.cos(rad), cy - rr * Math.sin(rad)];
        };
        return names.map((nm, i) => {
          const a0 = -45 + i * 18;
          const a1 = a0 + 18;
          const [x0, y0] = pt(a0, r);
          const [x1, y1] = pt(a1, r);
          const pct = sliceAgg.pcts[i] ?? 0;
          const [lx, ly] = pt(a0 + 9, r * 0.66);
          const [nx, ny] = pt(a0 + 9, r * 0.5);
          return (
            <g key={nm} pointerEvents="none">
              <path d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`}
                fill="rgba(96,165,250,1)" opacity={0.07 + 0.4 * (pct / maxPct)}
                stroke="var(--spray-gridline-color)" strokeWidth={0.8} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                fill="rgba(240,245,252,0.96)" fontSize={16} fontWeight={700}
                fontFamily="'Satoshi', 'DM Sans', sans-serif" letterSpacing="0.04em">
                {Math.round(pct)}%
              </text>
              <text x={nx} y={ny} textAnchor="middle" dominantBaseline="central"
                style={{ fill: 'var(--spray-label-color)' }}
                fontSize={9} fontWeight={600} letterSpacing="0.2em"
                fontFamily="'DM Mono', ui-monospace, monospace">
                {nm}
              </text>
            </g>
          );
        });
      })()}

      {/* Selection vector */}
      {!sliceAgg && selected !== null && dots[selected] && (() => {
        const dot = dots[selected];
        const [sx, sy] = toXY(dot.angle, dot.distance);
        return (
          <line x1={cx} y1={cy} x2={sx} y2={sy}
            stroke="rgba(255,255,255,0.35)" strokeWidth={0.8}
            strokeDasharray="2 3" pointerEvents="none" />
        );
      })()}

      {/* Dots — hidden in slice-percentage mode */}
      {!sliceAgg && dots.map((dot, i) => {
        const [x, y] = toXY(dot.angle, dot.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const isSelected = selected === i;
        const v = valueOf(dot);
        const t = v == null ? 0 : Math.max(0, Math.min(1, axisT(v)));
        const color = dotColor(dot);
        const glow  = dotGlow(dot);
        // HitTrax dots use solid ball-type colors; opacity / stroke / glow
        // intensity come from a flat preset so each category reads
        // uniformly. Full Swing dots keep the existing axis-ramp scaling.
        const isCat = dot.ballTypeCode != null;
        const pointOpacity = isCat ? 0.92 : (v == null ? 0.85 : rampOpacity(t));
        const pointStrokeW = isCat ? 0.9 : (v == null ? 0.75 : rampStrokeWidth(t));
        const pointStroke  = isCat ? 'rgba(6,8,14,0.5)' : (v == null ? 'rgba(6,8,14,0.55)' : rampStroke(t));
        const glowOpacity = isSelected ? 0.95 : (isCat ? 0.55 : 0.40 + t * 0.25);
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
      {/* LEFT / CENTER / RIGHT zone labels at the top of the field
         — theme-aware via `--spray-label-color`: matches the Exit
         Velo / angular label muted blue-grey in dark mode, flips
         to a clean medium grey in light mode. */}
      {[
        { x: W * 0.22, label: 'LEFT' },
        { x: W * 0.50, label: 'CENTER' },
        { x: W * 0.78, label: 'RIGHT' },
      ].map(z => (
        <text key={z.label} x={z.x} y={18}
          style={{ fill: 'var(--spray-label-color)' }}
          fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
          fontWeight={600} letterSpacing="0.28em" textAnchor="middle">{z.label}</text>
      ))}

      {/* Color-axis legend retired from inside the SVG — moved up into
          the pane header (replacing the "Spray Chart" label) as a
          standalone React/CSS strip. The in-SVG version was redundant
          once the header strip carried the same gradient + ticks. */}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SprayChartView — full self-contained widget
   ─────────────────────────────────────────────────────────────────────────── */
export function SprayChartView({
  playerId, refreshKey, reportUploadIds, maxWidth, compact = false,
  onDataRangeChange, hideReadout = false, hideFilters = false,
  hideColorBar = false, noOuterChrome = false, sliceAggregate = false,
}: {
  playerId: string;
  refreshKey?: number;
  reportUploadIds?: string[];
  /** Cap the chart's rendered width (px). Defaults to filling the container. */
  maxWidth?: number;
  /** Tighter padding + condensed filter card — for top-of-page placement. */
  compact?: boolean;
  /** Fires whenever the resolved data-date-range label changes (or
   *  becomes null when the chart has no data). Lets the parent host
   *  render the date chip in the snapshot header instead of inside
   *  the chart's legend strip. Receives the same formatted label
   *  that this component used to render itself ("Apr 3 – May 15, 2026"). */
  onDataRangeChange?: (label: string | null) => void;
  /** Hide the Metric Readout bubble (EV / LA / BS / DIST / SQ%) that
   *  normally sits ABOVE the spray chart. Used by the Swing Decision
   *  view where the Results GradeRow occupies that slot instead. */
  hideReadout?: boolean;
  /** Hide the filter card (EV / LA / BS sliders + Reset) that sits
   *  at the BOTTOM of the spray chart bubble. Used by the Swing
   *  Decision view to make the chart bubble shorter so its bottom
   *  edge aligns with the bottom of the Overall GradeRow in the
   *  sibling right column. */
  hideFilters?: boolean;
  /** Hide the color-axis legend strip (Exit Velo gradient + tick
   *  numerals) that normally leads the chart bubble. Used by the
   *  Swing Decision view where the chart is hosted inside the
   *  combined Results + Spray bubble and the colour legend is
   *  redundant given the chart's outcome-coded dots. */
  hideColorBar?: boolean;
  /** Render the chart's content WITHOUT the warm-grey Movement-Plot
   *  bubble chrome (background gradient + white-rim border + box
   *  shadow). Used by the Swing Decision view where the chart sits
   *  inside a parent bubble that owns the chrome — so this inner
   *  surface stays transparent and the two regions read as ONE
   *  combined bubble. */
  noOuterChrome?: boolean;
  /** Big One average mode: render the five-slice landing-percentage view
   *  (LF/LC/CF/RC/RF) instead of individual dots. The min-threshold
   *  filters still apply — percentages recompute over the filtered set. */
  sliceAggregate?: boolean;
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

    /* `reportUploadIds` semantics:
       - `undefined` → no filter, query all CSVs for the player.
       - `[]`        → skip CSV queries entirely (the active report
                       section has no CSV uploads attached).
       - `[...]`     → filter CSV queries by these upload IDs.
       Live-tracker AtBats live OUTSIDE this gate — they're not
       attached to a CSV upload bundle, so we ALWAYS fetch them
       regardless of `reportUploadIds`. (The previous early-return
       on empty `reportUploadIds` short-circuited the entire effect
       and prevented AtBat dots from rendering on the Decision
       sub-tab when no at-bat CSV had been uploaded yet.) */
    const csvSkipped = Array.isArray(reportUploadIds) && reportUploadIds.length === 0;
    const ids = reportUploadIds && reportUploadIds.length > 0 ? reportUploadIds : undefined;

    /* Two parallel fetches — same shape for Swing and Swing
       Decision sub-tabs. Only the upload-ID set the parent passes
       differs (assessment uploads vs at-bat uploads); the fetch
       itself always pulls from BOTH vendor sources so the chart can
       overlay whatever each report has attached:
         1. HITTRAX-source spray_x / spray_z / ball_type_code /
            max_exit_velo / launch_angle / distance — per-row
            landing coords from the Spray Chart X/Z columns of the
            BP CSV. Cartesian coords are converted to polar (angle,
            distance) so the existing chart geometry plots them at
            the correct landing position.
         2. FULL_SWING-source spray_angle / distance / EV / LA / BS /
            squared-up — pitch-level metrics from the at-bat or
            assessment Full Swing export. */
    Promise.all([
      /* CSV-source HitTrax / Full Swing fetches are skipped when the
         active report section has no uploads attached (`csvSkipped`).
         The AtBat fetch below still runs so live-tracker spray dots
         render even before any CSV is uploaded to the report. */
      csvSkipped
        ? Promise.resolve([] as any[])
        : api.getSessionData(
            playerId, 'HITTRAX',
            // `distance` is included so the old-style backfill below
            // can pull HitTrax's Dist column when spray entries lack
            // their own per-row aggregate. (For new uploads the Dist
            // column already shares a timestamp with the spray
            // coords, so this is a no-op there.)
            ['spray_x', 'spray_z', 'spray_angle', 'spray_dist', 'ball_type_code', 'max_exit_velo', 'launch_angle', 'distance'],
            { uploadIds: ids },
          ).catch(() => [] as any[]),
      csvSkipped
        ? Promise.resolve([] as any[])
        : api.getSessionData(
            playerId, 'FULL_SWING',
            ['spray_angle', 'distance', 'max_exit_velo', 'launch_angle', 'bat_speed', 'squared_up_pct'],
            { uploadIds: ids },
          ).catch(() => [] as any[]),
      /* Live-tracker AtBats — pulls every AtBat for this hitter so we
         can plot the sprayX/sprayY coords the coach tapped on the
         in-tracker mini field. Each AtBat with non-null spray coords
         becomes a SprayDot, mapped from the normalized [0,1] cartesian
         space the mini field uses to the chart's polar (angle,
         distance) space (angle ±45° at the foul lines, distance up
         to the 400-ft fence). UNCONDITIONAL — AtBats live on the
         hitter's Player record, not a CSV upload bundle, so they
         render whether or not the active report has CSV uploads. */
      api.listAtBats({ hitterId: playerId, limit: 1000 }).catch(() => [] as any[]),
    ]).then(([htData, fsData, atBats]) => {
      let minTs: string | null = null;
      let maxTs: string | null = null;
      const trackTs = (key: string) => {
        if (minTs === null || key < minTs) minTs = key;
        if (maxTs === null || key > maxTs) maxTs = key;
      };

      // ── HitTrax dots — Cartesian (X, Z) preferred, polar fallback ──
      type HtRow = {
        x?: number; z?: number;
        polarAngle?: number; polarDist?: number;
        type?: number; ev?: number; la?: number; dist?: number;
        date: string;
      };
      const htByTime = new Map<string, HtRow>();
      // Flat per-row lists for the OLD-STYLE pairing fallback. Old HitTrax
      // uploads (parsed before the per-row-timestamp fix in
      // hittrax-parser.ts) emit EVERY max_exit_velo / launch_angle /
      // distance row with the SAME `lastDate` timestamp, so the
      // timestamp-based pairing above collapses N CSV rows into one
      // map entry (only the last value survives). To rescue those
      // uploads without forcing a re-upload, we ALSO keep the raw
      // EV / LA / Dist values in the order Prisma returned them
      // (recordedAt ASC, ties broken by insertion id) — that order
      // mirrors the CSV row order the parser pushed them in. We then
      // index-pair these into spray entries that came back missing
      // their EV / LA / Dist.
      const evInOrder: { value: number; ts: string }[] = [];
      const laInOrder: { value: number; ts: string }[] = [];
      const distInOrder: { value: number; ts: string }[] = [];
      for (const d of htData as any[]) {
        const key = d.recordedAt;
        if (!htByTime.has(key)) htByTime.set(key, { date: key });
        const entry = htByTime.get(key)!;
        if (d.metricType === 'spray_x')        entry.x = d.value;
        if (d.metricType === 'spray_z')        entry.z = d.value;
        if (d.metricType === 'spray_angle')    entry.polarAngle = d.value;
        if (d.metricType === 'spray_dist')     entry.polarDist  = d.value;
        if (d.metricType === 'ball_type_code') entry.type = d.value;
        if (d.metricType === 'max_exit_velo')  { entry.ev = d.value; evInOrder.push({ value: d.value, ts: key }); }
        if (d.metricType === 'launch_angle')   { entry.la = d.value; laInOrder.push({ value: d.value, ts: key }); }
        if (d.metricType === 'distance')       { entry.dist = d.value; distInOrder.push({ value: d.value, ts: key }); }
        trackTs(key);
      }

      // Filter to spray entries (Cartesian X/Z OR polar Horiz.Angle/Dist
      // present) and sort by recordedAt so the resulting order matches
      // CSV row order — every spray row's timestamp is `rowDate + i`.
      const sprayEntries: HtRow[] = [...htByTime.values()]
        .filter(e =>
          (e.x !== undefined && e.z !== undefined && e.z > 0) ||
          (e.polarAngle !== undefined && e.polarDist !== undefined && e.polarDist > 0)
        )
        .sort((a, b) => a.date.localeCompare(b.date));

      // OLD-STYLE BACKFILL — per-timestamp pairing then row-order spillover.
      //
      // The Map above (htByTime) stores ONE value per (timestamp, metric);
      // if multiple max_exit_velo rows share a timestamp (as the OLD
      // parser produced — every row stamped to `lastDate`), only the
      // LAST value survives, and most spray entries (those at
      // `rowDate + i` for i ≥ 1) end up with no EV / LA / Dist at all.
      // The collapse also poisons the surviving value: when the i = 0
      // spray row happens to share its timestamp with the lastDate
      // clump, its Map slot got overwritten N times and now holds CSV
      // row N − 1's EV, not row 0's.
      //
      // The fix: rebuild the pairing from the flat per-row arrays.
      //   1. For every (timestamp, metric) bucket, pair its values
      //      one-to-one with the sprayEntries that share that exact
      //      timestamp (in date-sorted order, which equals CSV row
      //      order because the parser uses rowDate + i).
      //   2. Any leftover values at a timestamp are spillover —
      //      assign them in order to the next sprayEntry that's
      //      still missing this field.
      //
      // New-style data hits exclusively the 1:1 case (one value per
      // timestamp, one sprayEntry per timestamp), so it's a no-op
      // correctness pass. Old-style data exercises the spillover.
      const pairField = (
        rows: { value: number; ts: string }[],
        field: 'ev' | 'la' | 'dist',
      ) => {
        const valuesByTs = new Map<string, number[]>();
        for (const r of rows) {
          if (!valuesByTs.has(r.ts)) valuesByTs.set(r.ts, []);
          valuesByTs.get(r.ts)!.push(r.value);
        }
        const entriesByTs = new Map<string, HtRow[]>();
        for (const e of sprayEntries) {
          if (!entriesByTs.has(e.date)) entriesByTs.set(e.date, []);
          entriesByTs.get(e.date)!.push(e);
        }
        // Reset the field on every spray entry — Map.set overwrites
        // when multiple values share a timestamp, so the surviving
        // value is unreliable. We rebuild from scratch below.
        for (const e of sprayEntries) e[field] = undefined;

        const spillover: number[] = [];
        for (const [ts, vals] of valuesByTs) {
          const entries = entriesByTs.get(ts) ?? [];
          const matched = Math.min(vals.length, entries.length);
          for (let i = 0; i < matched; i++) entries[i][field] = vals[i];
          if (vals.length > matched) spillover.push(...vals.slice(matched));
        }
        let s = 0;
        for (const e of sprayEntries) {
          if (e[field] === undefined && s < spillover.length) e[field] = spillover[s++];
        }
      };
      pairField(evInOrder,   'ev');
      pairField(laInOrder,   'la');
      pairField(distInOrder, 'dist');

      const htDots: SprayDot[] = [];
      for (const entry of sprayEntries) {
        let angle: number | undefined;
        let distance: number | undefined;
        if (entry.x !== undefined && entry.z !== undefined && entry.z > 0) {
          // Cartesian → polar. Spray Chart X: − = pull, + = oppo.
          // toXY's convention: 0° = center, + = toward right field.
          distance = Math.sqrt(entry.x * entry.x + entry.z * entry.z);
          angle = (Math.atan2(entry.x, entry.z) * 180) / Math.PI;
        } else if (entry.polarAngle !== undefined && entry.polarDist !== undefined && entry.polarDist > 0) {
          // Direct polar from Horiz. Angle + Dist.
          angle = entry.polarAngle;
          distance = entry.polarDist;
        }
        if (angle === undefined || distance === undefined) continue;
        htDots.push({
          angle, distance,
          exitVelo: entry.ev, launchAngle: entry.la,
          ballTypeCode: entry.type,
        });
      }

      // ── Full Swing dots — always built (in parallel with HitTrax),
      //    so a player whose report carries both vendors gets BOTH
      //    dot sets on the chart. The Metric Readout shows whatever
      //    fields the clicked dot's CSV carries:
      //      • HitTrax dot → EV / LA / DIST   (BS, SQ% stay blank)
      //      • Full Swing dot → EV / LA / BS / DIST / SQ%
      //    Each Full Swing pitch shares one rowDate across all of
      //    its metrics (parser stamps every value with the row's
      //    Date+Time), so the timestamp-keyed Map collapses to one
      //    entry per pitch with every field set correctly.
      const fsByTime = new Map<string, { angle?: number; distance?: number; exitVelo?: number; launchAngle?: number; batSpeed?: number; squaredUp?: number }>();
      for (const d of fsData as any[]) {
        const key = d.recordedAt;
        if (!fsByTime.has(key)) fsByTime.set(key, {});
        const entry = fsByTime.get(key)!;
        if (d.metricType === 'spray_angle')    entry.angle = d.value;
        if (d.metricType === 'distance')       entry.distance = d.value;
        if (d.metricType === 'max_exit_velo')  entry.exitVelo = d.value;
        if (d.metricType === 'launch_angle')   entry.launchAngle = d.value;
        if (d.metricType === 'bat_speed')      entry.batSpeed = d.value;
        if (d.metricType === 'squared_up_pct') entry.squaredUp = d.value;
        trackTs(key);
      }
      const fsDots: SprayDot[] = [];
      for (const entry of fsByTime.values()) {
        if (entry.angle !== undefined && entry.distance !== undefined && entry.distance > 0) {
          fsDots.push({
            angle: entry.angle, distance: entry.distance,
            exitVelo: entry.exitVelo, launchAngle: entry.launchAngle,
            batSpeed: entry.batSpeed, squaredUp: entry.squaredUp,
          });
        }
      }

      /* ── Live-tracker AtBat dots ───────────────────────────────
         Each AtBat with non-null sprayX/sprayY (set when the coach
         taps the in-tracker mini field after an in-play outcome)
         becomes a SprayDot. Conversion: normalized [0,1] cartesian
         on the mini field maps to the chart's polar (angle,
         distance) space — angle in ±45° at the foul lines, distance
         scaled to the 400-ft fence. The ballTypeCode bridge mirrors
         the HitTrax legend so the AB outcome paints the dot:
           BARREL / LINE_DRIVE → 2 (blue),
           GROUND_BALL         → 1 (red),
           FLY_BALL            → 3 (green).
         Strikeouts and walks have no spray coords so they're
         filtered out of this loop. */
      const atBatDots: SprayDot[] = [];
      for (const ab of (atBats || []) as any[]) {
        if (typeof ab?.sprayX !== 'number' || typeof ab?.sprayY !== 'number') continue;
        const angle = (ab.sprayX - 0.5) * 90;
        const distance = ab.sprayY * 400;
        let ballTypeCode: number | undefined;
        switch (ab.outcome) {
          case 'GROUND_BALL':                  ballTypeCode = 1; break;
          case 'LINE_DRIVE':
          case 'BARREL':                       ballTypeCode = 2; break;
          case 'FLY_BALL':                     ballTypeCode = 3; break;
        }
        atBatDots.push({ angle, distance, ballTypeCode });
        /* Stamp the AB's `startedAt` into the chart's date range so
           the legend's "Apr 3 – May 15" label reflects live-tracker
           sessions too (not just CSV uploads). */
        if (typeof ab.startedAt === 'string') trackTs(ab.startedAt);
      }

      // Concatenate — HitTrax dots first, Full Swing dots second,
      // live AtBat dots last. Each dot only carries the fields its
      // source provides, so the click-time Metric Readout shows '—'
      // for any field the dot's source doesn't have.
      const nextDots: SprayDot[] = [...htDots, ...fsDots, ...atBatDots];

      setSprayDots(nextDots);
      setDataRange(minTs && maxTs ? { start: minTs, end: maxTs } : null);
      setLoading(false);
    }).catch(() => { setSprayDots([]); setDataRange(null); setLoading(false); });
  }, [playerId, refreshKey, JSON.stringify(reportUploadIds || [])]);

  const activeDot = selectedDot !== null ? filteredDots[selectedDot] : null;
  const dataRangeLabel = dataRange
    ? `${new Date(dataRange.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(dataRange.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : null;

  // Bubble the formatted date label up to the parent so it can render
  // the chip in the Hitting Snapshot header. We fire on every change
  // (including the initial null → label transition once data loads,
  // and the reverse if reportUploadIds clear out). The host stores
  // the latest value and decides where to render it.
  useEffect(() => {
    if (onDataRangeChange) onDataRangeChange(dataRangeLabel);
  }, [dataRangeLabel, onDataRangeChange]);

  // Spray Chart bubble chrome — references the shared
  // `--bubble-chrome-bg` CSS variable defined in globals.css so it
  // flips between the dark-mode triple-layer warm-grey gradient and
  // the light-mode off-white #f8f8f8 → #f1f1f1 in lockstep with
  // every other movement-plot / pitch-report style bubble across
  // the Hitting + Pitching tabs (Swing / Quality of Contact /
  // Coach Diagnosis chip tables, Coach Grades, Full Swing, Blast
  // Motion, HitTrax, ArsenalCards, etc.).
  const bubbleChrome: React.CSSProperties = {
    background: 'var(--bubble-chrome-bg)',
    border: '1px solid var(--border-light)',
    borderRadius: 12,
    /* Drop shadow softened from `0 18px 40px / 0.30` to a much
       gentler `0 4px 12px / 0.10` per coach-spec so the Spray
       Chart sits with a subtle lift rather than a heavy halo. */
    boxShadow: '0 5px 14px rgba(0, 0, 0, 0.21)',
  };

  // Ball Readout (Metric Readout) chrome — now matches the Spray
  // Chart bubble + every Hitting chip surface via `--bubble-chrome-bg`
  // so the Metric Readout, Spray Chart, and Swing GradeRow all read
  // as the same surface color. The previous dark-navy `.panel`-style
  // chrome was retired so the whole right column of the Hitting
  // Snapshot (and the top Ball Readout sibling on the left) sits on
  // one unified bubble color.
  const readoutChrome: React.CSSProperties = {
    background: 'var(--bubble-chrome-bg)',
    border: '1px solid var(--border-light)',
    borderRadius: 12,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.10)',
  };

  return (
    <div
      // OUTER WRAPPER — flex column that stacks two siblings:
      //   (1) Ball Readout bubble (was a child of the spray-chart
      //       bubble, now its own bubble above)
      //   (2) Spray Chart bubble (label, color bar, chart, filter)
      // Both siblings share the same Movement-Plot chrome.
      // `height: 100%` so the SprayChartView fills its column wrapper
      // — and the chart bubble below uses `flex: 1` to grow into the
      // remaining vertical space after the fixed-96px Ball Readout,
      // making its bottom edge land flush with the bottom of the
      // Decision bubble at the bottom of the right-column GradeRow
      // stack.
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        width: '100%',
        height: '100%',
        maxWidth: maxWidth ?? '100%',
        margin: maxWidth ? '0 auto' : undefined,
      }}
    >
      {/* ── Ball Readout bubble — top sibling. Sits ABOVE the spray
          chart bubble as its own separate panel. Displays the
          currently-selected pitch's EV / LA / BS / DIST / SQ% — same
          5-column grid as before, just lifted out of the chart
          wrapper. Typography + padding bumped ~30% larger so this
          bubble matches the visual weight of the Results bubble that
          sits as a top sibling on the right column of the Hitting
          Snapshot's two-pane grid.
          Suppressed entirely when `hideReadout` is true — the Swing
          Decision view replaces this readout with the Results
          GradeRow (rendered by the parent above the chart). */}
      {!hideReadout && sprayDots.length > 0 && (
        <div
          style={{
            /* Metric Readout bubble — warm-grey Movement-Plot chrome
               (same Curveball / Pitch Report Arsenal color used
               across the app). The previous inner dark-navy tile is
               retired so the metric grid sits directly on this
               warm-grey surface. */
            ...bubbleChrome,
            padding: compact ? '8px 10px' : '10px 12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 12,
            alignItems: 'center',
            /* Height locked to 96px so this Ball Readout (the Metric
               Readout sibling at the top of the Spray Chart column)
               sits the EXACT same height as the Results bubble at
               the top of the Grade Stack column on the Swing
               Decision view (which has wrapping chip labels like
               "Groundball %" / "Fly Ball %" pushing its natural
               content height to ~90+px). A fixed `height` (not
               `minHeight`) on both sides guarantees an exact pixel
               match. */
            height: 96,
          }}
        >
          {[
            { label: 'EV',   value: activeDot?.exitVelo,    unit: 'mph', decimals: 1 },
            { label: 'LA',   value: activeDot?.launchAngle, unit: '°',   decimals: 1 },
            { label: 'BS',   value: activeDot?.batSpeed,    unit: 'mph', decimals: 1 },
            { label: 'DIST', value: activeDot?.distance,    unit: 'ft',  decimals: 0 },
            { label: 'SQ%',  value: activeDot?.squaredUp,   unit: '%',   decimals: 1 },
          ].map(p => (
            /* alignItems: 'center' so each column's label (EV / LA /
               BS / DIST / SQ%) sits horizontally centered above the
               numeric value + unit pair below it. Previously the
               flex column defaulted to flex-start, which left-aligned
               the label against the column's left edge while the
               value was at its natural inline-baseline flex
               container's start, making the label visibly to the
               LEFT of where the data populated. */
            <div key={p.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
              <span
                className={aStyles.sprayLightText}
                style={{
                  /* Font D treatment — inherited Satoshi, 9 px, weight
                     600, 0.05em tracking, uppercase, bright white.
                     Matches every other grey-bubble secondary label
                     across the app (Tool Grades bar labels, KPI chip
                     labels, Break & Spin column header, etc.). */
                  fontFamily: 'inherit',
                  fontSize: rem(9), fontWeight: 600, letterSpacing: '0.05em',
                  textTransform: 'uppercase', color: 'var(--text-bright)',
                  lineHeight: 1.2,
                }}
              >{p.label}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                <span
                  className={aStyles.sprayLightText}
                  style={{
                    /* 16 → 20.8 (≈21) — 30% larger */
                    fontSize: rem(21), fontWeight: 700, color: 'var(--text)',
                    fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {p.value != null ? p.value.toFixed(p.decimals) : '—'}
                </span>
                {p.value != null && p.unit && (
                  /* 9 → 12 — 30% larger */
                  <span
                    className={aStyles.sprayLightText}
                    style={{ fontSize: rem(12), color: 'var(--text-muted)', fontWeight: 600 }}
                  >{p.unit}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

    <div
      // Outer spray-chart bubble — now wears the Pitching Movement
      // Plot chrome (triple-gradient surface + white-rim border +
      // soft outer shadow). The scan-line texture from before still
      // overlays as the topmost background layer so the bubble keeps
      // its "tactical HUD" lines design.
      // When `noOuterChrome` is on (Swing Decision combined bubble),
      // the chrome (background / border / radius / shadow) is dropped
      // and only the layout container survives. The parent supplies
      // the outer bubble surface in that mode.
      style={{
        padding: noOuterChrome ? 0 : (compact ? '10px 12px 12px' : '14px 14px 16px'),
        /* Tightened gap so the Spray Chart label → Exit Velo bar →
           chart → Filter stack packs close together; the chart's
           CENTER label below home plate now sits just below the "95"
           tick on the color bar above. */
        display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6,
        width: '100%',
        /* Movement-Plot bubble surface — same triple-gradient stack
         * the Pitching `.hudPlotCanvas` uses, with one extra layer
         * on top: the home-plate blue beacon. The beacon used to
         * live inside the SVG as a `<circle fill="url(#spray-
         * beacon)">`, but the SVG drawing area stops at the chart's
         * bottom edge — just above the Filter row — so the glow got
         * sliced off where the filters began. Painted as a CSS
         * radial-gradient on the bubble's background instead, the
         * glow sits BEHIND every child of the bubble (chart pane,
         * filter row, reset chip) and bleeds smoothly through to
         * the bubble's bottom edge.
         *
         * Geometry:
         *   - centered at 50% horizontal, 70% vertical so the glow's
         *     bright spot lands on home plate (the SVG renders home
         *     plate at the bottom-center of the chart pane, which
         *     in the bubble's overall layout is roughly 65–75 % of
         *     the bubble's height — adjustable if it drifts).
         *   - color stops mirror the retired SVG gradient
         *     (rgba(126,182,255,0.50) → rgba(61,139,253,0.20) →
         *     rgba(61,139,253,0)) but stretched so the fully-faded
         *     edge lands past the bubble's bottom corner; the
         *     visible glow now covers the entire lower half of the
         *     bubble surface, passing behind the filter sliders and
         *     reaching the bubble's bottom edge. */
        /* Use the `background` shorthand (NOT `backgroundImage`)
           so the trailing `var(--bubble-chrome-bg)` resolves
           correctly whether the variable is a gradient OR a
           flat color (e.g. inside the Hitting Snapshot scope
           where it's overridden to a flat `#ffffff`). The
           `background-image` property only accepts image
           values, so a flat color in that list invalidates
           the entire declaration — causing the bubble's base
           fill to drop out and only the blue beacon glow to
           render (making the bubble look see-through / grey).
           The shorthand correctly treats the trailing value as
           a `background-color` when it's a flat color. */
        background: noOuterChrome
          ? undefined
          : /* Blue beacon glow at home plate sits ON TOP of the
               shared `--bubble-chrome-bg` surface so the bubble
               chrome flips in lockstep with every other movement-
               plot / pitch-report style bubble in the app (Swing,
               Quality of Contact, Coach Diagnosis, Coach Grades,
               Blast Motion, etc.). */
            'radial-gradient(circle at 50% 70%, rgba(126,182,255,0.45) 0%, rgba(61,139,253,0.20) 13.2%, rgba(61,139,253,0) 36%),' +
            ' var(--bubble-chrome-bg)',
        border: noOuterChrome ? 'none' : '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: noOuterChrome ? 0 : 12,
        /* Softer drop shadow on the chart bubble — same gentle
           `0 4px 12px / 0.10` used by `bubbleChrome` above so both
           Spray Chart surfaces sit at a matching lift. Previous
           heavy `0 18px 40px / 0.30` halo was retired. */
        boxShadow: noOuterChrome ? 'none' : '0 5px 14px rgba(0, 0, 0, 0.21)',
        /* `noOuterChrome` mode is rendered inside a flex-grow wrapper
           in HittingTab (decision view) — flex-1 ourselves so the
           chart container grows to fill all available vertical
           space within the parent bubble. */
        flex: noOuterChrome ? 1 : undefined,
        minHeight: noOuterChrome ? 0 : undefined,
      }}
    >
      {/* "Spray Chart" label retired — the color-axis legend strip
          below now leads the bubble. The bubble's identity is clear
          from its content (color ramp + chart) so the eyebrow label
          was redundant. */}

      {/* Header strip — color-axis legend (Exit Velo gradient ramp) on
          the left, optional date-range chip on the right. The gradient
          ramp + axis ticks mirror the legend that used to live inside
          the SVG so the chart's color encoding is visible at a glance
          without crowding the plot itself. Suppressed entirely when
          `hideColorBar` is true (Swing Decision view — the Results
          GradeRow above already conveys the per-outcome data, so the
          colour ramp is redundant). */}
      {!hideColorBar && (() => {
        const axis = COLOR_AXES[colorBy];
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            {/* Color-bar legend — Exit Velo label now sits centered
                ABOVE the gradient bar (was previously left-aligned to
                the side of the bar). Stacked column layout puts the
                axis label on top, the gradient ramp in the middle,
                and the tick numerals below — all sharing the same
                horizontal axis so the label visually anchors to the
                center of the bar line. */}
            <div style={{
              flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column', gap: 3,
              padding: '2px 0',
              fontFamily: "'DM Mono', ui-monospace, monospace",
            }}>
              <span
                className={aStyles.sprayLightText}
                style={{
                  fontSize: rem(9), fontWeight: 700, letterSpacing: '0.22em',
                  color: 'rgba(183,190,201,0.78)', whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                {axis.label}
              </span>
              <div style={{
                height: 5, borderRadius: 2.5,
                background: 'linear-gradient(90deg, #1E3A8A 0%, #60A5FA 50%, #FFFFFF 100%)',
              }} />
              <div
                className={aStyles.sprayLightText}
                style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: rem(9), fontWeight: 600, letterSpacing: '0.12em',
                  color: 'rgba(183,190,201,0.62)',
                }}
              >
                {axis.ticks.map((t, idx, arr) => (
                  <span key={t} style={{
                    textAlign: idx === 0 ? 'left' : idx === arr.length - 1 ? 'right' : 'center',
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {/* Date-range chip moved up to the parent Hitting Snapshot
                header (top-right). The host receives the formatted
                label via the `onDataRangeChange` callback and renders
                the chip there so the snapshot bubbles share one
                consistent header treatment with the date on the
                opposite side from the title. */}
          </div>
        );
      })()}

      {/* Chart frame — transparent container so the SVG sits directly
          on the outer "Spray Chart" bubble's gray surface. The previous
          .innerPanel wrapper was producing a doubled, lighter bubble
          layer over the chart that the user doesn't want.

          The previous `marginTop: 'auto'` (which pushed the chart down
          into the lower half of the pane) was retired — the chart now
          rides up flush against the Exit Velo color bar so the field's
          center line lands just under the "95" tick on the color bar. */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          /* Default chart frame uses fixed aspect ratio (520/460 or
             520/414 in the filter-less variant). When `noOuterChrome`
             is on (Decision-view combined bubble), the frame instead
             flex-grows to fill all remaining vertical space inside
             the parent bubble — so the chart's bottom edge aligns
             with the right column's Overall bubble bottom. SVG
             preserveAspectRatio="xMidYMid meet" keeps the field
             diamond proportionally intact at any container height. */
          ...(noOuterChrome
            ? { flex: 1, minHeight: 0 }
            : { aspectRatio: hideFilters ? '520 / 414' : '520 / 460' }),
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
            sliceAgg={sliceAggregate ? spraySliceAggregate(filteredDots.map(d => d.angle)) : null}
          />
        ) : sprayDots.length > 0 ? (
          <SprayEmpty icon="🎯" title="No batted balls match the current filters" hint="Adjust or reset filters below" />
        ) : (
          <SprayEmpty icon="🏟️" title="Spray chart will populate with Full Swing batted-ball data"
            hint="Upload a Full Swing CSV with Direction + Distance" />
        )}
      </div>

      {/* Ball Readout retired from inside the spray-chart bubble — it
          now lives as its own separate bubble ABOVE this one (rendered
          at the top of the outer wrapper). */}

      {/* Filter bar — bubble chrome retired (no background, no border,
          no radius). The filters now sit naked on the spray chart
          bubble's surface so the whole pane reads as one continuous
          surface from chart frame through to the filter row. The
          negative marginTop pulls the whole section UP into the
          chart's bottom band so the Filters / Reset labels sit
          flush with the end of the blue field-glow effect and the
          EV / LA / BS chips below them ride right up to the chart's
          bottom edge.
          Suppressed when `hideFilters` is true — the Swing Decision
          view drops the filter card so the chart bubble's bottom
          edge sits flush with the Overall GradeRow in the sibling
          right column. */}
      {!hideFilters && sprayDots.length > 0 && (
        <div
          style={{
            padding: '0 4px 0',
            /* Filter row's upward-pull is now halved: -24 → -12 to
               drop the filter stack 50 % closer to the bubble's
               bottom edge. The filters still ride into the chart's
               bottom band a little (so the row keeps reading as
               part of the chart pane and not a separate strip),
               but with twice as much breathing room between the
               sliders and the chart's home-plate area than before. */
            marginTop: -12,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          <div
            className={aStyles.sprayLightText}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: rem(10), fontWeight: 700, letterSpacing: '0.22em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
            }}
          >
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
              className={filtersActive ? undefined : aStyles.sprayLightText}
              style={{
                background: 'none', border: 'none',
                color: filtersActive ? 'var(--accent-light)' : 'var(--text-muted)',
                fontSize: rem(10), fontWeight: 700, letterSpacing: '0.18em',
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
              const shortLabel = def.key === 'exitVelo' ? 'EV'
                : def.key === 'launchAngle' ? 'LA'
                : 'BS';
              /* The earlier "selected color axis" highlight (borderColor /
                 dot glow / blue label) was retired — it left EV
                 perpetually lit because `colorBy` defaults to
                 'exitVelo'. The filter card now styles itself
                 EXCLUSIVELY off `isActive` (the slider is no longer
                 at its default), so any one of EV / LA / BS only
                 turns blue when the user is actively filtering on
                 it. Clicking the dot+label button still toggles
                 `colorBy` for the chart's dot color ramp; it just
                 no longer paints the filter card itself. */
              return (
                <div
                  key={def.key}
                  style={{
                    padding: '5px 8px',
                    background: isActive ? 'rgba(126,182,255,0.06)' : 'rgba(255,255,255,0.018)',
                    border: '1px solid',
                    borderColor: isActive ? 'rgba(126,182,255,0.30)' : 'var(--border)',
                    borderRadius: 7,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    transition: 'all 0.15s ease',
                    minWidth: 0,
                  }}
                >
                  <div style={{
                    /* Centered header row: dot+label on the left of the
                       value, both grouped in the middle of the filter
                       card rather than the previous space-between
                       split (label at far-left edge, value at
                       far-right). */
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
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
                        background: isActive ? '#7eb6ff' : 'rgba(255,255,255,0.20)',
                        boxShadow: isActive ? '0 0 5px rgba(126,182,255,0.6)' : undefined,
                        flexShrink: 0,
                      }} />
                      <span
                        className={isActive ? undefined : aStyles.sprayLightText}
                        style={{
                          fontSize: rem(9.5), fontWeight: 700, letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
                          fontFamily: "'DM Mono', ui-monospace, monospace",
                        }}
                      >{shortLabel}</span>
                    </button>
                    {isActive ? (
                      <span
                        className={aStyles.sprayLightText}
                        style={{
                          fontSize: rem(10), fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                          color: 'var(--text)', whiteSpace: 'nowrap',
                        }}
                      >
                        ≥ {val}<span
                          className={aStyles.sprayLightText}
                          style={{ fontSize: rem(8.5), color: 'var(--text-muted)', marginLeft: 2 }}
                        >{def.unit}</span>
                      </span>
                    ) : (
                      <span
                        className={aStyles.sprayLightText}
                        style={{ fontSize: rem(9.5), color: 'var(--text-muted)', letterSpacing: '0.10em' }}
                      >All</span>
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

          {/* "Showing X/Y" footer row retired — the chart itself
              communicates which dots are visible after filtering, so
              the count strip was redundant. */}
        </div>
      )}
    </div>{/* /spray-chart bubble */}
    </div>
  );
}

function SprayEmpty({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 6, color: 'var(--text-muted)', fontSize: rem(13), textAlign: 'center', padding: 24,
    }}>
      <div style={{ fontSize: rem(36), opacity: 0.7 }}>{icon}</div>
      <div>{title}</div>
      {hint && <div style={{ fontSize: rem(11), opacity: 0.7 }}>{hint}</div>}
    </div>
  );
}
