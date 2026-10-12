/**
 * Defense PDF Report — after the cover, ONE landscape page per position
 * (Catching, Infield, Outfield): that position's report as the profile
 * shows it, with its notes underneath.
 *
 *   Infielder / Outfielder Report — Defensive Skills (player figure with
 *                        Arm / Glove / Range callouts) · Arm Strength,
 *                        Glove, Range cards · Throwing Grades column.
 *   Catching Report    — Receiving (heat map + grades) beside the Throwing
 *                        & Blocking field diagram, then the Throwing
 *                        Grades row.
 *
 * The page is budgeted before drawing: long notes step their type down so
 * the report and its notes stay on the one page.
 *
 * Values are read the way DefenseTab reads them: the coach's manual
 * snapshot first, the older granular fields as fallback. Grades are on the
 * 20-80 scouting scale and coloured with the app's red / yellow / green
 * bands.
 */
import React from 'react';
import { Page, View, Text, Image, Svg, Rect, Line, Circle, G, Path, Polygon } from '@react-pdf/renderer';
import { s, colors } from './theme';
import { PageFooter, PdfNotesBox, gradeTone, estimateNotesHeight } from './components';
import { DEFENSE_COACH_GRADE_SECTIONS, type DefensePosition } from '@/app/athletes/[id]/helpers';

export type { DefensePosition };

export interface DefensePdfData {
  player: any;
  /** Positions to print, in order. Only positions with a report. */
  sections: DefensePosition[];
  /* Assessment blobs as stored on the report content (shape varies by
     report age, so they are read defensively below). */
  catchingAssessment: any | null;
  infieldAssessment: any | null;
  outfieldAssessment: any | null;
  /** Saved `{position}CoachGrades` blobs (the Throwing Grades panel). */
  coachGrades: Partial<Record<DefensePosition, Record<string, number | null>>>;
  catchingNotes: string | null;
  infieldNotes: string | null;
  outfieldNotes: string | null;
  reportDate: string;
  /** Player figures for the Defensive Skills panel, already coloured
   *  (PNG data URLs). Missing → the panel draws callouts only. */
  silhouettes?: Partial<Record<'infield' | 'outfield', string | null>>;
}

/* Titles match the profile's report headers. */
const TITLES: Record<DefensePosition, { title: string; subtitle: string; footer: string; notes: string; noun: string }> = {
  catching: { title: 'Catching Report',   subtitle: 'Receiving, throwing & blocking', footer: 'Catching Assessment', notes: 'CATCHING NOTES', noun: 'catching' },
  infield:  { title: 'Infielder Report',  subtitle: 'Arm strength, glove & range',    footer: 'Infield Assessment',  notes: 'INFIELD NOTES',  noun: 'infield' },
  outfield: { title: 'Outfielder Report', subtitle: 'Arm strength, glove & range',    footer: 'Outfield Assessment', notes: 'OUTFIELD NOTES', noun: 'outfield' },
};

/* Page budget (landscape LETTER, s.page padding). Report heights are the
   drawn content above the notes, header included. */
const CONTENT_W = 792 - 36 * 2;
const CONTENT_H = 612 - 24 - 36;
const GAP = 8;
const HEADER_H = 34;                 // ReportHeader
const FIELDING_ROW_H = 250;          // Defensive Skills · cards · Throwing Grades
const CATCHING_ROW_H = 270;          // Receiving · Throwing & Blocking
const GRADES_ROW_H = 72;             // Catching Throwing Grades card
const REPORT_H: Record<DefensePosition, number> = {
  catching: HEADER_H + CATCHING_ROW_H + GAP + GRADES_ROW_H + GAP,
  infield: HEADER_H + FIELDING_ROW_H + GAP,
  outfield: HEADER_H + FIELDING_ROW_H + GAP,
};

/** Largest note size (9pt down to 7.5pt) whose notes fit under the report. */
function notesFontSize(position: DefensePosition, notes: string | null): number {
  if (!notes) return 9;
  const room = CONTENT_H - REPORT_H[position];
  for (const size of [9, 8.5, 8, 7.5]) {
    if (estimateNotesHeight(notes, size, CONTENT_W - 24) <= room) return size;
  }
  return 7.5;
}

