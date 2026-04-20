'use client';

import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  /** Small uppercase label above the title. */
  eyebrow?: string;
  /** Main heading. */
  title: string;
  /** Optional italic-gold accent portion appended to the title
   *  (renders like the athlete-profile lastName flourish). */
  titleAccent?: string;
  /** Optional one-line description under the title. */
  subtitle?: ReactNode;
  /** Optional right-side slot for buttons / filters / search. */
  actions?: ReactNode;
  /** Optional readout chip rendered top-right, above the actions row. */
  readout?: string;
  /** Variant: 'bar' (default, compact) | 'hero' (larger display title). */
  size?: 'bar' | 'hero';
}

export function PageHeader({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  actions,
  readout,
  size = 'bar',
}: PageHeaderProps) {
  return (
    <header
      className={`${styles.pageHeader} ${size === 'hero' ? styles.hero : ''}`}
    >
      {/* Decorative corner glow */}
      <span className={styles.cornerGlow} aria-hidden="true" />

      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          {eyebrow && (
            <div className={styles.eyebrow}>
              <i className={styles.tick} aria-hidden="true" />
              <span>{eyebrow}</span>
            </div>
          )}
          <h1 className={styles.title}>
            {title}
            {titleAccent && (
              <>
                {' '}
                <span className={styles.titleAccent}>{titleAccent}</span>
              </>
            )}
          </h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>

        {(readout || actions) && (
          <div className={styles.sideStack}>
            {readout && (
              <div className={styles.readout} aria-hidden="true">
                <span className={styles.readoutDot} />
                <span>{readout}</span>
              </div>
            )}
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
        )}
      </div>

      {/* Bottom hairline */}
      <span className={styles.rule} aria-hidden="true" />
    </header>
  );
}
