'use client';

import { rem } from '@/lib/rem';
import { useEffect, useState, useMemo } from 'react';
import {
  SectionHeader, Section,
  VideoPlaceholder, VideoBundleCard, ReportSelector, EditProfileButton, DownloadPdfButton, VideosIconButton,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import hud from './PitchingTab.module.css';
import {
  TabProps, getReportVideoIds, getReportContentVideos, getReportUploadIds, getLatestReport,
  getPitchingGrades, PITCHING_GRADE_SECTIONS, PITCHING_MECHANICS_SECTION_KEYS, pitchingGradeKey,
  scoreColor,
  type ReportSummary, type PitchingGrades, type PitchingGradeEntry,
  type PitchingGradeItemConfig, type PitchingGradeSectionConfig,
} from '../helpers';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import type { TrackmanPitch } from '@/lib/api';
import { bundleVideos, normalizeVideoTitle, splitVideoTitle } from '@/lib/video-titles';
import { generatePitchingPdf } from '@/lib/pdf';
import { CustomCharts } from '@/components/CustomCharts';
import { LiveAtBatsList } from '@/components/LiveAtBatsList';
import { TabBarActions } from '@/components/assessment';

/* ── Shared Pitch-Report-bubble surface style ──
   Mirrors the outer .hudConsole gradient so every chart / bubble
   in the Pitching tab (ArsenalCards, plot canvases, readout bar,
   mechanical summary, pitching notes, video panel, break/release
   table shells) reads in one unified visual language. Inline so
   it can override the `aStyles.innerPanel` className without
   editing the shared module.

   References the `--bubble-chrome-bg` CSS variable defined in
   globals.css so the surface auto-flips between the dark-mode
   triple-layer radial+linear gradient and the light-mode
   `#f3f3f3 → #e5e5e5` off-white linear gradient with no JS-side
   theme check needed. */
const PITCH_REPORT_BUBBLE_BG = 'var(--bubble-chrome-bg)';

const pitchReportBubbleStyle: React.CSSProperties = {
  background: PITCH_REPORT_BUBBLE_BG,
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  position: 'relative',
  /* Drop shadow matched to `movementPlotBubbleStyle` (the Swing /
     Quality of Contact / Coach Diagnosis bubbles) + the Spray Chart
     bubble, which all use `0 5px 14px / 0.21`. The Arsenal cards
     (Fastball / Curveball / Slider / ChangeUp) and every other
     pitch-report bubble already share the `--bubble-chrome-bg`
     surface, so matching the shadow makes them read identically to
     the Hitting-tab bubbles. (Was the lone outlier at 0.10.) */
  boxShadow: '0 5px 14px rgba(0, 0, 0, 0.21)',
};

/* ── Shared Player-Name-bubble (Command Deck) surface style ──
   Same chrome the page-hero `.commandDeck` carries (and now the
   Pitch Report `.hudConsole` too): deep dark-navy radial highlight,
   white-rim border, layered inset shadow stack. Used for any
   *outer* shell around grouped sub-bubbles so it reads as a sibling
   of the page hero rather than a generic surface. */
const COMMAND_DECK_BG =
  'radial-gradient(ellipse at 50% 35%, rgba(255, 255, 255, 0.04) 0%, transparent 60%),' +
  'rgba(10, 14, 20, 0.38)';

const commandDeckBubbleStyle: React.CSSProperties = {
  background: COMMAND_DECK_BG,
  border: '1px solid var(--border-light)',
  borderRadius: 28,
  boxShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.05),' +
    'inset 0 0 24px rgba(0, 0, 0, 0.35),' +
    '0 1px 2px rgba(0, 0, 0, 0.25)',
  overflow: 'hidden',
  position: 'relative',
};

/* ── Trackman brand badge ──
   Inline SVG version of the Trackman logo — an orange rounded square
   tile with a white stylized "track mark" slash from the upper-right
   curving down to the lower-middle. Used as the post-title icon on the
   Break & Spin + Release & Extension section header (same `iconAfter`
   treatment Coach Grades / Full Swing / Blast Motion / HitTrax use in
   the Swing tab). The SVG is square so it fills the 36×36 sectionIcon
   slot cleanly. */
function TrackmanLogo() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Trackman"
      style={{ display: 'block' }}
    >
      {/* Orange rounded tile — Trackman brand fill */}
      <rect x="0" y="0" width="100" height="100" rx="14" fill="#F37021" />
      {/* White track-mark slash: starts at the upper-right corner area,
          curves down and inward, then flares back out across the bottom
          band so the resulting shape reads like the Trackman logo's
          stylized "1" / track-trail mark. */}
      <path
        d="M 78 16 L 64 16 Q 60 16 57 22 L 33 76 Q 31 80 26 80 L 22 80 Q 18 80 18 84 L 18 84 Q 18 88 22 88 L 38 88 Q 44 88 47 82 L 70 28 Q 72 24 76 24 L 80 24 Q 84 24 84 20 L 84 20 Q 84 16 80 16 Z"
        fill="var(--text-bright)"
      />
    </svg>
  );
}

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
    <div
      // Match the outer Pitch Report bubble's gradient so the four
      // Arsenal chips (Fastball / Curveball / Slider / ChangeUp) read
      // in the same visual scheme as every other bubble on the tab.
      // `flex` + `minWidth` lifted off this inline style — they live in
      // the parent `.hudArsenal > *` rule now, so the 5-per-row + wrap
      // sizing rules in PitchingTab.module.css can take effect (inline
      // flex/minWidth here was beating the CSS class and forcing all
      // 8 cards onto a single row for Andy Johnson).
      style={{
        ...pitchReportBubbleStyle,
        padding: '9px 11px',
      }}
    >
      {/* Pitch label — centered card title in Font B (Brown display,
          upright, 1 rem, weight 600, -0.025em, uppercase, bright
          white) so the Arsenal card titles match every other grey-
          bubble eyebrow across the app. White rule under the label
          mirrors the GradeRow table layout over in the Hitting tab:
          padding-bottom 8 px above the rule, margin-bottom 8 px
          below it before the velo grid. */}
      <div style={{
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontWeight: 600, fontStyle: 'normal',
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
        paddingBottom: 8,
        borderBottom: '1px solid var(--border)',
        marginBottom: 8,
        textAlign: 'center',
      }}>
        {PITCH_DISPLAY[row.pitchType] || row.pitchType}
      </div>
      {hasData ? (
        <>
          {/* Max Velo / Avg Velo / Low Velo — three centered columns
              reading left to right. Captions in white above the big
              mono numeral the pitch-color tint takes. The separate
              Velocity Range row beneath was retired; Low Velo replaces
              its role on the right edge of the trio. Border-bottom +
              padding-bottom add a matching white rule below the
              numbers so the card reads as: label / line / numbers /
              line — same rhythm as the Hitting GradeRow table. */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
            paddingBottom: 8,
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: rem(6.8), color: 'var(--text-bright)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Max Velo</div>
              <div style={{ fontSize: rem(18.7), fontWeight: 700, fontFamily: 'inherit', color, lineHeight: 1 }}>
                {row.maxVelo.toFixed(1)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: rem(6.8), color: 'var(--text-bright)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg Velo</div>
              <div style={{ fontSize: rem(18.7), fontWeight: 700, fontFamily: 'inherit', color, lineHeight: 1 }}>
                {row.avgVelo.toFixed(1)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: rem(6.8), color: 'var(--text-bright)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Low Velo</div>
              <div style={{ fontSize: rem(18.7), fontWeight: 700, fontFamily: 'inherit', color, lineHeight: 1 }}>
                {row.minVelo.toFixed(1)}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: rem(18.7), fontWeight: 700, fontFamily: 'inherit', color: 'var(--faint)', lineHeight: 1 }}>--</div>
          <div style={{ fontSize: rem(7.65), color: 'var(--text-muted)', marginTop: 3 }}>No data yet</div>
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
        <span style={{ fontSize: rem(18.7) }}>&#127919;</span>
        <span style={{ fontSize: rem(9.35), color: 'var(--text-muted)', textAlign: 'center' }}>Click a pitch</span>
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
      <div style={{
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontWeight: 600, fontStyle: 'normal',
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
        marginBottom: 4,
      }}>
        Selected Pitch
      </div>
      {items.map(([label, val, color]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: rem(7.65), fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-bright)' }}>{label}</span>
          <span style={{ fontSize: rem(11.05), fontWeight: 700, fontFamily: 'inherit', color }}>{val}</span>
        </div>
      ))}
    </>
  );
}

