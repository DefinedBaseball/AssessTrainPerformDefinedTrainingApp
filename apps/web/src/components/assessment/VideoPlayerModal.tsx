'use client';

import { useEffect, useRef, useCallback } from 'react';
import styles from './video-player.module.css';

interface VideoPlayerModalProps {
  videoUrl: string;
  title: string;
  onClose: () => void;
}

export function VideoPlayerModal({ videoUrl, title, onClose }: VideoPlayerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={styles.videoWrap}>
          <video
            ref={videoRef}
            className={styles.video}
            src={videoUrl}
            controls
            autoPlay
            playsInline
          />
        </div>
      </div>
    </div>
  );
}
