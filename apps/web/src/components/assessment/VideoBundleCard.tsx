'use client';

/**
 * VideoBundleCard — gallery card for a single video OR a multi-angle bundle.
 * Always one square. Matches the Dashboard announcement video treatment:
 *
 *   • The video preview FILLS the entire bubble (object-fit: cover).
 *   • The bubble frame is the sport-category color (Hitting blue, Pitching
 *     orange, Catching teal, Infield/Outfield green, S&C red).
 *   • A thin BLACK bar across the TOP holds the video label (white text).
 *   • A BLACK bar across the BOTTOM holds the date + number of videos.
 *
 * Click opens VideoBundleModal (synced grid playback) for both singletons and
 * bundles.
 */

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { VideoBundleModal, type AttachableReport } from './VideoBundleModal';
import { getVideoCategoryColors } from '@/lib/training-colors';
import { formatBubbleLabel, normalizeVideoTitle } from '@/lib/video-titles';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';

/* Session-scoped tombstone of deleted video ids. The card hides itself the
   instant a delete succeeds, but local state resets if the gallery remounts
   (e.g. a profile tab switch) while the parent still holds the now-stale
   list — so a remounted card checks this set and stays hidden until a real
   refetch/reload (the server delete is the source of truth). */
const deletedVideoIds = new Set<string>();

export interface BundleVideo {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  originalUrl?: string | null;
}

interface VideoBundleCardProps {
  /** Every video in this card. Length === 1 → singleton; 2+ → bundle. */
  videos: BundleVideo[];
  /** Optional label override for the top bar. Defaults to the first video's
   *  formatted bubble label (e.g. `Hitting - Training - Tee`). */
  label?: string;
  /** Tile size — controls the max width of the square. */
  size?: 'sm' | 'md' | 'lg';
  playerId?: string;
  recordingCategory?: string;
  /** Fires after the bundle modal uploads a Coach Review clip. */
  onUploaded?: () => void;
  /** Reports the coach can attach a recorded Coach Review to. */
  reports?: AttachableReport[];
  /** Optional secondary text shown before the date in the bottom bar
   *  (the global Video library uses it for the athlete's name). */
  subtitle?: string;
  /** When true, the top label bar is suppressed. */
  hideLabel?: boolean;
  /** Fires after this bubble's video(s) are deleted, so a parent can resync
   *  its own list/counts. Deletion already works without it (the card hides
   *  itself + tombstones the ids), so it's optional. */
  onDeleted?: () => void;
}

