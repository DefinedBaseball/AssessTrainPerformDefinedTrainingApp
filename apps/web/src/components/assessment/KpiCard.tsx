'use client';

import styles from './assessment.module.css';

type BadgeLevel = 'high' | 'mid' | 'low' | 'teal';

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  badge?: string;
  badgeLevel?: BadgeLevel;
  color?: string; // CSS color override for the value
}

const BADGE_CLASS: Record<BadgeLevel, string> = {
  high: styles.badgeHigh,
  mid: styles.badgeMid,
  low: styles.badgeLow,
  teal: styles.badgeTeal,
};

export function KpiCard({ label, value, unit, badge, badgeLevel = 'teal', color }: KpiCardProps) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      {/* Value + unit share a single baseline-aligned row so "95.2 mph"
          reads as one number, with the unit visibly smaller. When `color`
          is overridden we drop the gradient text effect so the inline
          color actually wins. */}
      <div className={styles.kpiValRow}>
        <span
          className={styles.kpiVal}
          style={color ? {
            color,
            background: 'none',
            WebkitBackgroundClip: 'border-box',
            backgroundClip: 'border-box',
            WebkitTextFillColor: color,
          } : undefined}
        >{value}</span>
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
      </div>
      {badge && (
        <span className={`${styles.kpiBadge} ${BADGE_CLASS[badgeLevel]}`}>{badge}</span>
      )}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.kpiGrid}>{children}</div>;
}
