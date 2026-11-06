'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { videoThumbnail } from '@/lib/video-thumb';

/**
 * The still frame on a video tile. Shows the clip's thumbnail image when one
 * is known (see videoThumbnail) -- a small picture instead of a slice of the
 * video file -- and only falls back to a muted, paused <video> (first frame)
 * when there's no image or it fails to load (e.g. Bunny hasn't made the
 * thumbnail yet for a clip uploaded seconds ago).
 *
 * Purely decorative: no controls, no pointer events; the tile around it
 * handles clicks.
 */
export function VideoPreviewFrame({
  src,
  thumbnailUrl,
  className,
  style,
}: {
  /** The video. */
  src?: string | null;
  /** Its stored thumbnail, if the record has one. */
  thumbnailUrl?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const thumb = videoThumbnail(thumbnailUrl, src);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [thumb]);

  if (thumb && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumb}
        alt=""
        aria-hidden="true"
        className={className}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setImgFailed(true)}
        style={{ objectFit: 'cover', pointerEvents: 'none', ...style }}
      />
    );
  }
  if (!src) return null;
  return (
    <video
      src={src.includes('#') ? src : `${src}#t=0.1`}
      className={className}
      preload="metadata"
      muted
      playsInline
      disablePictureInPicture
      style={{ objectFit: 'cover', pointerEvents: 'none', ...style }}
    />
  );
}

export default VideoPreviewFrame;
