'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import { SwingTab, HittingGradeStack, NoteBlock, SwingDecisionResultsRow, movementPlotBubbleStyle, type SharedHittingState } from './SwingTab';
import { TabBar, TabBarActions, EditProfileButton, Section, SectionHeader, ReportSelector, DownloadPdfButton, VideosIconButton, VideoPlaceholder, VideoBundleCard } from '@/components/assessment';
import { bundleVideos, normalizeVideoTitle, splitVideoTitle } from '@/lib/video-titles';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import { SprayChartView } from '../components/SprayChartView';
import { LiveAtBatsList } from '@/components/LiveAtBatsList';
import { generateHittingPdf } from '@/lib/pdf';
import {
  TabProps,
  getLatestReport, getReportUploadIds, getReportUploadIdsForKeys,
  getManualSwingScores, getManualSwingOptions,
  getManualSwingMetrics, getManualBattedBall,
  getReportVideoIds, getReportContentVideos,
  metricToGrade,
  type ManualSwingScores,
  type ManualSwingOptions,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const SUB_TABS = [
  { key: 'swing',    label: 'Swing' },
  /* "Swing Decision" renamed to "Live Results" per coach-spec.
     The button that toggles this view was also relocated from the
     in-snapshot center toggle to the TabBarActions row next to the
     ReportSelector. The snapshot's center toggle now renders only
     the "Swing" entry (see the filtered `.map` further below);
     the "Live Results" entry is consumed by the new toggle in
     the action bar. Keep both entries here so subTab routing,
     content branching, and the storage key all keep working
     unchanged. */
  { key: 'decision', label: 'Live Results' },
] as const;

/* ─────────────────────────────────────────────────────────────────────────────
   HittingSnapshotIcon — inline SVG of crossed baseball bats + baseball,
   used as the section icon for the Hitting Snapshot header.
   Sized to fill the 36×36 .sectionIcon slot.
   ───────────────────────────────────────────────────────────────────────── */
function HittingSnapshotIcon() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Hitting"
      style={{ display: 'block' }}
    >
      {/* White rounded tile background to match brand-mark presentation */}
      <rect x="0" y="0" width="100" height="100" rx="14" fill="var(--text-bright)" />
      {/* Baseball at the top center — outer circle + a couple of seam arcs */}
      <g>
        <circle cx="50" cy="20" r="8" fill="#000" />
        <path d="M 44 16.5 Q 50 18.5 56 16.5"
          stroke="var(--text-bright)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M 44 23.5 Q 50 21.5 56 23.5"
          stroke="var(--text-bright)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
      {/* Crossed bats — two tapered shapes rotated to form an X.
          Each bat: thick barrel at top, narrow handle at bottom, knob at end. */}
      {/* LEFT bat (rotated -22°) */}
      <g transform="rotate(-22 50 60)">
        {/* barrel + handle as a single tapered path */}
        <path
          d="M 44 12
             L 56 12
             Q 56 24 54 40
             L 53 80
             Q 53 88 50 88
             Q 47 88 47 80
             L 46 40
             Q 44 24 44 12 Z"
          fill="#000"
        />
        {/* knob */}
        <circle cx="50" cy="89" r="5" fill="#000" />
      </g>
      {/* RIGHT bat (rotated +22°) */}
      <g transform="rotate(22 50 60)">
        <path
          d="M 44 12
             L 56 12
             Q 56 24 54 40
             L 53 80
             Q 53 88 50 88
             Q 47 88 47 80
             L 46 40
             Q 44 24 44 12 Z"
          fill="#000"
        />
        <circle cx="50" cy="89" r="5" fill="#000" />
      </g>
    </svg>
  );
}

type SubTabKey = (typeof SUB_TABS)[number]['key'];

const SWING_METRIC_KEYS = [
  'max_bat_speed',
  'avg_bat_speed',
  'attack_angle',
  'plane_angle',
  'time_to_contact',
  'on_plane_efficiency',
  'power_output',
  'peak_hand_speed',
  /* Blast CSV spec additions — kept in sync with the same-named
     array in SwingTab.tsx (the chip strip render side). This local
     copy drives `metricGrades` so the chip-tone colours (red /
     yellow / green from `toScoutingGrade` → `scoreColor`) reach
     the Blast Motion bubble. Forgetting these keys here was why
     the new Score / Connection metrics were rendering uncoloured —
     the chip strip iterated over them but `metricGrades[k]` was
     undefined, so `it.color` defaulted to neutral. */
  'plane_score',
  'connection_score',
  'rotation_score',
  'early_connection',
  'connection_at_impact',
] as const;

/* ── Swing-decision metrics from LIVE at-bats ──
   Computes the Fastballs / Offspeed / Overall / Decision grade-group
   inputs straight from the live AtBat/Pitch tracker records (the same
   data the "Live Results" bubble lists), so these rows populate from
   captured at-bats even when no At-Bat XLSX has been uploaded. Each
   pitch carries `pitchType` (family), `callBallStrike` (zone proxy:
   STRIKE = in zone), and `result` (the action). Returns only metrics
   whose denominator is non-zero so empty splits read "—" rather than
   a misleading 0%. */
const FB_PITCH_TYPES = new Set(['FASTBALL', 'SINKER', 'CUTTER']);
const SWING_RESULTS_AB = new Set([
  'STRIKE_SWINGING', 'STRIKE_OUT_SWINGING', 'FOUL',
  'FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL',
]);
const INPLAY_RESULTS_AB = new Set(['FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL']);

function computeLiveAtBatSwingMetrics(
  rows: api.AtBatDetail[],
): Record<string, { value: number; unit: string; recordedAt: string }> {
  type Split = { swings: number; whiffs: number; bip: number; barrels: number; inZone: number; inZoneSw: number; outZone: number; outZoneSw: number };
  const blank = (): Split => ({ swings: 0, whiffs: 0, bip: 0, barrels: 0, inZone: 0, inZoneSw: 0, outZone: 0, outZoneSw: 0 });
  const fb = blank(), os = blank(), all = blank();
  let completed = 0, k = 0, bb = 0, gb = 0, fly = 0, ld = 0, barrelOuts = 0;
  let recordedAt = '';

  for (const r of rows) {
    if (r.startedAt && r.startedAt > recordedAt) recordedAt = r.startedAt;
    if (r.outcome) {
      completed++;
      switch (r.outcome) {
        case 'STRIKE_OUT_LOOKING': case 'STRIKE_OUT_SWINGING': k++; break;
        case 'WALK':        bb++;        break;
        case 'GROUND_BALL': gb++;        break;
        case 'FLY_BALL':    fly++;       break;
        case 'LINE_DRIVE':  ld++;        break;
        case 'BARREL':      barrelOuts++; break;
      }
    }
    for (const p of (r.pitches ?? [])) {
      const fam = FB_PITCH_TYPES.has(p.pitchType) ? fb : os;
      const swung = !!p.result && SWING_RESULTS_AB.has(p.result);
      const whiff = p.result === 'STRIKE_SWINGING' || p.result === 'STRIKE_OUT_SWINGING';
      const inPlay = !!p.result && INPLAY_RESULTS_AB.has(p.result);
      const barrel = p.result === 'BARREL';
      const inZone = p.callBallStrike === 'STRIKE';
      const outZone = p.callBallStrike === 'BALL';
      for (const s of [fam, all]) {
        if (swung) s.swings++;
        if (whiff) s.whiffs++;
        if (inPlay) s.bip++;
        if (barrel) s.barrels++;
        if (inZone) { s.inZone++; if (swung) s.inZoneSw++; }
        if (outZone) { s.outZone++; if (swung) s.outZoneSw++; }
      }
    }
  }

  const out: Record<string, { value: number; unit: string; recordedAt: string }> = {};
  const at = recordedAt || new Date().toISOString();
  const put = (key: string, num: number, den: number) => {
    if (den > 0) out[key] = { value: (num / den) * 100, unit: '%', recordedAt: at };
  };
  put('fb_barrel_pct',      fb.barrels,  fb.bip);
  put('fb_whiff_pct',       fb.whiffs,   fb.swings);
  put('fb_chase_pct',       fb.outZoneSw, fb.outZone);
  put('fb_in_zone_swing_pct', fb.inZoneSw, fb.inZone);
  put('os_barrel_pct',      os.barrels,  os.bip);
  put('os_whiff_pct',       os.whiffs,   os.swings);
  put('os_chase_pct',       os.outZoneSw, os.outZone);
  put('os_in_zone_swing_pct', os.inZoneSw, os.inZone);
  put('overall_barrel_pct', all.barrels, all.bip);
  put('overall_whiff_pct',  all.whiffs,  all.swings);
  put('overall_chase_pct',  all.outZoneSw, all.outZone);
  put('overall_in_zone_swing_pct', all.inZoneSw, all.inZone);
  put('overall_k_pct',  k,  completed);
  put('overall_bb_pct', bb, completed);
  const bipOutcomes = gb + fly + ld + barrelOuts;
  put('ground_ball_pct', gb,  bipOutcomes);
  put('fly_ball_pct',    fly, bipOutcomes);
  put('line_drive_pct',  ld,  bipOutcomes);
  return out;
}

