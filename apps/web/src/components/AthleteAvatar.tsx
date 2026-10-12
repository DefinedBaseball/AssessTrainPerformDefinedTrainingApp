'use client';

/* An athlete's round avatar: their profile picture when they have one,
   their initials otherwise. `className` supplies the circle (size, colour,
   border) from the page using it; the photo fills it. */

import styles from './AthleteAvatar.module.css';

export function AthleteAvatar({ photo, firstName, lastName, className, style }: {
  photo?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}` || '?';
  return (
    <span className={`${className ?? ''} ${photo ? styles.hasPhoto : ''}`} style={style}>
      {photo ? <img src={photo} alt="" className={styles.photo} /> : initials}
    </span>
  );
}