/* ── Small building blocks ─────────────────────────────────────────── */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v: number | null, digits: number) =>
  v === null ? '—' : Number.isInteger(v) && digits <= 1 ? String(v) : v.toFixed(digits);

function Card({ title, grade, children, style, inRow = true }: {
  title: string;
  grade?: number | null;
  children: React.ReactNode;
  style?: any;
  /** Share a row's width with its siblings. A card on its own line must
   *  not: flex 1 in the page's column collapses it to nothing. */
  inRow?: boolean;
}) {
  return (
    <View
      wrap={false}
      style={[{
        ...(inRow ? { flex: 1 } : {}),
        backgroundColor: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 8,
        padding: 10,
      }, style]}
    >
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `0.7px solid ${colors.cardBorder}`, paddingBottom: 5, marginBottom: 7,
      }}>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: colors.black, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {title}
        </Text>
        {grade !== undefined && (
          <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: grade === null ? colors.textMuted : gradeTone(grade) }}>
            {grade ?? '—'}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

/** One label / value line inside a card. `grade` colours the value. */
function Reading({ label, value, unit, grade }: {
  label: string;
  value: string;
  unit?: string;
  grade?: number | null;
}) {
  const color = grade !== undefined && grade !== null ? gradeTone(grade) : colors.navy;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 3 }}>
      <Text style={{ fontSize: 8.5, color: colors.textDark }}>{label}</Text>
      <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: value === '—' ? colors.textMuted : color }}>
        {value}
        {unit && value !== '—' ? <Text style={{ fontSize: 7, color: colors.textMuted, fontFamily: 'Helvetica' }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

/** Grades side by side in ONE row (the Throwing Grades panel). */
function GradeRowH({ rows }: { rows: { title: string; score: number | null }[] }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {rows.map((r, i) => (
        <View key={r.title} style={{
          flex: 1, alignItems: 'center', paddingVertical: 2, paddingHorizontal: 3,
          borderLeft: i > 0 ? `0.5px solid ${colors.cardBorder}` : undefined,
        }}>
          <Text style={{ fontSize: 6.3, fontFamily: 'Helvetica-Bold', color: colors.black, textAlign: 'center', textTransform: 'uppercase', marginBottom: 3 }}>
            {r.title}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: r.score === null ? colors.textMuted : gradeTone(r.score) }}>
            {r.score ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function hasAnyScore(rows: { score: number | null }[]) {
  return rows.some((r) => r.score !== null);
}

/** Receiving heat map: the 3×3 strike zone plus its 16-cell border ring,
 *  red / neutral / green per zone, same layout and indexing as the app's
 *  StrikeZoneHeatMap5x5. `height` in points; width follows the grid. */
function PdfHeatMap({ zoneColors, borderZoneColors, height }: {
  zoneColors: number[] | null | undefined;
  borderZoneColors: number[] | null | undefined;
  height: number;
}) {
  const COL = [28, 52, 52, 52, 28];
  const ROW = [32, 56, 56, 56, 32];
  const W = COL.reduce((a, b) => a + b, 0);
  const H = ROW.reduce((a, b) => a + b, 0);
  const colX: number[] = []; COL.reduce((acc, w) => { colX.push(acc); return acc + w; }, 0);
  const rowY: number[] = []; ROW.reduce((acc, h) => { rowY.push(acc); return acc + h; }, 0);
  const FILL: Record<number, string> = { 0: '#F87171', 1: '#E2E5E9', 2: '#4ADE80' };
  const cellAt = (r: number, c: number): number => {
    if (r >= 1 && r <= 3 && c >= 1 && c <= 3) return zoneColors?.[(r - 1) * 3 + (c - 1)] ?? 1;
    if (!borderZoneColors) return 1;
    let idx = -1;
    if (r === 0) idx = c;
    else if (r === 4) idx = 5 + c;
    else if (c === 0) idx = 10 + (r - 1);
    else if (c === 4) idx = 13 + (r - 1);
    return borderZoneColors[idx] ?? 1;
  };
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const inner = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      cells.push(
        <Rect key={`${r}-${c}`} x={colX[c] + 0.5} y={rowY[r] + 0.5} width={COL[c] - 1} height={ROW[r] - 1}
          fill={FILL[cellAt(r, c)] ?? FILL[1]} opacity={inner ? 0.85 : 0.6}
          stroke={colors.cardBorder} strokeWidth={0.6} />,
      );
    }
  }
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: height * (W / H), height }}>
      {cells}
      <Rect x={colX[1]} y={rowY[1]} width={COL[1] + COL[2] + COL[3]} height={ROW[1] + ROW[2] + ROW[3]}
        fill="none" stroke={colors.textDark} strokeWidth={1.2} />
    </Svg>
  );
}

