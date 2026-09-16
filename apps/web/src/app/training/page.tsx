'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Drill, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import nextDynamic from 'next/dynamic';
/* Code-split: ScheduleDownloadModal drags the whole @react-pdf/renderer
   engine with it (~the majority of this route's old 625kB First Load).
   Its render site is already mount-gated behind the Download button, so a
   dynamic import means the PDF machinery only downloads when a coach
   actually opens the download dialog. */
const ScheduleDownloadModal = nextDynamic(
  () => import('./ScheduleDownloadModal').then(m => m.ScheduleDownloadModal),
  { ssr: false },
);
import { TemplatePicker, SaveTemplateModal } from '@/components/TemplatePicker';
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
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveDrillWithinSection, moveSection } from '@/lib/scheduleReorder';

/* Grip glyph for the coach drag handles (matches the Program board). */
const CalGrip = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" />
    <circle cx="5.5" cy="8" r="1.4" /><circle cx="10.5" cy="8" r="1.4" />
    <circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
  </svg>
);

/* Type-scoped collision (same fix proven on the Program board): while
   dragging a drill, only match other drills (fall back to sections only for
   empty-section drops); while dragging a section, only match sections. Stops
   the big section card from stealing the drop and snapping drills to an edge. */
const calReorderCollision: CollisionDetection = (args) => {
  const t = args.active.data.current?.type;
  const byType = (...types: string[]) =>
    args.droppableContainers.filter((d) => types.includes(d.data.current?.type as string));
  if (t === 'section') {
    return closestCenter({ ...args, droppableContainers: byType('section') });
  }
  const drillHits = closestCenter({ ...args, droppableContainers: byType('drill') });
  if (drillHits.length > 0) return drillHits;
  return closestCenter({ ...args, droppableContainers: byType('section') });
};

/* One draggable SECTION card. Renders the card chrome + a grip; the caller
   supplies the header/list markup via children-as-function so the focused and
   multi-column views can keep their own classes. Drag disabled for players. */
function CalSortableSection({
  id, tab, category, disabled, cardClass, bgStyle, children,
}: {
  id: string;
  tab: string;
  category: string;
  disabled: boolean;
  cardClass: string;
  bgStyle: React.CSSProperties;
  children: (grip: React.ReactNode) => React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, data: { type: 'section', tab, category }, disabled });
  const grip = disabled ? null : (
    <button
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      className={styles.calSecHandle}
      onClick={(e) => e.stopPropagation()}
      title="Drag to reorder this section"
      aria-label="Drag to reorder this section"
      style={{ touchAction: 'none', cursor: 'grab' }}
    >
      <CalGrip />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={cardClass}
      style={{
        ...bgStyle,
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : undefined,
        zIndex: isDragging ? 6 : undefined,
      }}
    >
      {children(grip)}
    </div>
  );
}

/* One draggable DRILL row (grip + name + delete). Tap still opens the drill
   video. Drag disabled for players. */
function CalSortableDrill({
  id, tab, category, disabled, rowClass, nameClass, name, onRowClick, onDelete, isCoach,
}: {
  id: string;
  tab: string;
  category: string;
  disabled: boolean;
  rowClass: string;
  nameClass: string;
  name: string;
  onRowClick?: () => void;
  onDelete: () => void;
  isCoach: boolean;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, data: { type: 'drill', tab, category }, disabled });
  return (
    <div
      ref={setNodeRef}
      className={rowClass}
      onClick={onRowClick}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : undefined,
        zIndex: isDragging ? 6 : undefined,
      }}
    >
      {isCoach && (
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          className={styles.calRowHandle}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          style={{ touchAction: 'none', cursor: 'grab' }}
        >
          <CalGrip size={12} />
        </button>
      )}
      <span className={nameClass}>{name}</span>
      {isCoach && (
        <button
          className={styles.dayEventDelete}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >×</button>
      )}
    </div>
  );
}

/* A drill the coach has ticked but not yet saved.
   Rendered like a saved row so a section reads as one continuous list, but
   with no drag grip — there is no persisted row to reorder yet — and a
   marker so it is obvious what Save is going to add. Clicking still opens
   the demo video, which is the whole point of listing these here rather
   than as chips inside the picker. */
function CalPendingDrill({
  rowClass, nameClass, name, onRowClick, onRemove, isCoach,
}: {
  rowClass: string;
  nameClass: string;
  name: string;
  onRowClick?: () => void;
  onRemove: () => void;
  isCoach: boolean;
}) {
  return (
    <div
      className={`${rowClass} ${styles.calPendingRow}`}
      onClick={onRowClick}
      title={onRowClick ? 'Watch demo (unsaved — press Save to publish)' : 'Unsaved — press Save to publish'}
    >
      <span className={styles.calPendingDot} aria-hidden="true" />
      <span className={nameClass}>{name}</span>
      {isCoach && (
        <button
          className={styles.dayEventDelete}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove"
        >×</button>
      )}
    </div>
  );
}

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

