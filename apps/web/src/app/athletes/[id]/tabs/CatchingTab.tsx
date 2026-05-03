'use client';

import { useState, useMemo } from 'react';
import {
  SectionHeader, Section, NotesBox, VideoPlaceholder, ReportSelector, TabBarActions,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, getReportVideoIds, getReportContentVideos, type ReportSummary,
} from '../helpers';
import { CustomCharts } from '@/components/CustomCharts';

/* ── Types ── */

interface ThrowingMetric {
  attempts: (number | null)[];
  best: number | null;
  avg: number | null;
  notes: string;
}

interface GradeItem {
  grade: number | null;
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
    /* Positional blocking grades — used by the Catching Snapshot field
       diagram. Falls back to existing fields if not captured yet. */
    blockLeft?: GradeItem;
    blockCenter?: GradeItem;
    blockRight?: GradeItem;
  };
  /* Optional border-zone grades (16 outer cells around the strike zone).
     If not provided, border zones render neutral. */
  borderZoneColors?: (0 | 1 | 2)[];
}

/* ── Constants ── */

const REPORT_TYPES = ['CATCHING'];
const MONO = "'DM Mono', monospace";

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

/* ── Helpers ── */

/* Color bands on the 20-80 scouting scale:
     20-40 → red
     40-60 → yellow
     60-80 → green
*/
function gradeColor(grade: number | null): string {
  if (grade === null) return 'var(--faint)';
  if (grade >= 60) return '#22C55E'; // green  (60–80, good)
  if (grade >= 40) return '#EAB308'; // yellow (40–60, average)
  return '#EF4444';                   // red    (20–40, bad)
}

function gradeBg(grade: number | null): string {
  if (grade === null) return 'transparent';
  if (grade >= 60) return 'rgba(34,197,94,0.10)';   // green
  if (grade >= 40) return 'rgba(234,179,8,0.10)';   // yellow
  return 'rgba(239,68,68,0.12)';                     // red
}

