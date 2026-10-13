/**
 * Hitting PDF Report — one landscape page after the cover:
 *
 *   1. Vendor bubbles — Blast Motion, HitTrax, Full Swing — each only when
 *      the report has that vendor's data, with the same columns, labels
 *      and colours as the Hitting tab.
 *   2. Spray chart beside the strike zone damage map (the map only when
 *      the report's HitTrax data carries zone numbers).
 *   3. Hitting notes.
 *
 * Everything is sized to fit the one page: long notes shrink the charts
 * first, then the note text.
 */
import React from 'react';
import { Page, View, Text, Svg, Path, Line, Polygon, Rect, Circle, G } from '@react-pdf/renderer';
import { s, colors } from './theme';
import { PageFooter, PdfNotesBox, ReportHeader, REPORT_HEADER_H, gradeTone, estimateNotesHeight } from './components';
import {
  buildZoneTones, TONE_COLD, TONE_MID, TONE_HOT, type ZoneStat, type ZoneTone,
} from '@/app/athletes/[id]/components/StrikeZoneDamageView';

/* ─── Public types ─── */

export interface SprayDot {
  angle: number;
  distance: number;
  exitVelo?: number;
  /** HitTrax categorical color: 1=GB (red), 2=LD (blue), 3=FB (green).
   *  When set, overrides the EV-based color ramp so HitTrax dots in the
   *  PDF read the same as on screen. */
  ballTypeCode?: number;
}

/** One column of a vendor bubble. `grade` (20-80) colours the value. */
export interface VendorCell { label: string; display: string; unit?: string; grade: number | null }

export interface HittingVendor {
  key: 'blast' | 'hittrax' | 'fullswing';
  title: string;
  cells: VendorCell[];
}

export interface HittingPdfData {
  player: any;
  reportDate: string;
  /** Vendors with data on this report, in print order. */
  vendors: HittingVendor[];
  sprayDots: SprayDot[];
  /** Per-zone averages; empty when the report has no zone numbers. */
  zoneStats: ZoneStat[];
  /** The report's hitting notes (HTML or plain text). */
  notes: string;
}

/* ─── Page geometry (landscape LETTER, s.page padding) ─── */
const CONTENT_W = 792 - 36 * 2;      // 720
const CONTENT_H = 612 - 24 - 36 - REPORT_HEADER_H;   // below the page title
const GAP = 8;
const VENDOR_H = 43;                 // one vendor bubble, title + one row
const ZONE_W = 300;                  // strike zone card width
const CHART_MAX = 240;
const CHART_GOOD = 192;              // charts read well from here up
const CHART_MIN = 136;

const notesHeight = (notes: string, fontSize: number) => estimateNotesHeight(notes, fontSize, CONTENT_W - 24);

/** Chart height and note size that fit the page. Long notes first step
 *  their type down a little (to 8pt) to keep the charts a readable size,
 *  and only then let the charts shrink. */
function planLayout(vendorCount: number, notes: string) {
  const free = CONTENT_H - vendorCount * (VENDOR_H + GAP);
  const roomAt = (fontSize: number) => {
    const nh = notesHeight(notes, fontSize);
    return free - (nh ? nh + GAP : 0);
  };
  for (const fontSize of [9, 8.5, 8]) {
    if (roomAt(fontSize) >= CHART_GOOD) return { chartH: Math.min(CHART_MAX, roomAt(fontSize)), fontSize };
  }
  for (const fontSize of [8, 7.5]) {
    const room = roomAt(fontSize);
    if (room >= CHART_MIN) return { chartH: Math.min(CHART_MAX, room), fontSize };
  }
  // Very long notes: smallest type, minimum charts; the notes may run on.
  return { chartH: CHART_MIN, fontSize: 7.5 };
}

/* ─── Shared card chrome ─── */
const card = {
  backgroundColor: colors.cardBg,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 8,
};
const cardTitle = {
  fontSize: 8, fontFamily: 'Helvetica-Bold', color: colors.black,
  letterSpacing: 1.2, textTransform: 'uppercase' as const,
};

