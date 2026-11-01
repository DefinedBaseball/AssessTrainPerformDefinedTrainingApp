'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Apply Calendar — push one athlete's forward schedule onto a group.

   Sits beside the Athlete selector. Offers the scheduled programs (athletes
   with Hitting / Pitching / Catching / Strength days on their facility
   schedule), the athlete-type tags (Winter / Summer / Fall Program,
   Membership, Lesson, Remote) and every athlete individually; all are
   multi-select and they union together, so a coach can tick "Hitting
   Program" and then add a couple of one-offs.

   This writes to other people's calendars and REPLACES what is there on the
   copied dates, so it never fires straight off the Apply button — Apply
   opens a pop-up that asks which workout types (Hitting, Pitching, ...) to
   copy and names how many athletes it will touch. Ticking only some types
   copies just those and replaces just those on the targets; their other
   workouts on those dates are left alone.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { ATHLETE_TYPES, parseAthleteTypes } from '@/lib/athlete-types';
import { activeScheduledPrograms, programColor, FACILITY_GROUPS as SCHEDULE_GROUPS } from '@/lib/facility-schedule';
import { TAB_LABELS, TAB_COLORS } from '@/lib/training-colors';
import styles from './page.module.css';

/** Workout types in calendar order, for the pop-up's checkboxes. */
const WORKOUT_ORDER = ['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength'];

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
  /** Summary line plus the id that can roll this apply back. */
  onApplied: (summary: string, logId: string) => void;
}) {
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [checkedSched, setCheckedSched] = useState<Set<string>>(new Set());
  const [checkedPlayers, setCheckedPlayers] = useState<Set<string>>(new Set());
  /* The "which workouts?" pop-up, and what is ticked in it. */
  const [confirming, setConfirming] = useState(false);
  const [pickedTabs, setPickedTabs] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  /* What the copy will actually carry. Fetched when the panel opens so the
     coach sees "3 days · 12 drills" BEFORE committing — the alternative was
     finding out via a server error after pressing Apply. */
  const [preview, setPreview] = useState<{ days: number; drills: number; byTab: Record<string, number> } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /* The pop-up is portalled to <body>, outside wrapRef -- clicks in it must
     not count as "clicked away" and close the panel. */
  const popRef = useRef<HTMLDivElement>(null);

  /* Reset every time it opens: a stale selection from last time is exactly
     the kind of thing that quietly overwrites the wrong group. */
  useEffect(() => {
    if (!open) return;
    setCheckedTypes(new Set());
    setCheckedSched(new Set());
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
        const byTab: Record<string, number> = {};
        for (const r of forward) byTab[r.tab] = (byTab[r.tab] || 0) + 1;
        setPreview({ days: new Set(forward.map(r => r.date)).size, drills: forward.length, byTab });
      })
      .catch(() => { if (!cancelled) setPreview({ days: 0, drills: 0, byTab: {} }); });
    return () => { cancelled = true; };
  }, [open, sourcePlayer, fromDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (wrapRef.current && !wrapRef.current.contains(t)) onClose();
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

  /* Each athlete's scheduled programs that are still running on the copy's
     start date, so an athlete whose program ended isn't swept in. */
  const schedById = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const p of players) out.set(p.id, activeScheduledPrograms(p.facilitySchedule, fromDate));
    return out;
  }, [players, fromDate]);

  const countForSched = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of SCHEDULE_GROUPS) {
      out[g.key] = players.filter(
        p => p.id !== sourcePlayer?.id && !api.isPlayerLocked(p) && schedById.get(p.id)?.has(g.key),
      ).length;
    }
    return out;
  }, [players, sourcePlayer, schedById]);

  /** Is this athlete covered by a ticked tag or a ticked scheduled program? */
  const inTickedGroup = (p: Player) =>
    parseAthleteTypes(p.athleteTypes).some(t => checkedTypes.has(t))
    || [...(schedById.get(p.id) ?? [])].some(k => checkedSched.has(k));

  /* Tags and individual picks union together, and the source athlete is
     always removed — a coach ticking the tag the source itself carries must
     not wipe the calendar they are copying FROM. */
  const targetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of players) {
      if (p.id === sourcePlayer?.id || api.isPlayerLocked(p)) continue;
      if (inTickedGroup(p)) ids.add(p.id);
    }
    for (const id of checkedPlayers) {
      if (id !== sourcePlayer?.id) ids.add(id);
    }
    return [...ids];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inTickedGroup reads exactly these
  }, [players, checkedTypes, checkedSched, schedById, checkedPlayers, sourcePlayer]);

  /* First name, then last -- the order the rest of the app lists athletes. */
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) =>
      (a.firstName || '').localeCompare(b.firstName || '') ||
      (a.lastName || '').localeCompare(b.lastName || ''),
    ),
    [players],
  );

  /* Types the source actually has from the start date, in calendar order
     (anything unexpected goes last). */
  const sourceTabs = Object.keys(preview?.byTab ?? {}).sort((a, b) => {
    const ai = WORKOUT_ORDER.indexOf(a); const bi = WORKOUT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const pickedDrills = sourceTabs.filter(t => pickedTabs.has(t)).reduce((n, t) => n + (preview?.byTab[t] ?? 0), 0);

  if (!open) return null;

  const openPicker = () => {
    setPickedTabs(new Set(sourceTabs));
    setError('');
    setConfirming(true);
  };

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
      /* Every type ticked = the original whole-day replace (no filter), so
         a full apply still clears a target's other workouts on those dates
         and the group ends up matching the source. */
      const chosen = sourceTabs.filter(t => pickedTabs.has(t));
      const res = await api.applyCalendarToPlayers({
        sourcePlayerId: sourcePlayer.id,
        targetPlayerIds: targetIds,
        fromDate,
        ...(chosen.length < sourceTabs.length ? { tabs: chosen } : {}),
      });
      /* The server composes the summary now, so the banner and the log row
         can never disagree about what happened. */
      onApplied(res.summary, res.logId);
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
          <span className={styles.applyCount}>
            {targetIds.length} selected
          </span>
          <button
            type="button"
            className={styles.applyGo}
            disabled={targetIds.length === 0 || !sourcePlayer || !preview || preview.days === 0}
            title={preview?.days === 0 ? 'Nothing scheduled from this date forward' : undefined}
            onClick={openPicker}
          >
            Apply
          </button>
        </div>

        <div className={styles.applyBody}>
          {/* From each athlete's facility schedule (Upcoming Workouts). */}
          <div className={styles.applyGroupLabel}>Scheduled Programs</div>
          {SCHEDULE_GROUPS.map(g => (
            <label key={g.key} className={styles.applyItem}>
              <input
                type="checkbox"
                className={styles.applyCheckbox}
                checked={checkedSched.has(g.key)}
                onChange={() => toggle(checkedSched, g.key, setCheckedSched)}
              />
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: programColor(g.key), flex: '0 0 auto' }} />
              <span className={styles.applyItemName}>{g.label}</span>
              <span className={styles.applyItemCount}>{countForSched[g.key] ?? 0}</span>
            </label>
          ))}

          <div className={styles.applyGroupLabel}>Athlete Types</div>
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
            const viaType = !isSource && !locked && inTickedGroup(p);
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

      {/* ── Which workouts? ── the last step before anything is written. */}
      {confirming && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.applyPopOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !applying) setConfirming(false); }}
        >
          <div className={styles.applyPop} ref={popRef} role="dialog" aria-label="Choose workouts to apply">
            <div className={styles.applyPopTitle}>Apply which workouts?</div>
            <p className={styles.applyPopSub}>
              Copying {sourcePlayer ? `${sourcePlayer.firstName}’s` : 'this'} schedule to{' '}
              <strong>{targetIds.length} athlete{targetIds.length === 1 ? '' : 's'}</strong> from{' '}
              {formatFromDate(fromDate)}. The ticked workouts are replaced on those dates; anything
              left unticked stays as it is on their calendars.
            </p>
            <div className={styles.applyPopList}>
              {sourceTabs.map(tab => (
                <label key={tab} className={styles.applyPopItem}>
                  <input
                    type="checkbox"
                    className={styles.applyCheckbox}
                    checked={pickedTabs.has(tab)}
                    disabled={applying}
                    onChange={() => setPickedTabs(prev => { const n = new Set(prev); if (n.has(tab)) n.delete(tab); else n.add(tab); return n; })}
                  />
                  <span className={styles.applyPopDot} style={{ background: (TAB_COLORS[tab] || TAB_COLORS.hitting).text }} />
                  <span className={styles.applyItemName}>{TAB_LABELS[tab] || tab}</span>
                  <span className={styles.applyItemCount}>
                    {preview?.byTab[tab] ?? 0} drill{(preview?.byTab[tab] ?? 0) === 1 ? '' : 's'}
                  </span>
                </label>
              ))}
            </div>
            {error && <div className={styles.applyError}>{error}</div>}
            <div className={styles.applyPopActions}>
              <button type="button" className={styles.applyCancel} onClick={() => setConfirming(false)} disabled={applying}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.applyGo}
                onClick={handleApply}
                disabled={applying || pickedDrills === 0}
              >
                {applying ? 'Applying…' : `Apply ${pickedDrills} drill${pickedDrills === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
