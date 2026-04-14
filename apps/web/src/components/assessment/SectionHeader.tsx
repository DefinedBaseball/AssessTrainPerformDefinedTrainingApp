'use client';

import styles from './assessment.module.css';

type IconColor = 'teal' | 'gold' | 'red' | 'green';

interface SectionHeaderProps {
  icon: string;
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
  return (
    <div className={styles.sectionHeader}>
      <div className={`${styles.sectionIcon} ${ICON_CLASS[iconColor]}`}>{icon}</div>
      <div>
        <div className={styles.sectionTitle}>{title}</div>
        {subtitle && <div className={styles.sectionSub}>{subtitle}</div>}
      </div>
      <div className={styles.sectionDivider}></div>
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return <div className={styles.section}>{children}</div>;
}
