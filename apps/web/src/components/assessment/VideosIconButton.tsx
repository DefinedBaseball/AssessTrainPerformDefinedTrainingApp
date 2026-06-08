'use client';

import styles from './assessment.module.css';

interface VideosIconButtonProps {
  /** Click handler — typically wired to the parent profile's setActiveTab('videos') so this
   *  acts as a one-click jump into the Videos / Coaching section from any other tab. */
  onClick?: () => void;
  /** Hide the button entirely. Defaults to shown. */
  show?: boolean;
  /** Accessibility / tooltip label. Defaults to "Videos". */
  label?: string;
}

/* Icon-only square button that lives in TabBarActions next to the
   DownloadPdfButton. Reuses the same `.downloadPdfBtn` chrome (34×34
   square, graphite gradient, soft border) so the two icons read as a
   matched pair on every tab's action bar. */
export function VideosIconButton({ onClick, show = true, label = 'Videos' }: VideosIconButtonProps) {
  if (!show || !onClick) return null;
  return (
    <button
      type="button"
      className={styles.downloadPdfBtn}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {/* Same video glyph used by the (now-retired) Videos tab icon
          in the player profile's TabBar — film strip + play triangle +
          center lens so it reads as "video library" at small sizes. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.75"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="5" width="14" height="14" rx="2" />
        <path d="M16 10l5-3v10l-5-3z" />
        <circle cx="9" cy="12" r="2.5" />
      </svg>
    </button>
  );
}