/* Map a 20-80 scouting score to a 0-100% bar fill. */
function gradePct(grade: number | null): number {
  if (grade === null) return 0;
  return Math.max(0, Math.min(((grade - 20) / 60) * 100, 100));
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

/* ── Zone color helpers ── */
const ZONE_FILLS = ['#F87171', '#ffffff', '#4ADE80'] as const; // 0=red, 1=white, 2=green
const ZONE_LABELS = ['Bad', 'Average', 'Good'] as const;

/* ── Sub-components ── */

function ThrowingMetricCard({ metric, label, unit, mlbRef }: {
  metric: ThrowingMetric; label: string; unit: string; mlbRef: string;
}) {
  const hasBest = metric.best !== null;
  const hasAvg = metric.avg !== null;
  const attempts = metric.attempts || [];

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '18px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-bright)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 800, fontFamily: MONO, color: hasBest ? '#4ADE80' : 'var(--faint)', lineHeight: 1 }}>
          {hasBest ? metric.best!.toFixed(2) : '\u2014'}
        </span>
        {hasBest && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{unit} best</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>
        {hasAvg ? (<>Avg: <span style={{ fontWeight: 700, color: 'var(--accent-light)' }}>{metric.avg!.toFixed(2)}</span> {unit}</>) : 'Avg: \u2014'}
      </div>
      {attempts.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
          {attempts.map((val, i) => (
            <span key={i} title={val !== null ? `#${i + 1}: ${val.toFixed(2)} ${unit}` : `#${i + 1}: no data`}
              style={{
                width: 22, height: 22, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, fontFamily: MONO,
                background: val !== null ? 'rgba(74,222,128,0.12)' : 'var(--faint)',
                color: val !== null ? '#4ADE80' : 'var(--border)',
                border: val !== null ? '1px solid rgba(74,222,128,0.25)' : '1px solid var(--border)',
              }}>
              {val !== null ? (i + 1) : '\u00b7'}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--faint)', fontStyle: 'italic', marginTop: 2 }}>{mlbRef}</div>
      {metric.notes && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2, lineHeight: 1.4 }}>
          {metric.notes}
        </div>
      )}
    </div>
  );
}

/* ── Interactive 9-Zone Strike Zone ── */
function ReceivingZone({ zoneColors, onToggle }: {
  zoneColors: (0 | 1 | 2)[];
  onToggle: (idx: number) => void;
}) {
  const W = 300;
  const H = 320;
  const szLeft = 60, szTop = 40, szW = 180, szH = 240;
  const cellW = szW / 3;
  const cellH = szH / 3;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', cursor: 'pointer' }}>
      {/* Background */}
      <rect width={W} height={H} fill="transparent" />

      {/* 9 zones */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const x = szLeft + col * cellW;
        const y = szTop + row * cellH;
        const colorIdx = zoneColors[i] ?? 1;
        const fill = ZONE_FILLS[colorIdx];
        const opacity = colorIdx === 1 ? 0.15 : 0.35;
        return (
          <g key={i} onClick={(e) => { e.stopPropagation(); onToggle(i); }}>
            <rect x={x} y={y} width={cellW} height={cellH}
              fill={fill} opacity={opacity}
              stroke="var(--text-muted)" strokeWidth={0.5}
              style={{ cursor: 'pointer' }}
            />
            <text x={x + cellW / 2} y={y + cellH / 2 - 6}
              textAnchor="middle" fontSize={14} fontWeight={700}
              fill={fill} opacity={0.9}>
              {i + 1}
            </text>
            <text x={x + cellW / 2} y={y + cellH / 2 + 10}
              textAnchor="middle" fontSize={8} fontWeight={600}
              fill={fill} opacity={0.7}
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {ZONE_LABELS[colorIdx]}
            </text>
          </g>
        );
      })}

      {/* Strike zone border */}
      <rect x={szLeft} y={szTop} width={szW} height={szH}
        fill="none" stroke="var(--text-muted)" strokeWidth={2} opacity={0.6} />

      {/* Home plate */}
      <polygon
        points={`${W / 2 - 20},${szTop + szH + 16} ${W / 2 + 20},${szTop + szH + 16} ${W / 2 + 20},${szTop + szH + 22} ${W / 2},${szTop + szH + 32} ${W / 2 - 20},${szTop + szH + 22}`}
        fill="var(--text-muted)" opacity={0.2} stroke="var(--text-muted)" strokeWidth={1} />

      {/* Legend */}
      <g transform={`translate(${szLeft}, ${H - 10})`}>
        <circle cx={0} cy={0} r={4} fill="#4ADE80" opacity={0.6} />
        <text x={8} y={3} fontSize={8} fill="var(--text-muted)" fontWeight={500}>Good</text>
        <circle cx={50} cy={0} r={4} fill="#ffffff" opacity={0.4} />
        <text x={58} y={3} fontSize={8} fill="var(--text-muted)" fontWeight={500}>Avg</text>
        <circle cx={90} cy={0} r={4} fill="#F87171" opacity={0.6} />
        <text x={98} y={3} fontSize={8} fill="var(--text-muted)" fontWeight={500}>Bad</text>
      </g>
    </svg>
  );
}

