/**
 * Pitching PDF Report — Arsenal summary, spin/velo table, movement data
 */
import React from 'react';
import { Page, View, Text, Svg, Circle, Line, Rect } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard, PdfTable,
  PdfNotesBox, PdfPlayerInfoBar, PdfDivider,
} from './components';
import { formatHeight, getAge } from '@/app/athletes/[id]/helpers';

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
  tilt: string;
  spinEff: number;
}

export interface PitchingPdfData {
  player: any;
  arsenal: ArsenalRow[];
  totalPitches: number;
  pitchNotes: string | null;
  reportDate: string;
}

const PITCH_COLORS: Record<string, string> = {
  'Four-Seam': '#EF4444',
  'Fastball': '#EF4444',
  'Sinker': '#F97316',
  'Cutter': '#A855F7',
  'Slider': '#EAB308',
  'Curveball': '#22C55E',
  'ChangeUp': '#3B82F6',
  'Sweeper': '#EC4899',
  'Splitter': '#14B8A6',
};

export function PitchingReportPages({ data }: { data: PitchingPdfData }) {
  const { player, arsenal, totalPitches, reportDate } = data;

  return (
    <Page size="LETTER" style={s.page}>
      <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

      {/* ── Pitch Arsenal Summary ── */}
      <PdfSectionHeader title="Pitch Arsenal" subtitle={`${totalPitches} total pitches`} />

      {arsenal.length > 0 ? (
        <>
          {/* Arsenal cards */}
          <View style={s.kpiGrid}>
            {arsenal.map(row => {
              const pitchColor = PITCH_COLORS[row.pitchType] || colors.teal;
              return (
                <View
                  key={row.pitchType}
                  style={[s.kpiCardWide, { borderTopWidth: 3, borderTopColor: pitchColor }]}
                >
                  <Text style={[s.kpiLabel, { color: pitchColor, fontSize: 8 }]}>{row.pitchType}</Text>
                  <Text style={s.kpiValue}>{row.avgVelo.toFixed(1)}</Text>
                  <Text style={s.kpiUnit}>avg mph</Text>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 6, color: colors.textMuted }}>MAX</Text>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{row.maxVelo.toFixed(1)}</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 6, color: colors.textMuted }}>SPIN</Text>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{row.avgSpin.toFixed(0)}</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 6, color: colors.textMuted }}>COUNT</Text>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{row.count}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          <PdfDivider />

          {/* ── Detailed Data Table ── */}
          <PdfSectionHeader title="Spin, Velocity & Movement" subtitle="Per pitch type breakdown" />
          <PdfTable
            columns={[
              { key: 'pitchType', header: 'Pitch', bold: true },
              { key: 'avgVelo', header: 'Avg Velo', align: 'center' },
              { key: 'maxVelo', header: 'Max Velo', align: 'center' },
              { key: 'avgSpin', header: 'Spin Rate', align: 'center' },
              { key: 'avgHBreak', header: 'H-Break', align: 'center' },
              { key: 'avgIVB', header: 'IVB', align: 'center' },
              { key: 'avgExt', header: 'Extension', align: 'center' },
              { key: 'tilt', header: 'Tilt', align: 'center' },
              { key: 'spinEff', header: 'Spin Eff', align: 'center' },
            ]}
            rows={arsenal.map(row => ({
              pitchType: row.pitchType,
              avgVelo: row.avgVelo.toFixed(1),
              maxVelo: row.maxVelo.toFixed(1),
              avgSpin: row.avgSpin.toFixed(0),
              avgHBreak: row.avgHBreak.toFixed(1) + '"',
              avgIVB: row.avgIVB.toFixed(1) + '"',
              avgExt: row.avgExt.toFixed(1) + ' ft',
              tilt: row.tilt,
              spinEff: row.spinEff.toFixed(0) + '%',
            }))}
          />

          <PdfDivider />

          {/* ── Velocity Range Bars ── */}
          <PdfSectionHeader title="Velocity Range" subtitle="Min to Max by pitch type" />
          {arsenal.map(row => {
            const pitchColor = PITCH_COLORS[row.pitchType] || colors.teal;
            // Normalize to a 60-100mph range for visual
            const rangeMin = 55;
            const rangeMax = 100;
            const leftPct = Math.max(0, ((row.minVelo - rangeMin) / (rangeMax - rangeMin)) * 100);
            const widthPct = Math.max(5, ((row.maxVelo - row.minVelo) / (rangeMax - rangeMin)) * 100);
            return (
              <View key={row.pitchType} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ width: 70, fontSize: 8, color: colors.textDark }}>{row.pitchType}</Text>
                <View style={{ flex: 1, height: 12, backgroundColor: colors.cardBg, borderRadius: 6, border: `0.5px solid ${colors.cardBorder}`, overflow: 'hidden' }}>
                  <View style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: '100%',
                    backgroundColor: pitchColor,
                    borderRadius: 4,
                    opacity: 0.7,
                  }} />
                </View>
                <Text style={{ width: 65, fontSize: 7, textAlign: 'right', color: colors.textMuted }}>
                  {row.minVelo.toFixed(1)} – {row.maxVelo.toFixed(1)}
                </Text>
              </View>
            );
          })}
        </>
      ) : (
        <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 12 }}>No pitching data available.</Text>
      )}

      {/* Notes */}
      {data.pitchNotes && (
        <>
          <PdfDivider />
          <PdfNotesBox label="PITCHING ASSESSMENT NOTES" text={data.pitchNotes} />
        </>
      )}

      <PageFooter reportTitle="Pitching Assessment" date={reportDate} />
    </Page>
  );
}
