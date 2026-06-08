/**
 * Shared video-title helpers used across every gallery surface
 * (Hitting / Pitching / Catching / Infield / Outfield tabs +
 * Player Summary + /videos page).
 *
 * Two responsibilities:
 *   1. `normalizeVideoTitle` — rewrites legacy "Live Session — …"
 *      titles into the new "Training - …" format at display time so
 *      every surface reads the same naming regardless of when the
 *      clip was saved.
 *   2. `bundleVideos` — groups multi-angle clips (videos saved in
 *      the same Start Video press of Live Training) into a single
 *      bundle so the gallery shows them as one visual unit instead
 *      of N loose tiles.
 */

/** Shape of a video object as it lands in any gallery — keep this
 *  small so the helper can be reused from anywhere without dragging
 *  in the full API typings. The `Video` type from `@/lib/api`
 *  satisfies this shape. `playerId` is optional because per-player
 *  surfaces (the profile tabs) only show one athlete's videos and
 *  can skip the playerId check; multi-player surfaces (the global
 *  /videos page) MUST include it so two different players' clips
 *  with the same prefix don't false-bundle. */
export interface GalleryVideo {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  originalUrl?: string | null;
  playerId?: string;
}

/** Rewrite legacy "Live Session — X · Y" titles into the new
 *  "Training - X - Y" format on the fly. Used at display time so
 *  the saved DB row stays untouched and bundle detection sees the
 *  same canonical title shape regardless of when the clip was saved.
 *
 *  Transforms:
 *    "Live Session — Hitting · Tee" → "Training - Hitting - Tee"
 *    "Live Session — Pitching"      → "Training - Pitching"
 *    "Live Session — 5/20/2026"     → "Training - 5/20/2026"
 *
 *  Anything not starting with "Live Session" passes through unchanged. */
export function normalizeVideoTitle(raw: string): string {
  if (!raw.startsWith('Live Session')) return raw;
  return raw
    .replace(/^Live Session\s*[—–-]\s*/, 'Training - ')
    .replace(/\s*·\s*/g, ' - ');
}

/**
 * Split a normalized video title into a `prefix` (used as the bubble
 * header in galleries) and an optional `cameraLabel` (rendered as
 * the angle name in white on the inner card).
 *
 *   "Training - Hitting - Tee - Side Angle"
 *     → { prefix: "Training - Hitting - Tee", cameraLabel: "Side Angle" }
 *
 *   "Training - Hitting - Dry"            (no camera segment)
 *   "Live At-Bat vs Cole Anderson"        (not Training-format)
 *   "Coach Review — 5/20/2026 (12s)"
 *     → { prefix: <the full title>, cameraLabel: null }
 *
 * A "camera segment" is detected only when the title is in the
 * canonical Training shape AND has 4+ hyphen-separated parts —
 * matches the same rule `bundleVideos` uses so the bubble header and
 * the multi-angle bundle key always agree on which part of the title
 * is the camera label.
 */
export function splitVideoTitle(raw: string): { prefix: string; cameraLabel: string | null } {
  const t = normalizeVideoTitle(raw);
  if (t.startsWith('Training -')) {
    const segments = t.split(' - ').map((s) => s.trim());
    if (segments.length >= 4) {
      const cameraLabel = segments[segments.length - 1];
      const prefix = segments.slice(0, -1).join(' - ');
      return { prefix, cameraLabel };
    }
  }
  return { prefix: t, cameraLabel: null };
}

/**
 * Format the gallery-bubble label for a video, per the coach-spec:
 *
 *   Regular clip:
 *     `<Category> - <Source> - <Detail>`
 *       e.g. "Hitting - Training - Tee"
 *            "Hitting - Live - VS Cole Anderson"
 *            "Catching - Training - Dry"
 *
 *   Coach Review:
 *     `Coach Review - <Category> - <Source>`
 *       e.g. "Coach Review - Hitting - Training"
 *            "Coach Review - Pitching - Live"
 *
 * `Category` is derived from the video's `category` field (HITTING →
 * "Hitting", WORKOUT_DEMO/STRENGTH → "S & C", etc.). `Source` is
 * sniffed from the title ("Training - …" → "Training", "Live …" →
 * "Live"). `Detail` is the implement chunk for Training clips ("Tee"
 * / "Dry" / "Front Toss") or "VS <pitcher>" for Live At-Bat clips.
 */
