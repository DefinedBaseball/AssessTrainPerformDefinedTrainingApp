'use client';

import { useEffect, useMemo, useState } from 'react';
import { SwingTab, HittingGradeStack, type SharedHittingState } from './SwingTab';
import { SwingDecisionTab } from './SwingDecisionTab';
import { TabBarActions, AddReportButton, Section, SectionHeader, ReportSelector } from '@/components/assessment';
import { SprayChartView } from '../components/SprayChartView';
import { generateHittingPdf } from '@/lib/pdf';
import {
  TabProps,
  getLatestReport, getReportUploadIds, getManualSwingScores,
  metricToGrade,
  type ManualSwingScores,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const SUB_TABS = [
  { key: 'swing',    label: 'Swing' },
  { key: 'decision', label: 'Swing Decision' },
] as const;

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
  const reportUploadIds = useMemo(() => getReportUploadIds(activeHittingReport), [activeHittingReport]);

  const [manual, setManual] = useState<ManualSwingScores>(persistedManual);
  useEffect(() => { setManual(persistedManual); }, [persistedManual]);

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

  /** Carry-forward chain: starting at the active report and walking back
   *  through older HITTING reports, take the first non-missing value per key.
   *  No fallback to all-time topMetrics — if no report has the metric, the
   *  key stays absent and the UI renders "—". Miss% is layered on top. */
  const topMetricsWithMiss = useMemo(() => {
    const base: Record<string, { value: number; unit: string; recordedAt: string }> = {};
    if (activeHittingReport) {
      const activeIdx = hittingReports.findIndex(r => r.id === activeHittingReport.id);
      if (activeIdx >= 0) {
        for (let i = activeIdx; i < hittingReports.length; i++) {
          const m = perReportMetrics.get(hittingReports[i].id);
          if (!m) continue;
          for (const [k, v] of Object.entries(m)) {
            if (!(k in base)) base[k] = v;
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
  }, [activeHittingReport, hittingReports, perReportMetrics, fullSwingMissPct]);

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
    return manualDirty || notesDirty;
  }, [persistedManual, manual, diagnosisNotes, persistedDiagnosisNotes]);

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
            grade bars + diagnosis notes — header sits INSIDE the bubble. */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}>
        <SectionHeader
          icon="🏏"
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
