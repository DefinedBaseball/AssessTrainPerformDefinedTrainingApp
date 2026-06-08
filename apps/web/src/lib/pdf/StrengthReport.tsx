/**
 * Strength & Conditioning PDF Report
 */
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard, PdfScoreBar,
  PdfNotesBox, PdfPlayerInfoBar, PdfDivider, PdfScalePips,
} from './components';
import {
  METRIC_LABELS, getBadgeLevel, getBadgeText, toScoutingGrade, GRADE_RANGES,
  formatHeight, getAge,
} from '@/app/athletes/[id]/helpers';

export interface StrengthPdfData {
  player: any;
  metrics: Record<string, { value: number; unit: string }>;
  scNotes: string | null;
  reportDate: string;
}

export function StrengthReportPages({ data }: { data: StrengthPdfData }) {
  const { player, metrics, reportDate } = data;

  const athleticKeys = ['jump_height', 'broad_jump', 'sprint_60'];
  const strengthKeys = ['squat_max', 'bench_max', 'deadlift_max', 'grip_strength_l', 'grip_strength_r'];
  const bodyKeys = ['body_weight', 'body_fat_pct'];
  const gradeKeys = athleticKeys.filter(k => metrics[k] && GRADE_RANGES[k]);

  const hasAthletic = athleticKeys.some(k => metrics[k]);
  const hasStrength = strengthKeys.some(k => metrics[k]);
  const hasBody = bodyKeys.some(k => metrics[k]);

  return (
    /* Top `PdfPlayerInfoBar` retired — Cover Page already carries
       the player's name + vitals on PDF page 1, so the black bar
       on page 2 was redundant. */
    <Page size="LETTER" style={s.page}>
      {/* ── Athletic Testing ── */}
      <PdfSectionHeader title="Athletic Testing" subtitle="Speed, power & explosiveness" />

      {hasAthletic ? (
        <>
          <View style={s.kpiGrid}>
            {athleticKeys.map(key => {
              const m = metrics[key];
              if (!m) return null;
              const level = getBadgeLevel(key, m.value);
              return (
                <PdfKpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={key === 'sprint_60' ? m.value.toFixed(2) : m.value.toFixed(1)}
                  unit={m.unit}
                  badge={getBadgeText(level) || undefined}
                  badgeLevel={level}
                  wide
                />
              );
            })}
          </View>

          {/* Score Bars */}
          <View style={{ marginTop: 8 }}>
            {metrics.jump_height && (
              <PdfScoreBar
                label="Vertical Jump"
                value={`${metrics.jump_height.value.toFixed(1)} in`}
                percent={(metrics.jump_height.value / 40) * 100}
                level={getBadgeLevel('jump_height', metrics.jump_height.value)}
              />
            )}
            {metrics.broad_jump && (
              <PdfScoreBar
                label="Broad Jump"
                value={`${metrics.broad_jump.value.toFixed(0)} in`}
                percent={(metrics.broad_jump.value / 120) * 100}
                level={getBadgeLevel('broad_jump', metrics.broad_jump.value)}
              />
            )}
            {metrics.sprint_60 && (
              <PdfScoreBar
                label="60-Yard Sprint"
                value={`${metrics.sprint_60.value.toFixed(2)} sec`}
                percent={Math.max(0, 100 - ((metrics.sprint_60.value - 6.2) / 1.6) * 100)}
                level={getBadgeLevel('sprint_60', metrics.sprint_60.value)}
              />
            )}
          </View>
        </>
      ) : (
        <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 12 }}>No athletic testing data available.</Text>
      )}

      {/* ── Scouting Grades ── */}
      {gradeKeys.length > 0 && (
        <>
          <PdfDivider />
          <PdfSectionHeader title="Athletic Grades" subtitle="20-80 Scale" />
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { flex: 2 }]}>Tool</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Value</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Grade</Text>
              <Text style={[s.tableHeaderCell, { flex: 2 }]}>Scale</Text>
            </View>
            {gradeKeys.map((key, i) => {
              const m = metrics[key];
              const grade = toScoutingGrade(m.value, key);
              return (
                <View key={key} style={[s.gradeRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={[s.gradeLabel, { flex: 2 }]}>{METRIC_LABELS[key]}</Text>
                  <Text style={[s.gradeValue, { flex: 1 }]}>
                    {key === 'sprint_60' ? m.value.toFixed(2) : m.value.toFixed(1)}
                  </Text>
                  <Text style={[s.gradeValue, { flex: 1, color: grade >= 60 ? colors.elite : grade >= 50 ? colors.aboveAvg : colors.developing }]}>
                    {grade}
                  </Text>
                  <View style={{ flex: 2 }}>
                    <PdfScalePips grade={grade} />
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* ── Strength Metrics ── */}
      {hasStrength && (
        <>
          <PdfDivider />
          <PdfSectionHeader title="Strength Metrics" subtitle="Max lifts & grip strength" />
          <View style={s.kpiGrid}>
            {strengthKeys.map(key => {
              const m = metrics[key];
              if (!m) return null;
              return (
                <PdfKpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={m.value.toFixed(0)}
                  unit={m.unit}
                />
              );
            })}
          </View>
        </>
      )}

      {/* ── Body Composition ── */}
      {hasBody && (
        <>
          <PdfDivider />
          <PdfSectionHeader title="Body Composition" />
          <View style={s.kpiGrid}>
            {bodyKeys.map(key => {
              const m = metrics[key];
              if (!m) return null;
              return (
                <PdfKpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={key === 'body_fat_pct' ? `${m.value.toFixed(1)}%` : m.value.toFixed(0)}
                  unit={key === 'body_fat_pct' ? undefined : m.unit}
                />
              );
            })}
          </View>
        </>
      )}

      {/* Notes */}
      {data.scNotes && (
        <>
          <PdfDivider />
          <PdfNotesBox label="STRENGTH & CONDITIONING NOTES" text={data.scNotes} />
        </>
      )}

      <PageFooter reportTitle="Strength & Conditioning Assessment" date={reportDate} />
    </Page>
  );
}
