'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Drill, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';

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

/* ── Tab+Category Color System ──
   Each tab has a base hue (Blue/Red/Green/Orange/Yellow).
   Categories within each tab graduate from LIGHTEST → DARKEST top-to-bottom. */
const TAB_CAT_COLORS: Record<string, Record<string, { dot: string; bg: string; text: string }>> = {
  /* Hitting — Blues: pastel → sky → blue → dark blue → navy */
  hitting: {
    'Movement Prep':    { dot: '#B8D8F8', bg: 'rgba(184,216,248,0.13)', text: '#B8D8F8' },
    'Drills':           { dot: '#82B8E8', bg: 'rgba(130,184,232,0.13)', text: '#82B8E8' },
    'Batting Practice': { dot: '#4A90D9', bg: 'rgba(74,144,217,0.13)',  text: '#4A90D9' },
    'Machine':          { dot: '#2E6DB5', bg: 'rgba(46,109,181,0.13)',  text: '#2E6DB5' },
    'Live':             { dot: '#1B4F8A', bg: 'rgba(27,79,138,0.15)',   text: '#1B4F8A' },
  },
  /* Pitching — Reds: pink → salmon → red → dark red → maroon */
  pitching: {
    'Movement Prep': { dot: '#F8B8B8', bg: 'rgba(248,184,184,0.13)', text: '#F8B8B8' },
    'Drills':        { dot: '#E88282', bg: 'rgba(232,130,130,0.13)', text: '#E88282' },
    'Bullpen':       { dot: '#D44A4A', bg: 'rgba(212,74,74,0.13)',   text: '#D44A4A' },
    'Live':          { dot: '#B52E2E', bg: 'rgba(181,46,46,0.15)',   text: '#B52E2E' },
    'Post-Throw':    { dot: '#8B1C2C', bg: 'rgba(139,28,44,0.18)',   text: '#8B1C2C' },
  },
  /* Catching — Teal-greens (cool side of the green family) */
  catching: {
    'Movement Prep': { dot: '#A0E8D8', bg: 'rgba(160,232,216,0.13)', text: '#A0E8D8' },
    'Drills':        { dot: '#5FD4B5', bg: 'rgba(95,212,181,0.13)',  text: '#5FD4B5' },
    'Machine':       { dot: '#1FB58E', bg: 'rgba(31,181,142,0.13)',  text: '#1FB58E' },
    'Live':          { dot: '#0E8E70', bg: 'rgba(14,142,112,0.15)',  text: '#0E8E70' },
  },
  /* Infield — True greens: mint → light green → green → forest */
  infield: {
    'Movement Prep': { dot: '#B0F0B0', bg: 'rgba(176,240,176,0.13)', text: '#B0F0B0' },
    'Drills':        { dot: '#6ED06E', bg: 'rgba(110,208,110,0.13)', text: '#6ED06E' },
    'Machine':       { dot: '#38A850', bg: 'rgba(56,168,80,0.13)',   text: '#38A850' },
    'Live':          { dot: '#1E7A32', bg: 'rgba(30,122,50,0.15)',   text: '#1E7A32' },
  },
  /* Outfield — Lime / yellow-greens (warm side of the green family) */
  outfield: {
    'Movement Prep': { dot: '#DAF0A0', bg: 'rgba(218,240,160,0.13)', text: '#DAF0A0' },
    'Drills':        { dot: '#B8D870', bg: 'rgba(184,216,112,0.13)', text: '#B8D870' },
    'Machine':       { dot: '#88B838', bg: 'rgba(136,184,56,0.13)',  text: '#88B838' },
    'Live':          { dot: '#5A8418', bg: 'rgba(90,132,24,0.15)',   text: '#5A8418' },
  },
  /* S&C — Oranges: peach → light orange → orange → burnt */
  strength: {
    'Movement Prep': { dot: '#FDE0A8', bg: 'rgba(253,224,168,0.13)', text: '#FDE0A8' },
    'Exercises':     { dot: '#F0A830', bg: 'rgba(240,168,48,0.13)',   text: '#F0A830' },
    'Cool Down':     { dot: '#C07818', bg: 'rgba(192,120,24,0.15)',   text: '#C07818' },
  },
};

const DEFAULT_CAT_COLOR = { dot: '#5A9BD5', bg: 'rgba(90,155,213,0.13)', text: '#5A9BD5' };

