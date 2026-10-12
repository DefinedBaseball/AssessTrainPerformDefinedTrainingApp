/**
 * PDF Generation Functions — One per tab type
 * Each function creates a React PDF Document element and triggers download.
 */
import React from 'react';
import { Document, Page, View, Image, Text, StyleSheet } from '@react-pdf/renderer';
import { downloadPdf, renderPdf, pdfFilename, reportDateStr, latestReportDate } from './download';
import { PageFooter } from './components';
import { saveBlob } from './download';
import { academyName } from '@/lib/academy';
import { CAPTURE_PAGE, CAPTURE_AREA, fitCapture } from './captureLayout';
import { CoverPage } from './CoverPage';
import {
  HittingReportPages, type HittingPdfData, type HittingVendor, type VendorCell, type SprayDot,
} from './HittingReport';
import { buildZoneStats, type ZoneStat } from '@/app/athletes/[id]/components/StrikeZoneDamageView';
import { INFIELDER_SILHOUETTE, OUTFIELDER_SILHOUETTE } from '@/app/athletes/[id]/tabs/defense-silhouettes';
import { PitchingReportPages, type PitchingPdfData, type ArsenalRow } from './PitchingReport';
import { DefenseReportPages, type DefensePdfData, type DefensePosition } from './DefenseReport';
import { StrengthReportPages, type StrengthPdfData } from './StrengthReport';
import { VisionReportPages, type VisionPdfData } from './VisionReport';
import * as api from '@/lib/api';
import type { ReportSummary } from '@/app/athletes/[id]/helpers';
import {
  TAB_METRICS, getTabMetrics, getReportUploadIds,
  gradeIfKnown,
  getManualSwingMetrics, getManualBattedBall,
  getDefenseCoachGrades, aggregateReportMetrics,
} from '@/app/athletes/[id]/helpers';

/* ── Helpers ── */

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

/* ═══════════════════════════════════════════
   HITTING PDF — one page: vendor bubbles (Blast Motion / HitTrax /
   Full Swing, each only when the report has its data), spray chart +
   strike zone, hitting notes.
   ═══════════════════════════════════════════ */

type MetricMap = Record<string, { value: number; unit: string; recordedAt: string }>;

/* Column labels, keys and number formats copied from the Hitting tab's
   vendor bubbles (SwingTab) so the PDF reads exactly like the screen. */
const VENDOR_LABELS: Record<string, string> = {
  max_exit_velo: 'Max Exit Velocity',
  avg_exit_velo: 'Avg Exit Velocity',
  max_distance: 'Max Distance',
  distance: 'Avg Distance',
  launch_angle: 'Avg Launch Angle',
  squared_up_pct: 'Squared Up %',
  max_bat_speed: 'Max Bat Speed',
  avg_bat_speed: 'Avg Bat Speed',
  peak_hand_speed: 'Hand Speed',
  time_to_contact: 'Time to Contact',
  rotational_accel_g: 'Rotational Accel',
  early_connection: 'Early Connection',
  plane_angle: 'Vert Bat Angle',
  attack_angle: 'Attack Angle',
  on_plane_efficiency: 'Plane Score',
};
const HITTRAX_COLUMNS = ['max_exit_velo', 'avg_exit_velo', 'max_distance', 'distance', 'launch_angle'];
const FULLSWING_COLUMNS = [...HITTRAX_COLUMNS, 'squared_up_pct'];
const BLAST_COLUMNS = [
  'max_bat_speed', 'avg_bat_speed', 'peak_hand_speed', 'time_to_contact',
  'rotational_accel_g', 'early_connection', 'plane_angle', 'attack_angle',
  'on_plane_efficiency',
];

