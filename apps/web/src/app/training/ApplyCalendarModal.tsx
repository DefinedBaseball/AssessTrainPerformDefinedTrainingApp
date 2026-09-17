'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Apply Calendar — push one athlete's forward schedule onto a group.

   Sits beside the Athlete selector. Offers the athlete-type tags (Winter /
   Summer / Fall Program, Membership, Lesson, Remote) and every athlete
   individually; both are multi-select and they union together, so a coach can
   tick "Winter Program" and then add a couple of one-offs.

   This writes to other people's calendars and REPLACES what is there on the
   copied dates, so it never fires straight off the Apply button — Apply
   resolves the selection into a concrete count and asks first.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { ATHLETE_TYPES, parseAthleteTypes } from '@/lib/athlete-types';
import styles from './page.module.css';

/** "2026-04-01" → "Apr 1, 2026" — parsed as LOCAL midnight, never UTC. */
function formatFromDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function ApplyCalendarModal({
  open,
  onClose,
  players,
  sourcePlayer,
  fromDate,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  sourcePlayer: Player | null | undefined;
  /** Copy from this date forward — today. */
  fromDate: string;
  onApplied: (summary: string) => void;
}) {
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [checkedPlayers, setCheckedPlayers] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  /* What the copy will actually carry. Fetched when the panel opens so the
     coach sees "3 days · 12 drills" BEFORE committing — the alternative was
     finding out via a server error after pressing Apply. */
  const [preview, setPreview] = useState<{ days: number; drills: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Reset every time it opens: a stale selection from last time is exactly
     the kind of thing that quietly overwrites the wrong group. */
  useEffect(() => {
    if (!open) return;
    setCheckedTypes(new Set());
    setCheckedPlayers(new Set());
    setConfirming(false);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open || !sourcePlayer) { setPreview(null); return; }
    let cancelled = false;
    setPreview(null);
    api.getScheduledDrills(sourcePlayer.id)
      .then(rows => {
        if (cancelled) return;
        const forward = rows.filter(r => r.date >= fromDate);
        setPreview({ days: new Set(forward.map(r => r.date)).size, drills: forward.length });
      })
      .catch(() => { if (!cancelled) setPreview({ days: 0, drills: 0 }); });
    return () => { cancelled = true; };
  }, [open, sourcePlayer, fromDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  /* How many athletes each tag currently covers — shown next to the tag so
     "Winter Program" is never a blind selection. The source is excluded
     because it is skipped on apply. */
  const countForType = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of ATHLETE_TYPES) {
      /* Locked athletes are paused, so a program's count must not promise to
         reach them — the server refuses them too. */
      out[t.key] = players.filter(
        p => p.id !== sourcePlayer?.id
          && !api.isPlayerLocked(p)
          && parseAthleteTypes(p.athleteTypes).includes(t.key),
      ).length;
    }
    return out;
  }, [players, sourcePlayer]);

  /* Tags and individual picks union together, and the source athlete is
     always removed — a coach ticking the tag the source itself carries must
     not wipe the calendar they are copying FROM. */
  const targetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of players) {
      if (p.id === sourcePlayer?.id || api.isPlayerLocked(p)) continue;
      if (parseAthleteTypes(p.athleteTypes).some(t => checkedTypes.has(t))) ids.add(p.id);
    }
    for (const id of checkedPlayers) {
      if (id !== sourcePlayer?.id) ids.add(id);
    }
    return [...ids];
  }, [players, checkedTypes, checkedPlayers, sourcePlayer]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) =>
      (a.lastName || '').localeCompare(b.lastName || '') ||
      (a.firstName || '').localeCompare(b.firstName || ''),
    ),
    [players],
  );

  if (!open) return null;

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
    setConfirming(false);
  };

  const handleApply = async () => {
    if (!sourcePlayer || targetIds.length === 0) return;
    setApplying(true);
    setError('');
    try {
      const res = await api.applyCalendarToPlayers({
        sourcePlayerId: sourcePlayer.id,
        targetPlayerIds: targetIds,
        fromDate,
      });
      onApplied(
        `Applied ${sourcePlayer.firstName}'s calendar — ${res.drillsPerPlayer} drill${res.drillsPerPlayer === 1 ? '' : 's'} across ${res.dates} day${res.dates === 1 ? '' : 's'} to ${res.players} athlete${res.players === 1 ? '' : 's'}.`,
      );
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to apply the calendar');
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={styles.applyWrap} ref={wrapRef}>
      <div className={styles.applyPanel}>
        <div className={styles.applyHead}>
          <span className={styles.applyTitle}>Apply Calendar</span>
          <button type="button" className={styles.applyClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.applySub}>
          Copies {sourcePlayer ? `${sourcePlayer.firstName} ${sourcePlayer.lastName}’s` : 'this athlete’s'} schedule
          from <strong>{formatFromDate(fromDate)}</strong> forward. Selected athletes have their
          drills replaced on those dates.
          {preview && (
            <span className={preview.days === 0 ? styles.applyNothing : styles.applyPreview}>
              {preview.days === 0
                ? ' Nothing is scheduled from this date — move to a date with drills on it.'
                : ` ${preview.days} day${preview.days === 1 ? '' : 's'} · ${preview.drills} drill${preview.drills === 1 ? '' : 's'}.`}
            </span>
          )}
        </div>

        {/* Action row sits ABOVE the list, not below it. Below, it was the
            last thing in a 330px panel anchored to a trigger near the right
            edge of the page — the Apply button rendered off-screen and the
            control looked like it simply did not exist. Top also means it
            never scrolls away as the athlete list grows. */}
        {error && <div className={styles.applyError}>{error}</div>}

        <div className={styles.applyActions}>
          {confirming ? (
            <>
              <span className={styles.applyConfirmText}>
                Replace schedules for {targetIds.length} athlete{targetIds.length === 1 ? '' : 's'}?
              </span>
              <button type="button" className={styles.applyCancel} onClick={() => setConfirming(false)} disabled={applying}>
                Cancel
              </button>
              <button type="button" className={styles.applyGo} onClick={handleApply} disabled={applying}>
                {applying ? 'Applying…' : 'Yes, apply'}
              </button>
            </>
          ) : (
            <>
              <span className={styles.applyCount}>
                {targetIds.length} selected
              </span>
              <button
                type="button"
                className={styles.applyGo}
                disabled={targetIds.length === 0 || !sourcePlayer || preview?.days === 0}
                title={preview?.days === 0 ? 'Nothing scheduled from this date forward' : undefined}
                onClick={() => setConfirming(true)}
              >
                Apply
              </button>
            </>
          )}
        </div>

        <div className={styles.applyBody}>
          <div className={styles.applyGroupLabel}>Programs</div>
          {ATHLETE_TYPES.map(t => (
            <label key={t.key} className={styles.applyItem}>
              <input
                type="checkbox"
                className={styles.applyCheckbox}
                checked={checkedTypes.has(t.key)}
                onChange={() => toggle(checkedTypes, t.key, setCheckedTypes)}
              />
              <span className={styles.applyItemName}>{t.label}</span>
              <span className={styles.applyItemCount}>{countForType[t.key] ?? 0}</span>
            </label>
          ))}

          <div className={styles.applyGroupLabel}>Athletes</div>
          {sortedPlayers.map(p => {
            const isSource = p.id === sourcePlayer?.id;
            const locked = api.isPlayerLocked(p);
            /* Already covered by a ticked program — shown ticked and locked so
               the count and the list never disagree. */
            const viaType = !isSource && !locked && parseAthleteTypes(p.athleteTypes).some(t => checkedTypes.has(t));
            return (
              <label
                key={p.id}
                className={`${styles.applyItem} ${isSource || locked ? styles.applyItemDisabled : ''}`}
                title={
                  isSource ? 'This is the calendar being copied from'
                    : locked ? 'This athlete is locked — unlock them to schedule training'
                      : undefined
                }
              >
                <input
                  type="checkbox"
                  className={styles.applyCheckbox}
                  disabled={isSource || locked || viaType}
                  checked={!isSource && !locked && (viaType || checkedPlayers.has(p.id))}
                  onChange={() => toggle(checkedPlayers, p.id, setCheckedPlayers)}
                />
                <span className={styles.applyItemName}>
                  {p.firstName} {p.lastName}
                  {isSource && <span className={styles.applyItemNote}> — source</span>}
                  {locked && <span className={styles.applyItemNote}> — locked</span>}
                </span>
              </label>
            );
          })}
        </div>

      </div>
    </div>
  );
}
