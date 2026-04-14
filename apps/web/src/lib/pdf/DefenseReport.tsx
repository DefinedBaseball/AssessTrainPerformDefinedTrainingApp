/**
 * Defense PDF Report — Position-specific defense data
 * Only includes positions that appear in the player's profile
 */
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard, PdfTable,
  PdfNotesBox, PdfPlayerInfoBar, PdfDivider, PdfGradeCard,
  PdfScoreBar,
} from './components';
import { formatHeight, getAge } from '@/app/athletes/[id]/helpers';

/* ── Assessment Types ── */
interface ArmMetric { best: number | null; avg: number | null; }

interface CatchingAssessment {
  throwing?: {
    popTime2B?: ArmMetric;
    popTime3B?: ArmMetric;
    exchangeTime?: ArmMetric;
    velocity?: ArmMetric;
  };
  receiving?: {
    overallGrade?: number | null;
    stickRate?: number | null;
    framingScore?: number | null;
    notes?: string;
  };
  blocking?: {
    overallGrade?: number | null;
    blockRate?: number | null;
    notes?: string;
  };
}

interface InfieldAssessment {
  arm?: {
    velocity?: ArmMetric;
    accuracy?: ArmMetric;
  };
  rangeFootwork?: {
    overallGrade?: number | null;
    firstStepQuickness?: number | null;
    lateralRange?: number | null;
    footwork?: number | null;
    notes?: string;
  };
  handsGlove?: {
    overallGrade?: number | null;
    fieldingPct?: number | null;
    shortHop?: number | null;
    transfer?: number | null;
    notes?: string;
  };
}

interface OutfieldAssessment {
  arm?: {
    velocity?: ArmMetric;
    crowHop?: ArmMetric;
    releaseTime?: ArmMetric;
    accuracy?: ArmMetric;
  };
  routesReads?: {
    routes?: { grade?: number | null; notes?: string };
    range?: { grade?: number | null; notes?: string };
    firstStep?: number | null;
    notes?: string;
  };
}

export interface DefensePdfData {
  player: any;
  positions: {
    isCatcher: boolean;
    isInfielder: boolean;
    isOutfielder: boolean;
  };
  catchingAssessment: CatchingAssessment | null;
  infieldAssessment: InfieldAssessment | null;
  outfieldAssessment: OutfieldAssessment | null;
  catchingNotes: string | null;
  infieldNotes: string | null;
  outfieldNotes: string | null;
  reportDate: string;
}

function renderArmMetric(label: string, data: ArmMetric | undefined, unit: string, lowerBetter = false) {
  if (!data || (data.best === null && data.avg === null)) return null;
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      {data.best !== null && (
        <Text style={s.kpiValue}>{data.best.toFixed(lowerBetter ? 2 : 1)}</Text>
      )}
      <Text style={s.kpiUnit}>{lowerBetter ? 'best' : 'max'} {unit}</Text>
      {data.avg !== null && (
        <Text style={{ fontSize: 7, color: colors.textMuted, marginTop: 2 }}>
          avg: {data.avg.toFixed(lowerBetter ? 2 : 1)}
        </Text>
      )}
    </View>
  );
}