/* ── Interactive Movement Plot — tactical HUD styling (matches spray chart) ── */
function MovementPlot({
  pitches, selected, onSelect, interactive = true,
}: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
  interactive?: boolean;
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

            {/* Minor grid lines — theme-aware via `--spray-gridline-color`
                so the Movement Plot grid matches the Spray Chart's
                gridline tone in both light + dark themes. */}
            {minorTicks.map(v => (
              <g key={`mx${v}`}>
                <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
                  stroke="var(--spray-gridline-color)" strokeWidth={0.6} strokeDasharray="3 5" />
                <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
                  stroke="var(--spray-gridline-color)" strokeWidth={0.6} strokeDasharray="3 5" />
              </g>
            ))}

            {/* Major grid + tick chips at ±10, ±20 — gridlines use the
                shared spray gridline color so the major grid steps up
                via stroke width only, not hue. */}
            {majorTicks.map(v => (
              <g key={`mj${v}`}>
                <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
                  stroke="var(--spray-gridline-color)" strokeWidth={0.75} strokeDasharray="3 5" />
                <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
                  stroke="var(--spray-gridline-color)" strokeWidth={0.75} strokeDasharray="3 5" />

                {/* X-axis chip (bottom) */}
                <g transform={`translate(${sx(v)}, ${pad.top + plotH + 14})`}>
                  <rect x={-13} y={-8} width={26} height={14} rx={7}
                    fill="rgba(10,12,18,0.75)"
                    stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
                  <text x={0} y={2.5}
                    fill="rgba(183,190,201,0.8)"
                    fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
                    fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
                    fontWeight={600} letterSpacing="0.12em"
                    textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
                </g>
              </g>
            ))}

            {/* Crosshair axes — the heaviest gridlines (x=0, y=0). Use
                the shared spray-gridline color so the entire grid system
                reads in one hue; stroke width (1.2) keeps the crosshair
                anchored as the primary axis even with the matched color. */}
            <line x1={pad.left} y1={cy} x2={pad.left + plotW} y2={cy}
              stroke="var(--spray-gridline-color)" strokeWidth={1.2} />
            <line x1={cx} y1={pad.top} x2={cx} y2={pad.top + plotH}
              stroke="var(--spray-gridline-color)" strokeWidth={1.2} />

            {/* Origin marker — tiny silver pentagon (like the home-plate on spray) */}
            <circle cx={cx} cy={cy} r={4} fill="rgba(223,227,232,0.92)"
              stroke="rgba(255,255,255,0.5)" strokeWidth={0.75} />

            {/* Axis labels — mono, uppercase, tracked */}
            <text x={pad.left} y={pad.top + plotH + 36}
              fill="rgba(183,190,201,0.55)"
              fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
              fontWeight={600} letterSpacing="0.28em"
              textAnchor="start">← ARM</text>
            <text x={pad.left + plotW} y={pad.top + plotH + 36}
              fill="rgba(183,190,201,0.55)"
              fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
              fontWeight={600} letterSpacing="0.28em"
              textAnchor="end">GLOVE →</text>
            <g transform={`translate(16, ${pad.top + plotH / 2}) rotate(-90)`}>
              <text x={0} y={0}
                fill="rgba(183,190,201,0.55)"
                fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
                  style={{ cursor: interactive ? 'pointer' : 'default' }}
                  onClick={interactive ? (e => { e.stopPropagation(); onSelect(isSelected ? null : p); }) : undefined}>
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
                    fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
                    fontWeight={600} letterSpacing="0.14em"
                    textAnchor="start">{PITCH_SHORT[t] || t}</text>
                </g>
              );
            })}
    </svg>
  );
}

/* ── Release Point Plot (fixed grid, handedness-aware) ── */
function ReleasePointPlot({ pitches, selected, onSelect, width = 380, height = 360, interactive = true }: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
  width?: number;
  height?: number;
  interactive?: boolean;
}) {
  const pad = { top: 36, right: 20, bottom: 44, left: 50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const valid = pitches.filter(p =>
    p.relSide != null && p.relHeight != null &&
    typeof p.relSide === 'number' && typeof p.relHeight === 'number'
  );

  if (valid.length === 0) {
    // Match the bare-SVG return shape used by MovementPlot / PitchLocationPlot
    // — the parent HUD plot canvas already provides the bubble chrome, so
    // wrapping in our own innerPanel created a doubled, lighter bubble.
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}>
        <text x={width / 2} y={height / 2 - 6} textAnchor="middle"
          fontSize={12} fontWeight={600} fill="var(--text-muted)">
          Release Point Plot
        </text>
        <text x={width / 2} y={height / 2 + 14} textAnchor="middle"
          fontSize={13} fill="var(--faint)">
          No data available
        </text>
      </svg>
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
    /* Bare SVG (no outer innerPanel wrapper) so this plot sits inside the
       parent HUD plot canvas at the same depth as Movement / Location. The
       little (LHP/RHP) handedness chip is rendered as an SVG text element
       so we don't need a header div above the plot. */
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ cursor: 'default', display: 'block' }}>
        {/* Transparent click-to-deselect surface — matches Movement /
            Location plots so clicking empty space clears selection. */}
        <rect width={width} height={height} fill="transparent"
          onClick={() => onSelect(null)} />
        {/* Grid lines — theme-aware via `--spray-gridline-color` so the
            Release Point Plot grid matches the Spray Chart's gridline
            tone in both light + dark themes. The center axis (v=0) uses
            a heavier stroke (1.0) so it anchors visually while sharing
            the same hue as the lighter gridlines. */}
        {xTicks.map((v, i) => (
          <g key={`x${i}`}>
            <line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
              stroke="var(--spray-gridline-color)"
              strokeWidth={v === 0 ? 1 : 0.5}
              pointerEvents="none" />
            <text x={sx(v)} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--text-muted)" pointerEvents="none">{v}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)} stroke="var(--spray-gridline-color)" strokeWidth={0.5} />
            <text x={pad.left - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">{v}</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={height - 22} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)">
          Release Side (ft)
        </text>
        <text x={12} y={pad.top + plotH / 2} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-muted)"
          transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>Release Height (ft)</text>

        {/* Handedness side indicator retired — the chart bubble's own
            title strip already labels the chart as "Release Point ·
            Pitcher's View", and the RHP/LHP Side hint inside the plot
            was adding clutter without much utility. */}

        {/* Data points — flip X for lefties so they appear on the right side.
            Clickable, with a halo + bright ring on the selected pitch and
            dimming on the rest, mirroring the Movement / Location plots. */}
        {valid.map((p, i) => {
          const rawSide = p.relSide as number;
          // Right-handers: data naturally plots on left (negative side)
          // Left-handers: flip sign so data plots on right (positive side)
          const plotSide = isLefty ? -rawSide : rawSide;
          const cx = sx(plotSide);
          const cy = sy(p.relHeight as number);
          const isSelected = !!selected && p.id === selected.id;
          const dim = !!selected && !isSelected;
          return (
            <g key={p.id ?? i}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
              onClick={interactive ? ((e) => { e.stopPropagation(); onSelect(isSelected ? null : p); }) : undefined}>
              {/* Halo for selected pitch */}
              {isSelected && (
                <circle cx={cx} cy={cy} r={11}
                  fill={getPitchColor(p.pitchType)} opacity={0.30} pointerEvents="none" />
              )}
              <circle cx={cx} cy={cy}
                r={isSelected ? 7 : 5}
                fill={getPitchColor(p.pitchType)}
                opacity={dim ? 0.25 : (isSelected ? 1 : 0.85)}
                stroke={isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)'}
                strokeWidth={isSelected ? 1.5 : 0.5} />
            </g>
          );
        })}

        {/* Border */}
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="var(--border)" strokeWidth={1} />

        {/* Handedness chip retired — the canvas bubble's own header
            strip already titles the chart as "Release Point · Pitcher's
            View", so the in-SVG "Release Point (RHP/LHP)" duplicate
            was redundant. */}

        {/* Legend */}
        {types.map((t, i) => (
          <g key={t} transform={`translate(${pad.left + plotW - types.length * 70 + i * 70}, ${pad.top - 18})`}>
            <circle cx={0} cy={0} r={4} fill={getPitchColor(t)} />
            <text x={8} y={4} fontSize={10} fontWeight={600} fill="var(--text-muted)">{PITCH_SHORT[t] || t}</text>
          </g>
        ))}
      </svg>
  );
}

