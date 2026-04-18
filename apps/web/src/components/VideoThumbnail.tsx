'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  /** If provided, rendered as <img>. */
  thumbnailUrl?: string | null;
  /** Video source URL used to extract the first frame when no thumbnailUrl is available. */
  src?: string | null;
  /** Optional className applied to the rendered element (img or video). */
  className?: string;
  /** Object-fit for the rendered element. Default 'cover'. */
  fit?: 'cover' | 'contain';
  /** Alt text for the img fallback. */
  alt?: string;
};

/**
 * Renders a preview image for a video. Prefers an explicit `thumbnailUrl`; if
 * none is provided, it renders a muted, non-playing <video> element that shows
 * the first frame. We append `#t=0.1` to the src so browsers (Safari in
 * particular) reliably display the frame at ~100ms instead of a black poster.
 *
 * On loaded metadata we also explicitly seek to 0.1s as a belt-and-suspenders
 * fallback for browsers that ignore the URL fragment.
 */
export default function VideoThumbnail({
  thumbnailUrl,
  src,
  className,
  fit = 'cover',
  alt = '',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Explicit seek as a fallback for engines that don't honor the URL fragment.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onLoadedMeta = () => {
      try {
        if (el.currentTime < 0.1) el.currentTime = 0.1;
      } catch {
        /* ignore — some codecs throw on seek before buffered */
      }
    };
    el.addEventListener('loadedmetadata', onLoadedMeta);
    return () => el.removeEventListener('loadedmetadata', onLoadedMeta);
  }, [src]);

  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt={alt}
        className={className}
        style={{ objectFit: fit, width: '100%', height: '100%', display: 'block' }}
      />
    );
  }

  if (!src || failed) {
    // No source or extraction failed — render a muted gradient placeholder.
    return (
      <div
        className={className}
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        }}
      />
    );
  }

  const previewSrc = src.includes('#') ? src : `${src}#t=0.1`;

  return (
    <video
      ref={videoRef}
      className={className}
      src={previewSrc}
      muted
      playsInline
      preload="metadata"
      // These disable play UI entirely — this element is decorative.
      controls={false}
      onError={() => setFailed(true)}
      style={{ objectFit: fit, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    />
  );
}
