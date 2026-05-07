'use client';

/* ─────────────────────────────────────────────────────────────────────────────
   Program Schedule
   --------------------------------------------------------------------------
   In-facility display board for coaches running a program session. The coach
   picks a single training category (Hitting / Pitching / Catching / Infield
   / Outfield / S&C) and 2–8 athletes, and the page renders each athlete's
   workout for the selected day side-by-side as readable cards so kids can
   walk up and follow their plan.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

/* ── Position groups (mirrors the Training calendar's helper) ── */
const HITTER_POSITIONS  = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'INF', 'UTIL'];
const INFIELD_POSITIONS = ['1B', '2B', '3B', 'SS', 'INF'];
const OUTFIELD_POSITIONS = ['LF', 'CF', 'RF', 'OF'];

function parsePositions(p: Player | null | undefined): string[] {
  return (p?.positions || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* ── Schedule categories ── */
type ScheduleKey = 'hitting' | 'pitching' | 'catching' | 'infield' | 'outfield' | 'strength';

const SCHEDULE_OPTIONS: { key: ScheduleKey; label: string; color: string }[] = [
  { key: 'hitting',  label: 'Hitting',  color: '#3B82F6' },
  { key: 'pitching', label: 'Pitching', color: '#F59E0B' },
  { key: 'catching', label: 'Catching', color: '#14B8A6' },
  { key: 'infield',  label: 'Infield',  color: '#22C55E' },
  { key: 'outfield', label: 'Outfield', color: '#22C55E' },
  { key: 'strength', label: 'S&C',      color: '#EF4444' },
];

/** Decide whether a player carries the position(s) the chosen schedule
 *  category requires. S&C is open to every athlete; everything else
 *  filters by the player's `positions` string. */
function playerMatchesSchedule(player: Player, schedule: ScheduleKey): boolean {
  const positions = parsePositions(player);
  if (positions.length === 0) return false;
  switch (schedule) {
    case 'hitting':  return positions.some(p => HITTER_POSITIONS.includes(p));
    case 'pitching': return positions.includes('P');
    case 'catching': return positions.includes('C');
    case 'infield':  return positions.some(p => INFIELD_POSITIONS.includes(p));
    case 'outfield': return positions.some(p => OUTFIELD_POSITIONS.includes(p));
    case 'strength': return true;
  }
}

/* ── Small helpers ── */

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  /* Accept HH:MM (24h) or already-formatted strings */
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Athlete multi-select dropdown
   ───────────────────────────────────────────────────────────────────────── */

function AthletePicker({
  candidates,
  selected,
  onChange,
  maxSelectable = 8,
}: {
  candidates: Player[];
  selected: string[];
  onChange: (ids: string[]) => void;
  maxSelectable?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const sorted = useMemo(
    () => [...candidates].sort(
      (a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`),
    ),
    [candidates],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
      || (p.positions || '').toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(s => s !== id));
    else if (selected.length < maxSelectable) onChange([...selected, id]);
  };

  const label = selected.length === 0
    ? 'Select athletes…'
    : selected.length === 1
      ? '1 athlete selected'
      : `${selected.length} athletes selected`;

  return (
    <div className={styles.pickerRoot} ref={ref}>
      <button
        type="button"
        className={`${styles.pickerBtn} ${open ? styles.pickerBtnOpen : ''}`}
        onClick={() => { setOpen(o => !o); setSearch(''); }}
      >
        <span className={styles.pickerIcon} aria-hidden>👥</span>
        <span className={styles.pickerLabel}>{label}</span>
        <span className={`${styles.pickerArrow} ${open ? styles.pickerArrowOpen : ''}`}>▼</span>
      </button>

      {open && (
        <div className={styles.pickerPanel}>
          <div className={styles.pickerSearchRow}>
            <input
              ref={inputRef}
              className={styles.pickerSearch}
              type="text"
              placeholder="Search athletes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {selected.length > 0 && (
              <button
                type="button"
                className={styles.pickerClearBtn}
                onClick={() => onChange([])}
              >
                Clear
              </button>
            )}
          </div>
          <div className={styles.pickerCount}>
            {selected.length} of up to {maxSelectable} selected
          </div>
          <div className={styles.pickerList}>
            {filtered.length === 0 ? (
              <div className={styles.pickerEmpty}>No athletes match that filter.</div>
            ) : filtered.map(p => {
              const isSelected = selected.includes(p.id);
              const disabled = !isSelected && selected.length >= maxSelectable;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  className={`${styles.pickerItem} ${isSelected ? styles.pickerItemActive : ''}`}
                  onClick={() => toggle(p.id)}
                >
                  <span className={styles.pickerCheck} aria-hidden>
                    {isSelected ? '✓' : '+'}
                  </span>
                  <span className={styles.pickerItemName}>
                    {p.lastName}, {p.firstName}
                  </span>
                  <span className={styles.pickerItemMeta}>
                    {p.positions || '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Per-athlete column — renders the day's drills for the selected schedule
   ───────────────────────────────────────────────────────────────────────── */

function AthleteColumn({
  player,
  drills,
  scheduleColor,
  loading,
}: {
  player: Player;
  drills: ScheduledDrill[];
  scheduleColor: string;
  loading: boolean;
}) {
  /* Group drills by category so the card reads as
       Movement Prep
       ─ Drill A
       ─ Drill B
     Drills
       ─ ...
     etc. */
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduledDrill[]>();
    for (const d of drills) {
      const cat = d.category || 'Drills';
      const arr = map.get(cat) ?? [];
      arr.push(d);
      map.set(cat, arr);
    }
    return [...map.entries()].map(([category, items]) => ({ category, items }));
  }, [drills]);

  return (
    <div className={styles.athleteCard}>
      <div className={styles.athleteCardHead} style={{ borderTopColor: scheduleColor }}>
        <div className={styles.athleteName}>
          {player.firstName} <span className={styles.athleteLast}>{player.lastName}</span>
        </div>
        <div className={styles.athletePositions}>{player.positions || '—'}</div>
      </div>
      <div className={styles.athleteCardBody}>
        {loading ? (
          <div className={styles.athleteEmpty}>Loading…</div>
        ) : drills.length === 0 ? (
          <div className={styles.athleteEmpty}>No drills scheduled for today.</div>
        ) : (
          grouped.map(({ category, items }) => (
            <div key={category} className={styles.athleteGroup}>
              <div className={styles.athleteGroupHead}>
                <span className={styles.athleteGroupDot} style={{ background: scheduleColor }} />
                {category}
              </div>
              <ol className={styles.athleteDrillList}>
                {items.map(d => (
                  <li key={d.id} className={styles.athleteDrillItem}>
                    <div className={styles.athleteDrillName}>{d.name}</div>
                    <div className={styles.athleteDrillMeta}>
                      {formatTime(d.time)}
                      {d.duration > 0 && (
                        <span className={styles.athleteDrillDuration}> · {d.duration} min</span>
                      )}
                    </div>
                    {d.notes && (
                      <div className={styles.athleteDrillNotes}>{d.notes}</div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────────────────────────────────── */

export default function ProgramPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  /* Auth + role guard — coach-only view */
  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
    else if (!isCoach) router.replace('/');
  }, [user, isCoach, isLoading, router]);

  /* Sidebar reset hook — clicking Program in the sidebar while already on
     this page bounces back to the empty default. */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { href: string } | undefined;
      if (detail?.href === '/program') {
        setSchedule('hitting');
        setSelectedIds([]);
        setSessionDate(todayIso());
      }
    };
    window.addEventListener('sidebar-nav-home', handler);
    return () => window.removeEventListener('sidebar-nav-home', handler);
  }, []);

  /* Athlete roster for the picker — coaches always see every player. */
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  useEffect(() => {
    if (!user || !isCoach) return;
    setPlayersLoading(true);
    api.getPlayers()
      .then(rows => { setPlayers(rows); setPlayersLoading(false); })
      .catch(() => { setPlayers([]); setPlayersLoading(false); });
  }, [user, isCoach]);

  /* Top-row state */
  const [schedule, setSchedule] = useState<ScheduleKey>('hitting');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sessionDate, setSessionDate] = useState<string>(() => todayIso());

  /* Reset selected athletes whenever the schedule changes — the new
     category may filter some of them out. */
  useEffect(() => {
    setSelectedIds(prev =>
      prev.filter(id => {
        const p = players.find(x => x.id === id);
        return p ? playerMatchesSchedule(p, schedule) : false;
      }),
    );
  }, [schedule, players]);

  /* Eligible-athlete list for the picker (filtered by schedule). */
  const eligible = useMemo(
    () => players.filter(p => playerMatchesSchedule(p, schedule)),
    [players, schedule],
  );

  /* Fetch each selected athlete's scheduled drills for the chosen date
     and category. Keeps a per-player loading flag so newly-added cards
     show a spinner without blocking the others. */
  const [drillsByPlayer, setDrillsByPlayer] = useState<Record<string, ScheduledDrill[]>>({});
  const [loadingByPlayer, setLoadingByPlayer] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const want = new Set(selectedIds);
    /* Drop drills/loading for athletes no longer selected. */
    setDrillsByPlayer(prev => {
      const next: Record<string, ScheduledDrill[]> = {};
      Object.keys(prev).forEach(k => { if (want.has(k)) next[k] = prev[k]; });
      return next;
    });
    setLoadingByPlayer(prev => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach(k => { if (want.has(k)) next[k] = prev[k]; });
      return next;
    });
    /* Fetch each athlete's scheduled drills for the day + tab. */
    selectedIds.forEach(id => {
      setLoadingByPlayer(prev => ({ ...prev, [id]: true }));
      api.getScheduledDrills(id, { date: sessionDate, tab: schedule })
        .then(rows => {
          if (cancelled) return;
          /* Stable-sort by time so the column reads top → bottom in order. */
          const sorted = [...rows].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          setDrillsByPlayer(prev => ({ ...prev, [id]: sorted }));
          setLoadingByPlayer(prev => ({ ...prev, [id]: false }));
        })
        .catch(() => {
          if (cancelled) return;
          setDrillsByPlayer(prev => ({ ...prev, [id]: [] }));
          setLoadingByPlayer(prev => ({ ...prev, [id]: false }));
        });
    });
    return () => { cancelled = true; };
  }, [selectedIds, sessionDate, schedule]);

  /* Jump-to-next-session: probe each selected athlete's full schedule for
     the chosen category and snap sessionDate to the soonest date that
     has at least one drill across any of them. */
  const [jumping, setJumping] = useState(false);
  const jumpToNextSession = async () => {
    if (selectedIds.length === 0) return;
    setJumping(true);
    try {
      const today = todayIso();
      const oneYear = new Date();
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      const endDate = oneYear.toISOString().slice(0, 10);
      const all = await Promise.all(selectedIds.map(id =>
        api.getScheduledDrills(id, { startDate: today, endDate, tab: schedule })
          .catch(() => [] as ScheduledDrill[]),
      ));
      const dates = all.flat().map(d => d.date).filter(Boolean).sort();
      if (dates.length === 0) {
        // Fall back to the past year — maybe everything they have is older.
        const aYearAgo = new Date();
        aYearAgo.setFullYear(aYearAgo.getFullYear() - 1);
        const startBack = aYearAgo.toISOString().slice(0, 10);
        const back = await Promise.all(selectedIds.map(id =>
          api.getScheduledDrills(id, { startDate: startBack, endDate: today, tab: schedule })
            .catch(() => [] as ScheduledDrill[]),
        ));
        const backDates = back.flat().map(d => d.date).filter(Boolean).sort().reverse();
        if (backDates.length > 0) setSessionDate(backDates[0]);
      } else {
        setSessionDate(dates[0]);
      }
    } finally {
      setJumping(false);
    }
  };

  /* Auto-jump once whenever the (athletes, schedule) combination first
     resolves to "no drills for the current sessionDate". Avoids being
     annoying after the user has manually picked a date — only fires when
     all selected columns are empty AND not loading. */
  const [didAutoJump, setDidAutoJump] = useState(false);
  useEffect(() => {
    setDidAutoJump(false);
  }, [selectedIds.join(','), schedule]);
  useEffect(() => {
    if (didAutoJump) return;
    if (selectedIds.length < 2) return;
    /* Wait for all columns to finish their initial load before deciding. */
    const allLoaded = selectedIds.every(id => loadingByPlayer[id] === false);
    if (!allLoaded) return;
    const totalDrills = selectedIds.reduce((n, id) => n + (drillsByPlayer[id]?.length ?? 0), 0);
    if (totalDrills === 0) {
      setDidAutoJump(true);
      jumpToNextSession();
    } else {
      setDidAutoJump(true);
    }
    // jumpToNextSession captured via closure; safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, schedule, sessionDate, loadingByPlayer, drillsByPlayer, didAutoJump]);

  /* ── Fullscreen presentation mode ──
     Board can pop into the browser's native fullscreen so the in-facility
     display (TV / projector / iPad) can show the workouts edge-to-edge
     with no app chrome. We track the state via the fullscreenchange event
     so the X button sticks around when the user exits via Escape. */
  const boardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  const enterFullscreen = () => {
    if (!boardRef.current) return;
    const el = boardRef.current;
    const req = (el as any).requestFullscreen
      ?? (el as any).webkitRequestFullscreen
      ?? (el as any).msRequestFullscreen;
    if (req) req.call(el).catch(() => {});
  };
  const exitFullscreen = () => {
    const exit = (document as any).exitFullscreen
      ?? (document as any).webkitExitFullscreen
      ?? (document as any).msExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  };

  if (isLoading || !user || !isCoach) return null;

  const scheduleColor = SCHEDULE_OPTIONS.find(o => o.key === schedule)?.color ?? '#3B82F6';
  const selectedPlayers: Player[] = selectedIds
    .map(id => players.find(p => p.id === id))
    .filter((p): p is Player => !!p);
  const canFullscreen = selectedPlayers.length >= 2;

  return (
    <div className={styles.pageWrap}>
      <PageHeader
        eyebrow="Daily Display"
        title="Program"
        titleAccent="Schedule"
      />

      {/* ── Filter row: schedule type + athlete picker + session date ── */}
      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Schedule</label>
          <select
            className={styles.scheduleSelect}
            value={schedule}
            onChange={e => setSchedule(e.target.value as ScheduleKey)}
            style={{ borderColor: scheduleColor, color: scheduleColor }}
          >
            {SCHEDULE_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            Athletes <span className={styles.filterHint}>(2–8)</span>
          </label>
          {playersLoading ? (
            <div className={styles.pickerLoading}>Loading roster…</div>
          ) : (
            <AthletePicker
              candidates={eligible}
              selected={selectedIds}
              onChange={setSelectedIds}
            />
          )}
          <div className={styles.eligibleCount}>
            {eligible.length} eligible athlete{eligible.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Session Date</label>
          <div className={styles.dateRow}>
            <input
              type="date"
              className={styles.dateInput}
              value={sessionDate}
              onChange={e => setSessionDate(e.target.value)}
            />
            <button
              type="button"
              className={styles.jumpBtn}
              onClick={jumpToNextSession}
              disabled={selectedIds.length === 0 || jumping}
              title="Snap to the soonest date any selected athlete has drills"
            >
              {jumping ? 'Searching…' : 'Jump to next session →'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Display board ── */}
      {selectedIds.length === 0 ? (
        <div className={styles.boardEmpty}>
          <span className={styles.boardEmptyIcon}>📋</span>
          <p className={styles.boardEmptyTitle}>Pick athletes to start the board</p>
          <p className={styles.boardEmptyHint}>
            Choose between 2 and 8 athletes from the dropdown above. Each athlete&apos;s
            scheduled {SCHEDULE_OPTIONS.find(o => o.key === schedule)?.label} workout
            for the session date will appear side-by-side here.
          </p>
        </div>
      ) : selectedIds.length < 2 ? (
        <div className={styles.boardEmpty}>
          <span className={styles.boardEmptyIcon}>👥</span>
          <p className={styles.boardEmptyTitle}>Add at least one more athlete</p>
          <p className={styles.boardEmptyHint}>
            The Program board displays at least two athletes side-by-side. Pick another
            from the dropdown to populate the board.
          </p>
        </div>
      ) : (
        <div
          ref={boardRef}
          className={`${styles.board} ${isFullscreen ? styles.boardFullscreen : ''}`}
          style={{ '--board-cols': selectedPlayers.length } as React.CSSProperties}
        >
          {/* Exit-fullscreen X — only visible while in native fullscreen */}
          {isFullscreen && (
            <button
              type="button"
              className={styles.exitFullscreenBtn}
              onClick={exitFullscreen}
              aria-label="Exit full screen"
              title="Exit full screen"
            >
              ✕
            </button>
          )}
          {selectedPlayers.map(p => (
            <AthleteColumn
              key={p.id}
              player={p}
              drills={drillsByPlayer[p.id] ?? []}
              loading={loadingByPlayer[p.id] ?? false}
              scheduleColor={scheduleColor}
            />
          ))}
        </div>
      )}

      {/* Floating "Full Screen" trigger — only when there's a board to show */}
      {canFullscreen && !isFullscreen && (
        <button
          type="button"
          className={styles.fullscreenBtn}
          onClick={enterFullscreen}
          title="Display only the schedule board in full screen"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5.5V2.5h3" />
            <path d="M14 5.5V2.5h-3" />
            <path d="M2 10.5v3h3" />
            <path d="M14 10.5v3h-3" />
          </svg>
          Full Screen
        </button>
      )}
    </div>
  );
}