const CATEGORY_DISPLAY: Record<string, string> = {
  HITTING:        'Hitting',
  PITCHING:       'Pitching',
  INFIELD:        'Infield',
  OUTFIELD:       'Outfield',
  CATCHING:       'Catching',
  FIELDING:       'Infield',
  WORKOUT_DEMO:   'S & C',
  STRENGTH:       'S & C',
  GAME:           'Game',
  COACHING:       'Coaching',
};

function formatCategoryLabel(category: string | null | undefined): string {
  if (!category) return '';
  const key = category.toUpperCase();
  return CATEGORY_DISPLAY[key] ?? category;
}

export function formatBubbleLabel(video: {
  title: string;
  category: string;
}): string {
  const cat = formatCategoryLabel(video.category);
  const t = normalizeVideoTitle(video.title || '');

  /* Coach Review path — `Coach Review - <Category> - <Source>`.
     Source defaults to "Training" since the in-modal recorder pulls
     from a Training bundle by construction; "Live" only applies if
     the underlying clip title carries that marker (e.g. recordings
     made off a Live At-Bat reach this branch via the title we
     attach during upload). */
  if (t.startsWith('Coach Review')) {
    const source = /\bLive\b/i.test(t) ? 'Live' : 'Training';
    return ['Coach Review', cat, source].filter(Boolean).join(' - ');
  }

  /* Training - <Position> - <Implement> - <Camera> shape. The
     <Implement> chunk is what reads as "Detail" in the new label;
     the camera-label suffix at the end is dropped (it's per-angle
     metadata, not bubble-header info). */
  if (t.startsWith('Training -')) {
    const segs = t.split(' - ').map((s) => s.trim()).filter(Boolean);
    // segs[0] = "Training", segs[1] = position, segs[2] = implement
    const implement = segs[2] || '';
    return [cat, 'Training', implement].filter(Boolean).join(' - ');
  }

  /* Live At-Bat vs <pitcher> shape — surfaces as "VS <pitcher>"
     in the Detail slot. */
  const liveAtBat = t.match(/^Live At-Bat\s+vs\s+(.+)$/i);
  if (liveAtBat) {
    return [cat, 'Live', `VS ${liveAtBat[1].trim()}`].filter(Boolean).join(' - ');
  }
  if (/^Live At-Bat/i.test(t) || /^Live\b/i.test(t)) {
    return [cat, 'Live'].filter(Boolean).join(' - ');
  }

  /* Fallback — unknown title shape. Prepend the category and use
     the title as the Detail so the bubble still reads usefully. */
  return [cat, t].filter(Boolean).join(' - ');
}

/** One entry in the bundled gallery feed — either a single video or
 *  a group of clips that were recorded together (multi-angle).
 *  Generic over the caller's video shape so the full `VideoWithPlayer`
 *  / `Video` typings survive the bundle pass instead of narrowing to
 *  the minimal `GalleryVideo`. */
export interface VideoBundle<T extends GalleryVideo = GalleryVideo> {
  /** Bundle key — `null` for singletons (one-video "bundles"). Used
   *  as the React key in the gallery render. */
  key: string;
  /** Every video in this bundle, original order. The bundle reps
   *  with the first video's metadata when collapsing to a header. */
  videos: T[];
  /** Convenience flag — `true` only when there are 2+ angles. */
  isBundle: boolean;
}

