/**
 * Hitting PDF Report — Combines Swing/Batted Ball + At-Bat Results
 */
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { s, colors } from './theme';
import {
  PageFooter, PdfSectionHeader, PdfKpiCard, PdfScoreBar,
  PdfTable, PdfNotesBox, PdfPlayerInfoBar, PdfDivider,
  PdfMetricPair, PdfScalePips, PdfPercentMetric,
} from './components';
import {
  METRIC_LABELS, getBadgeLevel, getBadgeText, toScoutingGrade, GRADE_RANGES,
  formatHeight, getAge,
} from '@/app/athletes/[id]/helpers';

export interface HittingPdfData {
  player: any;
  // Swing metrics (from topMetrics / activeMetrics)
  swingMetrics: Record<string, { value: number; unit: string }>;
  // Batted ball summary (Full Swing)
  battedBallSummary: Record<string, { avg: number; max: number; min: number; count: number }>;
  // Blast summary
  blastSummary: Record<string, { avg: number; max: number; min: number; count: number }>;
  // Scouting grade keys
  scoutingGradeKeys?: string[];
  // Notes
  swingNotes: string | null;
  // At-Bat Assessment data
  atBatAssessment: {
    metrics: {
      fbBarrelPct: number | null;
      fbWhiffPct: number | null;
      fbInZoneSwingPct: number | null;
      fbChasePct: number | null;
      osBarrelPct: number | null;
      osWhiffPct: number | null;
      osInZoneSwingPct: number | null;
      osChasePct: number | null;
      overallBarrelPct: number | null;
      overallBbPct: number | null;
      overallKPct: number | null;
      avgEv: number | null;
    };
  } | null;
  // Full Swing data for At-Bat tab
  fsSummary: Record<string, { avg: number; max: number; min?: number; count?: number }>;
  // Recognition scores
  recognitionMetrics: Record<string, { value: number; unit: string }>;
  // At-Bat notes
  atBatNotes: string | null;
  reportDate: string;
}

