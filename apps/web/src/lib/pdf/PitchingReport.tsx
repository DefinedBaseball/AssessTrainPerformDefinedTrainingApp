/**
 * Pitching PDF Report — mirrors the in-app Pitching tab layout:
 *   Page 1 — Cover Page (rendered by the parent Document).
 *   Page 2 — Pitch Type Bubbles row, Movement / Location / Release Point
 *            plots, Pitching Notes.
 *   Page 3 — Trackman Break & Spin and Release & Extension tables.
 *
 * Interior pages render in landscape LETTER so the deck shares the
 * same canvas as the Cover Page.
 */
import React from 'react';
import { Page, View, Text, Svg, Circle, Line, Rect, G } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PdfNotesBox, PageFooter, ReportHeader, REPORT_HEADER_H, estimateNotesHeight,
} from './components';

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
function pitchColor(type: string): string {
  return PITCH_COLORS[type] || PITCH_COLORS.Unknown;
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
        if (x < pad.left || x > pad.left + plotW) return null;
        if (y < pad.top  || y > pad.top + plotH)  return null;
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
        if (x < pad.left || x > pad.left + plotW) return null;
        if (y < pad.top  || y > pad.top + plotH)  return null;
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
        if (x < pad.left || x > pad.left + plotW) return null;
        if (y < pad.top  || y > pad.top + plotH)  return null;
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
function PdfBreakSpinTable({ rows, compact = false }: { rows: ArsenalRow[]; compact?: boolean }) {
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
  /* A fixed-width left "Pitch" label + 6 evenly-shared metric cells.
     No Spin Efficiency column: TrackMan's export has no such field, and
     the number this table printed was made up from break and spin. */
  const colW = ['12%', '14.66%', '14.66%', '14.67%', '14.67%', '14.67%', '14.67%'] as const;
  const headers = ['Pitch', 'Max Velo', 'Avg Velo', 'H-Break', 'V-Break', 'Spin', 'Tilt'];
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
          /* 6 -> 3.5: with two 8-row tables sharing this page, the taller
             rows pushed it over a landscape page and the second table spilled
             onto a 4th page. Saves ~5pt/row across 16 rows, which is more
             than the ~84pt overflow an 8-pitch-type report produced. Most
             pitchers show 3-5 types and were never close to the limit; this
             keeps the busiest reports on one page too. */
          paddingVertical: compact ? ROW_PAD_COMPACT : 3.5, paddingHorizontal: 4,
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
          {/* Max Velo — same `r.maxVelo` the in-app table shows, guarded the
              same way (computeArsenal yields 0 for a type with no readings). */}
          <Text style={[cellData, { width: colW[1] }]}>
            {r.maxVelo > 0 ? r.maxVelo.toFixed(1) : '—'}
            {r.maxVelo > 0 && <Text style={cellMuted}> mph</Text>}
          </Text>
          <Text style={[cellData, { width: colW[2] }]}>
            {r.avgVelo > 0 ? r.avgVelo.toFixed(1) : '—'}
            {r.avgVelo > 0 && <Text style={cellMuted}> mph</Text>}
          </Text>
          <Text style={[cellData, { width: colW[3] }]}>
            {r.avgHBreak > 0 ? '+' : ''}{r.avgHBreak.toFixed(1)}"
          </Text>
          <Text style={[cellData, { width: colW[4] }]}>
            {r.avgIVB > 0 ? '+' : ''}{r.avgIVB.toFixed(1)}"
          </Text>
          <Text style={[cellData, { width: colW[5] }]}>
            {Math.round(r.avgSpin)}
            <Text style={cellMuted}> rpm</Text>
          </Text>
          <Text style={[cellData, { width: colW[6] }]}>
            {r.tilt}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ─── Release & Extension Table ─── */
function PdfReleaseExtensionTable({ rows, compact = false }: { rows: ArsenalRow[]; compact?: boolean }) {
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
          /* 6 -> 3.5: with two 8-row tables sharing this page, the taller
             rows pushed it over a landscape page and the second table spilled
             onto a 4th page. Saves ~5pt/row across 16 rows, which is more
             than the ~84pt overflow an 8-pitch-type report produced. Most
             pitchers show 3-5 types and were never close to the limit; this
             keeps the busiest reports on one page too. */
          paddingVertical: compact ? ROW_PAD_COMPACT : 3.5, paddingHorizontal: 4,
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

/* ─── One-page layout (landscape LETTER, s.page padding) ─────────────────
   Row 1: Pitch Metrics beside Release Metrics.
   Row 2: Movement · Location · Release Point plots.
   Row 3: Pitching notes.
   The page is budgeted before drawing: long notes step their type down
   (to 8pt) before the plots shrink, so everything lands on the one page. */
const CONTENT_W = 792 - 36 * 2;      // 720
const CONTENT_H = 612 - 24 - 36 - REPORT_HEADER_H;   // below the page title
const GAP = 8;
const ROW_PAD_COMPACT = 2.5;
const TABLE_ROW_H = 16;              // 9pt cell + compact padding + hairline
const TABLE_CHROME = 26 + 16;        // card padding + title + header row
const PLOT_CHROME = 12 + 12;         // card padding + plot header
/* Plot height is also capped by its card's width (plots keep 240:220). */
const PLOT_W = (CONTENT_W - GAP * 2) / 3 - 12;
const PLOT_MAX = Math.floor(PLOT_W * (220 / 240));
const PLOT_GOOD = 150;
const PLOT_MIN = 110;

function planLayout(typeCount: number, notes: string) {
  const tablesH = TABLE_CHROME + Math.max(1, typeCount) * TABLE_ROW_H;
  const free = CONTENT_H - tablesH - GAP - PLOT_CHROME;
  const roomAt = (fontSize: number) => {
    const nh = estimateNotesHeight(notes, fontSize, CONTENT_W - 24);
    return free - (nh ? nh + GAP : 0);
  };
  for (const fontSize of [9, 8.5, 8]) {
    if (roomAt(fontSize) >= PLOT_GOOD) return { plotH: Math.min(PLOT_MAX, roomAt(fontSize)), fontSize };
  }
  for (const fontSize of [8, 7.5]) {
    if (roomAt(fontSize) >= PLOT_MIN) return { plotH: Math.min(PLOT_MAX, roomAt(fontSize)), fontSize };
  }
  return { plotH: PLOT_MIN, fontSize: 7.5 };
}

const card = {
  backgroundColor: colors.cardBg,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 8,
};
const cardTitle = {
  fontSize: 8, fontFamily: 'Helvetica-Bold', color: colors.black,
  letterSpacing: 1, textTransform: 'uppercase' as const,
};

/* ─── Document body ─── */
export function PitchingReportPages({ data }: { data: PitchingPdfData }) {
  const { player, arsenal, totalPitches, pitchNotes, pitches, reportDate } = data;
  const notes = pitchNotes ?? '';
  const hasData = arsenal.length > 0;
  const { plotH, fontSize } = planLayout(arsenal.length, notes);

  const plotCard = (label: string, plot: React.ReactNode) => (
    <View style={[card, { flex: 1, padding: 6 }]}>
      <PlotPaneHeader label={label} />
      <View style={{ height: plotH, width: '100%' }}>{plot}</View>
    </View>
  );

  return (
    <Page size="LETTER" orientation="landscape" style={s.page}>
      <ReportHeader title="Pitching Report" subtitle="Pitch metrics, movement & release" />
      {!hasData ? (
        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 20, marginBottom: 12 }}>
          No TrackMan pitching data on this report.
        </Text>
      ) : (
        <>
          {/* Pitch Metrics · Release Metrics */}
          <View wrap={false} style={{ flexDirection: 'row', gap: GAP, marginBottom: GAP }}>
            <View style={[card, { flex: 1.65, padding: 8 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <Text style={cardTitle}>Pitch Metrics</Text>
                <Text style={{ fontSize: 6.5, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {totalPitches} pitches
                </Text>
              </View>
              <PdfBreakSpinTable rows={arsenal} compact />
            </View>
            <View style={[card, { flex: 1, padding: 8 }]}>
              <Text style={[cardTitle, { marginBottom: 4 }]}>Release Metrics</Text>
              <PdfReleaseExtensionTable rows={arsenal} compact />
            </View>
          </View>

          {/* Movement · Location · Release Point */}
          <View wrap={false} style={{ flexDirection: 'row', gap: GAP, marginBottom: notes.trim() ? GAP : 0 }}>
            {plotCard("Movement · Pitcher's View", <PdfMovementPlot pitches={pitches} />)}
            {plotCard("Location · Catcher's View", <PdfLocationPlot pitches={pitches} />)}
            {plotCard("Release Point · Pitcher's View", <PdfReleasePointPlot pitches={pitches} />)}
          </View>
        </>
      )}

      {notes.trim() !== '' && <PdfNotesBox label="PITCHING NOTES" text={notes} fontSize={fontSize} />}

      <PageFooter player={player} reportTitle="Pitching Assessment" date={reportDate} />
    </Page>
  );
}
