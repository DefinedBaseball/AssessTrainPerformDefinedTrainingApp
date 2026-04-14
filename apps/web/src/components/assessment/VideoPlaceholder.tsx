'use client';

import { useState } from 'react';
import styles from './assessment.module.css';
import { VideoPlayerModal } from './VideoPlayerModal';

interface VideoPlaceholderProps {
  tag: string;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
  videoUrl?: string | null;
  onClick?: () => void;
}

const SIZE_CLASS = {
  sm: styles.videoSm,
  md: styles.videoMd,
  lg: styles.videoLg,
};

export function VideoPlaceholder({ tag, title, subtitle, size = 'md', videoUrl, onClick }: VideoPlaceholderProps) {
  const [playing, setPlaying] = useState(false);
  const hasVideo = !!videoUrl;

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
      >
        <span className={styles.vpTag}>{tag}</span>
        <div className={hasVideo ? styles.vpIconReady : styles.vpIcon}>▶</div>
        <div>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{subtitle}</div>}
      </div>

      {playing && videoUrl && (
        <VideoPlayerModal
          videoUrl={videoUrl}
          title={title}
          onClose={() => setPlaying(false)}
        />
      )}
    </>
  );
}
