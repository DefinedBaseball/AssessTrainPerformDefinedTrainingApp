'use client';

import { useEffect, useMemo, useState } from 'react';
import { SwingTab, HittingGradeStack, type SharedHittingState } from './SwingTab';
import { SwingDecisionTab } from './SwingDecisionTab';
import { TabBarActions, AddReportButton, EditProfileButton, Section, SectionHeader, ReportSelector } from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import { SprayChartView } from '../components/SprayChartView';
import { generateHittingPdf } from '@/lib/pdf';
import {
  TabProps,
  getLatestReport, getReportUploadIds, getManualSwingScores, getManualSwingOptions,
  metricToGrade,
  type ManualSwingScores,
  type ManualSwingOptions,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const SUB_TABS = [
  { key: 'swing',    label: 'Swing' },
  { key: 'decision', label: 'Swing Decision' },
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
      <rect x="0" y="0" width="100" height="100" rx="14" fill="#fff" />
      {/* Baseball at the top center — outer circle + a couple of seam arcs */}
      <g>
        <circle cx="50" cy="20" r="8" fill="#000" />
        <path d="M 44 16.5 Q 50 18.5 56 16.5"
          stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M 44 23.5 Q 50 21.5 56 23.5"
          stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
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
  'attack_angle',
  'plane_angle',
  'avg_bat_speed',
  'time_to_contact',
  'on_plane_efficiency',
  'connection_at_contact',
  'rotational_acceleration',
] as const;

export function HittingTab(props: TabProps) {
  const { player, topMetrics, reports, isCoach, onRefresh, refreshKey } = props;
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<SubTabKey>('swing');

  // ── Shared state lifted from SwingTab so the grade bubble at the top of the
  //    Hitting tab stays visible (and live) regardless of which sub-tab is on. ──
  // The "active" HITTING report drives EVERY data derivation on this tab —
  // manual scores, diagnosis notes, miss%, spray-chart filtering. Defaults to
  // the latest report; ReportSelector's onSelect can swap it for any other.
  const [selectedHittingReport, setSelectedHittingReport] = useState<ReportSummary | null>(null);
  const latestHitting = useMemo(() => getLatestReport(reports, ['HITTING']), [reports]);
  const activeHittingReport = selectedHittingReport ?? latestHitting;
  const persistedManual = useMemo(() => getManualSwingScores(activeHittingReport), [activeHittingReport]);
  // Multi-select option tags ("Drift" / "+Stack" / "Tall"...) saved with each
  // manual score on the active HITTING report — edited inline in the Coach
  // Grades section so coaches can pick descriptive labels alongside the bars.
  const persistedManualOptions = useMemo(() => getManualSwingOptions(activeHittingReport), [activeHittingReport]);
  const reportUploadIds = useMemo(() => getReportUploadIds(activeHittingReport), [activeHittingReport]);

  const [manual, setManual] = useState<ManualSwingScores>(persistedManual);
  useEffect(() => { setManual(persistedManual); }, [persistedManual]);
  const [manualOptions, setManualOptions] = useState<ManualSwingOptions>(persistedManualOptions);
  useEffect(() => { setManualOptions(persistedManualOptions); }, [persistedManualOptions]);

  const persistedDiagnosisNotes = useMemo(() => {
    if (!activeHittingReport?.content) return '';
    try {
      const c = JSON.parse(activeHittingReport.content);
      return typeof c.diagnosisNotes === 'string' ? c.diagnosisNotes : '';
    } catch { return ''; }
  }, [activeHittingReport]);
  const [diagnosisNotes, setDiagnosisNotes] = useState(persistedDiagnosisNotes);
  useEffect(() => { setDiagnosisNotes(persistedDiagnosisNotes); }, [persistedDiagnosisNotes]);

  // Miss% from Full Swing CSV (column Q SquaredUp = null → miss)
  const [fullSwingMissPct, setFullSwingMissPct] = useState<number | null>(null);
  useEffect(() => {
    if (!player?.id) return;
    const ids = reportUploadIds.length > 0 ? reportUploadIds : undefined;
    api.getSessionData(player.id, 'FULL_SWING', ['bat_speed', 'squared_up_pct'], ids ? { uploadIds: ids } : undefined)
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
    const lowerIsBetter = new Set([
      'time_to_contact',
      'overall_whiff_pct', 'fb_whiff_pct', 'os_whiff_pct',
      'overall_chase_pct', 'fb_chase_pct', 'os_chase_pct',
      'overall_k_pct',
    ]);
    let cancelled = false;
    Promise.all(hittingReports.map(async (r) => {
      const ids = getReportUploadIds(r);
      if (ids.length === 0) return [r.id, null] as const;
      try {
        const metrics = await api.getPlayerMetrics(player.id, { uploadIds: ids });
        const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
        for (const m of metrics) {
          const cur = top[m.metricType];
          const better = lowerIsBetter.has(m.metricType)
            ? (!cur || m.value < cur.value)
            : (!cur || m.value > cur.value);
          if (better) top[m.metricType] = { value: m.value, unit: m.unit, recordedAt: m.recordedAt };
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
        try { return !!JSON.parse(r.content)?.atBatAssessment?.metrics; } catch { return false; }
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

  /** Carry-forward chain: starting at the active report and walking back
   *  through older HITTING reports, take the first non-missing value per key.
   *  Layers on top of: at-bat assessment (lowest priority) → carry-forward
   *  HITTING values (override) → Miss% (highest). */
  const topMetricsWithMiss = useMemo(() => {
    const base: Record<string, { value: number; unit: string; recordedAt: string }> = { ...atBatMetrics };
    if (activeHittingReport) {
      const activeIdx = hittingReports.findIndex(r => r.id === activeHittingReport.id);
      if (activeIdx >= 0) {
        for (let i = activeIdx; i < hittingReports.length; i++) {
          const m = perReportMetrics.get(hittingReports[i].id);
          if (!m) continue;
          for (const [k, v] of Object.entries(m)) {
            base[k] = v;
          }
        }
      }
    }
    if (fullSwingMissPct !== null) {
      base.full_swing_miss_pct = {
        value: fullSwingMissPct, unit: '%', recordedAt: new Date().toISOString(),
      };
    }
    return base;
  }, [activeHittingReport, hittingReports, perReportMetrics, fullSwingMissPct, atBatMetrics]);

  const metricGrades: Record<string, number | null> = useMemo(() => {
    const out: Record<string, number | null> = {};
    SWING_METRIC_KEYS.forEach(k => { out[k] = metricToGrade(topMetricsWithMiss, k); });
    return out;
  }, [topMetricsWithMiss]);

  // Save flow (Coach Grades + Diagnosis Notes)
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const dirty = useMemo(() => {
    const manualDirty = (Object.keys(persistedManual) as (keyof ManualSwingScores)[])
      .some(k => persistedManual[k] !== manual[k]);
    const notesDirty = diagnosisNotes !== persistedDiagnosisNotes;
    // Compare option arrays by stringified content — order-stable since both
    // come from the same source (the report's saved order or empty []).
    const optionsDirty = (Object.keys(persistedManualOptions) as (keyof ManualSwingOptions)[])
      .some(k => JSON.stringify(persistedManualOptions[k] ?? []) !== JSON.stringify(manualOptions[k] ?? []));
    return manualDirty || notesDirty || optionsDirty;
  }, [persistedManual, manual, diagnosisNotes, persistedDiagnosisNotes, persistedManualOptions, manualOptions]);

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
      };
      await api.createReport({
        playerId: player.id,
        createdById: userId,
        reportType: 'HITTING',
        title: activeHittingReport?.notes ? undefined : 'Swing Mechanics Update',
        content: JSON.stringify(newContent),
        notes: activeHittingReport?.notes ?? undefined,
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
    dirty, saving, saveOk, saveError, saveManual,
  };

  // Sub-tab nav rendered INSIDE the shared bubble at the top — pill-style buttons
  // so it reads obviously as a tab system at a glance.
  const subTabBar = (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: 4,
      borderRadius: 9,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border)',
      marginBottom: 6,
    }}>
      {SUB_TABS.map(t => {
        const active = subTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key)}
            style={{
              flex: 1,
              padding: '8px 14px',
              borderRadius: 7,
              background: active
                ? 'linear-gradient(135deg, rgba(126,182,255,0.28), rgba(61,139,253,0.16))'
                : 'transparent',
              border: active
                ? '1px solid rgba(126,182,255,0.55)'
                : '1px solid transparent',
              color: active ? '#cfe0ff' : 'var(--text-muted)',
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: active ? '0 0 12px rgba(126,182,255,0.18) inset' : 'none',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <TabBarActions>
        <AddReportButton onClick={props.onNewReport} show={isCoach} />
        <EditProfileButton onClick={props.onEditProfile} show={!isCoach} />
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
          onDownload={(r) => generateHittingPdf(player, [r], topMetrics)}
        />
      </TabBarActions>

      {/* ── Top row: Spray Chart (left) + shared big bubble (right) ── */}
      <Section>
        {/* Outer bubble wrapping the Hitting Snapshot header + spray chart +
            grade bars + diagnosis notes — header sits INSIDE the bubble.
            Uses the shared profilePanel chrome so every player-profile
            tab reads with the same elevated-card treatment. */}
        <div className={aStyles.profilePanel}>
        <SectionHeader
          icon={<HittingSnapshotIcon />}
          iconColor="gold"
          title="Hitting Snapshot"
        />
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'stretch',
        }}>
          {/* Left — spray chart */}
          <div style={{ flex: '1 1 460px', minWidth: 320, maxWidth: 540 }}>
            <SprayChartView
              playerId={player.id}
              refreshKey={refreshKey}
              reportUploadIds={reportUploadIds}
              compact
            />
          </div>
          {/* Right — Big 3 grade stack with sub-tab nav inside */}
          <div style={{ flex: '1 1 360px', minWidth: 320, display: 'flex' }}>
            <HittingGradeStack
              topMetrics={topMetricsWithMiss}
              manual={manual}
              metricGrades={metricGrades}
              isCoach={isCoach}
              diagnosisNotes={diagnosisNotes}
              setDiagnosisNotes={setDiagnosisNotes}
              subTabBar={subTabBar}
              subTab={subTab}
            />
          </div>
        </div>
        </div>{/* /outer snapshot bubble */}
      </Section>

      {/* ── Sub-tab content ── */}
      {/* Override topMetrics with the report-scoped version so both sub-tabs
          (Swing's Full Swing/Blast grids and Swing Decision's discipline grids)
          reflect the selected HITTING report's session, not the all-time max. */}
      {subTab === 'swing'    && <SwingTab    {...props} topMetrics={topMetricsWithMiss} shared={shared} />}
      {subTab === 'decision' && <SwingDecisionTab {...props} topMetrics={topMetricsWithMiss} />}
    </>
  );
}
