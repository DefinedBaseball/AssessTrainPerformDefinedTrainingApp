'use client';

/**
 * VideoBundleCard — gallery card for a single video OR a multi-angle
 * bundle. Always one square wide. Renders an "outside bubble" with:
 *
 *   • Top border eyebrow: bundle label (e.g. "Training - Hitting - Tee")
 *   • Middle: ONE video preview tile (the first angle for bundles).
 *       — for bundles, a count badge sits in the bottom-right corner
 *         of the tile.
 *   • Bottom: date below the tile, still inside the bubble.
 *
 * Click → for singletons, opens the standard single-video player modal.
 * Click → for bundles, opens VideoBundleModal (synced grid playback).
 */

import { useState } from 'react';
import { VideoBundleModal, type AttachableReport } from './VideoBundleModal';
/* VideoPlayerModal import retired — singletons + bundles now both
   route through VideoBundleModal so the single-clip view inherits
   the bundle modal's full-page chrome (scrubber, frame-step, speed,
   record, compare, drawing tools). */
import { getVideoCategoryColors } from '@/lib/training-colors';
import { splitVideoTitle, formatBubbleLabel, normalizeVideoTitle } from '@/lib/video-titles';
import { useTheme } from '@/lib/theme-context';
import styles from './assessment.module.css';

/* Shared "Curveball-style" warm-grey bubble background — mirrors the
   `PITCH_REPORT_BUBBLE_BG` used by the Pitching tab's ArsenalCards
   (Fastball / Curveball / Slider / ChangeUp). Two radial highlights
   tinted with warm grey + a soft top-to-bottom translucent white
   wash. Category color is reserved for the BORDER alone now, so
   every video bubble reads with the same neutral surface and the
   category accent reads as a frame around it. */
