'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Drill, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ScheduleDownloadModal } from './ScheduleDownloadModal';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';
/* Tab + category color system lives in a shared module so the Player
   Summary's Upcoming Drills panel renders the same color treatment as
   the Training day-column cards do here — single source of truth. */
import {
  TAB_LABELS, TAB_COLORS, TAB_CAT_COLORS, DEFAULT_CAT_COLOR,
  LEGEND_CATEGORIES, getTabCatStyle,
} from '@/lib/training-colors';
import { DRILL_TAXONOMY } from '@/lib/drill-taxonomy.generated';

/* ── Constants ──
   The full tab catalog. Visibility on the calendar is filtered per-athlete
   by position (see `visibleTabsForPlayer` below):
     • hitting     — any non-pitcher field position (C, 1B-3B, SS, LF/CF/RF)
     • pitching    — P
     • catching    — C
     • infield     — 1B / 2B / 3B / SS  (or the INF position code)
     • outfield    — LF / CF / RF       (or the OF position code)
     • strength    — always
   Cognition / vision was retired — no longer surfaced in Training. */
const TABS = [
  { key: 'hitting',  label: 'Hitting' },
  { key: 'pitching', label: 'Pitching' },
  { key: 'catching', label: 'Catching' },
  { key: 'infield',  label: 'Infield' },
  { key: 'outfield', label: 'Outfield' },
  { key: 'strength', label: 'S&C' },
];

/** Position codes (raw and grouped) that grant access to each tab. */
const HITTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'INF', 'UTIL'];
const INFIELD_POSITIONS = ['1B', '2B', '3B', 'SS', 'INF'];
const OUTFIELD_POSITIONS = ['LF', 'CF', 'RF', 'OF'];

function parsePositions(player: Player | null | undefined): string[] {
  if (!player?.positions) return [];
  return player.positions.split(',').map(s => s.trim()).filter(Boolean);
}

/** Returns the calendar tabs visible for the given player. Multi-position
 *  athletes get every applicable tab (e.g., a C/INF gets Catching + Infield).
 *  Pitcher-only athletes only see Pitching + S&C. */
function visibleTabsForPlayer(player: Player | null | undefined): typeof TABS {
  const positions = parsePositions(player);
  const isPitcher    = positions.includes('P');
  const isHitter     = positions.some(p => HITTER_POSITIONS.includes(p));
  const isCatcher    = positions.includes('C');
  const isInfielder  = positions.some(p => INFIELD_POSITIONS.includes(p));
  const isOutfielder = positions.some(p => OUTFIELD_POSITIONS.includes(p));
  // No player selected (or no positions on file) → show every tab so the
  // coach UI doesn't collapse to nothing while picking an athlete.
  if (positions.length === 0) return TABS;
  return TABS.filter(t => {
    if (t.key === 'hitting')  return isHitter;
    if (t.key === 'pitching') return isPitcher;
    if (t.key === 'catching') return isCatcher;
    if (t.key === 'infield')  return isInfielder;
    if (t.key === 'outfield') return isOutfielder;
    if (t.key === 'strength') return true;
    return true;
  });
}

/* TAB_CAT_COLORS / DEFAULT_CAT_COLOR / getTabCatStyle moved to
   `@/lib/training-colors` so the Player Summary's Upcoming Drills
   panel shares the same color palette + helpers. Imported above. */

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* TAB_COLORS + TAB_LABELS moved to `@/lib/training-colors`. */

/* Modal dropdown config per tab — `dbCategory` is the Drill Library category it pulls from.
   Each secondary tab is now its OWN drill category (1:1 label ↔ dbCategory), matching the
   coaches' Drills Workbook import. `color` is the hex accent color (border, chips). */
type ModalDropdown = { key: string; label: string; dbCategory: string; color: string };
const MODAL_DROPDOWNS: Record<string, ModalDropdown[]> = Object.fromEntries(
  Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, ModalDropdown[]] => [
    tab,
    cats.map((c, i) => ({ key: `${tab}-${i}`, label: c.id, dbCategory: c.id, color: c.dot })),
  ]),
);

/* Stable empty set passed to dropdowns with no current selection (avoids
   allocating a fresh Set on every render). */
const EMPTY_SET = new Set<string>();

