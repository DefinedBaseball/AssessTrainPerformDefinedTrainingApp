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

   Three tabs: Facility Schedule (who is due in the building that day, from
   each athlete's facility schedule, grouped by program and start time in the
   program colours), Check-In (the check-in / finished roster described
   above) -- both on the day bar -- and Athlete Schedule (every athlete with
   each program they're in and its days and times; not tied to a day).
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import styles from './page.module.css';
/* Coach Dashboard theme: canvas, banner and bubble surfaces. */
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconAttendance } from '../education/EduHeader';
import {
  type FacilitySlot, WEEKDAYS, LESSON_KEY, parseFacilitySchedule, slotsOnDate, formatTime12, formatDay,
  programColor, programLabel, programWeek, entryDates,
} from '@/lib/facility-schedule';
import { useFacilityPrograms } from '@/lib/use-facility-programs';

type AttendanceTab = 'facility' | 'workouts' | 'athletes';
const TAB_KEY = 'attendance.tab';

/** One start time + program on the chosen day, with everyone due for it. */
interface FacilityGroup {
  time: string;
  program: string;
  label: string;
  color: string;
  /** Program week of the day (shared by everyone in the program). */
  week: number | null;
  /** `day` = which of the athlete's program days this is (1st, 2nd, ...). */
  athletes: { id: string; firstName: string; lastName: string; day: number | null }[];
}

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
  /* Settings → Programs: names, colours and weeks. */
  const programs = useFacilityPrograms();
  const FACILITY_GROUPS = useMemo(() => programs.map(({ key, label }) => ({ key, label })), [programs]);

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
  /* Remembered per browser so a coach who lives on one tab lands on it. */
  const [tab, setTabState] = useState<AttendanceTab>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY);
      return t === 'workouts' || t === 'athletes' ? t : 'facility';
    } catch { return 'facility'; }
  });
  const setTab = (t: AttendanceTab) => {
    setTabState(t);
    setOpenKey(null);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ }
  };
  /* Every athlete, for the facility schedule. Loaded once -- the schedule
     itself is per-athlete JSON, so changing the day is local work. */
  const [athletes, setAthletes] = useState<api.Player[] | null>(null);
  const [athletesError, setAthletesError] = useState(false);

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

  const loadAthletes = useCallback(() => {
    setAthletesError(false);
    api.getPlayers()
      .then((ps) => setAthletes(ps.filter((p) => p.positions !== 'COACH' && !api.isPlayerLocked(p))))
      .catch(() => { setAthletes([]); setAthletesError(true); });
  }, []);
  useEffect(() => {
    if (isLoading || !user || !isCoach) return;
    loadAthletes();
  }, [isLoading, user, isCoach, loadAthletes]);

  /* The day's facility sessions: one group per start time + program,
     bundled by program (Settings order: all the Hitting sessions, then
     Pitching, ...), earliest first within each. Lessons are left out --
     they're one-on-one, not a group in the building. */
  const facilityGroups = useMemo<FacilityGroup[]>(() => {
    if (!athletes) return [];
    const order = FACILITY_GROUPS.map((g) => g.key);
    const byKey = new Map<string, FacilityGroup>();
    for (const p of athletes) {
      for (const sl of slotsOnDate(parseFacilitySchedule(p.facilitySchedule), date)) {
        const def = FACILITY_GROUPS.find((g) => g.key === sl.program);
        if (!def) continue;
        const key = `${sl.time}|${sl.program}`;
        let g = byKey.get(key);
        if (!g) {
          g = {
            time: sl.time, program: sl.program, label: def.label, color: programColor(sl.program),
            week: programWeek(sl.program, date), athletes: [],
          };
          byKey.set(key, g);
        }
        g.athletes.push({ id: p.id, firstName: p.firstName, lastName: p.lastName, day: sl.day });
      }
    }
    const groups = [...byKey.values()];
    for (const g of groups) {
      g.athletes.sort((a, b) => (a.firstName || '').localeCompare(b.firstName || '') || (a.lastName || '').localeCompare(b.lastName || ''));
    }
    return groups.sort((a, b) => order.indexOf(a.program) - order.indexOf(b.program) || a.time.localeCompare(b.time));
  }, [athletes, date, FACILITY_GROUPS]);

  const facilityQuery = query.trim().toLowerCase();
  const shownGroups = facilityQuery
    ? facilityGroups
      .map((g) => ({ ...g, athletes: g.athletes.filter((a) => `${a.firstName} ${a.lastName}`.toLowerCase().includes(facilityQuery)) }))
      .filter((g) => g.athletes.length > 0)
    : facilityGroups;
  const facilityAthleteCount = new Set(facilityGroups.flatMap((g) => g.athletes.map((a) => a.id))).size;

  /* Athlete Schedule: every athlete and the programs they're in (Settings
     order, Lesson last), each with its days and times. Entries that have
     ended are left out; athletes with nothing current sort to the bottom. */
  const [schedProgram, setSchedProgram] = useState('');
  const athleteSchedules = useMemo(() => {
    if (!athletes) return [];
    const today = toDateStr(new Date());
    const order = [...programs.map((p) => p.key), LESSON_KEY];
    return athletes
      .map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        entries: parseFacilitySchedule(p.facilitySchedule)
          .filter((s) => order.includes(s.program) && Object.values(s.days).some(Boolean))
          .filter((s) => { const { end } = entryDates(s); return !end || end >= today; })
          .sort((a, b) => order.indexOf(a.program) - order.indexOf(b.program)),
      }))
      .sort((a, b) => (Number(!a.entries.length) - Number(!b.entries.length))
        || (a.firstName || '').localeCompare(b.firstName || '')
        || (a.lastName || '').localeCompare(b.lastName || ''));
  }, [athletes, programs]);
  const shownSchedules = athleteSchedules.filter((a) =>
    (!facilityQuery || `${a.firstName} ${a.lastName}`.toLowerCase().includes(facilityQuery))
    && (!schedProgram || a.entries.some((s) => s.program === schedProgram)));
  const scheduledCount = athleteSchedules.filter((a) => a.entries.length).length;

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
    /* Facility Schedule and Athlete Schedule filter their own lists locally. */
    if (!q || tab !== 'workouts') { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchCheckIns(q)
        .then((r) => { setResults(r); })
        .catch(() => { setResults([]); })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, tab]);

  const isSearch = tab === 'workouts' && query.trim().length > 0;
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
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconAttendance />}
        eyebrow="Attendance"
        title={tab === 'facility' ? 'Facility' : tab === 'athletes' ? 'Athlete' : 'Workout'}
        accent={tab === 'workouts' ? 'Check-In' : 'Schedule'}
        subtitle={tab === 'facility'
          ? 'Who is due in the facility, by program and start time.'
          : tab === 'athletes'
            ? 'Every athlete, the programs they’re in, and their days and times.'
            : 'Who is scheduled today, who checked in, and who finished.'}
        actions={
          <Link href="/training" className={`btn btn-outline ${theme.field}`} style={{ whiteSpace: 'nowrap' }}>
            Training Calendar →
          </Link>
        }
      />

      {/* The Drill Library's sport-tab bar (same classes), so the two read
          as one control set across the app. */}
      <div className={`${eduStyles.sportTabs} ${theme.inner} ${theme.firm}`} role="tablist" aria-label="Attendance view">
        <button
          type="button" role="tab" aria-selected={tab === 'facility'}
          className={`${eduStyles.sportTab} ${tab === 'facility' ? eduStyles.sportTabActive : ''}`}
          onClick={() => setTab('facility')}
        >Facility Schedule</button>
        <button
          type="button" role="tab" aria-selected={tab === 'workouts'}
          className={`${eduStyles.sportTab} ${tab === 'workouts' ? eduStyles.sportTabActive : ''}`}
          onClick={() => setTab('workouts')}
        >Check-In</button>
        <button
          type="button" role="tab" aria-selected={tab === 'athletes'}
          className={`${eduStyles.sportTab} ${tab === 'athletes' ? eduStyles.sportTabActive : ''}`}
          onClick={() => setTab('athletes')}
        >Athlete Schedule</button>
      </div>

      {/* ── Day bar ── the page is a window onto the calendar, so it moves
          day by day rather than being pinned to today. Athlete Schedule is
          the standing weekly schedule, so it has no day. */}
      {tab !== 'athletes' && (
      <div className={`${styles.dayBar} ${theme.bubble}`}>
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
          {tab === 'facility' && athletes !== null && (
            <span className={styles.daySummary}>
              {facilityAthleteCount} athlete{facilityAthleteCount === 1 ? '' : 's'} · {facilityGroups.length} session{facilityGroups.length === 1 ? '' : 's'}
            </span>
          )}
          {tab === 'workouts' && rows !== null && !isSearch && (
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
      )}

      {tab === 'athletes' ? (
        <div className={`${styles.panel} ${theme.inner}`}>
          <div className={styles.toolbar}>
            <input
              className={`${styles.search} ${theme.field}`}
              placeholder="Search athletes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className={`${styles.search} ${styles.schedFilter} ${theme.field}`}
              value={schedProgram}
              onChange={(e) => setSchedProgram(e.target.value)}
              aria-label="Filter by program"
            >
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value={LESSON_KEY}>Lesson</option>
            </select>
            {athletes !== null && !athletesError && (
              <span className={styles.schedCount}>{scheduledCount} of {athleteSchedules.length} scheduled</span>
            )}
            {athletesError && (
              <button type="button" className={styles.retry} onClick={loadAthletes}>Retry</button>
            )}
          </div>
          <div className={styles.facLegend}>
            {[...FACILITY_GROUPS, { key: LESSON_KEY, label: 'Lesson' }].map((g) => (
              <span key={g.key} className={styles.facLegendItem}>
                <span className={styles.facDot} style={{ background: programColor(g.key) }} />
                {g.label}
              </span>
            ))}
          </div>
          {athletes === null ? (
            <div className={styles.state}>Loading…</div>
          ) : athletesError ? (
            <div className={styles.state}>Couldn&rsquo;t load the athletes.</div>
          ) : shownSchedules.length === 0 ? (
            <div className={styles.state}>
              <p className={styles.emptyTitle}>No athletes found</p>
              <p className={styles.emptyHint}>
                {schedProgram ? 'No one matching that is in this program.' : 'No one matches that name.'}
              </p>
            </div>
          ) : (
            <div className={styles.schedList}>
              {shownSchedules.map((a) => (
                <div key={a.id} className={styles.schedRow}>
                  <Link href={`/athletes/${a.id}`} className={styles.schedName}>
                    {a.firstName} {a.lastName}
                  </Link>
                  <div className={styles.schedPrograms}>
                    {a.entries.length === 0 ? (
                      <span className={styles.schedNone}>No facility schedule</span>
                    ) : a.entries.map((s: FacilitySlot, i) => {
                      const { end } = entryDates(s);
                      return (
                        <div
                          key={`${s.program}-${i}`}
                          className={styles.schedProgram}
                          style={{ '--fac': programColor(s.program) } as React.CSSProperties}
                        >
                          <span className={styles.schedLabel}>{programLabel(s.program)}</span>
                          {WEEKDAYS.filter((d) => s.days[d.key]).map((d) => (
                            <span key={d.key} className={styles.schedDay}>
                              <b>{d.short}</b> {formatTime12(s.days[d.key]!)}
                            </span>
                          ))}
                          {s.program === LESSON_KEY && end && (
                            <span className={styles.schedUntil}>until {formatDay(end)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'facility' ? (
        <div className={`${styles.panel} ${theme.inner}`}>
          <div className={styles.toolbar}>
            <input
              className={`${styles.search} ${theme.field}`}
              placeholder="Search athletes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {athletesError && (
              <button type="button" className={styles.retry} onClick={loadAthletes}>Retry</button>
            )}
          </div>
          {/* Colour key -- the same colours as Upcoming Workouts. */}
          <div className={styles.facLegend}>
            {FACILITY_GROUPS.map((g) => (
              <span key={g.key} className={styles.facLegendItem}>
                <span className={styles.facDot} style={{ background: programColor(g.key) }} />
                {g.label}
              </span>
            ))}
          </div>
          {athletes === null ? (
            <div className={styles.state}>Loading…</div>
          ) : athletesError ? (
            <div className={styles.state}>Couldn&rsquo;t load the athletes.</div>
          ) : shownGroups.length === 0 ? (
            <div className={styles.state}>
              <p className={styles.emptyTitle}>
                {facilityQuery ? 'No athletes found' : 'Nobody scheduled in the facility'}
              </p>
              <p className={styles.emptyHint}>
                {facilityQuery
                  ? 'No one matching that name is due in on this day.'
                  : 'No athlete has Hitting, Pitching, Catching or Strength days on this date. Set them with the clock on Upcoming Workouts or in Edit Profile.'}
              </p>
            </div>
          ) : (
            <div className={styles.facList}>
              {shownGroups.map((g) => (
                <section
                  key={`${g.time}|${g.program}`}
                  className={styles.facGroup}
                  style={{ '--fac': g.color } as React.CSSProperties}
                >
                  <div className={styles.facHead}>
                    <span className={styles.facTime}>{formatTime12(g.time)}</span>
                    <span className={styles.facProgram}>{g.label}</span>
                    {g.week && <span className={styles.facWeek}>Week {g.week}</span>}
                    <span className={styles.facCount}>{g.athletes.length}</span>
                  </div>
                  <div className={styles.facAthletes}>
                    {g.athletes.map((a) => (
                      <Link key={a.id} href={`/athletes/${a.id}`} className={styles.facAthlete}>
                        {a.firstName} {a.lastName}
                        {/* Their 1st / 2nd / ... program day this week. */}
                        {a.day && <span className={styles.facDay}>Day {a.day}</span>}
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : selected ? (
        <div className={`${styles.panel} ${theme.inner}`}>
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
        <div className={`${styles.panel} ${theme.inner}`}>
          <div className={styles.toolbar}>
            <input
              className={`${styles.search} ${theme.field}`}
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