export function HittingTab(props: TabProps) {
  const { player, topMetrics, reports, isCoach, onRefresh, refreshKey, videos: playerVideos } = props;
  const { user } = useAuth();
  const isLight = useTheme().theme === 'light';
  const [subTab, setSubTab] = useState<SubTabKey>('swing');

  // Spray-chart data-date-range label — lifted out of SprayChartView
  // so it can render in the Hitting Snapshot header's top-right
  // corner instead of inside the chart's legend strip. SprayChartView
  // fires `onDataRangeChange` whenever the resolved range changes
  // (or becomes null when no data is loaded). `null` hides the chip.
  const [sprayDateLabel, setSprayDateLabel] = useState<string | null>(null);

  // ── Shared state lifted from SwingTab so the grade bubble at the top of the
  //    Hitting tab stays visible (and live) regardless of which sub-tab is on. ──
  // The "active" HITTING report drives EVERY data derivation on this tab —
  // manual scores, diagnosis notes, miss%, spray-chart filtering. Defaults to
  // the latest report; ReportSelector's onSelect can swap it for any other.
  const [selectedHittingReport, setSelectedHittingReport] = useState<ReportSummary | null>(null);
  const latestHitting = useMemo(() => getLatestReport(reports, ['HITTING']), [reports]);
  /* When the parent re-fetches `reports` (e.g. after the report modal
     saves a CSV removal), the local `selectedHittingReport` still
     points at the STALE pre-save object — its `content.csvUploads`
     doesn't reflect the just-removed slot. Re-sync from the fresh
     array by id so every derivation below (manual scores, upload-id
     scoping, spray-chart filters) picks up the change immediately.
     If the report was deleted entirely, drop the selection to fall
     back to `latestHitting`. */
  useEffect(() => {
    setSelectedHittingReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);
  const activeHittingReport = selectedHittingReport ?? latestHitting;

  /* Video IDs the coach has attached to the active HITTING report
     via the bundle modal's Save-with-attach flow. These clips:
       • surface in the per-report "Coach Reviews" panel directly
         under Coach Grades (new section below the snapshot bubble);
       • are EXCLUDED from the main Video gallery for this report
         so they don't double-show. Unattached Coach Reviews
         continue to surface in the main gallery as before. */
  const attachedReviewIds = useMemo(() => {
    if (!activeHittingReport?.content) return [] as string[];
    try {
      const parsed = JSON.parse(activeHittingReport.content);
      if (parsed && Array.isArray(parsed.coachReviewVideoIds)) {
        return parsed.coachReviewVideoIds.filter((s: any) => typeof s === 'string') as string[];
      }
    } catch { /* ignore */ }
    return [] as string[];
  }, [activeHittingReport]);

  const persistedManual = useMemo(() => getManualSwingScores(activeHittingReport), [activeHittingReport]);
  // Multi-select option tags ("Drift" / "+Stack" / "Tall"...) saved with each
  // manual score on the active HITTING report — edited inline in the Coach
  // Grades section so coaches can pick descriptive labels alongside the bars.
  const persistedManualOptions = useMemo(() => getManualSwingOptions(activeHittingReport), [activeHittingReport]);
  const reportUploadIds = useMemo(() => getReportUploadIds(activeHittingReport), [activeHittingReport]);
  /* Two sub-tab-scoped slices of the same `csvUploads` map:
       - swingUploadIds    → Blast Motion + Full Swing + HitTrax
                             (the assessment uploads driving the Swing tab).
       - decisionUploadIds → the new at-bat Full Swing CSV
                             (live at-bat results driving the Swing
                             Decision tab's Spray Chart). */
  const swingUploadIds = useMemo(
    () => getReportUploadIdsForKeys(activeHittingReport, ['blast', 'fullswing', 'hittrax']),
    [activeHittingReport],
  );
  const decisionUploadIds = useMemo(
    /* Phase 6 — `atbat_fullswing` + `atbat_hittrax` CSV slots
       retired. At-bat batted-ball data is now captured live via
       /live tools. The Decision Spray Chart's data source moved to
       the new Live At-Bats section below it (see PhaseSixLiveAtBats);
       an empty `decisionUploadIds` array tells SprayChartView to
       short-circuit instead of falling back to the player's full
       metric history. */
    () => [] as string[],
    [],
  );

  const [manual, setManual] = useState<ManualSwingScores>(persistedManual);
  useEffect(() => { setManual(persistedManual); }, [persistedManual]);
  const [manualOptions, setManualOptions] = useState<ManualSwingOptions>(persistedManualOptions);
  useEffect(() => { setManualOptions(persistedManualOptions); }, [persistedManualOptions]);

  /* The Hitting Snapshot's notes box is now backed by the report's
     top-level `notes` field — whatever the coach types in the report
     modal's Notes section flows directly into the snapshot. The legacy
     content.diagnosisNotes is kept as a fallback so older reports that
     only saved into the JSON body still display their text. */
  const persistedDiagnosisNotes = useMemo(() => {
    if (activeHittingReport?.notes && activeHittingReport.notes.trim()) {
      return activeHittingReport.notes;
    }
    if (!activeHittingReport?.content) return '';
    try {
      const c = JSON.parse(activeHittingReport.content);
      return typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { return ''; }
  }, [activeHittingReport]);
  const [diagnosisNotes, setDiagnosisNotes] = useState(persistedDiagnosisNotes);
  useEffect(() => { setDiagnosisNotes(persistedDiagnosisNotes); }, [persistedDiagnosisNotes]);

  /* Parallel notes field for the Swing Decision sub-tab. Stored under
     a separate key (`content.swingDecisionNotes`) so a player can have
     independent Swing-mechanics notes vs. Swing-Decision notes on the
     same HITTING report. The snapshot's NoteBlock binds to whichever
     pair is active based on `subTab`. */
  const persistedSwingDecisionNotes = useMemo(() => {
    if (!activeHittingReport?.content) return '';
    try {
      const c = JSON.parse(activeHittingReport.content);
      return typeof c.swingDecisionNotes === 'string' ? c.swingDecisionNotes : '';
    } catch { return ''; }
  }, [activeHittingReport]);
  const [swingDecisionNotes, setSwingDecisionNotes] = useState(persistedSwingDecisionNotes);
  useEffect(() => { setSwingDecisionNotes(persistedSwingDecisionNotes); }, [persistedSwingDecisionNotes]);

  // Miss% from Full Swing CSV (column Q SquaredUp = null → miss).
  // Strict per-active-report: if this report has no upload IDs, Miss%
  // is null — no fallback to the player's all-time Full Swing data.
  const [fullSwingMissPct, setFullSwingMissPct] = useState<number | null>(null);
  useEffect(() => {
    if (!player?.id) return;
    if (reportUploadIds.length === 0) {
      setFullSwingMissPct(null);
      return;
    }
    api.getSessionData(player.id, 'FULL_SWING', ['bat_speed', 'squared_up_pct'], { uploadIds: reportUploadIds })
      .then((rows: any[]) => {
        const byTs = new Map<string, { bat: boolean; sq: boolean }>();
        for (const r of rows) {
          const cur = byTs.get(r.recordedAt) ?? { bat: false, sq: false };
          if (r.metricType === 'bat_speed')      cur.bat = true;
          if (r.metricType === 'squared_up_pct') cur.sq  = true;
          byTs.set(r.recordedAt, cur);
        }
        const swings = Array.from(byTs.values()).filter(s => s.bat);
        if (swings.length === 0) { setFullSwingMissPct(null); return; }
        const misses = swings.filter(s => !s.sq).length;
        setFullSwingMissPct((misses / swings.length) * 100);
      })
      .catch(() => setFullSwingMissPct(null));
  }, [player?.id, refreshKey, reportUploadIds]);

  // ── Per-HITTING-report metrics index ──
  // Fetch the metrics associated with EACH HITTING report's CSV uploads, keyed
  // by report id. We use this for carry-forward fallback: when the active
  // report is missing a metric, we walk back through older reports until we
  // find a value (rather than filling with the player's all-time max).
  const hittingReports = useMemo(
    () => reports.filter(r => r.reportType === 'HITTING')
                 .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const [perReportMetrics, setPerReportMetrics] = useState<Map<string, Record<string, { value: number; unit: string; recordedAt: string }>>>(new Map());
  useEffect(() => {
    if (!player?.id || hittingReports.length === 0) {
      setPerReportMetrics(new Map());
      return;
    }
    /* Aggregation rules per metric_type — matches the API's
       getTopMetrics so the in-app Hitting tab agrees with the rest of
       the system on how to roll up per-swing rows:
         max_* / *_max  → MAX
         avg_* / *_avg  → AVG (mean across rows)
         *_pct          → AVG (per-row 0/100 flags average to a %)
         explicit AVG   → MEAN (launch_angle, distance, etc.)
         lowerIsBetter  → MIN (time_to_contact + whiff/chase/K %)
         everything else → LATEST (newest row's value)
       Previously this just took MAX (or MIN for lowerIsBetter), which
       made percentage metrics like squared_up_pct and overall_barrel_pct
       always read 100 if any one swing hit 100. */
    const lowerIsBetter = new Set([
      'time_to_contact',
      'overall_whiff_pct', 'fb_whiff_pct', 'os_whiff_pct',
      'overall_chase_pct', 'fb_chase_pct', 'os_chase_pct',
      'overall_k_pct',
    ]);
    const explicitAvg = new Set([
      'launch_angle', 'distance', 'spray_angle', 'pitch_speed',
      'bat_speed', 'attack_angle', 'plane_angle',
      'time_to_contact', 'on_plane_efficiency',
      'connection_at_contact', 'rotational_acceleration',
      'smash_factor',
    ]);
    type AggMode = 'max' | 'min' | 'avg' | 'latest';
    const aggMode = (mt: string): AggMode => {
      if (lowerIsBetter.has(mt)) return 'min';
      if (mt.startsWith('max_') || mt.endsWith('_max')) return 'max';
      if (mt.startsWith('avg_') || mt.endsWith('_avg')) return 'avg';
      if (mt.endsWith('_pct')) return 'avg';
      if (explicitAvg.has(mt)) return 'avg';
      return 'latest';
    };
    let cancelled = false;
    Promise.all(hittingReports.map(async (r) => {
      const ids = getReportUploadIds(r);
      if (ids.length === 0) return [r.id, null] as const;
      try {
        const metrics = await api.getPlayerMetrics(player.id, { uploadIds: ids });
        // Bucket per metric_type so we can apply the right reducer.
        const grouped = new Map<string, typeof metrics>();
        for (const m of metrics) {
          const arr = grouped.get(m.metricType);
          if (arr) arr.push(m); else grouped.set(m.metricType, [m]);
        }
        const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
        for (const [mt, rows] of grouped.entries()) {
          // newest row first (assume rows arrive in any order — sort here)
          rows.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
          const values = rows.map(rr => rr.value);
          let v: number;
          const mode = aggMode(mt);
          if (mode === 'max') v = Math.max(...values);
          else if (mode === 'min') v = Math.min(...values);
          else if (mode === 'avg') v = values.reduce((s, n) => s + n, 0) / values.length;
          else v = rows[0].value;
          top[mt] = { value: v, unit: rows[0].unit, recordedAt: rows[0].recordedAt };
        }
        return [r.id, top] as const;
      } catch { return [r.id, null] as const; }
    })).then((entries) => {
      if (cancelled) return;
      const next = new Map<string, Record<string, { value: number; unit: string; recordedAt: string }>>();
      for (const [id, m] of entries) {
        if (m) next.set(id, m);
      }
      setPerReportMetrics(next);
    });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey, hittingReports]);

  // ── Live at-bat swing-decision metrics ──
  // Pull the hitter's live AtBat/Pitch tracker records (all-time) and derive
  // the Fastballs / Offspeed / Overall / Decision grade inputs from them, so
  // those rows populate from captured at-bats even with no At-Bat XLSX.
  const [liveAtBats, setLiveAtBats] = useState<api.AtBatDetail[]>([]);
  useEffect(() => {
    if (!player?.id) { setLiveAtBats([]); return; }
    let cancelled = false;
    api.listAtBats({ hitterId: player.id, limit: 1000 })
      .then((list) => { if (!cancelled) setLiveAtBats(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setLiveAtBats([]); });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey]);
  const liveAtBatMetrics = useMemo(() => computeLiveAtBatSwingMetrics(liveAtBats), [liveAtBats]);

  // ── At-Bat Results data extraction ──
  // The At-Bat XLSX is parsed on the frontend and stored as JSON inside a
  // report's content.atBatAssessment (NOT as individual metric records). The
  // consolidated HITTING report now bundles this — but we still fall back to
  // legacy standalone AT_BAT_RESULTS reports so older data keeps populating.
  // We pick whichever report (HITTING or AT_BAT_RESULTS) carries the most
  // recent atBatAssessment block, then translate its camelCase keys into
  // snake_case for the rest of the tab.
  const atBatMetrics = useMemo(() => {
    const result: Record<string, { value: number; unit: string; recordedAt: string }> = {};
    const candidates = reports
      .filter(r => r.reportType === 'AT_BAT_RESULTS' || r.reportType === 'HITTING')
      .filter(r => {
        if (!r.content) return false;
        try {
          const parsed = JSON.parse(r.content);
          if (!parsed?.atBatAssessment?.metrics) return false;
          /* Guard: a report only counts as carrying live At-Bat data when the
             At-Bat slot is still present in csvUploads. Reports where the
             coach removed the at-bat XLSX (older saves wouldn't have cleared
             content.atBatAssessment) are skipped so the snapshot stops
             showing the stale metrics. AT_BAT_RESULTS legacy reports are
             always allowed since they pre-date the slot system. */
          if (r.reportType === 'AT_BAT_RESULTS') return true;
          const slots = parsed?.csvUploads;
          return !!(slots && typeof slots === 'object' && slots.atbat);
        } catch { return false; }
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (candidates.length === 0) return result;
    const latest = candidates[0];
    if (!latest.content) return result;
    let m: any;
    try { m = JSON.parse(latest.content)?.atBatAssessment?.metrics; } catch { return result; }
    if (!m || typeof m !== 'object') return result;
    const KEY_MAP: Record<string, string> = {
      fbBarrelPct:        'fb_barrel_pct',
      fbWhiffPct:         'fb_whiff_pct',
      fbInZoneSwingPct:   'fb_in_zone_swing_pct',
      fbChasePct:         'fb_chase_pct',
      osBarrelPct:        'os_barrel_pct',
      osWhiffPct:         'os_whiff_pct',
      osInZoneSwingPct:   'os_in_zone_swing_pct',
      osChasePct:         'os_chase_pct',
      overallBarrelPct:   'overall_barrel_pct',
      overallBbPct:       'overall_bb_pct',
      overallKPct:        'overall_k_pct',
      avgEv:              'avg_exit_velo',
    };
    for (const [camel, snake] of Object.entries(KEY_MAP)) {
      const v = m[camel];
      if (typeof v === 'number' && Number.isFinite(v)) {
        result[snake] = { value: v, unit: '%', recordedAt: latest.createdAt };
      }
    }
    // Synthesize "Total" rates as the simple mean of FB + OS where the
    // shape only carries FB/OS pieces. Coaches expect to see them in the
    // Swing Decision row's Whiff / Chase / Zone Sw aggregates.
    const synth = (snakeKey: string, fbCamel: string, osCamel: string) => {
      if (snakeKey in result) return; // overall already provided
      const fb = m[fbCamel];
      const os = m[osCamel];
      if (typeof fb === 'number' && typeof os === 'number' && Number.isFinite(fb) && Number.isFinite(os)) {
        result[snakeKey] = { value: (fb + os) / 2, unit: '%', recordedAt: latest.createdAt };
      }
    };
    synth('overall_whiff_pct',         'fbWhiffPct',       'osWhiffPct');
    synth('overall_chase_pct',         'fbChasePct',       'osChasePct');
    synth('overall_in_zone_swing_pct', 'fbInZoneSwingPct', 'osInZoneSwingPct');
    return result;
  }, [reports]);

  /* Truth-based per-source presence flags: true when the active report's
     upload IDs actually produced at least one metric of that source. The
     slot key in csvUploads is not enough — a stale slot reference with no
     resulting metrics shouldn't keep a section visible. Set by the
     per-source metric fetch effect below; declared up here so the
     visibility flags can reference them without hitting the TDZ. */
  const [hasFullSwingCsv, setHasFullSwingCsv] = useState(false);
  const [hasHitTraxCsv, setHasHitTraxCsv] = useState(false);
  const [hasBlastCsv, setHasBlastCsv] = useState(false);

  /* Strict per-active-report slot/manual flags. Each Snapshot section
     reads ONLY these to decide whether to render — derived from the active
     report's csvUploads + manual entries, NEVER from at-bat XLSX,
     carry-forward, or other reports. Declared above topMetricsWithMiss
     because that memo references them in its merge step + deps. */
  const activeReportSlots = useMemo(() => {
    if (!activeHittingReport?.content) return {} as Record<string, any>;
    try {
      const parsed = JSON.parse(activeHittingReport.content);
      const slots = parsed?.csvUploads;
      return (slots && typeof slots === 'object') ? slots : {};
    } catch { return {} as Record<string, any>; }
  }, [activeHittingReport]);
  /* Whether the active report's Manual Entry toggle was ON for each slot
     when the coach last saved. Required for manual values to count as
     real data — older reports without the marker are treated as
     manual-mode-off so leftover stale values stop gating section
     visibility. The coach only needs to re-save the report once for the
     marker to land. */
  const activeManualModes = useMemo(() => {
    if (!activeHittingReport?.content) return { fullswing: false, blast: false };
    try {
      const parsed = JSON.parse(activeHittingReport.content);
      const m = parsed?.manualEntryModes;
      return {
        fullswing: !!(m && m.fullswing),
        blast: !!(m && m.blast),
      };
    } catch { return { fullswing: false, blast: false }; }
  }, [activeHittingReport]);
  const activeManualBatted = useMemo(
    () => getManualBattedBall(activeHittingReport),
    [activeHittingReport],
  );
  const activeManualSwing = useMemo(
    () => getManualSwingMetrics(activeHittingReport),
    [activeHittingReport],
  );
  /* Visibility = truth-based:
       • CSV side — at least one metric of that source actually exists for
         the active report's upload IDs (set by the per-source fetch effect
         further down). A stale slot reference with no resulting metrics
         doesn't keep a section visible.
       • Manual side — manual mode IS on for the slot AND at least one
         field is non-null. Stale all-null blocks from older saves don't
         count.
       Both sides AND'd against actual data presence — section only renders
       when it actually has something to show. */
  const hasActiveFullSwingData = hasFullSwingCsv
    || (activeManualModes.fullswing && Object.values(activeManualBatted).some(v => v != null));
  const hasActiveBlastData = hasBlastCsv
    || (activeManualModes.blast && Object.values(activeManualSwing).some(v => v != null));
  const hasActiveHitTraxData = hasHitTraxCsv;

  /** Active-report-only metrics: each Snapshot section (Full Swing, Blast,
   *  HitTrax, Coach Grades) populates ONLY from data attached to the active
   *  HITTING report — its CSV uploads + manual entries. No carry-forward
   *  from older reports, so removing a CSV slot from a report immediately
   *  empties the matching section.
   *
   *  Layering inside the active report (low → high priority):
   *    1. at-bat assessment XLSX (already gated by csvUploads.atbat)
   *    2. manual entries (manualBattedBall + manualSwingMetrics)
   *    3. CSV-derived metrics for THIS report's upload IDs
   *    4. synthesized full_swing_miss_pct (only when this report has a
   *       Full Swing CSV — see effect above) */
  const topMetricsWithMiss = useMemo(() => {
    /* Live-tracker swing-decision metrics form the lowest layer so they
       populate the Fastballs / Offspeed / Overall / Decision rows from
       captured at-bats, while an uploaded At-Bat XLSX, manual entries, and
       CSV metrics still override them when present. */
    const base: Record<string, { value: number; unit: string; recordedAt: string }> = { ...liveAtBatMetrics, ...atBatMetrics };

    if (activeHittingReport) {
      // Manual entries first, so CSV values from the same report override.
      // Each manual block only merges when its slot's manual-mode flag is on
      // — stops stale values from old saves (where the toggle wasn't tracked
      // yet) from leaking 0%/etc. into the chips.
      const merge = (
        entries: Record<string, number | null>,
        unitFor: (k: string) => string,
      ) => {
        for (const [k, val] of Object.entries(entries)) {
          if (typeof val !== 'number' || !Number.isFinite(val)) continue;
          base[k] = {
            value: val, unit: unitFor(k), recordedAt: activeHittingReport.createdAt,
          };
        }
      };
      if (activeManualModes.blast) {
        merge(activeManualSwing as unknown as Record<string, number | null>, (k) => {
          if (k === 'time_to_contact') return 'sec';
          if (k.endsWith('_pct') || k === 'on_plane_efficiency') return '%';
          if (k === 'attack_angle' || k === 'plane_angle') return 'deg';
          if (k === 'power_output') return 'kW';
          /* Blast CSV-spec additions — Early Connection /
             Connection at Impact are degree readings; the three
             composite scores (Plane / Connection / Rotation Score)
             render unit-less. `rotational_acceleration` /
             `connection_at_contact` reuse the existing entries
             above for backward compat with previous reports. */
          if (k === 'early_connection' || k === 'connection_at_impact') return 'deg';
          if (k === 'plane_score' || k === 'connection_score' || k === 'rotation_score') return '';
          return 'mph';
        });
        /* Alias the manual "Power (Kwh)" entry into the
           `power_output` slot so it populates the Swing GradeRow's
           Power (Kwh) chip. The manual form stores the value under
           the legacy `rotational_acceleration` key (data field
           untouched after the row was relabelled), but the chip
           strip + grade pipeline reads `power_output`. Only set
           the alias when `power_output` doesn't already have a
           value — so a CSV-derived Blast Motion reading still
           wins over a stale manual entry. */
        const manualPower = (activeManualSwing as unknown as Record<string, number | null>).rotational_acceleration;
        if (typeof manualPower === 'number' && Number.isFinite(manualPower) && base.power_output === undefined) {
          base.power_output = {
            value: manualPower, unit: 'kW',
            recordedAt: activeHittingReport.createdAt,
          };
        }
      }
      if (activeManualModes.fullswing) {
        merge(activeManualBatted as unknown as Record<string, number | null>, (k) => {
          if (k === 'distance') return 'ft';
          if (k === 'launch_angle') return 'deg';
          if (k === 'avg_exit_velo' || k === 'max_exit_velo') return 'mph';
          if (k === 'smash_factor') return '';
          return '%';
        });
      }

      // CSV-derived metrics for THIS report only.
      const m = perReportMetrics.get(activeHittingReport.id);
      if (m) {
        for (const [k, v] of Object.entries(m)) base[k] = v;
      }
    }

    if (fullSwingMissPct !== null) {
      base.full_swing_miss_pct = {
        value: fullSwingMissPct, unit: '%', recordedAt: new Date().toISOString(),
      };
    }
    return base;
  }, [
    activeHittingReport, perReportMetrics, fullSwingMissPct, atBatMetrics, liveAtBatMetrics,
    activeManualBatted, activeManualSwing, activeManualModes,
  ]);

  const metricGrades: Record<string, number | null> = useMemo(() => {
    const out: Record<string, number | null> = {};
    SWING_METRIC_KEYS.forEach(k => { out[k] = metricToGrade(topMetricsWithMiss, k); });
    return out;
  }, [topMetricsWithMiss]);

  /* ── Source-aware QoC override for the Hitting Snapshot ──
     The QoC chips (Avg EV / Max EV / LA / Dist) need to mirror whatever the
     HitTrax sub-section is showing when HitTrax data exists, falling back to
     Full-Swing-source data when only Full Swing data is loaded. We fetch
     each metric's progress filtered by source and aggregate the same way
     the SwingTab sections do (HitTrax: avg of velos for Avg EV, max for
     Max EV, mean for LA / Dist). */
  const [hittraxVelos, setHittraxVelos] = useState<number[]>([]);
  const [hittraxLAs, setHittraxLAs] = useState<number[]>([]);
  const [hittraxDists, setHittraxDists] = useState<number[]>([]);
  const [fullswingVelos, setFullswingVelos] = useState<number[]>([]);
  const [fullswingLAs, setFullswingLAs] = useState<number[]>([]);
  const [fullswingDists, setFullswingDists] = useState<number[]>([]);

  useEffect(() => {
    if (!player?.id) return;
    let cancelled = false;
    /* Strict per-active-report scoping: pull every metric for THIS report's
       upload IDs, then bucket by source so HitTrax-source rows feed the
       HitTrax aggregates and Full-Swing-source rows feed the Full Swing
       aggregates. If the active report has no upload IDs, all arrays stay
       empty and every section / chip stays hidden. */
    if (reportUploadIds.length === 0) {
      setHittraxVelos([]); setHittraxLAs([]); setHittraxDists([]);
      setFullswingVelos([]); setFullswingLAs([]); setFullswingDists([]);
      setHasFullSwingCsv(false); setHasHitTraxCsv(false); setHasBlastCsv(false);
      return;
    }
    api.getPlayerMetrics(player.id, { uploadIds: reportUploadIds })
      .then((metrics: any[]) => {
        if (cancelled) return;
        const htV: number[] = [], htLA: number[] = [], htD: number[] = [];
        const fsV: number[] = [], fsLA: number[] = [], fsD: number[] = [];
        let sawFs = false, sawHt = false, sawBlast = false;
        for (const m of metrics) {
          if (!Number.isFinite(m.value)) continue;
          if (m.source === 'HITTRAX') {
            sawHt = true;
            if (m.metricType === 'max_exit_velo') htV.push(m.value);
            else if (m.metricType === 'launch_angle') htLA.push(m.value);
            else if (m.metricType === 'distance') htD.push(m.value);
          } else if (m.source === 'FULL_SWING') {
            sawFs = true;
            if (m.metricType === 'max_exit_velo') fsV.push(m.value);
            else if (m.metricType === 'launch_angle') fsLA.push(m.value);
            else if (m.metricType === 'distance') fsD.push(m.value);
          } else if (m.source === 'BLAST_MOTION') {
            sawBlast = true;
          }
        }
        // Drop Velo=0 rows so empty at-bats don't drag averages toward zero.
        setHittraxVelos(htV.filter(v => v !== 0));
        setHittraxLAs(htLA);
        setHittraxDists(htD);
        setFullswingVelos(fsV.filter(v => v !== 0));
        setFullswingLAs(fsLA);
        setFullswingDists(fsD);
        setHasFullSwingCsv(sawFs);
        setHasHitTraxCsv(sawHt);
        setHasBlastCsv(sawBlast);
      })
      .catch(() => {
        if (cancelled) return;
        setHittraxVelos([]); setHittraxLAs([]); setHittraxDists([]);
        setFullswingVelos([]); setFullswingLAs([]); setFullswingDists([]);
        setHasFullSwingCsv(false); setHasHitTraxCsv(false); setHasBlastCsv(false);
      });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey, reportUploadIds]);

  const qocOverride: Record<string, { value: number; unit: string }> = useMemo(() => {
    const mean = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
    const round = (n: number) => Math.round(n * 100) / 100;
    const out: Record<string, { value: number; unit: string }> = {};
    // The Hitting Snapshot's QoC chips POOL HitTrax + Full Swing data so the
    // top-of-tab averages reflect every batted ball recorded across both
    // sources. The individual sub-sections (Full Swing card / HitTrax card)
    // continue to use their own source-filtered aggregates so each card
    // still shows only its own data — only the snapshot is combined.
    const velos = [...hittraxVelos, ...fullswingVelos];
    const las   = [...hittraxLAs,   ...fullswingLAs];
    const dists = [...hittraxDists, ...fullswingDists];
    if (velos.length > 0) {
      out.avg_exit_velo = { value: round(mean(velos)),         unit: 'mph' };
      out.max_exit_velo = { value: round(Math.max(...velos)),  unit: 'mph' };
    }
    if (las.length   > 0) out.launch_angle = { value: round(mean(las)),   unit: 'deg' };
    if (dists.length > 0) out.distance     = { value: round(mean(dists)), unit: 'ft'  };
    return out;
  }, [hittraxVelos, hittraxLAs, hittraxDists, fullswingVelos, fullswingLAs, fullswingDists]);

  // Save flow (Coach Grades + Diagnosis Notes)
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const dirty = useMemo(() => {
    const manualDirty = (Object.keys(persistedManual) as (keyof ManualSwingScores)[])
      .some(k => persistedManual[k] !== manual[k]);
    const notesDirty =
      diagnosisNotes !== persistedDiagnosisNotes
      || swingDecisionNotes !== persistedSwingDecisionNotes;
    // Compare option arrays by stringified content — order-stable since both
    // come from the same source (the report's saved order or empty []).
    const optionsDirty = (Object.keys(persistedManualOptions) as (keyof ManualSwingOptions)[])
      .some(k => JSON.stringify(persistedManualOptions[k] ?? []) !== JSON.stringify(manualOptions[k] ?? []));
    return manualDirty || notesDirty || optionsDirty;
  }, [persistedManual, manual, diagnosisNotes, persistedDiagnosisNotes, swingDecisionNotes, persistedSwingDecisionNotes, persistedManualOptions, manualOptions]);

  async function saveManual() {
    if (!user) { setSaveError('Not signed in.'); return; }
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const userId = (user as any).id || (user as any).sub;
      let prevContent: Record<string, any> = {};
      if (activeHittingReport?.content) {
        try { prevContent = JSON.parse(activeHittingReport.content) || {}; } catch { /* ignore */ }
      }
      const newContent = {
        ...prevContent,
        manualScores: {
          forwardMove: manual.forwardMove,
          posture:     manual.posture,
          stability:   manual.stability,
          direction:   manual.direction,
          stretch:     manual.stretch,
          core:        manual.core,
          slot:        manual.slot,
          timing:      manual.timing,
          updatedAt:   new Date().toISOString(),
          updatedBy:   userId,
        },
        // Multi-select option tags for each Coach Grade — saved with the
        // scores so removals propagate cleanly into content.manualOptions.
        manualOptions: { ...manualOptions },
        diagnosisNotes,
        /* Swing Decision-specific diagnosis notes, edited from the
           NoteBlock that lives at the bottom of the snapshot bubble
           when the Swing Decision sub-tab is active. */
        swingDecisionNotes,
      };
      await api.createReport({
        playerId: player.id,
        createdById: userId,
        reportType: 'HITTING',
        title: activeHittingReport?.notes ? undefined : 'Swing Mechanics Update',
        content: JSON.stringify(newContent),
        // Persist edits made in the snapshot's notes box back to the
        // report's top-level Notes field so the report modal and the
        // snapshot always show the same text.
        notes: diagnosisNotes || undefined,
      });
      setSaveOk(true);
      onRefresh?.();
    } catch (e) {
      setSaveError((e as Error).message || 'Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveOk(false), 2200);
    }
  }

  const shared: SharedHittingState = {
    manual, setManual, persistedManual,
    manualOptions, setManualOptions,
    diagnosisNotes, setDiagnosisNotes,
    topMetricsWithMiss, metricGrades, reportUploadIds,
    hasActiveFullSwingData, hasActiveBlastData, hasActiveHitTraxData,
    dirty, saving, saveOk, saveError, saveManual,
  };

  // Sub-tab nav rendered INSIDE the shared bubble at the top — pill-style buttons
  // so it reads obviously as a tab system at a glance.
  /* Sub-tab nav (Swing / Swing Decision) uses the shared TabBar
   * component — the same one rendered for the top-level athlete tabs
   * (Player Summary / Hitting / Pitching / …) on the page shell. Using
   * the component directly (instead of a hand-rolled inline pill nav)
   * guarantees the two bars look identical: same dark-navy gradient
   * container, same glowing-underline active state, same muted/text
   * color contrast. If the main TabBar's styling ever changes, the
   * sub-tab nav inherits it for free.
   *
   * The TabBar carries its own `margin-bottom: 18px` (sized for the
   * page-shell where it sits above breathing room). When dropped
   * inside the Hitting Grades bubble that 18px stacks on top of the
   * parent's `gap: 12` for ~30px of empty space — too loose. The
   * wrapping div with `marginBottom: -18` cancels the inner margin so
   * only the bubble's natural 12px gap remains, AND `marginTop: -4`
   * tightens against the bubble's 14px top padding so the TabBar reads
   * as the section's title row, not a floating island. */
  /* The Swing / Swing Decision sub-tab nav was previously composed
     here and passed into HittingGradeStack via a `subTabBar` prop. It
     now lives inline at the top center of the Hitting Snapshot bubble
     (see the JSX below) so it reads as the snapshot's primary toggle
     instead of an embedded row inside the right-side grade column. */

  return (
    <>
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={props.onEditProfile} show={!isCoach} />
        {/* Top-level Download PDF — generates a PDF for the currently
            selected HITTING report. Disabled when no report is selected. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!activeHittingReport) return;
            /* Pass the in-app Snapshot's exact computed display state:
                 • topMetricsWithMiss — per-active-report-scoped metrics
                   (manual + CSV + at-bat XLSX, gated by manual-mode flags).
                 • qocOverride — pooled HitTrax + Full Swing means/maxes
                   the snapshot's QoC chips render with.
               Previously the PDF re-derived these and could drift; now
               it's literally the same data the on-screen report uses. */
            await generateHittingPdf(player, [activeHittingReport], topMetricsWithMiss, qocOverride);
          }}
          disabled={!activeHittingReport}
        />
        {/* Videos jump — sits next to the Download PDF icon and
            replaces the standalone Videos tab in the main nav. */}
        <VideosIconButton onClick={props.onOpenVideos} />
        <ReportSelector
          reports={reports}
          reportTypes={['HITTING']}
          label="Hitting"
          isCoach={isCoach}
          selectedId={activeHittingReport?.id ?? null}
          onSelect={setSelectedHittingReport}
          onDeleted={onRefresh}
          onNewReport={props.onNewReport}
          onEdit={props.onEditReport}
          onDownload={(r) => generateHittingPdf(player, [r], topMetricsWithMiss, qocOverride)}
        />
      </TabBarActions>

      {/* ── Top row: Spray Chart (left) + shared big bubble (right) ── */}
      <Section>
        {/* Outer bubble wrapping the Hitting Snapshot header + spray chart +
            grade bars + diagnosis notes — header sits INSIDE the bubble.
            Uses the shared profilePanel chrome so every player-profile
            tab reads with the same elevated-card treatment.
            `data-pdf-section="hitting-snapshot"` marks this node for the
            Summary tab's "Download PDF" capture flow. */}
        <div
          data-pdf-section="hitting-snapshot"
          className={aStyles.profilePanel}
          /* Override the inherited `.profilePanel` `padding: 1.4rem`
             on the TOP side only — coach-spec wants the gap between
             the bubble's top edge and the "Hitting Snapshot" title
             cut in half (1.4rem → 0.7rem). Other three sides keep
             the canonical 1.4rem so the snapshot's left / right /
             bottom rhythm stays in sync with every other dark-blue
             bubble across the app. */
          style={{ paddingTop: '10px', borderRadius: 28, boxShadow: 'var(--report-outer-shadow)' }}
        >
        {/* Title row — Hitting Snapshot label on the left, an
            auto-expanding divider hairline filling the right side,
            and the Swing / Swing Decision toggle absolutely
            centered horizontally + vertically inside the row so it
            sits in the middle of the header on the same vertical
            level as the "Hitting Snapshot" title. The toggle has no
            bubble chrome — it's a pair of plain text buttons with an
            accent-blue underline indicating the active sub-tab. */}
        <div style={{
          position: 'relative',
          display: 'flex',
          /* `flex-end` + the title row's own `padding-bottom` +
             `border-bottom` reproduces the Tool Grades rhythm
             exactly: title baseline sits 0.7rem above a full-width
             1px accent line, then 0.85rem of breathing room before
             the first inner row (Spray Chart + Grade Stack). */
          alignItems: 'flex-end',
          gap: 12,
          paddingBottom: '0.7rem',
          marginBottom: '0.85rem',
          borderBottom: '1px solid var(--border)',
        }}>
          {/* Leading bat-and-ball icon retired — the Hitting Snapshot
              header now reads with the title text alone.
              The title text ITSELF doubles as the "switch to Swing
              view" button per coach-spec — click anywhere on
              "HITTING SNAPSHOT" → `setSubTab('swing')`. This
              replaces the standalone Swing toggle that used to live
              in the row's center. The title's display-font /
              italic / 20.7 px styling is unchanged; only a
              `cursor: pointer` + click handler is added on top so
              the title doubles as the Swing toggle target. */}
          <div
            className={aStyles.sectionTitle}
            role="button"
            tabIndex={0}
            onClick={() => setSubTab('swing')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSubTab('swing');
              }
            }}
            style={{ cursor: 'pointer' }}
            title="Show Swing view"
          >
            <span className={aStyles.sectionTitleFirst}>Hitting</span>
            {' '}
            <span className={aStyles.sectionTitleAccent}>Report</span>
          </div>
          {/* Live Results toggle — relocated to sit IMMEDIATELY next
              to the "Hitting Snapshot" title per coach-spec. Click →
              flips `subTab` between 'swing' and 'decision'. When
              active (`subTab === 'decision'`) the button highlights
              blue; otherwise it reads as a muted chip. The matching
              "Swing" affordance lives on the snapshot's title text
              itself (the title's `onClick` above), so the two click
              targets sit side-by-side on the left of the header
              row. `alignSelf: flex-end` + `marginBottom: 8`
              baseline-aligns the button with the title's lower
              edge so they read as paired elements. */}
          <button
            type="button"
            onClick={() => setSubTab(subTab === 'decision' ? 'swing' : 'decision')}
            style={{
              /* Vertically center on the "Hitting Snapshot" title +
                 the white hairline that runs through the title's
                 mid-line. `alignSelf: flex-end` (inherited from
                 the row's `alignItems: flex-end`) anchors the
                 button's BOTTOM to the same baseline as the title.
                 Since the button's box height and the title's
                 line-box height are both ~22 px, sharing a baseline
                 puts their centers on the same horizontal axis.
                 The hairline runs ~1.5 px above the title's center,
                 so the button center reads as visually aligned with
                 BOTH simultaneously.

                 Don't use `alignSelf: center` — the row contains
                 other children with `marginBottom: 8` (date chip)
                 and `marginBottom: 12` (hairline) that push the
                 row's content-area center above the title's actual
                 center, so `alignSelf: center` would float the
                 button too high. */
              alignSelf: 'flex-end',
              marginBottom: 0,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 12px',
              borderRadius: 6,
              border: `1px solid ${subTab === 'decision' ? 'rgba(126,182,255,0.65)' : 'var(--border)'}`,
              background: subTab === 'decision' ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.04)',
              /* Active text: pale blue reads on dark theme but vanishes on the
                 light-theme pale-blue chip — dark grey there to offset. */
              color: subTab === 'decision'
                ? (isLight ? '#374151' : '#cfe0ff')
                : 'var(--text-muted)',
              fontFamily: 'inherit',
              fontSize: rem(10),
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            title="Toggle between Swing view and Live Results view"
          >
            Live Results
          </button>
          {/* Title-midline hairline — runs from immediately after
              the Live Results chip to the right edge of the bubble,
              vertically centered on the 20.7 px title via
              `alignSelf: flex-end` + `marginBottom: 12`. Matches
              the SectionHeader / Tool Grades / Pitch Report
              hairline treatment on every other dark-blue bubble. */}
          <div
            aria-hidden="true"
            style={{
              flex: 1,
              height: 1,
              background: 'var(--border)',
              alignSelf: 'flex-end',
              marginBottom: 12,
            }}
          />
          {/* Data-date-range chip — top-right of the Hitting Snapshot
              header, on the side opposite the "Hitting Snapshot"
              title. Sourced from the SprayChartView via the
              `onDataRangeChange` callback so the chip stays in sync
              with whatever date range the chart's resolved data
              spans. Hidden when no data is loaded. Style matches the
              chip that used to live inside the chart's legend strip
              so the visual treatment carries over unchanged. */}
          {sprayDateLabel && (
            <span style={{
              alignSelf: 'flex-end',
              marginBottom: 8,
              fontSize: rem(10),
              color: 'var(--text-muted)',
              letterSpacing: '0.10em',
              padding: '3px 9px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
              fontFamily: "'DM Mono', ui-monospace, monospace",
            }}>
              {sprayDateLabel}
            </span>
          )}
          {/* Standalone Swing toggle retired per coach-spec — the
              "switch to Swing view" affordance now lives on the
              "Hitting Snapshot" title text itself (clickable via
              the `onClick` added above). Saves the center toggle
              real estate and the title's display-font typography
              doubles as the visual cue. The matching "Live Results"
              toggle still sits next to the date chip in this same
              header row. */}
        </div>
        <div style={{
          display: 'grid',
          /* Reverted to the original single-row 2-col grid with
             `alignItems: stretch`. The earlier "row-spanning" trick
             (where the spray chart spanned rows 1+2 and the right
             column was split into row 1 = HittingGradeStack /
             row 2 = Coach Reviews) was designed to auto-match the
             chart's height to the right column's content. It worked
             in principle but the spray chart's natural rendering
             height in compact swing mode is set by its own internal
             content (color bar + chart SVG + filter card) and
             doesn't actually shrink to fit a smaller grid row,
             which left a stubborn 4-px gap between the chart's
             visible bottom edge and the Coach Reviews bottom edge.

             Going back to plain stretch: both columns are forced
             to the same height (= max natural). Coach Reviews
             bubble keeps `flex: 1, minHeight: 0` (no maxHeight cap
             on the bubble itself) so it grows to fill whatever
             vertical space is left after HittingGradeStack —
             that lands its bottom edge exactly on the spray
             chart's bottom via the stretch mechanism. To keep the
             VISIBLE video content "small" per the previous
             coach-spec, the inner video grid has its own
             `maxHeight: 200; overflow-y: auto` cap further down,
             so the bubble's chrome can fill the column while the
             tile area itself stays compact. */
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 18,
          alignItems: 'stretch',
        }}>
          {/* Left — spray chart (and, on the Swing Decision sub-tab,
              the Results GradeRow lifted out from the right-column
              GradeStack so it sits directly UNDER the chart that
              visualises its data). Spray data source flips with the
              active sub-tab: Swing uses the assessment uploads
              (Blast + HitTrax + Full Swing); Swing Decision uses
              the new at-bat live-data Full Swing CSV + the live
              tracker's per-AB sprayX/sprayY points. */}
          <div style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {subTab === 'decision' ? (
              /* Swing Decision view — Results + Spray Chart combined
                 into ONE bubble with a single warm-grey footprint.
                 Both inner components render with `noOuterChrome` so
                 their own bubble surfaces drop away, and this
                 wrapper supplies the unified Movement-Plot chrome
                 (gradient + border + radius). Internal layout: title
                 row (Results) → accent rules → chip strip → spray
                 chart, all on one continuous surface. */
              <div style={{
                background:
                  'radial-gradient(ellipse at 0% 0%, rgba(126,134,144,0.07) 0%, transparent 55%),' +
                  'radial-gradient(ellipse at 100% 100%, rgba(126,134,144,0.05) 0%, transparent 55%),' +
                  'linear-gradient(180deg, rgba(255,255,255,0.032) 0%, rgba(255,255,255,0.008) 100%)',
                border: '1px solid var(--border-light)',
                borderRadius: 12,
                /* Inner padding controls the Results-section breathing
                   room AND the chart's top inset (the chart itself
                   has no outer padding when `noOuterChrome` is on).
                   Bottom padding bumped 12 → 22 → 36 to trim the
                   chart's bottom edge a total ~24 px so the bubble
                   sits cleanly above the Overall bubble's bottom
                   instead of pushing past it. */
                padding: '10px 14px 36px',
                display: 'flex', flexDirection: 'column', gap: 8,
                /* Grow the combined bubble to fill the left column's
                   stretched height (the parent grid uses
                   `alignItems: 'stretch'`, so left + right columns
                   are the same height). Combined with the chart's
                   own `flex: 1` below, the chart's bottom aligns
                   with the right column's bottom (Overall bubble).
                   `minHeight: 0` lets flex children shrink past
                   their content-driven minimum. */
                flex: 1,
                minHeight: 0,
              }}>
                <SwingDecisionResultsRow
                  topMetrics={topMetricsWithMiss}
                  metricGrades={metricGrades}
                  noOuterChrome
                />
                {/* Flex-grow wrapper around the chart so it expands
                   to fill the bubble height past the Results
                   section, landing its bottom edge flush with the
                   right column's Overall bubble. */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                  <SprayChartView
                    playerId={player.id}
                    refreshKey={refreshKey}
                    /* Decision pulls the at-bat batted-ball slots (Full
                       Swing + HitTrax) and overlays live-tracker AtBat
                       sprayX/sprayY points on top. */
                    reportUploadIds={decisionUploadIds}
                    compact
                    onDataRangeChange={setSprayDateLabel}
                    hideReadout
                    hideFilters
                    /* Exit Velo gradient legend retired in the combined
                       bubble — the Results row above already conveys
                       the outcome breakdown, and the spray dots paint
                       by outcome (red GB / blue LD+Barrel / green FB)
                       not by EV in this view. */
                    hideColorBar
                    /* Inner chart has no chrome — the wrapper above
                       supplies the unified bubble surface. */
                    noOuterChrome
                  />
                </div>
              </div>
            ) : (
              /* Swing sub-tab — Results NOT lifted into this column,
                 SprayChartView keeps its full chrome + Metric Readout
                 + filter card. */
              <SprayChartView
                playerId={player.id}
                refreshKey={refreshKey}
                reportUploadIds={swingUploadIds}
                compact
                onDataRangeChange={setSprayDateLabel}
              />
            )}
          </div>
          {/* Right column — HittingGradeStack at top + Coach
              Reviews bubble filling the remaining space below.
              `flex column` + `gap: 14` matches the spacing the
              original layout used between the grade stack and the
              video panel. With the parent grid's `alignItems:
              stretch`, this column shares its height with the
              left column (spray chart), which is how the Coach
              Reviews bubble's bottom edge ends up flush with the
              chart's bottom edge — the bubble's `flex: 1` claims
              whatever vertical space is left after HittingGradeStack
              renders. */}
          <div style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}>
            <HittingGradeStack
              topMetrics={topMetricsWithMiss}
              manual={manual}
              metricGrades={metricGrades}
              isCoach={isCoach}
              diagnosisNotes={diagnosisNotes}
              setDiagnosisNotes={setDiagnosisNotes}
              subTab={subTab}
              qocOverride={qocOverride}
              omitResultsRow={subTab === 'decision'}
            />

            {/* Coach Reviews bubble — fills the remaining column
                height so its bottom is locked to the spray chart's
                bottom by `alignItems: stretch` on the parent grid.
                The "smaller bubble" feel from earlier coach-spec
                edits now lives one level deeper: the inner video
                grid has its own `maxHeight` + `overflow-y: auto`,
                so the visible video content area stays compact
                even when the bubble's chrome stretches taller. */}
            {(() => {
              if (!activeHittingReport || attachedReviewIds.length === 0) return null;
              const attachedVideos = playerVideos.filter((v) => attachedReviewIds.includes(v.id));
              if (attachedVideos.length === 0) return null;
              return (
                <div style={{
                  minWidth: 0,
                  ...movementPlotBubbleStyle,
                  display: 'flex',
                  flexDirection: 'column',
                  /* `gap: 10` keeps the white "Coach Reviews" header
                     (matching Coach Diagnosis above) visually attached
                     to the video grid underneath without crowding. */
                  gap: 10,
                  padding: 11,
                  /* Stretch to fill the remaining vertical space in
                     the right column — this is what locks the
                     bubble's bottom edge onto the spray chart's
                     bottom edge via the parent grid's stretch. */
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}>
                  {/* Title row — mirrors the GradeRow header pattern
                      from HittingGradeStack (Swing / Quality of
                      Contact / Coach Diagnosis) so this bubble
                      reads as a fourth sibling row.
                      Layout: label on the LEFT + inline accent
                      hairline flex-growing to the right edge (sits
                      at the label's mid-line via alignSelf flex-end
                      + marginBottom 12, matching GradeRow exactly).
                      The grade number that GradeRow renders to the
                      right of the hairline is omitted here — this
                      bubble has no composite score — so the hairline
                      simply runs from the label all the way to the
                      bubble's right edge. */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    flexShrink: 0,
                  }}>
                    <span style={{
                      /* Same font as the GradeRow label (Coach
                         Diagnosis / Swing / Quality of Contact). */
                      fontFamily: 'inherit',
                      fontSize: rem(17.6), fontWeight: 600, fontStyle: 'normal',
                      letterSpacing: '-0.025em', textTransform: 'uppercase',
                      color: 'var(--text-bright)', lineHeight: 1.05,
                    }}>
                      Coach Reviews
                    </span>
                    <div
                      aria-hidden="true"
                      style={{
                        flex: 1,
                        height: 1,
                        background: 'var(--border)',
                        alignSelf: 'flex-end',
                        marginBottom: 12,
                      }}
                    />
                  </div>

                  {/* Second accent hairline — sits BELOW the title
                      row, spanning the bubble's full inner width.
                      Mirrors line 3 of GradeRow's six-line spec
                      (the white rule between the progress bar and
                      the chip labels). Visually separates the
                      "Coach Reviews" title block from the video
                      grid below, finishing the GradeRow-style frame
                      around the panel's header. */}
                  <div
                    aria-hidden="true"
                    style={{
                      height: 1,
                      background: 'var(--border)',
                      flexShrink: 0,
                    }}
                  />

                  {/* Inner video grid — no surface of its own now
                      that the outer Swing-bubble supplies the
                      chrome. Just a scroll container for the tile
                      grid.

                      The bubble around this grid now stretches to
                      fill the right column (so its bottom locks
                      onto the spray chart's bottom via
                      `alignItems: stretch`). To keep the VISIBLE
                      video content compact, this grid caps itself
                      at `maxHeight: 200px` with `overflow-y: auto`.
                      Any extra bubble height (beyond what title +
                      hairlines + ≤200 px grid occupy) becomes
                      empty bubble chrome below the grid — which
                      reads as a natural extension of the warm-grey
                      surface rather than visible whitespace,
                      because there's no inner background change
                      between the grid area and the bottom of the
                      bubble. */}
                  <div style={{
                    flexShrink: 0,
                    maxHeight: 200,
                    overflowY: 'auto',
                    display: 'grid',
                    /* Column minimum nudged 110 → 107 (~ 3 % tighter)
                       so the tiles inside also shrink ~ 3 % when
                       auto-fill packs them, keeping the contents of
                       the bubble in proportion. Gap dropped 8 → 7
                       for the same reason. */
                    gridTemplateColumns: 'repeat(auto-fill, minmax(107px, 1fr))',
                    gridAutoRows: 'max-content',
                    gap: 7,
                  }}>
                    {bundleVideos(attachedVideos).map((b) => (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="sm"
                        playerId={player.id}
                        recordingCategory="HITTING"
                        onUploaded={onRefresh}
                        reports={hittingReports}
                        /* Suppress the per-tile category-tinted
                           "eyebrow" label (the blue/orange/teal
                           caption at the top of each VideoBundleCard
                           that reads "Coach Review - Hitting - …").
                           That label is redundant inside the
                           snapshot's Coach Reviews bubble because
                           the panel's own white header above already
                           tells the coach what they're looking at.
                           The label is left intact for every other
                           caller of VideoBundleCard (Pitching tab,
                           Defense tab, Videos library, etc.). */
                        hideLabel
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Full-width Diagnosis Notes — sits below BOTH the spray chart
            and the grade stack so the coach has the entire Snapshot
            width to write longer observations. Rendered on BOTH
            sub-tabs but bound to different fields:
              • Swing          → `diagnosisNotes`        (report.notes / content.diagnosisNotes)
              • Swing Decision → `swingDecisionNotes`    (content.swingDecisionNotes)
            so a player can carry independent notes for each lens of
            the snapshot on the same HITTING report. */}
        <div style={{ marginTop: 18 }}>
          <NoteBlock
            label="Hitting Notes"
            value={subTab === 'decision' ? swingDecisionNotes : diagnosisNotes}
            onChange={subTab === 'decision' ? setSwingDecisionNotes : setDiagnosisNotes}
            placeholder={subTab === 'decision'
              ? 'Swing-decision observations — pitch-recognition, zone discipline, chase tendencies, two-strike approach…'
              : 'Mechanical observations — load, posture, slot, sequencing, body line, swing decisions you noticed…'
            }
            editable={isCoach}
            rows={5}
            /* `largeLabel` swaps the Font-D eyebrow for Font B
               so this label visually matches the "Pitching Notes"
               eyebrow over in the Pitching tab. Label text also
               renamed "Diagnosis Notes" → "Hitting Notes" per spec. */
            largeLabel
          />
        </div>
        </div>{/* /outer snapshot bubble */}
      </Section>

      {/* Coach Reviews panel previously lived here as a standalone
          Section below the snapshot. Moved INTO the snapshot bubble
          (between Coach Diagnosis and Hitting Notes) per coach-spec
          so the per-report attached clips sit in the gap between
          those two sections instead of breaking the snapshot rhythm. */}

      {/* ── Live At-Bats (Phase 6) — only on the Swing Decision view.
          Replaces the retired `atbat_fullswing` CSV pipeline; this
          section now reads directly from the Live Session AtBat rows
          captured via the /live tools. Filter chips switch the
          server `limit` / `since` parameters; the vs-LHP / vs-RHP
          chip pair filters by the `pitcherHandedness` snapshot. */}
      {subTab === 'decision' && (
        <Section>
          <LiveAtBatsList
            hitterId={player.id}
            title="Live At-Bats"
          />
        </Section>
      )}

      {/* ── Sub-tab content ──
          Swing sub-tab still renders the Full Swing / Blast grids
          below the snapshot. Swing Decision sub-tab is intentionally
          empty below the snapshot — everything that used to render
          there (the discipline-grid SwingDecisionTab) was retired so
          the snapshot bubble alone tells the Swing Decision story,
          backed by the spray chart's at-bat data + the
          Swing-Decision-specific diagnosis notes inside it. */}
      {subTab === 'swing' && <SwingTab {...props} topMetrics={topMetricsWithMiss} shared={shared} />}

      {/* ── Main Video gallery — BOTTOM-most section on the Hitting
          tab. Now caps at 10 most-recent tiles (2 rows × 5 columns);
          overflow lives in the dedicated all-videos page reached via
          the Videos button next to Download.
          Per coach-spec, Coach Reviews now populate HERE TOO (in
          addition to the dedicated bubble near Coach Grades up
          above) — the prior `!attachedReviewIds.includes(v.id)`
          exclusion was retired so a coach can find a narrated
          review from either the per-report panel OR the main
          Video gallery without hunting. Still gated to the Swing
          sub-tab since Swing Decision doesn't carry session video. */}
      {subTab === 'swing' && (() => {
        const videoIds = getReportVideoIds(activeHittingReport ?? null);
        const reportVideos = playerVideos.filter(v =>
          (videoIds.includes(v.id) || v.category === 'HITTING')
        ).sort((a, b) => {
          const aR = a.title.startsWith('Coach Review') ? 0 : 1;
          const bR = b.title.startsWith('Coach Review') ? 0 : 1;
          return aR - bR;
        });
        const contentVideos = getReportContentVideos(activeHittingReport ?? null);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <div
              data-pdf-section="hitting-video"
              className={aStyles.profilePanel}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <SectionHeader title="Video" />
              {hasVideos ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gridAutoRows: 'max-content',
                  gap: 12,
                  marginBottom: 24,
                }}>
                  {/* Cap at 10 most-recent tiles (2 rows × 5 cols);
                      overflow lives in the all-videos page. */}
                  {bundleVideos(reportVideos).slice(0, 10).map((b) => {
                    const { prefix } = splitVideoTitle(b.videos[0].title || '');
                    return (
                      <VideoBundleCard
                        key={b.key}
                        videos={b.videos}
                        size="md"
                        playerId={player.id}
                        recordingCategory="HITTING"
                        onUploaded={onRefresh}
                        reports={hittingReports}
                      />
                    );
                  })}
                  {reportVideos.length === 0 && contentVideos.map((v, i) => (
                    <VideoPlaceholder
                      key={`content-${i}`} tag="HITTING"
                      title={v.name.replace(/\.[^.]+$/, '')}
                      subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
                      videoUrl={v.url}
                      playerId={player.id}
                      recordingCategory="HITTING"
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyMsg}>No video data.</div>
              )}
            </div>
          </Section>
        );
      })()}
    </>
  );
}
