'use client';

/* Admin-only, permanent athlete delete -- shared by the Edit Profile window
   and the Athlete Hub list. The coach must type the athlete's full name
   before Delete unlocks, since nothing can be recovered afterwards. Rendered
   into <body> so it sits above the Edit Profile modal it can open from. */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import styles from './DeleteAthleteDialog.module.css';

interface DeleteAthleteDialogProps {
  player: { id: string; firstName: string; lastName: string };
  onClose: () => void;
  /** Called after the account is gone, with the athlete's name. */
  onDeleted: (name: string) => void;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function DeleteAthleteDialog({ player, onClose, onDeleted }: DeleteAthleteDialogProps) {
  const fullName = `${player.firstName} ${player.lastName}`.trim();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = norm(typed) === norm(fullName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAthlete(player.id);
      onDeleted(fullName);
    } catch (e: any) {
      setError(e?.message || 'Could not delete this athlete.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-athlete-title">
        <h2 id="delete-athlete-title" className={styles.title}>Delete {fullName}?</h2>
        <p className={styles.text}>
          This permanently deletes their account and everything in it: profile, photo, reports,
          metrics, videos, schedules, check-ins, stats, messages and notifications.
          <strong> It cannot be undone.</strong>
        </p>
        <p className={styles.text}>
          To keep their data but stop their access, lock them instead.
        </p>
        <label className={styles.label} htmlFor="delete-athlete-confirm">
          Type <strong>{fullName}</strong> to confirm
        </label>
        <input
          id="delete-athlete-confirm"
          className={styles.input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void remove(); }}
          autoComplete="off"
          autoFocus
          disabled={busy}
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={styles.deleteBtn} onClick={() => void remove()} disabled={!matches || busy}>
            {busy ? 'Deleting…' : 'Delete athlete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* The bottom-of-Edit-Profile block: a short warning plus the button that
   opens the confirmation above. The caller decides who sees it (admins). */
export function DeleteAthleteSection({ player, onDeleted }: {
  player: { id: string; firstName: string; lastName: string };
  onDeleted: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.section}>
      <div className={styles.sectionText}>
        <span className={styles.sectionTitle}>Delete athlete</span>
        <span className={styles.sectionHint}>Permanently removes this account and all of its data.</span>
      </div>
      <button type="button" className={styles.sectionBtn} onClick={() => setOpen(true)}>
        Delete athlete
      </button>
      {open && (
        <DeleteAthleteDialog
          player={player}
          onClose={() => setOpen(false)}
          onDeleted={(name) => { setOpen(false); onDeleted(name); }}
        />
      )}
    </div>
  );
}
