'use client';

import { useEffect, useId, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Drill, ScheduledDrill } from '@/lib/api';
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
import { SaveTemplateModal, TemplatePreviewModal } from '@/components/TemplatePicker';
import { ApplyCalendarModal } from './ApplyCalendarModal';
import { ClearScheduleMenu } from './ClearScheduleMenu';
import { CheckInFlow } from './CheckInFlow';
import styles from './page.module.css';
/* Coach Dashboard theme: canvas, banner and bubble surfaces. */
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconAttendance, IconBall } from '../education/EduHeader';
/* Tab + category color system lives in a shared module so the Player
   Summary's Upcoming Drills panel renders the same color treatment as
   the Training day-column cards do here — single source of truth. */
import {
  TAB_LABELS, TAB_COLORS, TAB_MODULAR_DARK,
  LEGEND_CATEGORIES, getTabCatStyle,
} from '@/lib/training-colors';
import { DRILL_LIBRARY, DRILL_TAXONOMY, libraryCategoryFor } from '@/lib/drill-taxonomy.generated';
import { drillOptionFields, drillOptionColumns, optionsFor, useDrillOptionLists } from '@/lib/drill-options';
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
import { moveDrillWithinSection, moveSection, shiftBlocksPast } from '@/lib/scheduleReorder';

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
   The full tab catalog. Which areas the calendar offers is per-athlete
   (see `visibleTabsForPlayer` below):
     • hitting     — any field position (C, 1B-3B, SS, LF/CF/RF, OF, INF, UTIL)
     • pitching    — P
     • catching / infield / outfield / strength (Physical) — off until a
       coach switches them on with the Areas button (Player.calendarTabs)
   Cognition / vision was retired — no longer surfaced in Training. */
const TABS = [
  { key: 'hitting',  label: 'Hitting' },
  { key: 'pitching', label: 'Pitching' },
  { key: 'catching', label: 'Catching' },
  { key: 'infield',  label: 'Infield' },
  { key: 'outfield', label: 'Outfield' },
  { key: 'strength', label: 'S&C' },
];

/* Line icons for the athlete Day view's workout bubbles — same 24-unit,
   currentColor style as the Education hub icons. */
const wi = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const WORKOUT_ICONS: Record<string, React.ReactNode> = {
  hitting: (
    <svg {...wi}>
      <path d="M20.5 3.5c.9.9.6 2.6-.7 3.9l-8.6 8.6-3.2-3.2 8.6-8.6c1.3-1.3 3-1.6 3.9-.7z" />
      <path d="M8 12.8l-4.6 4.6M6.2 17.8l-.8.8M4.6 19.4l.8-.8" />
      <circle cx="6" cy="6" r="2.2" opacity=".7" />
    </svg>
  ),
  pitching: <IconBall />,
  catching: (
    <svg {...wi}>
      <path d="M12 3.5c-4.6 0-8 3.3-8 8.2 0 4.6 3.4 8.8 8 8.8s8-4.2 8-8.8c0-4.9-3.4-8.2-8-8.2z" />
      <path d="M12 9.5c-2 0-3.5 1.4-3.5 3.3S10 16.5 12 16.5s3.5-1.8 3.5-3.7-1.5-3.3-3.5-3.3z" opacity=".7" />
      <path d="M7 6.5l2 2M17 6.5l-2 2" opacity=".55" />
    </svg>
  ),
  infield: (
    <svg {...wi}>
      <path d="M12 3l9 9-9 9-9-9z" />
      <rect x="10.6" y="10.6" width="2.8" height="2.8" rx=".6" opacity=".7" />
      <path d="M12 21v-2.5M3 12h2.5M21 12h-2.5M12 3v2.5" opacity=".55" />
    </svg>
  ),
  outfield: (
    <svg {...wi}>
      <path d="M12 21L3.3 12.3a12.3 12.3 0 0 1 17.4 0z" />
      <path d="M12 21l-4.2-4.2a6 6 0 0 1 8.4 0z" opacity=".7" />
      <path d="M12 21V8.6" opacity=".45" />
    </svg>
  ),
  strength: (
    <svg {...wi}>
      <path d="M7 12h10" />
      <rect x="3.5" y="8" width="3.5" height="8" rx="1" />
      <rect x="17" y="8" width="3.5" height="8" rx="1" />
      <path d="M2 10.5v3M22 10.5v3" />
    </svg>
  ),
};

/** "#3B82F6" → "59,130,246" for the tile's --tile-rgb accent. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Position codes that make an athlete a hitter (Hitting area by default). */
const HITTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'INF', 'UTIL'];

function parsePositions(player: Player | null | undefined): string[] {
  if (!player?.positions) return [];
  return player.positions.split(',').map(s => s.trim()).filter(Boolean);
}

/** Returns the calendar tabs visible for the given player. Multi-position
 *  athletes get every applicable tab (e.g., a C/INF gets Catching + Infield).
 *  Pitcher-only athletes only see Pitching + S&C. */
function visibleTabsForPlayer(player: Player | null | undefined, extras: string[] = []): typeof TABS {
  /* Hitting / Pitching come from the positions: a position player gets
     Hitting, a pitcher Pitching, a two-way athlete both. Infield, Outfield,
     Catching and Physical are opt-in per athlete (the Areas button), the
     same way the report tabs are. No positions on file → both defaults so
     the coach still has somewhere to build. */
  const positions = parsePositions(player);
  const isPitcher = positions.includes('P');
  const isHitter  = positions.some(p => HITTER_POSITIONS.includes(p));
  const none = !isPitcher && !isHitter;
  return TABS.filter(t => {
    if (t.key === 'hitting')  return isHitter || none;
    if (t.key === 'pitching') return isPitcher || none;
    return extras.includes(t.key);
  });
}

/** Areas the Areas button can switch on (Hitting / Pitching follow positions). */
const CALENDAR_EXTRA_AREAS: { key: string; label: string }[] = [
  { key: 'infield', label: 'Infield' },
  { key: 'outfield', label: 'Outfield' },
  { key: 'catching', label: 'Catching' },
  { key: 'strength', label: 'Physical (S&C)' },
];

/** An athlete's switched-on extra areas (Player.calendarTabs JSON). */
function parseCalendarTabs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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

/* Structured picker config per tab: one per calendar section. `label` is the
   section (saved as a row's category), `dbCategory` the Drill Library
   category it pulls from -- the section itself, except Hitting's Tee /
   Flips / Batting Practice / Machine / Live, which all draw from "Drills".
   `color` is the hex accent color (border, chips). */
type ModalDropdown = { key: string; label: string; dbCategory: string; color: string };
const MODAL_DROPDOWNS: Record<string, ModalDropdown[]> = Object.fromEntries(
  Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, ModalDropdown[]] => [
    tab,
    cats.map((c, i) => ({ key: `${tab}-${i}`, label: c.id, dbCategory: libraryCategoryFor(tab, c.id), color: c.dot })),
  ]),
);

/* Modular's picker sections per tab. Sections sharing one library category
   merge into a single picker named after it (Hitting's five → "Drills"),
   and the rows it adds are saved under that name. */
const MODULAR_DROPDOWNS: Record<string, ModalDropdown[]> = Object.fromEntries(
  Object.entries(MODAL_DROPDOWNS).map(([tab, dds]): [string, ModalDropdown[]] => {
    const out: ModalDropdown[] = [];
    for (const dd of dds) {
      const shared = dds.filter(d => d.dbCategory === dd.dbCategory);
      if (shared.length === 1) { out.push(dd); continue; }
      if (out.some(d => d.dbCategory === dd.dbCategory)) continue;
      const lib = (DRILL_LIBRARY[tab] || []).find(c => c.id === dd.dbCategory);
      out.push({ key: `${tab}-lib-${dd.dbCategory}`, label: dd.dbCategory, dbCategory: dd.dbCategory, color: lib?.dot || dd.color });
    }
    return [tab, out];
  }),
);

/* Every picker section, Structured and Modular, by key. */
const DD_BY_KEY = new Map(
  [...Object.values(MODAL_DROPDOWNS), ...Object.values(MODULAR_DROPDOWNS)].flat().map(d => [d.key, d] as const),
);

/** A Structured section's Modular picker (itself, or the merged one). */
function modularDdKey(tab: string, key: string): string {
  const dd = DD_BY_KEY.get(key);
  if (!dd) return key;
  return (MODULAR_DROPDOWNS[tab] || []).find(d => d.dbCategory === dd.dbCategory)?.key ?? key;
}

/** A Modular picker's Structured section (itself, or the first section the
 *  merged picker covers -- Hitting's "Drills" → Tee). */
function structuredDdKey(tab: string, key: string): string {
  const dds = MODAL_DROPDOWNS[tab] || [];
  const dd = DD_BY_KEY.get(key);
  if (!dd || dds.some(d => d.key === key)) return key;
  return dds.find(d => d.dbCategory === dd.dbCategory)?.key ?? key;
}

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
 * Which library drills each dropdown section of a tab can offer: that tab's
 * own drills in the section's library category. Movement Prep included --
 * each position offers only its own warm-ups (it used to share one library
 * across every position).
 */
