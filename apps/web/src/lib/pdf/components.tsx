/**
 * Reusable PDF Components for @react-pdf/renderer
 */
import React from 'react';
import { View, Text, Image, Svg, Rect, Circle } from '@react-pdf/renderer';
import { s, colors, badgeColors, barColor } from './theme';
import { formatPositionsForDisplay } from '@/app/athletes/[id]/helpers';

/* ── Page Footer ── */
export function PageFooter({ reportTitle, date }: { reportTitle: string; date: string }) {
  return (
    <View style={s.pageFooter} fixed>
      <Text>{reportTitle}</Text>
      <Text>Generated {date}</Text>
    </View>
  );
}

/* ── Section Header ── */
export function PdfSectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {subtitle && <Text style={s.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

/* ── KPI Card ──
   Metric value color mirrors the in-app chip color for that grade band:
     low  (< 40 grade) → red
     mid  (40-59)      → yellow
     high (≥ 60)       → green
     none / teal       → dark grey (default)
   So a coach scanning the PDF gets the same visual cue (good / average /
   bad) as they would on the athlete's profile. */
export function PdfKpiCard({
  label,
  value,
  unit,
  badge,
  badgeLevel,
  wide,
}: {
  label: string;
  value: string;
  unit?: string;
  badge?: string;
  badgeLevel?: string;
  wide?: boolean;
}) {
  const bc = badgeLevel ? badgeColors(badgeLevel) : null;
  const valueColor = badgeLevel === 'high' ? colors.elite
                   : badgeLevel === 'mid'  ? colors.aboveAvg
                   : badgeLevel === 'low'  ? colors.developing
                   : colors.navy;
  return (
    <View style={wide ? s.kpiCardWide : s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { color: valueColor }]}>{value}</Text>
      {unit && <Text style={s.kpiUnit}>{unit}</Text>}
      {badge && bc && (
        <Text style={[s.kpiBadge, { backgroundColor: bc.bg, color: bc.text }]}>
          {badge}
        </Text>
      )}
    </View>
  );
}

/* ── Score Bar ──
   The trailing value text also color-codes by level so the score reads
   the same way as the in-app bar (red/yellow/green). */
export function PdfScoreBar({
  label,
  value,
  percent,
  level,
}: {
  label: string;
  value: string;
  percent: number;
  level?: string;
}) {
  const fill = Math.max(0, Math.min(100, percent));
  const fc = barColor(level || 'teal');
  const valueColor = level === 'high' ? colors.elite
                   : level === 'mid'  ? colors.aboveAvg
                   : level === 'low'  ? colors.developing
                   : colors.navy;
  return (
    <View style={s.scoreBarRow}>
      <Text style={s.scoreBarLabel}>{label}</Text>
      <View style={s.scoreBarTrack}>
        <View style={[s.scoreBarFill, { width: `${fill}%`, backgroundColor: fc }]} />
      </View>
      <Text style={[s.scoreBarValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

/* ── Scale Pips (20-80 scouting grade visualization) ── */
export function PdfScalePips({ grade }: { grade: number }) {
  const pips = [20, 30, 40, 50, 60, 70, 80];
  return (
    <View style={s.gradePips}>
      {pips.map(p => {
        const isActive = p <= grade;
        let pipColor = colors.cardBorder;
        if (isActive) {
          if (grade >= 60) pipColor = colors.elite;
          else if (grade >= 50) pipColor = colors.aboveAvg;
          else pipColor = colors.developing;
        }
        return (
          <View
            key={p}
            style={{
              width: p === grade ? 14 : 10,
              height: p === grade ? 14 : 10,
              borderRadius: 7,
              backgroundColor: pipColor,
              opacity: isActive ? 1 : 0.3,
            }}
          />
        );
      })}
      <Text style={{ fontSize: 7, color: colors.textMuted, marginLeft: 4 }}>{grade}</Text>
    </View>
  );
}

/* ── Table ── */
interface TableColumn {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export function PdfTable({
  columns,
  rows,
}: {
  columns: TableColumn[];
  rows: Record<string, string | number>[];
}) {
  return (
    <View style={s.table}>
      {/* Header */}
      <View style={s.tableHeader}>
        {columns.map(col => (
          <Text
            key={col.key}
            style={[
              s.tableHeaderCell,
              { width: col.width || 'auto', flex: col.width ? undefined : 1, textAlign: col.align || 'left' },
            ]}
          >
            {col.header}
          </Text>
        ))}
      </View>
      {/* Rows */}
      {rows.map((row, i) => (
        <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
          {columns.map(col => (
            <Text
              key={col.key}
              style={[
                col.bold ? s.tableCellBold : s.tableCell,
                { width: col.width || 'auto', flex: col.width ? undefined : 1, textAlign: col.align || 'left' },
              ]}
            >
              {String(row[col.key] ?? '—')}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ── Notes Box ──
   Accepts either plain text or HTML produced by the in-app rich-notes
   editor (Bold / Italic / Underline tags). We render with a minimal HTML
   parser so b/strong, i/em, and u tags map to the matching @react-pdf
   <Text> styles. <br>, <div>, and <p> insert line breaks. Anything else
   is stripped so unsafe / unsupported tags can't bleed into the PDF. */
export function PdfNotesBox({ label, text }: { label: string; text: string }) {
  /* Default react-pdf flow — the notes block starts on the current page
     right under whatever precedes it. We render each line of the parsed
     HTML as its OWN <Text> element inside the box's <View>. react-pdf
     paginates between sibling Text blocks naturally, so a long notes
     body fills the remaining space on page 2 first, then continues on
     page 3 only if it overflows — instead of moving the entire block
     to the next page atomically (which was happening when the parsed
     spans were nested inside a single parent <Text>). */
  const lines = renderHtmlNoteAsLines(text);
  return (
    <View style={s.notesBox}>
      <Text style={s.notesLabel}>{label}</Text>
      {lines.map((line, idx) => (
        <Text key={idx} style={s.notesText}>{line}</Text>
      ))}
    </View>
  );
}

/** Same parser as renderHtmlNote, but groups output into LINES (each
 *  array entry = inline spans for one rendered line) so the caller can
 *  emit each line as its own <Text> block. That's how we get react-pdf
 *  to paginate the notes body across pages naturally — sibling Text
 *  blocks flow page-by-page, while a single Text packed with all spans
 *  is treated as one atomic unit and either fits or jumps whole. */
function renderHtmlNoteAsLines(html: string): React.ReactNode[][] {
  if (!html) return [];
  if (!/<[^>]+>/.test(html)) {
    // Plain text: split on user-typed newlines, preserve blank lines.
    return decodeEntities(html).split('\n').map(l => [l]);
  }
  type Style = { bold?: boolean; italic?: boolean; underline?: boolean };
  const stack: Style[] = [{}];
  const lines: React.ReactNode[][] = [[]];
  let key = 0;
  let i = 0;
  let buf = '';
  let lastWasNewline = true; // suppress leading break before first block
  const flush = () => {
    if (!buf) return;
    const sty = stack[stack.length - 1];
    const style: any = {};
    if (sty.bold && sty.italic) style.fontFamily = 'Helvetica-BoldOblique';
    else if (sty.bold)          style.fontFamily = 'Helvetica-Bold';
    else if (sty.italic)        style.fontFamily = 'Helvetica-Oblique';
    if (sty.underline)          style.textDecoration = 'underline';
    lines[lines.length - 1].push(<Text key={key++} style={style}>{decodeEntities(buf)}</Text>);
    buf = '';
    lastWasNewline = false;
  };
  const newline = (force = false) => {
    if (lastWasNewline && !force) return;
    // Start a new line bucket. An empty bucket on a forced break (e.g.
    // <br><br>) renders as a blank line — preserves visual paragraph
    // spacing the coach typed.
    lines.push([]);
    lastWasNewline = true;
  };
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const raw = html.slice(i + 1, close).trim().toLowerCase();
      flush();
      if (raw === 'br' || raw === 'br/' || raw === 'br /') {
        newline(true);
      } else {
        const isClose = raw.startsWith('/');
        const name = (isClose ? raw.slice(1) : raw).split(/\s/)[0];
        const next = { ...stack[stack.length - 1] };
        if (name === 'b' || name === 'strong')      next.bold = !isClose;
        else if (name === 'i' || name === 'em')     next.italic = !isClose;
        else if (name === 'u')                      next.underline = !isClose;
        else if (name === 'p' || name === 'div') {
          newline();
        }
        if (['b','strong','i','em','u'].includes(name)) {
          if (isClose) {
            if (stack.length > 1) stack.pop();
          } else {
            stack.push(next);
          }
        }
      }
      i = close + 1;
    } else {
      buf += html[i++];
    }
  }
  flush();
  // Drop a trailing empty line bucket so the box doesn't end with a
  // stray blank line.
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop();
  // Ensure each line has at least one space-string so react-pdf renders
  // its height — empty buckets between paragraphs become visual blanks.
  return lines.map(line => (line.length === 0 ? [' '] : line));
}

/** Tokenize a small HTML subset and return an array of <Text> elements
 *  with the right inline style stack applied. Handles nested tags by
 *  walking a tag stack — e.g. "<b>foo <i>bar</i></b>" produces two spans:
 *  bold "foo " and bold-italic "bar".
 *
 *  Block-level tags (<div>, <p>) emit a newline on BOTH open and close so
 *  the rendered text matches what a browser would show when the same HTML
 *  is mounted via dangerouslySetInnerHTML — block elements start on a
 *  new line even when preceded by inline text. Consecutive newlines are
 *  deduped so we don't end up with double-spaced paragraphs. */
function renderHtmlNote(html: string): React.ReactNode[] {
  if (!html) return [];
  // Fast path: if the string has no tags, just return the text as-is.
  if (!/<[^>]+>/.test(html)) {
    return [<Text key="0">{decodeEntities(html)}</Text>];
  }
  type Style = { bold?: boolean; italic?: boolean; underline?: boolean };
  const stack: Style[] = [{}];
  const out: React.ReactNode[] = [];
  let key = 0;
  let i = 0;
  let buf = '';
  let lastWasNewline = true; // suppress a leading break before the first block
  const flush = () => {
    if (!buf) return;
    const s = stack[stack.length - 1];
    const style: any = {};
    if (s.bold && s.italic) style.fontFamily = 'Helvetica-BoldOblique';
    else if (s.bold)        style.fontFamily = 'Helvetica-Bold';
    else if (s.italic)      style.fontFamily = 'Helvetica-Oblique';
    if (s.underline)        style.textDecoration = 'underline';
    out.push(<Text key={key++} style={style}>{decodeEntities(buf)}</Text>);
    buf = '';
    lastWasNewline = false;
  };
  const newline = () => {
    // Drop runs of consecutive newlines so back-to-back blocks (e.g.
    // </div><div>) don't render as a blank paragraph between them.
    if (lastWasNewline) return;
    out.push(<Text key={key++}>{'\n'}</Text>);
    lastWasNewline = true;
  };
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const raw = html.slice(i + 1, close).trim().toLowerCase();
      flush();
      if (raw === 'br' || raw === 'br/' || raw === 'br /') {
        // Hard line break — always emit, even if last was newline (keeps
        // user-typed blank lines as visual paragraph breaks).
        out.push(<Text key={key++}>{'\n'}</Text>);
        lastWasNewline = true;
      } else {
        const isClose = raw.startsWith('/');
        const name = (isClose ? raw.slice(1) : raw).split(/\s/)[0];
        const next = { ...stack[stack.length - 1] };
        if (name === 'b' || name === 'strong')      next.bold = !isClose;
        else if (name === 'i' || name === 'em')     next.italic = !isClose;
        else if (name === 'u')                      next.underline = !isClose;
        else if (name === 'p' || name === 'div') {
          // Block-level — newline on BOTH ends. Emitting on open ensures
          // a break BEFORE the block (matches browser block-flow), and
          // emitting on close ensures the next inline content starts on
          // its own line. Consecutive newlines are deduped above.
          newline();
        }
        // For all recognized inline tags, push a new style frame on open
        // and pop on close. Unknown tags are simply ignored.
        if (['b','strong','i','em','u'].includes(name)) {
          if (isClose) {
            if (stack.length > 1) stack.pop();
          } else {
            stack.push(next);
          }
        }
      }
      i = close + 1;
    } else {
      buf += html[i++];
    }
  }
  flush();
  return out;
}

/** Minimal HTML entity decoder for the entities react-pdf otherwise
 *  prints literally. Covers the everyday ones produced by contenteditable. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* ── Player Info Bar ── */
export function PdfPlayerInfoBar({
  player,
  formatHeight,
  getAge,
}: {
  player: {
    firstName: string;
    lastName: string;
    positions: string;
    heightInches: number | null;
    weightLbs: number | null;
    gradYear: number | null;
    bats: string | null;
    throws: string | null;
    highSchool: string | null;
    clubTeam: string | null;
    collegeCommit: string | null;
    birthDate: string | null;
  };
  formatHeight: (inches: number | null) => string;
  getAge: (birthDate: string | null | undefined, gradYear: number | null | undefined) => string;
}) {
  const stats = [
    /* Position rolls up to display labels per the same coach-facing
       mapping used on the Cover Page (SS/2B/1B/3B → INF, LF/CF/RF →
       OF, C → Catcher, P → Pitcher). Keeps the in-bar label
       consistent with the cover when this strip is rendered. */
    { label: 'Position', value: formatPositionsForDisplay(player.positions) },
    { label: 'B/T', value: `${player.bats || '—'}/${player.throws || '—'}` },
    { label: 'Height', value: formatHeight(player.heightInches) },
    { label: 'Weight', value: player.weightLbs ? `${player.weightLbs} lbs` : '—' },
    /* "Class" (Grad Year) chip retired per spec — the bar now reads
       Position / B/T / Height / Weight only. Age was already removed
       in an earlier pass. */
  ];

  return (
    <View style={s.playerInfoBar}>
      <View>
        <Text style={s.playerInfoName}>{player.firstName} {player.lastName}</Text>
        <Text style={s.playerInfoDetail}>
          {player.highSchool || player.clubTeam || ''}
          {player.collegeCommit ? `  |  Committed: ${player.collegeCommit}` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {stats.map(st => (
          <View key={st.label} style={s.playerInfoStat}>
            <Text style={s.playerInfoStatLabel}>{st.label}</Text>
            <Text style={s.playerInfoStatValue}>{st.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Divider ── */
export function PdfDivider() {
  return <View style={s.divider} />;
}

/* ── Assessment Grade Card ── */
export function PdfGradeCard({
  label,
  grade,
  sublabel,
}: {
  label: string;
  grade: number | null;
  sublabel?: string;
}) {
  if (grade === null || grade === undefined) return null;
  let gradeColor = colors.textMuted;
  if (grade >= 8) gradeColor = colors.elite;
  else if (grade >= 6) gradeColor = colors.aboveAvg;
  else if (grade >= 4) gradeColor = colors.gold;
  else gradeColor = colors.developing;

  return (
    <View style={[s.kpiCard, { borderLeftWidth: 3, borderLeftColor: gradeColor }]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { color: gradeColor }]}>{grade}/10</Text>
      {sublabel && <Text style={s.kpiUnit}>{sublabel}</Text>}
    </View>
  );
}

/* ── Metric Pair (Avg + Max side by side) ── */
export function PdfMetricPair({
  label,
  avg,
  max,
  unit,
  decimals = 1,
}: {
  label: string;
  avg: number;
  max: number;
  unit?: string;
  decimals?: number;
}) {
  return (
    <View style={[s.kpiCardWide, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.kpiLabel}>{label}</Text>
      </View>
      <View style={{ alignItems: 'center', paddingHorizontal: 8 }}>
        <Text style={{ fontSize: 6, color: colors.textMuted }}>AVG</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{avg.toFixed(decimals)}</Text>
      </View>
      <View style={{ alignItems: 'center', paddingHorizontal: 8 }}>
        <Text style={{ fontSize: 6, color: colors.textMuted }}>MAX</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: colors.teal }}>{max.toFixed(decimals)}</Text>
      </View>
      {unit && <Text style={{ fontSize: 6, color: colors.textMuted }}>{unit}</Text>}
    </View>
  );
}

/* ── At-Bat Metric Row (used in Pitch Recognition PDF) ── */
export function PdfPercentMetric({
  label,
  value,
  level,
}: {
  label: string;
  value: number | null;
  level?: string;
}) {
  if (value === null || value === undefined) return null;
  const bc = level ? badgeColors(level) : null;
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 8,
      backgroundColor: colors.cardBg,
      borderRadius: 4,
      marginBottom: 3,
      border: `0.5px solid ${colors.cardBorder}`,
    }}>
      <Text style={{ flex: 2, fontSize: 8, color: colors.textDark }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', color: colors.navy }}>
        {value.toFixed(1)}%
      </Text>
      {bc && level && (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={[s.kpiBadge, { backgroundColor: bc.bg, color: bc.text, fontSize: 6 }]}>
            {level === 'high' ? 'Elite' : level === 'mid' ? 'Above Avg' : 'Developing'}
          </Text>
        </View>
      )}
    </View>
  );
}