/* ── Inline day editor: scheduled drills ⇄ dropdown selections ──
   The coach Day view edits a day in place, so it needs to map BOTH ways
   between what is on the calendar and what is ticked in each dropdown.
   Shared with DrillDashboardModal so the two surfaces cannot drift on
   how a saved row maps back to the section that produced it. */

/** The dropdown section a scheduled drill belongs to, or undefined. */
function ddForEvent(ev: { tab: string; category: string }): ModalDropdown | undefined {
  const dds = MODAL_DROPDOWNS[ev.tab] || [];
  /* New rows save the SECTION label as `category` (e.g. 'Tee'); rows
     written before the sections split saved the shared library category
     (e.g. 'Drills'), so fall back to the first section drawing from it. */
  return dds.find(d => d.label === ev.category) || dds.find(d => d.dbCategory === ev.category);
}

/**
 * Selections-by-section for a day, derived from what is already scheduled.
 *
 * Only library-linked rows can round-trip: a hand-entered one-off has no
 * drillId, so no dropdown can represent it. Those are deliberately absent
 * here and the save diff never touches them — they keep showing in the
 * cards below the dropdowns.
 */
function buildDraftFromEvents(events: ScheduledDrill[]): Record<string, Set<string>> {
  const init: Record<string, Set<string>> = {};
  for (const ev of events) {
    if (!ev.drillId) continue;
    const dd = ddForEvent(ev);
    if (!dd) continue;
    (init[dd.key] ||= new Set<string>()).add(ev.drillId);
  }
  return init;
}

/**
 * Which library drills each dropdown section of a tab can offer.
 *
 * Movement Prep is a SHARED warm-up library across every sport: each tab's
 * Movement Prep picker shows ALL Movement Prep drills (deduped by name)
 * whichever tab they were created under, so a warm-up built under Hitting is
 * also selectable for Pitching / Infield / Outfield / Catching — videos
 * included, no duplicated rows. Every other category stays tab-specific.
 */