export function HittingReportPages({ data }: { data: HittingPdfData }) {
  const { player, battedBallSummary, blastSummary, swingMetrics, atBatAssessment, fsSummary, recognitionMetrics, reportDate } = data;
  const date = reportDate;
  const bb = battedBallSummary;
  const blast = blastSummary;

  // Build scouting grade rows
  const gradeKeys = ['max_exit_velo', 'bat_speed', 'max_bat_speed', 'squared_up_pct', 'distance', 'smash_factor']
    .filter(k => (swingMetrics[k] || bb[k === 'max_exit_velo' ? 'max_exit_velo' : k]) && GRADE_RANGES[k]);

  return (
    <>
      {/* ── Page 1: Swing / Batted Ball ── */}
      <Page size="LETTER" style={s.page}>
        <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

        <PdfSectionHeader title="Batted Ball Data" subtitle="Full Swing / HitTrax" />

        {/* Batted Ball Summary Grid */}
        {Object.keys(bb).length > 0 ? (
          <View style={s.kpiGrid}>
            {bb.max_exit_velo && (
              <PdfMetricPair label="Exit Velo" avg={bb.max_exit_velo.avg} max={bb.max_exit_velo.max} unit="mph" />
            )}
            {bb.launch_angle && (
              <PdfMetricPair label="Launch Angle" avg={bb.launch_angle.avg} max={bb.launch_angle.max} unit="deg" />
            )}
            {bb.bat_speed && (
              <PdfMetricPair label="Bat Speed" avg={bb.bat_speed.avg} max={bb.bat_speed.max} unit="mph" />
            )}
            {bb.distance && (
              <PdfMetricPair label="Distance" avg={bb.distance.avg} max={bb.distance.max} unit="ft" decimals={0} />
            )}
            {bb.smash_factor && (
              <PdfMetricPair label="Smash Factor" avg={bb.smash_factor.avg} max={bb.smash_factor.max} decimals={2} />
            )}
            {bb.squared_up_pct && (
              <PdfMetricPair label="Squared Up %" avg={bb.squared_up_pct.avg} max={bb.squared_up_pct.max} unit="%" decimals={0} />
            )}
          </View>
        ) : (
          <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 12 }}>No batted ball data available.</Text>
        )}

        <PdfDivider />

        {/* Swing Metrics (Blast Motion) */}
        <PdfSectionHeader title="Swing Metrics" subtitle="Blast Motion" />

        {Object.keys(blast).length > 0 ? (
          <View style={s.kpiGrid}>
            {blast.max_bat_speed && (
              <PdfMetricPair label="Max Bat Speed" avg={blast.max_bat_speed.avg} max={blast.max_bat_speed.max} unit="mph" />
            )}
            {blast.peak_hand_speed && (
              <PdfMetricPair label="Peak Hand Speed" avg={blast.peak_hand_speed.avg} max={blast.peak_hand_speed.max} unit="mph" />
            )}
            {blast.attack_angle && (
              <PdfMetricPair label="Attack Angle" avg={blast.attack_angle.avg} max={blast.attack_angle.max} unit="deg" />
            )}
            {blast.time_to_contact && (
              <PdfMetricPair label="Time to Contact" avg={blast.time_to_contact.avg} max={blast.time_to_contact.min} unit="sec" decimals={3} />
            )}
            {blast.on_plane_efficiency && (
              <PdfMetricPair label="On-Plane Eff." avg={blast.on_plane_efficiency.avg} max={blast.on_plane_efficiency.max} unit="%" decimals={0} />
            )}
            {blast.rotational_acceleration && (
              <PdfMetricPair label="Rotational Accel" avg={blast.rotational_acceleration.avg} max={blast.rotational_acceleration.max} />
            )}
          </View>
        ) : (
          <Text style={{ fontSize: 9, color: colors.textMuted, marginBottom: 12 }}>No Blast Motion data available.</Text>
        )}

        {/* Scouting Grades */}
        {gradeKeys.length > 0 && (
          <>
            <PdfDivider />
            <PdfSectionHeader title="Scouting Grades" subtitle="20-80 Scale" />
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderCell, { flex: 2 }]}>Metric</Text>
                <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Value</Text>
                <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Grade</Text>
                <Text style={[s.tableHeaderCell, { flex: 2 }]}>Scale</Text>
              </View>
              {gradeKeys.map((key, i) => {
                const raw = swingMetrics[key]?.value ?? bb[key]?.max ?? 0;
                const grade = toScoutingGrade(raw, key);
                return (
                  <View key={key} style={[s.gradeRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                    <Text style={[s.gradeLabel, { flex: 2 }]}>{METRIC_LABELS[key] || key}</Text>
                    <Text style={[s.gradeValue, { flex: 1 }]}>
                      {key === 'smash_factor' ? raw.toFixed(2) : raw.toFixed(1)}
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

        {/* Notes */}
        {data.swingNotes && (
          <>
            <PdfDivider />
            <PdfNotesBox label="SWING & BATTED BALL NOTES" text={data.swingNotes} />
          </>
        )}

        <PageFooter reportTitle="Hitting Assessment" date={date} />
      </Page>

      {/* ── Page 2: At-Bat Results ── */}
      {(atBatAssessment || Object.keys(fsSummary).length > 0 || Object.keys(recognitionMetrics).length > 0) && (
        <Page size="LETTER" style={s.page}>
          <PdfPlayerInfoBar player={player} formatHeight={formatHeight} getAge={getAge} />

          {/* At-Bat Assessment */}
          {atBatAssessment?.metrics && (
            <>
              <PdfSectionHeader title="At-Bat Assessment" subtitle="Pitch type performance" />

              {/* Fastball metrics */}
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6, marginTop: 4 }}>Fastball</Text>
              <View style={{ marginBottom: 10 }}>
                <PdfPercentMetric label="Barrel %" value={atBatAssessment.metrics.fbBarrelPct} level={atBatAssessment.metrics.fbBarrelPct !== null ? getBadgeLevel('fb_barrel_pct', atBatAssessment.metrics.fbBarrelPct) : undefined} />
                <PdfPercentMetric label="Whiff %" value={atBatAssessment.metrics.fbWhiffPct} level={atBatAssessment.metrics.fbWhiffPct !== null ? getBadgeLevel('fb_whiff_pct', atBatAssessment.metrics.fbWhiffPct) : undefined} />
                <PdfPercentMetric label="In-Zone Swing %" value={atBatAssessment.metrics.fbInZoneSwingPct} level={atBatAssessment.metrics.fbInZoneSwingPct !== null ? getBadgeLevel('fb_in_zone_swing_pct', atBatAssessment.metrics.fbInZoneSwingPct) : undefined} />
                <PdfPercentMetric label="Chase %" value={atBatAssessment.metrics.fbChasePct} level={atBatAssessment.metrics.fbChasePct !== null ? getBadgeLevel('fb_chase_pct', atBatAssessment.metrics.fbChasePct) : undefined} />
              </View>

              {/* Off-Speed metrics */}
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6 }}>Off-Speed</Text>
              <View style={{ marginBottom: 10 }}>
                <PdfPercentMetric label="Barrel %" value={atBatAssessment.metrics.osBarrelPct} level={atBatAssessment.metrics.osBarrelPct !== null ? getBadgeLevel('os_barrel_pct', atBatAssessment.metrics.osBarrelPct) : undefined} />
                <PdfPercentMetric label="Whiff %" value={atBatAssessment.metrics.osWhiffPct} level={atBatAssessment.metrics.osWhiffPct !== null ? getBadgeLevel('os_whiff_pct', atBatAssessment.metrics.osWhiffPct) : undefined} />
                <PdfPercentMetric label="In-Zone Swing %" value={atBatAssessment.metrics.osInZoneSwingPct} level={atBatAssessment.metrics.osInZoneSwingPct !== null ? getBadgeLevel('os_in_zone_swing_pct', atBatAssessment.metrics.osInZoneSwingPct) : undefined} />
                <PdfPercentMetric label="Chase %" value={atBatAssessment.metrics.osChasePct} level={atBatAssessment.metrics.osChasePct !== null ? getBadgeLevel('os_chase_pct', atBatAssessment.metrics.osChasePct) : undefined} />
              </View>

              {/* Overall */}
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 6 }}>Overall</Text>
              <View style={{ marginBottom: 10 }}>
                <PdfPercentMetric label="Barrel %" value={atBatAssessment.metrics.overallBarrelPct} level={atBatAssessment.metrics.overallBarrelPct !== null ? getBadgeLevel('overall_barrel_pct', atBatAssessment.metrics.overallBarrelPct) : undefined} />
                <PdfPercentMetric label="BB %" value={atBatAssessment.metrics.overallBbPct} level={atBatAssessment.metrics.overallBbPct !== null ? getBadgeLevel('overall_bb_pct', atBatAssessment.metrics.overallBbPct) : undefined} />
                <PdfPercentMetric label="K %" value={atBatAssessment.metrics.overallKPct} level={atBatAssessment.metrics.overallKPct !== null ? getBadgeLevel('overall_k_pct', atBatAssessment.metrics.overallKPct) : undefined} />
              </View>
            </>
          )}

          <PdfDivider />

          {/* Full Swing Data (At-Bat Tab) */}
          {Object.keys(fsSummary).length > 0 && (
            <>
              <PdfSectionHeader title="Full Swing Data" subtitle="At-bat exit velocity & quality" />
              <View style={s.kpiGrid}>
                {fsSummary.max_exit_velo && (
                  <PdfMetricPair label="Exit Velo" avg={fsSummary.max_exit_velo.avg} max={fsSummary.max_exit_velo.max} unit="mph" />
                )}
                {fsSummary.launch_angle && (
                  <PdfMetricPair label="Launch Angle" avg={fsSummary.launch_angle.avg} max={fsSummary.launch_angle.max} unit="deg" />
                )}
                {fsSummary.bat_speed && (
                  <PdfMetricPair label="Bat Speed" avg={fsSummary.bat_speed.avg} max={fsSummary.bat_speed.max} unit="mph" />
                )}
                {fsSummary.distance && (
                  <PdfMetricPair label="Distance" avg={fsSummary.distance.avg} max={fsSummary.distance.max} unit="ft" decimals={0} />
                )}
                {fsSummary.squared_up_pct && (
                  <PdfMetricPair label="Squared Up %" avg={fsSummary.squared_up_pct.avg} max={fsSummary.squared_up_pct.max} unit="%" decimals={0} />
                )}
              </View>
              <PdfDivider />
            </>
          )}

          {/* Recognition Scores */}
          {Object.keys(recognitionMetrics).length > 0 && (
            <>
              <PdfSectionHeader title="Pitch Recognition" subtitle="Identification accuracy" />
              <View style={s.kpiGrid}>
                {['pitch_rec_fb', 'pitch_rec_os', 'pitch_rec_overall', 'ab_iq'].map(key => {
                  const m = recognitionMetrics[key];
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
              <View style={{ marginTop: 8 }}>
                {['pitch_rec_fb', 'pitch_rec_os', 'pitch_rec_overall', 'ab_iq'].map(key => {
                  const m = recognitionMetrics[key];
                  if (!m) return null;
                  const level = getBadgeLevel(key, m.value);
                  return (
                    <PdfScoreBar
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={m.value.toFixed(0)}
                      percent={m.value}
                      level={level}
                    />
                  );
                })}
              </View>
            </>
          )}

          {/* Notes */}
          {data.atBatNotes && (
            <>
              <PdfDivider />
              <PdfNotesBox label="AT-BAT RESULTS NOTES" text={data.atBatNotes} />
            </>
          )}

          <PageFooter reportTitle="Hitting Assessment — At-Bat Results" date={date} />
        </Page>
      )}
    </>
  );
}
