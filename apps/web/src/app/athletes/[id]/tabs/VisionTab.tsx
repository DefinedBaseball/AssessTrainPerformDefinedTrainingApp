'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, NotesBox, ReportSelector,
  TabBarActions, AddReportButton, EditProfileButton,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  getReportUploadIds, metricToGrade, scoreColor,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { generateVisionPdf } from '@/lib/pdf';

const REPORT_TYPES = ['COGNITION'];

export function VisionTab({
  player, topMetrics, isCoach, onRefresh, reports, refreshKey, onNewReport, onEditReport, onEditProfile,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Per-COGNITION-report metrics index — used for carry-forward fallback so a
  // missing metric on the active report is filled from the previous report
  // (chronologically), NOT from the player's all-time max.
  const cognitionReports = useMemo(
    () => reports.filter(r => REPORT_TYPES.includes(r.reportType))
                 .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const [perReportMetrics, setPerReportMetrics] = useState<Map<string, Record<string, { value: number; unit: string; recordedAt: string }>>>(new Map());
  useEffect(() => {
    if (!player?.id || cognitionReports.length === 0) {
      setPerReportMetrics(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(cognitionReports.map(async (r) => {
      const ids = getReportUploadIds(r);
      if (ids.length === 0) return [r.id, null] as const;
      try {
        const metrics = await api.getPlayerMetrics(player.id, { uploadIds: ids });
        const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
        for (const m of metrics) {
          if (!top[m.metricType] || m.value > top[m.metricType].value) {
            top[m.metricType] = { value: m.value, unit: m.unit, recordedAt: m.recordedAt };
          }
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
  }, [player?.id, refreshKey, cognitionReports]);

  /** Carry-forward chain — start at the active report, walk back through
   *  earlier COGNITION reports for any keys missing on the active one. */
  const activeReport = selectedReport ?? cognitionReports[0] ?? null;
  const activeMetrics = useMemo(() => {
    const result: Record<string, { value: number; unit: string; recordedAt: string }> = {};
    if (!activeReport) return result;
    const activeIdx = cognitionReports.findIndex(r => r.id === activeReport.id);
    if (activeIdx < 0) return result;
    for (let i = activeIdx; i < cognitionReports.length; i++) {
      const m = perReportMetrics.get(cognitionReports[i].id);
      if (!m) continue;
      for (const [k, v] of Object.entries(m)) {
        if (!(k in result)) result[k] = v;
      }
    }
    return result;
  }, [activeReport, cognitionReports, perReportMetrics]);
  const visionMetrics = getTabMetrics(activeMetrics, TAB_METRICS.vision);
  const hasData = Object.keys(visionMetrics).length > 0;

  return (
    <>
      {/* ── Report Selector + Download (portaled into TabBar) ── */}
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Cognition"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateVisionPdf(player, [r], topMetrics)}
        />
      </TabBarActions>

      {/* ── Vision Scores ── */}
      <Section>
        <SectionHeader icon="👁️" iconColor="gold" title="Vizual Edge Assessment" subtitle="Visual performance metrics" />
        {hasData ? (
          <>
            <KpiGrid>
              {TAB_METRICS.vision.map(key => {
                const m = visionMetrics[key];
                if (!m) return null;
                const level = getBadgeLevel(key, m.value);
                const grade = metricToGrade(activeMetrics, key);
                return (
                  <KpiCard
                    key={key}
                    label={METRIC_LABELS[key] || key}
                    value={m.value.toFixed(0)}
                    badge={getBadgeText(level) || undefined}
                    badgeLevel={level}
                    color={grade !== null ? scoreColor(grade) : undefined}
                  />
                );
              })}
            </KpiGrid>

            {/* Score Bars */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {TAB_METRICS.vision.map(key => {
                const m = visionMetrics[key];
                if (!m) return null;
                const level = getBadgeLevel(key, m.value);
                return (
                  <ScoreBar
                    key={key}
                    label={METRIC_LABELS[key]}
                    value={m.value.toFixed(0)}
                    percent={m.value}
                    level={level as any}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.emptyMsg}>
            No Vizual Edge data available.
            <span className={styles.emptyHint}>
              {isCoach ? 'Upload a Vizual Edge CSV above.' : 'Ask your coach to upload vision assessment data.'}
            </span>
          </div>
        )}
      </Section>

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Visual tracking strengths, areas for improvement, and training focus.', placeholder: true },
              { text: 'Recommended vision drills and exercises.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="green" title="Coaching Notes" />
            <NotesBox label="COGNITION ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

    </>
  );
}