function battedBallCell(key: string, m: { value: number } | undefined): VendorCell {
  const label = VENDOR_LABELS[key] || key;
  if (!m) return { label, display: '—', grade: null };
  const v = m.value;
  const f = key.endsWith('_exit_velo') ? { display: v.toFixed(1), unit: 'mph' }
    : key.endsWith('_pct') ? { display: v.toFixed(1), unit: '%' }
    : key === 'launch_angle' ? { display: v.toFixed(1), unit: 'deg' }
    : key === 'distance' || key === 'max_distance' ? { display: v.toFixed(0), unit: 'ft' }
    : { display: v.toFixed(1) };
  return { label, ...f, grade: gradeIfKnown(v, key) };
}

/** Share of balls hit at 5-30 degrees -- the Hitting tab's "LD %". */
function lineDrivePct(las: number[]): number | null {
  const inPlay = las.filter(la => Number.isFinite(la));
  if (inPlay.length === 0) return null;
  return (inPlay.filter(la => la >= 5 && la <= 30).length / inPlay.length) * 100;
}

/** Everything the Hitting PDF prints for one HITTING report. Shared by
 *  the Hitting PDF and the Player Summary PDF so the two never drift, and
 *  self-contained: it reads the report's own uploads and manual entries
 *  and rolls them up the way the Hitting tab does, so the numbers match
 *  the screen whichever page the download starts from. */
