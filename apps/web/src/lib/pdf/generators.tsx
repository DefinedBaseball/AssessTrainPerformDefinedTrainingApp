/**
 * PDF Generation Functions — One per tab type
 * Each function creates a React PDF Document element and triggers download.
 */
import React from 'react';
import { Document } from '@react-pdf/renderer';
import { downloadPdf, pdfFilename, reportDateStr } from './download';
import { CoverPage } from './CoverPage';
import { HittingReportPages, type HittingPdfData } from './HittingReport';
import { PitchingReportPages, type PitchingPdfData, type ArsenalRow } from './PitchingReport';
import { DefenseReportPages, type DefensePdfData } from './DefenseReport';
import { StrengthReportPages, type StrengthPdfData } from './StrengthReport';
import { VisionReportPages, type VisionPdfData } from './VisionReport';
import { SummaryReportDocument, type SummaryPdfData } from './SummaryReport';
import * as api from '@/lib/api';
import type { ReportSummary } from '@/app/athletes/[id]/helpers';
import {
  TAB_METRICS, getTabMetrics, getReportUploadIds,
  getManualSwingScores, metricToGrade,
} from '@/app/athletes/[id]/helpers';

/* ── Helpers ── */

function parsePositions(posStr: string | null | undefined) {
  const positions = posStr?.split(',').map(p => p.trim()).filter(Boolean) || [];
  return {
    list: positions,
    isCatcher: positions.includes('C'),
    isInfielder: positions.includes('INF'),
    isOutfielder: positions.includes('OF'),
    isPitcher: positions.includes('P'),
  };
}

function buildTopMetricsFromRaw(metrics: any[]): Record<string, { value: number; unit: string; recordedAt: string }> {
  const lowerIsBetter = new Set(['sprint_60', 'pop_time', 'exchange_time']);
  const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
  for (const m of metrics) {
    const isBetter = lowerIsBetter.has(m.metricType)
      ? (!top[m.metricType] || m.value < top[m.metricType].value)
      : (!top[m.metricType] || m.value > top[m.metricType].value);
    if (isBetter) {
      top[m.metricType] = { value: m.value, unit: m.unit, recordedAt: m.recordedAt };
    }
  }
  return top;
}

function getAssessmentFromReport(report: ReportSummary | null, key: string): any {
  if (!report?.content) return null;
  try {
    const parsed = JSON.parse(report.content);
    return parsed[key] || null;
  } catch { return null; }
}

function getAtBatAssessmentFromReport(report: ReportSummary | null): any {
  return getAssessmentFromReport(report, 'atBatAssessment');
}

/* ═══════════════════════════════════════════
   HITTING PDF (Swing/Batted Ball + At-Bat Results)
   ═══════════════════════════════════════════ */