/* ── Pitch Location Plot (strike zone, interactive) ── */
function PitchLocationPlot({
  pitches, selected, onSelect, interactive = true,
}: {
  pitches: TrackmanPitch[];
  selected: TrackmanPitch | null;
  onSelect: (p: TrackmanPitch | null) => void;
  interactive?: boolean;
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

      {/* Minor grid — theme-aware via `--spray-gridline-color` so the
          Location Plot grid matches the Spray Chart's gridline tone in
          both light + dark themes. */}
      {[-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2].map(v => (
        <line key={`xg${v}`} x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
          stroke="var(--spray-gridline-color)" strokeWidth={0.6} strokeDasharray="3 5" />
      ))}
      {[0.5, 1.5, 2.5, 3.5, 4.5].map(v => (
        <line key={`yg${v}`} x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
          stroke="var(--spray-gridline-color)" strokeWidth={0.6} strokeDasharray="3 5" />
      ))}

      {/* Integer-foot Y-axis ticks + mono pill chips */}
      {[1, 2, 3, 4, 5].map(v => (
        <g key={`yt${v}`}>
          <line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
            stroke="var(--spray-gridline-color)" strokeWidth={0.7} strokeDasharray="3 5" />
          <g transform={`translate(${pad.left - 18}, ${sy(v)})`}>
            <rect x={-14} y={-7} width={28} height={14} rx={7}
              fill="rgba(10,12,18,0.75)"
              stroke="rgba(183,190,201,0.18)" strokeWidth={0.6} />
            <text x={0} y={3}
              fill="rgba(183,190,201,0.8)"
              fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
            fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
            {/* Zone subdividers — gridlines inside the strike zone. Same
                theme-aware spray-gridline color as the rest of the plot's
                grid system. */}
            <line x1={sx(szLeft + szW / 3)} y1={sy(szTop)} x2={sx(szLeft + szW / 3)} y2={sy(szBot)}
              stroke="var(--spray-gridline-color)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft + 2 * szW / 3)} y1={sy(szTop)} x2={sx(szLeft + 2 * szW / 3)} y2={sy(szBot)}
              stroke="var(--spray-gridline-color)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft)} y1={sy(szTop - szH / 3)} x2={sx(szRight)} y2={sy(szTop - szH / 3)}
              stroke="var(--spray-gridline-color)" strokeWidth={0.7} strokeDasharray="2 3" />
            <line x1={sx(szLeft)} y1={sy(szTop - 2 * szH / 3)} x2={sx(szRight)} y2={sy(szTop - 2 * szH / 3)}
              stroke="var(--spray-gridline-color)" strokeWidth={0.7} strokeDasharray="2 3" />
            {/* Zone frame — uses the Movement-plot gridline color so it's the
                same tone as the main gridlines (and stands out in light theme,
                where the old faint silver washed out on the light surface). */}
            <rect x={x} y={y} width={w} height={h}
              fill="none" stroke="var(--spray-gridline-color)" strokeWidth={1.5} />
            {/* Zone numbers */}
            {zones.map(z => (
              <text key={z.n}
                x={sx(z.x + szW / 6)} y={sy(z.y + szH / 6) + 3.5}
                fill="rgba(183,190,201,0.5)"
                fontSize={10}
                fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
            style={{ cursor: interactive ? 'pointer' : 'default' }}
            onClick={interactive ? (e => { e.stopPropagation(); onSelect(isSelected ? null : p); }) : undefined}>
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
        fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
        fontWeight={600} letterSpacing="0.28em"
        textAnchor="start">← INSIDE</text>
      <text x={pad.left + plotW} y={pad.top + plotH + 36}
        fill="rgba(183,190,201,0.55)"
        fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
              fontSize={9} fontFamily="'Satoshi', 'DM Sans', sans-serif"
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
  textAlign: 'left', padding: '8px 10px', fontSize: rem(8.5), fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-bright)',
};
const tdBase: React.CSSProperties = { padding: '8px 10px', color: 'var(--text)' };
const tdMono: React.CSSProperties = { ...tdBase, fontFamily: 'inherit', fontWeight: 600 };

function ReleaseTable({ rows }: { rows: ArsenalRow[] }) {
  const cols = '70px 1fr 1fr 1fr';
  const headerStyle: React.CSSProperties = { fontSize: rem(7.65), fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-bright)', textAlign: 'center' };
  const cellStyle: React.CSSProperties = { textAlign: 'center', fontFamily: 'inherit', fontWeight: 700, fontSize: rem(12.75), color: 'var(--text)' };

  return (
    <div>
      <div style={{
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontWeight: 600, fontStyle: 'normal',
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
        marginBottom: 8,
      }}>
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
            <span style={{ fontWeight: 700, fontSize: rem(10.2), color: getPitchColor(r.pitchType) }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <span style={cellStyle}>
              {r.avgExt > 0 ? r.avgExt : '--'} <span style={{ fontSize: rem(7.65), fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
            </span>
            <span style={cellStyle}>
              {r.avgRelHeight > 0 ? r.avgRelHeight : '--'} <span style={{ fontSize: rem(7.65), fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
            </span>
            <span style={cellStyle}>
              {r.avgRelSide !== 0 ? r.avgRelSide : '--'} <span style={{ fontSize: rem(7.65), fontWeight: 500, color: 'var(--text-muted)' }}>ft</span>
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
      <div style={{
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontWeight: 600, fontStyle: 'normal',
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
      }}>
        Velocity Range by Pitch
      </div>
      {rows.filter(r => r.maxVelo > 0).map(r => {
        const left = ((r.minVelo - globalMin + 5) / range) * 100;
        const w = ((r.maxVelo - r.minVelo) / range) * 100;
        return (
          <div key={r.pitchType} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: rem(9.35), fontWeight: 700, color: 'var(--text-muted)', width: 40, fontFamily: 'inherit' }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', position: 'relative' }}>
              <div style={{
                position: 'absolute', left: `${left}%`, width: `${Math.max(w, 2)}%`,
                height: '100%', borderRadius: 4, background: getPitchColor(r.pitchType),
              }} />
            </div>
            <span style={{ fontSize: rem(9.35), fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
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
  /* Column track widened from 6 → 7 fr-columns to insert a new
     "Avg Velo" cell between the Pitch label and H-Break. The
     average velocity (avgVelo) is already computed per row inside
     `computeArsenal`, so this is purely a UI addition. */
  const cols = '70px 1fr 1fr 1fr 1fr 1fr 1fr';
  const headerStyle: React.CSSProperties = { fontSize: rem(7.65), fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-bright)', textAlign: 'center' };
  const cellStyle: React.CSSProperties = { textAlign: 'center', fontFamily: 'inherit', fontWeight: 700, fontSize: rem(12.75), color: 'var(--text)' };

  return (
    <div>
      <div style={{
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontWeight: 600, fontStyle: 'normal',
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
        marginBottom: 8,
      }}>
        Break &amp; Spin
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ ...headerStyle, textAlign: 'left' }}>Pitch</span>
          <span style={headerStyle}>Avg Velo</span>
          <span style={headerStyle}>H-Break</span>
          <span style={headerStyle}>V-Break</span>
          <span style={headerStyle}>Spin</span>
          <span style={headerStyle}>Tilt</span>
          <span style={headerStyle}>Spin Eff</span>
        </div>
        {rows.map(r => (
          <div key={r.pitchType} style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: rem(10.2), color: getPitchColor(r.pitchType) }}>
              {PITCH_SHORT[r.pitchType]}
            </span>
            <span style={cellStyle}>
              {r.avgVelo > 0 ? r.avgVelo.toFixed(1) : '--'}
              <span style={{ fontSize: rem(7.65), fontWeight: 500, color: 'var(--text-muted)', marginLeft: 3 }}>mph</span>
            </span>
            <span style={cellStyle}>
              {r.avgHBreak > 0 ? '+' : ''}{r.avgHBreak}&quot;
            </span>
            <span style={cellStyle}>
              {r.avgIVB > 0 ? '+' : ''}{r.avgIVB}&quot;
            </span>
            <span style={cellStyle}>
              {r.avgSpin} <span style={{ fontSize: rem(7.65), fontWeight: 500, color: 'var(--text-muted)' }}>rpm</span>
            </span>
            <span style={cellStyle}>
              {r.tilt}
            </span>
            <span style={cellStyle}>
              {/* Spin-efficiency bar retired per coach-spec — the column
                  now reads as a plain percent value (e.g. 79%, 100%) in
                  the same style as the other Break & Spin cells. '--' when
                  there's no spin data, matching the Avg Velo guard above. */}
              {r.spinEff > 0 ? `${r.spinEff}%` : '--'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main PitchingTab ── */
export function PitchingTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos, onNewReport, onEditReport, onEditProfile, onOpenVideos,
}: TabProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [pitches, setPitches] = useState<TrackmanPitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPitch, setSelectedPitch] = useState<TrackmanPitch | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  /* Pitching sub-tab — mirrors the Hitting tab's swing/decision
     toggle. 'report' shows the unified Pitch Report HUD bubble
     (Arsenal cards + Movement Plot + Location plot + Break & Spin
     + Release & Extension tables). 'live' swaps that view out for
     the LiveAtBatsList section ("Live Results") so the coach can
     drill into pitch-by-pitch at-bat history at the same screen
     position. Toggle button lives in the Pitch Report HUD header
     next to the "Pitch Report" title. */
  const [pitchingSubTab, setPitchingSubTab] = useState<'report' | 'live'>('report');

  // ── Coaching notes for the pitch report (mirrors the diagnosis-notes pattern from SwingTab) ──
  const latestPitching = useMemo(() => getLatestReport(reports, ['PITCHING']), [reports]);

  /* All Pitching reports — used by the bundle modal's
     "Attach to report" dropdown so coaches can stamp a Coach
     Review onto a specific pitching session. */
  const pitchingReports = useMemo(
    () => reports.filter((r) => r.reportType === 'PITCHING')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );

  /* Active report drives both the bundle modal's report dropdown
     pre-selection and the per-report Coach Reviews panel below the
     Mechanical Grades summary. Falls back to the latest pitching
     report if the coach hasn't explicitly picked one. */
  const activePitchingReport = selectedReport ?? latestPitching;

  /* Coach Reviews attached to the active PITCHING report — surface
     in the dedicated panel under Coach Grades. Excluded from the
     main Video gallery so the same clip doesn't double-render. */
  const attachedReviewIds = useMemo(() => {
    if (!activePitchingReport?.content) return [] as string[];
    try {
      const parsed = JSON.parse(activePitchingReport.content);
      if (parsed && Array.isArray(parsed.coachReviewVideoIds)) {
        return parsed.coachReviewVideoIds.filter((s: any) => typeof s === 'string') as string[];
      }
    } catch { /* ignore */ }
    return [] as string[];
  }, [activePitchingReport]);

  /* When the parent re-fetches `reports` (e.g. after the report modal
     saves), the local `selectedReport` still points at the STALE
     object from before the save — its `content.csvUploads` doesn't
     reflect the just-removed CSV slot. Re-sync from the fresh array
     by matching on id so the pitch data fetch picks up the change
     immediately. If the report was deleted entirely (no match), drop
     the selection to fall back to the latest pitching report. */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);

  /* Upload-id scoping now follows the ACTIVE pitching report (the
     user's explicit selection if any, else the latest pitching report
     on file). The previous wiring keyed off `selectedReport` alone,
     which meant removing a CSV from the latest report didn't refresh
     the page when the user hadn't explicitly picked it from the
     dropdown — `selectedReport` was null, `reportUploadIds` was [],
     and the fetch fell through to "all pitches" (no scoping). */
  const reportUploadIds = useMemo(
    () => getReportUploadIds(selectedReport ?? latestPitching),
    [selectedReport, latestPitching],
  );
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

  /* `activePitchingReport` is declared earlier in this component
     (near the per-position report list + attached-Coach-Review
     memos) so it's available for those memos at render time. The
     duplicate declaration that used to sit here was removed; every
     downstream reference resolves to the earlier const. */

  useEffect(() => {
    if (!player?.id) return;
    setLoading(true);
    /* Strict report-scoped fetch when ANY pitching report is on file:
         • Active report has upload IDs → filter to those IDs.
         • Active report has NO upload IDs (e.g. coach removed the
           Trackman CSV from it) → show NO pitches. The previous
           wiring fell through to `opts = undefined` here, which meant
           "no filter" — i.e. the fetch returned every pitch ever
           uploaded for the player, including the ones tied to the
           freshly-deleted CSV. That's why removing a CSV "didn't
           change the data" on Andy Johnson's profile.
         • No pitching report at all → legacy behavior: return every
           pitch on the player so orphan / pre-report data still
           surfaces (matches how a brand-new player's data loads). */
    if (activePitchingReport && reportUploadIds.length === 0) {
      setPitches([]);
      setLoading(false);
      return;
    }
    const opts = reportUploadIds.length > 0 ? { uploadIds: reportUploadIds } : undefined;
    api.getTrackmanPitches(player.id, opts)
      .then(data => setPitches(data))
      .catch(() => setPitches([]))
      .finally(() => setLoading(false));
  }, [player?.id, refreshKey, reportUploadIds, activePitchingReport]);
  // Read-only pitchingGrades — used by the inline Mechanical Summary
  // Strip inside the Pitch Report HUD. The standalone "Mechanical
  // Grades" sub-tab was retired; grades are edited via the report
  // modal now and surface here just as a summary read-out.
  const persistedPitchingGrades = useMemo(
    () => getPitchingGrades(activePitchingReport),
    [activePitchingReport],
  );
  const pitchingGrades = persistedPitchingGrades;

  const hasPitchData = pitches.length > 0;
  // Pitches rebuilt from a Trackman PDF report are table-driven (not tracked
  // per pitch), so the plots render non-interactive — no click-to-inspect.
  const pdfOrigin = hasPitchData && pitches.every(p => p.pdfSource);
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
      {/* ── Report Selector + Download (portaled into TabBar) ── */}
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        {/* Top-level Download PDF — generates a PDF for the currently
            selected PITCHING report. Disabled when no report is on
            file. Mirrors the same icon-only square + per-row dropdown
            pattern used on the Hitting tab. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!activePitchingReport) return;
            await generatePitchingPdf(player, [activePitchingReport]);
          }}
          disabled={!activePitchingReport}
        />
        {/* Videos jump — sits next to Download PDF, replaces the
            standalone Videos tab. */}
        <VideosIconButton onClick={onOpenVideos} />
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

      {/* Mechanical Grades sub-tab retired — grades are edited from
          the report modal; the inline MechanicalSummaryStrip below
          still surfaces the read-only roll-up inside the Pitch Report
          HUD. */}
      <>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: rem(11.9) }}>
          Loading pitch data...
        </div>
      )}

      {/* ── Live Results (Phase 6) — surfaces every at-bat this pitcher
          pitched in a Live Session, with rollup stats (FPS %, Early &
          Ahead, K %, BB %, GB %, Fly-Ball %, 2K-Strike %). Scoped by
          pitcherId. Gated behind `pitchingSubTab === 'live'` — the
          "Live Results" toggle in the Pitch Report HUD header controls
          it; default state hides it. Rendered HERE (above the Pitch
          Report HUD) so when the toggle is pressed the Live Results
          bubble is the FIRST bubble in the report. */}
      {pitchingSubTab === 'live' && (
        <Section>
          <LiveAtBatsList
            pitcherId={player.id}
            title="Live Results"
            canDelete={isCoach}
          />
        </Section>
      )}

      {/* ── Unified Pitch Report — Arsenal + Movement + Location in one HUD bubble ── */}
      {!loading && hasPitchData && (
        <div
          data-pdf-section="pitch-report"
          className={hud.hudConsole}
          /* Bottom margin matches the shared `.section` 20px so the
             Pitch Report bubble sits the same distance from the next
             dark-blue bubble below it as every other section across
             the app (Tool Grades → Sub-Grade Breakdown gap).

             Padding overridden to match the Hitting Snapshot bubble
             rhythm exactly per coach-spec:
               • TOP    — 0.7rem (matches `.profilePanel` + Hitting
                          Snapshot's halved top padding)
               • SIDES  — 1.4rem (matches `.profilePanel` default)
               • BOTTOM — 1.4rem (matches `.profilePanel` default)
             The CSS class's own `padding: 10px 12px 12px` was kept
             tight to give the inner HUD widgets edge-to-edge room,
             but coach-spec wants the bubble's outer chrome to read
             at the same scale as every other Snapshot header. */
          style={{
            marginBottom: 20,
            padding: '0.7rem 1.4rem 1.4rem',
          }}
        >
          {/* Console header — the leading circular `hudHeadDot`
              bullet was retired so "Pitch Report" leads the row on
              its own. The header now reads as a four-part flex row:
                1. "Pitch Report" title (anchored flex-end / bottom)
                2. Line segment A — 1 px hairline that starts right
                   after the title and grows (flex: 1) up to the
                   pitch-count chip.
                3. Pitch-count chip — small `0.5em` label,
                   vertically centered against the title mid-line.
                4. Line segment B — 1 px hairline that resumes after
                   the chip and grows (flex: 1) all the way to the
                   bubble's right edge.
              The two hairline segments together read as one
              continuous line that "disappears" behind the chip and
              "reappears" past it — automatically interrupted by
              whatever inline text sits between them. Each segment
              uses `align-self: flex-end` + `margin-bottom: 6 px`
              (≈ half the 13.8 px title size) so the line lands at
              the title's vertical mid-line instead of the row's
              bottom (which is where the main accent border-bottom
              lives). */}
          <div className={hud.hudHead}>
            Pitching Report
            {/* Live Results toggle — sits IMMEDIATELY next to the
                "Pitch Report" title per coach-spec (mirrors the
                Hitting Snapshot's Live Results button). Click →
                flips `pitchingSubTab` between 'report' and 'live'.
                When active (`pitchingSubTab === 'live'`) the button
                highlights blue and the hudConsole content swaps to
                the LiveAtBatsList view. `alignSelf: flex-end` +
                `marginBottom: 0` baseline-aligns the button bottom
                with the "Pitch Report" title bottom — since both
                have ~22 px box heights, sharing a baseline puts
                their centers on the same horizontal axis. */}
            <button
              type="button"
              onClick={() => setPitchingSubTab(pitchingSubTab === 'live' ? 'report' : 'live')}
              style={{
                alignSelf: 'flex-end',
                marginBottom: 0,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 12px',
                borderRadius: 6,
                border: `1px solid ${pitchingSubTab === 'live' ? 'rgba(126,182,255,0.65)' : 'var(--border)'}`,
                background: pitchingSubTab === 'live' ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.04)',
                /* Active text: pale blue reads on the dark theme, but vanishes on
                   the light-theme pale-blue chip — use dark grey there to offset. */
                color: pitchingSubTab === 'live'
                  ? (isLight ? '#374151' : '#cfe0ff')
                  : 'var(--text-muted)',
                /* `fontFamily: var(--font-body)` (Satoshi) — pinned
                   explicitly so this button doesn't inherit the
                   `var(--font-display)` (Syne, italic) face the
                   parent `.hudHead` sets on its descendants. With
                   the explicit override, the button reads in the
                   same Satoshi-uppercase voice as the Hitting tab's
                   Live Results button. */
                fontFamily: 'var(--font-body)',
                fontStyle: 'normal',
                fontSize: rem(8.5),
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                whiteSpace: 'nowrap',
                marginLeft: 12,
              }}
              title="Toggle between Pitch Report view and Live Results view"
            >
              Live Results
            </button>
            {/* Line segment A — short stub after the title (was
                `flex: 1`, which split the remaining row 50/50 with
                segment B and parked the "X pitches" chip at the
                horizontal midpoint). Now `flex: 0 0 32px` so the
                line is a fixed 32 px stub and the chip sits close
                to "Pitch Report" instead of floating mid-row. */}
            <div style={{
              flex: '0 0 32px',
              height: 1,
              background: 'var(--border)',
              alignSelf: 'flex-end',
              /* marginBottom bumped 6 → 12 so the hairline lands at
                 the new 23 px title's mid-line (was calibrated for
                 the previous 13.8 px mono title). Matches the
                 Hitting Snapshot hairline marginBottom exactly. */
              marginBottom: 12,
            }} />
            <span style={{
              /* Pitch-count chip keeps its mono uppercase eyebrow
                 look — the parent `.hudHead` was retyped to italic
                 Brown 23 px white to match Hitting Snapshot, so this
                 chip pins its own font-family / style / casing to
                 stay in the mono-eyebrow voice it had before. */
              fontFamily: 'var(--font-mono)',
              fontStyle: 'normal',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              letterSpacing: '0.18em',
              fontWeight: 500,
              fontSize: '0.43em',
              alignSelf: 'center',
            }}>
              {pitches.length} pitches
            </span>
            <div style={{
              flex: 1,
              height: 1,
              background: 'var(--border)',
              alignSelf: 'flex-end',
              /* Matches the segment-A hairline above + the Hitting
                 Snapshot hairline at 12 — calibrated for the new
                 23 px italic title midline. */
              marginBottom: 12,
            }} />
            {/* Date-range chip — top-right corner of the Pitch Report
                header, on the side opposite the "Pitch Report" title.
                Sourced from the active pitching report's `createdAt`
                so the chip reflects when the report (and its
                underlying pitch data) was captured. Style matches the
                Hitting Snapshot's date chip so all snapshot headers
                share one date-bubble treatment. */}
            {activePitchingReport && (
              <span style={{
                alignSelf: 'flex-end',
                marginBottom: 8,
                fontSize: rem(8.5),
                color: 'var(--text-muted)',
                letterSpacing: '0.10em',
                padding: '3px 9px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)',
                whiteSpace: 'nowrap',
                /* Pinned to `var(--font-mono)` (DM Mono) to match the
                   Hitting Snapshot's date chip exactly. Previously
                   `fontFamily: 'inherit'` pulled the Syne italic
                   display face from the parent `.hudHead`, which
                   gave the chip a thicker, italic-leaning look that
                   didn't match the Hitting tab's mono-stylized date
                   chip. The `fontStyle: normal` + `textTransform:
                   none` overrides keep the date readable as plain
                   numerals against the uppercase italic title. */
                fontFamily: 'var(--font-mono)',
                fontStyle: 'normal',
                textTransform: 'none',
              }}>
                {new Date(activePitchingReport.createdAt).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </span>
            )}
          </div>

          {/* Arsenal strip — the "Pitch Info" row at the top of the HUD. */}
          <div className={hud.hudArsenal}>
            {arsenalCards.map((row) => (
              <ArsenalCard key={row.pitchType} row={row} />
            ))}
          </div>

          {/* Pitch Readout bar — now sits BETWEEN the Arsenal (Pitch Info)
              row above and the plot grid below, so the readout for the
              currently-selected pitch reads alongside the arsenal summary
              instead of trailing off underneath the plots. */}
          <div className={hud.hudReadoutBar}>
            {/* "Pitch Readout" / "Selected Pitch" head retired — the
                bar's eight cells now stretch across the full width.
                Each cell pairs its label inline with its value on the
                same line so the extra horizontal space goes back into
                bigger metric typography. */}
            {/* Each cell packs label + value tight (`gap: 6`) so the
                number sits right next to its label, then the parent
                grid's `auto-fit minmax(...) 1fr` columns distribute
                equal space BETWEEN each cluster. `justify-content:
                center` on each cell centers the label+value pair inside
                each grid track so the gap to neighbours stays symmetrical. */}
            {(() => {
              const valueColor = selectedPitch
                ? getPitchColor(selectedPitch.pitchType)
                : 'var(--text-muted)';
              return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              alignItems: 'baseline',
              gap: 4,
              width: '100%',
            }}>
              {([
                ['Pitch',
                  selectedPitch ? (PITCH_SHORT[selectedPitch.pitchType] || selectedPitch.pitchType) : '--',
                  valueColor],
                ['Velocity',
                  selectedPitch?.relSpeed != null ? `${selectedPitch.relSpeed.toFixed(1)} mph` : '--',
                  valueColor],
                ['Spin',
                  selectedPitch?.spinRate != null ? `${Math.round(selectedPitch.spinRate)} rpm` : '--',
                  valueColor],
                ['H-Break',
                  selectedPitch?.horzBreak != null ? `${selectedPitch.horzBreak.toFixed(1)}"` : '--',
                  valueColor],
                ['IVB',
                  selectedPitch?.inducedVertBreak != null ? `${selectedPitch.inducedVertBreak.toFixed(1)}"` : '--',
                  valueColor],
                ['Extension',
                  selectedPitch?.extension != null ? `${selectedPitch.extension.toFixed(1)} ft` : '--',
                  valueColor],
                ['Rel Ht',
                  selectedPitch?.relHeight != null ? `${selectedPitch.relHeight.toFixed(1)} ft` : '--',
                  valueColor],
                ['Rel Side',
                  selectedPitch?.relSide != null ? `${selectedPitch.relSide.toFixed(1)} ft` : '--',
                  valueColor],
              ] as [string, string, string][]).map(([label, val, color]) => (
                <div key={label} style={{
                  display: 'flex', flexDirection: 'row', alignItems: 'baseline',
                  /* Pinned LEFT so the label stays anchored at the cell's
                     left edge regardless of whether the value is "--" or
                     a full reading. Prevents the label from shifting
                     position once data populates. */
                  justifyContent: 'flex-start', gap: 6, minWidth: 0,
                }}>
                  <span style={{
                    fontSize: rem(8.5), fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.14em', color: 'var(--text-bright)',
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontSize: rem(12.75), fontWeight: 700, fontFamily: 'inherit',
                    color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {val}
                  </span>
                </div>
              ))}
            </div>
              );
            })()}
          </div>

          {/* Plots side by side: Movement · Location · Release Point.
              Each chart's title now lives INSIDE its own canvas via the
              `.hudPlotPaneHead` strip at the top of each bubble — the
              standalone header row above the grid was retired. */}
          <div className={hud.hudPlotsGrid}>
            <div className={hud.hudPlotPane}>
              <div className={hud.hudPlotCanvas}>
                <div className={hud.hudPlotPaneHead}>
                  <span className={hud.hudSubTitle}>
                    <span className={hud.hudSubTitleDot} /> Movement &middot; Pitcher&rsquo;s View
                  </span>
                </div>
                <MovementPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} interactive={!pdfOrigin} />
              </div>
            </div>
            <div className={hud.hudPlotPane}>
              <div className={hud.hudPlotCanvas}>
                <div className={hud.hudPlotPaneHead}>
                  <span className={hud.hudSubTitle}>
                    <span className={hud.hudSubTitleDot} /> Location &middot; Catcher&rsquo;s View
                  </span>
                </div>
                <PitchLocationPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} interactive={!pdfOrigin} />
              </div>
            </div>
            <div className={hud.hudPlotPane}>
              <div className={hud.hudPlotCanvas}>
                <div className={hud.hudPlotPaneHead}>
                  <span className={hud.hudSubTitle}>
                    <span className={hud.hudSubTitleDot} /> Release Point &middot; Pitcher&rsquo;s View
                  </span>
                </div>
                <ReleasePointPlot pitches={pitches} selected={selectedPitch} onSelect={setSelectedPitch} interactive={!pdfOrigin} />
              </div>
            </div>
          </div>
          {pdfOrigin && (
            <div style={{ textAlign: 'center', fontSize: '0.72rem', lineHeight: 1.5, color: 'var(--text-muted)', margin: '8px auto 0', maxWidth: 620 }}>
              Rebuilt from a Trackman session-report PDF — Movement &amp; Release reflect the
              report&rsquo;s per-pitch-type averages; Location shows the pitches plotted on the
              report. Points aren&rsquo;t individually clickable. Upload the CSV for fully
              interactive, pitch-linked data.
            </div>
          )}

          {/* ── Mechanical Grades summary — section aggregates + descriptor
              tags from the active pitching report. Sits between the Movement
              Plot and the Notes so coaches see the rolled-up delivery
              read-out without leaving the Pitch Metrics view. */}
          <MechanicalSummaryStrip grades={pitchingGrades} />

          {/* ── Coaching notes — beneath Movement + Location plots ── */}
          <div
            style={{
              ...pitchReportBubbleStyle,
              margin: '10px 0 0', padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                /* Font B treatment — Brown display, upright, 1 rem,
                   weight 600, -0.025em, uppercase, bright white. The
                   leading blue dot is preserved so the eyebrow still
                   reads as a sub-section bullet, just with the unified
                   grey-bubble title typography. */
                fontFamily: 'inherit', fontSize: '0.85rem',
                fontStyle: 'normal', fontWeight: 600,
                letterSpacing: '-0.025em', textTransform: 'uppercase',
                color: 'var(--text-bright)', lineHeight: 1.05,
              }}>
                {/* Leading blue-dot bullet retired per spec — the
                   eyebrow now reads as a plain title without the
                   sub-section indicator dot. */}
                Pitching Notes
              </span>
              {isCoach && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  {notesSaveOk && <span style={{ color: '#86efac', fontSize: rem(9.35) }}>Saved.</span>}
                  {notesSaveError && <span style={{ color: '#fda4af', fontSize: rem(9.35) }}>{notesSaveError}</span>}
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
                      fontSize: rem(9.35), fontWeight: 700, letterSpacing: '0.04em',
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
                  /* Notes-bubble surface token: dark navy in dark theme,
                     near-white (--bubble-chrome-bg) in light — matches the
                     Hitting / Player Summary notes bubbles. */
                  background: 'var(--notes-bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '10px 12px',
                  borderRadius: 7,
                  fontSize: rem(10.2),
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
                fontSize: rem(10.2), lineHeight: 1.55,
                color: pitchingNotes ? 'var(--text)' : 'var(--text-muted)',
                fontStyle: pitchingNotes ? 'normal' : 'italic',
                padding: '10px 12px',
                /* Notes-bubble surface token — white in light theme,
                   dark navy in dark (matches the textarea + other tabs). */
                background: 'var(--notes-bg)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                minHeight: 50,
              }}>
                {pitchingNotes || 'No notes yet.'}
              </div>
            )}
          </div>

          {/* ── Coach Reviews — sits directly beneath the Pitching
              Notes bubble inside the same Pitch Metrics block.
              Uses `pitchReportBubbleStyle` (the warm Curveball-style
              grey wash + neutral border) so it visually matches the
              Pitching Notes bubble above it. Surfaces only Coach
              Review clips attached to THIS report via the bundle
              modal's Attach-to-Report dropdown; unattached reviews
              stay in the main Video section at the bottom. */}
          {(() => {
            if (!activePitchingReport || attachedReviewIds.length === 0) return null;
            const attachedVideos = playerVideos.filter((v) => attachedReviewIds.includes(v.id));
            if (attachedVideos.length === 0) return null;
            return (
              <div
                style={{
                  ...pitchReportBubbleStyle,
                  margin: '10px 0 0',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontFamily: 'inherit', fontSize: '0.85rem',
                  fontStyle: 'normal', fontWeight: 600,
                  letterSpacing: '-0.025em', textTransform: 'uppercase',
                  color: 'var(--text-bright)', lineHeight: 1.05,
                }}>
                  Coach Reviews — attached to this report
                </span>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  maxHeight: 720,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}>
                  {bundleVideos(attachedVideos).map((b) => (
                    <VideoBundleCard
                      key={b.key}
                      videos={b.videos}
                      size="md"
                      playerId={player.id}
                      recordingCategory="PITCHING"
                      onUploaded={onRefresh}
                      reports={pitchingReports}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* ── Break & Spin + Release & Extension tables ──
          Outer grey bubble holds the section header chrome; each table
          is now wrapped in its own innerPanel (Movement-Plot-toned) so
          the two sub-sections read as their own callouts.
          Bottom margin synced with the shared `.section` 20px so the
          Break & Spin bubble lines up with the rest of the app's
          dark-blue main-bubble cadence. */}
      {hasPitchData && (
        <div style={{ marginBottom: 20 }}>
          {/* Outer shell now carries the Command Deck (player name)
              chrome so it reads as a sibling of the Pitch Report HUD
              bubble above it. Inner Break / Release cards keep the
              graphite Pitch-Report-bubble gradient for clean inner
              contrast. */}
          <div style={{
            ...commandDeckBubbleStyle,
            /* Light theme: match the Pitch Report HUD (.hudConsole's
               light override) instead of the dark-navy Command-Deck
               chrome — that chrome is an inline style, so it can't flip
               via the [data-theme="light"] CSS rule and would otherwise
               stay dark. Now the Trackman bubble reads the same
               cool-slate (--panel-bg-light) as the Pitch Report bubble
               above it. Dark theme keeps the Command-Deck look. */
            ...(isLight ? {
              background: 'var(--panel-bg-light)',
              borderColor: 'rgba(0, 0, 0, 0.10)',
              boxShadow: '0 6px 18px rgba(15, 20, 30, 0.08)',
            } : {}),
            padding: 16,
            /* gap: 16 → 14 (≈0.85rem) so the Trackman SectionHeader's
               accent line sits the same distance above the Break &
               Spin table as the Tool Grades accent line sits above
               its first inner bubble. */
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Branded section header — matches the Swing-tab pattern
                (Coach Grades / Full Swing / Blast Motion / HitTrax)
                where the title sits left and a brand logo badge sits
                immediately to its right via `iconAfter`. The Trackman
                logo identifies the data provenance for the Break &
                Spin + Release & Extension tables below. */}
            <SectionHeader
              icon={<TrackmanLogo />}
              iconColor="gold"
              title="Trackman"
              iconAfter
            />
            <div style={{ ...pitchReportBubbleStyle, padding: 14 }}>
              <BreakTable rows={arsenal} />
            </div>
            <div style={{ ...pitchReportBubbleStyle, padding: 14 }}>
              <ReleaseTable rows={arsenal} />
            </div>
          </div>
        </div>
      )}


      {/* ── Main Video gallery — BOTTOM-most section on this tab.
          Lifted here from its previous spot above the Trackman
          tables so the long video roll never pushes the other
          sections down the page.
          Per coach-spec, Coach Reviews now populate HERE TOO (in
          addition to the dedicated bubble near Coach Grades above).
          The previous `!attachedReviewIds.includes(v.id)` exclusion
          was retired so a coach can find a narrated review from
          either spot. */}
      {hasPitchData && (() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          (videoIds.includes(v.id) || v.category === 'PITCHING')
        ).sort((a, b) => {
          const aR = a.title.startsWith('Coach Review') ? 0 : 1;
          const bR = b.title.startsWith('Coach Review') ? 0 : 1;
          return aR - bR;
        });
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <div
              className={aStyles.profilePanel}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <SectionHeader title="Video" />
              {hasVideos ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  marginBottom: 24,
                }}>
                  {/* Cap at 10 most-recent tiles (2 rows × 5 cols);
                      overflow lives in the all-videos page. */}
                  {bundleVideos(reportVideos).slice(0, 10).map((b) => {
                    const { prefix } = splitVideoTitle(b.videos[0].title || '');
                    return (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="md"
                        playerId={player.id}
                        recordingCategory="PITCHING"
                        onUploaded={onRefresh}
                        reports={pitchingReports}
                      />
                    );
                  })}
                  {reportVideos.length === 0 && contentVideos.map((v, i) => (
                    <VideoPlaceholder
                      key={`content-${i}`} tag="PITCHING"
                      title={v.name.replace(/\.[^.]+$/, '')}
                      subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                      videoUrl={v.url}
                      playerId={player.id}
                      recordingCategory="PITCHING"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyMsg}>No video data.</div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ── No data ── */}
      {!loading && !hasPitchData && (
        <div className={styles.emptyMsg}>
          No Trackman pitching data available.
          <span className={styles.emptyHint}>
            {isCoach ? 'Upload a Trackman CSV or XLSX above.' : 'Ask your coach to upload pitching data.'}
          </span>
        </div>
      )}

      {/* Coaching Notes section removed — coach notes now live inline
          inside the Pitch Report HUD bubble as "Pitching Notes". The
          Video section moved up there too so videos sit directly under
          the notes the coach is writing about them. */}

      <CustomCharts section="PITCHING" playerId={player.id} />

      </>

    </>
  );
}

/* MechanicalGradesPanel retired — grades are edited from the report
   modal now. The MechanicalSummaryStrip below is kept; it surfaces a
   compact read-only roll-up inside the Pitch Report HUD. */

/* ─────────────────────────────────────────────────────────────────────────────
   MechanicalSummaryStrip — compact read-only view of the 7 delivery sections,
   rendered inline on the Pitch Metrics sub-tab between the Movement Plot
   and the Coaching Notes. Each card shows the section title, its aggregate
   score (avg of every populated item score), and the selected descriptor
   tags. Skips entirely when no pitchingGrades are saved.
   ───────────────────────────────────────────────────────────────────────── */
function MechanicalSummaryStrip({ grades }: { grades: PitchingGrades }) {
  const hasAnyData = Object.values(grades)
    .some((g) => g && (g.score != null || (g.options?.length ?? 0) > 0));
  if (!hasAnyData) return null;
  return (
    <div
      style={{
        ...pitchReportBubbleStyle,
        margin: '10px 0 0', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        /* Font B treatment — matches every other grey-bubble eyebrow
           across the app. Leading blue dot retained as a section
           bullet. */
        fontFamily: 'inherit', fontSize: '0.85rem',
        fontStyle: 'normal', fontWeight: 600,
        letterSpacing: '-0.025em', textTransform: 'uppercase',
        color: 'var(--text-bright)', lineHeight: 1.05,
      }}>
        {/* Leading blue-dot bullet retired per spec — eyebrow reads
           as a plain title without the sub-section indicator dot. */}
        Mechanical Grades
      </span>
      {/* Top accent hairline — sits above the 7-section row, matching
         the Swing GradeRow's white rule between the progress bar and
         the chip-table labels (line 3 in the spec). */}
      <div aria-hidden="true" style={{ height: 1, background: 'var(--border)' }} />
      {/* Coach Grades strip renders ONLY the 7 delivery-mechanics
          sections (Gather → Arm Path → Direction → LHFS → UHFS →
          Lower Half Rotation → Arm Deceleration). The two outcome
          sections (Movement + Execution) are intentionally excluded
          here — they remain editable in the Report Modal so their
          values still feed the Player Summary's Tool Grades bars,
          but they don't clutter the per-delivery Coach Grades summary
          on the Pitching tab. */}
      {(() => {
        const coachGradeSections = PITCHING_GRADE_SECTIONS.filter(
          (s) => PITCHING_MECHANICS_SECTION_KEYS.includes(s.key)
        );
        return (
      <div
        className={styles.pitchMechGradesGrid}
        style={{
        display: 'grid',
        /* Column count is driven by the `--pmg-cols` CSS var (one cell per
           delivery-mechanics section on desktop) so a `@media (max-width:
           768px)` rule in page.module.css can drop it to 4-per-line on
           phones — all 7 sections jammed into one row read at ~45px each,
           unreadably tight. `minmax(0, 1fr)` lets each cell shrink below
           its content width so titles wrap internally instead of forcing
           the row wider. */
        '--pmg-cols': coachGradeSections.length,
        gap: 4,
        padding: '6px 0',
        /* Bottom accent hairline — closes the section row, matching
           the Swing GradeRow's white rule below the chip numbers
           (line 6 in the spec, supplied by the table's data-row
           `border-bottom` over there). */
        borderBottom: '1px solid var(--border)',
      } as React.CSSProperties}>
        {coachGradeSections.map((section) => {
          const sectionScores = section.items
            .map((it) => grades[pitchingGradeKey(section.key, it.key)]?.score)
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          const avg = sectionScores.length === 0
            ? null
            : Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length);
          const tone = avg !== null ? scoreColor(avg) : '#475569';
          // `pct` retired alongside the progress-bar — section cards
          // now render Label + Score only.
          // Flatten every selected descriptor across the section's items so
          // coaches see the read-out at a glance — the granular per-item
          // breakdown lives on the Coach Grades sub-tab.
          const selectedTags = section.items.flatMap((it) => {
            const e = grades[pitchingGradeKey(section.key, it.key)];
            return e?.options ?? [];
          });
          return (
            <div
              key={section.key}
              style={{
                /* Per-section bubble chrome retired. Each cell is now
                   a transparent flex column — the surrounding outer
                   Coach Grades bubble already provides the warm-grey
                   surface, and the top + bottom accent hairlines on
                   the row supply the visual containment. Mirrors the
                   Swing GradeRow chip-strip treatment in the Hitting
                   tab (no per-chip background; the strip is bounded
                   by horizontal accent rules instead). */
                padding: '0 4px',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              {/* Section title + aggregate score + descriptor tags.
                  Type sizes scaled down from the previous 7-section
                  layout (Label 11.88 → 10 px; Value 19.8 → 16 px;
                  Tag 9.5 → 8.5 px) so all 9 sections — including
                  the new Movement + Execution outcome bubbles —
                  still fit comfortably on a single row at standard
                  viewport widths. Titles still wrap internally on
                  narrow viewports via the line-height rule. */}
              <div style={{
                fontSize: rem(8.5), fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: 'var(--text-bright)',
                textAlign: 'center', lineHeight: 1.1,
              }}>
                {section.title}
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: rem(13.6),
                  color: tone, lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {avg ?? '—'}
                </span>
              </div>
              {selectedTags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
                  {selectedTags.map((tag, i) => (
                    <span key={`${tag}-${i}`} style={{
                      padding: '1px 4px',
                      borderRadius: 3,
                      fontSize: rem(7.23),
                      fontWeight: 600,
                      background: 'linear-gradient(135deg, rgba(126,182,255,0.22), rgba(61,139,253,0.10))',
                      border: '1px solid rgba(126,182,255,0.40)',
                      color: '#cfe0ff',
                      whiteSpace: 'nowrap',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
        );
      })()}
    </div>
  );
}

function DeliverySectionPanel_RETIRED({
  section, grades, setGrades, isCoach,
}: {
  section: PitchingGradeSectionConfig;
  grades: PitchingGrades;
  setGrades: React.Dispatch<React.SetStateAction<PitchingGrades>>;
  isCoach: boolean;
}) {
  // Section aggregate = average of every populated item score in this
  // section. Items with no score are excluded so a partially-graded section
  // still surfaces a useful average rather than dragging itself toward null.
  const sectionScores = section.items
    .map((it) => grades[pitchingGradeKey(section.key, it.key)]?.score)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const sectionAvg = sectionScores.length === 0
    ? null
    : Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length);
  const sectionTone = sectionAvg !== null ? scoreColor(sectionAvg) : '#475569';
  const sectionPct = sectionAvg !== null ? Math.max(0, Math.min(100, ((sectionAvg - 20) / 60) * 100)) : 0;

  return (
    <div
      className={aStyles.innerPanel}
      style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {/* Section header — title on the left, aggregate grade + score bar
          on the right. The aggregate averages every populated item in this
          section so coaches see the rolled-up checkpoint score at a glance. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: rem(13.6) }}>{section.icon}</span>
        <span style={{
          fontSize: rem(9.35), fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
          whiteSpace: 'nowrap',
        }}>
          {section.title}
        </span>
        <div style={{ flex: 1, minWidth: 60, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1,
            height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${sectionPct}%`, height: '100%',
              background: sectionTone, transition: 'width 0.18s ease',
            }} />
          </div>
          <span style={{
            fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: rem(15.3),
            color: sectionTone, lineHeight: 1, letterSpacing: '-0.02em',
            minWidth: 26, textAlign: 'right',
          }}>
            {sectionAvg ?? '—'}
          </span>
        </div>
      </div>
      <div style={{
        display: 'grid',
        // Tightened card minimum so 4-5 fit per row at typical widths.
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 8,
      }}>
        {section.items.map((item) => {
          const k = pitchingGradeKey(section.key, item.key);
          const entry = grades[k] || { score: null, options: [] };
          return (
            <DeliveryGradeItem
              key={k}
              item={item}
              entry={entry}
              isCoach={isCoach}
              onChange={(next) => setGrades((prev) => ({ ...prev, [k]: next }))}
            />
          );
        })}
      </div>
    </div>
  );
}

function DeliveryGradeItem({
  item, entry, isCoach, onChange,
}: {
  item: PitchingGradeItemConfig;
  entry: PitchingGradeEntry;
  isCoach: boolean;
  onChange: (next: PitchingGradeEntry) => void;
}) {
  const value = entry.score;
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  // Pencil-toggle inline-edit, mirroring SwingTab's ManualScoreCard. The
  // slider + numeric input stay hidden until the coach explicitly opens
  // edit mode — the default profile view is just label + grade + bar +
  // saved tags, so it reads at a glance.
  const [editing, setEditing] = useState(false);

  const toggleOption = (opt: string) => {
    const has = entry.options.includes(opt);
    const next = has ? entry.options.filter((o) => o !== opt) : [...entry.options, opt];
    onChange({ ...entry, options: next });
  };

  return (
    <div
      className={aStyles.innerPanel}
      style={{ padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      {/* Pencil toggle in top-right corner (coach only) */}
      {isCoach && (
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          title={editing ? 'Done editing' : 'Edit grade'}
          style={{
            position: 'absolute', top: 5, right: 5,
            width: 18, height: 18, borderRadius: 4,
            background: editing ? 'rgba(126,182,255,0.18)' : 'rgba(255,255,255,0.04)',
            border: editing
              ? '1px solid rgba(126,182,255,0.55)'
              : '1px solid var(--border)',
            color: editing ? 'var(--accent-light)' : 'var(--text-muted)',
            fontSize: rem(8.5), lineHeight: 1, padding: 0,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          }}
        >
          {editing ? '✓' : (
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5l2 2-8 8H3.5v-2z" />
              <path d="M10 4l2 2" />
            </svg>
          )}
        </button>
      )}

      {/* Label + score readout */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        paddingRight: isCoach ? 22 : 0, // leave room for edit button
      }}>
        <span style={{
          fontSize: rem(7.65), fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {item.label}
        </span>
        <span style={{
          fontWeight: 800, fontSize: rem(14.45),
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
        </span>
      </div>

      {/* Score bar (always visible) */}
      <div style={{
        height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone, transition: 'width 0.18s ease',
        }} />
      </div>

      {/* Multi-select chips:
          - Editing (coach + edit mode): every option toggleable
          - Default: only the saved tags as read-only pills, hidden when none */}
      {isCoach && editing ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {item.options.map((opt) => {
            const active = entry.options.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggleOption(opt)}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  fontSize: rem(9.35),
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: active ? '1px solid rgba(126,182,255,0.55)' : '1px solid var(--border)',
                  background: active
                    ? 'linear-gradient(135deg, rgba(126,182,255,0.28), rgba(61,139,253,0.16))'
                    : 'rgba(255,255,255,0.04)',
                  color: active ? '#cfe0ff' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : entry.options.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {entry.options.map((tag) => (
            <span key={tag} style={{
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: rem(8.07),
              fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(126,182,255,0.22), rgba(61,139,253,0.10))',
              border: '1px solid rgba(126,182,255,0.40)',
              color: '#cfe0ff',
              whiteSpace: 'nowrap',
            }}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {/* Slider + numeric input + clear — only when editing (coach) */}
      {isCoach && editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={20} max={80} step={5}
            value={value ?? 50}
            onChange={(e) => onChange({ ...entry, score: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={20} max={80} step={5}
            value={value ?? ''}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return onChange({ ...entry, score: null });
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onChange({ ...entry, score: Math.max(20, Math.min(80, Math.round(n / 5) * 5)) });
            }}
            style={{
              width: 56, padding: '4px 6px', fontSize: rem(10.2), fontWeight: 700,
              background: 'rgba(0,0,0,0.25)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center',
            }}
          />
          {(value !== null || entry.options.length > 0) && (
            <button type="button" onClick={() => onChange({ score: null, options: [] })}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '4px 8px', fontSize: rem(9.35), cursor: 'pointer',
              }} title="Clear this checkpoint">x</button>
          )}
        </div>
      )}
    </div>
  );
}
