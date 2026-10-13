'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { tzOpt } from '@/lib/academy';
import styles from './DeletionRequestBanner.module.css';

/* Shown to coaches on an athlete's profile when the athlete has asked
   (Settings → Delete account) for their account and data to be deleted.
   Admins confirm it here -- typing the athlete's name to unlock the
   permanent delete -- or keep the account. Other coaches just see the
   notice. */
export function DeletionRequestBanner({ player, requestedAt, isAdmin, onKept, onDeleted }: {
  player: { id: string; firstName: string; lastName: string };
  requestedAt: string;
  isAdmin: boolean;
  onKept: () => void;
  onDeleted: () => void;
}) {
  const fullName = `${player.firstName} ${player.lastName}`.trim();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<'delete' | 'keep' | null>(null);
  const [err, setErr] = useState('');
  const when = new Date(requestedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', ...tzOpt() });
  const nameMatches = typed.trim().toLowerCase() === fullName.toLowerCase();

  const remove = async () => {
    setBusy('delete'); setErr('');
    try {
      await api.deleteAthleteAccount(player.id);
      onDeleted();
    } catch (e: any) {
      setErr(e?.message || 'Could not delete the account.');
      setBusy(null);
    }
  };

  const keep = async () => {
    setBusy('keep'); setErr('');
    try {
      await api.dismissDeletionRequest(player.id);
      onKept();
    } catch (e: any) {
      setErr(e?.message || 'Could not update the request.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.banner} role="alert">
      <div className={styles.text}>
        <strong>{fullName} asked for their account to be deleted</strong> on {when}.
        {isAdmin
          ? ' Deleting permanently removes their account, profile, reports, measurements, videos, schedule, stats and messages. This can’t be undone.'
          : ' An admin needs to confirm it.'}
      </div>
      {isAdmin && !confirming && (
        <div className={styles.actions}>
          <button type="button" className={styles.keep} onClick={keep} disabled={!!busy}>
            {busy === 'keep' ? 'Saving…' : 'Keep account'}
          </button>
          <button type="button" className={styles.danger} onClick={() => { setConfirming(true); setErr(''); }} disabled={!!busy}>
            Delete permanently
          </button>
        </div>
      )}
      {isAdmin && confirming && (
        <div className={styles.confirm}>
          <label className={styles.confirmLabel} htmlFor="confirm-delete-name">
            Type <strong>{fullName}</strong> to confirm
          </label>
          <input
            id="confirm-delete-name"
            className={styles.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <div className={styles.actions}>
            <button type="button" className={styles.keep} onClick={() => { setConfirming(false); setTyped(''); }} disabled={!!busy}>
              Back
            </button>
            <button type="button" className={styles.danger} onClick={remove} disabled={!nameMatches || !!busy}>
              {busy === 'delete' ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </div>
      )}
      {err && <div className={styles.error}>{err}</div>}
    </div>
  );
}
