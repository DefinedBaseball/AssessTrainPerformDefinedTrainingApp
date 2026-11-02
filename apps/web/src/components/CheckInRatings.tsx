'use client';

/* The three 1-5 questions asked at check-in -- how the athlete feels, slept
   and ate -- as tappable bubbles (CheckInFlow) and as a read-only row (the
   coach's Attendance view and the athlete's check-in history). */

import styles from './CheckInRatings.module.css';

export type CheckInRatingKey = 'feelRating' | 'sleepRating' | 'eatRating';

export const CHECK_IN_RATINGS: { key: CheckInRatingKey; question: string }[] = [
  { key: 'feelRating', question: 'How do you feel?' },
  { key: 'sleepRating', question: 'How did you sleep?' },
  { key: 'eatRating', question: 'How did you eat?' },
];

/** 1-2 low (red), 3 middling (amber), 4-5 good (green). */
function tone(n: number): string {
  return n <= 2 ? styles.low : n === 3 ? styles.mid : styles.high;
}

/** Five bubbles, 1 (poor) to 5 (great). */
export function RatingPicker({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div className={styles.picker}>
      <span className={styles.question} id={id}>{label}</span>
      <div className={styles.bubbles} role="radiogroup" aria-labelledby={id}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`${styles.bubble} ${value === n ? `${styles.on} ${tone(n)}` : ''}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>Poor</span>
        <span>Great</span>
      </div>
    </div>
  );
}

/** Read-only: the five bubbles with the answer filled in, or "Not answered". */
export function RatingReadout({ value }: { value: number | null | undefined }) {
  if (value == null) return <em className={styles.none}>Not answered</em>;
  return (
    <span className={styles.readout} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`${styles.dot} ${n === value ? `${styles.on} ${tone(n)}` : ''}`}>{n}</span>
      ))}
    </span>
  );
}
