'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, NotesBox, ReportSelector, DownloadPdfButton,
  TabBarActions,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  getReportUploadIds,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { generateVisionPdf } from '@/lib/pdf';

const REPORT_TYPES = ['COGNITION'];

export function VisionTab({
  player, topMetrics, isCoach, onRefresh, reports, refreshKey,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  const [reportMetrics, setReportMetrics] = useState<Record<string, { value: number; unit: string; recordedAt: string }> | null>(null);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

  // When a report is selected, fetch metrics for that report's uploads
  useEffect(() => {
    if (!player?.id || reportUploadIds.length === 0) {
      setReportMetrics(null);
      return;
    }
    api.getPlayerMetrics(player.id, { uploadIds: reportUploadIds })
      .then(metrics => {
        // Build top metrics from the report's data (take max per metricType)
        const top: Record<string, { value: number; unit: string; recordedAt: string }> = {};
        for (const m of metrics) {
          if (!top[m.metricType] || m.value > top[m.metricType].value) {
            top[m.metricType] = { value: m.value, unit: m.unit, recordedAt: m.recordedAt };
          }
        }
        setReportMetrics(top);
      })
      .catch(() => setReportMetrics(null));
  }, [player?.id, reportUploadIds, refreshKey]);

  // Use report-specific metrics when a report is selected, otherwise global
  const activeMetrics = reportMetrics ?? topMetrics;
  const visionMetrics = getTabMetrics(activeMetrics, TAB_METRICS.vision);
  const hasData = Object.keys(visionMetrics).length > 0;

  return (
    <>
      {/* ── Report Selector + Download (portaled into TabBar) ── */}
      <TabBarActions>
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Vision"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
        <DownloadPdfButton
          label="Download PDF"
          onDownload={() => generateVisionPdf(player, reports, topMetrics)}
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
                return (
                  <KpiCard
                    key={key}
                    label={METRIC_LABELS[key] || key}
                    value={m.value.toFixed(0)}
                    badge={getBadgeText(level) || undefined}
                    badgeLevel={level}
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
            <NotesBox label="VISION ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

    </>
  );
}
