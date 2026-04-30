'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  SectionHeader, Section,
  NotesBox, VideoPlaceholder, ReportSelector, AddReportButton,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import hud from './PitchingTab.module.css';
import { TabProps, getReportVideoIds, getReportContentVideos, getReportUploadIds, getLatestReport, type ReportSummary } from '../helpers';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TrackmanPitch } from '@/lib/api';
import { generatePitchingPdf } from '@/lib/pdf';
import { CustomCharts } from '@/components/CustomCharts';
import { TabBarActions } from '@/components/assessment';

/* ── Pitch type colors ── */
const PITCH_COLORS: Record<string, string> = {
  Fastball:    '#4ECDC4',
  Sinker:      '#E67E22',
  Cutter:      '#9B59B6',
  Slider:      '#F1C40F',
  Curveball:   '#E67E22',
  ChangeUp:    '#3498DB',
  Splitter:    '#1ABC9C',
  Sweeper:     '#E91E63',
  Knuckleball: '#95A5A6',
  Unknown:     '#7F8C8D',
};

/* Pitch type short labels */
const PITCH_SHORT: Record<string, string> = {
  Fastball: '4S FB', Sinker: 'SI', Cutter: 'FC', Slider: 'SL',
  Curveball: 'CB', ChangeUp: 'CH', Splitter: 'FS', Sweeper: 'SW',
  Knuckleball: 'KN', Unknown: '??',
};

/* Pitch type display names */
const PITCH_DISPLAY: Record<string, string> = {
  Fastball: '4-Seam Fastball', Sinker: 'Sinker', Cutter: 'Cutter',
  Slider: 'Slider', Curveball: 'Curveball', ChangeUp: 'Changeup',
  Splitter: 'Splitter', Sweeper: 'Sweeper', Knuckleball: 'Knuckleball',
};

function getPitchColor(type: string): string {
  return PITCH_COLORS[type] || PITCH_COLORS.Unknown;
}

/** Convert a #RRGGBB hex pitch color to an rgba() glow halo string. */
function pitchGlow(type: string, alpha = 0.5): string {
  const hex = getPitchColor(type).replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Arsenal summary ── */
interface ArsenalRow {
  pitchType: string;
  count: number;
  pct: number;
  avgVelo: number;
  maxVelo: number;
  minVelo: number;
  avgSpin: number;
  avgHBreak: number;
  avgIVB: number;
  avgExt: number;
  avgRelHeight: number;
  avgRelSide: number;
  tilt: string;
  spinEff: number;
}

function computeArsenal(pitches: TrackmanPitch[]): ArsenalRow[] {
  const groups = new Map<string, TrackmanPitch[]>();
  for (const p of pitches) {
    const t = p.pitchType || 'Unknown';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(p);
  }

  const total = pitches.length;
  const rows: ArsenalRow[] = [];
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  for (const [pitchType, pts] of groups) {
    const velos = pts.map(p => p.relSpeed).filter((v): v is number => v != null);
    const spins = pts.map(p => p.spinRate).filter((v): v is number => v != null);
    const hBreaks = pts.map(p => p.horzBreak).filter((v): v is number => v != null);
    const ivbs = pts.map(p => p.inducedVertBreak).filter((v): v is number => v != null);
    const exts = pts.map(p => p.extension).filter((v): v is number => v != null);
    const relHeights = pts.map(p => p.relHeight).filter((v): v is number => v != null);
    const relSides = pts.map(p => p.relSide).filter((v): v is number => v != null);
    const axes = pts.map(p => p.spinAxis).filter((v): v is number => v != null);

    // Compute tilt from spin axis (clock face format)
    const avgAxis = avg(axes);
    const hour = Math.floor(avgAxis / 30) || 12;
    const minute = Math.round((avgAxis % 30) / 30 * 60);
    const tilt = axes.length > 0 ? `${hour}:${minute.toString().padStart(2, '0')}` : '--';

    // Approximate spin efficiency from IVB and total break
    const avgIvbVal = avg(ivbs);
    const avgHVal = avg(hBreaks);
    const totalBreak = Math.sqrt(avgIvbVal * avgIvbVal + avgHVal * avgHVal);
    const spinEff = totalBreak > 0 && spins.length > 0
      ? Math.min(100, Math.round((Math.abs(avgIvbVal) + Math.abs(avgHVal)) / (totalBreak + 5) * 100))
      : 0;

    rows.push({
      pitchType,
      count: pts.length,
      pct: Math.round((pts.length / total) * 100),
      avgVelo: Math.round(avg(velos) * 10) / 10,
      maxVelo: velos.length ? Math.round(Math.max(...velos) * 10) / 10 : 0,
      minVelo: velos.length ? Math.round(Math.min(...velos) * 10) / 10 : 0,
      avgSpin: Math.round(avg(spins)),
      avgHBreak: Math.round(avg(hBreaks) * 10) / 10,
      avgIVB: Math.round(avg(ivbs) * 10) / 10,
      avgExt: Math.round(avg(exts) * 10) / 10,
      avgRelHeight: Math.round(avg(relHeights) * 10) / 10,
      avgRelSide: Math.round(avg(relSides) * 10) / 10,
      tilt,
      spinEff,
    });
  }

  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/* ── Pitch Arsenal Card ── */
function ArsenalCard({ row }: { row: ArsenalRow }) {
  const color = getPitchColor(row.pitchType);
  const hasData = row.maxVelo > 0;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '9px 11px', flex: 1, minWidth: 108,
    }}>
      <div style={{ fontSize: 8.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 5 }}>
        {PITCH_DISPLAY[row.pitchType] || row.pitchType}
      </div>
      {hasData ? (
        <>
          {/* Max Velocity — biggest */}
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color, lineHeight: 1 }}>
            {row.maxVelo.toFixed(1)}
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1, fontWeight: 500 }}>mph max</div>

          {/* Avg Velocity — medium */}
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono', monospace", color, lineHeight: 1, marginTop: 5 }}>
            {row.avgVelo.toFixed(1)}
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1, fontWeight: 500 }}>mph avg</div>

          {/* Velocity Range — smallest */}
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: 'var(--text)', lineHeight: 1 }}>
              {row.minVelo.toFixed(1)} – {row.maxVelo.toFixed(1)}
            </div>
            <div style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 1, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Velo Range (mph)</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: 'var(--faint)', lineHeight: 1 }}>--</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>No data yet</div>
        </>
      )}
    </div>
  );
}

