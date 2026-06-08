'use client';

import { useState } from 'react';
import styles from './assessment.module.css';

interface DownloadPdfButtonProps {
  onDownload: () => Promise<void>;
  label?: string;
  disabled?: boolean;
}

export function DownloadPdfButton({ onDownload, label = 'Download PDF', disabled }: DownloadPdfButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleClick = async () => {
    if (downloading || disabled) return;
    setDownloading(true);
    try {
      await onDownload();
    } catch (err: any) {
      console.error('PDF download failed:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.downloadPdfBtn}
      onClick={handleClick}
      disabled={downloading || disabled}
      title={downloading ? 'Generating PDF…' : label}
      aria-label={downloading ? 'Generating PDF' : label}
    >
      {downloading ? (
        <span className={styles.downloadPdfSpinner}>
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="20 12" />
          </svg>
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M8 10l-3-3M8 10l3-3" />
          <path d="M2 12h12v2H2z" />
        </svg>
      )}
    </button>
  );
}
