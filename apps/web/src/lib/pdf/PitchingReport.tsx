/**
 * Pitching PDF Report — mirrors the in-app Pitching tab layout:
 *   Page 1 — Cover Page (rendered by the parent Document).
 *   Page 2 — Pitch Type Bubbles row, Movement / Location / Release Point
 *            plots, Pitching Notes.
 *   Page 3 — Trackman Break & Spin and Release & Extension tables.
 *   Page 4 — Coach Grades (per-section aggregate score + selected chips,
 *            mirrors the in-app `MechanicalSummaryStrip`).
 *
 * Interior pages render in landscape LETTER so the deck shares the
 * same canvas as the Cover Page.
 */
import React from 'react';
import { Page, View, Text, Svg, Circle, Line, Rect, G } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PdfNotesBox, PdfPlayerInfoBar,
} from './components';
import {
  formatHeight, getAge,
  PITCHING_GRADE_SECTIONS, pitchingGradeKey,
  type PitchingGrades,
} from '@/app/athletes/[id]/helpers';

export interface ArsenalRow {
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
  /** Average release height in feet — used by the PDF Release table. */
  avgRelHeight: number;
  /** Average release side in feet — used by the PDF Release table. */
  avgRelSide: number;
  tilt: string;
  spinEff: number;
}

/** Subset of TrackmanPitch fields the PDF plots need. The full
 *  TrackmanPitch shape lives in api.ts; we only carry forward the
 *  columns each plot consumes. */
export interface PdfPitch {
  pitchType: string;
  horzBreak: number | null;
  inducedVertBreak: number | null;
  plateLocSide: number | null;
  plateLocHeight: number | null;
  relSide: number | null;
  relHeight: number | null;
  pitcherThrows: string | null;
}

export interface PitchingPdfData {
  player: any;
  arsenal: ArsenalRow[];
  totalPitches: number;
  /** Coach-entered pitching notes (read from content.pitchingNotes on the
   *  active PITCHING report — matches the in-app Pitching Notes bubble). */
  pitchNotes: string | null;
  /** Raw pitches (filtered to the active report's uploadIds when present)
   *  so the plots reproduce exactly what the profile shows. */
  pitches: PdfPitch[];
  /** Saved per-checkpoint coach grades for this PITCHING report. Drives
   *  the new "Coach Grades" page (per-section score + selected chips).
   *  Optional for backwards compatibility — older reports just won't
   *  surface the grades page. */
  pitchingGrades?: PitchingGrades;
  reportDate: string;
}

/* ─── Pitch type → display + color (mirrors PitchingTab) ─── */
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
const PITCH_SHORT: Record<string, string> = {
  Fastball: '4S FB', Sinker: 'SI', Cutter: 'FC', Slider: 'SL',
  Curveball: 'CB', ChangeUp: 'CH', Splitter: 'FS', Sweeper: 'SW',
  Knuckleball: 'KN', Unknown: '??',
};
const PITCH_DISPLAY: Record<string, string> = {
  Fastball: '4-Seam Fastball', Sinker: 'Sinker', Cutter: 'Cutter',
  Slider: 'Slider', Curveball: 'Curveball', ChangeUp: 'Changeup',
  Splitter: 'Splitter', Sweeper: 'Sweeper', Knuckleball: 'Knuckleball',
};
function pitchColor(type: string): string {
  return PITCH_COLORS[type] || PITCH_COLORS.Unknown;
}