export async function generateHittingPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const reportDate = reportDateStr();

  // Find the selected/latest hitting report
  const hittingReport = reports
    .filter(r => r.reportType === 'HITTING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const uploadIds = getReportUploadIds(hittingReport);
  const ids = uploadIds.length > 0 ? uploadIds : undefined;

  // Manual coach grades + diagnosis notes from latest HITTING report
  const manual = getManualSwingScores(hittingReport);
  let diagnosisNotes = '';
  if (hittingReport?.content) {
    try {
      const c = JSON.parse(hittingReport.content);
      diagnosisNotes = typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { /* ignore */ }
  }

  // Compute Full Swing Miss% + spray dots from a single session-data fetch
  // (same source SwingTab + SprayChartView use). Miss% = swings where Squared
  // Up (col Q) was null. Spray dots = each swing's (angle, distance) plus EV.
  let fullSwingMissPct: number | null = null;
  let sprayDots: { angle: number; distance: number; exitVelo?: number }[] = [];
  try {
    const rows = await api.getSessionData(player.id, 'FULL_SWING',
      ['bat_speed', 'squared_up_pct', 'spray_angle', 'distance', 'max_exit_velo'],
      ids ? { uploadIds: ids } : undefined);
    const byTs = new Map<string, { bat: boolean; sq: boolean; angle?: number; dist?: number; ev?: number }>();
    for (const r of (rows as any[])) {
      const cur = byTs.get(r.recordedAt) ?? { bat: false, sq: false };
      if (r.metricType === 'bat_speed')      cur.bat = true;
      if (r.metricType === 'squared_up_pct') cur.sq  = true;
      if (r.metricType === 'spray_angle')    cur.angle = r.value;
      if (r.metricType === 'distance')       cur.dist  = r.value;
      if (r.metricType === 'max_exit_velo')  cur.ev    = r.value;
      byTs.set(r.recordedAt, cur);
    }
    const swings = Array.from(byTs.values()).filter(s => s.bat);
    if (swings.length > 0) {
      const misses = swings.filter(s => !s.sq).length;
      fullSwingMissPct = (misses / swings.length) * 100;
    }
    sprayDots = Array.from(byTs.values())
      .filter(s => s.angle !== undefined && s.dist !== undefined && s.dist! > 0)
      .map(s => ({ angle: s.angle!, distance: s.dist!, exitVelo: s.ev }));
  } catch { /* ignore */ }

  // Inject the synthetic miss% reading so the PDF renders Miss like any other metric.
  const topMetricsAll: Record<string, { value: number; unit: string; recordedAt: string }> = {
    ...topMetrics,
  };
  if (fullSwingMissPct !== null) {
    topMetricsAll.full_swing_miss_pct = {
      value: fullSwingMissPct, unit: '%', recordedAt: new Date().toISOString(),
    };
  }

  // Per-key 20-80 grades for Blast Motion mechanics inputs
  const SWING_KEYS = [
    'attack_angle', 'plane_angle', 'avg_bat_speed', 'time_to_contact',
    'on_plane_efficiency', 'connection_at_contact', 'rotational_acceleration',
  ] as const;
  const metricGrades: Record<string, number | null> = {};
  for (const k of SWING_KEYS) {
    metricGrades[k] = metricToGrade(topMetricsAll, k);
  }

  const data: HittingPdfData = {
    player,
    topMetrics: topMetricsAll,
    metricGrades,
    manual,
    diagnosisNotes,
    sprayDots,
    swingNotes: hittingReport?.notes || null,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Hitting Assessment`}>
      <CoverPage player={player} reportTitle="Hitting Assessment" reportDate={reportDate} />
      <HittingReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Hitting'));
}

/* ═══════════════════════════════════════════
   PITCHING PDF
   ═══════════════════════════════════════════ */

function buildArsenalFromPitches(pitches: api.TrackmanPitch[]): ArsenalRow[] {
  const groups: Record<string, api.TrackmanPitch[]> = {};
  for (const p of pitches) {
    const t = p.pitchType || 'Unknown';
    if (!groups[t]) groups[t] = [];
    groups[t].push(p);
  }

  return Object.entries(groups)
    .map(([type, list]) => {
      const velos = list.map(p => p.relSpeed ?? p.velocity).filter(v => v > 0);
      const spins = list.map(p => p.spinRate).filter((v): v is number => v !== null && v > 0);
      const hBreaks = list.map(p => p.horzBreak).filter((v): v is number => v !== null);
      const ivBreaks = list.map(p => p.inducedVertBreak).filter((v): v is number => v !== null);
      const exts = list.map(p => p.extension).filter((v): v is number => v !== null && v > 0);
      const spinAxes = list.map(p => p.spinAxis).filter((v): v is number => v !== null);

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      // Calculate tilt from spin axis
      const avgAxis = avg(spinAxes);
      const tiltH = Math.floor(avgAxis / 30) || 12;
      const tiltM = Math.round((avgAxis % 30) * 2);
      const tilt = `${tiltH}:${String(tiltM).padStart(2, '0')}`;

      // Spin efficiency
      const avgIVB = avg(ivBreaks);
      const avgHB = avg(hBreaks);
      const totalBreak = Math.sqrt(avgIVB * avgIVB + avgHB * avgHB);
      const avgSpin = avg(spins);
      const spinEff = avgSpin > 0 ? Math.min(100, (totalBreak / (avgSpin * 0.01)) * 2) : 0;

      return {
        pitchType: type,
        count: list.length,
        pct: 0, // filled below
        avgVelo: avg(velos),
        maxVelo: velos.length > 0 ? Math.max(...velos) : 0,
        minVelo: velos.length > 0 ? Math.min(...velos) : 0,
        avgSpin: avg(spins),
        avgHBreak: avg(hBreaks),
        avgIVB: avg(ivBreaks),
        avgExt: avg(exts),
        tilt,
        spinEff,
      };
    })
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function generatePitchingPdf(
  player: any,
  reports: ReportSummary[],
) {
  const reportDate = reportDateStr();

  const pitchingReport = reports
    .filter(r => r.reportType === 'PITCHING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const uploadIds = getReportUploadIds(pitchingReport);
  const opts = uploadIds.length > 0 ? { uploadIds } : undefined;

  const pitches = await api.getTrackmanPitches(player.id, opts).catch(() => []);
  const arsenal = buildArsenalFromPitches(pitches);
  const totalPitches = pitches.length;

  // Fill percentages
  arsenal.forEach(r => { r.pct = totalPitches > 0 ? (r.count / totalPitches) * 100 : 0; });

  const data: PitchingPdfData = {
    player,
    arsenal,
    totalPitches,
    pitchNotes: pitchingReport?.notes || null,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Pitching Assessment`}>
      <CoverPage player={player} reportTitle="Pitching Assessment" reportDate={reportDate} />
      <PitchingReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Pitching'));
}

/* ═══════════════════════════════════════════
   DEFENSE PDF
   ═══════════════════════════════════════════ */

export async function generateDefensePdf(
  player: any,
  reports: ReportSummary[],
) {
  const reportDate = reportDateStr();
  const pos = parsePositions(player.positions);

  // Get most recent assessment for each position type
  const catchingReport = reports
    .filter(r => r.reportType === 'CATCHING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const infieldReport = reports
    .filter(r => r.reportType === 'INFIELD')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const outfieldReport = reports
    .filter(r => r.reportType === 'OUTFIELD')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const data: DefensePdfData = {
    player,
    positions: {
      isCatcher: pos.isCatcher,
      isInfielder: pos.isInfielder,
      isOutfielder: pos.isOutfielder,
    },
    catchingAssessment: getAssessmentFromReport(catchingReport, 'catchingAssessment'),
    infieldAssessment: getAssessmentFromReport(infieldReport, 'infieldAssessment'),
    outfieldAssessment: getAssessmentFromReport(outfieldReport, 'outfieldAssessment'),
    catchingNotes: catchingReport?.notes || null,
    infieldNotes: infieldReport?.notes || null,
    outfieldNotes: outfieldReport?.notes || null,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Defense Assessment`}>
      <CoverPage player={player} reportTitle="Defense Assessment" reportDate={reportDate} />
      <DefenseReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Defense'));
}

/* ═══════════════════════════════════════════
   STRENGTH & CONDITIONING PDF
   ═══════════════════════════════════════════ */

export async function generateStrengthPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const reportDate = reportDateStr();

  const scReport = reports
    .filter(r => r.reportType === 'STRENGTH')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const uploadIds = getReportUploadIds(scReport);

  let activeMetrics = topMetrics;
  if (uploadIds.length > 0) {
    try {
      const rawMetrics = await api.getPlayerMetrics(player.id, { uploadIds });
      activeMetrics = buildTopMetricsFromRaw(rawMetrics);
    } catch { /* use global */ }
  }

  const scMetrics = getTabMetrics(activeMetrics, TAB_METRICS.strengthCond);

  const data: StrengthPdfData = {
    player,
    metrics: scMetrics,
    scNotes: scReport?.notes || null,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Strength & Conditioning`}>
      <CoverPage player={player} reportTitle="Strength & Conditioning" reportDate={reportDate} />
      <StrengthReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Strength_Conditioning'));
}

/* ═══════════════════════════════════════════
   VISION PDF
   ═══════════════════════════════════════════ */

export async function generateVisionPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const reportDate = reportDateStr();

  const visionReport = reports
    .filter(r => r.reportType === 'COGNITION')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const uploadIds = getReportUploadIds(visionReport);

  let activeMetrics = topMetrics;
  if (uploadIds.length > 0) {
    try {
      const rawMetrics = await api.getPlayerMetrics(player.id, { uploadIds });
      activeMetrics = buildTopMetricsFromRaw(rawMetrics);
    } catch { /* use global */ }
  }

  const visionMetrics = getTabMetrics(activeMetrics, TAB_METRICS.vision);

  const data: VisionPdfData = {
    player,
    metrics: visionMetrics,
    visionNotes: visionReport?.notes || null,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Cognition Assessment`}>
      <CoverPage player={player} reportTitle="Cognition Assessment" reportDate={reportDate} />
      <VisionReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Cognition'));
}

/* ═══════════════════════════════════════════
   SUMMARY PDF (All sections combined)
   ═══════════════════════════════════════════ */

export async function generateSummaryPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const reportDate = reportDateStr();
  const pos = parsePositions(player.positions);

  // ── Hitting data ──
  const hittingReport = reports
    .filter(r => r.reportType === 'HITTING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const hittingUploadIds = getReportUploadIds(hittingReport);
  const hIds = hittingUploadIds.length > 0 ? hittingUploadIds : undefined;

  const atBatReport = reports
    .filter(r => r.reportType === 'AT_BAT_RESULTS')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const atBatUploadIds = getReportUploadIds(atBatReport);
  const abIds = atBatUploadIds.length > 0 ? atBatUploadIds : undefined;

  // ── Pitching data ──
  const pitchingReport = reports
    .filter(r => r.reportType === 'PITCHING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const pitchUploadIds = getReportUploadIds(pitchingReport);
  const pOpts = pitchUploadIds.length > 0 ? { uploadIds: pitchUploadIds } : undefined;

  // ── S&C data ──
  const scReport = reports
    .filter(r => r.reportType === 'STRENGTH')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const scUploadIds = getReportUploadIds(scReport);

  // ── Vision data ──
  const visionReport = reports
    .filter(r => r.reportType === 'COGNITION')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const visionUploadIds = getReportUploadIds(visionReport);

  // ── Defense data ──
  const catchingReport = reports.filter(r => r.reportType === 'CATCHING').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const infieldReport = reports.filter(r => r.reportType === 'INFIELD').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const outfieldReport = reports.filter(r => r.reportType === 'OUTFIELD').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  // Fetch all data in parallel
  const [bbSummary, blastSummary, fsSummary, pitches, scRawMetrics, visionRawMetrics] = await Promise.all([
    api.getBattedBallSummary(player.id, 'FULL_SWING', hIds).catch(() => ({})),
    api.getBattedBallSummary(player.id, 'BLAST_MOTION', hIds).catch(() => ({})),
    api.getBattedBallSummary(player.id, 'FULL_SWING', abIds).catch(() => ({})),
    api.getTrackmanPitches(player.id, pOpts).catch(() => []),
    scUploadIds.length > 0 ? api.getPlayerMetrics(player.id, { uploadIds: scUploadIds }).catch(() => []) : Promise.resolve([]),
    visionUploadIds.length > 0 ? api.getPlayerMetrics(player.id, { uploadIds: visionUploadIds }).catch(() => []) : Promise.resolve([]),
  ]);

  // Build hitting data — mirrors generateHittingPdf so the summary PDF's
  // hitting page matches the standalone Hitting PDF.
  const summaryManual = getManualSwingScores(hittingReport);
  let summaryDiagnosisNotes = '';
  if (hittingReport?.content) {
    try {
      const c = JSON.parse(hittingReport.content);
      summaryDiagnosisNotes = typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { /* ignore */ }
  }
  let summaryMissPct: number | null = null;
  let summarySprayDots: { angle: number; distance: number; exitVelo?: number }[] = [];
  try {
    const rows = await api.getSessionData(player.id, 'FULL_SWING',
      ['bat_speed', 'squared_up_pct', 'spray_angle', 'distance', 'max_exit_velo'],
      hIds ? { uploadIds: hIds } : undefined);
    const byTs = new Map<string, { bat: boolean; sq: boolean; angle?: number; dist?: number; ev?: number }>();
    for (const r of (rows as any[])) {
      const cur = byTs.get(r.recordedAt) ?? { bat: false, sq: false };
      if (r.metricType === 'bat_speed')      cur.bat = true;
      if (r.metricType === 'squared_up_pct') cur.sq  = true;
      if (r.metricType === 'spray_angle')    cur.angle = r.value;
      if (r.metricType === 'distance')       cur.dist  = r.value;
      if (r.metricType === 'max_exit_velo')  cur.ev    = r.value;
      byTs.set(r.recordedAt, cur);
    }
    const swings = Array.from(byTs.values()).filter(s => s.bat);
    if (swings.length > 0) {
      summaryMissPct = (swings.filter(s => !s.sq).length / swings.length) * 100;
    }
    summarySprayDots = Array.from(byTs.values())
      .filter(s => s.angle !== undefined && s.dist !== undefined && s.dist! > 0)
      .map(s => ({ angle: s.angle!, distance: s.dist!, exitVelo: s.ev }));
  } catch { /* ignore */ }
  const summaryTopAll: Record<string, { value: number; unit: string; recordedAt: string }> = { ...topMetrics };
  if (summaryMissPct !== null) {
    summaryTopAll.full_swing_miss_pct = {
      value: summaryMissPct, unit: '%', recordedAt: new Date().toISOString(),
    };
  }
  const SWING_KEYS_SUM = [
    'attack_angle', 'plane_angle', 'avg_bat_speed', 'time_to_contact',
    'on_plane_efficiency', 'connection_at_contact', 'rotational_acceleration',
  ] as const;
  const summaryGrades: Record<string, number | null> = {};
  for (const k of SWING_KEYS_SUM) {
    summaryGrades[k] = metricToGrade(summaryTopAll, k);
  }
  const hittingData: HittingPdfData = {
    player,
    topMetrics: summaryTopAll,
    metricGrades: summaryGrades,
    manual: summaryManual,
    diagnosisNotes: summaryDiagnosisNotes,
    sprayDots: summarySprayDots,
    swingNotes: hittingReport?.notes || null,
    reportDate,
  };

  // Build pitching data
  const arsenal = buildArsenalFromPitches(pitches);
  const totalPitches = pitches.length;
  arsenal.forEach(r => { r.pct = totalPitches > 0 ? (r.count / totalPitches) * 100 : 0; });

  const pitchingData: PitchingPdfData | null = totalPitches > 0 ? {
    player,
    arsenal,
    totalPitches,
    pitchNotes: pitchingReport?.notes || null,
    reportDate,
  } : null;

  // Build defense data (only if non-pitcher positions)
  const hasDefensePositions = pos.isCatcher || pos.isInfielder || pos.isOutfielder;
  const defenseData: DefensePdfData | null = hasDefensePositions ? {
    player,
    positions: {
      isCatcher: pos.isCatcher,
      isInfielder: pos.isInfielder,
      isOutfielder: pos.isOutfielder,
    },
    catchingAssessment: getAssessmentFromReport(catchingReport, 'catchingAssessment'),
    infieldAssessment: getAssessmentFromReport(infieldReport, 'infieldAssessment'),
    outfieldAssessment: getAssessmentFromReport(outfieldReport, 'outfieldAssessment'),
    catchingNotes: catchingReport?.notes || null,
    infieldNotes: infieldReport?.notes || null,
    outfieldNotes: outfieldReport?.notes || null,
    reportDate,
  } : null;

  // Build S&C data
  const scActiveMetrics = scRawMetrics.length > 0 ? buildTopMetricsFromRaw(scRawMetrics) : topMetrics;
  const scMetrics = getTabMetrics(scActiveMetrics, TAB_METRICS.strengthCond);
  const strengthData: StrengthPdfData | null = Object.keys(scMetrics).length > 0 ? {
    player,
    metrics: scMetrics,
    scNotes: scReport?.notes || null,
    reportDate,
  } : null;

  // Build vision data
  const visionActiveMetrics = visionRawMetrics.length > 0 ? buildTopMetricsFromRaw(visionRawMetrics) : topMetrics;
  const visionMetrics = getTabMetrics(visionActiveMetrics, TAB_METRICS.vision);
  const visionData: VisionPdfData | null = Object.keys(visionMetrics).length > 0 ? {
    player,
    metrics: visionMetrics,
    visionNotes: visionReport?.notes || null,
    reportDate,
  } : null;

  const summaryData: SummaryPdfData = {
    player,
    hitting: hittingData,
    pitching: pitchingData,
    defense: defenseData,
    strength: strengthData,
    vision: visionData,
    reportDate,
  };

  const doc = <SummaryReportDocument data={summaryData} />;
  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Complete_Assessment'));
}