/* How close together two clips' `createdAt` timestamps have to be
   to count as the same Start Video press. Multi-angle recordings
   finalize within a few seconds of each other (the MediaRecorder
   `onstop` fires per-angle in parallel + the upload requests run
   sequentially), so a 60-second window is comfortably wide
   without risking false positives between back-to-back presses. */
const BUNDLE_TIME_WINDOW_MS = 60 * 1000;

/**
 * Group videos that share a Training "press" identity into bundles.
 *
 * A bundle is detected when:
 *   • Two videos' normalized titles share everything UP TO the last
 *     " - " (i.e. "Training - Hitting - Tee" — the camera-label
 *     suffix differs but everything before it matches).
 *   • Their `createdAt` timestamps fall within
 *     `BUNDLE_TIME_WINDOW_MS` of each other.
 *
 * Everything else (Coach Review narrations, raw uploads, Live At-Bat
 * clips, etc.) stays as a single-video bundle. Bundles preserve the
 * input order of the videos array — the caller can sort first (e.g.
 * Coach Review to the top) and bundling will follow that order.
 */
export function bundleVideos<T extends GalleryVideo>(videos: T[]): VideoBundle<T>[] {
  /** Pull the "bundle prefix" from a Training title — the part BEFORE
   *  the last " - " (which is the camera label). Returns `null` for
   *  titles that aren't multi-angle Training clips (Coach Review,
   *  Live At-Bat, raw uploads, etc.). */
  const bundlePrefix = (rawTitle: string): string | null => {
    const t = normalizeVideoTitle(rawTitle);
    /* Must start with "Training - " AND have at least 3 hyphen-
       separated segments (Training - Position - Implement - Camera).
       Two-segment titles like "Training - 5/20/2026" don't have a
       camera-label suffix and shouldn't bundle. */
    if (!t.startsWith('Training -')) return null;
    const lastDash = t.lastIndexOf(' - ');
    if (lastDash < 0) return null;
    const prefix = t.slice(0, lastDash).trim();
    /* Reject prefixes that are just "Training -" itself (i.e. only
       one segment came before the last dash, meaning the title is
       "Training - X" with no implement/camera split). Need at least
       "Training - X - Y" before the camera-label suffix. */
    const dashCount = (prefix.match(/ - /g) || []).length;
    if (dashCount < 1) return null;
    return prefix;
  };

  const out: VideoBundle<T>[] = [];
  /* Track the most recently-seen bundle for each prefix so we can
     extend it (vs. start a fresh bundle) when another clip with the
     same prefix lands within the time window. */
  const active = new Map<string, { bundle: VideoBundle<T>; lastTs: number }>();

  for (const v of videos) {
    const prefix = bundlePrefix(v.title);
    const ts = new Date(v.createdAt).getTime();
    if (prefix === null) {
      /* Not a bundleable title — emit as a singleton and don't
         touch the active map. */
      out.push({ key: `single:${v.id}`, videos: [v], isBundle: false });
      continue;
    }
    /* Per-player keying so multi-player surfaces (the global
       /videos page) don't false-bundle two different athletes'
       clips with the same prefix. Per-player surfaces leave
       `playerId` unset; they end up with a constant empty-string
       prefix which still groups correctly within the one
       athlete's gallery. */
    const groupKey = `${v.playerId || ''}|${prefix}`;
    const cur = active.get(groupKey);
    if (cur && Math.abs(ts - cur.lastTs) <= BUNDLE_TIME_WINDOW_MS) {
      /* Same prefix + within the time window → append to the
         active bundle. */
      cur.bundle.videos.push(v);
      cur.bundle.isBundle = true;
      cur.lastTs = ts;
    } else {
      /* New bundle — either no active one for this prefix, or the
         previous one timed out. The first video keys the bundle. */
      const bundle: VideoBundle<T> = {
        key: `bundle:${groupKey}:${v.id}`,
        videos: [v],
        isBundle: false,
      };
      out.push(bundle);
      active.set(groupKey, { bundle, lastTs: ts });
    }
  }

  return out;
}
