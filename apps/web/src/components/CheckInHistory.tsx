'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Check-In history — the athlete's own record, inside the bell.

   Lists every day they had drills scheduled, whether they checked in and
   whether they finished. Days they skipped still appear: a missed session
   is part of the record, and hiding it would make the list look like a
   highlight reel rather than a log.

   Selecting a day opens that day's answers in place.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import styles from './CheckInHistory.module.css';

function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Local YYYY-MM-DD — training days are calendar days, not UTC instants. */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Status for one row.
 *
 * "Missed" is only ever said about a day that has already passed. A day in
 * the future hasn't been missed, and neither has today while it is still
 * running — labelling either one that way told athletes they'd failed at
 * sessions they hadn't reached yet.
 */
function statusOf(d: api.CheckInDay, isNext: boolean, today: string): { label: string; cls: string } {
  if (isNext) return { label: 'Next Day', cls: styles.pillNext };
  if (d.finished) return { label: 'Finished', cls: styles.pillDone };
  if (d.checkedIn) return { label: 'In progress', cls: styles.pillOpen };
  if (d.date >= today) return { label: 'Today', cls: styles.pillNext };
  return { label: 'Missed', cls: styles.pillMissed };
}

export function CheckInHistory({ playerId }: { playerId: string }) {
  const [days, setDays] = useState<api.CheckInDay[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPlayerCheckIns(playerId)
      .then((d) => { if (!cancelled) setDays(d); })
      .catch(() => { if (!cancelled) setDays([]); });
    return () => { cancelled = true; };
  }, [playerId]);

  if (days === null) {
    return <div className={styles.state}>Loading…</div>;
  }
  if (days.length === 0) {
    return (
      <div className={styles.state}>
        <p className={styles.emptyTitle}>No sessions yet</p>
        <p className={styles.emptyHint}>
          Days your coach schedules drills will show up here.
        </p>
      </div>
    );
  }

  /* Ordering, and what is hidden:
       row 1  the next training day still to come, if there is one
       row 2  today, else the most recent training day
       rest   descending history

     The API hands back every scheduled date newest-first; all of the
     reshaping is here because it is a presentation decision — the coach's
     day view wants the raw list. */
  const today = todayStr();
  const past = days.filter((d) => d.date <= today);
  const future = days.filter((d) => d.date > today);
  /* Earliest future date — the list arrives descending, so that is the last
     element rather than the first. */
  const nextDay = future.length > 0 ? future[future.length - 1] : null;
  const ordered = nextDay ? [nextDay, ...past] : past;

  const selected = open ? ordered.find((d) => d.date === open) ?? null : null;

  /* Detail replaces the list rather than expanding inline — the popover is
     narrow, and three free-text answers need the whole width to be readable. */
  if (selected) {
    return (
      <div className={styles.detail}>
        <button type="button" className={styles.back} onClick={() => setOpen(null)}>
          ‹ All sessions
        </button>
        <div className={styles.detailHead}>
          <span className={styles.detailDate}>{dayLabel(selected.date)}</span>
          <span className={`${styles.pill} ${statusOf(selected, selected.date === nextDay?.date, today).cls}`}>
            {statusOf(selected, selected.date === nextDay?.date, today).label}
          </span>
        </div>

        {selected.date > today && !selected.checkedIn ? (
          <div className={styles.upcoming}>
            {selected.drillCount} drill{selected.drillCount === 1 ? '' : 's'} scheduled.
            You&rsquo;ll check in when the day comes around.
          </div>
        ) : (
        <>
        <div className={styles.qa}>
          <span className={styles.q}>What is one area of focus for today&rsquo;s session?</span>
          <span className={styles.a}>{selected.focus || <em className={styles.none}>Not answered</em>}</span>
        </div>
        <div className={styles.qa}>
          <span className={styles.q}>Did you execute your goal?</span>
          <span className={styles.a}>{selected.executedGoal || <em className={styles.none}>Not answered</em>}</span>
        </div>
        <div className={styles.qa}>
          <span className={styles.q}>What did you learn?</span>
          <span className={styles.a}>{selected.learned || <em className={styles.none}>Not answered</em>}</span>
        </div>
        </>
        )}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {ordered.map((d) => {
        const isNext = d.date === nextDay?.date;
        const st = statusOf(d, isNext, today);
        return (
          <button
            key={d.date}
            type="button"
            className={styles.row}
            onClick={() => setOpen(d.date)}
          >
            <span className={styles.rowMain}>
              <span className={styles.rowDate}>{dayLabel(d.date)}</span>
              <span className={styles.rowMeta}>
                {d.drillCount} drill{d.drillCount === 1 ? '' : 's'}
                {d.focus ? ` · ${d.focus}` : ''}
              </span>
            </span>
            <span className={`${styles.pill} ${st.cls}`}>{st.label}</span>
          </button>
        );
      })}
    </div>
  );
}