function drillsForTabDropdowns(allDrills: Drill[], tabKey: string): Record<string, Drill[]> {
  const dds = MODAL_DROPDOWNS[tabKey] || [];
  const tabDrills = allDrills.filter(d => d.tab === tabKey);
  const map: Record<string, Drill[]> = {};
  for (const dd of dds) {
    if (dd.dbCategory === 'Movement Prep') {
      const seen = new Set<string>();
      map[dd.key] = allDrills.filter(d => {
        if (d.category !== 'Movement Prep') return false;
        const key = d.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      map[dd.key] = tabDrills.filter(d => d.category === dd.dbCategory);
    }
  }
  return map;
}

/* ── Pending (unsaved) selections ──
   A drill the coach has ticked but not yet saved is rendered in the section
   list underneath the pickers, exactly like a saved one, so the column
   always reads as the plan. It is carried as a ScheduledDrill with a
   synthetic id rather than a separate type, so the existing grouping,
   ordering and rendering all work on it unchanged. */
const PENDING_PREFIX = 'pending:';

function isPendingRow(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/** `pending:<ddKey>:<drillId>` — neither part can contain a colon. */
function parsePendingId(id: string): { ddKey: string; drillId: string } | null {
  const rest = id.slice(PENDING_PREFIX.length);
  const cut = rest.indexOf(':');
  if (cut === -1) return null;
  return { ddKey: rest.slice(0, cut), drillId: rest.slice(cut + 1) };
}

/** Do two selection maps hold the same drills? Drives the dirty flag. */
function sameDraft(a: Record<string, Set<string>>, b: Record<string, Set<string>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const sa = a[k] || EMPTY_SET;
    const sb = b[k] || EMPTY_SET;
    if (sa.size !== sb.size) return false;
    for (const id of sa) if (!sb.has(id)) return false;
  }
  return true;
}

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

  /* ── Schedule templates ──
     Save: name prompt → snapshot persists facility-wide. Apply: picker modal
     → recreate the template's drills on the CURRENT day for the selected
     player via the existing batch endpoint (order/sectionOrder carried so
     the applied day matches the template's curated layout). */
  const [showTemplates, setShowTemplates] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  /* "Save as template" opens the styled name modal (SaveTemplateModal); the
     modal owns the input + inline "✓ Saved" confirmation, this page owns the
     API write. Replaces the v1 window.prompt/alert flow. */
  const [saveTpl, setSaveTpl] = useState<{ tabKey: string; label: string; items: api.ScheduleTemplateItem[] } | null>(null);
  const handleSaveTemplate = useCallback((tabKey: string, items: api.ScheduleTemplateItem[]) => {
    if (items.length === 0) return;
    const label = TABS.find(t => t.key === tabKey)?.label ?? tabKey;
    setSaveTpl({ tabKey, label, items });
  }, []);
  const handleApplyTemplate = useCallback(async (t: api.ScheduleTemplate, items: api.ScheduleTemplateItem[]) => {
    if (!selectedPlayerId || items.length === 0) return;
    // Computed inline (not the later-declared todayDateStr const) so this
    // callback's dep array never touches a binding above its declaration.
    const dateStr = toDateStr(currentDate);
    setApplyingTemplate(true);
    try {
      await api.createScheduledDrillsBatch(items.map(it => ({
        playerId: selectedPlayerId,
        drillId: it.drillId ?? undefined,
        tab: t.tab,
        category: it.category,
        name: it.name,
        date: dateStr,
        time: it.time,
        duration: it.duration,
        notes: it.notes ?? undefined,
        order: it.order,
        sectionOrder: it.sectionOrder,
      })));
      refreshEvents();
      setShowTemplates(false);
    } catch (e) {
      console.error('Apply template failed', e);
      window.alert('Failed to apply template');
    } finally {
      setApplyingTemplate(false);
    }
  }, [selectedPlayerId, currentDate, refreshEvents]);

  /* Coach drag-reorder: optimistically merge the updated rows into `events`
     (board reflects the new order instantly), then persist the position
     payload; resync from the server on failure. */
  const applyReorder = useCallback(async (
    updatedRows: ScheduledDrill[],
    payload: { id: string; order?: number; sectionOrder?: number }[],
  ) => {
    const map = new Map(updatedRows.map(r => [r.id, r]));
    setEvents(prev => prev.map(e => map.get(e.id) ?? e));
    try { await api.reorderScheduledDrills(payload); }
    catch (err) { console.error('Calendar reorder failed', err); refreshEvents(); }
  }, [refreshEvents]);

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

  const todayDateStr = toDateStr(currentDate);

  /* ══ Inline day editor (coach) ══════════════════════════════════
     The Day view edits the selected day in place: every position column
     carries its own category dropdowns, and nothing reaches the athlete
     until Save. The draft lives HERE rather than in DayView because the
     Save button sits up in the calendar controls beside Today.
     ═══════════════════════════════════════════════════════════════ */

  /* The drill library, loaded once for the whole page. The modal used to
     own this fetch; the inline editor needs the same list, so it moved up
     rather than both surfaces fetching it separately. */
  const [allDrills, setAllDrills] = useState<Drill[]>([]);
  useEffect(() => {
    /* Coaches only — the library feeds the in-column pickers and an athlete
       has nothing to pick with, so this avoids pulling the whole drill list
       onto a player's phone on every visit. */
    if (!isCoach) return;
    api.getDrills().then(setAllDrills).catch(() => setAllDrills([]));
  }, [isCoach]);

  /* What the day currently looks like ON THE SERVER — the baseline the
     draft is compared against to decide if there is anything to save. */
  const persistedDraft = useMemo(
    () => buildDraftFromEvents(allEventsByDate[todayDateStr] || []),
    [allEventsByDate, todayDateStr],
  );

  const [draftSel, setDraftSel] = useState<Record<string, Set<string>>>(persistedDraft);
  const [savingDay, setSavingDay] = useState(false);

  /* Re-baseline whenever the persisted day changes — switching athlete,
     moving to another date, or a refetch after save. Any unsaved edits are
     dropped at that point BY DESIGN: they belonged to the day being left.
     The nav guard below is what stops that happening silently. */
  useEffect(() => { setDraftSel(persistedDraft); }, [persistedDraft]);

  const dayDirty = useMemo(
    () => !sameDraft(draftSel, persistedDraft),
    [draftSel, persistedDraft],
  );

  const toggleDraftDd = useCallback((ddKey: string, drillId: string) => {
    setDraftSel(prev => {
      const set = new Set(prev[ddKey] || []);
      if (set.has(drillId)) set.delete(drillId);
      else set.add(drillId);
      return { ...prev, [ddKey]: set };
    });
  }, []);

  /**
   * Persist the day.
   *
   * Diff-based on purpose. The modal's save deletes every library-linked
   * row and recreates it, which throws away the coach's drag-reorder
   * (`order` / `sectionOrder` reset to 0) and churns row ids on every
   * save. Here an untouched drill is left completely alone: only removed
   * drills are deleted and only added ones are created.
   *
   * Hand-entered one-offs (drillId == null) are never in the diff, so they
   * survive a save untouched.
   */
  const handleSaveDay = useCallback(async () => {
    if (!selectedPlayerId || !dayDirty) return;
    setSavingDay(true);
    try {
      const existing = allEventsByDate[todayDateStr] || [];
      const toDelete: string[] = [];
      const toAdd: Parameters<typeof api.createScheduledDrillsBatch>[0] = [];

      for (const tab of TABS) {
        const dds = MODAL_DROPDOWNS[tab.key] || [];
        const tabEvents = existing.filter(ev => ev.tab === tab.key);

        /* New drills queue up after the last one already on the day, so a
           save never collides two drills onto the same time slot. */
        let slot = tabEvents.length
          ? Math.max(...tabEvents.map(ev => parseTime(ev.time))) + 15
          : 9 * 60;

        dds.forEach((dd, ddIndex) => {
          const sel = draftSel[dd.key] || EMPTY_SET;
          const mine = tabEvents.filter(ev => ev.drillId && ddForEvent(ev)?.key === dd.key);

          for (const ev of mine) {
            if (!sel.has(ev.drillId!)) toDelete.push(ev.id);
          }

          const alreadyThere = new Set(mine.map(ev => ev.drillId!));
          const added = [...sel].filter(id => !alreadyThere.has(id));
          if (added.length === 0) return;

          /* Slot new drills into the section where it already exists so they
             land beside their siblings; a brand-new section takes its
             canonical position in the taxonomy. */
          const sectionOrder = mine.length ? mine[0].sectionOrder : ddIndex;
          const baseOrder = mine.length ? Math.max(...mine.map(ev => ev.order)) + 1 : 0;

          added.forEach((drillId, i) => {
            const drill = allDrills.find(d => d.id === drillId);
            if (!drill) return;
            const h = Math.floor(slot / 60), m = slot % 60;
            toAdd.push({
              playerId: selectedPlayerId,
              drillId: drill.id,
              tab: tab.key,
              /* The SECTION label, not the shared library category, so the
                 row round-trips back into this same dropdown on reload. */
              category: dd.label,
              name: drill.name,
              date: todayDateStr,
              time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
              duration: 15,
              order: baseOrder + i,
              sectionOrder,
            });
            slot += 15;
          });
        });
      }

      for (const id of toDelete) await api.deleteScheduledDrill(id);
      if (toAdd.length) await api.createScheduledDrillsBatch(toAdd);

      refreshEvents();
    } catch (err) {
      console.error('Failed to save day:', err);
      /* Pull the truth back so the UI never shows a draft it failed to
         persist as though it had saved. */
      refreshEvents();
    } finally {
      setSavingDay(false);
    }
  }, [selectedPlayerId, dayDirty, allEventsByDate, todayDateStr, draftSel, allDrills, refreshEvents]);

  /* Unsaved edits die when the day or athlete changes, so warn on the way
     out of the page entirely. */
  useEffect(() => {
    if (!dayDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dayDirty]);

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
                  {/* Save replaces the old Edit button: the day is edited
                      inline in the columns below, and nothing reaches the
                      athlete until this is pressed. */}
                  <button
                    className={dayDirty ? styles.dayActionBtnAccent : styles.dayActionBtn}
                    onClick={handleSaveDay}
                    disabled={savingDay || !dayDirty}
                    title={dayDirty
                      ? 'Save this day — athletes see the changes once saved'
                      : 'No unsaved changes'}
                  >
                    {savingDay ? 'Saving…' : dayDirty ? 'Save' : 'Saved'}
                  </button>
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
          onCopy={() => handleCopyDay(todayDateStr)}
          onCopyTab={(tabKey) => handleCopyTab(todayDateStr, tabKey)}
          onPaste={() => handlePasteDay(todayDateStr)}
          hasCopied={copiedDrills.length > 0}
          copiedFromDate={copiedDate}
          onDrillClick={(drill) => setViewingDrill(drill)}
          visibleTabs={visibleTabs}
          onReorder={applyReorder}
          onSaveTemplate={handleSaveTemplate}
          onOpenTemplates={() => setShowTemplates(true)}
          allDrills={allDrills}
          draftSel={draftSel}
          onToggleDd={toggleDraftDd}
        />
      )}

      {/* ── Apply-Template picker — applies to the selected player + the
          day currently shown in Day view. Lists every sport's templates
          (the coach may be filling multiple areas of the same day). */}
      <TemplatePicker
        open={showTemplates}
        title={`Apply to ${selectedPlayer ? `${selectedPlayer.firstName} ${selectedPlayer.lastName}` : 'selected player'} — ${todayDateStr}`}
        onClose={() => setShowTemplates(false)}
        onApply={handleApplyTemplate}
        applying={applyingTemplate}
      />

      {/* Styled name-and-confirm modal for "Save as template". */}
      <SaveTemplateModal
        open={!!saveTpl}
        sportLabel={saveTpl?.label ?? ''}
        itemCount={saveTpl?.items.length ?? 0}
        sectionCount={saveTpl ? new Set(saveTpl.items.map(i => i.category)).size : 0}
        onClose={() => setSaveTpl(null)}
        onSave={async (nm) => {
          if (!saveTpl) return;
          await api.createScheduleTemplate({ name: nm, tab: saveTpl.tabKey, items: saveTpl.items });
        }}
      />

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
  onCopy,
  onCopyTab,
  onPaste,
  hasCopied,
  copiedFromDate,
  onDrillClick,
  visibleTabs,
  onReorder,
  onSaveTemplate,
  onOpenTemplates,
  allDrills,
  draftSel,
  onToggleDd,
}: {
  currentDate: Date;
  allDayEvents: ScheduledDrill[];
  isCoach: boolean;
  onDelete: (id: string) => void;
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
  /** Coach drag-reorder: optimistically apply updated rows, then persist. */
  onReorder: (updatedRows: ScheduledDrill[], payload: { id: string; order?: number; sectionOrder?: number }[]) => void;
  /** Save one sport's day plan as a named reusable template. */
  onSaveTemplate: (tabKey: string, items: api.ScheduleTemplateItem[]) => void;
  /** Open the Apply-Template picker for this day. */
  onOpenTemplates: () => void;
  /** Drill library, for the in-column category dropdowns. */
  allDrills: Drill[];
  /** Coach's unsaved selections, keyed by dropdown section. */
  draftSel: Record<string, Set<string>>;
  /** Tick / untick one drill in one section. */
  onToggleDd: (ddKey: string, drillId: string) => void;
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

  /* What each column actually RENDERS: saved drills plus the coach's
     unsaved ticks, minus the ones they have unticked. Without this a
     selection would stay invisible until Save, which reads as the picker
     being broken.

     Players are unaffected — they have no draft, so they see the saved day
     exactly as before. */
  const displayByTab = useMemo(() => {
    if (!isCoach) return eventsByTab;
    const out: Record<string, ScheduledDrill[]> = {};
    for (const t of TABS) {
      const evs = eventsByTab[t.key] || [];
      const rows: ScheduledDrill[] = [];
      const handled = new Set<string>();

      (MODAL_DROPDOWNS[t.key] || []).forEach((dd, ddIndex) => {
        const sel = draftSel[dd.key] || EMPTY_SET;
        const mine = evs.filter((ev) => ev.drillId && ddForEvent(ev)?.key === dd.key);
        const savedDrillIds = new Set(mine.map((ev) => ev.drillId!));

        for (const ev of mine) {
          handled.add(ev.id);
          /* Unticked but still on the server → hidden now, deleted on Save. */
          if (sel.has(ev.drillId!)) rows.push(ev);
        }

        /* Pending additions inherit the section's position so they appear
           beside their siblings instead of jumping when saved. */
        const sectionOrder = mine.length ? mine[0].sectionOrder : ddIndex;
        let nextOrder = mine.length ? Math.max(...mine.map((ev) => ev.order)) + 1 : 0;
        for (const drillId of sel) {
          if (savedDrillIds.has(drillId)) continue;
          const drill = allDrills.find((d) => d.id === drillId);
          if (!drill) continue;
          rows.push({
            id: `${PENDING_PREFIX}${dd.key}:${drill.id}`,
            playerId: '', drillId: drill.id, drill,
            tab: t.key, category: dd.label, name: drill.name,
            date: '', time: '', duration: 15, notes: null,
            order: nextOrder++, sectionOrder, createdAt: '',
          });
        }
      });

      /* Hand-entered one-offs and rows on retired categories map to no
         dropdown. Keep them visible rather than silently dropping them. */
      for (const ev of evs) if (!handled.has(ev.id)) rows.push(ev);
      out[t.key] = rows;
    }
    return out;
  }, [isCoach, eventsByTab, draftSel, allDrills]);

  /* Removing a drill goes through the DRAFT wherever it can, so the × and
     the picker always agree and nothing reaches the athlete before Save.

     This matters beyond tidiness: deleting straight from the server would
     trigger a refetch, and the refetch re-baselines the draft — silently
     throwing away every other unsaved edit the coach had made. Only rows no
     dropdown can represent (hand-entered one-offs, retired categories) go
     directly, because there is no draft entry to untick. */
  const removeRow = (ev: ScheduledDrill) => {
    if (isPendingRow(ev.id)) {
      const parsed = parsePendingId(ev.id);
      if (parsed) onToggleDd(parsed.ddKey, parsed.drillId);
      return;
    }
    const dd = ev.drillId ? ddForEvent(ev) : undefined;
    if (dd && ev.drillId) {
      onToggleDd(dd.key, ev.drillId);
      return;
    }
    onDelete(ev.id);
  };

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
    // Drill order within a section: coach `order`, then time (all-0 = time).
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.order - b.order || parseTime(a.time) - parseTime(b.time));
    }
    // Section order: coach `sectionOrder` first (shared by a section's drills),
    // then the canonical Movement Prep→…→Live order as the tiebreak — so an
    // un-reordered day (all 0) reads exactly as it did before.
    return Array.from(buckets.entries()).sort(([a, aItems], [b, bItems]) => {
      const aso = aItems[0]?.sectionOrder ?? 0;
      const bso = bItems[0]?.sectionOrder ?? 0;
      if (aso !== bso) return aso - bso;
      const ai = canonical.indexOf(a);
      const bi = canonical.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  };

  /* Snapshot one sport's day into template items — section/drill order
     comes from the SAME groupByCategory ordering the coach sees on screen
     (honouring any drag-reorder), so an applied template reproduces the
     day exactly. */
  const buildTemplateItems = (tabKey: string): api.ScheduleTemplateItem[] =>
    groupByCategory(eventsByTab[tabKey] || [], tabKey).flatMap(([category, evs], gi) =>
      evs.map((ev, i) => ({
        drillId: ev.drillId,
        category,
        name: ev.name,
        time: ev.time,
        duration: ev.duration,
        notes: ev.notes,
        order: i,
        sectionOrder: gi,
      })),
    );

  // When entering focus mode, look up the tab's metadata once.
  const focusedTabMeta = focusedTab ? visibleTabs.find((t) => t.key === focusedTab) ?? null : null;
  const focusedEvents = focusedTab ? (displayByTab[focusedTab] || []) : [];
  const focusedColor = focusedTab ? (TAB_COLORS[focusedTab] || TAB_COLORS.hitting) : null;

  /* Athletes only see areas that actually have a drill — an empty category
   * renders no column for them.
   *
   * Coaches get a column for EVERY area the athlete's profile qualifies for,
   * empty or not, because the column is now the editing surface: an empty
   * Outfield column is where you go to add the athlete's first outfield
   * drill. visibleTabsForPlayer() is what decides that list, so a C/INF gets
   * Catching + Infield and a pitcher-only athlete never sees Hitting. */
  const populatedTabs = visibleTabs.filter((t) => (displayByTab[t.key] || []).length > 0);
  const columnTabs = isCoach ? visibleTabs : populatedTabs;

  /* Section → selectable drills, for every tab at once. Memoised on the
     library alone so opening a dropdown does not recompute the others. */
  const drillsByTabDd = useMemo(() => {
    const out: Record<string, Record<string, Drill[]>> = {};
    for (const t of TABS) out[t.key] = drillsForTabDropdowns(allDrills, t.key);
    return out;
  }, [allDrills]);

  /* ── Coach drag-to-reorder (dnd-kit) — same engine as the Program board.
     Reorder is constrained to within a single sport/tab: drills move within
     their section, sections move within their tab. No cross-tab moves. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragLabel, setDragLabel] = useState<{ type: 'drill' | 'section'; label: string } | null>(null);

  const handleDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type?: string; tab?: string; category?: string } | undefined;
    if (d?.type === 'drill') {
      const name = (eventsByTab[d.tab || ''] || []).find((x) => x.id === e.active.id)?.name || 'Drill';
      setDragLabel({ type: 'drill', label: name });
    } else if (d?.type === 'section') {
      setDragLabel({ type: 'section', label: d.category || 'Section' });
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const { active, over } = e;
    if (!over) return;
    const a = active.data.current as { type?: string; tab?: string; category?: string } | undefined;
    const o = over.data.current as { type?: string; tab?: string; category?: string } | undefined;
    if (!a?.type || !a.tab || !o?.tab || o.tab !== a.tab) return; // same sport only

    if (a.type === 'section') {
      if (!o.category || o.category === a.category) return;
      const { rows, payload } = moveSection(eventsByTab[a.tab] || [], a.category!, o.category);
      if (payload.length) onReorder(rows, payload);
      return;
    }
    // drill — reorder within its own section only
    if (o.category !== a.category || active.id === over.id) return;
    const overDrillId = o.type === 'drill' ? String(over.id) : null;
    const { rows, payload } = moveDrillWithinSection(eventsByTab[a.tab] || [], a.category!, String(active.id), overDrillId);
    if (payload.length) onReorder(rows, payload);
  };

  return (
    <div className={styles.dayView}>
      <DndContext
        sensors={sensors}
        collisionDetection={calReorderCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragLabel(null)}
      >
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
          {/* Apply a saved template to this day (coach). Works in both the
              multi-column and focused views — the picker lists every sport's
              templates and the apply targets the selected player + this day. */}
          {isCoach && (
            <button
              className={styles.dayActionBtn}
              onClick={onOpenTemplates}
              title="Apply a saved schedule template to this day"
            >
              Templates
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
          {/* Save the focused sport's day as a named reusable template. */}
          {isCoach && focusedTabMeta && focusedEvents.length > 0 && (
            <button
              className={styles.dayActionBtn}
              onClick={() => onSaveTemplate(focusedTabMeta.key, buildTemplateItems(focusedTabMeta.key))}
              title={`Save this ${focusedTabMeta.label} day as a reusable template`}
            >
              Save as template
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
              <SortableContext
                items={groupByCategory(focusedEvents, focusedTabMeta.key).map(([c]) => `sec:${focusedTabMeta.key}:${c}`)}
                strategy={verticalListSortingStrategy}
              >
              {groupByCategory(focusedEvents, focusedTabMeta.key).map(([category, items]) => {
                const catStyle = getTabCatStyle(focusedTabMeta.key, category);
                return (
                  <CalSortableSection
                    key={category}
                    id={`sec:${focusedTabMeta.key}:${category}`}
                    tab={focusedTabMeta.key}
                    category={category}
                    disabled={!isCoach}
                    cardClass={styles.dayFocusCard}
                    bgStyle={catStyle.bgStyle}
                  >
                    {(grip) => (
                      <>
                        <div className={styles.dayFocusCardTop}>
                          {grip}
                          <span className={styles.dayColCardCat} style={catStyle.textStyle}>
                            {category}
                          </span>
                          <span className={styles.dayFocusBubbleCount} style={catStyle.textStyle}>
                            {items.length}
                          </span>
                        </div>
                        <div className={styles.dayFocusCardList}>
                          {/* Only persisted rows are sortable — a pending
                              selection has no row to reorder yet. */}
                          <SortableContext
                            items={items.filter((ev) => !isPendingRow(ev.id)).map((ev) => ev.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {items.map((ev) => isPendingRow(ev.id) ? (
                              <CalPendingDrill
                                key={ev.id}
                                rowClass={`${styles.dayFocusCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                                nameClass={styles.dayFocusCardItemName}
                                name={ev.name}
                                onRowClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                                onRemove={() => removeRow(ev)}
                                isCoach={isCoach}
                              />
                            ) : (
                              <CalSortableDrill
                                key={ev.id}
                                id={ev.id}
                                tab={focusedTabMeta.key}
                                category={category}
                                disabled={!isCoach}
                                rowClass={`${styles.dayFocusCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                                nameClass={styles.dayFocusCardItemName}
                                name={ev.name}
                                onRowClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                                onDelete={() => removeRow(ev)}
                                isCoach={isCoach}
                              />
                            ))}
                          </SortableContext>
                        </div>
                      </>
                    )}
                  </CalSortableSection>
                );
              })}
              </SortableContext>
            )}
          </div>
        </div>
      ) : columnTabs.length === 0 ? (
        /* Nothing to show: no drills scheduled (athlete), or the athlete has
           no positions on file at all (coach). */
        <div className={styles.dayFocusEmpty} style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
          No workouts scheduled for this day.
        </div>
      ) : (
        /* ── Multi-column grid — one column per position area ── */
        /* Column count travels as a custom property, NOT as an inline
           grid-template-columns. An inline declaration outranks every
           media query, which silently killed the responsive rules for
           this grid — on a phone a six-position athlete rendered six
           60px columns. The stylesheet now owns the layout at each
           breakpoint and only reads the count from here. */
        <div
          className={styles.dayGrid}
          style={{ ['--day-cols' as string]: columnTabs.length } as React.CSSProperties}
        >
          {columnTabs.map(tab => {
            const tabEvents = displayByTab[tab.key] || [];
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
                  {/* Save this sport's day as a named reusable template —
                      sits beside Copy with the same chip treatment. Only
                      shown when there ARE drills to snapshot. */}
                  {isCoach && tabEvents.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSaveTemplate(tab.key, buildTemplateItems(tab.key));
                      }}
                      title={`Save this ${tab.label} day as a reusable template`}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${tabColor.text}`,
                        color: tabColor.text,
                        padding: '2px 8px',
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        marginLeft: 6,
                        flexShrink: 0,
                      }}
                    >
                      Save
                    </button>
                  )}
                </div>
                <div className={styles.dayColBody}>
                  {/* ── In-column editor ──
                      One multi-select per drill category for this area
                      (Hitting → Movement Prep / Vision / Tee / Flips / …).
                      Ticking a drill only changes the local draft; the Save
                      button up in the calendar controls is what publishes the
                      day to the athlete. */}
                  {isCoach && (
                    <div className={styles.dayColPickers}>
                      {(MODAL_DROPDOWNS[tab.key] || []).map(dd => (
                        <MultiSelectDropdown
                          key={dd.key}
                          label={dd.label}
                          drills={drillsByTabDd[tab.key]?.[dd.key] || []}
                          selected={draftSel[dd.key] || EMPTY_SET}
                          onToggle={(id) => onToggleDd(dd.key, id)}
                          color={dd.color}
                          compact
                        />
                      ))}
                    </div>
                  )}
                  {tabEvents.length === 0 && !isCoach && (
                    <div className={styles.dayColEmpty}>—</div>
                  )}
                  {/* Group this tab's drills into one bubble per category
                      (Movement Prep / Drills / Bullpen / Live / ...). Drill
                      names list inside the bubble; click any name to open
                      the per-drill modal, × to delete that one entry. */}
                  <SortableContext
                    items={groupByCategory(tabEvents, tab.key).map(([c]) => `sec:${tab.key}:${c}`)}
                    strategy={verticalListSortingStrategy}
                  >
                  {groupByCategory(tabEvents, tab.key).map(([category, items]) => {
                    const catStyle = getTabCatStyle(tab.key, category);
                    return (
                      <CalSortableSection
                        key={category}
                        id={`sec:${tab.key}:${category}`}
                        tab={tab.key}
                        category={category}
                        disabled={!isCoach}
                        cardClass={styles.dayColCard}
                        bgStyle={catStyle.bgStyle}
                      >
                        {(grip) => (
                          <>
                            <div className={styles.dayColCardTop}>
                              {grip}
                              <span className={styles.dayColCardCat} style={catStyle.textStyle}>{category}</span>
                            </div>
                            <div className={styles.dayColCardList}>
                              <SortableContext
                                items={items.filter((ev) => !isPendingRow(ev.id)).map((ev) => ev.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                {items.map((ev) => isPendingRow(ev.id) ? (
                                  <CalPendingDrill
                                    key={ev.id}
                                    rowClass={`${styles.dayColCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                                    nameClass={styles.dayColCardItemName}
                                    name={ev.name}
                                    onRowClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                                    onRemove={() => removeRow(ev)}
                                    isCoach={isCoach}
                                  />
                                ) : (
                                  <CalSortableDrill
                                    key={ev.id}
                                    id={ev.id}
                                    tab={tab.key}
                                    category={category}
                                    disabled={!isCoach}
                                    rowClass={`${styles.dayColCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                                    nameClass={styles.dayColCardItemName}
                                    name={ev.name}
                                    onRowClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                                    onDelete={() => removeRow(ev)}
                                    isCoach={isCoach}
                                  />
                                ))}
                              </SortableContext>
                            </div>
                          </>
                        )}
                      </CalSortableSection>
                    );
                  })}
                  </SortableContext>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DragOverlay>
        {dragLabel ? (
          <div className={dragLabel.type === 'section' ? styles.calGhostSection : styles.calGhostDrill}>
            {dragLabel.label}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
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
  compact = false,
}: {
  label: string;
  drills: Drill[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  color: string;
  /** Tighter geometry for the Day view's in-column pickers, where six or
   *  seven of these stack inside one narrow position column. Colour and
   *  behaviour are identical to the modal's — only the sizing changes. */
  compact?: boolean;
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
    <div className={compact ? styles.dayColField : styles.field}>
      <label className={compact ? styles.dayColFieldLabel : styles.fieldLabel}>{label}</label>
      <div className={styles.multiWrap} ref={wrapRef}>
        <div
          role="button"
          tabIndex={0}
          className={`${styles.multiTrigger} ${compact ? styles.multiTriggerCompact : ''}`}
          style={{ borderColor: color }}
          onClick={() => setOpen(!open)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        >
          {/* Selected drills render as chips INSIDE the trigger bubble; the
              "N Selected" badge sits at the far right. */}
          <div className={styles.multiTriggerChips}>
            {/* Compact (Day view) deliberately shows NO chips: the selected
                drills get their own section beneath the picker, where they
                are clickable to watch the demo video. Repeating them inside
                the trigger only made the column noisy. */}
            {compact || selectedDrills.length === 0 ? (
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
  const [selectedByDd, setSelectedByDd] = useState<Record<string, Set<string>>>(
    () => buildDraftFromEvents(existingEvents),
  );

  // Load ALL drills from library once
  const [allDrills, setAllDrills] = useState<Drill[]>([]);
  useEffect(() => {
    api.getDrills().then(setAllDrills).catch(() => setAllDrills([]));
  }, []);

  // Drills for current modal tab, split by dropdown dbCategory
  const tabDrills = useMemo(() => allDrills.filter(d => d.tab === modalTab), [allDrills, modalTab]);
  const modalCategories = MODAL_DROPDOWNS[modalTab] || [];
  /* Shared with the Day view's in-column pickers — see the helper. */
  const drillsByDropdown = useMemo(
    () => drillsForTabDropdowns(allDrills, modalTab),
    [allDrills, modalTab],
  );

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
