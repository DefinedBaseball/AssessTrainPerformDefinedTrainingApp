'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Recent Changes — the last 10 Apply Calendar / Clear changes, each with
   Undo, so closing the banner is no longer the end of the way back.

   Undo restores exactly what that change removed and drops what it added.
   When a LATER change is still standing (it may have touched the same days)
   the confirm step says so, because undoing the older one can then double
   up workouts on those days.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import { tzOpt } from '@/lib/academy';
import styles from './page.module.css';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...tzOpt(),
  });
}

export function RecentChangesModal({
  open,
  onClose,
  onUndone,
}: {
  open: boolean;
  onClose: () => void;
  /** Banner text after an undo; the page also refetches its calendar. */
  onUndone: (summary: string) => void;
}) {
  const [rows, setRows] = useState<api.CalendarChange[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setArmed(null);
    setError('');
    let cancelled = false;
    api.listCalendarChanges()
      .then(r => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) { setRows([]); setError(e?.message || 'Could not load recent changes'); } });
    return () => { cancelled = true; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const undo = async (row: api.CalendarChange) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.undoCalendarChange(row.id);
      onUndone(
        `Undone — restored ${res.restored} drill${res.restored === 1 ? '' : 's'}` +
        (res.discarded ? ` and removed ${res.discarded} that were added.` : '.'),
      );
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Undo failed');
      setArmed(null);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className={styles.applyPopOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className={`${styles.applyPop} ${styles.clearGroupPop}`} role="dialog" aria-label="Recent calendar changes">
        <div className={styles.applyHead} style={{ padding: 0, marginBottom: 6 }}>
          <span className={styles.applyPopTitle} style={{ margin: 0 }}>Recent Changes</span>
          <button type="button" className={styles.applyClose} onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>
        <p className={styles.applyPopSub}>
          The last 10 Apply Calendar and Clear changes by any coach. Undo puts back what a change removed and
          takes off what it added.
        </p>

        {error && <div className={styles.applyError}>{error}</div>}

        <div className={styles.recentList}>
          {rows === null && <div className={styles.recentEmpty}>Loading…</div>}
          {rows?.length === 0 && !error && <div className={styles.recentEmpty}>No changes yet.</div>}
          {rows?.map(r => (
            <div key={r.id} className={`${styles.recentRow} ${r.undone ? styles.recentRowUndone : ''}`}>
              <div className={styles.recentText}>
                <span className={styles.recentMeta}>
                  <span className={styles.recentKind}>{r.kind === 'CLEAR' ? 'Clear' : 'Apply'}</span>
                  {when(r.createdAt)}{r.actorName ? ` · ${r.actorName}` : ''}
                </span>
                <span className={styles.recentSummary}>{r.summary}</span>
                {armed === r.id && r.newerActive && (
                  <span className={styles.recentWarn}>
                    A later change is still in place. If it touched the same days, undoing this one can double up
                    workouts there.
                  </span>
                )}
              </div>
              <div className={styles.recentAction}>
                {r.undone ? (
                  <span className={styles.recentDone}>Undone</span>
                ) : armed === r.id ? (
                  <>
                    <button type="button" className={styles.applyCancel} disabled={busy} onClick={() => setArmed(null)}>Back</button>
                    <button type="button" className={styles.clearGo} disabled={busy} onClick={() => undo(r)}>
                      {busy ? '…' : 'Confirm'}
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.clearBtn} disabled={busy} onClick={() => setArmed(r.id)}>Undo</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