/* ── Shared pitch detail panel (used by both plots) ── */
function PitchDetailPanel({ selected, compact }: { selected: TrackmanPitch | null; compact?: boolean }) {
  if (!selected) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 6, opacity: 0.5, padding: '12px 0',
      }}>
        <span style={{ fontSize: 22 }}>&#127919;</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Click a pitch</span>
      </div>
    );
  }
  const items: [string, string, string][] = [
    ['Pitch', PITCH_SHORT[selected.pitchType] || selected.pitchType, getPitchColor(selected.pitchType)],
    ['Velocity', selected.relSpeed != null ? `${selected.relSpeed.toFixed(1)} mph` : '--', 'var(--text)'],
    ['Spin Rate', selected.spinRate != null ? `${Math.round(selected.spinRate)} rpm` : '--', 'var(--text)'],
    ['H-Break', selected.horzBreak != null ? `${selected.horzBreak.toFixed(1)}"` : '--', 'var(--text)'],
    ['IVB', selected.inducedVertBreak != null ? `${selected.inducedVertBreak.toFixed(1)}"` : '--', 'var(--text)'],
    ['Extension', selected.extension != null ? `${selected.extension.toFixed(1)} ft` : '--', 'var(--text)'],
    ['Rel Height', selected.relHeight != null ? `${selected.relHeight.toFixed(1)} ft` : '--', 'var(--text)'],
    ['Rel Side', selected.relSide != null ? `${selected.relSide.toFixed(1)} ft` : '--', 'var(--text)'],
  ];
  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>
        Selected Pitch
      </div>
      {items.map(([label, val, color]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'DM Mono', monospace", color }}>{val}</span>
        </div>
      ))}
    </>
  );
}

