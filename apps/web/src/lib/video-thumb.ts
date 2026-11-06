/**
 * A still image for a video, so a preview tile can show a picture instead of
 * downloading part of the clip itself (a list of video tiles used to pull a
 * slice of every video just to draw its first frame -- many MB on a phone).
 *
 * Uses the stored thumbnail when there is one; otherwise, for a Bunny Stream
 * link, Bunny's own thumbnail that sits in the same video folder. Signed
 * Bunny links carry a DIRECTORY token (token_path = the video's folder), so
 * the same token covers thumbnail.jpg -- only the file name changes.
 *
 * Returns null when no image is known; callers fall back to the video.
 */
export function videoThumbnail(thumbnailUrl?: string | null, videoUrl?: string | null): string | null {
  if (thumbnailUrl) return thumbnailUrl;
  if (!videoUrl) return null;
  const m = videoUrl.match(
    /^(https:\/\/[^/]+\.b-cdn\.net\/(?:bcdn_token=[^/]*\/)?[0-9a-f-]{36}\/)(?:play_\d+p\.mp4|playlist\.m3u8|original)(?:[?#].*)?$/i,
  );
  return m ? `${m[1]}thumbnail.jpg` : null;
}