export function VideoBundleCard({
  videos,
  label,
  size = 'md',
  playerId,
  recordingCategory,
  onUploaded,
  reports,
  subtitle,
  hideLabel = false,
  onDeleted,
}: VideoBundleCardProps) {
  const [open, setOpen] = useState(false);
  const { isCoach } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  if (videos.length === 0) return null;
  // Hidden once deleted (this mount) or tombstoned (a prior delete this session).
  if (deleted || videos.every((v) => deletedVideoIds.has(v.id))) return null;

  const first = videos[0];
  const displayLabel = label || formatBubbleLabel({ title: first.title || '', category: first.category });
  const dateStr = new Date(first.createdAt).toLocaleDateString();
  const colors = getVideoCategoryColors(first.category);
  const count = videos.length;
  const maxWidth = size === 'sm' ? 180 : size === 'lg' ? 280 : 240;

  /* Bar treatment: regular clips get WHITE bars + BLACK text; Coach Review
     clips get BLACK bars + WHITE text — so a coach's narrated review stands
     out from the gallery. Every bubble renders its bars + text 20% larger
     (s = 1.2). */
  const isCoachReview = videos.some((v) => normalizeVideoTitle(v.title || '').startsWith('Coach Review'));
  const s = 1.2;

  /* Inline styles bypass the build-time px→rem pass (postcss-pxtorem only
     sees CSS files), so font sizes here are converted by hand: rem against
     the 15px design base keeps this card's text tracking the fluid root
     font-size like the rest of the app. */
  const rem = (px: number) => `${(px / 15).toFixed(4)}rem`;

  /* Shared overlay-bar base for the top label + bottom date/count. */
  const barBase: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    background: isCoachReview ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.95)',
    color: isCoachReview ? '#ffffff' : '#000000',
    zIndex: 2,
    pointerEvents: 'none',
  };

  /* Download the previewed clip. Fetches the file as a blob so the browser
     forces a "Save" (works cross-origin when the host sends CORS); falls back
     to a direct anchor / new-tab open otherwise. stopPropagation keeps the
     click from opening the playback modal. */
  const handleDownload = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    const url = first.originalUrl;
    if (!url) return;
    const ext = (url.split('?')[0].split('.').pop() || 'mp4').slice(0, 5);
    const safe = (first.title || 'video').replace(/[^\w.-]+/g, '_') || 'video';
    const filename = `${safe}.${ext}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    } catch {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  /* Delete this bubble's video(s). A bundle (multi-angle) deletes every angle
     since the bubble is the unit. Tombstone the ids + hide immediately; the
     server delete makes it permanent. */
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await Promise.all(videos.map((v) => api.deleteVideo(v.id)));
      videos.forEach((v) => deletedVideoIds.add(v.id));
      setDeleted(true);
      onDeleted?.();
    } catch {
      window.alert('Could not delete the video. Please try again.');
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth,
          aspectRatio: '1 / 1',
          /* Sport-category frame color (Hitting blue, Pitching orange, …). */
          border: `2px solid ${colors.border}`,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#000',
          cursor: 'pointer',
        }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
        }}
        title={displayLabel}
      >
        {/* Video preview — fills the entire bubble. */}
        {first.originalUrl ? (
          <video
            src={first.originalUrl}
            preload="metadata"
            muted
            playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
          />
        ) : null}

        {/* Download button — top-right corner, downloads this clip. */}
        {first.originalUrl && (
          <button
            type="button"
            onClick={handleDownload}
            onKeyDown={(e) => e.stopPropagation()}
            title="Download video"
            aria-label="Download video"
            style={{
              position: 'absolute',
              top: 28,
              right: 5,
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.5)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 3,
              padding: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.5v7" />
              <path d="M4.5 6.5 8 10l3.5-3.5" />
              <path d="M3 13.5h10" />
            </svg>
          </button>
        )}

        {/* Delete ✕ — very top-right (above the download button). COACH only.
            Opens the inline confirm overlay below. stopPropagation so the
            click doesn't open the playback modal. */}
        {isCoach && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            onKeyDown={(e) => e.stopPropagation()}
            title="Delete video"
            aria-label="Delete video"
            style={{
              position: 'absolute',
              top: 5,
              right: 5,
              width: 22,
              height: 22,
              borderRadius: 7,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.5)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 4,
              padding: 0,
              fontSize: rem(13),
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}

        {/* Top black bar — video label (white). */}
        {!hideLabel && (
          <div
            style={{
              ...barBase,
              top: 0,
              padding: `${rem(3 * s)} ${rem(8 * s)}`,
              fontSize: rem(9 * s),
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayLabel}
          </div>
        )}

        {/* Central play indicator — clickable cue. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.55)',
            border: '2px solid rgba(255,255,255,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: rem(16),
            color: '#ffffff',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          ▶
        </div>

        {/* Bottom black bar — date + number of videos. */}
        <div
          style={{
            ...barBase,
            bottom: 0,
            padding: `${rem(3 * s)} ${rem(8 * s)}`,
            fontSize: rem(10 * s),
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1.3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle ? `${subtitle} · ` : ''}{dateStr}
          </span>
          <span style={{ flexShrink: 0 }}>{count} {count === 1 ? 'video' : 'videos'}</span>
        </div>

        {/* Inline delete confirmation — covers the bubble. stopPropagation on
            the overlay + buttons so nothing reaches the card's open-modal click. */}
        {confirming && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              background: 'rgba(0,0,0,0.80)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: rem(10),
              padding: rem(12),
              textAlign: 'center',
            }}
          >
            <span style={{ color: '#ffffff', fontSize: rem(12 * s), fontWeight: 600, lineHeight: 1.3 }}>
              Would you like to delete this video?
            </span>
            <div style={{ display: 'flex', gap: rem(8) }}>
              <button
                type="button"
                disabled={deleting}
                onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
                style={{
                  padding: `${rem(5)} ${rem(16)}`,
                  borderRadius: 6,
                  border: '1px solid #dc2626',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: rem(11 * s),
                  cursor: deleting ? 'wait' : 'pointer',
                }}
              >
                {deleting ? '…' : 'Yes'}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
                style={{
                  padding: `${rem(5)} ${rem(16)}`,
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: rem(11 * s),
                  cursor: 'pointer',
                }}
              >
                No
              </button>
            </div>
          </div>
        )}
      </div>

      {open && (
        <VideoBundleModal
          videos={videos}
          label={displayLabel}
          onClose={() => setOpen(false)}
          playerId={playerId}
          recordingCategory={recordingCategory}
          onUploaded={onUploaded}
          reports={reports}
        />
      )}
    </>
  );
}
