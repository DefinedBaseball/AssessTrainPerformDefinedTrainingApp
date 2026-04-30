'use client';

import styles from './assessment.module.css';

type FillLevel = 'high' | 'mid' | 'low' | 'teal';

interface ScoreBarProps {
  label: string;
  value: number | string;
  /** 0-100 for the fill percentage */
  percent: number;
  level?: FillLevel;
  unit?: string;
}

const FILL_CLASS: Record<FillLevel, string> = {
  high: styles.fillHigh,
  mid: styles.fillMid,
  low: styles.fillLow,
  teal: styles.fillTeal,
};

const COLORS: Record<FillLevel, string> = {
  high: 'var(--green)',
  mid: '#F1F5F9',
  low: '#3B82F6',
  teal: 'var(--accent)',
};

export function ScoreBar({ label, value, percent, level = 'teal', unit }: ScoreBarProps) {
  return (
    <div>
      <div className={styles.scoreBarHeader}>
        <span>{label}</span>
        <span style={{ color: COLORS[level], fontWeight: 600 }}>
          {value}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className={styles.scoreBarTrack}>
        <div
          className={`${styles.scoreBarFill} ${FILL_CLASS[level]}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