/* ── Blocking Range Visual ── */
function BlockingRangeVisual({ rangeFeet }: { rangeFeet: number | null }) {
  const W = 500;
  const H = 220;
  const plateY = 170;
  const plateX = W / 2;
  const catcherY = plateY - 25;

  // Scale: 1 foot = ~30px
  const scale = 30;
  const rangeR = rangeFeet ? rangeFeet * scale / 2 : 0;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto' }}>
      {/* Batter's box left */}
      <rect x={plateX - 95} y={plateY - 55} width={50} height={70}
        fill="none" stroke="var(--text-muted)" strokeWidth={1} opacity={0.3} strokeDasharray="4 2" />
      <text x={plateX - 70} y={plateY - 60} textAnchor="middle" fontSize={8} fill="var(--faint)" fontWeight={500}>LHH</text>

      {/* Batter's box right */}
      <rect x={plateX + 45} y={plateY - 55} width={50} height={70}
        fill="none" stroke="var(--text-muted)" strokeWidth={1} opacity={0.3} strokeDasharray="4 2" />
      <text x={plateX + 70} y={plateY - 60} textAnchor="middle" fontSize={8} fill="var(--faint)" fontWeight={500}>RHH</text>

      {/* Home plate */}
      <polygon
        points={`${plateX - 14},${plateY} ${plateX + 14},${plateY} ${plateX + 14},${plateY + 5} ${plateX},${plateY + 12} ${plateX - 14},${plateY + 5}`}
        fill="var(--text-muted)" opacity={0.25} stroke="var(--text-muted)" strokeWidth={1.5} />
      <text x={plateX} y={plateY + 26} textAnchor="middle" fontSize={8} fill="var(--faint)" fontWeight={600}
        style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>HOME</text>

      {/* Blocking range arc */}
      {rangeFeet && rangeFeet > 0 && (
        <>
          <path
            d={`M ${plateX - rangeR} ${catcherY} A ${rangeR} ${rangeR * 0.4} 0 0 1 ${plateX + rangeR} ${catcherY}`}
            fill="rgba(74,222,128,0.08)" stroke="#4ADE80" strokeWidth={1.5} opacity={0.6}
          />
          {/* Range labels */}
          <line x1={plateX - rangeR} y1={catcherY - 8} x2={plateX - rangeR} y2={catcherY + 8}
            stroke="#4ADE80" strokeWidth={1} opacity={0.5} />
          <line x1={plateX + rangeR} y1={catcherY - 8} x2={plateX + rangeR} y2={catcherY + 8}
            stroke="#4ADE80" strokeWidth={1} opacity={0.5} />
          <text x={plateX - rangeR - 4} y={catcherY - 12} textAnchor="end" fontSize={9} fill="#4ADE80" fontWeight={600}>
            -{(rangeFeet / 2).toFixed(1)} ft
          </text>
          <text x={plateX + rangeR + 4} y={catcherY - 12} textAnchor="start" fontSize={9} fill="#4ADE80" fontWeight={600}>
            +{(rangeFeet / 2).toFixed(1)} ft
          </text>
          {/* Total label */}
          <text x={plateX} y={catcherY - rangeR * 0.4 - 10} textAnchor="middle" fontSize={11} fill="#4ADE80" fontWeight={700}>
            {rangeFeet.toFixed(1)} ft total range
          </text>
        </>
      )}

      {/* Catcher icon */}
      <circle cx={plateX} cy={catcherY} r={12} fill="var(--surface)" stroke="var(--text-muted)" strokeWidth={1.5} />
      <text x={plateX} y={catcherY + 4} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontWeight={700}>C</text>

      {/* No data state */}
      {(!rangeFeet || rangeFeet === 0) && (
        <text x={plateX} y={60} textAnchor="middle" fontSize={11} fill="var(--faint)">
          Blocking range not measured
        </text>
      )}
    </svg>
  );
}

/* ── Receiving Score Card ── */
function ReceivingScoreRow({ label, item }: { label: string; item: GradeItem | undefined }) {
  const grade = item?.grade ?? null;
  const pct = gradePct(grade);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 44px 1fr', alignItems: 'center',
      gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: MONO, color: gradeColor(grade), textAlign: 'center' }}>
        {grade !== null ? grade : '\u2014'}
      </span>
      <div style={{ height: 7, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
        {grade !== null && (
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, borderRadius: 4,
            background: `linear-gradient(90deg, ${gradeColor(grade)}88, ${gradeColor(grade)})`,
            transition: 'width 0.5s ease',
          }} />
        )}
      </div>
    </div>
  );
}

