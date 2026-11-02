'use client';

/* Quick switch between athletes from inside a profile (coaches only).

   Sits beside "← Athletes" so a coach can jump straight to the next
   athlete instead of going back to the roster. Lists the same athletes the
   Athlete Hub's main roster does -- active athletes, A–Z by "First Last" --
   plus the one being viewed if they happen to be locked, so the control
   always shows who is on screen.

   Three filters follow it, like the Program board: Program narrows the
   list to athletes in that program, Day to those who train that weekday,
   and Time to those booked at that start time. They read each athlete's
   facility schedule (ended entries skipped) and are remembered for the tab,
   so they hold while a coach steps from athlete to athlete.

   Native <select>s: on a phone they open the system picker, which scrolls
   a long roster far better than a custom menu would. */

import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import {
  WEEKDAYS, type WeekdayKey, type FacilitySlot,
  parseFacilitySchedule, entryDates, formatTime12,
} from '@/lib/facility-schedule';
import { useFacilityPrograms } from '@/lib/use-facility-programs';
import styles from '../page.module.css';

const FILTER_STORE = 'athleteSwitch.filters';

interface SwitchFilters { program: string; day: WeekdayKey | ''; time: string }
const NO_FILTERS: SwitchFilters = { program: '', day: '', time: '' };

function readFilters(): SwitchFilters {
  try {
    const v = JSON.parse(sessionStorage.getItem(FILTER_STORE) || 'null');
    if (v && typeof v === 'object') return { ...NO_FILTERS, ...v };
  } catch { /* storage unavailable */ }
  return NO_FILTERS;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The start times an athlete's live entries give, honouring the program
 *  and day filters (time itself is matched by the caller). */
function timesFor(entries: FacilitySlot[], program: string, day: WeekdayKey | ''): string[] {
  const out: string[] = [];
  for (const s of entries) {
    if (program && s.program !== program) continue;
    for (const { key } of WEEKDAYS) {
      if (day && key !== day) continue;
      const t = s.days[key];
      if (t) out.push(t);
    }
  }
  return out;
}

export function AthleteSwitcher({
  currentId, currentName, onSwitch,
}: {
  currentId: string;
  currentName: string;
  onSwitch: (playerId: string) => void;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const programs = useFacilityPrograms();
  const [filters, setFilters] = useState<SwitchFilters>(NO_FILTERS);

  useEffect(() => { setFilters(readFilters()); }, []);

  const updateFilters = (next: SwitchFilters) => {
    setFilters(next);
    try { sessionStorage.setItem(FILTER_STORE, JSON.stringify(next)); } catch { /* ignore */ }
  };

  useEffect(() => {
    let cancelled = false;
    api.getPlayers()
      .then((list) => { if (!cancelled) setPlayers(list); })
      .catch(() => { if (!cancelled) setPlayers([]); });
    return () => { cancelled = true; };
  }, []);

  /* Every athlete the Hub lists, with their schedule entries still running. */
  const roster = useMemo(() => {
    const today = todayIso();
    return (players ?? [])
      .filter((p) => p.positions !== 'COACH')
      .filter((p) => p.id === currentId || !api.isPlayerLocked(p))
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        entries: parseFacilitySchedule(p.facilitySchedule)
          .filter((s) => { const { end } = entryDates(s); return !end || end >= today; }),
      }));
  }, [players, currentId]);

  const { program, day, time } = filters;
  const filtering = !!(program || day || time);

  /* Time choices: the start times booked under the Program/Day picks. */
  const timeChoices = useMemo(() => {
    const set = new Set<string>();
    for (const a of roster) for (const t of timesFor(a.entries, program, day)) set.add(t);
    if (time) set.add(time);
    return [...set].sort();
  }, [roster, program, day, time]);

  const options = useMemo(() => {
    const shown = roster
      .filter((a) => {
        if (!filtering) return true;
        const times = timesFor(a.entries, program, day);
        return time ? times.includes(time) : times.length > 0;
      })
      .map(({ id, name }) => ({ id, name }));
    const count = shown.length;
    /* The athlete on screen always stays in the list (until the roster
       arrives, or when the filters leave them out) so the control never
       reads blank or wrong. */
    if (!shown.some((o) => o.id === currentId)) {
      const me = roster.find((a) => a.id === currentId);
      shown.push({ id: currentId, name: me?.name || currentName });
    }
    return { list: shown.sort((a, b) => a.name.localeCompare(b.name)), count };
  }, [roster, filtering, program, day, time, currentId, currentName]);

  return (
    <span className={styles.athleteSwitchRow}>
      <label className={styles.athleteSwitch}>
        <span className={styles.srOnly}>Switch athlete</span>
        <select
          value={currentId}
          onChange={(e) => { if (e.target.value !== currentId) onSwitch(e.target.value); }}
          title={filtering ? `${options.count} athlete${options.count === 1 ? '' : 's'} match the filters` : 'Switch to another athlete'}
        >
          {options.list.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>

      <label className={styles.athleteSwitch}>
        <span className={styles.srOnly}>Filter by program</span>
        <select
          value={program}
          onChange={(e) => updateFilters({ ...filters, program: e.target.value, time: '' })}
          title="Only athletes in this program"
        >
          <option value="">All Programs</option>
          {programs.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.athleteSwitch}>
        <span className={styles.srOnly}>Filter by day</span>
        <select
          value={day}
          onChange={(e) => updateFilters({ ...filters, day: e.target.value as WeekdayKey | '', time: '' })}
          title="Only athletes who train this day"
        >
          <option value="">All Days</option>
          {WEEKDAYS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.athleteSwitch}>
        <span className={styles.srOnly}>Filter by time</span>
        <select
          value={time}
          onChange={(e) => updateFilters({ ...filters, time: e.target.value })}
          title="Only athletes booked at this time"
          disabled={!timeChoices.length}
        >
          <option value="">All Times</option>
          {timeChoices.map((t) => (
            <option key={t} value={t}>{formatTime12(t)}</option>
          ))}
        </select>
      </label>

      {filtering && (
        <>
          <span className={styles.athleteSwitchCount}>
            {options.count} athlete{options.count === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className={styles.athleteSwitchClear}
            onClick={() => updateFilters(NO_FILTERS)}
            title="Clear the filters"
          >Clear</button>
        </>
      )}
    </span>
  );
}