function getTabCatStyle(tab: string, category: string) {
  const c = TAB_CAT_COLORS[tab]?.[category] || DEFAULT_CAT_COLOR;
  return {
    dotStyle: { background: c.dot },
    bgStyle: { background: c.bg, borderLeft: `3px solid ${c.dot}` },
    textStyle: { color: c.text },
    color: c.dot,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TAB_COLORS: Record<string, { bg: string; text: string }> = {
  hitting:  { bg: 'rgba(59,130,210,0.15)',  text: '#3B82D2' },
  pitching: { bg: 'rgba(220,70,70,0.15)',   text: '#DC4646' },
  catching: { bg: 'rgba(31,181,142,0.15)',  text: '#1FB58E' },
  infield:  { bg: 'rgba(56,168,80,0.15)',   text: '#38A850' },
  outfield: { bg: 'rgba(136,184,56,0.15)',  text: '#88B838' },
  strength: { bg: 'rgba(234,146,48,0.15)',  text: '#EA9230' },
};

const TAB_LABELS: Record<string, string> = {
  hitting: 'Hitting',
  pitching: 'Pitching',
  catching: 'Catching',
  infield: 'Infield',
  outfield: 'Outfield',
  strength: 'S&C',
};

/* Modal dropdown config per tab — `dbCategory` is the Drill Library category it pulls from.
   Multiple dropdowns can share the same dbCategory (e.g. Tee & Front Toss both pull from "Drills").
   `color` is the hex accent color for that dropdown (border, chips). */
type ModalDropdown = { key: string; label: string; dbCategory: string; color: string };
const MODAL_DROPDOWNS: Record<string, ModalDropdown[]> = {
  /* Hitting dropdowns — lightest → darkest (Tee & Front Toss sit between MP and BP) */
  hitting: [
    { key: 'h-mp',  label: 'Movement Prep',     dbCategory: 'Movement Prep',     color: '#B8D8F8' },
    { key: 'h-tee', label: 'Tee',               dbCategory: 'Drills',            color: '#9AC8F0' },
    { key: 'h-ft',  label: 'Front Toss',        dbCategory: 'Drills',            color: '#82B8E8' },
    { key: 'h-bp',  label: 'Batting Practice',  dbCategory: 'Batting Practice',  color: '#4A90D9' },
    { key: 'h-mac', label: 'Machine',           dbCategory: 'Machine',           color: '#2E6DB5' },
    { key: 'h-lv',  label: 'Live',              dbCategory: 'Live',              color: '#1B4F8A' },
  ],
  /* Pitching dropdowns — lightest → darkest */
  pitching: [
    { key: 'p-mp',  label: 'Movement Prep', dbCategory: 'Movement Prep', color: '#F8B8B8' },
    { key: 'p-dr',  label: 'Drills',        dbCategory: 'Drills',        color: '#E88282' },
    { key: 'p-bp',  label: 'Bullpen',       dbCategory: 'Bullpen',       color: '#D44A4A' },
    { key: 'p-lv',  label: 'Live',          dbCategory: 'Live',          color: '#B52E2E' },
    { key: 'p-pt',  label: 'Post-Throw',    dbCategory: 'Post-Throw',    color: '#8B1C2C' },
  ],
  /* Catching dropdowns — teal-greens, lightest → darkest */
  catching: [
    { key: 'c-mp',  label: 'Movement Prep', dbCategory: 'Movement Prep', color: '#A0E8D8' },
    { key: 'c-dr',  label: 'Drills',        dbCategory: 'Drills',        color: '#5FD4B5' },
    { key: 'c-mac', label: 'Machine',       dbCategory: 'Machine',       color: '#1FB58E' },
    { key: 'c-lv',  label: 'Live',          dbCategory: 'Live',          color: '#0E8E70' },
  ],
  /* Infield dropdowns — true greens, lightest → darkest */
  infield: [
    { key: 'i-mp',  label: 'Movement Prep', dbCategory: 'Movement Prep', color: '#B0F0B0' },
    { key: 'i-dr',  label: 'Drills',        dbCategory: 'Drills',        color: '#6ED06E' },
    { key: 'i-mac', label: 'Machine',       dbCategory: 'Machine',       color: '#38A850' },
    { key: 'i-lv',  label: 'Live',          dbCategory: 'Live',          color: '#1E7A32' },
  ],
  /* Outfield dropdowns — lime / yellow-greens, lightest → darkest */
  outfield: [
    { key: 'o-mp',  label: 'Movement Prep', dbCategory: 'Movement Prep', color: '#DAF0A0' },
    { key: 'o-dr',  label: 'Drills',        dbCategory: 'Drills',        color: '#B8D870' },
    { key: 'o-mac', label: 'Machine',       dbCategory: 'Machine',       color: '#88B838' },
    { key: 'o-lv',  label: 'Live',          dbCategory: 'Live',          color: '#5A8418' },
  ],
  /* S&C dropdowns — lightest → darkest */
  strength: [
    { key: 's-mp',  label: 'Movement Prep', dbCategory: 'Movement Prep', color: '#FDE0A8' },
    { key: 's-ex',  label: 'Exercises',     dbCategory: 'Exercises',     color: '#F0A830' },
    { key: 's-cd',  label: 'Cool Down',     dbCategory: 'Cool Down',     color: '#C07818' },
  ],
};

/* Unique DB categories per tab — for calendar legend */
const LEGEND_CATEGORIES: Record<string, string[]> = {
  hitting:  ['Movement Prep', 'Drills', 'Batting Practice', 'Machine', 'Live'],
  pitching: ['Movement Prep', 'Drills', 'Bullpen', 'Live', 'Post-Throw'],
  catching: ['Movement Prep', 'Drills', 'Machine', 'Live'],
  infield:  ['Movement Prep', 'Drills', 'Machine', 'Live'],
  outfield: ['Movement Prep', 'Drills', 'Machine', 'Live'],
  strength: ['Movement Prep', 'Exercises', 'Cool Down'],
};

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toDateStr(date: Date): string {
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
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
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 11));
  const [events, setEvents] = useState<ScheduledDrill[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [modalEditExisting, setModalEditExisting] = useState<ScheduledDrill[]>([]);

  // Copy/paste state
  const [copiedDate, setCopiedDate] = useState<string | null>(null);
  const [copiedDrills, setCopiedDrills] = useState<ScheduledDrill[]>([]);

  // Drill video viewer state
  const [viewingDrill, setViewingDrill] = useState<Drill | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

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

  // Copy day
  const handleCopyDay = (date: string) => {
    setCopiedDate(date);
    setCopiedDrills(allEventsByDate[date] || []);
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
          ? 'Build and schedule drills for each athlete\u2019s weekly plan.'
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
          onDayClick={(date) => { setCurrentDate(new Date(date + 'T12:00:00')); setView('day'); }}
        />
      )}
      {selectedPlayerId && view === 'week' && (
        <WeekView
          currentDate={currentDate}
          eventsByDate={eventsByDate}
          allEvents={events}
          activeTab={activeTab}
          onDayClick={(date) => { setCurrentDate(new Date(date + 'T12:00:00')); setView('day'); }}
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
  onPaste: () => void;
  hasCopied: boolean;
  copiedFromDate: string | null;
  onDrillClick: (drill: Drill) => void;
  /** Position-aware tabs from the parent — drives the day grid columns. */
  visibleTabs: typeof TABS;
}) {
  const dateLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Group events by tab
  const eventsByTab = useMemo(() => {
    const map: Record<string, ScheduledDrill[]> = {};
    for (const t of TABS) map[t.key] = [];
    for (const ev of allDayEvents) {
      if (map[ev.tab]) map[ev.tab].push(ev);
    }
    return map;
  }, [allDayEvents]);

  return (
    <div className={styles.dayView}>
      {/* Header with date + action buttons */}
      <div className={styles.dayViewHeader}>
        <div>
          <div className={styles.dayViewTitle}>{dateLabel}</div>
          <div className={styles.dayViewSubtitle}>{allDayEvents.length} drill{allDayEvents.length !== 1 ? 's' : ''} scheduled</div>
        </div>
        {isCoach && (
          <div className={styles.dayActions}>
            <button className={styles.dayActionBtn} onClick={onEdit} title="Edit day's drills">
              Edit
            </button>
            <button className={styles.dayActionBtn} onClick={onCopy} title="Copy this day's drills">
              Copy
            </button>
            {hasCopied && (
              <button className={styles.dayActionBtnAccent} onClick={onPaste} title={`Paste drills from ${copiedFromDate}`}>
                Paste
              </button>
            )}
          </div>
        )}
      </div>

      {/* Position-aware columns — one per visible tab for this athlete */}
      <div className={styles.dayGrid} style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
        {visibleTabs.map(tab => {
          const tabEvents = eventsByTab[tab.key] || [];
          const tabColor = TAB_COLORS[tab.key] || TAB_COLORS.hitting;
          return (
            <div key={tab.key} className={styles.dayCol}>
              <div className={styles.dayColHeader} style={{ borderBottomColor: tabColor.text }}>
                <span className={styles.dayColTitle} style={{ color: tabColor.text }}>{tab.label}</span>
                {tabEvents.length > 0 && (
                  <span className={styles.dayColCount} style={{ background: tabColor.bg, color: tabColor.text }}>
                    {tabEvents.length}
                  </span>
                )}
              </div>
              <div className={styles.dayColBody}>
                {tabEvents.length === 0 && (
                  <div className={styles.dayColEmpty}>—</div>
                )}
                {tabEvents.map(ev => {
                  const catStyle = getTabCatStyle(tab.key, ev.category);
                  return (
                    <div
                      key={ev.id}
                      className={`${styles.dayColCard} ${ev.drill ? styles.dayColCardClickable : ''}`}
                      style={catStyle.bgStyle}
                      onClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                    >
                      <div className={styles.dayColCardTop}>
                        <span className={styles.dayColCardCat} style={catStyle.textStyle}>{ev.category}</span>
                        {isCoach && (
                          <button className={styles.dayEventDelete} onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }} title="Delete">×</button>
                        )}
                      </div>
                      <div className={styles.dayColCardName}>{ev.name}</div>
                      {ev.drill?.description && (
                        <div className={styles.dayColCardDesc}>{ev.drill.description}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
        <button
          type="button"
          className={styles.multiTrigger}
          style={{ borderColor: color }}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.multiTriggerText}>
            {count === 0 ? `Select ${label}...` : `${count} selected`}
          </span>
          <span className={styles.multiChevron}>{open ? '▲' : '▼'}</span>
        </button>

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

        {selectedDrills.length > 0 && (
          <div className={styles.multiChips}>
            {selectedDrills.map(d => (
              <span key={d.id} className={styles.multiChip} style={{ background: hexToRgba(color, 0.13), color: color }}>
                {d.name}
                <button type="button" className={styles.multiChipRemove} onClick={() => onToggle(d.id)}>×</button>
              </span>
            ))}
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

  // Single set of selected drill IDs — persists across all tab switches
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // Pre-populate from existing events when editing
    const ids = new Set<string>();
    for (const ev of existingEvents) {
      if (ev.drillId) ids.add(ev.drillId);
    }
    return ids;
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

  // Count selections per tab for badges
  const countsPerTab = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of TABS) counts[t.key] = 0;
    for (const id of selectedIds) {
      const drill = allDrills.find(d => d.id === id);
      if (drill) counts[drill.tab] = (counts[drill.tab] || 0) + 1;
    }
    return counts;
  }, [selectedIds, allDrills]);

  const totalSelected = selectedIds.size;

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (totalSelected === 0 && !isEdit) return;
    setSaving(true);

    try {
      // If editing, delete all existing drills for this date first
      if (isEdit) {
        for (const ev of existingEvents) {
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

        // Group by tab, then order by each tab's dropdown order (uses dbCategory for the saved record)
        for (const tab of TABS) {
          let timeSlot = 9 * 60;
          const tabSelected = allDrills.filter(d => d.tab === tab.key && selectedIds.has(d.id));
          const dropdowns = MODAL_DROPDOWNS[tab.key] || [];
          const added = new Set<string>(); // avoid duplicates when multiple dropdowns share a dbCategory

          for (const dd of dropdowns) {
            const ddDrills = tabSelected.filter(d => d.category === dd.dbCategory && !added.has(d.id));
            for (const d of ddDrills) {
              items.push({ playerId, drillId: d.id, tab: d.tab, category: d.category, name: d.name, date, time: makeTime(timeSlot), duration: 15 });
              added.add(d.id);
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
              selected={selectedIds}
              onToggle={toggleId}
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
