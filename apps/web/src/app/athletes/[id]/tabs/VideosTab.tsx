'use client';

import { useState, useEffect } from 'react';
import type { ReportSummary } from '../helpers';
import { TabBarActions, EditProfileButton, ReportSelector, DownloadPdfButton, VideosIconButton } from '@/components/assessment';
import type { TabProps } from '../helpers';
import { CoachReviewLibrary } from './CoachReviewLibrary';
import { AllVideosLibrary } from './AllVideosLibrary';
import { generateSummaryPdf } from '@/lib/pdf';

/* `all-videos` is the default landing sub-tab — the destination
   every per-tab Videos button (next to Download) routes to.
   `coach-review` filters the same player video pool down to just
   the in-modal narration captures. The old "Coaching Studio"
   authoring tab was retired because its features (mic-narrated
   recording, drawing tools, sync/unsync grid playback,
   compare-with-other-video) all live inside the regular video
   bubble modal now. */
const SUB_TABS = [
  { key: 'all-videos',   label: 'All Videos' },
  { key: 'coach-review', label: 'Coach Review' },
] as const;

type SubKey = (typeof SUB_TABS)[number]['key'];

export function VideosTab(props: TabProps) {
  const [sub, setSub] = useState<SubKey>('all-videos');
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  /* Coaching Studio sub-tab was retired — its authoring features
     now live inside the regular video bundle modal. If a stale
     session still has `sub === 'studio'` (e.g., from a tab toggle
     before the Studio was removed), bounce back to All Videos. */
  useEffect(() => {
    if (!SUB_TABS.some((t) => t.key === sub)) {
      setSub('all-videos');
    }
  }, [sub]);

  /* Sync the selected report with the parent's fresh `reports` array
     after every save. Without this, local state holds the PRE-save
     snapshot — the PDF download / per-row download below would
     generate from stale content (videos removed in the modal would
     still appear, freshly-added ones would be missing) until the
     user re-picks the report from the dropdown. */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = props.reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [props.reports]);

  return (
    <>
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        <EditProfileButton onClick={props.onEditProfile} show={!props.isCoach} />
        {/* Top-level Download PDF — generates a player-summary-style
            PDF for the currently selected COACHING report. Coaching
            reports don't have a dedicated PDF generator, so the
            Summary template is reused; per-row dropdown downloads use
            the same generator. Mirrors the Hitting tab's pattern. */}
        <DownloadPdfButton
          onDownload={async () => {
            if (!selectedReport) return;
            await generateSummaryPdf(props.player, [selectedReport], props.topMetrics);
          }}
          disabled={!selectedReport}
        />
        {/* Videos jump — kept on this tab for visual consistency with
            the other tabs' action bars. On-click is a no-op effectively
            (we're already viewing the Videos tab). */}
        <VideosIconButton onClick={props.onOpenVideos} />
        <ReportSelector
          reports={props.reports}
          reportTypes={['COACHING']}
          label="Coaching"
          isCoach={props.isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={props.onRefresh}
          onNewReport={props.onNewReport}
          onEdit={props.onEditReport}
          onDownload={(r) => generateSummaryPdf(props.player, [r], props.topMetrics)}
        />
      </TabBarActions>

      {/* Sub-tab bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--border)',
        marginBottom: 24,
      }}>
        {SUB_TABS.map(t => {
          const isActive = sub === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 22px',
                cursor: 'pointer',
                transition: 'color 0.15s ease, border-color 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'all-videos' && (
        <AllVideosLibrary {...props} />
      )}
      {sub === 'coach-review' && (
        <CoachReviewLibrary {...props} />
      )}
    </>
  );
}
