'use client';

import type { ReactNode } from 'react';
import styles from './assessment.module.css';

type IconColor = 'teal' | 'gold' | 'red' | 'green';

interface SectionHeaderProps {
  /** Emoji string OR a custom ReactNode (e.g. inline SVG logo). */
  icon: ReactNode;
  iconColor?: IconColor;
  title: string;
  subtitle?: string;
}

const ICON_CLASS: Record<IconColor, string> = {
  teal: styles.iconTeal,
  gold: styles.iconGold,
  red: styles.iconRed,
  green: styles.iconGreen,
};

export function SectionHeader({ icon, iconColor = 'teal', title, subtitle }: SectionHeaderProps) {
  // Split the title on the first space so the first word reads in the
  // "Mason" silver gradient and the rest reads in the italic-blue "Brown"
  // accent — mirrors the player hero name treatment.
  const trimmed = title.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const firstWord = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const restWords = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  return (
    <div className={styles.sectionHeader}>
      <div className={`${styles.sectionIcon} ${ICON_CLASS[iconColor]}`}>{icon}</div>
      <div>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionTitleFirst}>{firstWord}</span>
          {restWords && (
            <>
              {' '}
              <span className={styles.sectionTitleAccent}>{restWords}</span>
            </>
          )}
        </div>
        {subtitle && <div className={styles.sectionSub}>{subtitle}</div>}
      </div>
      <div className={styles.sectionDivider}></div>
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return <div className={styles.section}>{children}</div>;
}
