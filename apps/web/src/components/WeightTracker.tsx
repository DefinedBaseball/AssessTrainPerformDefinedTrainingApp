'use client';

/* ─────────────────────────────────────────────────────────────────────
   Weight tracker -- the athlete's weigh-ins over time.

   A trigger (the Edit Profile weight field, or the WT readout in the
   profile's name bubble) opens a small dropdown: the last 10 weigh-ins
   (date, weight, change from the one before) and "+ New Entry" (date +
   weight). Coaches and the athlete can add / remove entries; parents and
   view-only coaches just see the list. The newest weigh-in is the
   athlete's current weight everywhere (the API keeps Player.weightLbs in
   step), and a 'player:weightChanged' window event lets the profile's WT
   readout and the Weight trend refresh without a reload.
   ───────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import styles from './WeightTracker.module.css';

export const WEIGHT_CHANGED_EVENT = 'player:weightChanged';

/** Fired after an add / remove: detail = { playerId, weightLbs } (newest). */
export type WeightChangedDetail = { playerId: string; weightLbs: number | null };

/** Today in the user's own time zone, "YYYY-MM-DD". */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function WeightTracker({
  playerId, canEdit, children, triggerClassName, triggerTitle,
}: {
  playerId: string;
  /** Coaches (not view-only) and the athlete themself. */
  canEdit: boolean;
  /** What the trigger shows (e.g. "185 lb ▾", or the WT readout). */
  children: React.ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  /* 11 so the 10th row can still show its change from the one before. */
  const [entries, setEntries] = useState<api.WeightEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(localToday);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);

  const load = useCallback(() => {
    setLoadError('');
    api.getWeightEntries(playerId, 11)
      .then(setEntries)
      .catch((e: any) => setLoadError(e?.message || 'Could not load weigh-ins.'));
  }, [playerId]);

  useEffect(() => {
    if (!open) { setAdding(false); setConfirmId(null); setError(''); return; }
    load();
  }, [open, load]);

  /* Pinned to the screen under the trigger (or above it when there's more
     room), kept inside the window, following it on scroll. Rendered in a
     portal so no bubble's overflow or transform can clip or shift it. */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth, vh = window.innerHeight, m = 8;
      const width = Math.min(320, vw - 2 * m);
      const left = Math.max(m, Math.min(r.left, vw - width - m));
      const below = vh - r.bottom - m, above = r.top - m;
      const up = below < 260 && above > below;
      setPos(up
        ? { left, width, bottom: vh - r.top + 6, maxHeight: above - 6 }
        : { left, width, top: r.bottom + 6, maxHeight: below - 6 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  /* Close on a click outside (trigger + panel) or Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const announce = (list: api.WeightEntry[]) => {
    window.dispatchEvent(new CustomEvent<WeightChangedDetail>(WEIGHT_CHANGED_EVENT, {
      detail: { playerId, weightLbs: list[0]?.weightLbs ?? null },
    }));
  };

  const save = async () => {
    const lbs = Number(value);
    if (!value.trim() || !Number.isFinite(lbs)) { setError('Enter a weight.'); return; }
    setSaving(true);
    setError('');
    try {
      const list = await api.addWeightEntry(playerId, { weightLbs: lbs, recordedOn: day });
      setEntries(list);
      announce(list);
      setAdding(false);
      setValue('');
      setDay(localToday());
    } catch (e: any) {
      setError(e?.message || 'Could not save that weigh-in.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    setError('');
    try {
      const list = await api.deleteWeightEntry(playerId, id);
      setEntries(list);
      announce(list);
      setConfirmId(null);
    } catch (e: any) {
      setError(e?.message || 'Could not remove that weigh-in.');
    } finally {
      setSaving(false);
    }
  };

  const shown = (entries || []).slice(0, 10);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={triggerTitle ?? 'Weight history'}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          style={pos ?? { visibility: 'hidden' }}
          role="dialog"
          aria-label="Weight history"
        >
          <div className={styles.head}>
            <span className={styles.title}>Weight</span>
            <span className={styles.sub}>Last 10 weigh-ins</span>
          </div>

          {canEdit && (adding ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span>Date</span>
                <input type="date" value={day} max={localToday()} onChange={(e) => setDay(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Weight (lb)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={50}
                  max={500}
                  placeholder="185"
                  value={value}
                  autoFocus
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                />
              </label>
              <div className={styles.formBtns}>
                <button type="button" className={styles.save} disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={styles.cancel} onClick={() => { setAdding(false); setError(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.newEntry} onClick={() => { setAdding(true); setDay(localToday()); }}>
              + New Entry
            </button>
          ))}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.list}>
            {loadError ? (
              <div className={styles.empty}>{loadError}</div>
            ) : entries === null ? (
              <div className={styles.empty}>Loading…</div>
            ) : shown.length === 0 ? (
              <div className={styles.empty}>No weigh-ins yet.</div>
            ) : shown.map((e, i) => {
              const prev = (entries || [])[i + 1];
              const diff = prev ? e.weightLbs - prev.weightLbs : null;
              if (confirmId === e.id) {
                return (
                  <div key={e.id} className={`${styles.row} ${styles.rowConfirm}`}>
                    <span>Remove {e.weightLbs} lb ({formatDay(e.recordedOn)})?</span>
                    <span className={styles.confirmBtns}>
                      <button type="button" disabled={saving} onClick={() => void remove(e.id)}>Yes</button>
                      <button type="button" onClick={() => setConfirmId(null)}>No</button>
                    </span>
                  </div>
                );
              }
              return (
                <div key={e.id} className={`${styles.row} ${i === 0 ? styles.rowLatest : ''}`}>
                  <span className={styles.date}>{formatDay(e.recordedOn)}</span>
                  <span className={styles.lbs}>{e.weightLbs} lb</span>
                  <span className={styles.diff}>
                    {diff === null ? '' : diff === 0 ? '±0' : diff > 0 ? `▲ ${diff}` : `▼ ${Math.abs(diff)}`}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => setConfirmId(e.id)}
                      title="Remove this weigh-in"
                      aria-label={`Remove ${e.weightLbs} lb from ${formatDay(e.recordedOn)}`}
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * The athlete's current weight, kept live: starts from the profile's value
 * and follows 'player:weightChanged' (a weigh-in added / removed anywhere).
 */
export function useLiveWeight(playerId: string | undefined, initial: number | null | undefined) {
  const [weight, setWeight] = useState<number | null>(initial ?? null);
  useEffect(() => { setWeight(initial ?? null); }, [initial]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<WeightChangedDetail>).detail;
      if (d && d.playerId === playerId) setWeight(d.weightLbs);
    };
    window.addEventListener(WEIGHT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WEIGHT_CHANGED_EVENT, onChange);
  }, [playerId]);
  return weight;
}