/** Grades stacked top to bottom in equal slots, label over value -- the
 *  profile's Throwing Grades column on the Infielder / Outfielder Report. */
function GradeColumn({ rows }: { rows: { title: string; score: number | null }[] }) {
  return (
    <View style={{ flex: 1 }}>
      {rows.map((r, i) => (
        <View key={r.title} style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          borderBottom: i < rows.length - 1 ? `0.5px solid ${colors.cardBorder}` : undefined,
        }}>
          <Text style={{ fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: colors.black, textTransform: 'uppercase', marginBottom: 2 }}>
            {r.title}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: r.score === null ? colors.textMuted : gradeTone(r.score) }}>
            {r.score ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A value with a smaller unit after it, inside an <Svg>. react-pdf can't
 *  size an inline span, so the two are separate texts placed side by side
 *  (Helvetica-Bold digits are ~0.56em wide). `anchor` positions the pair. */
function SvgValue({ x, y, value, unit, size, color, anchor = 'start' }: {
  x: number; y: number; value: string; unit?: string; size: number; color: string;
  anchor?: 'start' | 'middle';
}) {
  const showUnit = !!unit && value !== '—';
  const unitSize = size * 0.6;
  const wv = value.length * size * 0.56;
  const wu = showUnit ? unit!.length * unitSize * 0.5 + 3 : 0;
  const x0 = anchor === 'middle' ? x - (wv + wu) / 2 : x;
  return (
    <G>
      <Text x={x0} y={y} style={{ fontSize: size, fontFamily: 'Helvetica-Bold' }} fill={color}>{value}</Text>
      {showUnit && (
        <Text x={x0 + wv + 3} y={y} style={{ fontSize: unitSize, fontFamily: 'Helvetica' }} fill={colors.textMuted}>{unit}</Text>
      )}
    </G>
  );
}

/* ── Defensive Skills: the player figure with callouts ─────────────────
   Same drawing as the profile's DefensiveSnapshot, in its 330 × 240 view
   (viewBox origin y = 36): figure at (8, 44) 180 × 174, callout chips at
   x 196, leader lines from each chip to its body anchor. The figure image
   arrives pre-coloured with the app's blue gradient (see generators). */
const SKILL_ANCHORS: Record<'infield' | 'outfield', { arm: [number, number]; glove: [number, number]; range: [number, number] }> = {
  infield:  { arm: [81, 117],  glove: [141, 190], range: [98, 209] },
  outfield: { arm: [104, 106], glove: [166, 64],  range: [92, 209] },
};
const SKILL_ACCENT = { infield: '#F59E0B', outfield: '#22C55E' } as const;

function DefensiveSkillsFigure({ mode, figure, width, callouts }: {
  mode: 'infield' | 'outfield';
  figure: string | null;
  width: number;
  callouts: { label: string; value: string; unit: string }[];
}) {
  const k = width / 330;
  const height = 240 * k;
  const a = SKILL_ANCHORS[mode];
  const accent = SKILL_ACCENT[mode];
  const chipY = [40, 135, 230];
  const anchors = [a.arm, a.glove, a.range];
  const lineY = [60, 155, 250];
  return (
    <View style={{ width, height, position: 'relative' }}>
      {figure && (
        <Image src={figure} style={{ position: 'absolute', left: 8 * k, top: (44 - 36) * k, width: 180 * k, height: 174 * k, objectFit: 'contain' }} />
      )}
      <Svg viewBox="0 36 330 240" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
        {anchors.map(([x, y], i) => (
          <Line key={`l${i}`} x1={196} y1={lineY[i]} x2={x} y2={y} stroke={accent} strokeWidth={0.9} strokeDasharray="3,2" opacity={0.7} />
        ))}
        {anchors.map(([x, y], i) => <Circle key={`d${i}`} cx={x} cy={y} r={3} fill={accent} />)}
        {callouts.map((c, i) => (
          <G key={c.label}>
            <Rect x={196} y={chipY[i]} width={122} height={40} rx={6} fill="#E9ECEF" stroke={colors.cardBorder} strokeWidth={0.8} />
            <Text x={205} y={chipY[i] + 15} style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }} fill={colors.textDark}>{c.label}</Text>
            <SvgValue x={205} y={chipY[i] + 33} value={c.value} unit={c.unit} size={16} color={colors.navy} />
          </G>
        ))}
      </Svg>
    </View>
  );
}

