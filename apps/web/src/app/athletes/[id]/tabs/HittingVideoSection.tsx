'use client';

/**
 * HittingVideoSection — sits under the Hitting Snapshot's Diagnosis
 * Notes. Lists every playable video tied to the active hitting report
 * (or all HITTING-category videos as a fallback), letting the coach or
 * athlete pick one to play OR hit "▶ Play All" to loop the whole
 * session in sequence.
 *
 * Design choices:
 *   - Filter mirrors PitchingTab / CatchingTab: report.videoIds wins,
 *     category === 'HITTING' is the fallback when no explicit link.
 *   - Self-contained playlist state — `currentIdx` + `playlistMode`
 *     drive both manual click-to-play and Play-All looping.
 *   - On video `ended`, if playlistMode is on we advance to the next
 *     index (wrapping back to 0 after the last one). User clicks the
 *     overlay ✕ to stop.
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { Video } from '@/lib/api';
import styles from './hitting-video-section.module.css';

export interface HittingVideoSectionProps {
  /** All videos that belong to the focal player. Filtered down to the
   *  active report's session inside this component. */
  videos: Video[];
  /** IDs explicitly attached to the active hitting report. Take priority
   *  over the category-fallback list. */
  reportVideoIds: string[];
  /** Optional date-range subtitle (e.g. "2026-05-01 – 2026-05-11"). */
  dateLabel?: string;
}

export function HittingVideoSection({
  videos, reportVideoIds, dateLabel,
}: HittingVideoSectionProps) {
  // Scoped to the current report's session.
  const sessionVideos = useMemo(() => {
    const playable = videos.filter(
      (v) => (v.originalUrl || v.hlsUrl) && (v.status === 'READY' || v.status == null),
    );
    if (reportVideoIds.length > 0) {
      const linked = playable.filter((v) => reportVideoIds.includes(v.id));
      if (linked.length > 0) return linked;
    }
    // Fallback: every HITTING-category video on the player. Mirrors the
    // pitching/catching tabs' behavior so the section never goes empty
    // just because the coach forgot to link videos to the report.
    return playable
      .filter((v) => v.category === 'HITTING')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [videos, reportVideoIds]);

  // Playlist state — null = closed, otherwise the index into sessionVideos.
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [playlistMode, setPlaylistMode] = useState(false);

  const close = useCallback(() => {
    setCurrentIdx(null);
    setPlaylistMode(false);
  }, []);

  const playOne = (idx: number) => {
    setPlaylistMode(false);
    setCurrentIdx(idx);
  };

  const playAll = () => {
    if (sessionVideos.length === 0) return;
    setPlaylistMode(true);
    setCurrentIdx(0);
  };

  // Advance to next video when in playlist mode. Wraps to 0 after the
  // last one so the session "loops" until the user closes the modal —
  // matches the user's spec ("Play All… loop through all videos").
  const handleEnded = () => {
    if (!playlistMode || currentIdx === null) {
      close();
      return;
    }
    const next = (currentIdx + 1) % sessionVideos.length;
    setCurrentIdx(next);
  };

  const goNext = () => {
    if (currentIdx === null || sessionVideos.length === 0) return;
    setCurrentIdx((currentIdx + 1) % sessionVideos.length);
  };
  const goPrev = () => {
    if (currentIdx === null || sessionVideos.length === 0) return;
    setCurrentIdx((currentIdx - 1 + sessionVideos.length) % sessionVideos.length);
  };

  // Esc to close the player.
  useEffect(() => {
    if (currentIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, sessionVideos.length, playlistMode]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (currentIdx === null) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [currentIdx]);

  const playing = currentIdx !== null ? sessionVideos[currentIdx] ?? null : null;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Session Video</div>
          <div className={styles.subtitle}>
            {sessionVideos.length === 0
              ? 'No videos attached to this session.'
              : `${sessionVideos.length} clip${sessionVideos.length === 1 ? '' : 's'}${dateLabel ? ` · ${dateLabel}` : ''}`}
          </div>
        </div>
        {/* Play All is always rendered so the affordance is obvious even
            in single-clip or empty sessions. Disabled when there are no
            playable clips; the title attribute explains why so the user
            knows it's not broken, just empty. */}
        <button
          type="button"
          className={styles.playAllBtn}
          onClick={playAll}
          disabled={sessionVideos.length === 0}
          title={
            sessionVideos.length === 0
              ? 'No videos attached to this session yet.'
              : sessionVideos.length === 1
                ? 'Play the only clip in this session.'
                : 'Play every clip in sequence; loops back to the first when the last ends.'
          }
        >
          ▶ Play All
        </button>
      </div>

      {sessionVideos.length === 0 ? null : (
        <div className={styles.grid}>
          {sessionVideos.map((v, i) => {
            const url = v.originalUrl || v.hlsUrl;
            const date = v.createdAt
              ? new Date(v.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : '';
            return (
              <button
                key={v.id}
                type="button"
                className={styles.card}
                onClick={() => playOne(i)}
                disabled={!url}
                title={url ? 'Click to play' : 'No playable URL'}
              >
                <div className={styles.thumb}>
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnailUrl} alt={v.title} className={styles.thumbImg} />
                  ) : (
                    <span className={styles.thumbIcon}>🎬</span>
                  )}
                  <span className={styles.playOverlay}>▶</span>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardTitle}>{v.title}</div>
                  <div className={styles.cardMeta}>
                    {v.category}{date ? ` · ${date}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Inline modal player — supports Play All (auto-advance + loop) and
          manual prev/next. */}
      {playing && (
        <PlaylistModal
          video={playing}
          index={currentIdx ?? 0}
          total={sessionVideos.length}
          playlistMode={playlistMode}
          onClose={close}
          onEnded={handleEnded}
          onNext={goNext}
          onPrev={goPrev}
        />
      )}
    </div>
  );
}

/* ─── Modal player ────────────────────────────────────────────────── */

function PlaylistModal({
  video, index, total, playlistMode, onClose, onEnded, onNext, onPrev,
}: {
  video: Video;
  index: number;
  total: number;
  playlistMode: boolean;
  onClose: () => void;
  onEnded: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  // Reset loading state when the video URL changes (playlist advance).
  useEffect(() => { setLoadState('loading'); }, [video.id]);

  const url = video.originalUrl || video.hlsUrl || '';

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={styles.player}>
        <div className={styles.playerHead}>
          <div className={styles.playerTitle}>
            {video.title}
            {playlistMode && total > 1 && (
              <span className={styles.playerPos}>· {index + 1} of {total}</span>
            )}
          </div>
          <div className={styles.playerActions}>
            {total > 1 && (
              <>
                <button className={styles.navBtn} onClick={onPrev} title="Previous (←)">‹</button>
                <button className={styles.navBtn} onClick={onNext} title="Next (→)">›</button>
              </>
            )}
            <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">×</button>
          </div>
        </div>
        <div className={styles.playerBody}>
          {url ? (
            <video
              ref={videoRef}
              className={styles.playerVideo}
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={() => setLoadState('ready')}
              onError={() => setLoadState('error')}
              onEnded={onEnded}
              style={loadState === 'error' ? { display: 'none' } : undefined}
            />
          ) : (
            <div className={styles.playerEmpty}>No playable URL on this clip.</div>
          )}

          {loadState === 'loading' && (
            <div className={styles.playerOverlayMsg}>Loading video…</div>
          )}
          {loadState === 'error' && (
            <div className={styles.playerOverlayMsg}>
              Couldn&apos;t load this video.
              {playlistMode && total > 1 && (
                <button className={styles.skipBtn} onClick={onNext}>Skip →</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
