'use client';

import { rem } from '@/lib/rem';
import { useState } from 'react';
import styles from './assessment.module.css';
import { VideoPlayerModal } from './VideoPlayerModal';
import { normalizeVideoTitle as sharedNormalize } from '@/lib/video-titles';

interface VideoPlaceholderProps {
  tag: string;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
  videoUrl?: string | null;
  onClick?: () => void;
  /** When set, the opened VideoPlayerModal enables its Record
   *  button — captured narration clips auto-upload as a new Video
   *  under this player. Plumb from each tab so the recording
   *  attaches to the right athlete. */
  playerId?: string;
  /** Video.category stamp for recordings — defaults to the `tag`
   *  prop (which already carries 'HITTING' / 'PITCHING' / etc.
   *  from the tab that rendered the placeholder). */
  recordingCategory?: string;
}

const SIZE_CLASS = {
  sm: styles.videoSm,
  md: styles.videoMd,
  lg: styles.videoLg,
};

/* `normalizeVideoTitle` moved to `@/lib/video-titles` so both this
   placeholder component AND the bundling helper (`bundleVideos`)
   read the same canonical title shape. */
const normalizeVideoTitle = sharedNormalize;

export function VideoPlaceholder({ tag, title, subtitle, size = 'md', videoUrl, onClick, playerId, recordingCategory }: VideoPlaceholderProps) {
  const [playing, setPlaying] = useState(false);
  const hasVideo = !!videoUrl;
  /* Normalize the title up front so every downstream branch (coach-
     review detection, Live-At-Bat layout, displayed text in both the
     no-preview block and the footer overlay) sees the same rewritten
     string. Legacy "Live Session — ..." titles surface as the new
     "Training - ..." format on render without needing a DB migration. */
  const displayTitle = normalizeVideoTitle(title);
  /* Coach-review detection — clips uploaded by the in-modal review
     recorder are stamped with a `Coach Review —` title prefix. We
     render a distinct green tag chip + green dashed border to make
     those clips visually pop at the top of the gallery. The tab
     files independently sort coach-review clips to the front of
     the list. `startsWith('Coach Review')` matches BOTH the new
     `Coach Review` prefix and the legacy `Coach Reviewed` prefix
     so older clips remain detected after the rename. */
  const isCoachReviewed = displayTitle.startsWith('Coach Review');

  /* Live-At-Bat 3-line layout — titles like
     "Live At-Bat vs Cole Anderson" render as
       Line 1: "Live At-Bat"
       Line 2: "vs"
       Line 3: "Cole Anderson"
     in the footer overlay. Detection is regex-based so we only
     reshape titles that match the exact "Live At-Bat vs <name>"
     format; everything else falls through to the standard
     single-line render below. */
  const liveAtBatMatch = displayTitle.match(/^Live At-Bat\s+vs\s+(.+)$/);
  const liveAtBatLines = liveAtBatMatch
    ? ['Live At-Bat', 'vs', liveAtBatMatch[1]]
    : null;

  const handleClick = () => {
    if (hasVideo) {
      setPlaying(true);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <>
      <div
        className={`${styles.videoPlaceholder} ${SIZE_CLASS[size]} ${hasVideo ? styles.videoReady : ''}`}
        onClick={handleClick}
        /* Coach-reviewed tile gets a green dashed-rim accent so it
           reads as visually distinct from raw upload tiles at a
           glance. Solid green chip in the corner doubles down on
           the marker. */
        style={isCoachReviewed ? {
          borderStyle: 'solid',
          borderColor: 'rgba(74, 222, 128, 0.55)',
          boxShadow: '0 0 0 1px rgba(74, 222, 128, 0.18), 0 0 14px rgba(74, 222, 128, 0.15)',
        } : undefined}
      >
        {/* Inline preview — when we have a real video URL we mount a
            muted <video> element behind the overlay UI. `preload=
            'metadata'` makes the browser fetch just enough of the
            file to render the first frame as a poster, so every
            placeholder shows actual footage from the clip instead of
            an empty box. Click anywhere on the card still opens the
            full VideoPlayerModal via `handleClick` above. */}
        {hasVideo && (
          <video
            className={styles.vpPreview}
            src={videoUrl ?? undefined}
            preload="metadata"
            muted
            playsInline
            // Don't play the preview — we want a still frame poster so
            // the grid isn't a sea of moving thumbnails. Click-to-play
            // happens in the modal.
            // eslint-disable-next-line react/no-unknown-property
            disablePictureInPicture
          />
        )}
        {/* Tag chip pinned top-right — sits on top of the preview.
           Coach-review clips override the default chip with a green
           "Coach Review" badge so coaches can find their own
           reviews at a glance. */}
        {isCoachReviewed ? (
          <span
            className={styles.vpTag}
            style={{
              background: 'rgba(74, 222, 128, 0.92)',
              color: '#052e16',
              letterSpacing: '0.06em',
              padding: '2px 6px',
            }}
          >
            Coach Review
          </span>
        ) : (
          <span className={styles.vpTag}>{tag}</span>
        )}
        {/* Centered play icon — also pinned over the preview. */}
        <div className={hasVideo ? styles.vpIconReady : styles.vpIcon}>▶</div>
        {/* Title + subtitle stack — only meaningful when there's no
            preview to look at. With a real video showing, we let the
            footage speak for itself and rely on the player's modal
            for full context. The Live-At-Bat 3-line variant
            (`liveAtBatLines`) stacks each part on its own row so the
            opponent name reads cleanly under "vs" instead of trailing
            past the card edge. */}
        {!hasVideo && (liveAtBatLines
          ? liveAtBatLines.map((line, i) => <div key={i}>{line}</div>)
          : <div>{displayTitle}</div>
        )}
        {!hasVideo && subtitle && <div style={{ fontSize: rem(11), color: 'var(--faint)' }}>{subtitle}</div>}
        {/* When a preview IS showing, surface the title + subtitle in
            a translucent footer pinned to the bottom of the card so
            the metadata stays legible against the thumbnail. */}
        {hasVideo && (
          <div className={styles.vpFooter}>
            {liveAtBatLines
              ? liveAtBatLines.map((line, i) => (
                  <span key={i} className={styles.vpFooterTitle}>{line}</span>
                ))
              : <span className={styles.vpFooterTitle}>{displayTitle}</span>}
            {subtitle && <span className={styles.vpFooterSub}>{subtitle}</span>}
          </div>
        )}
      </div>

      {playing && videoUrl && (
        <VideoPlayerModal
          videoUrl={videoUrl}
          title={displayTitle}
          onClose={() => setPlaying(false)}
          playerId={playerId}
          /* `recordingCategory` defaults to the placeholder's `tag`
             (already 'HITTING' / 'PITCHING' / 'CATCHING' / etc.) so
             narrations file into the tab they were recorded from
             without each call site having to spell it out. */
          category={recordingCategory || tag}
        />
      )}
    </>
  );
}