/* ── Catching: Throwing & Blocking field diagram ───────────────────────
   The profile's CatchingFieldDiagram in its 520 × 540 view: a 120-ft
   field (arcs every 30 ft), the dashed throw from home to second with
   Pop Time / Velocity / Exchange chips along it, and the Block Left /
   Center / Right chips fanned below the plate. */
const FIELD_W = 520, FIELD_H = 460, FIELD_VH = 540;
const FIELD_CX = FIELD_W / 2, FIELD_CY = FIELD_H - 24;
const CATCH_SCALE = (FIELD_H - 70) / 120;
function fieldXY(angleDeg: number, dist: number): [number, number] {
  const rad = ((90 - angleDeg) * Math.PI) / 180;
  const r = dist * CATCH_SCALE;
  return [FIELD_CX + r * Math.cos(rad), FIELD_CY - r * Math.sin(rad)];
}

function FieldChip({ x, y, label, value, unit, color }: {
  x: number; y: number; label: string; value: string; unit?: string; color: string;
}) {
  return (
    <G>
      <Rect x={x - 76} y={y - 29} width={152} height={58} rx={10} fill="#E9ECEF" stroke={colors.cardBorder} strokeWidth={1} />
      <Text x={x} y={y - 7} textAnchor="middle" style={{ fontSize: 12, fontFamily: 'Helvetica-Bold' }} fill={colors.textMuted}>{label}</Text>
      <SvgValue x={x} y={y + 18} value={value} unit={unit} size={22} color={color} anchor="middle" />
    </G>
  );
}

