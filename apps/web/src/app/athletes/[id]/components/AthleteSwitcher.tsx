'use client';

/* Quick switch between athletes from inside a profile (coaches only).

   Sits beside "← Athletes" so a coach can jump straight to the next
   athlete instead of going back to the roster. Lists the same athletes the
   Athlete Hub's main roster does -- active athletes, A–Z by "First Last" --
   plus the one being viewed if they happen to be locked, so the control
   always shows who is on screen.

   A native <select>: on a phone it opens the system picker, which scrolls
   a long roster far better than a custom menu would. */

import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import styles from '../page.module.css';

export function AthleteSwitcher({
  currentId, currentName, onSwitch,
}: {
  currentId: string;
  currentName: string;
  onSwitch: (playerId: string) => void;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPlayers()
      .then((list) => { if (!cancelled) setPlayers(list); })
      .catch(() => { if (!cancelled) setPlayers([]); });
    return () => { cancelled = true; };
  }, []);

  const options = useMemo(() => {
    const roster = (players ?? [])
      .filter((p) => p.positions !== 'COACH')
      .filter((p) => p.id === currentId || !api.isPlayerLocked(p))
      .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }));
    /* Until the roster arrives (or if it fails), still show the athlete on
       screen so the control never reads blank. */
    if (!roster.some((o) => o.id === currentId)) roster.push({ id: currentId, name: currentName });
    return roster.sort((a, b) => a.name.localeCompare(b.name));
  }, [players, currentId, currentName]);

  return (
    <label className={styles.athleteSwitch}>
      <span className={styles.srOnly}>Switch athlete</span>
      <select
        value={currentId}
        onChange={(e) => { if (e.target.value !== currentId) onSwitch(e.target.value); }}
        title="Switch to another athlete"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}
