import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import {
  getReportUploadIds,
  getManualSwingScores,
  getManualSwingMetrics,
  getManualBattedBall,
  computeHittingComposites,
  metricToGrade,
  HIT_SWING_KEYS,
  type ReportSummary,
  type HittingComposites,
} from './helpers';

/**
 * useHittingComposites — computes the three Hitting Snapshot grades (Swing /
 * Quality of Contact / Mechanical) for a single HITTING report, LIVE, with the
 * exact same pipeline the Hitting tab's Snapshot uses. The Player Summary calls
 * this so its Tool Grades match the Snapshot without any persistence (so the
 * refresh-loop class of bug is structurally impossible).
 *
 * It MUST stay in sync with HittingTab.tsx:
 *   - the per-report `aggMode` reducer (perReportMetrics)
 *   - the pooled HitTrax+Full-Swing EV/LA/Dist override (qocOverride)
 *   - the modes-gated manual layering + the Power alias (topMetricsWithMiss)
 * Both ultimately route through the shared `computeHittingComposites` helper,
 * so only the *data assembly* is mirrored here, not the grading math.
 *
 * Note: this intentionally omits the live-at-bat / At-Bat-XLSX base layer —
 * those carry swing-DECISION keys, not the swing/QoC composite keys, so they
 * don't affect these three numbers. (Verified against the Snapshot in-browser.)
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;

// ── Per-metric aggregation — MUST match HittingTab.perReportMetrics ──
const LOWER_IS_BETTER = new Set([
  'time_to_contact',
  'overall_whiff_pct', 'fb_whiff_pct', 'os_whiff_pct',
  'overall_chase_pct', 'fb_chase_pct', 'os_chase_pct',
  'overall_k_pct',
]);
const EXPLICIT_AVG = new Set([
  'launch_angle', 'distance', 'spray_angle', 'pitch_speed',
  'bat_speed', 'attack_angle', 'plane_angle',
  'time_to_contact', 'on_plane_efficiency',
  'connection_at_contact', 'rotational_acceleration',
  'smash_factor',
]);
type AggMode = 'max' | 'min' | 'avg' | 'latest';
function aggMode(mt: string): AggMode {
  if (LOWER_IS_BETTER.has(mt)) return 'min';
  if (mt.startsWith('max_') || mt.endsWith('_max')) return 'max';
  if (mt.startsWith('avg_') || mt.endsWith('_avg')) return 'avg';
  if (mt.endsWith('_pct')) return 'avg';
  if (EXPLICIT_AVG.has(mt)) return 'avg';
  return 'latest';
}

type Reading = { value: number; unit: string };

export function useHittingComposites(
  playerId: string | null | undefined,
  report: ReportSummary | null,
): HittingComposites | null {
  const uploadIds = useMemo(() => (report ? getReportUploadIds(report) : []), [report]);
  const uploadKey = uploadIds.join(',');

  const [raw, setRaw] = useState<any[] | null>(null);
  useEffect(() => {
    if (!playerId || uploadIds.length === 0) { setRaw([]); return; }
    let cancelled = false;
    api.getPlayerMetrics(playerId, { uploadIds })
      .then((m: any[]) => { if (!cancelled) setRaw(Array.isArray(m) ? m : []); })
      .catch(() => { if (!cancelled) setRaw([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, uploadKey]);

  return useMemo(() => {
    if (raw === null || !report) return null;

    // 1. Per-report aggregation (CSV-derived metrics) — same reducer as HittingTab.
    const grouped = new Map<string, any[]>();
    for (const m of raw) {
      const arr = grouped.get(m.metricType);
      if (arr) arr.push(m); else grouped.set(m.metricType, [m]);
    }
    const perReportTop: Record<string, Reading> = {};
    for (const [mt, rows] of grouped.entries()) {
      rows.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
      const values = rows.map((r) => r.value).filter((v) => Number.isFinite(v));
      if (values.length === 0) continue;
      const mode = aggMode(mt);
      let v: number;
      if (mode === 'max') v = Math.max(...values);
      else if (mode === 'min') v = Math.min(...values);
      else if (mode === 'avg') v = mean(values);
      else v = rows[0].value;
      perReportTop[mt] = { value: v, unit: rows[0].unit };
    }

    // 2. Pooled HitTrax+Full-Swing EV/LA/Dist (qocOverride) — same as HittingTab.
    const velos: number[] = [], las: number[] = [], dists: number[] = [];
    for (const m of raw) {
      if (!Number.isFinite(m.value)) continue;
      if (m.source !== 'HITTRAX' && m.source !== 'FULL_SWING') continue;
      if (m.metricType === 'max_exit_velo') { if (m.value !== 0) velos.push(m.value); }
      else if (m.metricType === 'launch_angle') las.push(m.value);
      else if (m.metricType === 'distance') dists.push(m.value);
    }
    const qocOverride: Record<string, Reading> = {};
    if (velos.length > 0) {
      qocOverride.avg_exit_velo = { value: round2(mean(velos)), unit: 'mph' };
      qocOverride.max_exit_velo = { value: round2(Math.max(...velos)), unit: 'mph' };
    }
    if (las.length > 0) qocOverride.launch_angle = { value: round2(mean(las)), unit: 'deg' };
    if (dists.length > 0) qocOverride.distance = { value: round2(mean(dists)), unit: 'ft' };

    // 3. Manual layering (modes-gated) + Power alias — same order as HittingTab
    //    (manual first, CSV overrides). Units are irrelevant to the grade math.
    const modes = (() => {
      try { const m = JSON.parse(report.content || '{}')?.manualEntryModes; return { fullswing: !!m?.fullswing, blast: !!m?.blast }; }
      catch { return { fullswing: false, blast: false }; }
    })();
    const manualSwing = getManualSwingMetrics(report) as unknown as Record<string, number | null>;
    const manualBatted = getManualBattedBall(report) as unknown as Record<string, number | null>;

    const topMetrics: Record<string, Reading> = {};
    const mergeManual = (entries: Record<string, number | null>) => {
      for (const [k, val] of Object.entries(entries)) {
        if (typeof val !== 'number' || !Number.isFinite(val)) continue;
        topMetrics[k] = { value: val, unit: '' };
      }
    };
    if (modes.blast) {
      mergeManual(manualSwing);
      const manualPower = manualSwing.rotational_acceleration;
      if (typeof manualPower === 'number' && Number.isFinite(manualPower) && topMetrics.power_output === undefined) {
        topMetrics.power_output = { value: manualPower, unit: '' };
      }
    }
    if (modes.fullswing) mergeManual(manualBatted);
    // CSV-derived metrics for THIS report override manual.
    for (const [k, v] of Object.entries(perReportTop)) topMetrics[k] = v;

    // 4. Grades for the swing keys (computeHittingComposites reads metricGrades
    //    for swing; it grades the qoc keys itself off topMetrics+qocOverride).
    const metricGrades: Record<string, number | null> = {};
    for (const k of HIT_SWING_KEYS) metricGrades[k] = metricToGrade(topMetrics, k);

    const manual = getManualSwingScores(report) as unknown as Record<string, number | null>;
    return computeHittingComposites({ topMetrics, metricGrades, qocOverride, manual });
  }, [raw, report]);
}