/* ─── Pitch Type Bubble (mirrors ArsenalCard) ─── */
function PdfArsenalCard({ row }: { row: ArsenalRow }) {
  const color = pitchColor(row.pitchType);
  const hasData = row.maxVelo > 0;
  return (
    <View style={{
      flex: 1,
      backgroundColor: colors.cardBg,
      border: `1px solid ${colors.cardBorder}`,
      borderRadius: 8,
      padding: 8,
      minWidth: 90,
    }}>
      {/* Pitch label — centered title above a hairline divider, same
          treatment the in-app ArsenalCard uses. */}
      <View style={{
        borderBottom: `0.7px solid ${colors.cardBorder}`,
        paddingBottom: 4, marginBottom: 6,
      }}>
        <Text style={{
          fontSize: 9, fontFamily: 'Helvetica-Bold',
          color: colors.black, letterSpacing: 0.6,
          textAlign: 'center',
        }}>
          {(PITCH_DISPLAY[row.pitchType] || row.pitchType).toUpperCase()}
        </Text>
      </View>
      {hasData ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {([
            ['Max',  row.maxVelo.toFixed(1)],
            ['Avg',  row.avgVelo.toFixed(1)],
            ['Low',  row.minVelo.toFixed(1)],
          ] as [string, string][]).map(([lbl, v]) => (
            <View key={lbl} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{
                fontSize: 6, color: colors.black,
                fontFamily: 'Helvetica-Bold',
                textTransform: 'uppercase', letterSpacing: 0.4,
                marginBottom: 1,
              }}>
                {lbl} Velo
              </Text>
              <Text style={{
                fontSize: 13, fontFamily: 'Helvetica-Bold', color,
              }}>
                {v}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: colors.textMuted }}>—</Text>
          <Text style={{ fontSize: 6, color: colors.textMuted, marginTop: 2 }}>No data</Text>
        </View>
      )}
    </View>
  );
}

/* ─── Plot title strip (matches each in-app plot's hudPlotPaneHead) ─── */
function PlotPaneHeader({ label }: { label: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      gap: 4, marginBottom: 4,
    }}>
      <View style={{
        width: 5, height: 5, borderRadius: 2.5,
        backgroundColor: colors.accent,
      }} />
      <Text style={{
        fontSize: 7, fontFamily: 'Helvetica-Bold',
        color: colors.black, letterSpacing: 0.6,
        textTransform: 'uppercase',
      }}>
        {label}
      </Text>
    </View>
  );
}

/* ─── Movement Plot (horzBreak × inducedVertBreak, ±25 axes) ─── */
function PdfMovementPlot({ pitches }: { pitches: PdfPitch[] }) {
  const W = 240, H = 220;
  const pad = { top: 12, right: 10, bottom: 18, left: 22 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const valid = pitches.filter(p =>
    typeof p.horzBreak === 'number' && typeof p.inducedVertBreak === 'number'
  );
  const aMin = -25, aMax = 25;
  const sx = (v: number) => pad.left + ((v - aMin) / (aMax - aMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - aMin) / (aMax - aMin)) * plotH;
  const cx = sx(0), cy = sy(0);
  const ticks = [-20, -10, 10, 20];
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <Rect x={0} y={0} width={W} height={H} fill={colors.cardBg} />
      {/* Grid + tick labels */}
      {ticks.map(v => (
        <G key={`g${v}`}>
          <Line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
            stroke={colors.cardBorder} strokeWidth={0.4} strokeDasharray="2 3" />
          <Line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
            stroke={colors.cardBorder} strokeWidth={0.4} strokeDasharray="2 3" />
          <Text x={sx(v)} y={pad.top + plotH + 8}
            style={{ fontSize: 5, fill: colors.textMuted }}>
            {v > 0 ? `+${v}` : v}
          </Text>
          <Text x={pad.left - 4} y={sy(v) + 2}
            style={{ fontSize: 5, fill: colors.textMuted }}>
            {v > 0 ? `+${v}` : v}
          </Text>
        </G>
      ))}
      {/* Crosshair axes */}
      <Line x1={pad.left} y1={cy} x2={pad.left + plotW} y2={cy}
        stroke={colors.textMuted} strokeWidth={0.6} />
      <Line x1={cx} y1={pad.top} x2={cx} y2={pad.top + plotH}
        stroke={colors.textMuted} strokeWidth={0.6} />
      {/* Frame */}
      <Rect x={pad.left} y={pad.top} width={plotW} height={plotH}
        fill="none" stroke={colors.cardBorder} strokeWidth={0.6} />
      {/* Pitch dots */}
      {valid.map((p, i) => {
        const x = sx(p.horzBreak as number);
        const y = sy(p.inducedVertBreak as number);
        if (x < pad.left - 4 || x > pad.left + plotW + 4) return null;
        if (y < pad.top - 4  || y > pad.top + plotH + 4)  return null;
        return (
          <Circle key={i} cx={x} cy={y} r={2.4}
            fill={pitchColor(p.pitchType)} opacity={0.85}
            stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
        );
      })}
    </Svg>
  );
}