export function DefenseReportPages({ data }: { data: DefensePdfData }) {
  const { player, positions, catchingAssessment, infieldAssessment, outfieldAssessment, reportDate } = data;
  const hasAnyData = positions.isCatcher || positions.isInfielder || positions.isOutfielder;

  return (
    <Page size="LETTER" style={s.page}>
      <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

      {!hasAnyData && (
        <Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 20 }}>
          No defensive position data available for this player.
        </Text>
      )}

      {/* ── Catching ── */}
      {positions.isCatcher && (
        <>
          <PdfSectionHeader title="Catching" subtitle="Throwing, receiving & blocking" />

          {catchingAssessment ? (
            <>
              {/* Throwing Metrics */}
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6 }}>Throwing</Text>
              <View style={s.kpiGrid}>
                {renderArmMetric('Pop Time (2B)', catchingAssessment.throwing?.popTime2B, 'sec', true)}
                {renderArmMetric('Pop Time (3B)', catchingAssessment.throwing?.popTime3B, 'sec', true)}
                {renderArmMetric('Exchange Time', catchingAssessment.throwing?.exchangeTime, 'sec', true)}
                {renderArmMetric('Catcher Velocity', catchingAssessment.throwing?.velocity, 'mph')}
              </View>

              {/* Receiving */}
              {catchingAssessment.receiving && (
                <>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 10 }}>Receiving</Text>
                  <View style={s.kpiGrid}>
                    <PdfGradeCard label="Overall Grade" grade={catchingAssessment.receiving.overallGrade ?? null} />
                    {catchingAssessment.receiving.stickRate != null && (
                      <PdfKpiCard label="Stick Rate" value={`${catchingAssessment.receiving.stickRate}%`} />
                    )}
                    {catchingAssessment.receiving.framingScore != null && (
                      <PdfKpiCard label="Framing Score" value={catchingAssessment.receiving.framingScore.toFixed(1)} />
                    )}
                  </View>
                </>
              )}

              {/* Blocking */}
              {catchingAssessment.blocking && (
                <>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 10 }}>Blocking</Text>
                  <View style={s.kpiGrid}>
                    <PdfGradeCard label="Overall Grade" grade={catchingAssessment.blocking.overallGrade ?? null} />
                    {catchingAssessment.blocking.blockRate != null && (
                      <PdfKpiCard label="Block Rate" value={`${catchingAssessment.blocking.blockRate}%`} />
                    )}
                  </View>
                </>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 9, color: colors.textMuted }}>No catching assessment data.</Text>
          )}

          {data.catchingNotes && (
            <PdfNotesBox label="CATCHING NOTES" text={data.catchingNotes} />
          )}

          {(positions.isInfielder || positions.isOutfielder) && <PdfDivider />}
        </>
      )}

      {/* ── Infield ── */}
      {positions.isInfielder && (
        <>
          <PdfSectionHeader title="Infield" subtitle="Arm, range & hands" />

          {infieldAssessment ? (
            <>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6 }}>Arm Strength</Text>
              <View style={s.kpiGrid}>
                {renderArmMetric('Arm Velocity', infieldAssessment.arm?.velocity, 'mph')}
                {renderArmMetric('Arm Accuracy', infieldAssessment.arm?.accuracy, '/10')}
              </View>

              {infieldAssessment.rangeFootwork && (
                <>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 10 }}>Range & Footwork</Text>
                  <View style={s.kpiGrid}>
                    <PdfGradeCard label="Overall Grade" grade={infieldAssessment.rangeFootwork.overallGrade ?? null} />
                    {infieldAssessment.rangeFootwork.firstStepQuickness != null && (
                      <PdfGradeCard label="First Step" grade={infieldAssessment.rangeFootwork.firstStepQuickness} />
                    )}
                    {infieldAssessment.rangeFootwork.lateralRange != null && (
                      <PdfGradeCard label="Lateral Range" grade={infieldAssessment.rangeFootwork.lateralRange} />
                    )}
                    {infieldAssessment.rangeFootwork.footwork != null && (
                      <PdfGradeCard label="Footwork" grade={infieldAssessment.rangeFootwork.footwork} />
                    )}
                  </View>
                </>
              )}

              {infieldAssessment.handsGlove && (
                <>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 10 }}>Hands & Glove</Text>
                  <View style={s.kpiGrid}>
                    <PdfGradeCard label="Overall Grade" grade={infieldAssessment.handsGlove.overallGrade ?? null} />
                    {infieldAssessment.handsGlove.shortHop != null && (
                      <PdfGradeCard label="Short Hop" grade={infieldAssessment.handsGlove.shortHop} />
                    )}
                    {infieldAssessment.handsGlove.transfer != null && (
                      <PdfGradeCard label="Transfer" grade={infieldAssessment.handsGlove.transfer} />
                    )}
                  </View>
                </>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 9, color: colors.textMuted }}>No infield assessment data.</Text>
          )}

          {data.infieldNotes && (
            <PdfNotesBox label="INFIELD NOTES" text={data.infieldNotes} />
          )}

          {positions.isOutfielder && <PdfDivider />}
        </>
      )}

      {/* ── Outfield ── */}
      {positions.isOutfielder && (
        <>
          <PdfSectionHeader title="Outfield" subtitle="Arm, routes & range" />

          {outfieldAssessment ? (
            <>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6 }}>Arm Strength</Text>
              <View style={s.kpiGrid}>
                {renderArmMetric('Arm Velocity', outfieldAssessment.arm?.velocity, 'mph')}
                {renderArmMetric('Crow Hop', outfieldAssessment.arm?.crowHop, 'mph')}
                {renderArmMetric('Release Time', outfieldAssessment.arm?.releaseTime, 'sec', true)}
                {renderArmMetric('Accuracy', outfieldAssessment.arm?.accuracy, '/10')}
              </View>

              {outfieldAssessment.routesReads && (
                <>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 10 }}>Routes & Reads</Text>
                  <View style={s.kpiGrid}>
                    {outfieldAssessment.routesReads.routes?.grade != null && (
                      <PdfGradeCard label="Routes" grade={outfieldAssessment.routesReads.routes.grade} />
                    )}
                    {outfieldAssessment.routesReads.range?.grade != null && (
                      <PdfGradeCard label="Range" grade={outfieldAssessment.routesReads.range.grade} />
                    )}
                    {outfieldAssessment.routesReads.firstStep != null && (
                      <PdfGradeCard label="First Step" grade={outfieldAssessment.routesReads.firstStep} />
                    )}
                  </View>
                </>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 9, color: colors.textMuted }}>No outfield assessment data.</Text>
          )}

          {data.outfieldNotes && (
            <PdfNotesBox label="OUTFIELD NOTES" text={data.outfieldNotes} />
          )}
        </>
      )}

      <PageFooter reportTitle="Defense Assessment" date={reportDate} />
    </Page>
  );
}
