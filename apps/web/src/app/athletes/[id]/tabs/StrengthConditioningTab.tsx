'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips, NotesBox,
  ReportSelector,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES, scoreColor,
  getReportUploadIds,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { generateStrengthPdf } from '@/lib/pdf';
import { CustomCharts } from '@/components/CustomCharts';
import { TabBarActions, AddReportButton, EditProfileButton } from '@/components/assessment';

const REPORT_TYPES = ['STRENGTH'];

export function StrengthConditioningTab({
  player, topMetrics, isCoach, onRefresh, reports, refreshKey, onNewReport, onEditReport, onEditProfile,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Per-STRENGTH-report metrics index (carry-forward fallback — see HittingTab
  // for the same pattern). When the active report is missing a metric we walk
  // back through earlier reports rather than filling from the all-time max.
  const strengthReports = useMemo(
    () => reports.filter(r => REPORT_TYPES.includes(r.reportType))
                 .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const [perReportMetrics, setPerReportMetrics] = useState<Map<string, Record<string, { value: number; unit: string; recordedAt: string }>>>(new Map());
  useEffect(() => {
    if (!player?.id || strengthReports.length === 0) {
      setPerReportMetrics(new Map());
      return;
    }
    const lowerIsBetter = new Set(['sprint_60']);
    let cancelled = false;
    Promise.all(strengthReports.map(async (r) => {
      const ids = getReportUploadIds(r);
      if (ids.length === 0) return [r.id, null] as const;
      try {
        const metrics = await api.getPlayerMetrics(player.id, { uploadIds: ids });
        const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
        for (const m of metrics) {
          const isBetter = lowerIsBetter.has(m.metricType)
            ? (!top[m.metricType] || m.value < top[m.metricType].value)
            : (!top[m.metricType] || m.value > top[m.metricType].value);
          if (isBetter) top[m.metricType] = { value: m.value, unit: m.unit, recordedAt: m.recordedAt };
        }
        return [r.id, top] as const;
      } catch { return [r.id, null] as const; }
    })).then(entries => {
      if (cancelled) return;
      const next = new Map<string, Record<string, { value: number; unit: string; recordedAt: string }>>();
      for (const [id, m] of entries) if (m) next.set(id, m);
      setPerReportMetrics(next);
    });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey, strengthReports]);

  /** Carry-forward chain — start at active report, walk back through earlier
   *  STRENGTH reports filling missing keys; render "—" if no report has them. */
  const activeReport = selectedReport ?? strengthReports[0] ?? null;
  const activeMetrics = useMemo(() => {
    const result: Record<string, { value: number; unit: string; recordedAt: string }> = {};
    if (!activeReport) return result;
    const activeIdx = strengthReports.findIndex(r => r.id === activeReport.id);
    if (activeIdx < 0) return result;
    for (let i = activeIdx; i < strengthReports.length; i++) {
      const m = perReportMetrics.get(strengthReports[i].id);
      if (!m) continue;
      for (const [k, v] of Object.entries(m)) {
        if (!(k in result)) result[k] = v;
      }
    }
    return result;
  }, [activeReport, strengthReports, perReportMetrics]);
  const scMetrics = getTabMetrics(activeMetrics, TAB_METRICS.strengthCond);
  const hasData = Object.keys(scMetrics).length > 0;

  // Athletic testing keys with scouting grades
  const athleticKeys = ['jump_height', 'broad_jump', 'sprint_60'];
  const strengthKeys = ['squat_max', 'bench_max', 'deadlift_max', 'grip_strength_l', 'grip_strength_r'];
  const bodyKeys = ['body_weight', 'body_fat_pct'];

  const gradeKeys = athleticKeys.filter(k => activeMetrics[k] && GRADE_RANGES[k]);

  return (
    <>
      {/* ── Report Selector + Download (portaled into TabBar) ── */}
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Strength & Conditioning"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateStrengthPdf(player, [r], topMetrics)}
        />
      </TabBarActions>

      {/* ── Athletic Testing ── */}
      <Section>
        <SectionHeader icon="🏃" iconColor="teal" title="Athletic Testing" subtitle="Speed, power & explosiveness" />
        {hasData ? (
          <>
            <KpiGrid>
              {athleticKeys.map(key => {
                const m = scMetrics[key];
                if (!m) return null;
                const level = getBadgeLevel(key, m.value);
                const grade = GRADE_RANGES[key] ? toScoutingGrade(m.value, key) : null;
                return (
                  <KpiCard
                    key={key}
                    label={METRIC_LABELS[key] || key}
                    value={key === 'sprint_60' ? m.value.toFixed(2) : m.value.toFixed(1)}
                    unit={m.unit}
                    badge={getBadgeText(level) || undefined}
                    badgeLevel={level}
                    color={grade !== null ? scoreColor(grade) : undefined}
                  />
                );
              })}
            </KpiGrid>

            {/* Score Bars */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {scMetrics.jump_height && (
                <ScoreBar
                  label="Vertical Jump"
                  value={`${scMetrics.jump_height.value.toFixed(1)} in`}
                  percent={(scMetrics.jump_height.value / 40) * 100}
                  level={getBadgeLevel('jump_height', scMetrics.jump_height.value) as any}
                />
              )}
              {scMetrics.broad_jump && (
                <ScoreBar
                  label="Broad Jump"
                  value={`${scMetrics.broad_jump.value.toFixed(0)} in`}
                  percent={(scMetrics.broad_jump.value / 120) * 100}
                  level={getBadgeLevel('broad_jump', scMetrics.broad_jump.value) as any}
                />
              )}
              {scMetrics.sprint_60 && (
                <ScoreBar
                  label="60-Yard Sprint"
                  value={`${scMetrics.sprint_60.value.toFixed(2)} sec`}
                  percent={Math.max(0, 100 - ((scMetrics.sprint_60.value - 6.2) / 1.6) * 100)}
                  level={getBadgeLevel('sprint_60', scMetrics.sprint_60.value) as any}
                />
              )}
            </div>
          </>
        ) : (
          <div className={styles.emptyMsg}>
            No athletic testing data available.
            <span className={styles.emptyHint}>
              {isCoach ? 'Upload a VALD CSV above or enter data manually.' : 'Ask your coach to upload testing data.'}
            </span>
          </div>
        )}
      </Section>

      {/* ── Scouting Grades ── */}
      {gradeKeys.length > 0 && (
        <Section>
          <SectionHeader icon="📊" iconColor="green" title="Athletic Grades" subtitle="20-80 Scale" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div className={styles.gradeRow} style={{ background: 'var(--surface2)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-bright)' }}>
              <span>Tool</span>
              <span style={{ textAlign: 'center' }}>Value</span>
              <span style={{ textAlign: 'center' }}>Grade</span>
              <span>Scale</span>
            </div>
            {gradeKeys.map(key => {
              const m = activeMetrics[key];
              const grade = toScoutingGrade(m.value, key);
              return (
                <div key={key} className={styles.gradeRow}>
                  <span className={styles.gradeLabel}>{METRIC_LABELS[key]}</span>
                  <span className={styles.gradeValue} style={{ color: 'var(--accent-light)' }}>
                    {key === 'sprint_60' ? m.value.toFixed(2) : m.value.toFixed(1)}
                  </span>
                  <span className={styles.gradeValue}>{grade}</span>
                  <ScalePips grade={grade} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Strength Numbers ── */}
      {strengthKeys.some(k => scMetrics[k]) && (
        <Section>
          <SectionHeader icon="🏋️" iconColor="gold" title="Strength Metrics" subtitle="Max lifts & grip strength" />
          <KpiGrid>
            {strengthKeys.map(key => {
              const m = scMetrics[key];
              if (!m) return null;
              const grade = GRADE_RANGES[key] ? toScoutingGrade(m.value, key) : null;
              return (
                <KpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={m.value.toFixed(0)}
                  unit={m.unit}
                  color={grade !== null ? scoreColor(grade) : undefined}
                />
              );
            })}
          </KpiGrid>
        </Section>
      )}

      {/* ── Body Composition ── */}
      {bodyKeys.some(k => scMetrics[k]) && (
        <Section>
          <SectionHeader icon="📏" iconColor="teal" title="Body Composition" />
          <KpiGrid>
            {bodyKeys.map(key => {
              const m = scMetrics[key];
              if (!m) return null;
              const grade = GRADE_RANGES[key] ? toScoutingGrade(m.value, key) : null;
              return (
                <KpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={key === 'body_fat_pct' ? `${m.value.toFixed(1)}%` : m.value.toFixed(0)}
                  unit={key === 'body_fat_pct' ? undefined : m.unit}
                  color={grade !== null ? scoreColor(grade) : undefined}
                />
              );
            })}
          </KpiGrid>
        </Section>
      )}

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Physical development observations, movement quality, and training load notes.', placeholder: true },
              { text: 'Program adjustments and recovery recommendations.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="green" title="Coaching Notes" />
            <NotesBox label="STRENGTH & CONDITIONING ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      <CustomCharts section="STRENGTH" playerId={player.id} />

    </>
  );
}