function PdfCatchingField({ popTime, velocity, exchange, left, center, right, height }: {
  popTime: number | null; velocity: number | null; exchange: number | null;
  left: number | null; center: number | null; right: number | null;
  height: number;
}) {
  const grid = '#B8BEC7';
  const rail = 390;   // foul line length (120 ft × scale)
  const r45 = Math.cos(Math.PI / 4);
  const [twobX, twobY] = fieldXY(0, 90 * Math.SQRT2);
  const bases: [number, number][] = [fieldXY(0, 90 * Math.SQRT2), fieldXY(-45, 90), fieldXY(45, 90)];
  const gradeColor = (g: number | null) => (g === null ? colors.textMuted : gradeTone(g));
  return (
    <Svg viewBox={`0 0 ${FIELD_W} ${FIELD_VH}`} style={{ width: height * (FIELD_W / FIELD_VH), height }}>
      {[30, 60, 90, 120].map((d) => {
        const r = d * CATCH_SCALE;
        const lx = FIELD_CX - r * r45, ly = FIELD_CY - r * r45;
        const rx = FIELD_CX + r * r45, ry = FIELD_CY - r * r45;
        return (
          <G key={d}>
            <Path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`} fill="none" stroke={grid} strokeWidth={1} strokeDasharray="3 5" />
            <Text x={rx + 8} y={ry + 4} style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }} fill={colors.textMuted}>{`${d}FT`}</Text>
          </G>
        );
      })}
      <Line x1={FIELD_CX} y1={FIELD_CY} x2={FIELD_CX - rail * r45} y2={FIELD_CY - rail * r45} stroke={grid} strokeWidth={1.4} />
      <Line x1={FIELD_CX} y1={FIELD_CY} x2={FIELD_CX + rail * r45} y2={FIELD_CY - rail * r45} stroke={grid} strokeWidth={1.4} />
      {bases.map(([bx, by], i) => (
        <Polygon key={i} points={`${bx},${by - 6} ${bx + 6},${by} ${bx},${by + 6} ${bx - 6},${by}`} fill="#C9CED6" stroke={colors.textMuted} strokeWidth={0.6} />
      ))}
      <Polygon points={`${FIELD_CX},${FIELD_CY - 6} ${FIELD_CX + 6},${FIELD_CY - 2.5} ${FIELD_CX + 5},${FIELD_CY + 4} ${FIELD_CX - 5},${FIELD_CY + 4} ${FIELD_CX - 6},${FIELD_CY - 2.5}`}
        fill="#C9CED6" stroke={colors.textMuted} strokeWidth={0.75} />

      {/* the throw: home → second */}
      <Line x1={FIELD_CX} y1={FIELD_CY - 8} x2={twobX} y2={twobY + 4} stroke={colors.textMuted} strokeWidth={1.6} strokeDasharray="7 5" />
      <Polygon points={`${twobX - 6},${twobY + 6} ${twobX + 6},${twobY + 6} ${twobX},${twobY - 2}`} fill={colors.textMuted} />

      <FieldChip x={FIELD_CX} y={fieldXY(0, 120)[1]} label="POP TIME" value={popTime !== null ? popTime.toFixed(2) : '—'} unit="s" color={colors.navy} />
      <FieldChip x={FIELD_CX} y={fieldXY(0, 60)[1] - 22} label="VELOCITY" value={velocity !== null ? velocity.toFixed(0) : '—'} unit="mph" color={colors.navy} />
      <FieldChip x={FIELD_CX} y={378} label="EXCHANGE" value={exchange !== null ? exchange.toFixed(2) : '—'} unit="s" color={colors.navy} />

      {/* the block fan behind the plate */}
      <Path d={`M ${FIELD_CX - 184} 456 Q ${FIELD_CX} 496 ${FIELD_CX + 184} 456`} fill="none" stroke={grid} strokeWidth={1} strokeDasharray="2 4" />
      <FieldChip x={FIELD_CX - 184} y={458} label="BLOCK LEFT" value={left !== null ? String(left) : '—'} color={gradeColor(left)} />
      <FieldChip x={FIELD_CX} y={476} label="BLOCK CENTER" value={center !== null ? String(center) : '—'} color={gradeColor(center)} />
      <FieldChip x={FIELD_CX + 184} y={458} label="BLOCK RIGHT" value={right !== null ? String(right) : '—'} color={gradeColor(right)} />
      <Text x={FIELD_CX} y={FIELD_VH - 8} textAnchor="middle" style={{ fontSize: 11, fontFamily: 'Helvetica-Oblique' }} fill={colors.textMuted}>
        Blocking coverage behind home plate
      </Text>
    </Svg>
  );
}

/* ── Position pages ────────────────────────────────────────────────── */

function FieldingPage({ position, data, notesSize }: { position: 'infield' | 'outfield'; data: DefensePdfData; notesSize: number }) {
  const a = (position === 'infield' ? data.infieldAssessment : data.outfieldAssessment) ?? {};
  const ms = a.manualSnapshot;
  const notes = position === 'infield' ? data.infieldNotes : data.outfieldNotes;

  /* Same precedence as DefenseTab's snapshot: manual snapshot, then the
     older granular fields. */
  const armBest = num(ms?.armStrength?.primary) ?? num(a.arm?.velocity?.best);
  const armAvg = num(ms?.armStrength?.secondary) ?? num(a.arm?.velocity?.avg);
  const range60 = num(ms?.range?.primary);
  const range10 = num(ms?.range?.secondary);
  let armGrade: number | null, gloveGrade: number | null, gloveHands: number | null;
  let transfers: { value: string; unit: string; grade?: number | null };
  let rangeGrade: number | null;
  if (position === 'infield') {
    armGrade = num(ms?.armStrength?.overallGrade);
    gloveGrade = num(ms?.glove?.overallGrade) ?? num(a.handsGlove?.overallGrade);
    gloveHands = num(ms?.glove?.primary) ?? num(a.handsGlove?.exchanges?.grade);
    const t = num(ms?.glove?.secondary) ?? num(a.handsGlove?.shortHops?.grade);
    transfers = { value: fmt(t, 0), unit: '', grade: t };
    rangeGrade = num(ms?.range?.overallGrade) ?? num(a.rangeFootwork?.overallGrade);
  } else {
    armGrade = num(ms?.armStrength?.overallGrade) ?? num(a.arm?.overallGrade);
    gloveGrade = num(ms?.glove?.overallGrade) ?? num(a.routesReads?.gloveWork?.grade);
    gloveHands = num(ms?.glove?.primary) ?? num(a.routesReads?.gloveWork?.grade);
    const t = num(ms?.glove?.secondary);
    const releaseT = num(a.arm?.releaseTime?.best);
    transfers = t !== null ? { value: fmt(t, 0), unit: '', grade: t } : { value: fmt(releaseT, 2), unit: 's' };
    rangeGrade = num(ms?.range?.overallGrade) ?? num(a.routesReads?.range?.grade) ?? num(a.routesReads?.overallGrade);
  }

  const cg = data.coachGrades[position] ?? {};
  const throwingGrades = DEFENSE_COACH_GRADE_SECTIONS.map((sec) => ({ title: sec.title, score: num(cg[sec.key]) }));
  const gradeUnit = position === 'infield' ? 'grade' : '/80';
  const colW = (CONTENT_W - GAP * 2) / 3;

  /* Three columns, as on the profile: Defensive Skills · Arm Strength /
     Glove / Range · Throwing Grades. */
  return (
    <>
      <View wrap={false} style={{ flexDirection: 'row', gap: GAP, height: FIELDING_ROW_H, marginBottom: GAP }}>
        <Card title="Defensive Skills" style={{ justifyContent: 'flex-start' }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <DefensiveSkillsFigure
              mode={position}
              figure={data.silhouettes?.[position] ?? null}
              width={colW - 20}
              callouts={[
                { label: 'ARM STRENGTH', value: armBest !== null ? String(Math.round(armBest)) : '—', unit: 'mph' },
                { label: 'GLOVE', value: fmt(gloveGrade, 0), unit: gradeUnit },
                { label: 'RANGE', value: fmt(rangeGrade, 0), unit: gradeUnit },
              ]}
            />
          </View>
        </Card>
        <View style={{ flex: 1, gap: GAP }}>
          <Card title="Arm Strength" grade={armGrade} style={{ padding: 8 }}>
            <Reading label="Max velocity" value={fmt(armBest, 1)} unit="mph" />
            <Reading label="Avg velocity" value={fmt(armAvg, 1)} unit="mph" />
          </Card>
          <Card title="Glove" grade={gloveGrade} style={{ padding: 8 }}>
            <Reading label="Hands" value={fmt(gloveHands, 0)} grade={gloveHands} />
            <Reading label="Transfers" value={transfers.value} unit={transfers.unit} grade={transfers.grade} />
          </Card>
          <Card title="Range" grade={rangeGrade} style={{ padding: 8 }}>
            <Reading label="60 yard dash" value={fmt(range60, 1)} unit="s" />
            <Reading label="10 yard sprint" value={fmt(range10, 2)} unit="s" />
          </Card>
        </View>
        <Card title="Throwing Grades">
          <GradeColumn rows={throwingGrades} />
        </Card>
      </View>
      {notes && <PdfNotesBox label={TITLES[position].notes} text={notes} fontSize={notesSize} />}
    </>
  );
}

function CatchingPage({ data, notesSize }: { data: DefensePdfData; notesSize: number }) {
  const a = data.catchingAssessment ?? {};
  const t = a.throwing ?? {};
  const b = a.blocking ?? {};
  const rcv = a.receiving ?? {};

  const throwingGrades = [
    { title: 'Footwork',             score: num(t.footwork?.grade) },
    { title: 'Transfer',             score: num(t.transfer?.grade) },
    { title: 'Accuracy',             score: num(t.accuracy?.grade) },
    { title: 'Arm Path',             score: num(t.armPath?.grade) },
    { title: 'Foot Strike Position', score: num(t.footStrike?.grade) },
    { title: 'Rotation Sequence',    score: num(t.rotationSeq?.grade) },
    { title: 'Arm Deceleration',     score: num(t.decel?.grade) },
  ];
  const receivingGrades = [
    { title: 'Path',         score: num(rcv.path?.grade) },
    { title: 'Accuracy',     score: num(rcv.accuracy?.grade) },
    { title: 'Turn',         score: num(rcv.turn?.grade) },
    { title: 'Presentation', score: num(rcv.presentation?.grade) },
    { title: 'Timing',       score: num(rcv.timing?.grade) },
  ];
  const zoneColors = Array.isArray(rcv.zoneColors) ? rcv.zoneColors : null;
  const borderZoneColors = Array.isArray(rcv.borderZoneColors) ? rcv.borderZoneColors
    : Array.isArray(a.borderZoneColors) ? a.borderZoneColors : null;
  const inner = CATCHING_ROW_H - 20 - 21;   // card padding + title row

  /* As on the profile's Catching Report: Receiving (heat map + its
     grades) beside the Throwing & Blocking field, then the Throwing
     Grades in one row, then notes. */
  return (
    <>
      <View wrap={false} style={{ flexDirection: 'row', gap: GAP, height: CATCHING_ROW_H, marginBottom: GAP }}>
        <Card title="Receiving" style={{ flex: 1.15 }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <PdfHeatMap zoneColors={zoneColors} borderZoneColors={borderZoneColors} height={inner - 6} />
            <View style={{ flex: 1, alignSelf: 'stretch' }}>
              <GradeColumn rows={receivingGrades} />
            </View>
          </View>
        </Card>
        <Card title="Throwing & Blocking">
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <PdfCatchingField
              popTime={num(t.popTime2B?.best)}
              velocity={num(t.velocity?.best)}
              exchange={num(t.exchangeTime?.best)}
              left={num(b.blockLeft?.grade) ?? num(b.gloveBodyAngle?.grade)}
              center={num(b.blockCenter?.grade) ?? num(b.accuracy?.grade)}
              right={num(b.blockRight?.grade) ?? num(b.recoverySpeed?.grade)}
              height={inner}
            />
          </View>
        </Card>
      </View>
      {hasAnyScore(throwingGrades) && (
        <Card title="Throwing Grades" inRow={false} style={{ marginBottom: GAP }}>
          <GradeRowH rows={throwingGrades} />
        </Card>
      )}
      {data.catchingNotes && <PdfNotesBox label="CATCHING NOTES" text={data.catchingNotes} fontSize={notesSize} />}
    </>
  );
}

/** Page title row -- the section header without its top margin, since it
 *  opens the page. */
function ReportHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={[s.sectionHeader, { marginTop: 0 }]}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

export function DefenseReportPages({ data }: { data: DefensePdfData }) {
  const { player, sections, reportDate } = data;

  if (sections.length === 0) {
    return (
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 20 }}>
          No defensive assessment on this report yet.
        </Text>
        <PageFooter player={player} reportTitle="Defense Assessment" date={reportDate} />
      </Page>
    );
  }

  return (
    <>
      {sections.map((pos) => {
        const has = pos === 'catching' ? data.catchingAssessment
          : pos === 'infield' ? data.infieldAssessment : data.outfieldAssessment;
        const notes = pos === 'catching' ? data.catchingNotes
          : pos === 'infield' ? data.infieldNotes : data.outfieldNotes;
        const notesSize = notesFontSize(pos, notes);
        return (
          <Page key={pos} size="LETTER" orientation="landscape" style={s.page}>
            <ReportHeader title={TITLES[pos].title} subtitle={TITLES[pos].subtitle} />
            {!has ? (
              <>
                <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 10 }}>
                  No {TITLES[pos].noun} assessment entered on this report yet.
                </Text>
                {notes && <PdfNotesBox label={TITLES[pos].notes} text={notes} fontSize={notesSize} />}
              </>
            ) : pos === 'catching' ? (
              <CatchingPage data={data} notesSize={notesSize} />
            ) : (
              <FieldingPage position={pos} data={data} notesSize={notesSize} />
            )}
            <PageFooter player={player} reportTitle={TITLES[pos].footer} date={reportDate} />
          </Page>
        );
      })}
    </>
  );
}
