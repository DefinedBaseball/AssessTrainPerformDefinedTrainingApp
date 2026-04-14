'use client';

import styles from './assessment.module.css';

type PipLevel = 'high' | 'mid' | 'low';

interface ScalePipsProps {
  /** Grade on 20-80 scale (20,30,40,50,60,70,80) */
  grade: number;
  totalPips?: number;
}

const PIP_CLASS: Record<PipLevel, string> = {
  high: styles.pipHigh,
  mid: styles.pipMid,
  low: styles.pipLow,
};

/**
 * 20-80 scouting grade visualizer.
 * Maps: 20-30 = 1 pip, 40 = 2, 50 = 3, 60 = 4, 70-80 = 5
 */
export function ScalePips({ grade, totalPips = 5 }: ScalePipsProps) {
  // Convert 20-80 to active count (1-5)
  const activePips = Math.max(1, Math.min(totalPips, Math.round((grade - 10) / 14)));
  const level: PipLevel = grade >= 60 ? 'high' : grade >= 50 ? 'mid' : 'low';

  return (
    <div className={styles.scale80}>
      {Array.from({ length: totalPips }, (_, i) => (
        <div
          key={i}
          className={`${styles.scalePip} ${i < activePips ? PIP_CLASS[level] : ''}`}
        />
      ))}
    </div>
  );
}