const VIDEO_BUBBLE_BG =
  'radial-gradient(ellipse at 0% 0%, rgba(126,134,144,0.07) 0%, transparent 55%),' +
  'radial-gradient(ellipse at 100% 100%, rgba(126,134,144,0.05) 0%, transparent 55%),' +
  'linear-gradient(180deg, rgba(255,255,255,0.032) 0%, rgba(255,255,255,0.008) 100%)';

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
  /** Optional label override for the top eyebrow. Defaults to the
   *  first video's bundle prefix (e.g. `Training - Hitting - Tee`)
   *  for bundles, or its full title for singletons. */
  label?: string;
  /** Tile size — flows to the inner preview's class. */
  size?: 'sm' | 'md' | 'lg';
  /** Reserved for forwarding into the modal (narration recorder etc.). */
  playerId?: string;
  recordingCategory?: string;
  /** Fires after the bundle modal uploads a Coach Review clip so
   *  the parent tab can refetch + surface the new clip immediately. */
  onUploaded?: () => void;
  /** Reports the coach can optionally attach a recorded Coach Review
   *  to. Forwarded directly to the underlying VideoBundleModal so
   *  every per-tab caller can pass whatever report list applies. */
  reports?: AttachableReport[];
  /** Optional secondary text rendered next to the date at the bottom
   *  of the bubble. Used by the global Video library to surface the
   *  athlete's name on each tile (since that view mixes clips from
   *  many players). Per-athlete galleries skip this so the bottom
   *  row stays minimal. */
  subtitle?: string;
  /** When true, the top "eyebrow" label (e.g. "Coach Review - Hitting -
   *  Live") is suppressed. Used by the Hitting Snapshot's in-panel
   *  Coach Reviews bubble, which already prints a white "Coach Reviews"
   *  header above the grid — the per-tile category-tinted caption
   *  underneath duplicates that information. Defaults to false so
   *  every other caller keeps the label as before. */
  hideLabel?: boolean;
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
}: VideoBundleCardProps) {
  const [open, setOpen] = useState(false);
  /* Theme used by Coach Review label-color logic below — on the
     inverted Coach Review treatment (sport-color fill + white border
     in light theme), the label sits on a saturated colored surface,
     so the sport-color accent text used in dark mode would be
     unreadable. Flips to white in light theme on Coach Reviews only. */
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (videos.length === 0) return null;

  const first = videos[0];
  const isBundle = videos.length > 1;
  /* Bubble label format (per coach-spec):
       Regular:      `<Category> - <Source> - <Detail>`
                       e.g. "Hitting - Training - Tee"
                            "Hitting - Live - VS Cole Anderson"
       Coach Review: `Coach Review - <Category> - <Source>`
                       e.g. "Coach Review - Hitting - Training"
     `formatBubbleLabel` derives all three pieces from the video's
     category + title (the title's per-angle camera suffix, if any,
     is intentionally dropped since the bubble already conveys the
     angle count via the badge). Explicit `label` prop wins so
     existing callers (e.g. legacy gallery entries) can still
     override. */
  const displayLabel = label || formatBubbleLabel({
    title: first.title || '',
    category: first.category,
  });
  const dateStr = new Date(first.createdAt).toLocaleDateString();
  const colors = getVideoCategoryColors(first.category);

  /* Coach Review detection — if ANY clip in this bundle (or the
     singleton itself) was uploaded by the in-modal narration
     recorder, the title carries the `Coach Review` prefix (or the
     legacy `Coach Reviewed`). Coach Reviews get a CATEGORY-COLORED
     border (Hitting blue, Pitching orange, Catching teal, etc.) so
     they stand out from the surrounding neutral-bordered clips at
     a glance. Regular clips keep the neutral `var(--border)`. */
  const hasCoachReview = videos.some((v) => {
    const t = normalizeVideoTitle(v.title || '');
    return t.startsWith('Coach Review');
  });
  const outerBorder = hasCoachReview ? colors.border : 'var(--border)';
  /* Coach Review bubbles also tint their label + date text with the
     category accent (Hitting blue, Pitching orange, etc.) so the
     bubble reads as a coherent colored unit — border + text both
     carry the category color, fill stays the soft tinted wash from
     `colors.bg`. Regular clips keep pure white text against the
     same tinted fill. */
  /* Outer video label color rules:
       • Regular clips → `var(--text-bright)` (near-white in dark,
         near-black in light) so the text reads against the bubble
         fill of either theme.
       • Coach Review clips IN DARK theme → sport-color accent
         (Hitting blue / Pitching orange / etc.) so the bubble
         reads as a unified colored unit alongside the colored
         border + soft tinted fill.
       • Coach Review clips IN LIGHT theme → near-black. The
         inverted treatment flips the fill to the sport color,
         which in light theme is always a PALE pastel (the
         "Movement Prep" tier — see getVideoCategoryColors), so
         dark text reads far better than white (white scored only
         ~2:1 on the pale fill; near-black scores ~6:1). */
  const outerTextColor = hasCoachReview
    ? (isLight ? 'var(--text-bright)' : colors.text)
    : 'var(--text-bright)';

  const sizeClass =
    size === 'sm' ? styles.videoSm
    : size === 'lg' ? styles.videoLg
    : styles.videoMd;

  return (
    <>
      <div
        /* Bubble background is tinted with the category color
           (Hitting → blue, Pitching → orange, Catching → teal,
           Infield/Outfield → green, Strength → red). Border is
           normally the neutral `var(--border)` — except for Coach
           Review bubbles, which adopt the category color on the
           border so coaches can spot their narrated reviews from
           the surrounding gallery at a glance. */
        /* `.videoBubbleCoachReview` modifier flips the light-theme
           treatment to its inverse: sport-color fill + white border
           (vs the regular white fill + sport-color border). Dark
           theme is unaffected — the existing tinted bg + sport-color
           border from the inline styles still apply. */
        className={`${styles.videoBubble}${hasCoachReview ? ` ${styles.videoBubbleCoachReview}` : ''}`}
        style={{
          width: '100%',
          maxWidth: size === 'sm' ? 180 : size === 'lg' ? 280 : 240,
          /* Border bumped 1px → 2px so the sport-category color
             (Hitting blue / Pitching orange / Catching teal /
             Infield-Outfield green / S&C red) reads as a more
             prominent accent in light theme where the white fill
             + colored outline is the primary visual cue. Dark
             theme uses the same 2px so the chrome stays consistent
             — the soft `colors.bg` tint behind it gives plenty
             of contrast either way. */
          border: `2px solid ${outerBorder}`,
          borderRadius: 12,
          /* `--video-bubble-bg` carries the dark-theme subtle tint
             (the `rgba(...,0.13)` colors.bg). `--video-bubble-color`
             carries the saturated dot color used as the color-mix
             source for the light-theme override. The `.videoBubble`
             CSS class in assessment.module.css picks the right
             background per theme — inline styles can no longer
             paint over the light-theme rule because the background
             property is moved into the class. */
          ['--video-bubble-bg' as any]: colors.bg,
          ['--video-bubble-color' as any]: colors.border,
          /* Padding + gap tighten now that the date row no longer
             lives outside the video tile — see the `dateStr` overlay
             below the play indicator. The bubble used to host three
             rows (label / tile / date); it now hosts just two
             (label / tile) so the chrome around the tile gets a
             tighter `gap: 4` and a leaner `padding: 6`. */
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          cursor: 'pointer',
        }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={displayLabel}
      >
        {/* Label eyebrow — top of bubble. Truncates with ellipsis
            when the prefix is too long for one line. Regular clips
            render white; Coach Reviews pick up the category accent
            color (Hitting blue / Pitching orange / etc.) so they
            read as a fully-colored unit alongside the matching
            border.

            Suppressed entirely when `hideLabel` is true (the
            Hitting Snapshot's Coach Reviews bubble uses this so
            its outer white "Coach Reviews" header isn't doubled up
            with the per-tile blue caption). */}
        {!hideLabel && (
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: outerTextColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 2px',
            }}
          >
            {displayLabel}
          </div>
        )}

        {/* Video tile — one square. Inner preview shows the first
            angle as a poster frame. Count badge for bundles sits in
            the bottom-right corner OF the tile, not the outside bubble.
            Overrides the size-class width so the tile fills the
            outer bubble (aspect-ratio: 1 in the CSS module keeps it
            square so the height follows). */}
        <div
          className={`${styles.videoPlaceholder} ${sizeClass} ${styles.videoReady}`}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '100%',
            margin: 0,
            cursor: 'pointer',
          }}
        >
          {first.originalUrl ? (
            <video
              src={first.originalUrl}
              preload="metadata"
              muted
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                pointerEvents: 'none',
              }}
            />
          ) : null}

          {/* Central play indicator — visible cue the tile is
              clickable (for bundles AND singletons). */}
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
              fontSize: 16,
              /* Hardcoded white — these chips sit on dark
                 translucent backgrounds (rgba(0,0,0,0.72-0.82))
                 layered over the video poster frame, so they need
                 white text in BOTH themes. `var(--text-bright)`
                 would flip to near-black in light, making the
                 chip text invisible on the dark chip background. */
              color: '#ffffff',
              pointerEvents: 'none',
            }}
          >
            ▶
          </div>

          {/* Count badge — bottom-right corner of the video tile.
              Only renders for bundles (count > 1). The number alone
              communicates "X angles". */}
          {isBundle && (
            <div
              style={{
                position: 'absolute',
                bottom: 6,
                right: 6,
                minWidth: 24,
                height: 20,
                padding: '0 6px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.82)',
                border: `1px solid ${colors.border}`,
                /* Hardcoded white — these chips sit on dark
                 translucent backgrounds (rgba(0,0,0,0.72-0.82))
                 layered over the video poster frame, so they need
                 white text in BOTH themes. `var(--text-bright)`
                 would flip to near-black in light, making the
                 chip text invisible on the dark chip background. */
              color: '#ffffff',
                fontSize: 11,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
              title={`${videos.length} angles`}
            >
              {videos.length}
            </div>
          )}

          {/* Date chip — moved INSIDE the video tile per coach-spec.
              Used to live in a separate row in the outer category-
              tinted bubble below the tile, which made every card
              three rows tall. Bringing the date INTO the tile (as
              an absolutely-positioned bottom-left chip on a
              translucent black plate) lets the outer bubble shrink
              to two rows (label + tile) without losing the
              recorded-on context. Sits in the bottom-LEFT corner so
              it never collides with the bundle count badge in the
              bottom-RIGHT corner. */}
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              padding: '2px 7px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.72)',
              border: '1px solid var(--border)',
              /* Hardcoded white — these chips sit on dark
                 translucent backgrounds (rgba(0,0,0,0.72-0.82))
                 layered over the video poster frame, so they need
                 white text in BOTH themes. `var(--text-bright)`
                 would flip to near-black in light, making the
                 chip text invisible on the dark chip background. */
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.02em',
              lineHeight: 1.1,
              pointerEvents: 'none',
              maxWidth: 'calc(100% - 12px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={dateStr}
          >
            {dateStr}
          </div>

          {/* Subtitle chip (optional) — only the global Video
              library passes a `subtitle` (player name). Moved from
              the retired outer date-row into the TOP-LEFT corner of
              the tile so it lives on the same translucent-black
              chip family as the date below it, doesn't collide with
              the bundle-count badge in the bottom-right, and stays
              legible against the video poster frame. */}
          {subtitle && (
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                padding: '2px 7px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.72)',
                border: '1px solid var(--border)',
                /* Hardcoded white — these chips sit on dark
                 translucent backgrounds (rgba(0,0,0,0.72-0.82))
                 layered over the video poster frame, so they need
                 white text in BOTH themes. `var(--text-bright)`
                 would flip to near-black in light, making the
                 chip text invisible on the dark chip background. */
              color: '#ffffff',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.02em',
                lineHeight: 1.1,
                pointerEvents: 'none',
                maxWidth: 'calc(100% - 12px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={subtitle}
            >
              {subtitle}
            </div>
          )}
        </div>
        {/* External date row retired — see the bottom-left date
            chip overlay inside the tile above. */}
      </div>

      {/* Click handler — both singletons AND bundles open the
          VideoBundleModal so a single-clip view inherits the
          bundle modal's full-page chrome: master scrubber + frame
          step + speed slider + record + compare + drawing tools,
          all in the exact same layout and at the exact same window
          size as a multi-angle view. The modal renders its grid
          with whatever number of videos it's given — 1, 2, or more
          — so a singleton just shows one pane (which expands to
          fill the available width). */}
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
