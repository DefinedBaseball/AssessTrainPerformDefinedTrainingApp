/**
 * Vision PDF Report — Vizual Edge assessment data
 */
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard, PdfScoreBar,
  PdfNotesBox, PdfPlayerInfoBar, PdfDivider,
} from './components';
import {
  METRIC_LABELS, TAB_METRICS, getBadgeLevel, getBadgeText,
  formatHeight, getAge,
} from '@/app/athletes/[id]/helpers';

export interface VisionPdfData {
  player: any;
  metrics: Record<string, { value: number; unit: string }>;
  visionNotes: string | null;
  reportDate: string;
}

export function VisionReportPages({ data }: { data: VisionPdfData }) {
  const { player, metrics, reportDate } = data;
  const hasData = Object.keys(metrics).length > 0;

  return (
    <Page size="LETTER" style={s.page}>
      <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

      <PdfSectionHeader title="Vizual Edge Assessment" subtitle="Visual performance metrics" />

      {hasData ? (
        <>
          {/* KPI Cards */}
          <View style={s.kpiGrid}>
            {TAB_METRICS.vision.map(key => {
              const m = metrics[key];
              if (!m) return null;
              const level = getBadgeLevel(key, m.value);
              return (
                <PdfKpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={m.value.toFixed(0)}
                  badge={getBadgeText(level) || undefined}
                  badgeLevel={level}
                />
              );
            })}
          </View>

          <PdfDivider />

          {/* Score Bars */}
          <PdfSectionHeader title="Score Breakdown" subtitle="Visual performance by category" />
          {TAB_METRICS.vision.map(key => {
            const m = metrics[key];
            if (!m) return null;
            const level = getBadgeLevel(key, m.value);
            return (
              <PdfScoreBar
                key={key}
                label={METRIC_LABELS[key]}
                value={m.value.toFixed(0)}
                percent={m.value}
                level={level}
              />
            );
          })}
        </>
      ) : (
        <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 12 }}>
          No Vizual Edge data available.
        </Text>
      )}

      {/* Notes */}
      {data.visionNotes && (
        <>
          <PdfDivider />
          <PdfNotesBox label="COGNITION ASSESSMENT NOTES" text={data.visionNotes} />
        </>
      )}

      <PageFooter reportTitle="Cognition Assessment" date={reportDate} />
    </Page>
  );
}