/* ─── Location Plot (3×3 strike zone, plateLocSide × plateLocHeight) ─── */
function PdfLocationPlot({ pitches }: { pitches: PdfPitch[] }) {
  const W = 240, H = 220;
  const pad = { top: 12, right: 10, bottom: 18, left: 22 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const valid = pitches.filter(p =>
    typeof p.plateLocSide === 'number' && typeof p.plateLocHeight === 'number'
  );
  const xMin = -2.5, xMax = 2.5, yMin = 0, yMax = 5;
  const sx = (v: number) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const szLeft = -0.83, szRight = 0.83, szBot = 1.5, szTop = 3.5;
  const szW = szRight - szLeft;
  const szH = szTop - szBot;
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <Rect x={0} y={0} width={W} height={H} fill={colors.cardBg} />
      {/* Y-axis tick labels */}
      {[1, 2, 3, 4, 5].map(v => (
        <G key={`yt${v}`}>
          <Line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
            stroke={colors.cardBorder} strokeWidth={0.3} strokeDasharray="2 3" />
          <Text x={pad.left - 4} y={sy(v) + 2}
            style={{ fontSize: 5, fill: colors.textMuted }}>
            {v}ft
          </Text>
        </G>
      ))}
      {/* X-axis tick labels */}
      {[-2, -1, 0, 1, 2].map(v => (
        <Text key={`xt${v}`} x={sx(v)} y={pad.top + plotH + 8}
          style={{ fontSize: 5, fill: colors.textMuted }}>
          {v > 0 ? `+${v}` : v}
        </Text>
      ))}
      {/* Strike-zone frame + 3×3 dividers */}
      {(() => {
        const zx = sx(szLeft), zy = sy(szTop);
        const zw = sx(szRight) - sx(szLeft);
        const zh = sy(szBot)   - sy(szTop);
        return (
          <G>
            <Line x1={sx(szLeft + szW / 3)} y1={sy(szTop)} x2={sx(szLeft + szW / 3)} y2={sy(szBot)}
              stroke={colors.textMuted} strokeWidth={0.4} strokeDasharray="1 2" />
            <Line x1={sx(szLeft + 2 * szW / 3)} y1={sy(szTop)} x2={sx(szLeft + 2 * szW / 3)} y2={sy(szBot)}
              stroke={colors.textMuted} strokeWidth={0.4} strokeDasharray="1 2" />
            <Line x1={sx(szLeft)} y1={sy(szTop - szH / 3)} x2={sx(szRight)} y2={sy(szTop - szH / 3)}
              stroke={colors.textMuted} strokeWidth={0.4} strokeDasharray="1 2" />
            <Line x1={sx(szLeft)} y1={sy(szTop - 2 * szH / 3)} x2={sx(szRight)} y2={sy(szTop - 2 * szH / 3)}
              stroke={colors.textMuted} strokeWidth={0.4} strokeDasharray="1 2" />
            <Rect x={zx} y={zy} width={zw} height={zh}
              fill="none" stroke={colors.textDark} strokeWidth={0.9} />
          </G>
        );
      })()}
      {/* Outer frame */}
      <Rect x={pad.left} y={pad.top} width={plotW} height={plotH}
        fill="none" stroke={colors.cardBorder} strokeWidth={0.6} />
      {/* Pitch dots */}
      {valid.map((p, i) => {
        const x = sx(p.plateLocSide as number);
        const y = sy(p.plateLocHeight as number);
        if (x < pad.left - 4 || x > pad.left + plotW + 4) return null;
        if (y < pad.top - 4  || y > pad.top + plotH + 4)  return null;
        return (
          <Circle key={i} cx={x} cy={y} r={2.4}
            fill={pitchColor(p.pitchType)} opacity={0.85}
            stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
        );
      })}
    </Svg>
  );
}

