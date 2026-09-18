'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Clear Schedule — empty the selected athlete's calendar over a range.

   Sits beside Apply Calendar. Offers Day / Week / Everything, each showing
   how much it would actually remove, fetched when the menu opens: an empty
   range is visible before the click rather than arriving as a server error
   after it.

   Destructive, so a scope click arms a confirm rather than firing. Every
   clear is logged, so the banner it produces can undo it.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import styles from './page.module.css';

export type ClearScope = 'day' | 'week' | 'all';

function fmt(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });
}

export function ClearScheduleMenu({
  open,
  onClose,
  playerId,
  playerName,
  dayDate,
  weekStart,
  weekEnd,
  onCleared,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerName: string;
  /** The day currently in view. */
  dayDate: string;
  weekStart: string;
  weekEnd: string;
  onCleared: (summary: string, logId: string) => void;
}) {
  const [counts, setCounts] = useState<Record<ClearScope, number> | null>(null);
  const [armed, setArmed] = useState<ClearScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setArmed(null);
    setError('');
    setCounts(null);
    let cancelled = false;
    api.getScheduledDrills(playerId)
      .then(rows => {
        if (cancelled) return;
        setCounts({
          day: rows.filter(r => r.date === dayDate).length,
          week: rows.filter(r => r.date >= weekStart && r.date <= weekEnd).length,
          all: rows.length,
        });
      })
      .catch(() => { if (!cancelled) setCounts({ day: 0, week: 0, all: 0 }); });
    return () => { cancelled = true; };
  }, [open, playerId, dayDate, weekStart, weekEnd]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const options = useMemo(() => ([
    { scope: 'day' as ClearScope, label: 'Clear Day', sub: fmt(dayDate) },
    { scope: 'week' as ClearScope, label: 'Clear Week', sub: `${fmt(weekStart)} – ${fmt(weekEnd)}` },
    { scope: 'all' as ClearScope, label: 'Clear All', sub: 'Every scheduled day' },
  ]), [dayDate, weekStart, weekEnd]);

  if (!open) return null;

  const run = async (scope: ClearScope) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.clearSchedule({
        playerId,
        /* "all" sends no bounds at all — see the API note on why the range is
           explicit dates rather than a keyword. */
        startDate: scope === 'day' ? dayDate : scope === 'week' ? weekStart : undefined,
        endDate: scope === 'day' ? dayDate : scope === 'week' ? weekEnd : undefined,
      });
      onCleared(res.summary, res.logId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to clear');
      setArmed(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clearWrap} ref={wrapRef}>
      <div className={styles.clearPanel}>
        <div className={styles.applyHead}>
          <span className={styles.applyTitle}>Clear Schedule</span>
          <button type="button" className={styles.applyClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.applySub}>
          Removes {playerName}&rsquo;s scheduled drills. This can be undone right after.
        </div>

        {error && <div className={styles.applyError}>{error}</div>}

        <div className={styles.clearList}>
          {options.map(o => {
            const n = counts?.[o.scope];
            const empty = counts != null && n === 0;
            const isArmed = armed === o.scope;
            return (
              <div key={o.scope} className={styles.clearOption}>
                <div className={styles.clearOptionText}>
                  <span className={styles.clearOptionLabel}>{o.label}</span>
                  <span className={styles.clearOptionSub}>
                    {o.sub}
                    {counts != null && ` · ${n} drill${n === 1 ? '' : 's'}`}
                  </span>
                </div>
                {isArmed ? (
                  <span className={styles.clearConfirmRow}>
                    <button
                      type="button"
                      className={styles.applyCancel}
                      disabled={busy}
                      onClick={() => setArmed(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.clearGo}
                      disabled={busy}
                      onClick={() => run(o.scope)}
                    >
                      {busy ? '…' : 'Confirm'}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.clearBtn}
                    disabled={empty || counts == null || busy}
                    title={empty ? 'Nothing scheduled in this range' : undefined}
                    onClick={() => setArmed(o.scope)}
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
