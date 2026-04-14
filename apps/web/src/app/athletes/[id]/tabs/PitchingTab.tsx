'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  SectionHeader, Section,
  NotesBox, VideoPlaceholder, ReportSelector, DownloadPdfButton,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import { TabProps, getReportVideoIds, getReportContentVideos, getReportUploadIds, type ReportSummary } from '../helpers';
import * as api from '@/lib/api';
import type { TrackmanPitch } from '@/lib/api';
import { generatePitchingPdf } from '@/lib/pdf';

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
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', flex: 1, minWidth: 160,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {PITCH_DISPLAY[row.pitchType] || row.pitchType}
      </div>
      {hasData ? (
        <>
          {/* Max Velocity — biggest */}
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'DM Mono', monospace", color, lineHeight: 1 }}>
            {row.maxVelo.toFixed(1)}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>mph max</div>

          {/* Avg Velocity — medium */}
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono', monospace", color, lineHeight: 1, marginTop: 8 }}>
            {row.avgVelo.toFixed(1)}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>mph avg</div>

          {/* Velocity Range — smallest */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: 'var(--text)', lineHeight: 1 }}>
              {row.minVelo.toFixed(1)} – {row.maxVelo.toFixed(1)}
            </div>
            <div style={{ fontSize: 8, color: 'var(--faint)', marginTop: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Velo Range (mph)</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: 'var(--faint)', lineHeight: 1 }}>--</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>No data yet</div>
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

/* ── Interactive Movement Plot (fixed -25 to 25 axes, compact) ── */
function MovementPlot({
  pitches, selected, onSelect,
}: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
}) {
  const width = 340;
  const height = 340;
  const pad = { top: 32, right: 16, bottom: 42, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.horzBreak != null && p.inducedVertBreak != null &&
    typeof p.horzBreak === 'number' && typeof p.inducedVertBreak === 'number'
  );

  if (valid.length === 0) return null;

  const axisMin = -25;
  const axisMax = 25;
  const sx = (v: number) => pad.left + ((v - axisMin) / (axisMax - axisMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - axisMin) / (axisMax - axisMin)) * plotH;
  const ticks = [-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25];

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px', flex: '0 0 auto' }}>
        <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4, textAlign: 'center' }}>
          Movement Plot &mdash; Pitcher&apos;s View
        </div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
          style={{ cursor: 'pointer', display: 'block' }}
          onClick={(e) => {
            const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
            const scaleX = width / rect.width;
            const scaleY = height / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;
            let closest: TrackmanPitch | null = null;
            let minDist = 18;
            for (const p of valid) {
              const px = sx(p.horzBreak as number);
              const py = sy(p.inducedVertBreak as number);
              const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
              if (dist < minDist) { minDist = dist; closest = p; }
            }
            onSelect(closest);
          }}
        >
          {ticks.map((v, i) => (
            <g key={`x${i}`}>
              <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
                stroke={v === 0 ? 'var(--text-muted)' : 'var(--border)'}
                strokeWidth={v === 0 ? 0.8 : 0.5}
                strokeDasharray={v === 0 ? '4 3' : 'none'}
                opacity={v === 0 ? 0.4 : 1}
              />
              {v % 10 === 0 && <text x={sx(v)} y={height - 8} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{v}</text>}
            </g>
          ))}
          {ticks.map((v, i) => (
            <g key={`y${i}`}>
              <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
                stroke={v === 0 ? 'var(--text-muted)' : 'var(--border)'}
                strokeWidth={v === 0 ? 0.8 : 0.5}
                strokeDasharray={v === 0 ? '4 3' : 'none'}
                opacity={v === 0 ? 0.4 : 1}
              />
              {v % 10 === 0 && <text x={pad.left - 6} y={sy(v) + 3} textAnchor="end" fontSize={8} fill="var(--text-muted)">{v}</text>}
            </g>
          ))}
          <text x={pad.left + plotW / 2} y={height - 22} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--text-muted)">
            &#8592; Arm &middot; Glove &#8594;
          </text>
          <text x={10} y={pad.top + plotH / 2} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--text-muted)"
            transform={`rotate(-90, 10, ${pad.top + plotH / 2})`}>Drop &middot; Rise</text>
          {valid.map((p, i) => {
            const isSelected = selected && p.id === selected.id;
            return (
              <circle key={i} cx={sx(p.horzBreak as number)} cy={sy(p.inducedVertBreak as number)}
                r={isSelected ? 6 : 4} fill={getPitchColor(p.pitchType)}
                opacity={selected && !isSelected ? 0.3 : 0.85}
                stroke={isSelected ? '#fff' : 'rgba(0,0,0,0.3)'} strokeWidth={isSelected ? 2 : 0.5}
                style={{ transition: 'opacity 0.15s, r 0.15s' }}
              />
            );
          })}
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="var(--border)" strokeWidth={1} />
          {(() => {
            const types = [...new Set(valid.map(p => p.pitchType))];
            return types.map((t, i) => (
              <g key={t} transform={`translate(${pad.left + plotW - types.length * 58 + i * 58}, ${pad.top - 16})`}>
                <circle cx={0} cy={0} r={3.5} fill={getPitchColor(t)} />
                <text x={7} y={3} fontSize={9} fontWeight={600} fill="var(--text-muted)">{PITCH_SHORT[t] || t}</text>
              </g>
            ));
          })()}
        </svg>
      </div>
      <div style={{
        flex: 1, minWidth: 140,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        <PitchDetailPanel selected={selected} compact />
      </div>
    </div>
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
  const width = 340;
  const height = 340;
  const pad = { top: 32, right: 16, bottom: 42, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.plateLocSide != null && p.plateLocHeight != null &&
    typeof p.plateLocSide === 'number' && typeof p.plateLocHeight === 'number'
  );

  if (valid.length === 0) return null;

  const xMin = -2.5, xMax = 2.5, yMin = 0, yMax = 5;
  const sx = (v: number) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const xTicks = [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5];
  const yTicks = [0, 1, 2, 3, 4, 5];

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
  const types = [...new Set(valid.map(p => p.pitchType))];

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px', flex: '0 0 auto' }}>
        <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4, textAlign: 'center' }}>
          Pitch Location &mdash; Catcher&apos;s View
        </div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
          style={{ cursor: 'pointer', display: 'block' }}
          onClick={(e) => {
            const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
            const scaleX = width / rect.width;
            const scaleY = height / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;
            let closest: TrackmanPitch | null = null;
            let minDist = 18;
            for (const p of valid) {
              if (p.plateLocSide == null || p.plateLocHeight == null) continue;
              const px = sx(p.plateLocSide);
              const py = sy(p.plateLocHeight);
              const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
              if (dist < minDist) { minDist = dist; closest = p; }
            }
            onSelect(closest);
          }}
        >
          {xTicks.map((v, i) => (
            <g key={`x${i}`}>
              <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH} stroke="var(--border)" strokeWidth={0.5} />
              {Number.isInteger(v) && <text x={sx(v)} y={height - 8} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{v}</text>}
            </g>
          ))}
          {yTicks.map((v, i) => (
            <g key={`y${i}`}>
              <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)} stroke="var(--border)" strokeWidth={0.5} />
              <text x={pad.left - 6} y={sy(v) + 3} textAnchor="end" fontSize={8} fill="var(--text-muted)">{v}</text>
            </g>
          ))}

          {/* Strike zone */}
          <rect x={sx(szLeft)} y={sy(szTop)} width={sx(szRight) - sx(szLeft)} height={sy(szBot) - sy(szTop)}
            fill="none" stroke="var(--text-muted)" strokeWidth={1.5} opacity={0.5} />
          <line x1={sx(szLeft + szW / 3)} y1={sy(szTop)} x2={sx(szLeft + szW / 3)} y2={sy(szBot)} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          <line x1={sx(szLeft + 2 * szW / 3)} y1={sy(szTop)} x2={sx(szLeft + 2 * szW / 3)} y2={sy(szBot)} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          <line x1={sx(szLeft)} y1={sy(szTop - szH / 3)} x2={sx(szRight)} y2={sy(szTop - szH / 3)} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          <line x1={sx(szLeft)} y1={sy(szTop - 2 * szH / 3)} x2={sx(szRight)} y2={sy(szTop - 2 * szH / 3)} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          {zones.map(z => (
            <text key={z.n} x={sx(z.x + szW / 6)} y={sy(z.y + szH / 6) + 4}
              textAnchor="middle" fontSize={10} fontWeight={500} fill="var(--text-muted)" opacity={0.25}>
              {z.n}
            </text>
          ))}
          <polygon
            points={`${sx(-0.71)},${sy(0.3)} ${sx(0.71)},${sy(0.3)} ${sx(0.71)},${sy(0.15)} ${sx(0)},${sy(0)} ${sx(-0.71)},${sy(0.15)}`}
            fill="var(--text-muted)" opacity={0.12} />

          {/* Data points */}
          {valid.map((p, i) => {
            const isSelected = selected && p.id === selected.id;
            return (
              <circle key={i} cx={sx(p.plateLocSide as number)} cy={sy(p.plateLocHeight as number)}
                r={isSelected ? 6 : 4} fill={getPitchColor(p.pitchType)}
                opacity={selected && !isSelected ? 0.3 : 0.85}
                stroke={isSelected ? '#fff' : 'rgba(0,0,0,0.3)'} strokeWidth={isSelected ? 2 : 0.5}
                style={{ transition: 'opacity 0.15s, r 0.15s' }}
              />
            );
          })}

          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="var(--border)" strokeWidth={1} />
          {types.map((t, i) => (
            <g key={t} transform={`translate(${pad.left + plotW - types.length * 58 + i * 58}, ${pad.top - 16})`}>
              <circle cx={0} cy={0} r={3.5} fill={getPitchColor(t)} />
              <text x={7} y={3} fontSize={9} fontWeight={600} fill="var(--text-muted)">{PITCH_SHORT[t] || t}</text>
            </g>
          ))}
        </svg>
      </div>
      <div style={{
        flex: 1, minWidth: 140,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        <PitchDetailPanel selected={selected} compact />
      </div>
    </div>
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
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos,
}: TabProps) {
  const [pitches, setPitches] = useState<TrackmanPitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPitch, setSelectedPitch] = useState<TrackmanPitch | null>(null);
  const [selectedLocPitch, setSelectedLocPitch] = useState<TrackmanPitch | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

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
      {/* ── Report Selector + Download ── */}
      <div className={aStyles.reportSelectorRow}>
        <ReportSelector
          reports={reports}
          reportTypes={['PITCHING']}
          label="Pitching"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
        <DownloadPdfButton
          label="Download PDF"
          onDownload={() => generatePitchingPdf(player, reports)}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
          Loading pitch data...
        </div>
      )}

      {/* ── Pitch Arsenal Summary ── */}
      {!loading && (
        <Section>
          <SectionHeader icon="&#9889;" iconColor="teal" title="Pitch Arsenal Summary" subtitle={hasPitchData ? `${pitches.length} Pitches` : ''} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {arsenalCards.map((row, i) => (
              <ArsenalCard key={row.pitchType} row={row} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Break & Spin + Tilt Table (tight to arsenal) ── */}
      {hasPitchData && (
        <div style={{ marginTop: -38, marginBottom: 48 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            <BreakTable rows={arsenal} />
            <div style={{ marginTop: 20 }}>
              <ReleaseTable rows={arsenal} />
            </div>
          </div>
        </div>
      )}

      {/* ── Movement Plot + Pitch Location (side by side) ── */}
      {hasPitchData && (
        <Section>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <SectionHeader icon="&#127744;" iconColor="teal" title="Movement Plot" />
              <MovementPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} />
            </div>
            <div>
              <SectionHeader icon="&#127919;" iconColor="red" title="Pitch Location" />
              <PitchLocationPlot pitches={pitches} selected={selectedLocPitch} onSelect={setSelectedLocPitch} />
            </div>
          </div>
        </Section>
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

    </>
  );
}