/* ─── Vendor bubble: title + one row of columns (the Hitting tab's table) ─── */
function VendorBubble({ vendor }: { vendor: HittingVendor }) {
  return (
    <View wrap={false} style={[card, { height: VENDOR_H, paddingVertical: 5, paddingHorizontal: 10, marginBottom: GAP }]}>
      <Text style={[cardTitle, { fontSize: 7, marginBottom: 3 }]}>{vendor.title}</Text>
      <View style={{ flexDirection: 'row', borderTop: `0.5px solid ${colors.cardBorder}`, paddingTop: 3 }}>
        {vendor.cells.map((c) => (
          <View key={c.label} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 5.2, fontFamily: 'Helvetica-Bold', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1, textAlign: 'center' }}>
              {c.label}
            </Text>
            <Text style={{
              fontSize: 9.5, fontFamily: 'Helvetica-Bold',
              color: c.display === '—' ? colors.textMuted : c.grade !== null ? gradeTone(c.grade) : colors.navy,
            }}>
              {c.display}
              {c.unit && c.display !== '—' ? <Text style={{ fontSize: 5.3, fontFamily: 'Helvetica', color: colors.textMuted }}> {c.unit}</Text> : null}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}


/* ─────────────────────────────────────────────────────────────────────────────
   PdfSprayChart — static SVG snapshot of the spray chart, white-paper styled.
   Mirrors SprayChartView's geometry: home plate at bottom-center, ±45° foul
   rails, distance arcs at 120 / 200 / 280 / 360 ft, dots colored by EV.
   ─────────────────────────────────────────────────────────────────────────── */
function PdfSprayChart({ dots }: { dots: SprayDot[] }) {
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
  const r45 = Math.cos(Math.PI / 4); // = sin too

  // Dot color:
  //   • HitTrax dots (have ballTypeCode): GB red / LD blue / FB green —
  //     mirrors the in-app SprayChartView's HitTrax mode.
  //   • Otherwise (Full Swing dots): EV-based red/yellow/green ramp.
  const dotColor = (d: SprayDot) => {
    if (d.ballTypeCode != null) {
      if (d.ballTypeCode === 1) return '#EF4444'; // GB
      if (d.ballTypeCode === 2) return '#3B82F6'; // LD
      if (d.ballTypeCode === 3) return '#22C55E'; // FB
    }
    const ev = d.exitVelo;
    if (ev === undefined) return '#94A3B8';
    if (ev >= 95) return '#16A34A';
    if (ev >= 85) return '#CA8A04';
    return '#DC2626';
  };

  /* viewBox is cropped from the top so the action fan (which tops out
     around y≈200 at the d=360 arc) sits near the top of the bubble
     instead of sinking to the bottom half. We chop the top 130 units of
     empty sky, leaving a small breathing margin above the deepest arc. */
  const cropTop = 130;
  const viewH = H - cropTop;
  return (
    <Svg viewBox={`0 ${cropTop} ${W} ${viewH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      {/* outer field background */}
      <Rect x={0} y={cropTop} width={W} height={viewH} fill={colors.cardBg} />

      {/* distance arcs */}
      {distArcs.map(d => {
        const r = d * scale;
        const lx = cx - r * r45, ly = cy - r * r45;
        const rx = cx + r * r45, ry = cy - r * r45;
        return (
          <G key={d}>
            <Path d={`M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`}
              fill="none" stroke={colors.cardBorder} strokeWidth={0.7} strokeDasharray="3 4" />
          </G>
        );
      })}

      {/* foul rails */}
      <Line x1={cx} y1={cy} x2={cx - maxDist * scale * r45} y2={cy - maxDist * scale * r45}
        stroke={colors.textMuted} strokeWidth={1.1} />
      <Line x1={cx} y1={cy} x2={cx + maxDist * scale * r45} y2={cy - maxDist * scale * r45}
        stroke={colors.textMuted} strokeWidth={1.1} />

      {/* bases (90 ft × 0.72 stylized) */}
      {(() => {
        const baseDist = 90 * scale * 0.72;
        const bases: [number, number][] = [
          [cx, cy - baseDist],
          [cx - baseDist * 0.7, cy - baseDist * 0.5],
          [cx + baseDist * 0.7, cy - baseDist * 0.5],
        ];
        return bases.map(([bx, by], i) => {
          const half = 4;
          const pts = `${bx},${by - half} ${bx + half},${by} ${bx},${by + half} ${bx - half},${by}`;
          return <Polygon key={i} points={pts} fill={colors.textMuted} stroke={colors.navy} strokeWidth={0.5} />;
        });
      })()}

      {/* home plate */}
      <Polygon
        points={`${cx},${cy - 6} ${cx + 6},${cy - 2} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4} ${cx - 6},${cy - 2}`}
        fill={colors.navy} stroke={colors.navy} strokeWidth={0.5} />

      {/* dots */}
      {dots.map((d, i) => {
        const [x, y] = toXY(d.angle, d.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const fill = dotColor(d);
        return (
          <Circle key={i} cx={x} cy={y} r={3.5} fill={fill}
            stroke="rgba(0,0,0,0.4)" strokeWidth={0.4} />
        );
      })}

      {/* count caption */}
      <Polygon points="0,0 0,0 0,0" fill="transparent" />
    </Svg>
  );
}


/* ─────────────────────────────────────────────────────────────────────────────
   PdfStrikeZone — the Hitting tab's Strike Zone damage map: four out-of-zone
   quadrants (11 / 10 / 13 / 12) around the 3×3 strike zone (HitTrax zone
   numbers, right-to-left across each row), each showing avg exit velo and
   avg launch angle, coloured blue / white / red by EV rank with the app's
   own buildZoneTones. Pitcher's view, plate underneath.
   ─────────────────────────────────────────────────────────────────────────── */
const IN_ZONE_ROWS = [[3, 2, 1], [6, 5, 4], [9, 8, 7]];
const EMPTY_TONE: ZoneTone = { bg: '#F3F4F6', text: colors.textMuted, sub: colors.textMuted, muted: colors.textMuted };
const ZONE_FRAME = '#9AA1AC';

/** Avg EV over avg LA. `units` off in small cells -- the legend says mph / deg. */
function ZoneReading({ stat, tone, big, units = true }: { stat?: ZoneStat; tone: ZoneTone; big: number; units?: boolean }) {
  if (!stat || stat.n === 0) {
    return <Text style={{ fontSize: big * 0.8, color: tone.muted }}>—</Text>;
  }
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: big, fontFamily: 'Helvetica-Bold', color: tone.text }}>
        {stat.avgEv != null ? stat.avgEv.toFixed(1) : '—'}
        {units && <Text style={{ fontSize: big * 0.5, fontFamily: 'Helvetica', color: tone.muted }}> mph</Text>}
      </Text>
      <Text style={{ fontSize: big * 0.72, fontFamily: 'Helvetica-Bold', color: tone.sub }}>
        {stat.avgLa != null ? stat.avgLa.toFixed(1) : '—'}
        {units && <Text style={{ fontSize: big * 0.5, fontFamily: 'Helvetica', color: tone.muted }}> deg</Text>}
      </Text>
    </View>
  );
}

function PdfStrikeZone({ stats, width, height }: { stats: ZoneStat[]; width: number; height: number }) {
  const byZone = new Map(stats.map((z) => [z.zone, z]));
  const tones = buildZoneTones(stats);
  const toneFor = (zone: number) => tones.get(zone) ?? EMPTY_TONE;
  const totalBalls = stats.reduce((n, z) => n + z.n, 0);

  /* Figure 300:322 (taller than wide) with a plate 58% of its width below;
     sized to whichever of width or height runs out first. */
  const legendH = 10;
  const plateRatio = 0.58 * (92 / 200);
  const fw = Math.min(width, (height - legendH - 6) / (322 / 300 + plateRatio + 0.02));
  const fh = fw * (322 / 300);
  const box = { left: fw * 0.225, top: fh * 0.185, w: fw * 0.55, h: fh * 0.63 };
  const cellW = box.w / 3, cellH = box.h / 3;
  const big = Math.max(6.5, Math.min(11, cellW / 4.6, cellH / 3));
  const cellUnits = cellW >= 52;
  const tag = (zone: number, pos: Record<string, number>, tone: ZoneTone) => (
    <Text style={{ position: 'absolute', ...pos, fontSize: 4.8, fontFamily: 'Helvetica-Bold', color: tone.muted }}>{zone}</Text>
  );
  const quadrant = (zone: number, top: boolean, left: boolean) => {
    const tone = toneFor(zone);
    return (
      <View key={zone} style={{
        position: 'absolute', top: top ? 0 : fh / 2, left: left ? 0 : fw / 2, width: fw / 2, height: fh / 2,
        backgroundColor: tone.bg, alignItems: 'center',
        justifyContent: top ? 'flex-start' : 'flex-end',
        paddingTop: top ? 5 : 0, paddingBottom: top ? 0 : 5,
      }}>
        {tag(zone, { [top ? 'top' : 'bottom']: 3, [left ? 'left' : 'right']: 4 }, tone)}
        <ZoneReading stat={byZone.get(zone)} tone={tone} big={big} />
      </View>
    );
  };

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Legend: the colours are EV rank buckets, not mph thresholds. */}
      <View style={{ height: legendH, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <Text style={{ fontSize: 6, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          Avg mph · avg deg · {totalBalls} {totalBalls === 1 ? 'ball' : 'balls'}
        </Text>
        {([['Bottom 4', TONE_COLD], ['Middle 5', TONE_MID], ['Top 4', TONE_HOT]] as const).map(([label, tone]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: tone.bg }} />
            <Text style={{ fontSize: 6, color: colors.textMuted }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ width: fw, height: fh, position: 'relative', border: `0.8px solid ${ZONE_FRAME}`, borderRadius: 6, overflow: 'hidden' }}>
        {quadrant(11, true, true)}
        {quadrant(10, true, false)}
        {quadrant(13, false, true)}
        {quadrant(12, false, false)}
        <View style={{ position: 'absolute', left: fw / 2, top: 0, width: 0.6, height: fh, backgroundColor: ZONE_FRAME }} />
        <View style={{ position: 'absolute', top: fh / 2, left: 0, height: 0.6, width: fw, backgroundColor: ZONE_FRAME }} />
        <View style={{ position: 'absolute', left: box.left, top: box.top, width: box.w, height: box.h, border: `1.2px solid ${colors.textDark}` }}>
          {IN_ZONE_ROWS.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', height: cellH - (ri === 2 ? 2.4 : 0) }}>
              {row.map((zone, ci) => {
                const tone = toneFor(zone);
                return (
                  <View key={zone} style={{
                    width: cellW - (ci === 2 ? 2.4 : 0), backgroundColor: tone.bg,
                    alignItems: 'center', justifyContent: 'center',
                    borderRight: ci < 2 ? `0.5px solid ${ZONE_FRAME}` : undefined,
                    borderBottom: ri < 2 ? `0.5px solid ${ZONE_FRAME}` : undefined,
                    position: 'relative',
                  }}>
                    {tag(zone, { top: 1.5, left: 2 }, tone)}
                    <ZoneReading stat={byZone.get(zone)} tone={tone} big={big} units={cellUnits} />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* Home plate, pitcher's view. */}
      <Svg viewBox="0 0 200 92" style={{ width: fw * 0.58, height: fw * 0.58 * (92 / 200), marginTop: 4 }}>
        <Path d="M3 3 H197 V34 L100 89 L3 34 Z" fill="#F3F4F6" stroke={ZONE_FRAME} strokeWidth={3} />
      </Svg>
    </View>
  );
}

/* ─── Document body ─── */

export function HittingReportPages({ data }: { data: HittingPdfData }) {
  const { player, reportDate, vendors, sprayDots, zoneStats, notes } = data;
  const showZone = zoneStats.some((z) => z.n > 0);
  const { chartH, fontSize } = planLayout(vendors.length, notes);
  const inner = chartH - 14 - 12;    // card padding + title row
  const zoneInnerW = ZONE_W - 14;

  return (
    <Page size="LETTER" orientation="landscape" style={s.page}>
      <ReportHeader title="Hitting Report" subtitle="Swing, batted ball & strike zone" />
      {vendors.map((v) => <VendorBubble key={v.key} vendor={v} />)}

      <View wrap={false} style={{ flexDirection: 'row', gap: GAP, height: chartH, marginBottom: notes.trim() ? GAP : 0 }}>
        <View style={[card, { flex: 1, padding: 7 }]}>
          <Text style={[cardTitle, { fontSize: 7.5, height: 12 }]}>Spray Chart</Text>
          <View style={{ height: inner, width: '100%' }}>
            <PdfSprayChart dots={sprayDots} />
          </View>
        </View>
        {showZone && (
          <View style={[card, { width: ZONE_W, padding: 7 }]}>
            <Text style={[cardTitle, { fontSize: 7.5, height: 12 }]}>Strike Zone</Text>
            <PdfStrikeZone stats={zoneStats} width={zoneInnerW} height={inner} />
          </View>
        )}
      </View>

      {notes.trim() !== '' && <PdfNotesBox label="HITTING NOTES" text={notes} fontSize={fontSize} />}

      <PageFooter player={player} reportTitle="Hitting Assessment" date={reportDate} />
    </Page>
  );
}
