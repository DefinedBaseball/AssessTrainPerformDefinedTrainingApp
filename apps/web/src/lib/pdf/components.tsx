/**
 * Reusable PDF Components for @react-pdf/renderer
 */
import React from 'react';
import { View, Text, Image, Svg, Rect, Circle } from '@react-pdf/renderer';
import { s, colors, badgeColors, barColor } from './theme';

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

/* ── KPI Card ── */
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
  return (
    <View style={wide ? s.kpiCardWide : s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      {unit && <Text style={s.kpiUnit}>{unit}</Text>}
      {badge && bc && (
        <Text style={[s.kpiBadge, { backgroundColor: bc.bg, color: bc.text }]}>
          {badge}
        </Text>
      )}
    </View>
  );
}

/* ── Score Bar ── */
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
  return (
    <View style={s.scoreBarRow}>
      <Text style={s.scoreBarLabel}>{label}</Text>
      <View style={s.scoreBarTrack}>
        <View style={[s.scoreBarFill, { width: `${fill}%`, backgroundColor: fc }]} />
      </View>
      <Text style={s.scoreBarValue}>{value}</Text>
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

/* ── Notes Box ── */
export function PdfNotesBox({ label, text }: { label: string; text: string }) {
  return (
    <View style={s.notesBox}>
      <Text style={s.notesLabel}>{label}</Text>
      <Text style={s.notesText}>{text}</Text>
    </View>
  );
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
    { label: 'Position', value: player.positions || '—' },
    { label: 'B/T', value: `${player.bats || '—'}/${player.throws || '—'}` },
    { label: 'Height', value: formatHeight(player.heightInches) },
    { label: 'Weight', value: player.weightLbs ? `${player.weightLbs} lbs` : '—' },
    { label: 'Class', value: player.gradYear ? String(player.gradYear) : '—' },
    { label: 'Age', value: getAge(player.birthDate, player.gradYear) },
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