/* ── Blocking Score Card ── */
function BlockingScoreRow({ label, item }: { label: string; item: GradeItem | undefined }) {
  const grade = item?.grade ?? null;
  const pct = gradePct(grade);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '160px 44px 1fr', alignItems: 'center',
      gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: MONO, color: gradeColor(grade), textAlign: 'center' }}>
        {grade !== null ? grade : '\u2014'}
      </span>
      <div style={{ height: 7, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
        {grade !== null && (
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, borderRadius: 4,
            background: `linear-gradient(90deg, ${gradeColor(grade)}88, ${gradeColor(grade)})`,
            transition: 'width 0.5s ease',
          }} />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN TAB
   ═══════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   NEW: Strike-Zone Heat Map (5×5 with inner 3×3 strike zone).
   The inner 9 cells are populated from the report's zoneColors;
   the outer 16 border cells use borderZoneColors if present, else
   default to neutral. The strike-zone box is outlined prominently.
   ════════════════════════════════════════════════════════════════ */
function StrikeZoneHeatMap5x5({
  zoneColors, borderZoneColors,
}: {
  zoneColors: (0 | 1 | 2)[];
  borderZoneColors?: (0 | 1 | 2)[];
}) {
  const W = 280, H = 320;
  const cellW = 50, cellH = 56;
  const gridW = cellW * 5, gridH = cellH * 5;
  const ox = (W - gridW) / 2; // 15
  const oy = (H - gridH) / 2; // 20

  const ZONE_FILLS_LOCAL: Record<number, string> = { 0: '#F87171', 1: 'rgba(255,255,255,0.18)', 2: '#4ADE80' };

  // Compute fill for each of the 25 cells
  const cellAt = (row: number, col: number): 0 | 1 | 2 => {
    const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
    if (isStrike) {
      const inner = (row - 1) * 3 + (col - 1);
      return (zoneColors[inner] ?? 1) as 0 | 1 | 2;
    }
    if (!borderZoneColors) return 1;
    // Outer cells indexed left-to-right, top-to-bottom
    let idx = -1;
    if (row === 0) idx = col;                     // 0..4
    else if (row === 4) idx = 5 + col;            // 5..9
    else if (col === 0) idx = 10 + (row - 1);     // 10..12
    else if (col === 4) idx = 13 + (row - 1);     // 13..15
    return (borderZoneColors[idx] ?? 1) as 0 | 1 | 2;
  };

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = ox + c * cellW, y = oy + r * cellH;
      const v = cellAt(r, c);
      const isStrike = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x} y={y} width={cellW} height={cellH}
          fill={ZONE_FILLS_LOCAL[v]}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={isStrike ? 0.7 : 0.5}
          rx={2}
          opacity={isStrike ? 0.95 : 0.55}
        />,
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 360, margin: '0 auto' }}>
      {/* Backdrop — was near-black; re-toned to a softer graphite so it
          reads as part of the neutral profile palette. */}
      <rect x={0} y={0} width={W} height={H} fill="rgba(110,118,125,0.10)" rx={4} />

      {/* All 25 cells */}
      {cells}

      {/* Bold strike-zone outline around inner 3×3 */}
      <rect
        x={ox + cellW * 1} y={oy + cellH * 1}
        width={cellW * 3} height={cellH * 3}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2}
        rx={2}
      />

      {/* Border-zone label hints (top-left + top-right corner ticks) */}
      <text x={ox + 5} y={oy + 12}
            fontSize={8} fontFamily="'DM Mono', monospace" fontWeight={700}
            fill="rgba(255,255,255,0.40)" letterSpacing="0.18em">BORDER</text>
      <text x={ox + gridW - 5} y={oy + 12} textAnchor="end"
            fontSize={8} fontFamily="'DM Mono', monospace" fontWeight={700}
            fill="rgba(255,255,255,0.40)" letterSpacing="0.18em">ZONES</text>

      {/* Strike-zone label inside outline (top center) */}
      <text x={W / 2} y={oy + cellH + 14} textAnchor="middle"
            fontSize={9} fontFamily="'DM Mono', monospace" fontWeight={700}
            fill="rgba(255,255,255,0.70)" letterSpacing="0.22em">STRIKE ZONE</text>

      {/* Legend at bottom */}
      <g transform={`translate(${ox}, ${H - 8})`}>
        {[
          { v: 2, label: 'Receives well' },
          { v: 1, label: 'Average' },
          { v: 0, label: 'Struggles' },
        ].map((item, i) => (
          <g key={item.v} transform={`translate(${i * 90}, -10)`}>
            <rect width={10} height={10} rx={2} fill={ZONE_FILLS_LOCAL[item.v]} stroke="rgba(255,255,255,0.18)" />
            <text x={14} y={9} fontSize={10} fill="rgba(255,255,255,0.65)" fontFamily="inherit">{item.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════
   NEW: Catching Field Diagram — bird's-eye baseball field with
   throwing line stats stacked between 2B and home, plus three
   blocking-grade chips (with directional arrows) below home.
   ════════════════════════════════════════════════════════════════ */
function CatchingFieldDiagram({
  popTime, exchange, velocity,
  leftGrade, centerGrade, rightGrade,
}: {
  popTime: number | null;
  exchange: number | null;
  velocity: number | null;
  leftGrade: number | null;
  centerGrade: number | null;
  rightGrade: number | null;
}) {
  // Symmetric geometry constants (mirrors the reimagined diamond)
  const CX = 180, CENTER_Y = 230, HALF = 128;
  const HOME_Y = CENTER_Y + HALF;        // 358
  const TWOB_Y = CENTER_Y - HALF;        // 102
  const ONEB_X = CX + HALF;              // 308
  const THREEB_X = CX - HALF;            // 52
  const HOME_TIP_Y = HOME_Y + 6;         // 364
  const FOUL_LEN = 156;
  const FOUL_END_Y = HOME_TIP_Y - FOUL_LEN; // 208
  const FOUL_LEFT_X = CX - FOUL_LEN;     // 24
  const FOUL_RIGHT_X = CX + FOUL_LEN;    // 336
  const ARC_R = 230;

  const tone = (g: number | null) => {
    if (g === null) return { stroke: 'rgba(255,255,255,0.18)', fill: 'rgba(255,255,255,0.04)', text: 'rgba(255,255,255,0.40)' };
    if (g >= 60)    return { stroke: '#22C55E', fill: 'rgba(34,197,94,0.16)',   text: '#22C55E' };
    if (g >= 40)    return { stroke: 'rgba(255,255,255,0.65)', fill: 'rgba(255,255,255,0.10)', text: '#F1F5F9' };
    return                  { stroke: '#60A5FA', fill: 'rgba(96,165,250,0.16)', text: '#60A5FA' };
  };
  const L = tone(leftGrade), M = tone(centerGrade), R = tone(rightGrade);

  /* Block annotation chip with a directional arrow.
     dir: -1 = arrow points left, 0 = arrow points down, +1 = arrow points right. */
  const BlockChip = ({ x, label, grade, dir, t }: {
    x: number; label: string; grade: number | null; dir: -1 | 0 | 1;
    t: ReturnType<typeof tone>;
  }) => {
    // Arrow path inside the chip
    const arrow = dir === -1 ? '◀' : dir === 1 ? '▶' : '▼';
    return (
      <g transform={`translate(${x}, 408)`}>
        <rect x="-30" y="-22" width="60" height="44" rx="8"
          fill={t.fill} stroke={t.stroke} strokeWidth="1.3" />
        <text x="0" y="-10" textAnchor="middle"
          fontSize="9" fontFamily="'Satoshi', sans-serif" fontWeight="600"
          fill="rgba(255,255,255,0.65)" letterSpacing="0.04em">{label}</text>
        <text x="0" y="9" textAnchor="middle"
          fontSize="16" fontFamily="'Syne', sans-serif" fontWeight="800"
          fill={t.text} fontVariantNumeric="tabular-nums">
          {grade !== null ? grade : '—'}
        </text>
        <text x="0" y="20" textAnchor="middle"
          fontSize="10"
          fill={t.stroke}>{arrow}</text>
      </g>
    );
  };

  /* Stat callout chip on the throwing line between 2B and home */
  const StatChip = ({ y, label, value, unit }: {
    y: number; label: string; value: number | null; unit: string;
  }) => (
    <g transform={`translate(${CX}, ${y})`}>
      <rect x="-58" y="-16" width="116" height="32" rx="6"
        fill="rgba(20,24,32,0.92)"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1" />
      <text x="-50" y="-3" textAnchor="start"
        fontSize="8.5" fontFamily="'DM Mono', monospace" fontWeight="700"
        fill="rgba(255,255,255,0.55)" letterSpacing="0.18em">{label}</text>
      <text x="-50" y="11" textAnchor="start"
        fontSize="13" fontFamily="'Syne', sans-serif" fontWeight="800"
        fill="#F1F5F9" fontVariantNumeric="tabular-nums">
        {value !== null ? (unit === 'mph' ? value.toFixed(0) : value.toFixed(2)) : '—'}
        <tspan fontSize="9" fontFamily="'DM Mono', monospace" fontWeight="600"
               fill="rgba(255,255,255,0.55)" letterSpacing="0.12em"
               dx="4">{unit}</tspan>
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 360 480" preserveAspectRatio="xMidYMid meet"
         style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 720, margin: '0 auto', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.55))' }}>
      {/* Outfield grass — symmetric fan from home */}
      <path
        d={`M ${CX} ${HOME_TIP_Y} L ${FOUL_LEFT_X} ${FOUL_END_Y} A ${ARC_R} ${ARC_R} 0 0 1 ${FOUL_RIGHT_X} ${FOUL_END_Y} Z`}
        fill="rgba(74,222,128,0.04)"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1"
      />
      {/* Outfield warning track */}
      <path
        d={`M ${FOUL_LEFT_X} ${FOUL_END_Y} A ${ARC_R} ${ARC_R} 0 0 1 ${FOUL_RIGHT_X} ${FOUL_END_Y}`}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="1"
        strokeDasharray="3 5"
      />

      {/* Infield diamond — perfect rotated square */}
      <polygon
        points={`${CX},${TWOB_Y} ${ONEB_X},${CENTER_Y} ${CX},${HOME_Y} ${THREEB_X},${CENTER_Y}`}
        fill="rgba(212,175,52,0.05)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.2"
      />

      {/* Throwing path — dashed line from home to 2B */}
      <line
        x1={CX} y1={HOME_Y - 2} x2={CX} y2={TWOB_Y + 2}
        stroke="rgba(255,255,255,0.45)" strokeWidth="1.5"
        strokeDasharray="7 5"
      />
      {/* Arrow pointing toward 2B */}
      <polygon
        points={`${CX - 5},${TWOB_Y + 6} ${CX + 5},${TWOB_Y + 6} ${CX},${TWOB_Y - 1}`}
        fill="rgba(255,255,255,0.65)"
      />

      {/* Pitcher's mound — small dot in dead center */}
      <circle cx={CX} cy={CENTER_Y} r="6" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.8" />

      {/* Bases */}
      <rect x={CX - 6}     y={TWOB_Y - 6}    width="12" height="12"
        transform={`rotate(45 ${CX} ${TWOB_Y})`}
        fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.7" />
      <rect x={ONEB_X - 6} y={CENTER_Y - 6}  width="12" height="12"
        transform={`rotate(45 ${ONEB_X} ${CENTER_Y})`}
        fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.7" />
      <rect x={THREEB_X - 6} y={CENTER_Y - 6} width="12" height="12"
        transform={`rotate(45 ${THREEB_X} ${CENTER_Y})`}
        fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.7" />

      {/* Base labels */}
      <text x={CX} y={TWOB_Y - 14} textAnchor="middle" fontSize="10" fontFamily="'DM Mono', monospace" fontWeight="700"
            fill="rgba(255,255,255,0.55)" letterSpacing="0.18em">2B</text>
      <text x={ONEB_X + 16} y={CENTER_Y + 4} textAnchor="start" fontSize="10" fontFamily="'DM Mono', monospace" fontWeight="700"
            fill="rgba(255,255,255,0.45)" letterSpacing="0.18em">1B</text>
      <text x={THREEB_X - 16} y={CENTER_Y + 4} textAnchor="end" fontSize="10" fontFamily="'DM Mono', monospace" fontWeight="700"
            fill="rgba(255,255,255,0.45)" letterSpacing="0.18em">3B</text>

      {/* THROWING-LINE STAT CHIPS — between 2B and home, vertically stacked */}
      <StatChip y={140} label="POP TIME" value={popTime}  unit="s" />
      <StatChip y={205} label="VELOCITY" value={velocity} unit="mph" />
      <StatChip y={310} label="EXCHANGE" value={exchange} unit="s" />

      {/* Home plate */}
      <polygon
        points={`${CX - 14},${HOME_Y - 8} ${CX + 14},${HOME_Y - 8} ${CX + 14},${HOME_Y + 4} ${CX},${HOME_TIP_Y} ${CX - 14},${HOME_Y + 4}`}
        fill="rgba(255,255,255,0.92)"
        stroke="rgba(255,255,255,0.50)"
        strokeWidth="1"
      />

      {/* Catcher's blocking arc — connects the 3 zone annotations */}
      <path
        d={`M ${CX - 78} 408 Q ${CX} 432 ${CX + 78} 408`}
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1"
        strokeDasharray="2 4"
      />

      {/* THREE BLOCKING ANNOTATIONS WITH DIRECTIONAL ARROWS */}
      <BlockChip x={CX - 78} label="Blocks Left"   grade={leftGrade}   dir={-1} t={L} />
      <BlockChip x={CX}      label="Blocks Center" grade={centerGrade} dir={0}  t={M} />
      <BlockChip x={CX + 78} label="Blocks Right"  grade={rightGrade}  dir={1}  t={R} />

      {/* Footer caption */}
      <text x={CX} y="468" textAnchor="middle" fontSize="11" fontFamily="'Satoshi', sans-serif" fontWeight="600"
            fill="rgba(255,255,255,0.40)" fontStyle="italic">Blocking coverage behind home plate</text>
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════
   NEW: Underlying-stats row — one row per phase (Throwing /
   Receiving / Blocking). Each row shows label + N inline stat
   cells (label, value, optional badge).
   ════════════════════════════════════════════════════════════════ */
type StatCell =
  | { kind: 'metric'; label: string; value: number | null; unit: string; decimals?: number }
  | { kind: 'grade'; label: string; grade: number | null };

function StatsRow({ title, icon, cells }: { title: string; icon: string; cells: StatCell[] }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '14px 18px', marginBottom: 10,
      display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, alignItems: 'center',
    }}>
      {/* Row title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.18em', color: 'var(--text-muted)',
          }}>Phase</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        </div>
      </div>

      {/* Stat cells — wraps responsively */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {cells.map((c, i) => {
          if (c.kind === 'metric') {
            const has = c.value !== null && c.value !== undefined;
            const decimals = c.decimals ?? (c.unit === 'mph' ? 0 : 2);
            return (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', minHeight: 60,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.14em', color: 'var(--text-muted)',
                }}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
                    color: has ? 'var(--text)' : 'var(--faint)',
                    letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {has ? c.value!.toFixed(decimals) : '—'}
                  </span>
                  <span style={{
                    fontFamily: MONO, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    letterSpacing: '0.10em',
                  }}>{c.unit}</span>
                </span>
              </div>
            );
          } else {
            const grade = c.grade;
            const valueColor = gradeColor(grade);
            const ratingLabel = grade !== null ? gradeLabel(grade) : 'Not graded';
            return (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', minHeight: 60,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.14em', color: 'var(--text-muted)',
                }}>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800,
                    color: valueColor, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums',
                  }}>{grade !== null ? grade : '—'}</span>
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

export function CatchingTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos, onNewReport,
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
      {/* ── Report Selector (portaled into TabBar) ── */}
      <TabBarActions>
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Catching"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
        />
      </TabBarActions>

      {!catchingAssessment ? (
        /* ── Empty State ── */
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
          {/* ═══ SECTION 1: SNAPSHOT — heat map (left) + field (right) ═══ */}
          {(() => {
            const t = catchingAssessment.throwing;
            const b = catchingAssessment.blocking;
            const popBest = t.popTime2B?.best ?? null;
            const exchangeBest = t.exchangeTime?.best ?? null;
            const veloBest = t.velocity?.best ?? null;
            // Prefer dedicated positional grades; fall back to existing fields as proxies
            const leftGrade   = b.blockLeft?.grade   ?? b.gloveBodyAngle?.grade ?? null;
            const centerGrade = b.blockCenter?.grade ?? b.accuracy?.grade       ?? null;
            const rightGrade  = b.blockRight?.grade  ?? b.recoverySpeed?.grade  ?? null;

            return (
              <Section>
                <SectionHeader icon="🧤" iconColor="teal" title="Catching Snapshot"
                  subtitle="Where this catcher receives the ball, and what happens when they throw or block."
                />
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(280px, 0.85fr) minmax(0, 1.4fr)',
                  gap: 28,
                  alignItems: 'center',
                }}>
                  {/* LEFT — 5×5 strike-zone heat map */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                      gap: 10, paddingBottom: 4,
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        Receiving Heat Map
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Strike zone &amp; borders
                      </span>
                    </div>
                    <StrikeZoneHeatMap5x5
                      zoneColors={zoneColors as (0 | 1 | 2)[]}
                      borderZoneColors={catchingAssessment.borderZoneColors}
                    />
                  </div>

                  {/* RIGHT — field with throwing-line stats and blocking chips */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                      gap: 10, paddingBottom: 4,
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        Throwing &amp; Blocking
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Home plate to second base
                      </span>
                    </div>
                    <CatchingFieldDiagram
                      popTime={popBest}
                      exchange={exchangeBest}
                      velocity={veloBest}
                      leftGrade={leftGrade}
                      centerGrade={centerGrade}
                      rightGrade={rightGrade}
                    />
                  </div>
                </div>
              </Section>
            );
          })()}

          {/* ═══ SECTION 2: UNDERLYING STATS — 3 rows (Throwing / Receiving / Blocking) ═══ */}
          <Section>
            <SectionHeader icon="📊" iconColor="gold" title="Underlying Stats"
              subtitle="The full breakdown that drives the snapshot above."
            />
            <StatsRow
              title="Throwing"
              icon="🎯"
              cells={[
                { kind: 'metric', label: 'Pop Time 2B', value: catchingAssessment.throwing.popTime2B?.best   ?? null, unit: 's',   decimals: 2 },
                { kind: 'metric', label: 'Pop Time 3B', value: catchingAssessment.throwing.popTime3B?.best   ?? null, unit: 's',   decimals: 2 },
                { kind: 'metric', label: 'Exchange',    value: catchingAssessment.throwing.exchangeTime?.best ?? null, unit: 's',  decimals: 2 },
                { kind: 'metric', label: 'Velocity',    value: catchingAssessment.throwing.velocity?.best     ?? null, unit: 'mph', decimals: 0 },
              ]}
            />
            <StatsRow
              title="Receiving"
              icon="🧤"
              cells={[
                { kind: 'grade', label: 'Path',         grade: catchingAssessment.receiving.path?.grade         ?? null },
                { kind: 'grade', label: 'Accuracy',     grade: catchingAssessment.receiving.accuracy?.grade     ?? null },
                { kind: 'grade', label: 'Speed',        grade: catchingAssessment.receiving.speed?.grade        ?? null },
                { kind: 'grade', label: 'Presentation', grade: catchingAssessment.receiving.presentation?.grade ?? null },
              ]}
            />
            <StatsRow
              title="Blocking"
              icon="🛡️"
              cells={[
                { kind: 'grade', label: 'Range',          grade: catchingAssessment.blocking.range?.grade          ?? null },
                { kind: 'grade', label: 'Accuracy',       grade: catchingAssessment.blocking.accuracy?.grade       ?? null },
                { kind: 'grade', label: 'Body & Glove',   grade: catchingAssessment.blocking.gloveBodyAngle?.grade ?? null },
                { kind: 'grade', label: 'Recovery Speed', grade: catchingAssessment.blocking.recoverySpeed?.grade  ?? null },
              ]}
            />
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

      <CustomCharts section="CATCHING" playerId={player.id} />
    </>
  );
}
