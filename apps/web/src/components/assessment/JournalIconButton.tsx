'use client';

import styles from './assessment.module.css';

/* Icon-only square button beside the Videos button on the athlete's profile
   tab line -- opens their Journal. Same `.downloadPdfBtn` chrome as
   VideosIconButton so the two read as a matched pair. `active` marks it
   while the Journal is open. */
export function JournalIconButton({ onClick, active = false }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      className={styles.downloadPdfBtn}
      onClick={onClick}
      title="Journal"
      aria-label="Journal"
      aria-pressed={active}
      style={active ? { outline: '2px solid var(--text-muted)', outlineOffset: 1 } : undefined}
    >
      {/* Notebook with a bookmark ribbon and two ruled lines. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.75"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z" />
        <path d="M6 3v18" />
        <path d="M10 8h5" />
        <path d="M10 12h5" />
        <path d="M14 3v5l1.5-1 1.5 1V3" />
      </svg>
    </button>
  );
}