async function collectHittingPdfData(
  player: any,
  hittingReport: ReportSummary | null,
  reportDate: string,
): Promise<HittingPdfData> {
  const uploadIds = getReportUploadIds(hittingReport);

  /* Notes: the report's own notes, legacy content.diagnosisNotes fallback. */
  let notes = (hittingReport?.notes && hittingReport.notes.trim()) || '';
  if (!notes && hittingReport?.content) {
    try {
      const c = JSON.parse(hittingReport.content);
      notes = typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { /* ignore */ }
  }

  /* Manual-entry flags: a stale manual block only counts when its toggle is on. */
  let manualModes = { fullswing: false, blast: false };
  if (hittingReport?.content) {
    try {
      const m = JSON.parse(hittingReport.content)?.manualEntryModes;
      manualModes = { fullswing: !!m?.fullswing, blast: !!m?.blast };
    } catch { /* ignore */ }
  }
  const manualBatted = getManualBattedBall(hittingReport) as unknown as Record<string, number | null>;
  const manualSwing = getManualSwingMetrics(hittingReport) as unknown as Record<string, number | null>;
  const hasManual = (o: Record<string, number | null>) => Object.values(o).some(v => v != null);

  /* This report's uploads, by source -- the same read the Hitting tab does. */
  const ht = { v: [] as number[], la: [] as number[], d: [] as number[] };
  const fs = { v: [] as number[], la: [] as number[], d: [] as number[] };
  let sawFs = false, sawHt = false, sawBlast = false;
  /* The report's metrics, one value each (Hitting tab layering: manual
     entries first, this report's uploads on top). */
  const topMetrics: MetricMap = {};
  const mergeManual = (entries: Record<string, number | null>) => {
    for (const [k, v] of Object.entries(entries)) {
      if (typeof v === 'number' && Number.isFinite(v)) topMetrics[k] = { value: v, unit: '', recordedAt: '' };
    }
  };
  if (manualModes.blast) mergeManual(manualSwing);
  if (manualModes.fullswing) mergeManual(manualBatted);
  if (uploadIds.length > 0) {
    try {
      const rows = await api.getPlayerMetrics(player.id, { uploadIds });
      Object.assign(topMetrics, aggregateReportMetrics(rows as any[]));
      for (const m of rows as any[]) {
        if (!Number.isFinite(m.value)) continue;
        const bucket = m.source === 'HITTRAX' ? ht : m.source === 'FULL_SWING' ? fs : null;
        if (m.source === 'HITTRAX') sawHt = true;
        else if (m.source === 'FULL_SWING') sawFs = true;
        else if (m.source === 'BLAST_MOTION') sawBlast = true;
        if (!bucket) continue;
        if (m.metricType === 'max_exit_velo') bucket.v.push(m.value);
        else if (m.metricType === 'launch_angle') bucket.la.push(m.value);
        else if (m.metricType === 'distance') bucket.d.push(m.value);
      }
    } catch { /* leave empty */ }
  }
  // A 0 mph reading is an empty at-bat, not a ball.
  ht.v = ht.v.filter(v => v !== 0);
  fs.v = fs.v.filter(v => v !== 0);

  const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
  const sessionValues = (src: typeof ht) => {
    const out: Record<string, { value: number }> = {};
    if (src.v.length) { out.avg_exit_velo = { value: mean(src.v) }; out.max_exit_velo = { value: Math.max(...src.v) }; }
    if (src.la.length) out.launch_angle = { value: mean(src.la) };
    if (src.d.length) { out.distance = { value: mean(src.d) }; out.max_distance = { value: Math.max(...src.d) }; }
    return out;
  };

  const vendors: HittingVendor[] = [];

  /* Blast Motion -- only the readings present. */
  if (sawBlast || (manualModes.blast && hasManual(manualSwing))) {
    const swing = topMetrics;
    const cells = BLAST_COLUMNS.filter(k => swing[k]).map((k): VendorCell => {
      const m = swing[k];
      const isAngle = k === 'plane_angle' || k === 'attack_angle' || k === 'early_connection';
      const unit = isAngle ? 'deg' : (m.unit === '°' ? 'deg' : (m.unit || undefined));
      return {
        label: VENDOR_LABELS[k] || k,
        display: k === 'time_to_contact' ? m.value.toFixed(2) : m.value.toFixed(1),
        unit,
        grade: gradeIfKnown(m.value, k),
      };
    });
    if (cells.length) vendors.push({ key: 'blast', title: 'Blast Motion', cells });
  }

  /* HitTrax -- this report's HitTrax uploads only. */
  if (sawHt) {
    const vals = sessionValues(ht);
    const ld = lineDrivePct(ht.la);
    vendors.push({
      key: 'hittrax', title: 'HitTrax',
      cells: [
        ...HITTRAX_COLUMNS.map(k => battedBallCell(k, vals[k])),
        ...(ld !== null ? [{ label: 'LD %', display: ld.toFixed(1), unit: '%', grade: null }] : []),
      ],
    });
  }

  /* Full Swing -- CSV values win over manual entries; the four keys both
     vendors emit never fall back to the shared pool, so HitTrax numbers
     can't land in this bubble. */
  if (sawFs || (manualModes.fullswing && hasManual(manualBatted))) {
    const override: Record<string, { value: number }> = {};
    if (manualModes.fullswing) {
      for (const [k, v] of Object.entries(manualBatted)) if (typeof v === 'number') override[k] = { value: v };
    }
    Object.assign(override, sessionValues(fs));
    const SHARED = new Set(['avg_exit_velo', 'max_exit_velo', 'launch_angle', 'distance', 'max_distance']);
    const resolve = (k: string) => override[k] ?? (SHARED.has(k) ? undefined : topMetrics[k]);
    const ld = lineDrivePct(fs.la);
    vendors.push({
      key: 'fullswing', title: 'Full Swing',
      cells: [
        ...FULLSWING_COLUMNS.map(k => battedBallCell(k, resolve(k))),
        ...(ld !== null ? [{ label: 'LD %', display: ld.toFixed(1), unit: '%', grade: null }] : []),
      ],
    });
  }

  /* Spray chart dots + strike zone. HitTrax dots win when present (as on
     screen); Full Swing angle + distance is the fallback. */
  let sprayDots: SprayDot[] = [];
  let zoneStats: ZoneStat[] = [];
  const ids = uploadIds.length > 0 ? { uploadIds } : undefined;
  if (uploadIds.length > 0) {
    try {
      const [htRows, fsRows] = await Promise.all([
        api.getSessionData(player.id, 'HITTRAX',
          ['spray_x', 'spray_z', 'spray_angle', 'spray_dist', 'ball_type_code', 'max_exit_velo', 'launch_angle', 'strike_zone'],
          ids).catch(() => [] as any[]),
        api.getSessionData(player.id, 'FULL_SWING',
          ['spray_angle', 'distance', 'max_exit_velo'], ids).catch(() => [] as any[]),
      ]);
      zoneStats = buildZoneStats(htRows as any[]);

      type HtRow = { x?: number; z?: number; polarAngle?: number; polarDist?: number; type?: number; ev?: number };
      const htByTs = new Map<string, HtRow>();
      for (const r of htRows as any[]) {
        const cur = htByTs.get(r.recordedAt) ?? {};
        if (r.metricType === 'spray_x') cur.x = r.value;
        if (r.metricType === 'spray_z') cur.z = r.value;
        if (r.metricType === 'spray_angle') cur.polarAngle = r.value;
        if (r.metricType === 'spray_dist') cur.polarDist = r.value;
        if (r.metricType === 'ball_type_code') cur.type = r.value;
        if (r.metricType === 'max_exit_velo') cur.ev = r.value;
        htByTs.set(r.recordedAt, cur);
      }
      const htDots: SprayDot[] = [];
      for (const e of htByTs.values()) {
        if (e.x !== undefined && e.z !== undefined && e.z > 0) {
          htDots.push({ angle: (Math.atan2(e.x, e.z) * 180) / Math.PI, distance: Math.hypot(e.x, e.z), exitVelo: e.ev, ballTypeCode: e.type });
        } else if (e.polarAngle !== undefined && e.polarDist !== undefined && e.polarDist > 0) {
          htDots.push({ angle: e.polarAngle, distance: e.polarDist, exitVelo: e.ev, ballTypeCode: e.type });
        }
      }

      const fsByTs = new Map<string, { angle?: number; dist?: number; ev?: number }>();
      for (const r of fsRows as any[]) {
        const cur = fsByTs.get(r.recordedAt) ?? {};
        if (r.metricType === 'spray_angle') cur.angle = r.value;
        if (r.metricType === 'distance') cur.dist = r.value;
        if (r.metricType === 'max_exit_velo') cur.ev = r.value;
        fsByTs.set(r.recordedAt, cur);
      }
      const fsDots: SprayDot[] = Array.from(fsByTs.values())
        .filter(s => s.angle !== undefined && s.dist !== undefined && s.dist > 0)
        .map(s => ({ angle: s.angle!, distance: s.dist!, exitVelo: s.ev }));

      sprayDots = htDots.length > 0 ? htDots : fsDots;
    } catch { /* ignore */ }
  }

  return { player, reportDate, vendors, sprayDots, zoneStats, notes };
}

export async function generateHittingPdf(
  player: any,
  reports: ReportSummary[],
) {
  const hittingReport = reports
    .filter(r => r.reportType === 'HITTING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  /* The assessment's date, not today's. */
  const reportDate = reportDateStr(hittingReport?.createdAt);
  const data = await collectHittingPdfData(player, hittingReport, reportDate);

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Hitting Assessment`}>
      <CoverPage player={player} reportTitle="Hitting Assessment" />
      <HittingReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Hitting', hittingReport?.createdAt));
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
      };
    })
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function generatePitchingPdf(
  player: any,
  reports: ReportSummary[],
) {
  const pitchingReport = reports
    .filter(r => r.reportType === 'PITCHING')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const reportDate = reportDateStr(pitchingReport?.createdAt);

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


  const data: PitchingPdfData = {
    player,
    arsenal,
    totalPitches,
    pitchNotes,
    pitches: pdfPitches,
    reportDate,
  };

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Pitching Assessment`}>
      <CoverPage player={player} reportTitle="Pitching Assessment" />
      <PitchingReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Pitching', pitchingReport?.createdAt));
}

/* ═══════════════════════════════════════════
   DEFENSE PDF
   ═══════════════════════════════════════════ */

/** Latest CATCHING / INFIELD / OUTFIELD report among `reports`, and the
 *  defense PDF data for exactly the positions that have one. */
function buildDefenseData(player: any, reports: ReportSummary[], reportDate: string) {
  const latest = (type: string) => reports
    .filter(r => r.reportType === type)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const byPos: Record<DefensePosition, ReportSummary | null> = {
    catching: latest('CATCHING'),
    infield: latest('INFIELD'),
    outfield: latest('OUTFIELD'),
  };
  const sections = (['catching', 'infield', 'outfield'] as const).filter(p => byPos[p]);
  const data: DefensePdfData = {
    player,
    sections: [...sections],
    catchingAssessment: getAssessmentFromReport(byPos.catching, 'catchingAssessment'),
    infieldAssessment: getAssessmentFromReport(byPos.infield, 'infieldAssessment'),
    outfieldAssessment: getAssessmentFromReport(byPos.outfield, 'outfieldAssessment'),
    coachGrades: {
      catching: getDefenseCoachGrades(byPos.catching, 'catching'),
      infield: getDefenseCoachGrades(byPos.infield, 'infield'),
      outfield: getDefenseCoachGrades(byPos.outfield, 'outfield'),
    },
    catchingNotes: byPos.catching?.notes || null,
    infieldNotes: byPos.infield?.notes || null,
    outfieldNotes: byPos.outfield?.notes || null,
    reportDate,
  };
  return { data, byPos };
}

/** The Defensive Skills player figure in the profile's blue gradient
 *  (#3D8BFD → #1F5FD1 → #143C82), as a PNG. The app colours it with an SVG
 *  mask, which react-pdf can't do, so it's coloured here in the browser
 *  (drawn 4× up for a crisp print). Null if the browser can't draw it --
 *  the panel then shows its callouts without the figure. */
async function tintFigure(src: string): Promise<string | null> {
  try {
    const img = new window.Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth * 4;
    c.height = img.naturalHeight * 4;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-in';
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#3D8BFD');
    g.addColorStop(0.55, '#1F5FD1');
    g.addColorStop(1, '#143C82');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Figures for the infield / outfield pages being printed. */
async function defenseFigures(sections: DefensePosition[]): Promise<DefensePdfData['silhouettes']> {
  const [infield, outfield] = await Promise.all([
    sections.includes('infield') ? tintFigure(INFIELDER_SILHOUETTE) : Promise.resolve(null),
    sections.includes('outfield') ? tintFigure(OUTFIELDER_SILHOUETTE) : Promise.resolve(null),
  ]);
  return { infield, outfield };
}

const DEFENSE_LABEL: Record<DefensePosition, string> = {
  catching: 'Catching', infield: 'Infield', outfield: 'Outfield',
};

/** Defense PDF for the report(s) passed in. The Infield, Catching and
 *  Outfield tabs each pass their one report, so each gets its own PDF
 *  ("Infield Assessment", ..._Infield_<date>.pdf) holding only that
 *  position -- they used to all print the same combined "Defense" file. */
export async function generateDefensePdf(
  player: any,
  reports: ReportSummary[],
) {
  const dated = latestReportDate(reports.filter(r => ['CATCHING', 'INFIELD', 'OUTFIELD'].includes(r.reportType)));
  const reportDate = reportDateStr(dated);
  const { data } = buildDefenseData(player, reports, reportDate);
  data.silhouettes = await defenseFigures(data.sections);
  const label = data.sections.length === 1 ? DEFENSE_LABEL[data.sections[0]] : 'Defense';

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — ${label} Assessment`}>
      <CoverPage player={player} reportTitle={`${label} Assessment`} />
      <DefenseReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, label, dated));
}

/* ═══════════════════════════════════════════
   STRENGTH & CONDITIONING PDF
   ═══════════════════════════════════════════ */

export async function generateStrengthPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const scReport = reports
    .filter(r => r.reportType === 'STRENGTH')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const reportDate = reportDateStr(scReport?.createdAt);

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
      <CoverPage player={player} reportTitle="Strength & Conditioning" />
      <StrengthReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Strength_Conditioning', scReport?.createdAt));
}

/* ═══════════════════════════════════════════
   VISION PDF
   ═══════════════════════════════════════════ */

export async function generateVisionPdf(
  player: any,
  reports: ReportSummary[],
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>,
) {
  const visionReport = reports
    .filter(r => r.reportType === 'COGNITION')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const reportDate = reportDateStr(visionReport?.createdAt);

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
      <CoverPage player={player} reportTitle="Cognition Assessment" />
      <VisionReportPages data={data} />
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Cognition', visionReport?.createdAt));
}

/* ═══════════════════════════════════════════
   PLAYER SUMMARY PDF — the Summary tab's Download PDF. The cover, then
   page 2 of each individual PDF for the athlete's most recent report of
   each kind, in order: Hitting, Pitching, Catching, Infield, Outfield.
   Kinds without a report are skipped (Hitting + Pitching only → 3 pages).
   ═══════════════════════════════════════════ */

/** Pitching page data for one PITCHING report (same as the Pitching PDF). */
async function collectPitchingPdfData(
  player: any,
  pitchingReport: ReportSummary,
  reportDate: string,
): Promise<PitchingPdfData> {
  const uploadIds = getReportUploadIds(pitchingReport);
  const pitches = await api.getTrackmanPitches(player.id, uploadIds.length > 0 ? { uploadIds } : undefined).catch(() => []);
  const arsenal = buildArsenalFromPitches(pitches);
  arsenal.forEach(r => { r.pct = pitches.length > 0 ? (r.count / pitches.length) * 100 : 0; });

  let pitchNotes: string | null = null;
  if (pitchingReport.content) {
    try {
      const c = JSON.parse(pitchingReport.content);
      if (typeof c.pitchingNotes === 'string' && c.pitchingNotes.trim()) pitchNotes = c.pitchingNotes.trim();
    } catch { /* ignore */ }
  }
  if (!pitchNotes && pitchingReport.notes && pitchingReport.notes.trim()) pitchNotes = pitchingReport.notes.trim();

  return {
    player,
    arsenal,
    totalPitches: pitches.length,
    pitchNotes,
    pitches: pitches.map((p) => ({
      pitchType: p.pitchType,
      horzBreak: p.horzBreak,
      inducedVertBreak: p.inducedVertBreak,
      plateLocSide: p.plateLocSide,
      plateLocHeight: p.plateLocHeight,
      relSide: p.relSide,
      relHeight: p.relHeight,
      pitcherThrows: p.pitcherThrows,
    })),
    reportDate,
  };
}

/** Report kinds a PDF can hold, in page order. */
export const PDF_REPORT_TYPES = ['HITTING', 'PITCHING', 'CATCHING', 'INFIELD', 'OUTFIELD'] as const;
export type PdfReportType = typeof PDF_REPORT_TYPES[number];
const PDF_TYPE_NAME: Record<PdfReportType, string> = {
  HITTING: 'Hitting', PITCHING: 'Pitching', CATCHING: 'Catching', INFIELD: 'Infield', OUTFIELD: 'Outfield',
};

/** The athlete's most recent report of each PDF kind, in page order. */
export function latestReportsByType(reports: ReportSummary[]): ReportSummary[] {
  return PDF_REPORT_TYPES
    .map((type) => reports
      .filter(r => r.reportType === type)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null)
    .filter((r): r is ReportSummary => !!r);
}

/** Build the PDF for the chosen reports (one per kind): the cover, then
 *  each report's page IN THE ORDER GIVEN (the order the coach ticked them).
 *  One report → that report's own PDF ("Hitting Assessment"); several →
 *  the "Player Summary". Returns the file without saving it, so the caller
 *  can download or email it. */
export async function buildReportPdf(
  player: any,
  chosen: ReportSummary[],
): Promise<{ blob: Blob; filename: string }> {
  /* One report per kind, first occurrence wins, unknown kinds dropped. */
  const ordered = chosen.filter((r, i) =>
    (PDF_REPORT_TYPES as readonly string[]).includes(r.reportType)
    && chosen.findIndex((x) => x.reportType === r.reportType) === i);
  const single = ordered.length === 1 ? PDF_TYPE_NAME[ordered[0].reportType as PdfReportType] : null;
  const title = single ? `${single} Assessment` : 'Player Summary';

  /* The filename carries the newest included report's date; each page's
     footer carries its own report's date (the cover shows the download
     date). */
  const dated = latestReportDate(ordered);

  /* Each report's page, built in parallel, kept in the chosen order. */
  const pages = await Promise.all(ordered.map(async (r) => {
    const date = reportDateStr(r.createdAt);
    if (r.reportType === 'HITTING') {
      return <HittingReportPages key={r.id} data={await collectHittingPdfData(player, r, date)} />;
    }
    if (r.reportType === 'PITCHING') {
      return <PitchingReportPages key={r.id} data={await collectPitchingPdfData(player, r, date)} />;
    }
    const { data } = buildDefenseData(player, [r], date);
    data.silhouettes = await defenseFigures(data.sections);
    return <DefenseReportPages key={r.id} data={data} />;
  }));

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — ${title}`} author={academyName()}>
      <CoverPage player={player} reportTitle={title} />
      {pages}
    </Document>
  );

  return {
    blob: await renderPdf(doc),
    filename: pdfFilename(player.firstName, player.lastName, single ?? 'Player_Summary', dated),
  };
}

/** The Player Summary PDF from the athlete's latest report of each kind. */
export async function generateSummaryPdf(player: any, reports: ReportSummary[]) {
  const { blob, filename } = await buildReportPdf(player, latestReportsByType(reports));
  saveBlob(blob, filename);
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
    backgroundColor: '#FFFFFF',
    padding: CAPTURE_PAGE.padding,
    flexDirection: 'column',
    fontFamily: 'Helvetica',
  },
  sectionTitle: {
    color: '#000000',
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    height: CAPTURE_PAGE.titleBlock - 10,
    marginBottom: 10,
  },
  imageArea: {
    width: CAPTURE_AREA.width,
    height: CAPTURE_AREA.height,
    position: 'relative',
  },
});

/** Render the captured screenshots into a multi-page PDF. The first
 *  page is the standard CoverPage; each subsequent page holds one
 *  section's screenshot, fitted inside the page with the standard footer
 *  underneath. Pages are LANDSCAPE LETTER so the wide snapshot bubbles
 *  render close to their on-screen proportions. */
export async function generateSummaryCapturePdf(
  player: any,
  sections: CapturedSection[],
) {
  const reportDate = reportDateStr();

  const doc = (
    <Document title={`${player.firstName} ${player.lastName} — Player Summary`}>
      <CoverPage player={player} reportTitle="Player Summary" />
      {sections.map(s => {
        const box = fitCapture(s);
        return (
          <Page key={s.key} size="LETTER" orientation="landscape" style={captureStyles.page}>
            <Text style={captureStyles.sectionTitle}>{s.title}</Text>
            <View style={captureStyles.imageArea}>
              <Image
                src={s.dataUrl}
                style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height }}
              />
            </View>
            <PageFooter player={player} reportTitle="Player Summary" date={reportDate} />
          </Page>
        );
      })}
    </Document>
  );

  await downloadPdf(doc, pdfFilename(player.firstName, player.lastName, 'Player_Summary'));
}
