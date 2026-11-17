/* ─────────────────────────────────────────────────────────────────────────
   Which progressive MP4 to play for a Bunny Stream video.

   A clip's link is saved at upload, before Bunny has encoded anything, so
   it starts on play_720p.mp4. Once Bunny reports the encode finished, the
   sweep in VideoRenditionsService moves it to the best MP4 Bunny actually
   made, after confirming that file loads: 1080p for a 1080p+ source, or
   360p / 240p for a small source (where play_720p.mp4 never exists, so the
   clip couldn't play at all). Pure functions -- unit-tested.
   ───────────────────────────────────────────────────────────────────────── */

/** The parts of Bunny's GET /library/{id}/videos/{guid} reply we use. */
export interface BunnyVideoInfo {
  /** 0 created, 1 uploaded, 2 processing, 3 transcoding, 4 finished,
   *  5 error, 6 upload failed, 7/8 JIT segmenting / playlists created. */
  status?: number;
  encodeProgress?: number;
  /** "240p,360p,720p,1080p" */
  availableResolutions?: string | null;
  width?: number;
  height?: number;
  framerate?: number;
}

/** MP4 renditions to try, best first. Bunny's MP4 Fallback makes 1080p,
 *  720p, 360p and 240p (480p is tried too -- every pick is load-checked). */
export const MP4_HEIGHTS = ['1080p', '720p', '480p', '360p', '240p'] as const;
export type Mp4Height = (typeof MP4_HEIGHTS)[number];

export type RenditionDecision =
  /** Still encoding -- look again later. */
  | { state: 'pending' }
  /** Encoding failed -- leave the link alone, stop looking. */
  | { state: 'failed' }
  /** Encoded: the MP4s Bunny lists, best first (try each until one loads). */
  | { state: 'ready'; candidates: Mp4Height[] };

export function decideRendition(info: BunnyVideoInfo | null | undefined): RenditionDecision {
  if (!info) return { state: 'pending' };
  const status = typeof info.status === 'number' ? info.status : -1;
  if (status === 5 || status === 6) return { state: 'failed' };
  const finished = status === 4 || (typeof info.encodeProgress === 'number' && info.encodeProgress >= 100 && status !== 2 && status !== 3);
  if (!finished) return { state: 'pending' };
  const res = new Set(
    String(info.availableResolutions || '')
      .split(',')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  );
  return { state: 'ready', candidates: MP4_HEIGHTS.filter((h) => res.has(h)) };
}

/** The same Bunny link pointed at another MP4 rendition. */
export function withRendition(url: string, height: Mp4Height): string {
  return url.replace(/\/play_\d{3,4}p\.mp4(?=$|\?)/, `/play_${height}.mp4`);
}

/** True for a Bunny MP4 link still on the 720p rendition. */
export function isPlay720(url: string | null | undefined): boolean {
  return !!url && /\/play_720p\.mp4(?:$|\?)/.test(url);
}

/** "1080x1920 @ 30fps" for the log -- what Bunny received from the phone. */
export function describeSource(info: BunnyVideoInfo | null | undefined): string {
  if (!info) return 'unknown';
  const size = info.width && info.height ? `${info.width}x${info.height}` : '?x?';
  const fps = typeof info.framerate === 'number' && info.framerate > 0 ? `${Math.round(info.framerate * 100) / 100}fps` : '?fps';
  return `${size} @ ${fps}`;
}
