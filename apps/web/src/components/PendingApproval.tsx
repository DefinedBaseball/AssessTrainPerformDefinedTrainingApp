'use client';

/* Holding screen shown to a self-registered player while their account is
   PENDING. Polls /auth/me every 15s (plus a manual "Check again") so the
   moment a coach approves them, `isPending` flips false and AppShell swaps
   straight to the real app — no re-login needed. */

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import styles from './PendingApproval.module.css';

export function PendingApproval() {
  const { user, logout, refresh } = useAuth();

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.iconCircle}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h1 className={styles.title}>Waiting for coach approval</h1>
        <p className={styles.body}>
          Thanks for signing up{user?.email ? `, ${user.email}` : ''}. Your account is pending —
          a coach will review and approve your access shortly.
        </p>
        <p className={styles.hint}>This screen updates automatically once you’re approved.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void refresh()}>
            Check again
          </button>
          <button type="button" className={styles.ghost} onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