function drillsForTabDropdowns(allDrills: Drill[], tabKey: string): Record<string, Drill[]> {
  /* Structured sections plus any merged Modular picker. */
  const dds = [...(MODAL_DROPDOWNS[tabKey] || []), ...(MODULAR_DROPDOWNS[tabKey] || [])]
    .filter((d, i, all) => all.findIndex(x => x.key === d.key) === i);
  const tabDrills = allDrills.filter(d => d.tab === tabKey);
  const map: Record<string, Drill[]> = {};
  for (const dd of dds) map[dd.key] = tabDrills.filter(d => d.category === dd.dbCategory);
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

/* ── Modular workouts (super-set blocks) ──
   A position's day can be Structured (one picker per section, the default)
   or Modular: drills from any section grouped into numbered blocks of up
   to 8. A block drill is saved as a normal row with its SECTION label as
   `category` plus a `block` number, so the colour (Movement vs Drills)
   always comes from the section it was picked from. */
type BlockItem = { drillId: string; ddKey: string; env?: DrillEnv };

/* ── Drill environment (Modular) ──
   Per drill in a set the coach tags the position's drop-downs (Hitting:
   Feed Type / Implement / Situation / Goal; Pitching: Reps / Tool /
   Intensity-Goal -- lib/drill-options, lists editable in Settings → Drills).
   Saved on the row as JSON { field: picks[] }; athletes see them in two
   columns (Environment | Goal, or Reps & Tool | Intensity / Goal). */
type DrillEnv = Record<string, string[]>;
type EnvField = string;

/** A row's saved picks, or undefined when none / unreadable. */
function parseEnv(raw: string | null | undefined): DrillEnv | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: DrillEnv = {};
    for (const [k, val] of Object.entries(v)) {
      const list = Array.isArray(val) ? val.filter((x: unknown): x is string => typeof x === 'string') : [];
      if (list.length) out[k] = list;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** The picks as saved on a row (null when nothing is picked). Keys sorted
 *  so the same picks always give the same text (change detection). */
function envString(env: DrillEnv | undefined): string | null {
  if (!env) return null;
  const out: DrillEnv = {};
  for (const k of Object.keys(env).sort()) if (env[k]?.length) out[k] = env[k];
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** "Tee, Short Bat, Fastball" / "6 reps, Plyo Balls" -- one column's picks
 *  (the Goal-type drop-down, or all the others) in drop-down order. */
function envSummary(env: DrillEnv | undefined, tab: string, goal = false): string {
  if (!env) return '';
  return drillOptionFields(tab)
    .filter(f => !!f.goal === goal)
    .flatMap(f => (env[f.key] || []).map(v => (f.suffix ? `${v}${f.suffix}` : v)))
    .join(', ');
}
const MAX_BLOCK_DRILLS = 8;
/** Sections offered in a block's "Movement" picker (Vision = cognitive). */
const MOVEMENT_SECTIONS = ['Movement Prep', 'Vision'];

function isMovementSection(label: string): boolean {
  return MOVEMENT_SECTIONS.includes(label);
}

/** A position's Modular sections split into the two block pickers. */
function modularPickerDds(tabKey: string): { movement: ModalDropdown[]; drills: ModalDropdown[] } {
  const dds = MODULAR_DROPDOWNS[tabKey] || [];
  return {
    movement: dds.filter(d => isMovementSection(d.label)),
    drills: dds.filter(d => !isMovementSection(d.label)),
  };
}

/** A tab's day is Modular once any of its rows carries a block number. */
function isModularRows(rows: { block?: number | null }[]): boolean {
  return rows.some(r => r.block != null);
}

/**
 * A modular day's rows as ordered blocks. Rows with no block number (pasted
 * in beside a block day) trail as extra blocks of up to 8, so nothing is
 * hidden from either the coach or the athlete.
 */
function groupBlocks<T extends { block?: number | null; order: number; sectionOrder: number; time: string }>(rows: T[]): T[][] {
  const byBlock = new Map<number, T[]>();
  const loose: T[] = [];
  for (const r of rows) {
    if (r.block == null) { loose.push(r); continue; }
    const arr = byBlock.get(r.block) || [];
    arr.push(r);
    byBlock.set(r.block, arr);
  }
  const byPos = (a: T, b: T) => a.order - b.order || parseTime(a.time) - parseTime(b.time);
  const out = [...byBlock.entries()].sort((a, b) => a[0] - b[0]).map(([, arr]) => arr.sort(byPos));
  loose.sort((a, b) => a.sectionOrder - b.sectionOrder || byPos(a, b));
  for (let i = 0; i < loose.length; i += MAX_BLOCK_DRILLS) out.push(loose.slice(i, i + MAX_BLOCK_DRILLS));
  return out;
}

/** The day's Modular tabs as editable blocks (library-linked rows only). */
function buildBlocksFromEvents(events: ScheduledDrill[]): Record<string, BlockItem[][]> {
  const out: Record<string, BlockItem[][]> = {};
  for (const tab of TABS) {
    const rows = events.filter(ev => ev.tab === tab.key);
    if (!isModularRows(rows)) continue;
    out[tab.key] = groupBlocks(rows.filter(ev => ev.drillId && ddForEvent(ev)))
      .map(b => b.map(ev => ({ drillId: ev.drillId!, ddKey: modularDdKey(tab.key, ddForEvent(ev)!.key), env: parseEnv(ev.environment) })));
  }
  return out;
}

/** A Structured position's picks laid out as sets of up to 8, in section
 *  order -- what switching it to Modular shows. */
function picksAsBlocks(tabKey: string, sel: Record<string, Set<string>>): BlockItem[][] {
  const items: BlockItem[] = [];
  const seen = new Set<string>();
  for (const dd of MODAL_DROPDOWNS[tabKey] || []) {
    /* Sections merged into one Modular picker hold each drill once. */
    const ddKey = modularDdKey(tabKey, dd.key);
    for (const id of sel[dd.key] || []) {
      if (seen.has(`${ddKey}:${id}`)) continue;
      seen.add(`${ddKey}:${id}`);
      items.push({ drillId: id, ddKey });
    }
  }
  const blocks: BlockItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_BLOCK_DRILLS) blocks.push(items.slice(i, i + MAX_BLOCK_DRILLS));
  return blocks;
}

/** Same blocks? Empty blocks and drill-less Modular tabs save nothing, so
 *  they don't count as a change. */
function sameBlocks(a: Record<string, BlockItem[][]>, b: Record<string, BlockItem[][]>): boolean {
  const norm = (x: Record<string, BlockItem[][]>) => JSON.stringify(
    TABS.map(t => (x[t.key] || []).filter(bl => bl.length).map(bl => bl.map(it => `${it.ddKey}:${it.drillId}:${envString(it.env) || ''}`)))
      .map((bls, i) => (bls.length ? [TABS[i].key, bls] : null)),
  );
  return norm(a) === norm(b);
}

/**
 * A template's drills, keyed by the picker section that owns them.
 *
 * Selecting a template feeds the SAME draft the drill pickers write to, so a
 * templated drill and a hand-picked one are indistinguishable once applied —
 * that is what lets Save publish both together.
 *
 * Items with no drillId (a hand-entered one-off that was snapshotted into the
 * template) are skipped: no picker can represent them, so there is nothing to
 * tick. Templates built from library drills — every template the "+Temp"
 * button produces from a normal day — are unaffected.
 */
function templateDrillsByDd(
  t: api.ScheduleTemplate,
  allDrills: Drill[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const resolve = templateResolver(t.tab, allDrills);
  for (const it of api.parseTemplateItems(t)) {
    const hit = resolve(it);
    if (!hit) continue;
    const bucket = (out[hit.ddKey] ||= []);
    /* A template listing the same drill twice must not double it. */
    if (!bucket.includes(hit.drillId)) bucket.push(hit.drillId);
  }
  return out;
}

/** Maps a template item to the picker section + drill row it lands on, or
 *  null when no picker can represent it (hand-entered, or deleted drill). */
function templateResolver(tab: string, allDrills: Drill[]) {
  const options = drillsForTabDropdowns(allDrills, tab);
  const byId = new Map(allDrills.map(d => [d.id, d]));
  return (it: api.ScheduleTemplateItem): BlockItem | null => {
    if (!it.drillId) return null;
    const dd = ddForEvent({ tab, category: it.category });
    if (!dd) return null;
    const choices = options[dd.key] || [];

    /* Resolve to the row this picker actually offers.

       Exact id first. Failing that, match on name: templates saved while
       Movement Prep was one library shared across positions can hold another
       position's copy of a warm-up, and same-named drills merged in the 2026
       Hitting reshape left templates pointing at a removed copy. */
    let resolved = choices.find(d => d.id === it.drillId);
    if (!resolved) {
      const wanted = (byId.get(it.drillId)?.name || it.name || '').trim().toLowerCase();
      if (wanted) resolved = choices.find(d => d.name.trim().toLowerCase() === wanted);
    }
    return resolved ? { drillId: resolved.id, ddKey: dd.key } : null;
  };
}

/** A Modular template is one saved from blocks (its items carry `block`). */
function isModularTemplate(t: api.ScheduleTemplate): boolean {
  return api.parseTemplateItems(t).some(it => it.block != null);
}

/** A Modular template's blocks, ready to append to a position's draft. */
function templateBlocks(t: api.ScheduleTemplate, allDrills: Drill[]): BlockItem[][] {
  const resolve = templateResolver(t.tab, allDrills);
  const byBlock = new Map<number, { order: number; item: BlockItem }[]>();
  for (const it of api.parseTemplateItems(t)) {
    const hit = resolve(it);
    if (!hit) continue;
    const n = it.block ?? 0;
    const arr = byBlock.get(n) || [];
    arr.push({ order: it.order ?? 0, item: { ...hit, ddKey: modularDdKey(t.tab, hit.ddKey), env: parseEnv(it.environment) } });
    byBlock.set(n, arr);
  }
  return [...byBlock.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, arr]) => arr.sort((a, b) => a.order - b.order).map(x => x.item).slice(0, MAX_BLOCK_DRILLS));
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
  const { user, isCoach, isParent, isViewer, isLoading: authLoading } = useAuth();

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
    // Parents browse like a coach (Week first); athletes open on today.
    if (!isCoach && !isParent) setView('day');
  }, [authLoading, user, isCoach, isParent]);
  const [events, setEvents] = useState<ScheduledDrill[]>([]);
  const [, setLoadingEvents] = useState(false);

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
    } else if (isParent) {
      /* Parents: only the athletes linked to them (the API refuses any
         other athlete's schedule anyway). */
      api.getMyParentProfile().then(prof => {
        const linked = prof.athletes.map(a => ({ ...a, positions: a.positions || '' })) as unknown as Player[];
        setPlayers(linked);
        if (linked.length > 0 && !selectedPlayerId) setSelectedPlayerId(linked[0].id);
      }).catch(() => {});
    } else {
      const authUser = user as any;
      if (authUser.playerId) setSelectedPlayerId(authUser.playerId);
    }
  }, [user, isCoach, isParent]);

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
     Applying is per column and goes through the DRAFT (see toggleTemplate),
     not straight to the athlete: ticking a template adds its drills to the
     column exactly as if the coach had picked them, and the day-level Save is
     what publishes. The old modal wrote to the athlete the instant you picked
     a template, which bypassed Save entirely and made the two paths disagree
     about when a day becomes real.

     "+Temp" opens the styled name modal (SaveTemplateModal); the
     modal owns the input + inline "✓ Saved" confirmation, this page owns the
     API write. Replaces the v1 window.prompt/alert flow. */
  const [saveTpl, setSaveTpl] = useState<{ tabKey: string; label: string; items: api.ScheduleTemplateItem[] } | null>(null);
  const handleSaveTemplate = useCallback((tabKey: string, items: api.ScheduleTemplateItem[]) => {
    if (items.length === 0) return;
    const label = TABS.find(t => t.key === tabKey)?.label ?? tabKey;
    setSaveTpl({ tabKey, label, items });
  }, []);
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
    const shift = shiftBlocksPast(allEventsByDate[targetDate] || []);
    const items = copiedDrills.map(ev => ({
      playerId: selectedPlayerId,
      drillId: ev.drillId || undefined,
      tab: ev.tab,
      category: ev.category,
      name: ev.name,
      date: targetDate,
      time: ev.time,
      duration: ev.duration,
      /* Keep the day's layout: drag order and Modular sets (numbered
         after any sets the day already has). */
      order: ev.order,
      sectionOrder: ev.sectionOrder,
      block: shift(ev.tab, ev.block),
      environment: ev.environment ?? null,
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
    /* The target week as saved, so pasted Modular sets are numbered after
       each day's existing sets (only the viewed day is loaded here). */
    const targetEnd = new Date(targetStart);
    targetEnd.setDate(targetEnd.getDate() + 6);
    let targetWeek: ScheduledDrill[] = [];
    try {
      targetWeek = await api.getScheduledDrills(selectedPlayerId, { startDate: toDateStr(targetStart), endDate: toDateStr(targetEnd) });
    } catch { /* nothing known -- sets keep their numbers */ }
    const shiftByDate: Record<string, ReturnType<typeof shiftBlocksPast>> = {};
    const items = copiedWeek.map(ev => {
      const offset = Math.round((parseLocalDate(ev.date).getTime() - srcStart.getTime()) / 86400000);
      const tgt = new Date(targetStart);
      tgt.setDate(tgt.getDate() + offset);
      const date = toDateStr(tgt);
      const shift = (shiftByDate[date] ||= shiftBlocksPast(targetWeek.filter(r => r.date === date)));
      return {
        playerId: selectedPlayerId,
        drillId: ev.drillId || undefined,
        tab: ev.tab,
        category: ev.category,
        name: ev.name,
        date,
        time: ev.time,
        duration: ev.duration,
        order: ev.order,
        sectionOrder: ev.sectionOrder,
        block: shift(ev.tab, ev.block),
        environment: ev.environment ?? null,
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

  /* Extra areas switched on for this athlete. Saved on the athlete; a
     coach's toggle shows straight away (override) and rolls back if the
     save fails. */
  const [extrasOverride, setExtrasOverride] = useState<Record<string, string[]>>({});
  const calendarExtras = useMemo(
    () => (selectedPlayerId && extrasOverride[selectedPlayerId]) || parseCalendarTabs(selectedPlayer?.calendarTabs),
    [selectedPlayerId, extrasOverride, selectedPlayer?.calendarTabs],
  );
  /* Quick toggles must land in order: each one builds on the latest choice
     (not a render that may not have happened yet) and the saves run one
     after another, so the last tick is what the server keeps. */
  const latestExtras = useRef<Record<string, string[]>>({});
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const toggleCalendarArea = useCallback((key: string) => {
    if (!selectedPlayerId) return;
    const pid = selectedPlayerId;
    const cur = latestExtras.current[pid] ?? calendarExtras;
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    latestExtras.current[pid] = next;
    setExtrasOverride(o => ({ ...o, [pid]: next }));
    saveQueue.current = saveQueue.current
      .then(() => api.setPlayerCalendarTabs(pid, next))
      .then(
        () => setPlayers(ps => ps.map(p => (p.id === pid ? { ...p, calendarTabs: JSON.stringify(next) } : p))),
        (err) => {
          /* Fall back to what the athlete record says. */
          console.error('Saving calendar areas failed:', err);
          delete latestExtras.current[pid];
          setExtrasOverride(o => { const n = { ...o }; delete n[pid]; return n; });
        },
      );
  }, [selectedPlayerId, calendarExtras]);

  /* Visible areas: Hitting / Pitching by position + the switched-on extras. */
  const visibleTabs = useMemo(() => visibleTabsForPlayer(selectedPlayer, calendarExtras), [selectedPlayer, calendarExtras]);

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

  /* Modular positions for the day: tab → its super-set blocks. A tab with
     no entry is Structured and is edited through draftSel instead. */
  const persistedBlocks = useMemo(
    () => buildBlocksFromEvents(allEventsByDate[todayDateStr] || []),
    [allEventsByDate, todayDateStr],
  );
  const [blockDraft, setBlockDraft] = useState<Record<string, BlockItem[][]>>(persistedBlocks);
  /* Positions the coach switched to Modular. The choice sticks while they
     move between athletes and days: each day opens in Modular, with any
     saved Structured drills shown as sets (see blockBaseline -- that view
     alone is not an unsaved change). */
  const modularPref = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = { ...persistedBlocks };
    for (const tab of modularPref.current) {
      if (!next[tab]) next[tab] = picksAsBlocks(tab, persistedDraft);
    }
    setBlockDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistedDraft comes from the same events as persistedBlocks
  }, [persistedBlocks]);

  /* What the blocks look like with no edits: the saved sets, plus -- for a
     Structured day being viewed in Modular -- its saved picks as sets. A
     draft equal to this is unchanged, so viewing a day in Modular never
     lights up Save or rewrites the day; editing it does. */
  const blockBaseline = useMemo(() => {
    const base = { ...persistedBlocks };
    for (const tab of Object.keys(blockDraft)) {
      if (!base[tab]) base[tab] = picksAsBlocks(tab, persistedDraft);
    }
    return base;
  }, [persistedBlocks, persistedDraft, blockDraft]);

  /* Apply Calendar — pushes this athlete's forward schedule onto a group.
     The banner is how a bulk write that touches other athletes' calendars
     reports what it did; it is not a toast because the coach should be able
     to read it after the fact. */
  const [showApply, setShowApply] = useState(false);
  const [showClear, setShowClear] = useState(false);
  /* The banner carries the log id for the change it describes, which is what
     makes Undo possible — the server kept a snapshot of everything the change
     removed. `undoing` disables the button so a slow request cannot double
     fire, and `undone` turns the banner into its own receipt. */
  const [applyBanner, setApplyBanner] = useState<{ text: string; logId: string | null } | null>(null);
  const [undoing, setUndoing] = useState(false);

  /* Where an Apply Calendar copy starts: the date the coach is LOOKING AT,
     not today.

     Calendars here are built in blocks that routinely sit in the past
     relative to today — every athlete in the roster can have a full spring
     block and nothing at all from today forward. Anchoring to today made the
     feature refuse every athlete. Anchoring to the view means "apply what is
     on screen, and everything after it".

     Month deliberately uses the 1st rather than dateRange.startDate, which
     pads back to the 20th of the previous month to fill the grid — copying
     from a date the coach cannot see would be its own surprise. */
  const handleUndo = useCallback(async () => {
    if (!applyBanner?.logId) return;
    setUndoing(true);
    try {
      const res = await api.undoCalendarChange(applyBanner.logId);
      setApplyBanner({
        text: `Undone — restored ${res.restored} drill${res.restored === 1 ? '' : 's'}` +
          (res.discarded ? ` and removed ${res.discarded} that were added.` : '.'),
        logId: null,
      });
      refreshEvents();
    } catch (e: any) {
      setApplyBanner({ text: e?.message || 'Undo failed', logId: applyBanner.logId });
    } finally {
      setUndoing(false);
    }
  }, [applyBanner, refreshEvents]);

  /* The week the coach is looking at — Clear Week uses exactly these bounds
     so it removes what is drawn on screen, nothing more. */
  const viewWeek = useMemo(() => {
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - currentDate.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toDateStr(start), end: toDateStr(end) };
  }, [currentDate]);

  const applyFromDate = useMemo(() => {
    if (view === 'day') return toDateStr(currentDate);
    if (view === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - d.getDay());
      return toDateStr(d);
    }
    return toDateStr(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  }, [view, currentDate]);

  /* Saved templates, for the per-column Template pickers. Fetched once for
     every sport and split by tab, so a column only ever offers its own. */
  const [templates, setTemplates] = useState<api.ScheduleTemplate[]>([]);
  const loadTemplates = useCallback(() => {
    if (!isCoach) return;
    api.getScheduleTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [isCoach]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const templatesByTab = useMemo(() => {
    const out: Record<string, api.ScheduleTemplate[]> = {};
    for (const t of templates) (out[t.tab] ||= []).push(t);
    return out;
  }, [templates]);

  /* Which templates are currently applied to the draft, and exactly which
     drills each one CONTRIBUTED.

     Storing the contribution (rather than re-deriving it on removal) is what
     makes unticking a template subtract only what it actually added. If two
     templates share a drill, or the coach had already picked it by hand, the
     second template records nothing for it — so turning that template off
     leaves the drill where it was instead of yanking it out from under the
     other source. Presence of a key is also what marks a template selected. */
  const [tplAdded, setTplAdded] = useState<Record<string, Record<string, string[]>>>({});

  /* Re-baseline whenever the persisted day changes — switching athlete,
     moving to another date, or a refetch after save. Any unsaved edits are
     dropped at that point BY DESIGN: they belonged to the day being left.
     The nav guard below is what stops that happening silently. */
  useEffect(() => {
    setDraftSel(persistedDraft);
    /* Templates come off with it: once a day is saved its drills are simply
       part of the day, not a pending template application. */
    setTplAdded({});
  }, [persistedDraft]);

  const dayDirty = useMemo(
    () => !sameDraft(draftSel, persistedDraft) || !sameBlocks(blockDraft, blockBaseline),
    [draftSel, persistedDraft, blockDraft, blockBaseline],
  );

  /* Structured ⇄ Modular for one position. Nothing is lost either way:
     Structured picks become blocks of up to 8 (in section order), and a
     block day's drills go back into their own sections' pickers. */
  const setTabModular = useCallback((tabKey: string, on: boolean) => {
    const dds = MODAL_DROPDOWNS[tabKey] || [];
    if (on) modularPref.current.add(tabKey);
    else modularPref.current.delete(tabKey);
    if (on) {
      setBlockDraft(prev => ({ ...prev, [tabKey]: picksAsBlocks(tabKey, draftSel) }));
      return;
    }
    const sets: Record<string, Set<string>> = {};
    for (const dd of dds) sets[dd.key] = new Set<string>();
    for (const block of blockDraft[tabKey] || []) for (const it of block) sets[structuredDdKey(tabKey, it.ddKey)]?.add(it.drillId);
    setDraftSel(prev => ({ ...prev, ...sets }));
    setBlockDraft(prev => {
      const next = { ...prev };
      delete next[tabKey];
      return next;
    });
  }, [draftSel, blockDraft]);

  /** Edit one Modular position's blocks (no-op if it isn't Modular). */
  const updateBlocks = useCallback((tabKey: string, fn: (blocks: BlockItem[][]) => BlockItem[][]) => {
    setBlockDraft(prev => (prev[tabKey] ? { ...prev, [tabKey]: fn(prev[tabKey]) } : prev));
  }, []);

  /**
   * Add or remove a whole template's drills from the draft.
   *
   * Both halves compute their effect OUTSIDE the state updaters. React
   * StrictMode double-invokes updaters in development, so deriving "what did
   * this add" inside one would run the derivation twice and record the wrong
   * contribution. The updaters themselves only add/delete, which is
   * idempotent and safe to run twice.
   */
  /* Delete a saved template from a column's Template list. Drills it
     already added to the draft stay -- they are just drills by then. */
  const deleteTemplate = useCallback(async (t: api.ScheduleTemplate) => {
    await api.deleteScheduleTemplate(t.id);
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
  }, []);

  const toggleTemplate = useCallback((t: api.ScheduleTemplate) => {
    /* Modular template: its blocks are appended after the position's own,
       and unticking takes out the blocks that still match it exactly (a
       block the coach has since edited is theirs now and stays). */
    if (isModularTemplate(t)) {
      const tBlocks = templateBlocks(t, allDrills);
      const key = (b: BlockItem[]) => b.map(it => `${it.ddKey}:${it.drillId}`).join('|');
      const on = Object.prototype.hasOwnProperty.call(tplAdded, t.id);
      setBlockDraft(prev => {
        const cur = prev[t.tab];
        if (!cur) return prev;
        if (!on) return { ...prev, [t.tab]: [...cur, ...tBlocks] };
        const next = [...cur];
        for (const tb of tBlocks) {
          const at = next.findIndex(b => key(b) === key(tb));
          if (at >= 0) next.splice(at, 1);
        }
        return { ...prev, [t.tab]: next };
      });
      setTplAdded(prev => {
        const next = { ...prev };
        if (on) delete next[t.id];
        else next[t.id] = {};
        return next;
      });
      return;
    }

    const byDd = templateDrillsByDd(t, allDrills);

    if (Object.prototype.hasOwnProperty.call(tplAdded, t.id)) {
      const contributed = tplAdded[t.id] || {};
      setDraftSel(prev => {
        const next = { ...prev };
        for (const [ddKey, ids] of Object.entries(contributed)) {
          const set = new Set(next[ddKey] || []);
          ids.forEach(id => set.delete(id));
          next[ddKey] = set;
        }
        return next;
      });
      setTplAdded(prev => {
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
      return;
    }

    /* Only drills this template is genuinely introducing count as its
       contribution — see the note on tplAdded. */
    const added: Record<string, string[]> = {};
    for (const [ddKey, ids] of Object.entries(byDd)) {
      const have = draftSel[ddKey] || EMPTY_SET;
      const newly = ids.filter(id => !have.has(id));
      if (newly.length) added[ddKey] = newly;
    }
    setDraftSel(prev => {
      const next = { ...prev };
      for (const [ddKey, ids] of Object.entries(byDd)) {
        const set = new Set(next[ddKey] || []);
        ids.forEach(id => set.add(id));
        next[ddKey] = set;
      }
      return next;
    });
    setTplAdded(prev => ({ ...prev, [t.id]: added }));
  }, [tplAdded, draftSel, allDrills]);

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
      /* Drills kept when a Modular day goes back to Structured: they lose
         their block number and rejoin their section's position. */
      const toUnblock: { id: string; sectionOrder: number }[] = [];

      for (const tab of TABS) {
        const dds = MODAL_DROPDOWNS[tab.key] || [];
        const tabEvents = existing.filter(ev => ev.tab === tab.key);

        /* Modular: the blocks ARE the plan, so an edited block day is
           rebuilt from them (block n, position within the block as order).
           Untouched block days are left alone; hand-entered one-offs and
           rows no section can represent always survive. */
        const blocks = blockDraft[tab.key];
        if (blocks) {
          /* Unedited (incl. a Structured day only being viewed as sets). */
          if (sameBlocks({ [tab.key]: blocks }, { [tab.key]: blockBaseline[tab.key] || [] })) continue;
          for (const ev of tabEvents) if (ev.drillId && ddForEvent(ev)) toDelete.push(ev.id);
          let blockSlot = 9 * 60;
          blocks.filter(b => b.length).forEach((block, bi) => {
            block.forEach((it, ii) => {
              const drill = allDrills.find(d => d.id === it.drillId);
              const dd = DD_BY_KEY.get(it.ddKey);
              if (!drill || !dd) return;
              const h = Math.floor(blockSlot / 60), m = blockSlot % 60;
              toAdd.push({
                playerId: selectedPlayerId,
                drillId: drill.id,
                tab: tab.key,
                category: dd.label,
                name: drill.name,
                date: todayDateStr,
                time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                duration: 15,
                order: ii,
                sectionOrder: bi,
                block: bi + 1,
                environment: envString(it.env),
              });
              blockSlot += 15;
            });
          });
          continue;
        }

        /* New drills queue up after the last one already on the day, so a
           save never collides two drills onto the same time slot. */
        let slot = tabEvents.length
          ? Math.max(...tabEvents.map(ev => parseTime(ev.time))) + 15
          : 9 * 60;

        dds.forEach((dd, ddIndex) => {
          const sel = draftSel[dd.key] || EMPTY_SET;
          const mine = tabEvents.filter(ev => ev.drillId && ddForEvent(ev)?.key === dd.key);

          /* A section holds each drill once. A Modular day can repeat a
             drill across blocks, so going back to Structured keeps the
             first copy and drops the rest. */
          const kept = new Set<string>();
          for (const ev of mine) {
            if (!sel.has(ev.drillId!) || (ev.block != null && kept.has(ev.drillId!))) { toDelete.push(ev.id); continue; }
            kept.add(ev.drillId!);
            if (ev.block != null) toUnblock.push({ id: ev.id, sectionOrder: ddIndex });
          }

          const alreadyThere = new Set(mine.map(ev => ev.drillId!));
          const added = [...sel].filter(id => !alreadyThere.has(id));
          if (added.length === 0) return;

          /* Slot new drills into the section where it already exists so they
             land beside their siblings; a brand-new section takes its
             canonical position in the taxonomy. */
          const sectionOrder = mine.length && mine[0].block == null ? mine[0].sectionOrder : ddIndex;
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
      for (const u of toUnblock) await api.updateScheduledDrill(u.id, { block: null, sectionOrder: u.sectionOrder });
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
  }, [selectedPlayerId, dayDirty, allEventsByDate, todayDateStr, draftSel, blockDraft, blockBaseline, allDrills, refreshEvents]);

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
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      {/* ── Header ── */}
      <EduHeader
        tone="light"
        chipInline
        icon={<IconAttendance />}
        eyebrow="Training Calendar"
        title={
          isCoach || isParent
            ? (selectedPlayer ? selectedPlayer.firstName : 'Select')
            : 'My Training'
        }
        accent={
          isCoach || isParent
            ? (selectedPlayer ? selectedPlayer.lastName : 'Athlete')
            : 'Calendar'
        }
        readout={todayDateStr}
        readoutClassName={theme.firm}
      />

      {/* ── Calendar shell — lighter `profilePanel` outer bubble holds
          the athlete selector, view tabs/controls, and the calendar grid.
          The calendar grid itself uses the darker `innerPanel` tone, so
          the page reads as a clear two-tone hierarchy. */}
      <div
        className={theme.bubble}
        style={{ padding: 18, display: 'flex', flexDirection: 'column' }}
      >

      {/* ── Athlete Selector (coaches: everyone; parents: their linked
          athletes -- the tools beside it stay coach-only) ── */}
      {(isCoach || isParent) && (
        <div className={styles.athleteBar}>
          <span className={styles.athleteLabel}>Athlete</span>
          <select
            className={`${styles.athleteSelect} ${theme.field} ${theme.firm}`}
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

          {/* Push this athlete's schedule onto a program or a hand-picked
              set. Needs a selected athlete — there is no calendar to copy
              otherwise. */}
          {isCoach && selectedPlayerId && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={`${styles.applyTrigger} ${theme.field} ${theme.firm}`}
                onClick={() => setShowApply(o => !o)}
                title="Copy this athlete's schedule to other athletes or a program"
              >
                Apply Calendar
              </button>
              <ApplyCalendarModal
                open={showApply}
                onClose={() => setShowApply(false)}
                players={players}
                sourcePlayer={selectedPlayer}
                fromDate={applyFromDate}
                onApplied={(msg, logId) => {
                  setApplyBanner({ text: msg, logId });
                  /* Only the SOURCE calendar is on screen and it is never a
                     target, so nothing here needs refetching — but a coach
                     who then switches to a target expects to see it. */
                  refreshEvents();
                }}
              />
            </div>
          )}

          {/* Clear this athlete's schedule — day, week, or everything. */}
          {isCoach && selectedPlayerId && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={`${styles.clearTrigger} ${theme.field} ${theme.firm}`}
                onClick={() => setShowClear(o => !o)}
                title="Clear this athlete's schedule"
              >
                Clear
              </button>
              <ClearScheduleMenu
                open={showClear}
                onClose={() => setShowClear(false)}
                playerId={selectedPlayerId}
                playerName={selectedPlayer ? selectedPlayer.firstName : 'this athlete'}
                dayDate={toDateStr(currentDate)}
                weekStart={viewWeek.start}
                weekEnd={viewWeek.end}
                onCleared={(msg, logId) => {
                  setApplyBanner({ text: msg, logId });
                  refreshEvents();
                }}
              />
            </div>
          )}
        </div>
      )}

      {applyBanner && (
        <div className={styles.applyBanner}>
          <span>{applyBanner.text}</span>
          {/* Undo is offered only while the change is still reversible — once
              rolled back the id is cleared, so the banner cannot invite a
              second undo of the same change. */}
          {applyBanner.logId && (
            <button
              type="button"
              className={styles.undoBtn}
              disabled={undoing}
              onClick={handleUndo}
            >
              {undoing ? 'Undoing…' : 'Undo'}
            </button>
          )}
          <button type="button" onClick={() => setApplyBanner(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Calendar Controls ── */}
      <div className={styles.calControls}>
        <div className={styles.calNav}>
          <button className={`${styles.navBtn} ${theme.field} ${theme.firm}`} onClick={() => navigate(-1)}>‹</button>
          <span className={styles.calTitle}>{calTitle}</span>
          <button className={`${styles.navBtn} ${theme.field} ${theme.firm}`} onClick={() => navigate(1)}>›</button>
          <button className={`${styles.todayBtn} ${theme.field} ${theme.firm}`} onClick={goToday}>Today</button>
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
                    className={dayDirty ? styles.dayActionBtnAccent : `${styles.dayActionBtn} ${theme.field} ${theme.firm}`}
                    onClick={handleSaveDay}
                    disabled={savingDay || !dayDirty}
                    title={dayDirty
                      ? 'Save this day — athletes see the changes once saved'
                      : 'No unsaved changes'}
                  >
                    {savingDay ? 'Saving…' : dayDirty ? 'Save' : 'Saved'}
                  </button>
                  <button className={`${styles.dayActionBtn} ${theme.field} ${theme.firm}`} onClick={() => handleCopyDay(todayDateStr)} title="Copy this day's drills">Copy</button>
                  {copiedDrills.length > 0 && (
                    <button className={styles.dayActionBtnAccent} onClick={() => handlePasteDay(todayDateStr)} title={copiedDate ? `Paste day from ${copiedDate}` : 'Paste copied day'}>Paste</button>
                  )}
                </>
              )}
              <button className={`${styles.dayActionBtn} ${theme.field} ${theme.firm}`} onClick={handleCopyWeek} title="Copy this whole week's drills">Copy Week</button>
              {copiedWeek.length > 0 && (
                <button className={styles.dayActionBtnAccent} onClick={handlePasteWeek} title={copiedWeekStart ? `Paste week from ${copiedWeekStart}` : 'Paste copied week'}>Paste Week</button>
              )}
            </>
          )}
        </div>
        {/* Areas: switch Infield / Outfield / Catching / Physical on for
            this athlete (Hitting / Pitching follow positions). Coaches only. */}
        {isCoach && !isViewer && selectedPlayerId && (
          <CalendarAreasMenu
            enabled={calendarExtras}
            onToggle={toggleCalendarArea}
            className={`${styles.areasBtn} ${theme.field} ${theme.firm}`}
          />
        )}
        <div className={`${styles.viewSwitcher} ${theme.field}`}>
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

      {/* ── Tab Bar (Week view only — Month shows all tabs, Day uses columns).
          Sits UNDER the date / arrows / Today / Copy Week line. ── */}
      {view === 'week' && (
        <div className={styles.tabBar} style={{ marginTop: 0, marginBottom: 12 }}>
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
        <div className={`${styles.empty} ${theme.inner}`}>
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
          allDrills={allDrills}
          draftSel={draftSel}
          onToggleDd={toggleDraftDd}
          blockDraft={blockDraft}
          onSetModular={setTabModular}
          onUpdateBlocks={updateBlocks}
          templatesByTab={templatesByTab}
          selectedTemplateIds={tplAdded}
          onToggleTemplate={toggleTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}

      {/* Styled name-and-confirm modal for "Save as template". */}
      <SaveTemplateModal
        open={!!saveTpl}
        sportLabel={saveTpl?.label ?? ''}
        itemCount={saveTpl?.items.length ?? 0}
        sectionCount={saveTpl ? new Set(saveTpl.items.map(i => (i.block != null ? `b${i.block}` : i.category))).size : 0}
        groupNoun={saveTpl?.items.some(i => i.block != null) ? 'set' : 'section'}
        onClose={() => setSaveTpl(null)}
        onSave={async (nm) => {
          if (!saveTpl) return;
          await api.createScheduleTemplate({ name: nm, tab: saveTpl.tabKey, items: saveTpl.items });
          /* So it shows up in the column pickers without a reload. */
          loadTemplates();
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
      {/* ── Check-In ──
          The athlete's own bookend around today's session: prompt on open,
          Finish bar under the calendar, reflection on the way out. Gated to
          players — a coach viewing this calendar isn't the one training —
          and the component itself renders nothing unless the athlete has
          drills scheduled today. */}
      {!isCoach && !isParent && selectedPlayerId && (
        <CheckInFlow
          playerId={selectedPlayerId}
          viewDate={toDateStr(currentDate)}
          onChanged={refreshEvents}
        />
      )}

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
    <div className={`${styles.monthGrid} ${theme.inner}`}>
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
                <div key={tab} className={styles.eventPill} style={{ background: color.bg, color: 'var(--tab-ink)', '--tab-c': color.text } as React.CSSProperties}>
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
    <div className={`${styles.weekListGrid} ${theme.inner}`}>
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
  /* Not shown (the date header was removed); only resets the athlete view. */
  currentDate: _currentDate,
  allDayEvents,
  isCoach,
  onDelete,
  onCopyTab,
  onPaste,
  hasCopied,
  copiedFromDate,
  onDrillClick,
  visibleTabs,
  onReorder,
  onSaveTemplate,
  allDrills,
  draftSel,
  onToggleDd,
  blockDraft,
  onSetModular,
  onUpdateBlocks,
  templatesByTab,
  selectedTemplateIds,
  onToggleTemplate,
  onDeleteTemplate,
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
  /** Saved templates split by sport — a column only offers its own. */
  templatesByTab: Record<string, api.ScheduleTemplate[]>;
  /** Keyed by applied template id; presence marks it selected. */
  selectedTemplateIds: Record<string, unknown>;
  /** Add / remove a whole template's drills from the draft. */
  onToggleTemplate: (t: api.ScheduleTemplate) => void;
  /** Permanently delete a saved template. */
  onDeleteTemplate: (t: api.ScheduleTemplate) => Promise<void>;
  /** Drill library, for the in-column category dropdowns. */
  allDrills: Drill[];
  /** Coach's unsaved selections, keyed by dropdown section. */
  draftSel: Record<string, Set<string>>;
  /** Tick / untick one drill in one section. */
  onToggleDd: (ddKey: string, drillId: string) => void;
  /** Coach draft of the day's Modular positions (tab → blocks). */
  blockDraft: Record<string, BlockItem[][]>;
  /** Switch one position between Structured and Modular. */
  onSetModular: (tabKey: string, on: boolean) => void;
  /** Edit one Modular position's blocks. */
  onUpdateBlocks: (tabKey: string, fn: (blocks: BlockItem[][]) => BlockItem[][]) => void;
}) {

  /* Focused-tab state — null means "show full day across every visible
   * column". Clicking a column header narrows the view to just that tab
   * (Pitching only, Hitting only, etc.) so the user can read a single
   * area's plan at a comfortable size. Click "← All areas" to return.
   * Drill-click → DrillVideoModal flow is unchanged in both modes. */
  const [focusedTab, setFocusedTab] = useState<string | null>(null);
  /* Athletes + parents land on the workout bubbles each time they move
     to another day, rather than inside a workout that day may not have. */
  const dayKey = _currentDate.toDateString();
  useEffect(() => {
    if (!isCoach) setFocusedTab(null);
  }, [dayKey, isCoach]);

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

  /* Split a tab's rows by the picker that owns them, so each dropdown can
     render its own drills directly underneath itself.

     Keyed by dropdown, NOT by the stored `category` string: a row written
     before the sections split carries the shared library category ('Drills')
     rather than the section label ('Tee'), and ddForEvent is what reconciles
     the two. Rows no picker can claim — hand-entered one-offs, retired
     categories — come back separately so they can still be shown. */
  const splitBySection = (tabKey: string) => {
    const byDd = new Map<string, ScheduledDrill[]>();
    const orphans: ScheduledDrill[] = [];
    const push = (ddKey: string, ev: ScheduledDrill) => {
      const arr = byDd.get(ddKey) || [];
      arr.push(ev);
      byDd.set(ddKey, arr);
    };

    for (const ev of displayByTab[tabKey] || []) {
      if (isPendingRow(ev.id)) {
        const parsed = parsePendingId(ev.id);
        if (parsed) { push(parsed.ddKey, ev); continue; }
      }
      const dd = ev.drillId ? ddForEvent(ev) : undefined;
      if (dd) push(dd.key, ev);
      else orphans.push(ev);
    }

    /* Same ordering the section cards use: coach order first, time as the
       tiebreak. Pending rows carry order values above the saved ones, so
       they queue at the end of their section. */
    for (const arr of byDd.values()) {
      arr.sort((a, b) => a.order - b.order || parseTime(a.time) - parseTime(b.time));
    }
    return { byDd, orphans };
  };

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
  const buildTemplateItems = (tabKey: string): api.ScheduleTemplateItem[] => {
    /* Modular: snapshot the blocks (draft included) -- each drill keeps its
       section as category plus its block number and place in the block. */
    const blocks = blockDraft[tabKey];
    if (blocks) {
      let blockSlot = 9 * 60;
      return blocks.filter((b) => b.length).flatMap((block, bi) => block.flatMap((it, ii) => {
        const drill = drillById.get(it.drillId);
        const dd = DD_BY_KEY.get(it.ddKey);
        if (!drill || !dd) return [];
        const h = Math.floor(blockSlot / 60), m = blockSlot % 60;
        blockSlot += 15;
        return [{
          drillId: drill.id,
          category: dd.label,
          name: drill.name,
          time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          duration: 15,
          notes: null,
          order: ii,
          sectionOrder: bi,
          block: bi + 1,
          environment: envString(it.env),
        }];
      }));
    }
    /* Snapshots the DISPLAYED day, draft included, so "+Temp" captures a day
       the coach has just assembled and not yet saved — which is the moment
       they are most likely to want it as a template.

       Pending rows have no time (there is no scheduled row behind them yet),
       so they get laid out on the same 15-minute grid the day save uses. */
    let slot = 9 * 60;
    return groupByCategory(displayByTab[tabKey] || [], tabKey).flatMap(([category, evs], gi) =>
      evs.map((ev, i) => {
        let time = ev.time;
        if (!time) {
          const h = Math.floor(slot / 60), m = slot % 60;
          time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          slot += 15;
        }
        return {
          drillId: ev.drillId,
          category,
          name: ev.name,
          time,
          duration: ev.duration,
          notes: ev.notes,
          order: i,
          sectionOrder: gi,
        };
      }),
    );
  };

  // When entering focus mode, look up the tab's metadata once.
  const focusedTabMeta = focusedTab ? TABS.find((t) => t.key === focusedTab) ?? null : null;
  const focusedEvents = focusedTab ? (displayByTab[focusedTab] || []) : [];
  const focusedColor = focusedTab ? (TAB_COLORS[focusedTab] || TAB_COLORS.hitting) : null;

  /* Modular (super-set block) positions. Coaches read their draft; athletes
     and parents read the saved rows. */
  const drillById = useMemo(() => new Map(allDrills.map((d) => [d.id, d])), [allDrills]);
  const rowBlockView = (rows: ScheduledDrill[]): BlockViewDrill[][] =>
    groupBlocks(rows).map((block) => block.map((ev) => ({
      key: ev.id, name: ev.name, movement: isMovementSection(ev.category), drill: ev.drill,
      env: envSummary(parseEnv(ev.environment), ev.tab),
      goal: envSummary(parseEnv(ev.environment), ev.tab, true),
    })));
  const focusedModular = !!focusedTab && (isCoach ? !!blockDraft[focusedTab] : isModularRows(focusedEvents));
  /* A position only offers templates of its own kind: block templates while
     Modular, section templates while Structured. */
  const templatesFor = (tabKey: string) =>
    (templatesByTab[tabKey] || []).filter((t) => isModularTemplate(t) === !!blockDraft[tabKey]);
  /* Drills in the position's plan as drawn (draft included) -- what +Temp saves. */
  const planSize = (tabKey: string) => (blockDraft[tabKey]
    ? blockDraft[tabKey].reduce((n, b) => n + b.length, 0)
    : (displayByTab[tabKey] || []).length);
  const focusedCount = isCoach && focusedModular && focusedTab
    ? (blockDraft[focusedTab] || []).reduce((n, b) => n + b.length, 0)
    : focusedEvents.length;

  /* Athletes only see areas that actually have a drill — an empty category
   * renders no column for them.
   *
   * Coaches get a column for EVERY area the athlete's profile qualifies for,
   * empty or not, because the column is now the editing surface: an empty
   * Outfield column is where you go to add the athlete's first outfield
   * drill. visibleTabsForPlayer() is what decides that list, so a C/INF gets
   * Catching + Infield and a pitcher-only athlete never sees Hitting. */
  /* Athletes / parents: every area that has drills that day. Coaches: the
     athlete's areas, plus any other area that already has drills that day
     so nothing scheduled is ever hidden by an area being switched off. */
  const populatedTabs = TABS.filter((t) => (displayByTab[t.key] || []).length > 0);
  const columnTabs = isCoach
    ? TABS.filter((t) => visibleTabs.some((v) => v.key === t.key) || populatedTabs.some((p) => p.key === t.key))
    : populatedTabs;

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
    /* The athlete bubble stack sits straight on the canvas like the
       Education hub tiles, so it drops the Day view's own panel. */
    <div className={!isCoach && !focusedTabMeta && columnTabs.length > 0 ? styles.workoutStackWrap : `${styles.dayView} ${theme.inner}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={calReorderCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragLabel(null)}
      >
      {/* Action row — only in the single-area (focused) view, where it holds
          ← All areas / templates / Copy / +Temp / Paste. The date + drill-count
          line was removed: the date already sits in the calendar controls. */}
      {focusedTabMeta && (
      <div className={styles.dayViewHeader} style={{ justifyContent: 'flex-start' }}>
        <div className={styles.dayActions}>
          {focusedTabMeta && (
            <button
              className={`${styles.dayActionBtn} ${theme.field}`}
              onClick={() => setFocusedTab(null)}
              title="Back to the full day across every area"
            >
              {isCoach ? '← All areas' : '← All workouts'}
            </button>
          )}
          {/* Applying a template is per column now — see the Template picker
              in each column header. In the focused single-area view it sits
              beside Copy below. */}
          {/* Structured (a picker per section) ⇄ Modular (super-set blocks).
              The label names the mode this position is in now. */}
          {isCoach && focusedTabMeta && (
            <button
              type="button"
              className={`${styles.dayActionBtn} ${theme.field} ${focusedModular ? styles.modeBtnModular : ''}`}
              style={{ '--move-bg': TAB_MODULAR_DARK[focusedTabMeta.key] } as React.CSSProperties}
              onClick={() => onSetModular(focusedTabMeta.key, !focusedModular)}
              title={focusedModular
                ? 'Modular: drills grouped into super sets. Click for Structured.'
                : 'Structured: one picker per section. Click for Modular super sets.'}
              aria-pressed={focusedModular}
            >
              {focusedModular ? 'Modular' : 'Structured'}
            </button>
          )}
          {isCoach && focusedTabMeta && (
            <TemplateMultiSelect
              templates={templatesFor(focusedTabMeta.key)}
              selectedIds={selectedTemplateIds}
              onToggle={onToggleTemplate}
              onDelete={onDeleteTemplate}
              color={(TAB_COLORS[focusedTabMeta.key] || TAB_COLORS.hitting).text}
              className={`${styles.dayActionBtn} ${theme.field}`}
            />
          )}
          {/* While focused on a single tab the coach can still copy
              just THAT tab's drills via this button (mirrors the
              column-header Copy in the multi-column view). Hidden
              when the focused tab has no drills to copy. */}
          {isCoach && focusedTabMeta && focusedEvents.length > 0 && (
            <button
              className={`${styles.dayActionBtn} ${theme.field}`}
              onClick={() => onCopyTab(focusedTabMeta.key)}
              title={`Copy ${focusedTabMeta.label} drills only`}
            >
              Copy {focusedTabMeta.label}
            </button>
          )}
          {/* Save the focused sport's day as a named reusable template. */}
          {isCoach && focusedTabMeta && planSize(focusedTabMeta.key) > 0 && (
            <button
              className={`${styles.dayActionBtn} ${theme.field}`}
              onClick={() => onSaveTemplate(focusedTabMeta.key, buildTemplateItems(focusedTabMeta.key))}
              title={`Save this ${focusedTabMeta.label} day as a reusable template`}
            >
              +Temp
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
      )}

      {focusedTabMeta && focusedColor ? (
        /* ── Focused single-tab view ──
         * Same drill cards as the multi-column grid, but larger and
         * stacked single-column so the area's plan reads like a list
         * instead of being squeezed into a 1/6th-width column. Cards
         * keep the click → DrillVideoModal behavior. */
        <div
          className={styles.dayFocus}
          /* --tab-c drives --tab-ink (darker in light theme) for the card titles. */
          style={{ borderTop: `3px solid ${focusedColor.text}`, '--tab-c': focusedColor.text, '--move-bg': TAB_MODULAR_DARK[focusedTabMeta.key] } as React.CSSProperties}
        >
          <div
            className={styles.dayFocusHeader}
            style={{ background: focusedColor.bg }}
          >
            <span className={styles.dayFocusTitle} style={{ color: 'var(--tab-ink)' }}>
              {focusedTabMeta.label}
            </span>
            <span className={styles.dayFocusCount}>
              {focusedCount} drill{focusedCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.dayFocusBody}>
            {isCoach && focusedModular ? (
              <ModularBuilder
                tabKey={focusedTabMeta.key}
                blocks={blockDraft[focusedTabMeta.key] || []}
                onChange={(fn) => onUpdateBlocks(focusedTabMeta.key, fn)}
                drillsByDd={drillsByTabDd[focusedTabMeta.key] || {}}
                drillById={drillById}
                onDrillClick={onDrillClick}
              />
            ) : !isCoach && focusedModular ? (
              <BlockList tab={focusedTab!} blocks={rowBlockView(focusedEvents)} onDrillClick={onDrillClick} />
            ) : isCoach ? (
              /* ── Coach: this position's workout builder ──
                 The same picker-led editor as the day columns, given the full
                 width: one card per section (picker + the drills in it), laid
                 out in a grid. Ticking only changes the draft; Save in the
                 calendar controls publishes the day. */
              (() => {
                const { byDd, orphans } = splitBySection(focusedTabMeta.key);
                return (
                  <div className={styles.focusBuilder}>
                    {(MODAL_DROPDOWNS[focusedTabMeta.key] || []).map(dd => {
                      const rows = byDd.get(dd.key) || [];
                      return (
                        <div key={dd.key} className={styles.focusBuilderSection}>
                          <MultiSelectDropdown
                            label={dd.label}
                            drills={drillsByTabDd[focusedTabMeta.key]?.[dd.key] || []}
                            selected={draftSel[dd.key] || EMPTY_SET}
                            onToggle={(id) => onToggleDd(dd.key, id)}
                            color="var(--tab-ink)"
                            compact
                          />
                          {rows.length > 0 ? (
                            <div className={styles.dayFocusCardList}>
                              <SortableContext
                                items={rows.filter((ev) => !isPendingRow(ev.id)).map((ev) => ev.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                {rows.map((ev) => isPendingRow(ev.id) ? (
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
                                    category={ev.category}
                                    disabled={false}
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
                          ) : (
                            <div className={styles.focusBuilderEmpty}>No drills yet</div>
                          )}
                        </div>
                      );
                    })}
                    {/* Rows no picker can represent stay visible + removable. */}
                    {groupByCategory(orphans, focusedTabMeta.key).map(([category, items]) => (
                      <div key={`orphan-${category}`} className={styles.focusBuilderSection}>
                        <span className={styles.dayColFieldLabel}>{category}</span>
                        <div className={styles.dayFocusCardList}>
                          {items.map((ev) => (
                            <div
                              key={ev.id}
                              className={`${styles.dayFocusCardItem} ${ev.drill ? styles.dayColCardClickable : ''}`}
                              onClick={ev.drill ? () => onDrillClick(ev.drill!) : undefined}
                            >
                              <span className={styles.dayFocusCardItemName}>{ev.name}</span>
                              <button
                                className={styles.dayEventDelete}
                                onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }}
                                title="Delete"
                              >×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : focusedEvents.length === 0 ? (
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
      ) : !isCoach ? (
        /* ── Athletes + parents: one Education-style bubble per workout,
           stacked. Tapping one opens that workout (the focused view above). */
        <div className={styles.workoutStack}>
          {columnTabs.map((tab, i) => {
            const tabEvents = displayByTab[tab.key] || [];
            const blockCount = isModularRows(tabEvents) ? groupBlocks(tabEvents).length : 0;
            const cats = blockCount
              ? [`${blockCount} super set${blockCount !== 1 ? 's' : ''}`]
              : groupByCategory(tabEvents, tab.key).map(([c]) => c);
            return (
              <button
                key={tab.key}
                type="button"
                className={`${eduStyles.tile} ${styles.workoutTile} ${theme.inner}`}
                style={{ '--tile-rgb': hexToRgb((TAB_COLORS[tab.key] || TAB_COLORS.hitting).text) } as React.CSSProperties}
                onClick={() => setFocusedTab(tab.key)}
                aria-label={`${tab.label}: ${tabEvents.length} drill${tabEvents.length !== 1 ? 's' : ''}`}
              >
                <span className={eduStyles.tileRule} aria-hidden="true" />
                <span className={`${eduStyles.tileWatermark} ${styles.workoutWatermark}`} aria-hidden="true">{WORKOUT_ICONS[tab.key]}</span>
                <span className={eduStyles.tileIcon} aria-hidden="true">{WORKOUT_ICONS[tab.key]}</span>
                <span className={`${eduStyles.tileBody} ${styles.workoutBody}`}>
                  <span className={eduStyles.tileEyebrow}>Workout {String(i + 1).padStart(2, '0')}</span>
                  <span className={`${eduStyles.tileTitle} ${styles.workoutTitle}`}>{tab.label}</span>
                  {cats.length > 0 && <span className={eduStyles.tileDesc}>{cats.join(' · ')}</span>}
                </span>
                <span className={styles.workoutFoot}>
                  <span className={eduStyles.tileStat}>
                    <span className={eduStyles.tileStatNum}>{tabEvents.length}</span>
                    <span className={eduStyles.tileStatLabel}>{tabEvents.length === 1 ? 'drill' : 'drills'}</span>
                  </span>
                  <span className={eduStyles.tileGo} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                  </span>
                </span>
              </button>
            );
          })}
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
              /* --tab-c = this column's sport colour; CSS derives --tab-ink (a darker
                 version in light theme) for the header, chips and section labels. */
              <div key={tab.key} className={styles.dayCol} style={{ '--tab-c': tabColor.text, '--move-bg': TAB_MODULAR_DARK[tab.key] } as React.CSSProperties}>
                {/* Column header — `<div>` wrapper instead of a single
                    `<button>` so the focus-tab click and the per-tab
                    Copy click can each be their own buttons (nested
                    `<button>` would be invalid HTML). The CSS
                    `.dayColHeader` styles still apply because the
                    selector matches class only, not element type. */}
                <div
                  className={styles.dayColHeader}
                  style={{ borderBottomColor: 'var(--tab-ink)', cursor: 'default' }}
                >
                  <button
                    type="button"
                    onClick={() => setFocusedTab(tab.key)}
                    title={isCoach ? `Build the ${tab.label} workout` : `Open ${tab.label}`}
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
                    <span className={styles.dayColTitle} style={{ color: 'var(--tab-ink)' }}>{tab.label}</span>
                    {tabEvents.length > 0 && (
                      <span className={styles.dayColCount} style={{ background: tabColor.bg, color: 'var(--tab-ink)' }}>
                        {tabEvents.length}
                      </span>
                    )}
                  </button>
                  {/* Column actions: Template (apply saved plans for THIS
                      sport) · +Temp (save what is in this column as a new
                      one) · Copy. They sit on their own row so a narrow
                      column keeps the sport name readable. */}
                  {isCoach && (
                    <div className={styles.dayColActions}>
                      {/* Structured ⇄ Modular for this column -- the same
                          switch as the single-position builder's. */}
                      <button
                        type="button"
                        className={`${styles.colChip} ${blockDraft[tab.key] ? styles.colChipModular : ''}`}
                        onClick={(e) => { e.stopPropagation(); onSetModular(tab.key, !blockDraft[tab.key]); }}
                        title={blockDraft[tab.key]
                          ? `${tab.label} is Modular (super sets). Click for Structured.`
                          : `${tab.label} is Structured (a picker per section). Click for Modular super sets.`}
                        aria-pressed={!!blockDraft[tab.key]}
                        style={blockDraft[tab.key] ? undefined : { borderColor: 'var(--tab-ink)', color: 'var(--tab-ink)' }}
                      >
                        {blockDraft[tab.key] ? 'Modular' : 'Structured'}
                      </button>
                      <TemplateMultiSelect
                        templates={templatesFor(tab.key)}
                        selectedIds={selectedTemplateIds}
                        onToggle={onToggleTemplate}
                        onDelete={onDeleteTemplate}
                        color="var(--tab-ink)"
                        spanColumn
                      />
                      <button
                        type="button"
                        className={styles.colChip}
                        disabled={planSize(tab.key) === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (planSize(tab.key) > 0) onSaveTemplate(tab.key, buildTemplateItems(tab.key));
                        }}
                        title={planSize(tab.key) > 0
                          ? `Save this ${tab.label} column as a reusable template`
                          : `Nothing in ${tab.label} to save as a template`}
                        style={{ borderColor: 'var(--tab-ink)', color: 'var(--tab-ink)' }}
                      >
                        +Temp
                      </button>
                      <button
                        type="button"
                        className={styles.colChip}
                        disabled={tabEvents.length === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (tabEvents.length > 0) onCopyTab(tab.key);
                        }}
                        title={tabEvents.length > 0
                          ? `Copy ${tab.label} drills only`
                          : `No ${tab.label} drills to copy`}
                        style={{
                          borderColor: 'var(--tab-ink)',
                          color: 'var(--tab-ink)',
                          background: tabEvents.length > 0 ? tabColor.bg : undefined,
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.dayColBody}>
                  {/* ── In-column editor ──
                      One picker per drill category, each followed immediately
                      by the drills currently in that section. The picker's own
                      label names the section, so the drills need no second
                      heading. Ticking only changes the local draft; Save (in
                      the calendar controls) is what publishes the day.

                      Section-level drag is deliberately absent here: a
                      section's position is now its picker's position, which
                      follows the drill taxonomy. Drills still reorder within
                      their own section (also in the single-position builder). */}
                  {/* Modular column: sets instead of the section pickers. */}
                  {isCoach && blockDraft[tab.key] && (
                    <ColumnModularEditor
                      tabKey={tab.key}
                      label={tab.label}
                      blocks={blockDraft[tab.key]}
                      onChange={(fn) => onUpdateBlocks(tab.key, fn)}
                      drillsByDd={drillsByTabDd[tab.key] || {}}
                      drillById={drillById}
                      onDrillClick={onDrillClick}
                    />
                  )}
                  {isCoach && !blockDraft[tab.key] && (() => {
                    const { byDd, orphans } = splitBySection(tab.key);
                    return (
                      <>
                        {(MODAL_DROPDOWNS[tab.key] || []).map(dd => {
                          const rows = byDd.get(dd.key) || [];
                          return (
                            <div key={dd.key} className={styles.dayColSection}>
                              <MultiSelectDropdown
                                label={dd.label}
                                drills={drillsByTabDd[tab.key]?.[dd.key] || []}
                                selected={draftSel[dd.key] || EMPTY_SET}
                                onToggle={(id) => onToggleDd(dd.key, id)}
                                /* One colour per column (the darker sport colour),
                                   not a different shade per section. */
                                color="var(--tab-ink)"
                                compact
                              />
                              {rows.length > 0 && (
                                <div
                                  className={styles.dayColSectionList}
                                  style={{ borderLeftColor: 'var(--tab-ink)' }}
                                >
                                  <SortableContext
                                    items={rows.filter((ev) => !isPendingRow(ev.id)).map((ev) => ev.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    {rows.map((ev) => isPendingRow(ev.id) ? (
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
                                        /* The STORED category, so drag-reorder keeps
                                           matching the same rows it always did. */
                                        category={ev.category}
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
                              )}
                            </div>
                          );
                        })}

                        {/* Rows no picker can represent still have to be
                            visible and removable, so they keep the old
                            labelled-card treatment below the pickers. */}
                        {groupByCategory(orphans, tab.key).map(([category, items]) => {
                          const catStyle = getTabCatStyle(tab.key, category);
                          return (
                            <div key={`orphan-${category}`} className={styles.dayColCard} style={catStyle.bgStyle}>
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
                                    <button
                                      className={styles.dayEventDelete}
                                      onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }}
                                      title="Delete"
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                  {tabEvents.length === 0 && !isCoach && (
                    <div className={styles.dayColEmpty}>—</div>
                  )}
                  {/* Athlete view: drills grouped into one labelled bubble per
                      category. Coaches get the picker-led layout above instead,
                      where each section hangs off its own dropdown. */}
                  {!isCoach && (
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
                  )}
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
   Template Multi-Select — a column's "Template" button
   Lists ONLY that sport's saved templates. Ticking one merges its drills
   into the column's draft exactly as if the coach had picked them by hand;
   unticking removes precisely what that template contributed. Nothing here
   touches the athlete — the day-level Save publishes.
   ══════════════════════════════════════════════════════════════════ */

function TemplateMultiSelect({
  templates, selectedIds, onToggle, onDelete, color, className, spanColumn = false,
}: {
  templates: api.ScheduleTemplate[];
  /** Presence of a template's id marks it applied. */
  selectedIds: Record<string, unknown>;
  onToggle: (t: api.ScheduleTemplate) => void;
  /** Delete a saved template (asks first, inline). */
  onDelete: (t: api.ScheduleTemplate) => Promise<void>;
  color: string;
  /** Lets the focused view borrow the day-action button chrome. */
  className?: string;
  /** In a day column: the list drops from the column header and spans the
   *  column's full width instead of hanging off the small Template chip. */
  spanColumn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<api.ScheduleTemplate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Closing the list also backs out of a half-finished delete. */
  useEffect(() => { if (!open) { setConfirmId(null); setDeleteError(''); } }, [open]);

  const remove = async (t: api.ScheduleTemplate) => {
    setDeletingId(t.id);
    setDeleteError('');
    try {
      await onDelete(t);
      setConfirmId(null);
    } catch (e: any) {
      setDeleteError(e?.message || 'Could not delete that template.');
    } finally {
      setDeletingId(null);
    }
  };

  useDismiss(open, wrapRef, setOpen);

  const applied = templates.filter(t => Object.prototype.hasOwnProperty.call(selectedIds, t.id));

  return (
    <div className={`${styles.tplWrap} ${spanColumn ? styles.tplWrapSpan : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={className ?? styles.colChip}
        style={{ borderColor: color, color }}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title={templates.length
          ? 'Apply saved templates to this area'
          : 'No templates saved for this area yet'}
      >
        Template{applied.length > 0 ? ` (${applied.length})` : ''}
      </button>

      {open && (
        <div className={`${styles.tplPanel} ${spanColumn ? styles.tplPanelSpan : ''}`} onClick={(e) => e.stopPropagation()}>
          {templates.length === 0 ? (
            <div className={styles.tplEmpty}>
              No templates for this area yet. Build a day, then press “+Temp”.
            </div>
          ) : (
            templates.map(t => {
              const on = Object.prototype.hasOwnProperty.call(selectedIds, t.id);
              if (confirmId === t.id) {
                return (
                  <div key={t.id} className={`${styles.tplItem} ${styles.tplConfirm}`}>
                    <span className={styles.tplName} title={t.name}>Delete “{t.name}”?</span>
                    <span className={styles.tplConfirmBtns}>
                      <button type="button" className={styles.tplYes} disabled={deletingId === t.id} onClick={() => void remove(t)}>
                        {deletingId === t.id ? '…' : 'Yes'}
                      </button>
                      <button type="button" className={styles.tplNo} onClick={() => setConfirmId(null)}>No</button>
                    </span>
                  </div>
                );
              }
              return (
                <div key={t.id} className={`${styles.tplItem} ${on ? styles.tplItemOn : ''}`}>
                  <label className={styles.tplPick}>
                    <input
                      type="checkbox"
                      className={styles.tplCheckbox}
                      checked={on}
                      onChange={() => onToggle(t)}
                    />
                    <span className={styles.tplName} title={t.name}>{t.name}</span>
                  </label>
                  <button
                    type="button"
                    className={styles.tplIconBtn}
                    onClick={() => setPreview(t)}
                    title={`Preview ${t.name}`}
                    aria-label={`Preview ${t.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
                      <circle cx="8" cy="8" r="2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`${styles.tplIconBtn} ${styles.tplDel}`}
                    onClick={() => { setDeleteError(''); setConfirmId(t.id); }}
                    title={`Delete ${t.name}`}
                    aria-label={`Delete ${t.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
          {deleteError && <div className={styles.tplError} role="alert">{deleteError}</div>}
        </div>
      )}
      <TemplatePreviewModal template={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Modular workouts — super-set blocks
   ══════════════════════════════════════════════════════════════════ */

/** One drill as a block shows it. */
type BlockViewDrill = { key: string; name: string; movement: boolean; drill: Drill | null; env?: string; goal?: string };

/** A drill in a block, coloured by the picker it came from: Movement (dark
 *  blue, white type) or Drills (white, black type). */
function BlockDrillPill({ name, movement, index, onClick, onRemove, children }: {
  name: string;
  movement: boolean;
  index: number;
  onClick?: () => void;
  onRemove?: () => void;
  /** Coach view: the environment pickers, between the name and remove. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`${styles.blockDrill} ${movement ? styles.blockDrillMove : styles.blockDrillWork} ${onClick ? styles.blockDrillClickable : ''}`}
      onClick={onClick}
    >
      <span className={styles.blockDrillNum}>{index + 1}</span>
      <span className={styles.blockDrillName}>{name}</span>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.blockDrillRemove}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from set"
          aria-label={`Remove ${name}`}
        >×</button>
      )}
    </div>
  );
}

/**
 * The athlete / parent workout: sets top to bottom, each a small table --
 * Drill | Environment (Feed Type, Implement, Situation) | Goal, or for
 * Pitching Drill | Reps & Tool | Intensity / Goal -- with each drill row in
 * its Movement / Drills colour. Tapping a row plays the drill.
 */
function BlockList({ tab, blocks, onDrillClick }: {
  tab: string;
  blocks: BlockViewDrill[][];
  onDrillClick: (drill: Drill) => void;
}) {
  if (blocks.length === 0) {
    return <div className={styles.focusBuilderEmpty}>No sets yet</div>;
  }
  const cols = drillOptionColumns(tab);
  return (
    <div className={styles.blockStack}>
      {blocks.map((block, bi) => (
        <div key={bi} className={styles.blockCard}>
          <div className={styles.blockCardHead}>
            <span className={styles.blockCardTitle}>Set {bi + 1}</span>
            <span className={styles.blockCardCount}>{block.length} drill{block.length !== 1 ? 's' : ''}</span>
          </div>
          <div className={styles.blockTable} role="table" aria-label={`Set ${bi + 1}`}>
            <div className={styles.blockTableHead} role="row">
              <span role="columnheader">Drill</span>
              <span role="columnheader">{cols.env}</span>
              <span role="columnheader">{cols.goal}</span>
            </div>
            {block.map((d, i) => (
              <div
                key={d.key}
                role="row"
                className={`${styles.blockDrill} ${styles.blockTableRow} ${d.movement ? styles.blockDrillMove : styles.blockDrillWork} ${d.drill ? styles.blockDrillClickable : ''}`}
                onClick={d.drill ? () => onDrillClick(d.drill!) : undefined}
              >
                <span className={styles.blockTableName} role="cell">
                  <span className={styles.blockDrillNum}>{i + 1}</span>
                  <span className={styles.blockDrillName}>{d.name}</span>
                </span>
                <span className={`${styles.blockTableCell} ${d.env ? '' : styles.blockTableNone}`} role="cell">{d.env || '—'}</span>
                <span className={`${styles.blockTableCell} ${d.goal ? '' : styles.blockTableNone}`} role="cell">{d.goal || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Shared set editing for both Modular editors: each picker's drill list (and
 * the section each drill belongs to -- the row is saved under that section,
 * which is also what sets its colour), plus tick / untick into one set.
 */
function useSetEditing(
  tabKey: string,
  onChange: (fn: (blocks: BlockItem[][]) => BlockItem[][]) => void,
  drillsByDd: Record<string, Drill[]>,
) {
  const pickers = useMemo(() => {
    const { movement, drills } = modularPickerDds(tabKey);
    const build = (dds: ModalDropdown[]) => {
      const list: Drill[] = [];
      const ddOf = new Map<string, string>();
      for (const dd of dds) {
        for (const d of drillsByDd[dd.key] || []) {
          if (ddOf.has(d.id)) continue;
          ddOf.set(d.id, dd.key);
          /* A picker spanning several sections (Movement Prep + Vision)
             names each drill's section too. */
          list.push(dds.length > 1 ? { ...d, name: `${d.name} · ${dd.label}` } : d);
        }
      }
      return { list, ddOf, keys: new Set(dds.map((d) => d.key)) };
    };
    return { movement: build(movement), drills: build(drills) };
  }, [tabKey, drillsByDd]);

  const editBlock = (bi: number, fn: (block: BlockItem[]) => BlockItem[]) =>
    onChange((bs) => bs.map((b, j) => (j === bi ? fn(b) : b)));

  const selectedIn = (block: BlockItem[], group: 'movement' | 'drills') =>
    new Set(block.filter((it) => pickers[group].ddOf.get(it.drillId) === it.ddKey).map((it) => it.drillId));

  /* Ticking adds the drill to the end of the set (until it is full);
     unticking takes it out. */
  const toggleIn = (bi: number, group: 'movement' | 'drills') => (id: string) => editBlock(bi, (b) => {
    const ddKey = pickers[group].ddOf.get(id);
    if (!ddKey) return b;
    const at = b.findIndex((it) => it.drillId === id && it.ddKey === ddKey);
    if (at >= 0) return b.filter((_, k) => k !== at);
    if (b.length >= MAX_BLOCK_DRILLS) return b;
    /* Drop-downs with a starting pick get it (Pitching: 6 reps). */
    const env: DrillEnv = {};
    for (const f of drillOptionFields(tabKey)) if (f.defaultPick) env[f.key] = [f.defaultPick];
    return [...b, { drillId: id, ddKey, ...(Object.keys(env).length ? { env } : {}) }];
  });

  /* The Movement (dark blue) + Drills pickers for one set. */
  const pickerPair = (bi: number, block: BlockItem[]) => (
    <div className={styles.blockPickers}>
      <div className={styles.blockPickerMove}>
        <MultiSelectDropdown
          label="Movement"
          drills={pickers.movement.list}
          selected={selectedIn(block, 'movement')}
          onToggle={toggleIn(bi, 'movement')}
          color="var(--move-bg, #1e3a8a)"
          compact
        />
      </div>
      <div className={styles.blockPickerWork}>
        <MultiSelectDropdown
          label="Drills"
          drills={pickers.drills.list}
          selected={selectedIn(block, 'drills')}
          onToggle={toggleIn(bi, 'drills')}
          color="var(--text)"
          compact
        />
      </div>
      {block.length >= MAX_BLOCK_DRILLS && <div className={styles.blockFull}>Set full ({MAX_BLOCK_DRILLS} drills)</div>}
    </div>
  );

  /* Replace one environment field (Feed Type / Implement / Situation) on
     one drill of one set. */
  const setEnv = (bi: number, i: number, field: EnvField, values: string[]) => editBlock(bi, (b) =>
    b.map((it, k) => (k === i ? { ...it, env: { ...it.env, [field]: values } } : it)));

  return { pickers, editBlock, pickerPair, setEnv };
}

/** A set's drills as editable pills (click = demo video, × = remove). */
function SetDrills({ tabKey, block, bi, isMovementKey, drillById, onDrillClick, editBlock, onEnv }: {
  tabKey: string;
  block: BlockItem[];
  bi: number;
  isMovementKey: (ddKey: string) => boolean;
  drillById: Map<string, Drill>;
  onDrillClick: (drill: Drill) => void;
  editBlock: (bi: number, fn: (block: BlockItem[]) => BlockItem[]) => void;
  /** Given: each drill gets the position's drop-downs (Feed Type …, Reps …). */
  onEnv?: (i: number, field: EnvField, values: string[]) => void;
}) {
  const fields = drillOptionFields(tabKey);
  const lists = useDrillOptionLists(!!onEnv);
  return (
    <div className={styles.blockDrills}>
      {block.length === 0 && <div className={styles.focusBuilderEmpty}>No drills yet</div>}
      {block.map((it, i) => {
        const drill = drillById.get(it.drillId);
        return (
          <BlockDrillPill
            key={`${it.ddKey}:${it.drillId}`}
            name={drill?.name || 'Drill'}
            movement={isMovementKey(it.ddKey)}
            index={i}
            onClick={drill ? () => onDrillClick(drill) : undefined}
            onRemove={() => editBlock(bi, (b) => b.filter((_, k) => k !== i))}
          >
            {onEnv && (
              <span
                className={styles.envPickers}
                style={{ '--env-cols': fields.length } as React.CSSProperties}
                onClick={(e) => e.stopPropagation()}
              >
                {fields.map((f) => (
                  <EnvSelect
                    key={f.key}
                    label={f.label}
                    options={optionsFor(lists, tabKey, f)}
                    single={f.single}
                    suffix={f.suffix}
                    selected={it.env?.[f.key] || []}
                    onChange={(values) => onEnv(i, f.key, values)}
                  />
                ))}
              </span>
            )}
          </BlockDrillPill>
        );
      })}
    </div>
  );
}

/**
 * One environment picker on a drill: a small chip showing the field's picks
 * (or its name when empty) that opens a searchable list -- multi-select, or
 * one pick that closes the list (Reps).
 */
function EnvSelect({ label, options: listed, selected, onChange, single = false, suffix = '' }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  /** Appended to picks on the chip ("6" → "6 reps"). */
  suffix?: string;
}) {
  /* A pick since removed from the list (Settings → Drills) stays listed so
     it can still be unticked. */
  const options = useMemo(() => [...listed, ...selected.filter((s) => !listed.includes(s))], [listed, selected]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelPos = useFixedPanel(open, triggerRef, 220);

  useDismiss(open, wrapRef, setOpen);
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const q = search.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  /* Keep the picks in the list's own order, whatever order they were ticked.
     Single: the pick replaces the last one and the list closes. */
  const toggle = (o: string) => {
    if (single) {
      onChange(selected.includes(o) ? [] : [o]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : options.filter((x) => x === o || selected.includes(x)));
  };
  const shownPicks = selected.map((s) => `${s}${suffix}`).join(', ');

  return (
    <span className={styles.envWrap} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.envChip} ${selected.length ? styles.envChipOn : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={selected.length ? `${label}: ${shownPicks}` : `Pick ${label}`}
        aria-expanded={open}
      >
        <span className={styles.envChipText}>{selected.length ? shownPicks : label}</span>
        <span className={styles.envChipCaret}>▾</span>
      </button>
      {open && (
        <div className={styles.multiPanel} style={panelPos ?? { visibility: 'hidden' }} role="listbox" aria-label={label} aria-multiselectable={!single}>
          <div className={styles.envPanelHead}>{label}</div>
          <div className={styles.multiSearch}>
            <input
              type="text"
              className={styles.multiSearchInput}
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus={typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches}
              style={typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? { fontSize: '12pt' } : undefined}
            />
          </div>
          <div className={styles.multiList}>
            {shown.length === 0 && (
              <div className={styles.multiEmpty}>
                {options.length ? 'No matches' : `No ${label} options yet. Add them in Settings → Drills.`}
              </div>
            )}
            {shown.map((o) => {
              const on = selected.includes(o);
              return (
                <label key={o} className={`${styles.multiItem} ${on ? styles.multiItemSelected : ''}`}>
                  <input type={single ? 'radio' : 'checkbox'} checked={on} onChange={() => toggle(o)} onClick={single && on ? () => toggle(o) : undefined} className={styles.multiCheckbox} />
                  <span className={styles.multiItemName}>{o}{suffix}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

/** A set's title row: "Set N", count, remove. */
function SetHead({ bi, count, onRemove }: { bi: number; count: number; onRemove: () => void }) {
  return (
    <div className={styles.blockCardHead}>
      <span className={styles.blockCardTitle}>Set {bi + 1}</span>
      <span className={styles.blockCardCount}>{count} / {MAX_BLOCK_DRILLS}</span>
      <button
        type="button"
        className={styles.blockRemove}
        onClick={onRemove}
        title="Remove this set"
        aria-label={`Remove set ${bi + 1}`}
      >×</button>
    </div>
  );
}

/**
 * Coach editor for a Modular position. Sets stack down the left, each with
 * its own "Adding to Set N" picker beside it on the right (stacked under it
 * on phones); + Add Set makes a new set. Two pickers -- Movement
 * (Movement Prep + Vision) and Drills (the position's other sections) -- so
 * dry and live work can be super-setted. Up to 8 drills a set, any number
 * of sets. Changes stay in the draft until the calendar's Save.
 */
function ModularBuilder({ tabKey, blocks, onChange, drillsByDd, drillById, onDrillClick }: {
  tabKey: string;
  blocks: BlockItem[][];
  onChange: (fn: (blocks: BlockItem[][]) => BlockItem[][]) => void;
  drillsByDd: Record<string, Drill[]>;
  drillById: Map<string, Drill>;
  onDrillClick: (drill: Drill) => void;
}) {
  const { pickers, editBlock, pickerPair, setEnv } = useSetEditing(tabKey, onChange, drillsByDd);
  const isMovementKey = (k: string) => pickers.movement.keys.has(k);

  return (
    <div className={styles.modularBlocks}>
      {blocks.length === 0 && (
        <div className={styles.focusBuilderEmpty}>No sets yet. Add a set to start building super sets.</div>
      )}
      {/* One row per set: the set (60%) beside its own picker (40%),
          which only ever adds to that set. Phones stack the two. */}
      {blocks.map((block, bi) => (
        <div key={bi} className={styles.modularRow}>
          <div className={styles.blockCard}>
            <SetHead bi={bi} count={block.length} onRemove={() => onChange((bs) => bs.filter((_, j) => j !== bi))} />
            <SetDrills
              tabKey={tabKey}
              block={block}
              bi={bi}
              isMovementKey={isMovementKey}
              drillById={drillById}
              onDrillClick={onDrillClick}
              editBlock={editBlock}
              onEnv={(i, field, values) => setEnv(bi, i, field, values)}
            />
          </div>
          <div className={styles.modularPicker}>
            <div className={styles.modularPickerHead}>
              <span className={styles.blockCardTitle}>Adding to Set {bi + 1}</span>
              <span className={styles.blockCardCount}>{block.length} / {MAX_BLOCK_DRILLS}</span>
            </div>
            {pickerPair(bi, block)}
          </div>
        </div>
      ))}
      <button type="button" className={styles.addSetBtn} onClick={() => onChange((bs) => [...bs, []])}>+ Add Set</button>
    </div>
  );
}

/** Window event a column fires when it opens its set bubble (detail = tab). */
const COL_BUBBLE_EVENT = 'training:col-set-bubble';

/**
 * The same Modular editor shrunk into a day column. Each set has one
 * "Add drills" button; it opens a side bubble beside the column holding the
 * Movement + Drills pickers. The bubble stays open while you work on that
 * set and moves when you open another set (or add one); × closes it.
 */
function ColumnModularEditor({ tabKey, label, blocks, onChange, drillsByDd, drillById, onDrillClick }: {
  tabKey: string;
  label: string;
  blocks: BlockItem[][];
  onChange: (fn: (blocks: BlockItem[][]) => BlockItem[][]) => void;
  drillsByDd: Record<string, Drill[]>;
  drillById: Map<string, Drill>;
  onDrillClick: (drill: Drill) => void;
}) {
  const { pickers, editBlock, pickerPair, setEnv } = useSetEditing(tabKey, onChange, drillsByDd);
  const isMovementKey = (k: string) => pickers.movement.keys.has(k);

  /* The set whose bubble is open, and the button it hangs off. */
  const [openSet, setOpenSet] = useState<number | null>(null);
  const anchors = useRef<Record<number, HTMLButtonElement | null>>({});
  const [bubblePos, setBubblePos] = useState<React.CSSProperties | null>(null);

  /* A removed set takes its bubble with it. */
  useEffect(() => {
    if (openSet !== null && openSet >= blocks.length) setOpenSet(null);
  }, [openSet, blocks.length]);

  /* One bubble at a time across ALL columns: opening a set in another
     column closes this one (moving to a new set moves the bubble). */
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== tabKey) setOpenSet(null);
    };
    window.addEventListener(COL_BUBBLE_EVENT, onOther);
    return () => window.removeEventListener(COL_BUBBLE_EVENT, onOther);
  }, [tabKey]);
  const openBubble = (bi: number) => {
    setOpenSet(bi);
    window.dispatchEvent(new CustomEvent(COL_BUBBLE_EVENT, { detail: tabKey }));
  };

  /* Pinned to the screen beside the column (right side, or left when the
     column is near the right edge), following it on scroll. */
  useLayoutEffect(() => {
    if (openSet === null) { setBubblePos(null); return; }
    const place = () => {
      const r = anchors.current[openSet]?.getBoundingClientRect();
      if (!r) return;
      const col = anchors.current[openSet]?.closest(`.${styles.dayCol}`)?.getBoundingClientRect() || r;
      const vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(300, vw - 16);
      let left = col.right + 8;
      if (left + width > vw - 8) left = col.left - 8 - width;
      if (left < 8) left = Math.max(8, Math.min(vw - width - 8, r.left));
      const top = Math.max(8, Math.min(r.top - 8, vh - 260));
      setBubblePos({ position: 'fixed', left, top, width, zIndex: 250 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [openSet, blocks]);

  const open = openSet !== null ? blocks[openSet] : undefined;

  return (
    <div className={styles.colModular}>
      {blocks.length === 0 && <div className={styles.focusBuilderEmpty}>No sets yet</div>}
      {blocks.map((block, bi) => (
        <div key={bi} className={`${styles.blockCard} ${openSet === bi ? styles.colSetOpen : ''}`}>
          <SetHead bi={bi} count={block.length} onRemove={() => onChange((bs) => bs.filter((_, j) => j !== bi))} />
          {/* Same Feed Type / Implement / Situation / Goal pickers as the
              single-position builder -- most athletes only have two columns. */}
          <SetDrills
            tabKey={tabKey}
            block={block}
            bi={bi}
            isMovementKey={isMovementKey}
            drillById={drillById}
            onDrillClick={onDrillClick}
            editBlock={editBlock}
            onEnv={(i, field, values) => setEnv(bi, i, field, values)}
          />
          <button
            type="button"
            ref={(el) => { anchors.current[bi] = el; }}
            className={styles.colSetAdd}
            onClick={() => openBubble(bi)}
            aria-expanded={openSet === bi}
          >
            {openSet === bi ? 'Adding drills…' : 'Add drills ▸'}
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.colAddSet}
        onClick={() => { onChange((bs) => [...bs, []]); openBubble(blocks.length); }}
      >
        + Add Set
      </button>

      {openSet !== null && open && (
        <div className={styles.colSetBubble} style={bubblePos ?? { visibility: 'hidden' }} role="dialog" aria-label={`Add drills to ${label} set ${openSet + 1}`}>
          <div className={styles.modularPickerHead}>
            <span className={styles.blockCardTitle}>{label} · Set {openSet + 1}</span>
            <span className={styles.blockCardCount}>{open.length} / {MAX_BLOCK_DRILLS}</span>
            <button type="button" className={styles.blockRemove} onClick={() => setOpenSet(null)} title="Close" aria-label="Close">×</button>
          </div>
          {pickerPair(openSet, open)}
        </div>
      )}
    </div>
  );
}

/**
 * The coach's "Areas" button beside Month / Week / Day: a small menu to
 * switch Infield, Outfield, Catching and Physical workouts on or off for
 * the selected athlete (saved on the athlete, like the report tabs).
 */
function CalendarAreasMenu({ enabled, onToggle, className }: {
  enabled: string[];
  onToggle: (key: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(open, wrapRef, setOpen);
  const count = CALENDAR_EXTRA_AREAS.filter((a) => enabled.includes(a.key)).length;
  return (
    <div className={styles.areasWrap} ref={wrapRef}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Choose which extra workout areas this athlete has"
      >
        Areas{count ? ` (${count})` : ''} ▾
      </button>
      {open && (
        <div className={styles.areasPanel} role="group" aria-label="Workout areas">
          <div className={styles.areasHead}>Workout areas</div>
          <div className={styles.areasNote}>Hitting / Pitching follow the athlete&apos;s positions.</div>
          {CALENDAR_EXTRA_AREAS.map((a) => {
            const on = enabled.includes(a.key);
            return (
              <label key={a.key} className={`${styles.areasItem} ${on ? styles.areasItemOn : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(a.key)} />
                <span>{a.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Where an open dropdown list goes: pinned to the SCREEN beside its trigger
 * (position: fixed). Drawn inside the Day view it used to be clipped by the
 * view's overflow:hidden, so the last pickers' lists ran off the bottom
 * where no scroll could reach them. It opens downward when there is room,
 * upward when there is more room above, and is sized to the visible space
 * (above a phone's bottom bar). Follows the trigger on scroll. `minWidth`
 * widens a list hung off a small chip (kept on screen).
 */
function useFixedPanel(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, minWidth = 0) {
  const [panelPos, setPanelPos] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight, vw = window.innerWidth;
      /* The phone's bottom bar (the app shell's fixed sidebar, docked to the
         bottom beside <main>) shortens the space below. */
      let limit = vh;
      const shell = document.querySelector('main.app-main')?.parentElement;
      for (const el of Array.from(shell?.children || [])) {
        if (getComputedStyle(el).position !== 'fixed') continue;
        const top = el.getBoundingClientRect().top;
        if (top > vh / 2) limit = Math.min(limit, top);
      }
      const gap = 4, margin = 8, want = 260;
      const below = limit - r.bottom - gap - margin;
      const above = r.top - gap - margin;
      /* Flip up only when there's truly no room below: an upward list lands
         on whatever sits above the trigger -- for the lower of the Modular
         Movement / Drills pair, that's the Movement picker. */
      const up = below < 150 && above > below;
      const maxHeight = Math.max(120, Math.min(want, up ? above : below));
      const width = Math.min(Math.max(r.width, minWidth), vw - 2 * margin);
      const left = Math.max(margin, Math.min(r.left, vw - width - margin));
      setPanelPos({
        position: 'fixed',
        left,
        width,
        right: 'auto',
        maxHeight,
        zIndex: 300,
        ...(up ? { top: 'auto', bottom: vh - r.top + gap } : { top: r.bottom + gap, bottom: 'auto' }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, triggerRef, minWidth]);
  return panelPos;
}

/** Fired when a picker opens (detail = its id), so any other open one closes. */
const PICKER_OPEN_EVENT = 'training:picker-open';

/**
 * Closes an open dropdown on a tap / click outside it, or when another picker
 * opens. Listens for pointerdown, not mousedown: iPad Safari sends no mouse
 * events for a tap on a non-clickable spot, so a tap on blank space never
 * closed the list -- it stayed open over the picker beside it (Movement under
 * an upward Drills list), and taps meant for that picker hit the list.
 */
function useDismiss(open: boolean, wrapRef: React.RefObject<HTMLElement | null>, setOpen: (open: boolean) => void) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent(PICKER_OPEN_EVENT, { detail: id }));
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener(PICKER_OPEN_EVENT, onOther);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener(PICKER_OPEN_EVENT, onOther);
    };
  }, [open, id, wrapRef, setOpen]);
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
  const triggerRef = useRef<HTMLDivElement>(null);

  useDismiss(open, wrapRef, setOpen);
  const panelPos = useFixedPanel(open, triggerRef);

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
          ref={triggerRef}
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
          <div className={styles.multiPanel} style={panelPos ?? { visibility: 'hidden' }}>
            <div className={styles.multiSearch}>
              <input
                type="text"
                className={styles.multiSearchInput}
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                /* Cursor straight into Search on desktop only: on a phone it
                   would open the keyboard over the list every time the
                   dropdown opens. */
                autoFocus={typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches}
                /* 16px on touch screens (iOS zooms into smaller text fields). */
                style={typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? { fontSize: '12pt' } : undefined}
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