/* ── Interactive Movement Plot — tactical HUD styling (matches spray chart) ── */
function MovementPlot({
  pitches, selected, onSelect,
}: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
}) {
  const W = 460;
  const H = 440;
  const pad = { top: 44, right: 32, bottom: 48, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.horzBreak != null && p.inducedVertBreak != null &&
    typeof p.horzBreak === 'number' && typeof p.inducedVertBreak === 'number'
  );

  if (valid.length === 0) return null;

  const axisMin = -25;
  const axisMax = 25;
  const sx = (v: number) => pad.left + ((v - axisMin) / (axisMax - axisMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - axisMin) / (axisMax - axisMin)) * plotH;
  const cx = sx(0);
  const cy = sy(0);
  const minorTicks = [-20, -15, -10, -5, 5, 10, 15, 20];
  const majorTicks = [-20, -10, 10, 20];
  const pitchTypes = [...new Set(valid.map(p => p.pitchType))];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ cursor: 'default', display: 'block', width: '100%', height: 'auto' }}>
            <defs>
              {/* Scan-line overlay — tactical HUD texture; canvas is transparent
                 so the outer bubble gradient shows through */}
              <pattern id="mvScanlines" x="0" y="0" width="1" height="5" patternUnits="userSpaceOnUse">
                <rect width="1" height="5" fill="transparent" />
                <rect y="0" width="1" height="1" fill="rgba(255,255,255,0.018)" />
              </pattern>
              {/* Origin beacon glow */}
              <radialGradient id="mvBeacon" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="rgba(126,182,255,0.45)" />
                <stop offset="40%" stopColor="rgba(61,139,253,0.18)" />
                <stop offset="100%" stopColor="rgba(61,139,253,0)" />
              </radialGradient>
            </defs>

            {/* Transparent click-to-deselect surface */}
            <rect width={W} height={H} fill="transparent" onClick={() => onSelect(null)} />
            <rect width={W} height={H} fill="url(#mvScanlines)" pointerEvents="none" />

            {/* Origin beacon */}
            <circle cx={cx} cy={cy} r={90} fill="url(#mvBeacon)" pointerEvents="none" />

            {/* Minor grid lines — dashed silver hairlines every 5 units */}
            {minorTicks.map(v => (
              <g key={`mx${v}`}>
                <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
                  stroke="rgba(183,190,201,0.10)" strokeWidth={0.6} strokeDasharray="3 5" />
                <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
                  stroke="rgba(183,190,201,0.10)" strokeWidth={0.6} strokeDasharray="3 5" />
              </g>
            ))}

            {/* Major grid + tick chips at ±10, ±20 */}
            {majorTicks.map(v => (
              <g key={`mj${v}`}>
                <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
                  stroke="rgba(183,190,201,0.18)" strokeWidth={0.75} strokeDasharray="3 5" />
                <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
                  stroke="rgba(183,190,201,0.18)" strokeWidth={0.75} strokeDasharray="3 5" />

                {/* X-axis chip (bottom) */}
                <g transform={`translate(${sx(v)}, ${pad.top + plotH + 14})`}>
                  <rect x={-13} y={-8} width={26} height={14} rx={7}
                    fill="rgba(10,12,18,0.75)"
                    stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
                  <text x={0} y={2.5}
                    fill="rgba(183,190,201,0.8)"
                    fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
                    fontWeight={600} letterSpacing="0.12em"
                    textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
                </g>

                {/* Y-axis chip (left) */}
                <g transform={`translate(${pad.left - 18}, ${sy(v)})`}>
                  <rect x={-14} y={-7} width={28} height={14} rx={7}
                    fill="rgba(10,12,18,0.75)"
                    stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
                  <text x={0} y={3}
                    fill="rgba(183,190,201,0.8)"
                    fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
                    fontWeight={600} letterSpacing="0.12em"
                    textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
                </g>
              </g>
            ))}

            {/* Crosshair axes — bright silver rails at x=0, y=0 */}
            <line x1={pad.left} y1={cy} x2={pad.left + plotW} y2={cy}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />
            <line x1={cx} y1={pad.top} x2={cx} y2={pad.top + plotH}
              stroke="rgba(223,227,232,0.42)" strokeWidth={1.2} />

            {/* Origin marker — tiny silver pentagon (like the home-plate on spray) */}
            <circle cx={cx} cy={cy} r={4} fill="rgba(223,227,232,0.92)"
              stroke="rgba(255,255,255,0.5)" strokeWidth={0.75} />

            {/* Axis labels — mono, uppercase, tracked */}
            <text x={pad.left} y={pad.top + plotH + 36}
              fill="rgba(183,190,201,0.55)"
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
              fontWeight={600} letterSpacing="0.28em"
              textAnchor="start">← ARM</text>
            <text x={pad.left + plotW} y={pad.top + plotH + 36}
              fill="rgba(183,190,201,0.55)"
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
              fontWeight={600} letterSpacing="0.28em"
              textAnchor="end">GLOVE →</text>
            <g transform={`translate(16, ${pad.top + plotH / 2}) rotate(-90)`}>
              <text x={0} y={0}
                fill="rgba(183,190,201,0.55)"
                fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
                fontWeight={600} letterSpacing="0.28em"
                textAnchor="middle">DROP · RISE</text>
            </g>

            {/* Selected → thin dashed vector from origin to the dot */}
            {selected && (() => {
              const hb = selected.horzBreak;
              const ivb = selected.inducedVertBreak;
              if (hb == null || ivb == null) return null;
              return (
                <line x1={cx} y1={cy} x2={sx(hb as number)} y2={sy(ivb as number)}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={0.8}
                  strokeDasharray="2 3"
                  pointerEvents="none" />
              );
            })()}

            {/* Pitch dots — pitch-colored with matching glow halo */}
            {valid.map((p, i) => {
              const isSelected = selected && p.id === selected.id;
              const dim = selected && !isSelected;
              const px = sx(p.horzBreak as number);
              const py = sy(p.inducedVertBreak as number);
              const color = getPitchColor(p.pitchType);
              return (
                <g key={i}
                  style={{ cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : p); }}>
                  <circle cx={px} cy={py} r={isSelected ? 15 : 9}
                    fill={pitchGlow(p.pitchType, isSelected ? 0.6 : 0.4)}
                    opacity={dim ? 0.2 : (isSelected ? 0.95 : 0.55)} />
                  <circle cx={px} cy={py}
                    r={isSelected ? 6.5 : 4}
                    fill={color}
                    stroke={isSelected ? '#ffffff' : 'rgba(6,8,14,0.55)'}
                    strokeWidth={isSelected ? 2 : 0.75}
                    opacity={dim ? 0.35 : 1}
                    style={{ transition: 'all 0.15s ease' }} />
                  {isSelected && (
                    <circle cx={px - 1.4} cy={py - 1.4} r={1.3}
                      fill="rgba(255,255,255,0.92)" />
                  )}
                </g>
              );
            })}

            {/* Plot frame — grad-edge hairline rectangle */}
            <rect x={pad.left} y={pad.top} width={plotW} height={plotH}
              fill="none" stroke="rgba(183,190,201,0.16)" strokeWidth={0.75} />

            {/* Pitch-type legend — mono chips along the top rim */}
            {pitchTypes.map((t, i) => {
              const chipW = 54;
              const gap = 8;
              const totalW = pitchTypes.length * chipW + (pitchTypes.length - 1) * gap;
              const startX = pad.left + plotW - totalW;
              return (
                <g key={t} transform={`translate(${startX + i * (chipW + gap)}, 18)`}>
                  <rect x={0} y={-10} width={chipW} height={18} rx={9}
                    fill="rgba(10,12,18,0.72)"
                    stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
                  <circle cx={9} cy={0} r={3.5} fill={getPitchColor(t)}
                    style={{ filter: `drop-shadow(0 0 4px ${pitchGlow(t, 0.7)})` }} />
                  <text x={18} y={3.5}
                    fill="rgba(183,190,201,0.82)"
                    fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
                    fontWeight={600} letterSpacing="0.14em"
                    textAnchor="start">{PITCH_SHORT[t] || t}</text>
                </g>
              );
            })}
    </svg>
  );
}

