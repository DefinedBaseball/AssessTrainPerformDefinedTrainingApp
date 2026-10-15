'use client';

/* Education Hub hero banner + the hub's line icons.

   Every Education screen opens with this: a charcoal banner with a fine
   stripe texture, a soft off-white glow, an oversized faded watermark of
   the section's icon, a mono eyebrow, the display title (second word in an
   off-white-to-grey fade), an optional subtitle, and a readout / actions slot. */

import type React from 'react';
import styles from './page.module.css';

export function EduHeader({ eyebrow, title, accent, subtitle, readout, actions, icon, tone = 'dark', chipInline = false }: {
  eyebrow: string;
  title: string;
  /** Second word, set apart in an off-white-to-grey fade ("Library", "Hub"). */
  accent?: string;
  subtitle?: string;
  /** Small mono stat on the right, e.g. "936 resources". */
  readout?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  /** 'light' = the solid mid-grey banner with dark type (Coach Dashboard). */
  tone?: 'dark' | 'light';
  /** Icon chip on the same line as the eyebrow instead of above it. */
  chipInline?: boolean;
}) {
  const chip = icon && <span className={styles.heroChip} aria-hidden="true">{icon}</span>;
  const eyebrowEl = (
    <span className={styles.heroEyebrow}>
      <span className={styles.heroDot} aria-hidden="true" />
      {eyebrow}
    </span>
  );
  return (
    <header className={`${styles.hero} ${tone === 'light' ? styles.heroLight : ''}`}>
      {icon && <span className={styles.heroWatermark} aria-hidden="true">{icon}</span>}
      <div className={styles.heroMain}>
        {chipInline ? (
          <span className={styles.heroEyebrowRow}>{chip}{eyebrowEl}</span>
        ) : (
          <>{chip}{eyebrowEl}</>
        )}
        <h1 className={styles.heroTitle}>
          {title}
          {accent && <> <span className={styles.heroAccent}>{accent}</span></>}
        </h1>
        {subtitle && <p className={styles.heroSub}>{subtitle}</p>}
      </div>
      {(readout || actions) && (
        <div className={styles.heroSide}>
          {readout && <span className={styles.heroReadout}>{readout}</span>}
          {actions}
        </div>
      )}
    </header>
  );
}

/* Line icons on a 24-unit grid, drawn in currentColor. */
const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconFilm() {
  return (
    <svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9h19M2.5 15h19M7 5v4M12 5v4M17 5v4M7 15v4M12 15v4M17 15v4" opacity=".55" />
      <path d="M10.2 10.4v3.2l2.8-1.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconBall() {
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.3 5.2c1.9 1.7 3 4.1 3 6.8s-1.1 5.1-3 6.8M17.7 5.2c-1.9 1.7-3 4.1-3 6.8s1.1 5.1 3 6.8" />
      <path d="M7.6 8.2l1.6-.5M8.7 11l1.6-.1M8.7 13.4l1.6.1M7.6 16.1l1.6.5M16.4 8.2l-1.6-.5M15.3 11l-1.6-.1M15.3 13.4l-1.6.1M16.4 16.1l-1.6.5" strokeWidth="1.3" />
    </svg>
  );
}
export function IconCap() {
  return (
    <svg {...p}>
      <path d="M2 9.5L12 5l10 4.5L12 14z" />
      <path d="M6 11.4v4.1c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.1" />
      <path d="M22 9.5v5" />
    </svg>
  );
}
export function IconBook() {
  return (
    <svg {...p}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      <path d="M8 7.5h8M8 11h6" opacity=".7" />
    </svg>
  );
}
export function IconHub() {
  return (
    <svg {...p}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  );
}
export function IconLock() {
  return (
    <svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
export function IconAthletes() {
  return (
    <svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.3 3.1-5.2 6-5.2s5.4 1.9 6 5.2" />
      <circle cx="17" cy="9" r="2.4" opacity=".7" />
      <path d="M16.5 14.3c2.3.2 4 1.8 4.5 4.6" opacity=".7" />
    </svg>
  );
}
export function IconAttendance() {
  return (
    <svg {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8.8 15l2.2 2.2 4.4-4.4" />
    </svg>
  );
}
export function IconEditor() {
  return (
    <svg {...p}>
      <circle cx="6.5" cy="7" r="2.8" />
      <circle cx="6.5" cy="17" r="2.8" />
      <path d="M8.8 8.6L20 18M8.8 15.4L20 6" />
    </svg>
  );
}
export function IconTraining() {
  return (
    <svg {...p}>
      <rect x="2.5" y="8.5" width="3" height="7" rx=".6" />
      <rect x="18.5" y="8.5" width="3" height="7" rx=".6" />
      <rect x="5.5" y="10" width="2.5" height="4" rx=".5" />
      <rect x="16" y="10" width="2.5" height="4" rx=".5" />
      <path d="M8 12h8" />
    </svg>
  );
}
export function IconLive() {
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M8 7.5a6.5 6.5 0 0 0 0 9M16 7.5a6.5 6.5 0 0 1 0 9M5.5 5a9.5 9.5 0 0 0 0 14M18.5 5a9.5 9.5 0 0 1 0 14" />
    </svg>
  );
}
