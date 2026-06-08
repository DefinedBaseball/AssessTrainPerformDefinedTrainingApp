/**
 * PDF Generation Functions — One per tab type
 * Each function creates a React PDF Document element and triggers download.
 */
import React from 'react';
import { Document, Page, View, Image, Text, StyleSheet } from '@react-pdf/renderer';
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
  getManualSwingScores, getManualSwingOptions, metricToGrade,
  getManualSwingMetrics, getManualBattedBall,
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
  /** Optional pre-computed Quality-of-Contact override from the in-app
   *  Hitting Snapshot — pooled HitTrax + Full Swing means/maxes for
   *  Avg EV / Max EV / LA / Dist. When provided, the PDF uses these
   *  values verbatim so there can be no drift between the on-screen
   *  snapshot and the printed report. */
  qocOverride?: Record<string, { value: number; unit: string }>,
) {
  const reportDate = reportDateStr();

  // Find the selected/latest hitting report
  const hittingReport = reports
    .filter(r => r.reportType === 'HITTING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  const uploadIds = getReportUploadIds(hittingReport);
  const ids = uploadIds.length > 0 ? uploadIds : undefined;

  // Manual coach grades + diagnosis notes from latest HITTING report.
  // Diagnosis notes prefer the report's top-level `notes` field (source of
  // truth in the modal + snapshot), falling back to legacy
  // content.diagnosisNotes for older reports.
  const manual = getManualSwingScores(hittingReport);
  // Multi-select option tags ("Drift", "+Stack", etc.) the coach picked
  // alongside each grade. Persisted in the report content blob; surfacing
  // them in the PDF keeps the printed report aligned with the in-app
  // Swing tab where these chips render below each grade card.
  const manualOptions = getManualSwingOptions(hittingReport);
  let diagnosisNotes = (hittingReport?.notes && hittingReport.notes.trim()) || '';
  if (!diagnosisNotes && hittingReport?.content) {
    try {
      const c = JSON.parse(hittingReport.content);
      diagnosisNotes = typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { /* ignore */ }
  }

  /* Compute Full Swing Miss% + spray dots — mirrors SprayChartView so the
     PDF and the in-app spray chart show the same dots:
       1. Fetch HITTRAX-source spray_x / spray_z / spray_angle / spray_dist /
          ball_type_code in parallel with the FULL_SWING session data.
       2. If HitTrax has dots, those win (Cartesian X/Z preferred, polar
          Horiz. Angle + Dist as fallback). Each dot also carries
          ballTypeCode so PdfSprayChart can color GB/LD/FB.
       3. Otherwise fall back to the FULL_SWING-derived dots (spray_angle,
          distance, max_exit_velo for color). */
  let fullSwingMissPct: number | null = null;
  let sprayDots: { angle: number; distance: number; exitVelo?: number; ballTypeCode?: number }[] = [];
  try {
    const [htRows, fsRows] = await Promise.all([
      api.getSessionData(player.id, 'HITTRAX',
        ['spray_x', 'spray_z', 'spray_angle', 'spray_dist', 'ball_type_code', 'max_exit_velo', 'launch_angle'],
        ids ? { uploadIds: ids } : undefined,
      ).catch(() => [] as any[]),
      api.getSessionData(player.id, 'FULL_SWING',
        ['bat_speed', 'squared_up_pct', 'spray_angle', 'distance', 'max_exit_velo'],
        ids ? { uploadIds: ids } : undefined,
      ).catch(() => [] as any[]),
    ]);

    // ── HitTrax dots (Cartesian preferred, polar fallback) ──
    type HtRow = { x?: number; z?: number; polarAngle?: number; polarDist?: number; type?: number; ev?: number };
    const htByTs = new Map<string, HtRow>();
    for (const r of (htRows as any[])) {
      const cur = htByTs.get(r.recordedAt) ?? {};
      if (r.metricType === 'spray_x')        cur.x = r.value;
      if (r.metricType === 'spray_z')        cur.z = r.value;
      if (r.metricType === 'spray_angle')    cur.polarAngle = r.value;
      if (r.metricType === 'spray_dist')     cur.polarDist  = r.value;
      if (r.metricType === 'ball_type_code') cur.type = r.value;
      if (r.metricType === 'max_exit_velo')  cur.ev   = r.value;
      htByTs.set(r.recordedAt, cur);
    }
    const htDots: typeof sprayDots = [];
    for (const e of htByTs.values()) {
      let angle: number | undefined;
      let distance: number | undefined;
      if (e.x !== undefined && e.z !== undefined && e.z > 0) {
        distance = Math.sqrt(e.x * e.x + e.z * e.z);
        angle = (Math.atan2(e.x, e.z) * 180) / Math.PI;
      } else if (e.polarAngle !== undefined && e.polarDist !== undefined && e.polarDist > 0) {
        angle = e.polarAngle;
        distance = e.polarDist;
      }
      if (angle !== undefined && distance !== undefined) {
        htDots.push({ angle, distance, exitVelo: e.ev, ballTypeCode: e.type });
      }
    }

    // ── Full Swing miss% + dot fallback ──
    const fsByTs = new Map<string, { bat: boolean; sq: boolean; angle?: number; dist?: number; ev?: number }>();
    for (const r of (fsRows as any[])) {
      const cur = fsByTs.get(r.recordedAt) ?? { bat: false, sq: false };
      if (r.metricType === 'bat_speed')      cur.bat = true;
      if (r.metricType === 'squared_up_pct') cur.sq  = true;
      if (r.metricType === 'spray_angle')    cur.angle = r.value;
      if (r.metricType === 'distance')       cur.dist  = r.value;
      if (r.metricType === 'max_exit_velo')  cur.ev    = r.value;
      fsByTs.set(r.recordedAt, cur);
    }
    const swings = Array.from(fsByTs.values()).filter(s => s.bat);
    if (swings.length > 0) {
      const misses = swings.filter(s => !s.sq).length;
      fullSwingMissPct = (misses / swings.length) * 100;
    }
    const fsDots: typeof sprayDots = Array.from(fsByTs.values())
      .filter(s => s.angle !== undefined && s.dist !== undefined && s.dist! > 0)
      .map(s => ({ angle: s.angle!, distance: s.dist!, exitVelo: s.ev }));

    // HitTrax wins when present, mirroring SprayChartView.
    sprayDots = htDots.length > 0 ? htDots : fsDots;
  } catch { /* ignore */ }

  /* topMetrics passed in IS already the in-app Snapshot's
     topMetricsWithMiss (active-report-scoped: at-bat XLSX + manual entries
     gated by manualEntryModes + this report's CSV-derived metrics). We
     also overlay the manual entries here as a defensive fallback for
     cases where the caller passes the player-wide topMetrics instead —
     the same gating + merge order HittingTab uses, so the PDF can never
     drift from what the coach sees on screen. */
  const topMetricsAll: Record<string, { value: number; unit: string; recordedAt: string }> = {
    ...topMetrics,
  };

  // Read the active report's manual-mode flags so stale manualBattedBall /
  // manualSwingMetrics from older saves don't leak into the PDF.
  let manualModes = { fullswing: false, blast: false };
  if (hittingReport?.content) {
    try {
      const c = JSON.parse(hittingReport.content);
      const m = c?.manualEntryModes;
      manualModes = {
        fullswing: !!(m && m.fullswing),
        blast: !!(m && m.blast),
      };
    } catch { /* ignore */ }
  }
  const manualBatted = getManualBattedBall(hittingReport);
  const manualSwing  = getManualSwingMetrics(hittingReport);
  const mergeManual = (
    entries: Record<string, number | null>,
    unitFor: (k: string) => string,
  ) => {
    for (const [k, val] of Object.entries(entries)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      // Don't override values already present in topMetrics (the caller's
      // topMetricsWithMiss would have CSV-derived data already merged).
      if (topMetricsAll[k] !== undefined) continue;
      topMetricsAll[k] = {
        value: val, unit: unitFor(k),
        recordedAt: hittingReport?.createdAt ?? new Date().toISOString(),
      };
    }
  };
  if (manualModes.blast) {
    mergeManual(manualSwing as unknown as Record<string, number | null>, (k) => {
      if (k === 'time_to_contact') return 'sec';
      if (k.endsWith('_pct') || k === 'on_plane_efficiency') return '%';
      if (k === 'attack_angle' || k === 'plane_angle') return 'deg';
      if (k === 'power_output') return 'kW';
      if (k === 'peak_hand_speed') return 'mph';
      /* Blast CSV spec additions — scores are unitless, the two
         connection-degree readings carry 'deg' so badge / chip
         renderers see the right unit when they reference it. */
      if (k === 'plane_score' || k === 'connection_score' || k === 'rotation_score') return '';
      if (k === 'early_connection' || k === 'connection_at_impact') return 'deg';
      return 'mph';
    });
  }
  if (manualModes.fullswing) {
    mergeManual(manualBatted as unknown as Record<string, number | null>, (k) => {
      if (k === 'distance') return 'ft';
      if (k === 'launch_angle') return 'deg';
      if (k === 'avg_exit_velo' || k === 'max_exit_velo') return 'mph';
      if (k === 'smash_factor') return '';
      return '%';
    });
  }

  if (fullSwingMissPct !== null) {
    topMetricsAll.full_swing_miss_pct = {
      value: fullSwingMissPct, unit: '%', recordedAt: new Date().toISOString(),
    };
  }
  /* Pooled Avg / Max EV is overlaid below — after the per-source fetch
     populates htVelos / fsVelos. Order matters: declaring it here would
     hit the temporal dead zone since those arrays are still uninitialized. */

  // Per-key 20-80 grades for Blast Motion mechanics inputs.
  // Includes max_bat_speed so the Swing row's first chip lights up.
  // Blast CSV spec additions (plane_score / connection_score /
  // rotation_score / early_connection / connection_at_impact) appended
  // so their KPI cards in the PDF Blast Motion section get a color via
  // `metricGrades` — keep this in sync with HittingReport.tsx's
  // SWING_METRIC_KEYS so every chip / card grade flows through.
  const SWING_KEYS = [
    'max_bat_speed', 'avg_bat_speed',
    'attack_angle', 'plane_angle', 'time_to_contact',
    'on_plane_efficiency', 'power_output', 'peak_hand_speed',
    'plane_score', 'connection_score', 'rotation_score',
    'early_connection', 'connection_at_impact',
  ] as const;
  const metricGrades: Record<string, number | null> = {};
  for (const k of SWING_KEYS) {
    metricGrades[k] = metricToGrade(topMetricsAll, k);
  }

  /* Per-source aggregates for the PDF's HitTrax + Full Swing sections.
     Strict per-active-report scoping — fetches every metric for THIS
     report's upload IDs and buckets by source. Mirrors HittingTab so the
     PDF and the in-app Snapshot show the exact same numbers. If the
     report has no upload IDs, every aggregate is empty and the matching
     section is dropped from the PDF. */
  let htVelos: number[] = [], htLAs: number[] = [], htDists: number[] = [];
  let fsVelos: number[] = [], fsLAs: number[] = [], fsDists: number[] = [];
  if (uploadIds.length > 0) {
    try {
      const reportMetrics = await api.getPlayerMetrics(player.id, { uploadIds });
      for (const m of reportMetrics as any[]) {
        if (!Number.isFinite(m.value)) continue;
        if (m.source === 'HITTRAX') {
          if (m.metricType === 'max_exit_velo') htVelos.push(m.value);
          else if (m.metricType === 'launch_angle') htLAs.push(m.value);
          else if (m.metricType === 'distance') htDists.push(m.value);
        } else if (m.source === 'FULL_SWING') {
          if (m.metricType === 'max_exit_velo') fsVelos.push(m.value);
          else if (m.metricType === 'launch_angle') fsLAs.push(m.value);
          else if (m.metricType === 'distance') fsDists.push(m.value);
        }
      }
      // Drop Velo=0 rows so empty at-bats don't drag averages toward zero.
      htVelos = htVelos.filter(v => v !== 0);
      fsVelos = fsVelos.filter(v => v !== 0);
    } catch { /* leave arrays empty */ }
  }
  const meanRound = (arr: number[]) =>
    Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 100) / 100;
  const buildSourceValues = (
    velos: number[], las: number[], dists: number[],
  ): Record<string, { value: number; unit: string }> => {
    const out: Record<string, { value: number; unit: string }> = {};
    if (velos.length > 0) {
      out.avg_exit_velo = { value: meanRound(velos),                      unit: 'mph' };
      out.max_exit_velo = { value: Math.round(Math.max(...velos) * 100) / 100, unit: 'mph' };
    }
    if (las.length   > 0) out.launch_angle = { value: meanRound(las),   unit: 'deg' };
    if (dists.length > 0) out.distance     = { value: meanRound(dists), unit: 'ft'  };
    return out;
  };
  const hittraxValues  = buildSourceValues(htVelos, htLAs, htDists);
  const fullswingValues = buildSourceValues(fsVelos, fsLAs, fsDists);

  /* Quality-of-Contact overlay — single source of truth.
     Prefers the caller's pre-computed qocOverride (which IS the in-app
     Snapshot's qocOverride from HittingTab — already pooled across
     HitTrax + Full Swing per-row velos/LAs/distances). Eliminates any
     chance of the PDF drifting from what's on screen.
     Fallback (no qocOverride passed): re-pool from the per-source
     fetch above so older callers still get correct numbers. */
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (qocOverride) {
    for (const [k, v] of Object.entries(qocOverride)) {
      topMetricsAll[k] = {
        value: v.value,
        unit: v.unit,
        recordedAt: new Date().toISOString(),
      };
    }
  } else {
    const meanOf = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const pooledVelos = [...htVelos, ...fsVelos];
    const pooledLAs   = [...htLAs,   ...fsLAs];
    const pooledDists = [...htDists, ...fsDists];
    if (pooledVelos.length > 0) {
      topMetricsAll.avg_exit_velo = {
        value: round2(meanOf(pooledVelos)), unit: 'mph',
        recordedAt: new Date().toISOString(),
      };
      topMetricsAll.max_exit_velo = {
        value: round2(Math.max(...pooledVelos)), unit: 'mph',
        recordedAt: new Date().toISOString(),
      };
    }
    if (pooledLAs.length > 0) {
      topMetricsAll.launch_angle = {
        value: round2(meanOf(pooledLAs)), unit: 'deg',
        recordedAt: new Date().toISOString(),
      };
    }
    if (pooledDists.length > 0) {
      topMetricsAll.distance = {
        value: round2(meanOf(pooledDists)), unit: 'ft',
        recordedAt: new Date().toISOString(),
      };
    }
  }

  const data: HittingPdfData = {
    player,
    topMetrics: topMetricsAll,
    metricGrades,
    manual,
    manualOptions,
    diagnosisNotes,
    sprayDots,
    swingNotes: hittingReport?.notes || null,
    reportDate,
    hittraxValues,
    fullswingValues,
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
      const relHeights = list.map(p => p.relHeight).filter((v): v is number => v !== null);
      const relSides = list.map(p => p.relSide).filter((v): v is number => v !== null);
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
        /* Release height / side per pitch type — used by the Release &
           Extension table on PDF page 3, mirrors the in-app
           `computeArsenal` averages. */
        avgRelHeight: avg(relHeights),
        avgRelSide: avg(relSides),
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

  /* Pitching Notes — pulled from `content.pitchingNotes` (the in-app
     Pitching Notes bubble persists there), falling back to the report's
     top-level `notes` field for older saves that wrote to it. */
  let pitchNotes: string | null = null;
  if (pitchingReport?.content) {
    try {
      const c = JSON.parse(pitchingReport.content);
      if (typeof c.pitchingNotes === 'string' && c.pitchingNotes.trim()) {
        pitchNotes = c.pitchingNotes.trim();
      }
    } catch { /* ignore */ }
  }
  if (!pitchNotes && pitchingReport?.notes && pitchingReport.notes.trim()) {
    pitchNotes = pitchingReport.notes.trim();
  }

  /* Project the raw TrackmanPitch list onto the lighter PdfPitch shape so
     the PDF plots only carry the columns each chart consumes. */
  const pdfPitches = pitches.map((p) => ({
    pitchType: p.pitchType,
    horzBreak: p.horzBreak,
    inducedVertBreak: p.inducedVertBreak,
    plateLocSide: p.plateLocSide,
    plateLocHeight: p.plateLocHeight,
    relSide: p.relSide,
    relHeight: p.relHeight,
    pitcherThrows: p.pitcherThrows,
  }));

  /* Pull saved Coach Grades off the active PITCHING report so the PDF's
     new Coach Grades page can render per-section aggregates + chips
     identical to the in-app Pitching tab. Absent on legacy reports —
     the PDF page only renders when at least one section carries data. */
  const pitchingGrades = (() => {
    if (!pitchingReport?.content) return undefined;
    try {
      const c = JSON.parse(pitchingReport.content);
      return c?.pitchingGrades && typeof c.pitchingGrades === 'object'
        ? c.pitchingGrades
        : undefined;
    } catch { return undefined; }
  })();

  const data: PitchingPdfData = {
    player,
    arsenal,
    totalPitches,
    pitchNotes,
    pitches: pdfPitches,
    pitchingGrades,
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
  const summaryManualOptions = getManualSwingOptions(hittingReport);
  // Same precedence as generateHittingPdf: report.notes first, legacy
  // content.diagnosisNotes fallback.
  let summaryDiagnosisNotes = (hittingReport?.notes && hittingReport.notes.trim()) || '';
  if (!summaryDiagnosisNotes && hittingReport?.content) {
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
  /* Keep in sync with the SWING_KEYS in generateHittingPdf above —
     summary PDF needs the same 13 graded metrics so the new Blast CSV
     additions (plane_score / connection_score / rotation_score /
     early_connection / connection_at_impact) color correctly in the
     summary's Hitting chip strip + Blast Motion KPI cards. */
  const SWING_KEYS_SUM = [
    'max_bat_speed', 'avg_bat_speed',
    'attack_angle', 'plane_angle', 'time_to_contact',
    'on_plane_efficiency', 'power_output', 'peak_hand_speed',
    'plane_score', 'connection_score', 'rotation_score',
    'early_connection', 'connection_at_impact',
  ] as const;
  const summaryGrades: Record<string, number | null> = {};
  for (const k of SWING_KEYS_SUM) {
    summaryGrades[k] = metricToGrade(summaryTopAll, k);
  }

  /* Per-source aggregates so the summary PDF's HitTrax + Full Swing
     sections only render when their respective sources have data. */
  const fetchSourceValsSum = (type: string, source: string) =>
    api.getMetricProgress(player.id, type, source)
      .then(rows => rows.map(r => r.value).filter((v) => Number.isFinite(v)))
      .catch(() => [] as number[]);
  const [
    sumHtVelos, sumHtLAs, sumHtDists,
    sumFsVelos, sumFsLAs, sumFsDists,
  ] = await Promise.all([
    fetchSourceValsSum('max_exit_velo', 'HITTRAX').then(arr => arr.filter(v => v !== 0)),
    fetchSourceValsSum('launch_angle',  'HITTRAX'),
    fetchSourceValsSum('distance',      'HITTRAX'),
    fetchSourceValsSum('max_exit_velo', 'FULL_SWING').then(arr => arr.filter(v => v !== 0)),
    fetchSourceValsSum('launch_angle',  'FULL_SWING'),
    fetchSourceValsSum('distance',      'FULL_SWING'),
  ]);
  const meanRoundSum = (arr: number[]) =>
    Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 100) / 100;
  const buildSourceValuesSum = (
    velos: number[], las: number[], dists: number[],
  ): Record<string, { value: number; unit: string }> => {
    const out: Record<string, { value: number; unit: string }> = {};
    if (velos.length > 0) {
      out.avg_exit_velo = { value: meanRoundSum(velos),                      unit: 'mph' };
      out.max_exit_velo = { value: Math.round(Math.max(...velos) * 100) / 100, unit: 'mph' };
    }
    if (las.length   > 0) out.launch_angle = { value: meanRoundSum(las),   unit: 'deg' };
    if (dists.length > 0) out.distance     = { value: meanRoundSum(dists), unit: 'ft'  };
    return out;
  };

  const hittingData: HittingPdfData = {
    player,
    topMetrics: summaryTopAll,
    metricGrades: summaryGrades,
    manual: summaryManual,
    manualOptions: summaryManualOptions,
    diagnosisNotes: summaryDiagnosisNotes,
    sprayDots: summarySprayDots,
    swingNotes: hittingReport?.notes || null,
    reportDate,
    hittraxValues:   buildSourceValuesSum(sumHtVelos, sumHtLAs, sumHtDists),
    fullswingValues: buildSourceValuesSum(sumFsVelos, sumFsLAs, sumFsDists),
  };

  // Build pitching data
  const arsenal = buildArsenalFromPitches(pitches);
  const totalPitches = pitches.length;
  arsenal.forEach(r => { r.pct = totalPitches > 0 ? (r.count / totalPitches) * 100 : 0; });

  /* Pitching Notes — read from content.pitchingNotes the same way the
     standalone Pitching PDF does, so the Summary PDF surfaces the
     coach's saved notes (not the report's stale `notes` field). */
  let summaryPitchNotes: string | null = null;
  if (pitchingReport?.content) {
    try {
      const c = JSON.parse(pitchingReport.content);
      if (typeof c.pitchingNotes === 'string' && c.pitchingNotes.trim()) {
        summaryPitchNotes = c.pitchingNotes.trim();
      }
    } catch { /* ignore */ }
  }
  if (!summaryPitchNotes && pitchingReport?.notes && pitchingReport.notes.trim()) {
    summaryPitchNotes = pitchingReport.notes.trim();
  }

  const summaryPdfPitches = pitches.map((p) => ({
    pitchType: p.pitchType,
    horzBreak: p.horzBreak,
    inducedVertBreak: p.inducedVertBreak,
    plateLocSide: p.plateLocSide,
    plateLocHeight: p.plateLocHeight,
    relSide: p.relSide,
    relHeight: p.relHeight,
    pitcherThrows: p.pitcherThrows,
  }));

  const pitchingData: PitchingPdfData | null = totalPitches > 0 ? {
    player,
    arsenal,
    totalPitches,
    pitchNotes: summaryPitchNotes,
    pitches: summaryPdfPitches,
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

/* ═══════════════════════════════════════════
   SUMMARY CAPTURE PDF — Direct screenshots of
   live in-app sections (Tool Grades, Hitting /
   Infield / Catching / Outfield Snapshots, Pitch
   Report), assembled onto cover + image pages.
   Each capture comes in as a base64 PNG data URL
   produced by html2canvas in the parent page.
   ═══════════════════════════════════════════ */

export interface CapturedSection {
  /** Stable name used for ordering + filenames. */
  key: 'tool-grades' | 'hitting-snapshot' | 'infield-snapshot' | 'catching-snapshot' | 'outfield-snapshot' | 'pitch-report';
  /** Human-readable section title rendered above the screenshot. */
  title: string;
  /** Base64 PNG data URL produced by html2canvas. */
  dataUrl: string;
  /** Captured DOM element's width / height in CSS pixels (used to
   *  preserve the section's aspect ratio when scaling to the page). */
  width: number;
  height: number;
  /** Vertical placement on the page — 0 pins the image to the top of
   *  the page's content area, 0.5 centers, 1 pins to the bottom. Set
   *  by the PDF Builder modal's per-section slider; falls back to 0.5
   *  (centered) when omitted. */
  yOffset?: number;
  /** Width of the image as a fraction of the page's content area
   *  (0.3-1.0). 1.0 fills the page horizontally, smaller values
   *  shrink the screenshot proportionally and center it. Set by the
   *  PDF Builder's Size slider; falls back to 1.0 when omitted. */
  scale?: number;
}

const captureStyles = StyleSheet.create({
  page: {
    backgroundColor: '#0a0e14',
    padding: 32,
    flexDirection: 'column',
  },
  sectionTitle: {
    color: 'var(--text-bright)',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  /* The image wrap is the page's content area minus header + footer.
     We position the screenshot inside it with `position: absolute` +
     a percentage-based `top` so a continuous yOffset (0 = top of wrap,
     1 = bottom of wrap) maps cleanly to PDF coordinates. */
  imageWrap: {
    flexGrow: 1,
    position: 'relative',
  },
  /* `left` + `width` are set inline per-section (driven by the
     PDF Builder's Size slider). Defaults below match what scale=1
     produces. */
  imageWrapInner: {
    position: 'absolute',
    left: 0,
    width: '100%',
  },
  image: {
    objectFit: 'contain',
    width: '100%',
  },
  footer: {
    marginTop: 12,
    fontSize: 9,
    color: '#7a7e84',
    textAlign: 'center',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

/** Render the captured screenshots into a multi-page PDF. The first
 *  page is the standard CoverPage; each subsequent page contains a
 *  single section's screenshot scaled to fit while preserving the
 *  captured aspect ratio. Pages are LANDSCAPE LETTER so the wide
 *  snapshot bubbles render close to their on-screen proportions. */
export async function generateSummaryCapturePdf(
  player: any,
  sections: CapturedSection[],
) {
  const reportDate = reportDateStr();

  const doc = (
    <Document>
      <CoverPage player={player} reportTitle="Player Summary" reportDate={reportDate} />
      {sections.map(s => {
        /* Continuous vertical positioning: the inner wrap is
           absolutely positioned inside the page's content area with
           `top: yOffset * 100%` and a matching negative translateY,
           so 0 → top, 0.5 → vertically centered, 1 → bottom.
           Matches what the user dragged the preview to in the
           builder modal exactly. */
        const yOffset = typeof s.yOffset === 'number' ? Math.max(0, Math.min(1, s.yOffset)) : 0.5;
        /* Size: 1.0 fills the page's content width, 0.5 fills half,
           etc. The image is horizontally centered when scaled below
           full width — `left` + `width` percentages handle this. */
        const scale = typeof s.scale === 'number' ? Math.max(0.1, Math.min(1, s.scale)) : 1;
        const widthPct = scale * 100;
        const leftPct = (100 - widthPct) / 2;
        return (
          <Page key={s.key} size="LETTER" orientation="landscape" style={captureStyles.page}>
            <Text style={captureStyles.sectionTitle}>{s.title}</Text>
            <View style={captureStyles.imageWrap}>
              <View
                style={[
                  captureStyles.imageWrapInner,
                  {
                    top: `${yOffset * 100}%`,
                    transform: `translateY(${-yOffset * 100}%)`,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  },
                ]}
              >
                <Image src={s.dataUrl} style={captureStyles.image} />
              </View>
            </View>
            <Text style={captureStyles.footer}>
              {player.firstName} {player.lastName} · {reportDate}
            </Text>
          </Page>
        );
      })}
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Player_Summary_Capture'));
}
