'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Athlete group picker — the "Scheduled Programs / Athlete Types / Athletes"
   checklist shared by Apply Calendar and Clear for a Group.

   All three lists are multi-select and union together: tick "Hitting
   Program" and add a couple of one-offs by name. An athlete already covered
   by a ticked group shows ticked and locked, so the count and the list never
   disagree.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { ATHLETE_TYPES, parseAthleteTypes } from '@/lib/athlete-types';
import { activeScheduledPrograms, programColor, type FacilityProgram } from '@/lib/facility-schedule';
import styles from './page.module.css';

type Program = FacilityProgram;

export function useAthleteGroups({
  players,
  excludeId,
  fromDate,
  programs,
  includeLocked = false,
}: {
  players: Player[];
  /** Never a target (Apply's source athlete). */
  excludeId?: string | null;
  /** Programs count an athlete only while still running on this date. */
  fromDate: string;
  programs: Program[];
  /** Locked athletes are paused: Apply skips them; a clear may still reach them. */
  includeLocked?: boolean;
}) {
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [checkedSched, setCheckedSched] = useState<Set<string>>(new Set());
  const [checkedPlayers, setCheckedPlayers] = useState<Set<string>>(new Set());

  const reachable = useCallback(
    (p: Player) => p.id !== excludeId && (includeLocked || !api.isPlayerLocked(p)),
    [excludeId, includeLocked],
  );

  const schedById = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const p of players) out.set(p.id, activeScheduledPrograms(p.facilitySchedule, fromDate));
    return out;
  }, [players, fromDate]);

  const countForType = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of ATHLETE_TYPES) {
      out[t.key] = players.filter(p => reachable(p) && parseAthleteTypes(p.athleteTypes).includes(t.key)).length;
    }
    return out;
  }, [players, reachable]);

  const countForSched = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of programs) out[g.key] = players.filter(p => reachable(p) && schedById.get(p.id)?.has(g.key)).length;
    return out;
  }, [players, reachable, schedById, programs]);

  const inTickedGroup = useCallback(
    (p: Player) =>
      parseAthleteTypes(p.athleteTypes).some(t => checkedTypes.has(t))
      || [...(schedById.get(p.id) ?? [])].some(k => checkedSched.has(k)),
    [checkedTypes, checkedSched, schedById],
  );

  const targetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of players) if (reachable(p) && inTickedGroup(p)) ids.add(p.id);
    for (const id of checkedPlayers) if (id !== excludeId) ids.add(id);
    return [...ids];
  }, [players, reachable, inTickedGroup, checkedPlayers, excludeId]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) =>
      (a.firstName || '').localeCompare(b.firstName || '') || (a.lastName || '').localeCompare(b.lastName || '')),
    [players],
  );

  const flip = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  return {
    checkedTypes, checkedSched, checkedPlayers,
    toggleType: (k: string) => flip(checkedTypes, k, setCheckedTypes),
    toggleSched: (k: string) => flip(checkedSched, k, setCheckedSched),
    togglePlayer: (id: string) => flip(checkedPlayers, id, setCheckedPlayers),
    reset: () => { setCheckedTypes(new Set()); setCheckedSched(new Set()); setCheckedPlayers(new Set()); },
    countForType, countForSched, inTickedGroup, targetIds, sortedPlayers, reachable,
  };
}

export type AthleteGroups = ReturnType<typeof useAthleteGroups>;

export function AthleteGroupList({
  groups: g,
  programs,
  excludeId,
  excludeNote = 'source',
  includeLocked = false,
  programUsable,
  onChange,
}: {
  groups: AthleteGroups;
  programs: Program[];
  excludeId?: string | null;
  excludeNote?: string;
  includeLocked?: boolean;
  /** Greys a program out (e.g. the source has no days in it to copy). */
  programUsable?: (key: string) => { usable: boolean; title?: string };
  /** Any tick changed. */
  onChange?: () => void;
}) {
  const changed = (fn: () => void) => () => { fn(); onChange?.(); };
  return (
    <>
      <div className={styles.applyGroupLabel}>Scheduled Programs</div>
      {programs.map(pr => {
        const u = programUsable ? programUsable(pr.key) : { usable: true };
        return (
          <label
            key={pr.key}
            className={`${styles.applyItem} ${u.usable ? '' : styles.applyItemDisabled}`}
            title={u.title}
          >
            <input
              type="checkbox"
              className={styles.applyCheckbox}
              disabled={!u.usable}
              checked={u.usable && g.checkedSched.has(pr.key)}
              onChange={changed(() => g.toggleSched(pr.key))}
            />
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: programColor(pr.key), flex: '0 0 auto' }} />
            <span className={styles.applyItemName}>{pr.label}</span>
            <span className={styles.applyItemCount}>{g.countForSched[pr.key] ?? 0}</span>
          </label>
        );
      })}

      <div className={styles.applyGroupLabel}>Athlete Types</div>
      {ATHLETE_TYPES.map(t => (
        <label key={t.key} className={styles.applyItem}>
          <input
            type="checkbox"
            className={styles.applyCheckbox}
            checked={g.checkedTypes.has(t.key)}
            onChange={changed(() => g.toggleType(t.key))}
          />
          <span className={styles.applyItemName}>{t.label}</span>
          <span className={styles.applyItemCount}>{g.countForType[t.key] ?? 0}</span>
        </label>
      ))}

      <div className={styles.applyGroupLabel}>Athletes</div>
      {g.sortedPlayers.map(p => {
        const isExcluded = p.id === excludeId;
        const locked = !includeLocked && api.isPlayerLocked(p);
        const viaGroup = !isExcluded && !locked && g.inTickedGroup(p);
        return (
          <label
            key={p.id}
            className={`${styles.applyItem} ${isExcluded || locked ? styles.applyItemDisabled : ''}`}
            title={
              isExcluded ? 'This is the calendar being copied from'
                : locked ? 'This athlete is locked — unlock them to schedule training'
                  : undefined
            }
          >
            <input
              type="checkbox"
              className={styles.applyCheckbox}
              disabled={isExcluded || locked || viaGroup}
              checked={!isExcluded && !locked && (viaGroup || g.checkedPlayers.has(p.id))}
              onChange={changed(() => g.togglePlayer(p.id))}
            />
            <span className={styles.applyItemName}>
              {p.firstName} {p.lastName}
              {isExcluded && <span className={styles.applyItemNote}> — {excludeNote}</span>}
              {locked && <span className={styles.applyItemNote}> — locked</span>}
            </span>
          </label>
        );
      })}
    </>
  );
}
