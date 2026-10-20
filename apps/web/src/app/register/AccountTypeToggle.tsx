'use client';

/* "Create an account" asks Athlete or Parent: /register is the athlete form,
   /register/parent the parent one. Shown at the top of both (and on the
   athletes-closed screen, since parents can sign up any time). */

import Link from 'next/link';
import styles from './page.module.css';

export function AccountTypeToggle({ active }: { active: 'athlete' | 'parent' }) {
  return (
    <div className={styles.typeToggle} role="tablist" aria-label="Account type">
      <Link
        href="/register"
        role="tab"
        aria-selected={active === 'athlete'}
        className={`${styles.typeOption} ${active === 'athlete' ? styles.typeOptionActive : ''}`}
      >
        I’m an Athlete
      </Link>
      <Link
        href="/register/parent"
        role="tab"
        aria-selected={active === 'parent'}
        className={`${styles.typeOption} ${active === 'parent' ? styles.typeOptionActive : ''}`}
      >
        I’m a Parent
      </Link>
    </div>
  );
}
