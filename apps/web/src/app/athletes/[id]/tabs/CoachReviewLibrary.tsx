'use client';

/**
 * CoachReviewLibrary — full-page list of every Coach Review clip
 * captured for one athlete. Lives at the Videos tab's "Coach Review"
 * sub-tab.
 *
 * A "Coach Review" is any video uploaded by the in-modal narration
 * recorder (the Record button inside a VideoBundleModal). Those
 * clips are tagged at upload time with a `Coach Review — …` title
 * prefix; this view filters every player video by that prefix and
 * renders the result through the same grey-bubble + category-border
 * VideoBundleCard shell every other gallery on the profile uses.
 *
 * No additional API call — reads from the `videos` array that
 * arrives via TabProps (same shape every tab consumes).
 */

import { useMemo } from 'react';
import { Section, SectionHeader, VideoBundleCard } from '@/components/assessment';
import { bundleVideos, normalizeVideoTitle } from '@/lib/video-titles';
import type { TabProps } from '../helpers';

export function CoachReviewLibrary({
  player, videos, reports, onRefresh,
}: TabProps) {
  /* Coach Reviews only. Detection matches the same prefix the
     bundle modal's Record-and-save flow stamps on uploads, plus
     the legacy `Coach Reviewed` prefix that older clips carry.
     READY-only + newest-first so in-progress uploads don't render
     as broken tiles and the freshest review reads first. */
  const coachReviews = useMemo(() => (
    videos
      .filter((v) => v.status === 'READY')
      .filter((v) => normalizeVideoTitle(v.title || '').startsWith('Coach Review'))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  ), [videos]);

  const bundled = useMemo(() => bundleVideos(coachReviews), [coachReviews]);

  return (
    <Section>
      <SectionHeader
        title="Coach Reviews"
        subtitle={`${coachReviews.length} review${coachReviews.length === 1 ? '' : 's'} captured`}
      />

      {coachReviews.length === 0 ? (
        <div style={{
          color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic',
          padding: '20px 0',
        }}>
          No Coach Reviews yet. Open any video bubble and press
          <span style={{ color: 'var(--text)', margin: '0 4px' }}>● Record</span>
          to narrate over the visible angles + drawings; the saved
          clip will land here.
        </div>
      ) : (
        /* Same 5-col fluid grid the rest of the app uses for video
           galleries. Each Coach Review renders via VideoBundleCard
           — grey bubble, category-colored border, white text.
           Bundled in case a recorded Coach Review ever carries
           multiple angles (rare; usually a single composite). */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gridAutoRows: 'max-content',
          gap: 12,
        }}>
          {bundled.map((b) => {
            const cardVideos = b.videos.map((v) => ({
              id: v.id,
              title: v.title,
              category: v.category,
              createdAt: v.createdAt,
              originalUrl: v.hlsUrl || v.originalUrl,
            }));
            return (
              <VideoBundleCard
                key={b.key}
                videos={cardVideos}
                size="md"
                playerId={player.id}
                recordingCategory={b.videos[0].category}
                onUploaded={onRefresh}
                /* Forward the athlete's full report list so the
                   bundle modal's Record-and-save flow surfaces the
                   "Attach to Report" dropdown here too — same UX
                   the Hitting / Pitching / Defense per-tab Coach
                   Reviews bubbles already get. Without this prop
                   the dropdown auto-hides (per `AttachableReport[]`
                   contract on VideoBundleModalProps). */
                reports={reports}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}