/* ── Release Point Plot (fixed grid, handedness-aware) ── */
function ReleasePointPlot({ pitches, width = 380, height = 360 }: {
  pitches: TrackmanPitch[];
  width?: number;
  height?: number;
}) {
  const pad = { top: 36, right: 20, bottom: 44, left: 50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.relSide != null && p.relHeight != null &&
    typeof p.relSide === 'number' && typeof p.relHeight === 'number'
  );

  if (valid.length === 0) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Release Point Plot</div>
        <div style={{ fontSize: 13, color: 'var(--faint)' }}>No data available</div>
      </div>
    );
  }

  // Fixed grid bounds
  const xMin = -4, xMax = 4;
  const yMin = 2, yMax = 7;

  const sx = (v: number) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const xTicks = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  const yTicks = [2, 3, 4, 5, 6, 7];

  // Determine handedness from the data
  const throwsCounts: Record<string, number> = {};
  for (const p of valid) {
    const hand = (p.pitcherThrows || '').toLowerCase().trim();
    if (hand) throwsCounts[hand] = (throwsCounts[hand] || 0) + 1;
  }
  const isLefty = (throwsCounts['left'] || 0) > (throwsCounts['right'] || 0);

  // Legend types
  const types = [...new Set(valid.map(p => p.pitchType))];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 8px 8px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
        Release Point Plot {isLefty ? '(LHP)' : '(RHP)'}
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Grid lines */}
        {xTicks.map((v, i) => (
          <g key={`x${i}`}>
            <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
              stroke={v === 0 ? 'var(--text-muted)' : 'var(--border)'}
              strokeWidth={v === 0 ? 1 : 0.5}
              opacity={v === 0 ? 0.5 : 1} />
            <text x={sx(v)} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{v}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)} stroke="var(--border)" strokeWidth={0.5} />
            <text x={pad.left - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">{v}</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={height - 22} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)">
          Release Side (ft)
        </text>
        <text x={12} y={pad.top + plotH / 2} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)"
          transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>Release Height (ft)</text>

        {/* Handedness side indicator */}
        <text x={sx(-3)} y={pad.top + 14} textAnchor="middle" fontSize={9} fontWeight={600}
          fill={!isLefty ? 'var(--green)' : 'var(--text-muted)'} opacity={0.6}>
          {!isLefty ? 'RHP Side' : ''}
        </text>
        <text x={sx(3)} y={pad.top + 14} textAnchor="middle" fontSize={9} fontWeight={600}
          fill={isLefty ? 'var(--green)' : 'var(--text-muted)'} opacity={0.6}>
          {isLefty ? 'LHP Side' : ''}
        </text>

        {/* Data points — flip X for lefties so they appear on the right side */}
        {valid.map((p, i) => {
          const rawSide = p.relSide as number;
          // Right-handers: data naturally plots on left (negative side)
          // Left-handers: flip sign so data plots on right (positive side)
          const plotSide = isLefty ? -rawSide : rawSide;
          return (
            <circle key={i} cx={sx(plotSide)} cy={sy(p.relHeight as number)}
              r={5} fill={getPitchColor(p.pitchType)} opacity={0.85}
              stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
          );
        })}

        {/* Border */}
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="var(--border)" strokeWidth={1} />

        {/* Legend */}
        {types.map((t, i) => (
          <g key={t} transform={`translate(${pad.left + plotW - types.length * 70 + i * 70}, ${pad.top - 18})`}>
            <circle cx={0} cy={0} r={4} fill={getPitchColor(t)} />
            <text x={8} y={4} fontSize={10} fontWeight={600} fill="var(--text-muted)">{PITCH_SHORT[t] || t}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── Pitch Location Plot (strike zone, interactive) ── */
function PitchLocationPlot({
  pitches, selected, onSelect,
}: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
}) {
  const W = 460;
  const H = 440;
  const pad = { top: 44, right: 32, bottom: 48, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.plateLocSide != null && p.plateLocHeight != null &&
    typeof p.plateLocSide === 'number' && typeof p.plateLocHeight === 'number'
  );

  if (valid.length === 0) return null;

  const xMin = -2.5, xMax = 2.5, yMin = 0, yMax = 5;
  const sx = (v: number) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const szLeft = -0.83, szRight = 0.83, szBot = 1.5, szTop = 3.5;
  const szW = szRight - szLeft;
  const szH = szTop - szBot;
  const zones = [
    { n: 1, x: szLeft, y: szTop - szH / 3 },
    { n: 2, x: szLeft + szW / 3, y: szTop - szH / 3 },
    { n: 3, x: szLeft + 2 * szW / 3, y: szTop - szH / 3 },
    { n: 4, x: szLeft, y: szTop - 2 * szH / 3 },
    { n: 5, x: szLeft + szW / 3, y: szTop - 2 * szH / 3 },
    { n: 6, x: szLeft + 2 * szW / 3, y: szTop - 2 * szH / 3 },
    { n: 7, x: szLeft, y: szBot },
    { n: 8, x: szLeft + szW / 3, y: szBot },
    { n: 9, x: szLeft + 2 * szW / 3, y: szBot },
  ];
  const pitchTypes = [...new Set(valid.map(p => p.pitchType))];
  const szCx = sx(0);
  const szCy = sy((szBot + szTop) / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ cursor: 'default', display: 'block', width: '100%', height: 'auto' }}>
      <defs>
        <pattern id="locScanlines" x="0" y="0" width="1" height="5" patternUnits="userSpaceOnUse">
          <rect width="1" height="5" fill="transparent" />
          <rect y="0" width="1" height="1" fill="rgba(255,255,255,0.018)" />
        </pattern>
        <radialGradient id="locBeacon" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="rgba(126,182,255,0.40)" />
          <stop offset="45%" stopColor="rgba(61,139,253,0.16)" />
          <stop offset="100%" stopColor="rgba(61,139,253,0)" />
        </radialGradient>
      </defs>

      {/* Transparent click-to-deselect surface */}
      <rect width={W} height={H} fill="transparent" onClick={() => onSelect(null)} />
      <rect width={W} height={H} fill="url(#locScanlines)" pointerEvents="none" />

      {/* Strike-zone beacon glow */}
      <circle cx={szCx} cy={szCy} r={90} fill="url(#locBeacon)" pointerEvents="none" />

      {/* Minor grid — dashed silver hairlines at 0.5ft / 1ft */}
      {[-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2].map(v => (
        <line key={`xg${v}`} x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
          stroke="rgba(183,190,201,0.08)" strokeWidth={0.6} strokeDasharray="3 5" />
      ))}
      {[0.5, 1.5, 2.5, 3.5, 4.5].map(v => (
        <line key={`yg${v}`} x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
          stroke="rgba(183,190,201,0.08)" strokeWidth={0.6} strokeDasharray="3 5" />
      ))}

      {/* Integer-foot Y-axis ticks + mono pill chips */}
      {[1, 2, 3, 4, 5].map(v => (
        <g key={`yt${v}`}>
          <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
            stroke="rgba(183,190,201,0.14)" strokeWidth={0.7} strokeDasharray="3 5" />
          <g transform={`translate(${pad.left - 18}, ${sy(v)})`}>
            <rect x={-14} y={-7} width={28} height={14} rx={7}
              fill="rgba(10,12,18,0.75)"
              stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
            <text x={0} y={3}
              fill="rgba(183,190,201,0.8)"
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
              fontWeight={600} letterSpacing="0.12em"
              textAnchor="middle">{v}FT</text>
          </g>
        </g>
      ))}

      {/* Integer-foot X-axis chips */}
      {[-2, -1, 0, 1, 2].map(v => (
        <g key={`xt${v}`} transform={`translate(${sx(v)}, ${pad.top + plotH + 14})`}>
          <rect x={-13} y={-8} width={26} height={14} rx={7}
            fill="rgba(10,12,18,0.75)"
            stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
          <text x={0} y={2.5}
            fill="rgba(183,190,201,0.8)"
            fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
            fontWeight={600} letterSpacing="0.12em"
            textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
        </g>
      ))}

      {/* Strike zone — bright silver frame with mono-gridded 3×3 zones */}
      {(() => {
        const x = sx(szLeft), y = sy(szTop);
        const w = sx(szRight) - sx(szLeft);
        const h = sy(szBot) - sy(szTop);
        return (
          <g pointerEvents="none">
            {/* Zone subdividers */}
            <line x1={sx(szLeft + szW / 3)} y1={sy(szTop)} x2={sx(szLeft + szW / 3)} y2={sy(szBot)}
              stroke="rgba(183,190,201,0.24)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft + 2 * szW / 3)} y1={sy(szTop)} x2={sx(szLeft + 2 * szW / 3)} y2={sy(szBot)}
              stroke="rgba(183,190,201,0.24)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft)} y1={sy(szTop - szH / 3)} x2={sx(szRight)} y2={sy(szTop - szH / 3)}
              stroke="rgba(183,190,201,0.24)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft)} y1={sy(szTop - 2 * szH / 3)} x2={sx(szRight)} y2={sy(szTop - 2 * szH / 3)}
              stroke="rgba(183,190,201,0.24)" strokeWidth={0.7} strokeDasharray="2 3" />
            {/* Zone frame */}
            <rect x={x} y={y} width={w} height={h}
              fill="none" stroke="rgba(223,227,232,0.55)" strokeWidth={1.25} />
            {/* Zone numbers */}
            {zones.map(z => (
              <text key={z.n}
                x={sx(z.x + szW / 6)} y={sy(z.y + szH / 6) + 3.5}
                fill="rgba(183,190,201,0.5)"
                fontSize={10}
                fontFamily="'DM Mono', ui-monospace, monospace"
                fontWeight={600}
                letterSpacing="0.08em"
                textAnchor="middle">{z.n}</text>
            ))}
          </g>
        );
      })()}

      {/* Home plate silhouette at the bottom */}
      <polygon
        points={`${sx(-0.71)},${sy(0.35)} ${sx(0.71)},${sy(0.35)} ${sx(0.71)},${sy(0.18)} ${sx(0)},${sy(0)} ${sx(-0.71)},${sy(0.18)}`}
        fill="rgba(223,227,232,0.22)"
        stroke="rgba(223,227,232,0.42)"
        strokeWidth={0.75}
      />

      {/* Selected → dashed vector from strike-zone center to the dot */}
      {selected && (() => {
        const sd = selected.plateLocSide;
        const ht = selected.plateLocHeight;
        if (sd == null || ht == null) return null;
        return (
          <line x1={szCx} y1={szCy} x2={sx(sd as number)} y2={sy(ht as number)}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={0.8}
            strokeDasharray="2 3"
            pointerEvents="none" />
        );
      })()}

      {/* Pitch dots with glow halos */}
      {valid.map((p, i) => {
        const isSelected = selected && p.id === selected.id;
        const dim = selected && !isSelected;
        const px = sx(p.plateLocSide as number);
        const py = sy(p.plateLocHeight as number);
        const color = getPitchColor(p.pitchType);
        return (
          <g key={i}
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : p); }}>
            <circle cx={px} cy={py} r={isSelected ? 15 : 9}
              fill={pitchGlow(p.pitchType, isSelected ? 0.6 : 0.4)}
              opacity={dim ? 0.2 : (isSelected ? 0.95 : 0.55)} />
            <circle cx={px} cy={py}
              r={isSelected ? 6.5 : 4}
              fill={color}
              stroke={isSelected ? '#ffffff' : 'rgba(6,8,14,0.55)'}
              strokeWidth={isSelected ? 2 : 0.75}
              opacity={dim ? 0.35 : 1}
              style={{ transition: 'all 0.15s ease' }} />
            {isSelected && (
              <circle cx={px - 1.4} cy={py - 1.4} r={1.3} fill="rgba(255,255,255,0.92)" />
            )}
          </g>
        );
      })}

      {/* Plot frame */}
      <rect x={pad.left} y={pad.top} width={plotW} height={plotH}
        fill="none" stroke="rgba(183,190,201,0.16)" strokeWidth={0.75} />

      {/* Axis labels — mono, uppercase, tracked */}
      <text x={pad.left} y={pad.top + plotH + 36}
        fill="rgba(183,190,201,0.55)"
        fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
        fontWeight={600} letterSpacing="0.28em"
        textAnchor="start">← INSIDE</text>
      <text x={pad.left + plotW} y={pad.top + plotH + 36}
        fill="rgba(183,190,201,0.55)"
        fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
        fontWeight={600} letterSpacing="0.28em"
        textAnchor="end">OUTSIDE →</text>

      {/* Pitch-type legend — mono chips along the top rim */}
      {pitchTypes.map((t, i) => {
        const chipW = 54;
        const gap = 8;
        const totalW = pitchTypes.length * chipW + (pitchTypes.length - 1) * gap;
        const startX = pad.left + plotW - totalW;
        return (
          <g key={t} transform={`translate(${startX + i * (chipW + gap)}, 18)`}>
            <rect x={0} y={-10} width={chipW} height={18} rx={9}
              fill="rgba(10,12,18,0.72)"
              stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
            <circle cx={9} cy={0} r={3.5} fill={getPitchColor(t)}
              style={{ filter: `drop-shadow(0 0 4px ${pitchGlow(t, 0.7)})` }} />
            <text x={18} y={3.5}
              fill="rgba(183,190,201,0.82)"
              fontSize={9} fontFamily="'DM Mono', ui-monospace, monospace"
              fontWeight={600} letterSpacing="0.14em"
              textAnchor="start">{PITCH_SHORT[t] || t}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Arsenal Table ── */
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)',
};
const tdBase: React.CSSProperties = { padding: '8px 10px', color: 'var(--text)' };
const tdMono: React.CSSProperties = { ...tdBase, fontFamily: "'DM Mono', monospace", fontWeight: 600 };

function ReleaseTable({ rows }: { rows: ArsenalRow[] }) {
  const cols = '70px 1fr 1fr 1fr';
  const headerStyle: React.CSSProperties = { fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', textAlign: 'center' };
  const cellStyle: React.CSSProperties = { textAlign: 'center', fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: 'var(--text)' };

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Release &amp; Extension
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ ...headerStyle, textAlign: 'left' }}>Pitch</span>
          <span style={headerStyle}>Extension</span>
          <span style={headerStyle}>Rel Height</span>
          <span style={headerStyle}>Rel Side</span>
        </div>
        {rows.map(r => (
          <div key={r.pitchType} style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: getPitchColor(r.pitchType) }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <span style={cellStyle}>
              {r.avgExt > 0 ? r.avgExt : '--'} <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
            </span>
            <span style={cellStyle}>
              {r.avgRelHeight > 0 ? r.avgRelHeight : '--'} <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
            </span>
            <span style={cellStyle}>
              {r.avgRelSide !== 0 ? r.avgRelSide : '--'} <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Velocity Range Bars ── */
function VeloRanges({ rows }: { rows: ArsenalRow[] }) {
  const globalMax = Math.max(...rows.map(r => r.maxVelo));
  const globalMin = Math.min(...rows.filter(r => r.minVelo > 0).map(r => r.minVelo));
  const range = globalMax - globalMin + 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
        Velocity Range by Pitch
      </div>
      {rows.filter(r => r.maxVelo > 0).map(r => {
        const left = ((r.minVelo - globalMin + 5) / range) * 100;
        const w = ((r.maxVelo - r.minVelo) / range) * 100;
        return (
          <div key={r.pitchType} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 40, fontFamily: "'DM Mono', monospace" }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', position: 'relative' }}>
              <div style={{
                position: 'absolute', left: `${left}%`, width: `${Math.max(w, 2)}%`,
                height: '100%', borderRadius: 4, background: getPitchColor(r.pitchType),
              }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap' }}>
              {r.minVelo} &ndash; {r.maxVelo} MPH
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Break & Spin Table ── */
function BreakTable({ rows }: { rows: ArsenalRow[] }) {
  const cols = '70px 1fr 1fr 1fr 1fr 1fr';
  const headerStyle: React.CSSProperties = { fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', textAlign: 'center' };
  const cellStyle: React.CSSProperties = { textAlign: 'center', fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: 'var(--text)' };

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Break &amp; Spin
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ ...headerStyle, textAlign: 'left' }}>Pitch</span>
          <span style={headerStyle}>H-Break</span>
          <span style={headerStyle}>V-Break</span>
          <span style={headerStyle}>Spin</span>
          <span style={headerStyle}>Tilt</span>
          <span style={headerStyle}>Spin Eff</span>
        </div>
        {rows.map(r => (
          <div key={r.pitchType} style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: getPitchColor(r.pitchType) }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <span style={cellStyle}>
              {r.avgHBreak > 0 ? '+' : ''}{r.avgHBreak}&quot;
            </span>
            <span style={cellStyle}>
              {r.avgIVB > 0 ? '+' : ''}{r.avgIVB}&quot;
            </span>
            <span style={cellStyle}>
              {r.avgSpin} <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)' }}>rpm</span>
            </span>
            <span style={cellStyle}>
              {r.tilt}
            </span>
            <span style={cellStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--border)' }}>
                  <div style={{ width: `${r.spinEff}%`, height: '100%', borderRadius: 3, background: getPitchColor(r.pitchType) }} />
                </div>
                <span style={{ fontSize: 11 }}>{r.spinEff}%</span>
              </div>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main PitchingTab ── */
export function PitchingTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos, onNewReport, onEditReport,
}: TabProps) {
  const { user } = useAuth();
  const [pitches, setPitches] = useState<TrackmanPitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPitch, setSelectedPitch] = useState<TrackmanPitch | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

  // ── Coaching notes for the pitch report (mirrors the diagnosis-notes pattern from SwingTab) ──
  const latestPitching = useMemo(() => getLatestReport(reports, ['PITCHING']), [reports]);
  const persistedPitchingNotes = useMemo(() => {
    if (!latestPitching?.content) return '';
    try {
      const c = JSON.parse(latestPitching.content);
      return typeof c.pitchingNotes === 'string' ? c.pitchingNotes : '';
    } catch { return ''; }
  }, [latestPitching]);
  const [pitchingNotes, setPitchingNotes] = useState(persistedPitchingNotes);
  useEffect(() => { setPitchingNotes(persistedPitchingNotes); }, [persistedPitchingNotes]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaveOk, setNotesSaveOk] = useState(false);
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const notesDirty = pitchingNotes !== persistedPitchingNotes;

  async function savePitchingNotes() {
    if (!user) { setNotesSaveError('Not signed in.'); return; }
    setSavingNotes(true);
    setNotesSaveError(null);
    setNotesSaveOk(false);
    try {
      const userId = (user as any).id || (user as any).sub;
      let prev: Record<string, any> = {};
      if (latestPitching?.content) {
        try { prev = JSON.parse(latestPitching.content) || {}; } catch { /* ignore */ }
      }
      const newContent = {
        ...prev,
        pitchingNotes,
        notesUpdatedAt: new Date().toISOString(),
        notesUpdatedBy: userId,
      };
      await api.createReport({
        playerId: player.id,
        createdById: userId,
        reportType: 'PITCHING',
        title: 'Pitching Notes Update',
        content: JSON.stringify(newContent),
        notes: latestPitching?.notes ?? undefined,
      });
      setNotesSaveOk(true);
      onRefresh?.();
    } catch (e) {
      setNotesSaveError((e as Error).message || 'Save failed');
    } finally {
      setSavingNotes(false);
      setTimeout(() => setNotesSaveOk(false), 2200);
    }
  }

  useEffect(() => {
    if (!player?.id) return;
    setLoading(true);
    const opts = reportUploadIds.length > 0 ? { uploadIds: reportUploadIds } : undefined;
    api.getTrackmanPitches(player.id, opts)
      .then(data => setPitches(data))
      .catch(() => setPitches([]))
      .finally(() => setLoading(false));
  }, [player?.id, refreshKey, reportUploadIds]);

  const hasPitchData = pitches.length > 0;
  const arsenal = hasPitchData ? computeArsenal(pitches) : [];

  // Ensure we always show all 4 main pitch types in arsenal cards
  const mainTypes = ['Fastball', 'Curveball', 'Slider', 'ChangeUp'];
  const arsenalCards = mainTypes.map(t => {
    const existing = arsenal.find(a => a.pitchType === t);
    return existing || {
      pitchType: t, count: 0, pct: 0, avgVelo: 0, maxVelo: 0, minVelo: 0,
      avgSpin: 0, avgHBreak: 0, avgIVB: 0, avgExt: 0, avgRelHeight: 0, avgRelSide: 0, tilt: '--', spinEff: 0,
    };
  });
  // Add any pitch types not in mainTypes
  for (const a of arsenal) {
    if (!mainTypes.includes(a.pitchType)) arsenalCards.push(a);
  }

  return (
    <>
      {/* ── Report Selector + Add Report + Download (portaled into TabBar) ── */}
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
        <ReportSelector
          reports={reports}
          reportTypes={['PITCHING']}
          label="Pitching"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generatePitchingPdf(player, [r])}
        />
      </TabBarActions>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
          Loading pitch data...
        </div>
      )}

      {/* ── Unified Pitch Report — Arsenal + Movement + Location in one HUD bubble ── */}
      {!loading && hasPitchData && (
        <div className={hud.hudConsole} style={{ marginBottom: 24 }}>
          {/* Console header */}
          <div className={hud.hudHead}>
            <span className={hud.hudHeadDot} />
            Pitch Report
            <span style={{ color: 'var(--text-muted)', letterSpacing: '0.18em', fontWeight: 500, marginLeft: 4 }}>
              &middot; {pitches.length} pitches
            </span>
          </div>

          {/* Arsenal strip */}
          <div className={hud.hudArsenal}>
            {arsenalCards.map((row) => (
              <ArsenalCard key={row.pitchType} row={row} />
            ))}
          </div>

          {/* Plot pane headers */}
          <div className={hud.hudSubHead}>
            <span className={hud.hudSubTitle}>
              <span className={hud.hudSubTitleDot} /> Movement &middot; Pitcher&rsquo;s View
            </span>
            <span className={hud.hudSubTitle}>
              <span className={hud.hudSubTitleDot} /> Location &middot; Catcher&rsquo;s View
            </span>
          </div>

          {/* Plots side by side */}
          <div className={hud.hudPlotsGrid}>
            <div className={hud.hudPlotPane}>
              <div className={hud.hudPlotCanvas}>
                <MovementPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} />
              </div>
            </div>
            <div className={hud.hudPlotPane}>
              <div className={hud.hudPlotCanvas}>
                <PitchLocationPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} />
              </div>
            </div>
          </div>

          {/* Shared readout bar */}
          <div className={hud.hudReadoutBar}>
            <div className={hud.hudReadoutHead}>
              <span className={hud.hudHeadDot} />
              {selectedPitch ? 'Selected Pitch' : 'Pitch Readout'}
            </div>
            <div className={hud.hudReadoutBody}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 8, width: '100%' }}>
                {([
                  ['Pitch',
                    selectedPitch ? (PITCH_SHORT[selectedPitch.pitchType] || selectedPitch.pitchType) : '--',
                    selectedPitch ? getPitchColor(selectedPitch.pitchType) : 'var(--text-muted)'],
                  ['Velocity',
                    selectedPitch?.relSpeed != null ? `${selectedPitch.relSpeed.toFixed(1)} mph` : '--',
                    'var(--text)'],
                  ['Spin',
                    selectedPitch?.spinRate != null ? `${Math.round(selectedPitch.spinRate)} rpm` : '--',
                    'var(--text)'],
                  ['H-Break',
                    selectedPitch?.horzBreak != null ? `${selectedPitch.horzBreak.toFixed(1)}"` : '--',
                    'var(--text)'],
                  ['IVB',
                    selectedPitch?.inducedVertBreak != null ? `${selectedPitch.inducedVertBreak.toFixed(1)}"` : '--',
                    'var(--text)'],
                  ['Extension',
                    selectedPitch?.extension != null ? `${selectedPitch.extension.toFixed(1)} ft` : '--',
                    'var(--text)'],
                  ['Rel Ht',
                    selectedPitch?.relHeight != null ? `${selectedPitch.relHeight.toFixed(1)} ft` : '--',
                    'var(--text)'],
                  ['Rel Side',
                    selectedPitch?.relSide != null ? `${selectedPitch.relSide.toFixed(1)} ft` : '--',
                    'var(--text)'],
                ] as [string, string, string][]).map(([label, val, color]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 7.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace" }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace", color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Coaching notes — beneath Movement + Location plots ── */}
          <div style={{
            margin: '10px 0 0',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em',
                textTransform: 'uppercase', color: 'rgba(126,182,255,0.85)',
              }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: 4,
                  background: '#7eb6ff', boxShadow: '0 0 6px rgba(126,182,255,0.6)',
                }} />
                Pitching Notes
              </span>
              {isCoach && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  {notesSaveOk && <span style={{ color: '#86efac', fontSize: 11 }}>Saved.</span>}
                  {notesSaveError && <span style={{ color: '#fda4af', fontSize: 11 }}>{notesSaveError}</span>}
                  <button
                    type="button"
                    onClick={savePitchingNotes}
                    disabled={savingNotes || !notesDirty}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 7,
                      background: notesDirty
                        ? 'linear-gradient(135deg, rgba(74,222,128,0.30), rgba(74,222,128,0.18))'
                        : 'rgba(255,255,255,0.04)',
                      border: notesDirty
                        ? '1px solid rgba(74,222,128,0.55)'
                        : '1px solid var(--border)',
                      color: notesDirty ? '#ecfdf5' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                      cursor: savingNotes || !notesDirty ? 'not-allowed' : 'pointer',
                      opacity: savingNotes ? 0.6 : 1,
                    }}
                  >
                    {savingNotes ? 'Saving…' : '💾 Save Notes'}
                  </button>
                </div>
              )}
            </div>
            {isCoach ? (
              <textarea
                value={pitchingNotes}
                onChange={(e) => setPitchingNotes(e.target.value)}
                placeholder="Pitching observations — arsenal trends, command, release consistency, sequencing notes…"
                rows={3}
                style={{
                  background: 'rgba(20,24,32,0.85)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '10px 12px',
                  borderRadius: 7,
                  fontSize: 12,
                  lineHeight: 1.55,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  minHeight: 70,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            ) : (
              <div style={{
                fontSize: 12, lineHeight: 1.55,
                color: pitchingNotes ? 'var(--text)' : 'var(--text-muted)',
                fontStyle: pitchingNotes ? 'normal' : 'italic',
                padding: '10px 12px',
                background: 'rgba(20,24,32,0.55)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                minHeight: 50,
              }}>
                {pitchingNotes || 'No notes yet.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Break & Spin + Tilt Table ── */}
      {hasPitchData && (
        <div style={{ marginBottom: 48 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            <BreakTable rows={arsenal} />
            <div style={{ marginTop: 20 }}>
              <ReleaseTable rows={arsenal} />
            </div>
          </div>
        </div>
      )}


      {/* ── No data ── */}
      {!loading && !hasPitchData && (
        <div className={styles.emptyMsg}>
          No Trackman pitching data available.
          <span className={styles.emptyHint}>
            {isCoach ? 'Upload a Trackman CSV or XLSX above.' : 'Ask your coach to upload pitching data.'}
          </span>
        </div>
      )}

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Pitch arsenal observations, command trends, and development plan.', placeholder: true },
              { text: 'Mechanical notes and drill recommendations.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="&#128203;" iconColor="gold" title="Coaching Notes" />
            <NotesBox label="PITCHING ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'PITCHING'
        );
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <SectionHeader icon="&#127916;" iconColor="teal" title="Video" />
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
                    tag="PITCHING"
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

      <CustomCharts section="PITCHING" playerId={player.id} />

    </>
  );
}
