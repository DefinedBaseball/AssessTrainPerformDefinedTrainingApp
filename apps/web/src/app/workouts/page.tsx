'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Athlete Workouts — the coach's view of a training day.

   Every athlete with drills scheduled on the date, and two facts about each:
   did they check in, did they finish. Both render as a green or red box so
   the roster reads at a glance without parsing text.

   The list is derived from the schedule — an athlete appears because a coach
   put work on their calendar, not because of any separate opt-in — so the
   day navigation below is really navigating the calendar.

   Selecting a row opens that athlete's three answers for the day.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '../athletes/page.module.css';
import styles from './page.module.css';

/** Local YYYY-MM-DD — a training day is the calendar day, not a UTC instant. */
function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fromDateStr(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
}
function shortLabel(s: string): string {
  return fromDateStr(s).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
function longLabel(s: string): string {
  return fromDateStr(s).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/* ── Month calendar ──
   A self-contained grid rather than <input type="date">: the native picker
   is styled by the OS and lands inconsistently across platforms, and this
   page already reads as a calendar surface. Weeks start Sunday to match the
   training calendar. */
function MonthCalendar({ value, onPick, onClose }: {
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const selected = fromDateStr(value);
  const [cursor, setCursor] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const ref = useRef<HTMLDivElement>(null);

  /* Click-away and Escape both close — a popover that can only be dismissed
     by picking a day traps the coach who opened it by accident. */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  /* Leading blanks so the 1st lands under its weekday. */
  const lead = first.getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayS = toDateStr(new Date());

  return (
    <div className={styles.calPop} ref={ref}>
      <div className={styles.calHead}>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          aria-label="Previous month"
        >‹</button>
        <span className={styles.calTitle}>
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          aria-label="Next month"
        >›</button>
      </div>
      <div className={styles.calGrid}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className={styles.calDow}>{d}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const ds = toDateStr(new Date(year, month, day));
          return (
            <button
              key={ds}
              type="button"
              className={`${styles.calDay} ${ds === value ? styles.calDaySel : ''} ${ds === todayS ? styles.calDayToday : ''}`}
              onClick={() => { onPick(ds); onClose(); }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Green when done, red when not. No amber middle state: the coach is
 *  scanning for who still needs a nudge, and a third colour would blur it. */
function StatusBox({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`${styles.box} ${on ? styles.boxOn : styles.boxOff}`}
      role="img"
      aria-label={`${label}: ${on ? 'yes' : 'no'}`}
      title={`${label}: ${on ? 'yes' : 'no'}`}
    >
      {on ? '✓' : '✕'}
    </span>
  );
}

export default function WorkoutsPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [rows, setRows] = useState<api.DayCheckInRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  /* A selected row is identified by athlete AND date: in search mode the
     same athlete appears once per training day. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showCal, setShowCal] = useState(false);
  /* Search results span every date, so they are their own list rather than a
     filter over the day's rows. null = not searching. */
  const [results, setResults] = useState<api.DayCheckInRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  /* Guard on `isLoading`, never on `user` alone: `user` is undefined while
     auth resolves, so testing it directly bounces a signed-in coach to
     /login on first paint. */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  const load = useCallback(async (d: string) => {
    setRows(null);
    setLoadError(false);
    try {
      setRows(await api.getDayCheckIns(d));
    } catch {
      setRows([]);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (isLoading || !user || !isCoach) return;
    void load(date);
  }, [isLoading, user, isCoach, date, load]);

  /* Changing the day drops any open athlete: their answers belong to the
     date that was showing when the row was clicked. */
  const shiftDay = (delta: number) => {
    const d = fromDateStr(date);
    d.setDate(d.getDate() + delta);
    setOpenKey(null);
    setDate(toDateStr(d));
  };

  const pickDate = (d: string) => { setOpenKey(null); setDate(d); };

  /* Debounced so typing a name doesn't fire a request per keystroke. */
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchCheckIns(q)
        .then((r) => { setResults(r); })
        .catch(() => { setResults([]); })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const isSearch = query.trim().length > 0;
  const list = isSearch ? results : rows;
  const rowKey = (r: api.DayCheckInRow) => `${r.playerId}|${r.date}`;
  const selected = openKey
    ? (list ?? []).find((r) => rowKey(r) === openKey) ?? null
    : null;
  const isToday = date === toDateStr(new Date());

  if (isLoading || !user) return null;

  const checkedInCount = rows?.filter((r) => r.checkedIn).length ?? 0;
  const finishedCount = rows?.filter((r) => r.finished).length ?? 0;

  return (
    <div className={aStyles.pageRoot}>
      <PageHeader
        eyebrow="Training"
        title="Athlete"
        titleAccent="Workouts"
        subtitle="Who is scheduled today, who checked in, and who finished."
        actions={
          <Link href="/training" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
            Training Calendar →
          </Link>
        }
      />

      {/* ── Day bar ── the page is a window onto the calendar, so it moves
          day by day rather than being pinned to today. */}
      <div className={styles.dayBar}>
        <button type="button" className={styles.navBtn} onClick={() => shiftDay(-1)} aria-label="Previous day">‹</button>
        <div className={styles.dayText}>
          {/* The date IS the picker. Arrows stay for day-at-a-time stepping. */}
          <button
            type="button"
            className={styles.dayLabelBtn}
            onClick={() => setShowCal((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={showCal}
            title="Pick a date"
          >
            {longLabel(date)}
          </button>
          {rows !== null && !isSearch && (
            <span className={styles.daySummary}>
              {rows.length} scheduled · {checkedInCount} checked in · {finishedCount} finished
            </span>
          )}
          {isSearch && (
            <span className={styles.daySummary}>
              Showing every check-in matching &ldquo;{query.trim()}&rdquo;
            </span>
          )}
          {showCal && (
            <MonthCalendar value={date} onPick={pickDate} onClose={() => setShowCal(false)} />
          )}
        </div>
        <button type="button" className={styles.navBtn} onClick={() => shiftDay(1)} aria-label="Next day">›</button>
        {!isToday && (
          <button type="button" className={styles.todayBtn} onClick={() => pickDate(toDateStr(new Date()))}>
            Today
          </button>
        )}
      </div>

      {selected ? (
        <div className={styles.panel}>
          <button type="button" className={styles.back} onClick={() => setOpenKey(null)}>
            {isSearch ? '‹ All results' : '‹ All athletes'}
          </button>
          <div className={styles.detailHead}>
            <Link href={`/athletes/${selected.playerId}`} className={styles.detailName}>
              {selected.firstName} {selected.lastName}
            </Link>
            <span className={styles.detailBoxes}>
              <span className={styles.detailDate}>{longLabel(selected.date)}</span>
              <StatusBox on={selected.checkedIn} label="Checked in" />
              <StatusBox on={selected.finished} label="Finished" />
            </span>
          </div>

          <div className={styles.qa}>
            <span className={styles.q}>What is one area of focus for today&rsquo;s session?</span>
            <span className={styles.a}>
              {selected.focus || <em className={styles.none}>Not answered</em>}
            </span>
          </div>
          <div className={styles.qa}>
            <span className={styles.q}>Did you execute your goal?</span>
            <span className={styles.a}>
              {selected.executedGoal || <em className={styles.none}>Not answered</em>}
            </span>
          </div>
          <div className={styles.qa}>
            <span className={styles.q}>What did you learn?</span>
            <span className={styles.a}>
              {selected.learned || <em className={styles.none}>Not answered</em>}
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="Search athletes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loadError && (
              <button type="button" className={styles.retry} onClick={() => void load(date)}>
                Retry
              </button>
            )}
          </div>

          {(isSearch ? searching && results === null : rows === null) ? (
            <div className={styles.state}>Loading…</div>
          ) : !isSearch && loadError ? (
            <div className={styles.state}>Couldn&rsquo;t load this day.</div>
          ) : (list ?? []).length === 0 ? (
            <div className={styles.state}>
              <p className={styles.emptyTitle}>
                {isSearch ? 'No check-ins found' : 'No workouts scheduled'}
              </p>
              <p className={styles.emptyHint}>
                {isSearch
                  ? 'No athlete matching that name has a training day on record.'
                  : 'Nobody has drills on the calendar for this day.'}
              </p>
            </div>
          ) : (
            <div className={styles.scrollX}>
              {/* Search spans dates, so it earns a Date column the day view
                  doesn't need. */}
              <div className={`${styles.head} ${isSearch ? styles.headSearch : ''}`}>
                <span>Athlete</span>
                {isSearch && <span>Date</span>}
                <span>Drills</span>
                <span className={styles.colCenter}>Checked In</span>
                <span className={styles.colCenter}>Finished</span>
              </div>
              {(list ?? []).map((r) => (
                <button
                  key={rowKey(r)}
                  type="button"
                  className={`${styles.row} ${isSearch ? styles.rowSearch : ''}`}
                  onClick={() => setOpenKey(rowKey(r))}
                >
                  <span className={styles.name}>{r.firstName} {r.lastName}</span>
                  {isSearch && <span className={styles.cell}>{shortLabel(r.date)}</span>}
                  <span className={styles.cell}>{r.drillCount}</span>
                  <span className={styles.colCenter}>
                    <StatusBox on={r.checkedIn} label="Checked in" />
                  </span>
                  <span className={styles.colCenter}>
                    <StatusBox on={r.finished} label="Finished" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