/* LEGEND_CATEGORIES moved to `@/lib/training-colors`. */

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toDateStr(date: Date): string {
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

/* Parse a YYYY-MM-DD string as LOCAL midnight, never UTC. The native
   `new Date('2026-04-30')` form is interpreted as UTC midnight, which
   bumps to the previous day for any user west of UTC and produces
   off-by-one calendar bugs. Always use this helper. */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(s);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/* ── Unique categories present in current tab drills for legend ── */
function getLegendCategories(tab: string): string[] {
  return LEGEND_CATEGORIES[tab] || ['Drills'];
}

/* ══════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════ */

export default function TrainingPage() {
  const router = useRouter();
  const { user, isCoach, isLoading: authLoading } = useAuth();

  // State
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [activeTab, setActiveTab] = useState('all');
  /* Initial state is 'week' — the coach default. The useEffect below
   * overrides to 'day' for player-role users once auth resolves. */
  const [view, setView] = useState<'month' | 'week' | 'day'>('week');
  // Schedule-download modal (PDF export of upcoming drills by type).
  const [showScheduleDl, setShowScheduleDl] = useState(false);
  /* Default date is today for everyone. The previous hardcoded
   * `new Date(2026, 3, 11)` was stale dev seed data — it pointed at a
   * specific demo session and silently skipped past today's schedule. */
  const [currentDate, setCurrentDate] = useState(() => new Date());

  /* Role-aware default view. Players land on the Day view of today's
   * drills — that's the single piece of information they want most when
   * opening the calendar. Coaches default to the Week view (set as the
   * initial useState value above) which gives them a 7-day planning
   * window without the density of the month grid.
   *
   * Done in a useEffect rather than a lazy useState initializer because
   * the auth context loads asynchronously from localStorage; on first
   * render `isCoach` is always false even for coaches, so a lazy
   * initializer would incorrectly pin everyone to the player default.
   * The ref guard ensures the role-based override fires only once —
   * after the user manually changes view we never override their
   * choice. */
  const initialViewSetRef = useRef(false);
  useEffect(() => {
    if (authLoading || !user || initialViewSetRef.current) return;
    initialViewSetRef.current = true;
    if (!isCoach) setView('day');
  }, [authLoading, user, isCoach]);
  const [events, setEvents] = useState<ScheduledDrill[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [modalEditExisting, setModalEditExisting] = useState<ScheduledDrill[]>([]);

  // Copy/paste state
  const [copiedDate, setCopiedDate] = useState<string | null>(null);
  const [copiedDrills, setCopiedDrills] = useState<ScheduledDrill[]>([]);
  // Weekly clipboard — an entire Sun–Sat of drills, replayed onto another
  // week (same weekday + time) via "Paste Week".
  const [copiedWeek, setCopiedWeek] = useState<ScheduledDrill[]>([]);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);

  // Drill video viewer state
  const [viewingDrill, setViewingDrill] = useState<Drill | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  /* Reset back to the default month view + "All" category tab when the
     user clicks the Training sidebar link while already on this route. */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { href: string } | undefined;
      if (detail?.href === '/training') {
        setView('month');
        setActiveTab('all');
        setShowModal(false);
        setViewingDrill(null);
      }
    };
    window.addEventListener('sidebar-nav-home', handler);
    return () => window.removeEventListener('sidebar-nav-home', handler);
  }, []);

  // Load players for coach
  useEffect(() => {
    if (!user) return;
    if (isCoach) {
      api.getPlayers().then(p => {
        const athletes = p.filter(x => x.positions !== 'COACH');
        setPlayers(athletes);
        if (athletes.length > 0 && !selectedPlayerId) {
          setSelectedPlayerId(athletes[0].id);
        }
      }).catch(() => {});
    } else {
      const authUser = user as any;
      if (authUser.playerId) setSelectedPlayerId(authUser.playerId);
    }
  }, [user, isCoach]);

  // Compute date range for data fetch
  const dateRange = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    if (view === 'month') {
      const start = new Date(y, m - 1, 20);
      const end = new Date(y, m + 2, 10);
      return { startDate: toDateStr(start), endDate: toDateStr(end) };
    } else if (view === 'week') {
      const dayOfWeek = currentDate.getDay();
      const sunday = new Date(currentDate);
      sunday.setDate(currentDate.getDate() - dayOfWeek);
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);
      return { startDate: toDateStr(sunday), endDate: toDateStr(saturday) };
    } else {
      return { startDate: toDateStr(currentDate), endDate: toDateStr(currentDate) };
    }
  }, [currentDate, view]);

  // Load scheduled drills
  const refreshEvents = useCallback(() => {
    if (!selectedPlayerId) return;
    setLoadingEvents(true);
    api.getScheduledDrills(selectedPlayerId, {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }).then(data => {
      setEvents(data);
      setLoadingEvents(false);
    }).catch(() => setLoadingEvents(false));
  }, [selectedPlayerId, dateRange]);

  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  // Filter events by active tab
  const filteredEvents = useMemo(
    () => events.filter(e => e.tab === activeTab),
    [events, activeTab],
  );

  // Events grouped by date (filtered by tab)
  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduledDrill[]> = {};
    for (const e of filteredEvents) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => parseTime(a.time) - parseTime(b.time));
    }
    return map;
  }, [filteredEvents]);

  // ALL events grouped by date (all tabs, for the modal edit)
  const allEventsByDate = useMemo(() => {
    const map: Record<string, ScheduledDrill[]> = {};
    for (const e of events) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [events]);

  // Navigation
  const navigate = useCallback((dir: number) => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (view === 'month') d.setMonth(d.getMonth() + dir);
      else if (view === 'week') d.setDate(d.getDate() + dir * 7);
      else d.setDate(d.getDate() + dir);
      return d;
    });
  }, [view]);

  const goToday = () => setCurrentDate(new Date());

  // Delete event
  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.deleteScheduledDrill(id);
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  }, []);

  // Open add modal (fresh)
  const openAddModal = (date?: string) => {
    setModalDate(date || toDateStr(currentDate));
    setModalEditExisting([]);
    setShowModal(true);
  };

  // Open edit modal (pre-populated with existing drills for that day)
  const openEditModal = (date: string) => {
    setModalDate(date);
    setModalEditExisting(allEventsByDate[date] || []);
    setShowModal(true);
  };

  // Copy day — copies EVERY tab's drills for the date.
  const handleCopyDay = (date: string) => {
    setCopiedDate(date);
    setCopiedDrills(allEventsByDate[date] || []);
  };

  /* Copy a single tab's drills for the date — same clipboard as the
     full-day Copy, just filtered to one tab. Pasting still uses the
     existing `handlePasteDay` so the workflow is consistent: copy
     just Hitting → switch days → Paste places only those Hitting
     drills on the target date. */
  const handleCopyTab = (date: string, tabKey: string) => {
    setCopiedDate(date);
    setCopiedDrills(
      (allEventsByDate[date] || []).filter((ev) => ev.tab === tabKey),
    );
  };

  // Paste day
  const handlePasteDay = async (targetDate: string) => {
    if (copiedDrills.length === 0) return;
    const items = copiedDrills.map(ev => ({
      playerId: selectedPlayerId,
      drillId: ev.drillId || undefined,
      tab: ev.tab,
      category: ev.category,
      name: ev.name,
      date: targetDate,
      time: ev.time,
      duration: ev.duration,
    }));
    try {
      const results = await api.createScheduledDrillsBatch(items);
      setEvents(prev => [...prev, ...results]);
    } catch (err) {
      console.error('Paste failed:', err);
    }
  };

  // Sunday (week start) for a given Date, as a YYYY-MM-DD string.
  const weekStartOf = (d: Date) => {
    const s = new Date(d);
    s.setDate(s.getDate() - s.getDay());
    return toDateStr(s);
  };

  // Copy the whole week (Sun–Sat) containing the current date. The Day view
  // only loads one day, so fetch the week's drills on demand.
  const handleCopyWeek = async () => {
    if (!selectedPlayerId) return;
    const startStr = weekStartOf(currentDate);
    const end = parseLocalDate(startStr);
    end.setDate(end.getDate() + 6);
    try {
      const wk = await api.getScheduledDrills(selectedPlayerId, { startDate: startStr, endDate: toDateStr(end) });
      setCopiedWeek(wk);
      setCopiedWeekStart(startStr);
    } catch (err) {
      console.error('Copy week failed:', err);
    }
  };

  // Paste the copied week onto the week containing the current date —
  // mapping each drill to the SAME weekday + time in the target week.
  const handlePasteWeek = async () => {
    if (!selectedPlayerId || copiedWeek.length === 0 || !copiedWeekStart) return;
    const targetStart = parseLocalDate(weekStartOf(currentDate));
    const srcStart = parseLocalDate(copiedWeekStart);
    const items = copiedWeek.map(ev => {
      const offset = Math.round((parseLocalDate(ev.date).getTime() - srcStart.getTime()) / 86400000);
      const tgt = new Date(targetStart);
      tgt.setDate(tgt.getDate() + offset);
      return {
        playerId: selectedPlayerId,
        drillId: ev.drillId || undefined,
        tab: ev.tab,
        category: ev.category,
        name: ev.name,
        date: toDateStr(tgt),
        time: ev.time,
        duration: ev.duration,
      };
    });
    try {
      await api.createScheduledDrillsBatch(items);
      refreshEvents();
    } catch (err) {
      console.error('Paste week failed:', err);
    }
  };

  /* ── Hook calls below MUST come before any early return so the hook
     order stays stable across renders. ── */

  // Find the selected player by ID — pure derivation, no hook.
  const selectedPlayer = players.find(p => p.id === selectedPlayerId);

  /* Position-aware visible tabs (Hitting / Pitching / Catching / Infield /
     Outfield / S&C). Falls back to the full catalog when no player is
     selected so the coach UI stays populated while picking an athlete. */
  const visibleTabs = useMemo(() => visibleTabsForPlayer(selectedPlayer), [selectedPlayer]);

  /* If the current activeTab is no longer in the visible list (e.g. coach
     just switched athletes), fall back to "All". */
  useEffect(() => {
    if (activeTab === 'all') return;
    if (!visibleTabs.some(t => t.key === activeTab)) {
      setActiveTab('all');
    }
  }, [visibleTabs, activeTab]);

  if (authLoading || !user) return null;

  const calTitle = view === 'month'
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : view === 'week'
      ? (() => {
          const d = new Date(currentDate);
          const dayOfWeek = d.getDay();
          d.setDate(d.getDate() - dayOfWeek);
          const end = new Date(d);
          end.setDate(d.getDate() + 6);
          return `${MONTHS[d.getMonth()]} ${d.getDate()} – ${d.getMonth() !== end.getMonth() ? MONTHS[end.getMonth()] + ' ' : ''}${end.getDate()}, ${end.getFullYear()}`;
        })()
      : currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const legendCats = getLegendCategories(activeTab);
  const todayDateStr = toDateStr(currentDate);

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <PageHeader
        eyebrow="Training Calendar"
        title={
          isCoach
            ? (selectedPlayer ? selectedPlayer.firstName : 'Select')
            : 'My'
        }
        titleAccent={
          isCoach
            ? (selectedPlayer ? selectedPlayer.lastName : 'Athlete')
            : 'Training'
        }
        subtitle={isCoach
          ? undefined
          : 'Your weekly drill schedule and training history.'}
        readout={todayDateStr}
      />

      {/* ── Calendar shell — lighter `profilePanel` outer bubble holds
          the athlete selector, view tabs/controls, and the calendar grid.
          The calendar grid itself uses the darker `innerPanel` tone, so
          the page reads as a clear two-tone hierarchy. */}
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 18, display: 'flex', flexDirection: 'column' }}
      >

      {/* ── Athlete Selector (Coach Only) ── */}
      {isCoach && (
        <div className={styles.athleteBar}>
          <span className={styles.athleteLabel}>Athlete</span>
          <select
            className={styles.athleteSelect}
            value={selectedPlayerId}
            onChange={e => setSelectedPlayerId(e.target.value)}
          >
            <option value="">Select an athlete...</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} — {p.positions}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Tab Bar (only shown in Week view — Month shows all tabs, Day uses columns) ── */}
      {view === 'week' && (
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === 'all' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All
          </button>
          {visibleTabs.map(t => {
            const isActive = activeTab === t.key;
            const tColor = TAB_COLORS[t.key];
            return (
              <button
                key={t.key}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                style={isActive ? { color: tColor.text, borderBottomColor: tColor.text } : undefined}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Calendar Controls ── */}
      <div className={styles.calControls}>
        <div className={styles.calNav}>
          <button className={styles.navBtn} onClick={() => navigate(-1)}>‹</button>
          <span className={styles.calTitle}>{calTitle}</span>
          <button className={styles.navBtn} onClick={() => navigate(1)}>›</button>
          <button className={styles.todayBtn} onClick={goToday}>Today</button>
          {/* Day/week actions live here next to Today. Edit/Copy/Paste act on
              the selected day (Day view); Copy Week / Paste Week act on the
              whole week and are available in Day + Week view. */}
          {isCoach && selectedPlayerId && (view === 'day' || view === 'week') && (
            <>
              <span className={styles.calNavDivider} aria-hidden="true" />
              {view === 'day' && (
                <>
                  <button className={styles.dayActionBtn} onClick={() => openEditModal(todayDateStr)} title="Edit this day's drills">Edit</button>
                  <button className={styles.dayActionBtn} onClick={() => handleCopyDay(todayDateStr)} title="Copy this day's drills">Copy</button>
                  {copiedDrills.length > 0 && (
                    <button className={styles.dayActionBtnAccent} onClick={() => handlePasteDay(todayDateStr)} title={copiedDate ? `Paste day from ${copiedDate}` : 'Paste copied day'}>Paste</button>
                  )}
                </>
              )}
              <button className={styles.dayActionBtn} onClick={handleCopyWeek} title="Copy this whole week's drills">Copy Week</button>
              {copiedWeek.length > 0 && (
                <button className={styles.dayActionBtnAccent} onClick={handlePasteWeek} title={copiedWeekStart ? `Paste week from ${copiedWeekStart}` : 'Paste copied week'}>Paste Week</button>
              )}
            </>
          )}
        </div>
        <div className={styles.viewSwitcher}>
          {(['month', 'week', 'day'] as const).map(v => (
            <button
              key={v}
              className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ''}`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
          {/* Download the upcoming schedule as a PDF (next-7-days drill-type
              strip + a calendar per selected type). Sits with Month/Week/Day. */}
          {selectedPlayerId && (
            <button
              type="button"
              className={styles.viewBtn}
              onClick={() => setShowScheduleDl(true)}
              title="Download schedule PDF"
              aria-label="Download schedule PDF"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 2v8M8 10l-3-3M8 10l3-3" />
                <path d="M2 12h12v2H2z" />
              </svg>
              PDF
            </button>
          )}
        </div>
      </div>

      {/* ── Legend (only shown in Week view when a specific tab is selected) ── */}
      {view === 'week' && activeTab !== 'all' && (
        <div className={styles.legend}>
          {legendCats.map(cat => (
            <div key={cat} className={styles.legendItem}>
              <span className={styles.legendDot} style={getTabCatStyle(activeTab, cat).dotStyle} />
              {cat}
            </div>
          ))}
        </div>
      )}

      {/* ── No player selected ── */}
      {!selectedPlayerId && (
        <div className={styles.empty}>
          Select an athlete to view their training calendar.
        </div>
      )}

      {/* ── Calendar Views ── */}
      {selectedPlayerId && view === 'month' && (
        <MonthView
          currentDate={currentDate}
          allEvents={events}
          onDayClick={(date) => { setCurrentDate(parseLocalDate(date)); setView('day'); }}
        />
      )}
      {selectedPlayerId && view === 'week' && (
        <WeekView
          currentDate={currentDate}
          eventsByDate={eventsByDate}
          allEvents={events}
          activeTab={activeTab}
          onDayClick={(date) => { setCurrentDate(parseLocalDate(date)); setView('day'); }}
          onDrillClick={(drill) => setViewingDrill(drill)}
        />
      )}
      {selectedPlayerId && view === 'day' && (
        <DayView
          currentDate={currentDate}
          allDayEvents={allEventsByDate[todayDateStr] || []}
          isCoach={isCoach}
          onDelete={handleDelete}
          onEdit={() => openEditModal(todayDateStr)}
          onCopy={() => handleCopyDay(todayDateStr)}
          onCopyTab={(tabKey) => handleCopyTab(todayDateStr, tabKey)}
          onPaste={() => handlePasteDay(todayDateStr)}
          hasCopied={copiedDrills.length > 0}
          copiedFromDate={copiedDate}
          onDrillClick={(drill) => setViewingDrill(drill)}
          visibleTabs={visibleTabs}
        />
      )}

      </div>{/* /calendar shell (.profilePanel) */}

      {/* ── Add Drill FAB (Coach only) ── */}
      {isCoach && selectedPlayerId && (
        <button className={styles.fab} onClick={() => openAddModal()} title="Add Drills">
          +
        </button>
      )}

      {/* ── Drill Dashboard Modal ── */}
      {showModal && (
        <DrillDashboardModal
          playerId={selectedPlayerId}
          initialDate={modalDate}
          existingEvents={modalEditExisting}
          visibleTabs={visibleTabs}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            refreshEvents();
            setShowModal(false);
          }}
        />
      )}

      {/* ── Drill Video Player Modal ── */}
      {viewingDrill && (
        <DrillVideoModal drill={viewingDrill} onClose={() => setViewingDrill(null)} />
      )}

      {/* ── Schedule Download (PDF) Modal ── */}
      {showScheduleDl && selectedPlayerId && (
        <ScheduleDownloadModal
          playerId={selectedPlayerId}
          playerName={(() => {
            const p = players.find((x) => x.id === selectedPlayerId);
            if (p) return `${p.firstName} ${p.lastName}`.trim();
            const u = user as any;
            return u?.name || (u?.email ? String(u.email).split('@')[0] : 'Player');
          })()}
          onClose={() => setShowScheduleDl(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Month View
   ══════════════════════════════════════════════════════════════════ */

function MonthView({
  currentDate,
  allEvents,
  onDayClick,
}: {
  currentDate: Date;
  allEvents: ScheduledDrill[];
  onDayClick: (date: string) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const today = toDateStr(new Date());

  const tabsByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = [];
      if (!map[e.date].includes(e.tab)) map[e.date].push(e.tab);
    }
    return map;
  }, [allEvents]);

  const cells: { date: string; day: number; isCurrentMonth: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const date = formatDate(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, d);
    cells.push({ date, day: d, isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: formatDate(year, month, d), day: d, isCurrentMonth: true });
  }
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      const date = formatDate(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, d);
      cells.push({ date, day: d, isCurrentMonth: false });
    }
  }

  return (
    <div className={styles.monthGrid}>
      {DAYS.map(d => <div key={d} className={styles.dayHeader}>{d}</div>)}
      {cells.map(cell => {
        const dayTabs = tabsByDate[cell.date] || [];
        const isToday = cell.date === today;
        return (
          <div
            key={cell.date}
            className={`${styles.dayCell} ${!cell.isCurrentMonth ? styles.dayCellOther : ''} ${isToday ? styles.dayCellToday : ''}`}
            onClick={() => onDayClick(cell.date)}
          >
            <div className={isToday ? styles.dayNumToday : styles.dayNum}>{cell.day}</div>
            {dayTabs.map(tab => {
              const color = TAB_COLORS[tab] || TAB_COLORS.hitting;
              return (
                <div key={tab} className={styles.eventPill} style={{ background: color.bg, color: color.text }}>
                  {TAB_LABELS[tab] || tab}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Week View
   ══════════════════════════════════════════════════════════════════ */

function WeekView({
  currentDate,
  eventsByDate,
  allEvents,
  activeTab,
  onDayClick,
  onDrillClick,
}: {
  currentDate: Date;
  eventsByDate: Record<string, ScheduledDrill[]>;
  allEvents: ScheduledDrill[];
  activeTab: string;
  onDayClick: (date: string) => void;
  onDrillClick: (drill: Drill) => void;
}) {
  const dayOfWeek = currentDate.getDay();
  const sunday = new Date(currentDate);
  sunday.setDate(currentDate.getDate() - dayOfWeek);
  const today = toDateStr(new Date());
  const weekDays: { date: Date; dateStr: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    weekDays.push({ date: d, dateStr: toDateStr(d) });
  }

  const isAll = activeTab === 'all';

  // For "All" tab, group all events by date then unique tabs
  const tabsByDate = useMemo(() => {
    if (!isAll) return {};
    const map: Record<string, string[]> = {};
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = [];
      if (!map[e.date].includes(e.tab)) map[e.date].push(e.tab);
    }
    return map;
  }, [allEvents, isAll]);

  return (
    <div className={styles.weekListGrid}>
      {weekDays.map(({ date, dateStr }) => {
        const isToday = dateStr === today;
        return (
          <div
            key={dateStr}
            className={`${styles.weekListCol} ${isToday ? styles.weekListColToday : ''}`}
            onClick={() => onDayClick(dateStr)}
          >
            <div className={styles.weekListHeader}>
              <div className={styles.weekListDayName}>{DAYS[date.getDay()]}</div>
              <div className={`${styles.weekListDayNum} ${isToday ? styles.weekListDayNumToday : ''}`}>
                {date.getDate()}
              </div>
            </div>
            <div className={styles.weekListBody}>
              {isAll ? (
                /* "All" tab — show tab pills like Month view */
                <>
                  {(tabsByDate[dateStr] || []).length === 0 && <div className={styles.weekListEmpty}>—</div>}
                  {(tabsByDate[dateStr] || []).map(tab => {
                    const color = TAB_COLORS[tab] || TAB_COLORS.hitting;
                    return (
                      <div key={tab} className={styles.weekListItem} style={{ background: color.bg, color: color.text }}>
                        {TAB_LABELS[tab] || tab}
                      </div>
                    );
                  })}
                </>
              ) : (
                /* Specific tab — show individual drill cards */
                <>
                  {(eventsByDate[dateStr] || []).length === 0 && <div className={styles.weekListEmpty}>—</div>}
                  {(eventsByDate[dateStr] || []).map(ev => {
                    const catStyle = getTabCatStyle(ev.tab, ev.category);
                    return (
                      <div
                        key={ev.id}
                        className={`${styles.weekListItem} ${ev.drill ? styles.weekListItemClickable : ''}`}
                        style={catStyle.bgStyle}
                        onClick={ev.drill ? (e) => { e.stopPropagation(); onDrillClick(ev.drill!); } : undefined}
                      >
                        <span style={catStyle.textStyle}>{ev.name}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Day View — 5 columns (Hitting / Pitching / Defense / S&C / Vision)
   ══════════════════════════════════════════════════════════════════ */

function DayView({
  currentDate,
  allDayEvents,
  isCoach,
  onDelete,
  onEdit,
  onCopy,
  onCopyTab,
  onPaste,
  hasCopied,
  copiedFromDate,
  onDrillClick,
  visibleTabs,
}: {
  currentDate: Date;
  allDayEvents: ScheduledDrill[];
  isCoach: boolean;
  onDelete: (id: string) => void;
  onEdit: () => void;
  onCopy: () => void;
  /** Copy a single tab's drills (just Hitting / just Pitching / etc.)
   *  — same clipboard the day-wide `onCopy` uses, filtered to one
   *  tab. Coaches can hit a per-column Copy button then paste those
   *  drills onto another day's same column. */
  onCopyTab: (tabKey: string) => void;
  onPaste: () => void;
  hasCopied: boolean;
  copiedFromDate: string | null;
  onDrillClick: (drill: Drill) => void;
  /** Position-aware tabs from the parent — drives the day grid columns. */
  visibleTabs: typeof TABS;
}) {
  const dateLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  /* Focused-tab state — null means "show full day across every visible
   * column". Clicking a column header narrows the view to just that tab
   * (Pitching only, Hitting only, etc.) so the user can read a single
   * area's plan at a comfortable size. Click "← All areas" to return.
   * Drill-click → DrillVideoModal flow is unchanged in both modes. */
  const [focusedTab, setFocusedTab] = useState<string | null>(null);

  // Group events by tab
  const eventsByTab = useMemo(() => {
    const map: Record<string, ScheduledDrill[]> = {};
    for (const t of TABS) map[t.key] = [];
    for (const ev of allDayEvents) {
      if (map[ev.tab]) map[ev.tab].push(ev);
    }
    return map;
  }, [allDayEvents]);

  /* Group a tab's events into "category bubbles" preserving the natural
   * ordering coaches expect (Movement Prep → Drills → Bullpen → Live → ...).
   * Uses the LEGEND_CATEGORIES map as the canonical order; anything not
   * in that list (legacy categories, one-offs) falls to the end sorted
   * alphabetically so it never disappears from the UI. */
  const groupByCategory = (events: ScheduledDrill[], tabKey: string) => {
    const canonical = LEGEND_CATEGORIES[tabKey] || [];
    const buckets = new Map<string, ScheduledDrill[]>();
    for (const ev of events) {
      const key = ev.category || 'Other';
      const arr = buckets.get(key) || [];
      arr.push(ev);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      const ai = canonical.indexOf(a);
      const bi = canonical.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  };

  // When entering focus mode, look up the tab's metadata once.
  const focusedTabMeta = focusedTab ? visibleTabs.find((t) => t.key === focusedTab) ?? null : null;
  const focusedEvents = focusedTab ? (eventsByTab[focusedTab] || []) : [];
  const focusedColor = focusedTab ? (TAB_COLORS[focusedTab] || TAB_COLORS.hitting) : null;

  /* Columns appear ONLY for areas that have at least one drill scheduled this
   * day — an empty category no longer renders a blank column. Coaches add to a
   * new area via Edit; its column appears once that area has a drill. */
  const populatedTabs = visibleTabs.filter((t) => (eventsByTab[t.key] || []).length > 0);

  return (
    <div className={styles.dayView}>
      {/* Header with date + action buttons */}
      <div className={styles.dayViewHeader}>
        <div className={styles.dayViewHeadLeft}>
          <span className={styles.dayViewTitle}>{dateLabel}</span>
          <span className={styles.dayViewSubtitle}>
            {focusedTabMeta ? (
              <>
                {focusedTabMeta.label} only · {focusedEvents.length} drill{focusedEvents.length !== 1 ? 's' : ''}
              </>
            ) : (
              <>{allDayEvents.length} drill{allDayEvents.length !== 1 ? 's' : ''} scheduled</>
            )}
          </span>
        </div>
        <div className={styles.dayActions}>
          {focusedTabMeta && (
            <button
              className={styles.dayActionBtn}
              onClick={() => setFocusedTab(null)}
              title="Back to the full day across every area"
            >
              ← All areas
            </button>
          )}
          {/* While focused on a single tab the coach can still copy
              just THAT tab's drills via this button (mirrors the
              column-header Copy in the multi-column view). Hidden
              when the focused tab has no drills to copy. */}
          {isCoach && focusedTabMeta && focusedEvents.length > 0 && (
            <button
              className={styles.dayActionBtn}
              onClick={() => onCopyTab(focusedTabMeta.key)}
              title={`Copy ${focusedTabMeta.label} drills only`}
            >
              Copy {focusedTabMeta.label}
            </button>
          )}
          {/* Day-level Edit / Copy / Paste / Copy Week now live in the
              calendar nav next to the Today button. */}
          {/* Paste also available in focused mode — pastes whatever
              is on the clipboard (full-day OR single-tab) onto the
              current day. */}
          {isCoach && focusedTabMeta && hasCopied && (
            <button
              className={styles.dayActionBtnAccent}
              onClick={onPaste}
              title={`Paste drills from ${copiedFromDate}`}
            >
              Paste
            </button>
          )}
        </div>
      </div>

      {focusedTabMeta && focusedColor ? (
        /* ── Focused single-tab view ──
         * Same drill cards as the multi-column grid, but larger and
         * stacked single-column so the area's plan reads like a list
         * instead of being squeezed into a 1/6th-width column. Cards
         * keep the click → DrillVideoModal behavior. */
        <div
          className={styles.dayFocus}
          style={{ borderTop: `3px solid ${focusedColor.text}` }}
        >
          <div
            className={styles.dayFocusHeader}
            style={{ background: focusedColor.bg }}
          >
            <span className={styles.dayFocusTitle} style={{ color: focusedColor.text }}>
              {focusedTabMeta.label}
            </span>
            <span className={styles.dayFocusCount}>
              {focusedEvents.length} drill{focusedEvents.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.dayFocusBody}>
            {focusedEvents.length === 0 ? (
              <div className={styles.dayFocusEmpty}>
                No {focusedTabMeta.label.toLowerCase()} drills scheduled for this day.
              </div>
            ) : (
              /* One category-bubble per category (Movement Prep / Drills /
                 Live / etc.) — same grouping logic as the multi-column
                 view. Inside each bubble: list of drill names, each
                 individually clickable + deletable. */
              groupByCategory(focusedEvents, focusedTabMeta.key).map(([category, items]) => {
                const catStyle = getTabCatStyle(focusedTabMeta.key, category);
                return (
                  <div
                    key={category}
                    className={styles.dayFocusCard}
                    style={catStyle.bgStyle}
                  >
                    <div className={styles.dayFocusCardTop}>
                      <span className={styles.dayColCardCat} style={catStyle.textStyle}>
                        {category}
                      </span>
                      <span className={styles.dayFocusBubbleCount} style={catStyle.textStyle}>
                        {items.length}
                      </span>
                    </div>
                    <div className={styles.dayFocusCardList}>
                      {items.map((ev) => (
                        <div
                          key={ev.id}
                          className={`${styles.dayFocusCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                          onClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                        >
                          <span className={styles.dayFocusCardItemName}>{ev.name}</span>
                          {isCoach && (
                            <button
                              className={styles.dayEventDelete}
                              onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }}
                              title="Delete"
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : populatedTabs.length === 0 ? (
        /* No area has a drill scheduled this day → show a note instead of a
           row of empty columns. */
        <div className={styles.dayFocusEmpty} style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
          No workouts scheduled for this day.
        </div>
      ) : (
        /* ── Default multi-column grid — only areas WITH drills get a column ── */
        <div className={styles.dayGrid} style={{ gridTemplateColumns: `repeat(${populatedTabs.length}, 1fr)` }}>
          {populatedTabs.map(tab => {
            const tabEvents = eventsByTab[tab.key] || [];
            const tabColor = TAB_COLORS[tab.key] || TAB_COLORS.hitting;
            return (
              <div key={tab.key} className={styles.dayCol}>
                {/* Column header — `<div>` wrapper instead of a single
                    `<button>` so the focus-tab click and the per-tab
                    Copy click can each be their own buttons (nested
                    `<button>` would be invalid HTML). The CSS
                    `.dayColHeader` styles still apply because the
                    selector matches class only, not element type. */}
                <div
                  className={styles.dayColHeader}
                  style={{ borderBottomColor: tabColor.text, cursor: 'default' }}
                >
                  <button
                    type="button"
                    onClick={() => setFocusedTab(tab.key)}
                    title={`Focus on ${tab.label}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    <span className={styles.dayColTitle} style={{ color: tabColor.text }}>{tab.label}</span>
                    {tabEvents.length > 0 && (
                      <span className={styles.dayColCount} style={{ background: tabColor.bg, color: tabColor.text }}>
                        {tabEvents.length}
                      </span>
                    )}
                  </button>
                  {/* Per-tab Copy button — always rendered for coaches
                      so the affordance is visible regardless of
                      whether the column currently has drills.
                      Disabled (with a tooltip) when there's nothing
                      to copy so the empty-clipboard case is obvious
                      instead of the button silently disappearing. */}
                  {isCoach && (
                    <button
                      type="button"
                      disabled={tabEvents.length === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tabEvents.length > 0) onCopyTab(tab.key);
                      }}
                      title={tabEvents.length > 0
                        ? `Copy ${tab.label} drills only`
                        : `No ${tab.label} drills to copy`}
                      style={{
                        background: tabEvents.length > 0
                          ? tabColor.bg
                          : 'transparent',
                        border: `1px solid ${tabColor.text}`,
                        color: tabColor.text,
                        padding: '2px 8px',
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        cursor: tabEvents.length > 0 ? 'pointer' : 'not-allowed',
                        opacity: tabEvents.length > 0 ? 1 : 0.4,
                        marginLeft: 'auto',
                        flexShrink: 0,
                      }}
                    >
                      Copy
                    </button>
                  )}
                </div>
                <div className={styles.dayColBody}>
                  {tabEvents.length === 0 && (
                    <div className={styles.dayColEmpty}>—</div>
                  )}
                  {/* Group this tab's drills into one bubble per category
                      (Movement Prep / Drills / Bullpen / Live / ...). Drill
                      names list inside the bubble; click any name to open
                      the per-drill modal, × to delete that one entry. */}
                  {groupByCategory(tabEvents, tab.key).map(([category, items]) => {
                    const catStyle = getTabCatStyle(tab.key, category);
                    return (
                      <div
                        key={category}
                        className={styles.dayColCard}
                        style={catStyle.bgStyle}
                      >
                        <div className={styles.dayColCardTop}>
                          <span className={styles.dayColCardCat} style={catStyle.textStyle}>{category}</span>
                        </div>
                        <div className={styles.dayColCardList}>
                          {items.map((ev) => (
                            <div
                              key={ev.id}
                              className={`${styles.dayColCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                              onClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                            >
                              <span className={styles.dayColCardItemName}>{ev.name}</span>
                              {isCoach && (
                                <button
                                  className={styles.dayEventDelete}
                                  onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }}
                                  title="Delete"
                                >×</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Multi-Select Dropdown Component
   ══════════════════════════════════════════════════════════════════ */

function MultiSelectDropdown({
  label,
  drills,
  selected,
  onToggle,
  color,
}: {
  label: string;
  drills: Drill[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return drills;
    const q = search.toLowerCase();
    return drills.filter(d => d.name.toLowerCase().includes(q));
  }, [drills, search]);

  const selectedDrills = drills.filter(d => selected.has(d.id));
  const count = selected.size;

  // Always show the dropdown section even if empty — coach can still see the label

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <div className={styles.multiWrap} ref={wrapRef}>
        <div
          role="button"
          tabIndex={0}
          className={styles.multiTrigger}
          style={{ borderColor: color }}
          onClick={() => setOpen(!open)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        >
          {/* Selected drills render as chips INSIDE the trigger bubble; the
              "N Selected" badge sits at the far right. */}
          <div className={styles.multiTriggerChips}>
            {selectedDrills.length === 0 ? (
              <span className={styles.multiPlaceholder}>Select {label}...</span>
            ) : (
              selectedDrills.map(d => (
                <span key={d.id} className={styles.multiChip} style={{ background: hexToRgba(color, 0.13), color }}>
                  {d.name}
                  <button
                    type="button"
                    className={styles.multiChipRemove}
                    onClick={e => { e.stopPropagation(); onToggle(d.id); }}
                  >×</button>
                </span>
              ))
            )}
          </div>
          {count > 0 && <span className={styles.multiCount}>{count} Selected</span>}
          <span className={styles.multiChevron}>{open ? '▲' : '▼'}</span>
        </div>

        {open && (
          <div className={styles.multiPanel}>
            <div className={styles.multiSearch}>
              <input
                type="text"
                className={styles.multiSearchInput}
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.multiList}>
              {filtered.length === 0 && <div className={styles.multiEmpty}>No drills found</div>}
              {filtered.map(d => {
                const isSelected = selected.has(d.id);
                return (
                  <label key={d.id} className={`${styles.multiItem} ${isSelected ? styles.multiItemSelected : ''}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggle(d.id)} className={styles.multiCheckbox} />
                    <span className={styles.multiItemName}>{d.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Drill Dashboard Modal — Tabbed (Hitting / Pitching / Defense / S&C / Vision)
   Selections persist across tabs. Edit mode pre-fills from existing drills.
   ══════════════════════════════════════════════════════════════════ */

function DrillDashboardModal({
  playerId,
  initialDate,
  existingEvents,
  visibleTabs,
  onClose,
  onSaved,
}: {
  playerId: string;
  initialDate: string;
  existingEvents: ScheduledDrill[];
  /** Position-aware tab list from the parent — drives the modal's tab nav. */
  visibleTabs: typeof TABS;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  // Default to the first visible tab so a pitcher-only athlete starts on
  // Pitching instead of an invisible Hitting tab.
  const [modalTab, setModalTab] = useState(visibleTabs[0]?.key ?? 'hitting');
  const [saving, setSaving] = useState(false);
  const isEdit = existingEvents.length > 0;

  // Per-dropdown selection — keyed by dropdown key (e.g. 'h-tee', 'h-ft') so
  // the SAME drill can be picked in Tee but not Front Toss, even though both
  // pull from the shared "Drills" library category.
  const [selectedByDd, setSelectedByDd] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const ev of existingEvents) {
      if (!ev.drillId) continue;
      const dds = MODAL_DROPDOWNS[ev.tab] || [];
      // New records save the SECTION as the category (e.g. 'Tee'); older
      // records saved the library dbCategory (e.g. 'Drills') — fall back to
      // the first dropdown that pulls from it.
      const dd = dds.find(d => d.label === ev.category) || dds.find(d => d.dbCategory === ev.category);
      if (!dd) continue;
      (init[dd.key] ||= new Set<string>()).add(ev.drillId);
    }
    return init;
  });

  // Load ALL drills from library once
  const [allDrills, setAllDrills] = useState<Drill[]>([]);
  useEffect(() => {
    api.getDrills().then(setAllDrills).catch(() => setAllDrills([]));
  }, []);

  // Drills for current modal tab, split by dropdown dbCategory
  const tabDrills = useMemo(() => allDrills.filter(d => d.tab === modalTab), [allDrills, modalTab]);
  const modalCategories = MODAL_DROPDOWNS[modalTab] || [];
  const drillsByDropdown = useMemo(() => {
    const map: Record<string, Drill[]> = {};
    for (const dd of modalCategories) {
      map[dd.key] = tabDrills.filter(d => d.category === dd.dbCategory);
    }
    return map;
  }, [tabDrills, modalCategories]);

  // Per-tab badge counts = sum of that tab's dropdown-section selections.
  const countsPerTab = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of TABS) {
      const dds = MODAL_DROPDOWNS[t.key] || [];
      counts[t.key] = dds.reduce((sum, dd) => sum + (selectedByDd[dd.key]?.size || 0), 0);
    }
    return counts;
  }, [selectedByDd]);

  const totalSelected = useMemo(
    () => Object.values(selectedByDd).reduce((sum, set) => sum + set.size, 0),
    [selectedByDd],
  );

  const toggleInDd = (ddKey: string, id: string) => {
    setSelectedByDd(prev => {
      const set = new Set(prev[ddKey] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [ddKey]: set };
    });
  };

  const handleSave = async () => {
    if (totalSelected === 0 && !isEdit) return;
    setSaving(true);

    try {
      /* If editing, replace only the LIBRARY-linked events (those with a
         drillId the recreate step can rebuild from the per-section
         selection). One-off scheduled entries with no drillId can't be
         re-created from the selection, so deleting them here would silently
         destroy hand-entered drills. The save loop below adds back exactly
         the currently-selected drills per section, so library-linked
         existing events that are still selected get a delete-then-recreate
         (idempotent) and library-linked events that are NOT selected get
         removed. */
      if (isEdit) {
        for (const ev of existingEvents) {
          if (ev.drillId == null) continue;       // preserve hand-entered
          await api.deleteScheduledDrill(ev.id);
        }
      }

      // Build batch items from all selected drill IDs
      if (totalSelected > 0) {
        const items: {
          playerId: string;
          drillId: string;
          tab: string;
          category: string;
          name: string;
          date: string;
          time: string;
          duration: number;
        }[] = [];

        const makeTime = (slot: number) => {
          const h = Math.floor(slot / 60);
          const m = slot % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        // One scheduled-drill per (dropdown section × selected drill). The
        // saved `category` is the SECTION label (Tee / Front Toss / Movement
        // Prep …) — NOT the shared library dbCategory — so each section round-
        // trips on edit and shows in its own area on the calendar.
        for (const tab of TABS) {
          let timeSlot = 9 * 60;
          const dropdowns = MODAL_DROPDOWNS[tab.key] || [];
          for (const dd of dropdowns) {
            const set = selectedByDd[dd.key];
            if (!set || set.size === 0) continue;
            for (const drillId of set) {
              const drill = allDrills.find(d => d.id === drillId);
              if (!drill) continue;
              items.push({ playerId, drillId: drill.id, tab: tab.key, category: dd.label, name: drill.name, date, time: makeTime(timeSlot), duration: 15 });
              timeSlot += 15;
            }
          }
        }

        if (items.length > 0) {
          await api.createScheduledDrillsBatch(items);
        }
      }

      onSaved();
    } catch (err) {
      console.error('Failed to save drills:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.dashModal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{isEdit ? 'Edit Day' : 'Add Drills'}</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        {/* Date */}
        <div className={styles.dashDate}>
          <label className={styles.fieldLabel}>Date</label>
          <input
            type="date"
            className={styles.fieldInput}
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={isEdit}
          />
        </div>

        {/* Tab bar inside modal — only the position-applicable tabs */}
        <div className={styles.dashTabBar}>
          {visibleTabs.map(t => {
            const count = countsPerTab[t.key] || 0;
            const isActive = modalTab === t.key;
            const tColor = TAB_COLORS[t.key];
            return (
              <button
                key={t.key}
                className={`${styles.dashTab} ${isActive ? styles.dashTabActive : ''}`}
                style={isActive ? { color: tColor.text, borderBottomColor: tColor.text } : undefined}
                onClick={() => setModalTab(t.key)}
              >
                {t.label}
                {count > 0 && <span className={styles.dashTabBadge} style={{ background: tColor.text }}>{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Dropdowns for current tab — one per dropdown section */}
        <div className={styles.dashBody}>
          {modalCategories.map(dd => (
            <MultiSelectDropdown
              key={dd.key}
              label={dd.label}
              drills={drillsByDropdown[dd.key] || []}
              selected={selectedByDd[dd.key] || EMPTY_SET}
              onToggle={(id) => toggleInDd(dd.key, id)}
              color={dd.color}
            />
          ))}

          {tabDrills.length === 0 && (
            <div className={styles.dashEmpty}>No drills in the library for {TAB_LABELS[modalTab] || modalTab}.</div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button
            className={styles.btnSave}
            onClick={handleSave}
            disabled={saving || (totalSelected === 0 && !isEdit)}
          >
            {saving ? 'Saving...' : isEdit ? `Save (${totalSelected} drill${totalSelected !== 1 ? 's' : ''})` : `Add ${totalSelected} Drill${totalSelected !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Drill Video Player Modal
   ══════════════════════════════════════════════════════════════════ */

function DrillVideoModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.videoModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{drill.name}</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.videoContainer}>
          {drill.videoUrl ? (
            <video
              className={styles.videoPlayer}
              src={drill.videoUrl}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <div className={styles.noVideo}>No video uploaded for this drill</div>
          )}
        </div>
        {drill.description && (
          <div className={styles.videoDesc}>
            <div className={styles.videoDescLabel}>Description</div>
            <div className={styles.videoDescText}>{drill.description}</div>
          </div>
        )}
        <div className={styles.videoMeta}>
          <span className={styles.videoMetaTag}>{TAB_LABELS[drill.tab] || drill.tab}</span>
          <span className={styles.videoMetaTag}>{drill.category}</span>
        </div>
      </div>
    </div>
  );
}