/* ─── Release Point Plot (Release Side × Release Height) ─── */
function PdfReleasePointPlot({ pitches }: { pitches: PdfPitch[] }) {
  const W = 240, H = 220;
  const pad = { top: 12, right: 10, bottom: 18, left: 22 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const valid = pitches.filter(p =>
    typeof p.relSide === 'number' && typeof p.relHeight === 'number'
  );
  // Handedness: flip lefties to the right side of the chart, same as the
  // in-app ReleasePointPlot.
  const throws: Record<string, number> = {};
  for (const p of valid) {
    const t = (p.pitcherThrows || '').toLowerCase().trim();
    if (t) throws[t] = (throws[t] || 0) + 1;
  }
  const isLefty = (throws['left'] || 0) > (throws['right'] || 0);
  const xMin = -4, xMax = 4, yMin = 2, yMax = 7;
  const sx = (v: number) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const xTicks = [-4, -2, 0, 2, 4];
  const yTicks = [2, 3, 4, 5, 6, 7];
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <Rect x={0} y={0} width={W} height={H} fill={colors.cardBg} />
      {xTicks.map(v => (
        <G key={`xt${v}`}>
          <Line x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + plotH}
            stroke={v === 0 ? colors.textMuted : colors.cardBorder}
            strokeWidth={v === 0 ? 0.6 : 0.3}
            strokeDasharray={v === 0 ? '' : '2 3'} />
          <Text x={sx(v)} y={pad.top + plotH + 8}
            style={{ fontSize: 5, fill: colors.textMuted }}>{v}</Text>
        </G>
      ))}
      {yTicks.map(v => (
        <G key={`yt${v}`}>
          <Line x1={pad.left} y1={sy(v)} x2={pad.left + plotW} y2={sy(v)}
            stroke={colors.cardBorder} strokeWidth={0.3} strokeDasharray="2 3" />
          <Text x={pad.left - 4} y={sy(v) + 2}
            style={{ fontSize: 5, fill: colors.textMuted }}>{v}</Text>
        </G>
      ))}
      <Rect x={pad.left} y={pad.top} width={plotW} height={plotH}
        fill="none" stroke={colors.cardBorder} strokeWidth={0.6} />
      {valid.map((p, i) => {
        const raw = p.relSide as number;
        const plotSide = isLefty ? -raw : raw;
        const x = sx(plotSide);
        const y = sy(p.relHeight as number);
        if (x < pad.left - 4 || x > pad.left + plotW + 4) return null;
        if (y < pad.top - 4  || y > pad.top + plotH + 4)  return null;
        return (
          <Circle key={i} cx={x} cy={y} r={2.4}
            fill={pitchColor(p.pitchType)} opacity={0.85}
            stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
        );
      })}
    </Svg>
  );
}

/* ─── Break & Spin Table (header + rows, no surrounding bubble chrome) ─── */
function PdfBreakSpinTable({ rows }: { rows: ArsenalRow[] }) {
  const cellHead = {
    fontSize: 7, fontFamily: 'Helvetica-Bold', color: colors.black,
    textAlign: 'center' as const, letterSpacing: 0.4,
  };
  const cellData = {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy,
    textAlign: 'center' as const,
  };
  const cellMuted = {
    fontSize: 6, color: colors.textMuted,
  };
  /* Column widths sized so the 7-column row fits on a landscape page: a
     fixed-width left "Pitch" label + 6 evenly-shared metric cells. */
  const colW = ['12%', '14.66%', '14.66%', '14.66%', '14.66%', '14.66%', '14.7%'] as const;
  const headers = ['Pitch', 'Avg Velo', 'H-Break', 'V-Break', 'Spin', 'Tilt', 'Spin Eff'];
  return (
    <View>
      {/* Header row */}
      <View style={{
        flexDirection: 'row',
        paddingVertical: 5, paddingHorizontal: 4,
        borderBottom: `0.6px solid ${colors.cardBorder}`,
      }}>
        {headers.map((h, i) => (
          <Text key={h} style={[cellHead, { width: colW[i], textAlign: i === 0 ? 'left' : 'center', textTransform: 'uppercase' }]}>
            {h}
          </Text>
        ))}
      </View>
      {/* Data rows */}
      {rows.map((r) => (
        <View key={r.pitchType} style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 6, paddingHorizontal: 4,
          borderBottom: `0.4px solid ${colors.cardBorder}`,
        }}>
          <Text style={{
            width: colW[0],
            fontSize: 9, fontFamily: 'Helvetica-Bold',
            color: pitchColor(r.pitchType),
            textAlign: 'left',
          }}>
            {PITCH_SHORT[r.pitchType] || r.pitchType}
          </Text>
          <Text style={[cellData, { width: colW[1] }]}>
            {r.avgVelo > 0 ? r.avgVelo.toFixed(1) : '—'}
            {r.avgVelo > 0 && <Text style={cellMuted}> mph</Text>}
          </Text>
          <Text style={[cellData, { width: colW[2] }]}>
            {r.avgHBreak > 0 ? '+' : ''}{r.avgHBreak.toFixed(1)}"
          </Text>
          <Text style={[cellData, { width: colW[3] }]}>
            {r.avgIVB > 0 ? '+' : ''}{r.avgIVB.toFixed(1)}"
          </Text>
          <Text style={[cellData, { width: colW[4] }]}>
            {Math.round(r.avgSpin)}
            <Text style={cellMuted}> rpm</Text>
          </Text>
          <Text style={[cellData, { width: colW[5] }]}>
            {r.tilt}
          </Text>
          <Text style={[cellData, { width: colW[6] }]}>
            {Math.round(r.spinEff)}%
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ─── Release & Extension Table ─── */
function PdfReleaseExtensionTable({ rows }: { rows: ArsenalRow[] }) {
  const cellHead = {
    fontSize: 7, fontFamily: 'Helvetica-Bold', color: colors.black,
    textAlign: 'center' as const, letterSpacing: 0.4,
  };
  const cellData = {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy,
    textAlign: 'center' as const,
  };
  const cellMuted = {
    fontSize: 6, color: colors.textMuted,
  };
  const colW = ['14%', '28.66%', '28.66%', '28.68%'] as const;
  const headers = ['Pitch', 'Extension', 'Rel Height', 'Rel Side'];
  return (
    <View>
      <View style={{
        flexDirection: 'row',
        paddingVertical: 5, paddingHorizontal: 4,
        borderBottom: `0.6px solid ${colors.cardBorder}`,
      }}>
        {headers.map((h, i) => (
          <Text key={h} style={[cellHead, { width: colW[i], textAlign: i === 0 ? 'left' : 'center', textTransform: 'uppercase' }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.pitchType} style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 6, paddingHorizontal: 4,
          borderBottom: `0.4px solid ${colors.cardBorder}`,
        }}>
          <Text style={{
            width: colW[0],
            fontSize: 9, fontFamily: 'Helvetica-Bold',
            color: pitchColor(r.pitchType),
            textAlign: 'left',
          }}>
            {PITCH_SHORT[r.pitchType] || r.pitchType}
          </Text>
          <Text style={[cellData, { width: colW[1] }]}>
            {r.avgExt > 0 ? r.avgExt.toFixed(1) : '—'}
            {r.avgExt > 0 && <Text style={cellMuted}> ft</Text>}
          </Text>
          <Text style={[cellData, { width: colW[2] }]}>
            {r.avgRelHeight > 0 ? r.avgRelHeight.toFixed(1) : '—'}
            {r.avgRelHeight > 0 && <Text style={cellMuted}> ft</Text>}
          </Text>
          <Text style={[cellData, { width: colW[3] }]}>
            {r.avgRelSide !== 0 ? r.avgRelSide.toFixed(1) : '—'}
            {r.avgRelSide !== 0 && <Text style={cellMuted}> ft</Text>}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ─── Coach Grades — one section card (title + aggregate score + chips) ───
   Mirrors the in-app `MechanicalSummaryStrip`: a tight column with the
   section title up top, the average of every populated item score in
   the middle, and a wrap of every selected descriptor chip below.
   Renders one card per section in the Coach Grades page grid. */
function PdfCoachGradeSection({
  title,
  avg,
  chips,
}: {
  title: string;
  avg: number | null;
  chips: string[];
}) {
  /* Tier color mirrors the in-app `scoreColor` 3-band scale
     (≥60 elite, 40-59 above avg, <40 developing) so the PDF reads
     the same as on screen. */
  const tone =
    avg === null   ? colors.cardBorder
    : avg >= 60    ? colors.elite
    : avg >= 40    ? colors.aboveAvg
    : colors.developing;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Section title — uppercase eyebrow, centered. */}
      <Text style={{
        fontSize: 8, fontFamily: 'Helvetica-Bold',
        color: colors.black, letterSpacing: 0.8,
        textTransform: 'uppercase', textAlign: 'center',
        lineHeight: 1.15,
      }}>
        {title}
      </Text>

      {/* Aggregate score */}
      <Text style={{
        fontSize: 16, fontFamily: 'Helvetica-Bold',
        color: tone, textAlign: 'center',
        lineHeight: 1.05, letterSpacing: -0.2,
      }}>
        {avg ?? '—'}
      </Text>

      {/* Selected descriptor chips (flattened across every item in
          the section). Each chip is a small pill. */}
      {chips.length > 0 && (
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap',
          gap: 2, justifyContent: 'center', marginTop: 2,
        }}>
          {chips.map((tag, i) => (
            <View key={`${tag}-${i}`} style={{
              backgroundColor: colors.tableBg,
              border: `0.5px solid ${colors.cardBorder}`,
              borderRadius: 6,
              paddingHorizontal: 4, paddingVertical: 1,
            }}>
              <Text style={{ fontSize: 6.5, color: colors.black, fontFamily: 'Helvetica-Bold' }}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ─── Section header (small label above each PDF section) ─── */
function PdfSectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 6, marginTop: 4 }}>
      <Text style={{
        fontSize: 10, fontFamily: 'Helvetica-Bold',
        color: colors.black, letterSpacing: 1,
        textTransform: 'uppercase',
      }}>
        {title}
      </Text>
      {subtitle && (
        <Text style={{
          fontSize: 7, color: colors.textMuted, marginTop: 1,
        }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/* ─── Document body ─── */
export function PitchingReportPages({ data }: { data: PitchingPdfData }) {
  const { player, arsenal, totalPitches, pitchNotes, pitches, pitchingGrades } = data;

  /* Build per-section aggregate score + flattened chip list from the
     saved Coach Grades. Sections with no data still render (empty
     score + no chips) so the Coach Grades page consistently shows
     every section in the taxonomy. */
  const coachGradeSummary = (() => {
    const grades = pitchingGrades ?? {};
    return PITCHING_GRADE_SECTIONS.map((section) => {
      const itemScores = section.items
        .map((it) => grades[pitchingGradeKey(section.key, it.key)]?.score)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avg = itemScores.length === 0
        ? null
        : Math.round(itemScores.reduce((a, b) => a + b, 0) / itemScores.length);
      const chips = section.items.flatMap((it) => {
        const entry = grades[pitchingGradeKey(section.key, it.key)];
        return entry?.options ?? [];
      });
      return { key: section.key, title: section.title, avg, chips };
    });
  })();
  const hasAnyGrades = coachGradeSummary.some(
    (s) => s.avg !== null || s.chips.length > 0,
  );

  // Always show the 4 main pitch types in the bubble row, even if no data,
  // matching the in-app `arsenalCards` build. Any extra types in the
  // arsenal (Sinker, Cutter, etc.) get appended after the main four.
  const mainTypes = ['Fastball', 'Curveball', 'Slider', 'ChangeUp'];
  const arsenalCards: ArsenalRow[] = mainTypes.map(t => {
    const existing = arsenal.find(a => a.pitchType === t);
    return existing || {
      pitchType: t, count: 0, pct: 0, avgVelo: 0, maxVelo: 0, minVelo: 0,
      avgSpin: 0, avgHBreak: 0, avgIVB: 0, avgExt: 0,
      avgRelHeight: 0, avgRelSide: 0, tilt: '—', spinEff: 0,
    };
  });
  for (const a of arsenal) {
    if (!mainTypes.includes(a.pitchType)) arsenalCards.push(a);
  }

  const hasData = arsenal.length > 0;

  return (
    <>
      {/* ── Page 2: Pitch Type Bubbles + Plots + Notes ─────────────────
          Top `PdfPlayerInfoBar` retired — the Cover Page already
          carries the player's name + vitals on PDF page 1, so
          repeating the black bar here was redundant. The pitch
          report header below now leads the page. */}
      <Page size="LETTER" orientation="landscape" style={s.page}>
        {!hasData ? (
          <View style={{ paddingTop: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              No Trackman pitching data available.
            </Text>
          </View>
        ) : (
          <>
            {/* Pitch Report header with pitch-count tag */}
            <View style={{
              flexDirection: 'row', alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 6, marginTop: 2,
            }}>
              <Text style={{
                fontSize: 12, fontFamily: 'Helvetica-Bold',
                color: colors.black, letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}>
                Pitch Report
              </Text>
              <Text style={{
                fontSize: 7, color: colors.textMuted,
                letterSpacing: 1.4, textTransform: 'uppercase',
              }}>
                {totalPitches} pitches
              </Text>
            </View>

            {/* Pitch Type Bubbles row */}
            <View style={{
              flexDirection: 'row', gap: 6,
              marginBottom: 8,
            }}>
              {arsenalCards.map(r => (
                <PdfArsenalCard key={r.pitchType} row={r} />
              ))}
            </View>

            {/* Plots grid — Movement · Location · Release Point */}
            <View style={{
              flexDirection: 'row', gap: 6, marginBottom: 8,
            }}>
              <View style={{
                flex: 1,
                backgroundColor: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                borderRadius: 8, padding: 6,
              }}>
                <PlotPaneHeader label="Movement · Pitcher's View" />
                <View style={{ aspectRatio: 240 / 220, width: '100%' }}>
                  <PdfMovementPlot pitches={pitches} />
                </View>
              </View>
              <View style={{
                flex: 1,
                backgroundColor: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                borderRadius: 8, padding: 6,
              }}>
                <PlotPaneHeader label="Location · Catcher's View" />
                <View style={{ aspectRatio: 240 / 220, width: '100%' }}>
                  <PdfLocationPlot pitches={pitches} />
                </View>
              </View>
              <View style={{
                flex: 1,
                backgroundColor: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                borderRadius: 8, padding: 6,
              }}>
                <PlotPaneHeader label="Release Point · Pitcher's View" />
                <View style={{ aspectRatio: 240 / 220, width: '100%' }}>
                  <PdfReleasePointPlot pitches={pitches} />
                </View>
              </View>
            </View>

            {/* Pitching Notes bubble — only when notes exist (same gate the
                in-app Pitching Notes box uses). */}
            {pitchNotes && (
              <PdfNotesBox label="PITCHING NOTES" text={pitchNotes} />
            )}
          </>
        )}
      </Page>

      {/* ── Page 3: Trackman Break & Spin + Release & Extension ──── */}
      {hasData && (
        <Page size="LETTER" orientation="landscape" style={s.page}>
          <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

          <PdfSectionTitle title="Trackman" subtitle="Break & Spin · Release & Extension" />

          {/* Break & Spin */}
          <View style={{
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8, padding: 10, marginBottom: 10,
          }}>
            <Text style={{
              fontSize: 9, fontFamily: 'Helvetica-Bold',
              color: colors.black, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Break & Spin
            </Text>
            <PdfBreakSpinTable rows={arsenal} />
          </View>

          {/* Release & Extension */}
          <View style={{
            backgroundColor: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 8, padding: 10,
          }}>
            <Text style={{
              fontSize: 9, fontFamily: 'Helvetica-Bold',
              color: colors.black, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Release & Extension
            </Text>
            <PdfReleaseExtensionTable rows={arsenal} />
          </View>
        </Page>
      )}

      {/* ── Page 4: Coach Grades (per-section aggregate + selected chips) ──
          Mirrors the in-app Pitching tab's `MechanicalSummaryStrip` —
          one card per Coach Grade section showing the section title,
          the averaged 20-80 score across that section's items, and
          every descriptor chip the coach selected. Page only renders
          when at least one section has data (score OR chips). */}
      {hasAnyGrades && (
        <Page size="LETTER" orientation="landscape" style={s.page}>
          <PdfSectionTitle
            title="Mechanical Grades"
            subtitle="Per-section aggregate score + selected descriptors"
          />
          {/* 3 × 3 grid — 9 sections fit comfortably across 3 rows
              on landscape Letter without crowding. */}
          <View style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2].map((rowIdx) => (
              <View
                key={rowIdx}
                style={{ flexDirection: 'row', gap: 6 }}
              >
                {coachGradeSummary
                  .slice(rowIdx * 3, rowIdx * 3 + 3)
                  .map((sec) => (
                    <PdfCoachGradeSection
                      key={sec.key}
                      title={sec.title}
                      avg={sec.avg}
                      chips={sec.chips}
                    />
                  ))}
              </View>
            ))}
          </View>
        </Page>
      )}
    </>
  );
}
