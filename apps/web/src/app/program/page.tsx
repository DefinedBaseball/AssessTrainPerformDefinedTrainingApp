'use client';

/* ─────────────────────────────────────────────────────────────────────────────
   Program Schedule
   --------------------------------------------------------------------------
   In-facility display board for coaches running a program session. The coach
   picks a single training category (Hitting / Pitching / Catching / Infield
   / Outfield / S&C) and 1–8 athletes, and the page renders each athlete's
   workout for the selected day side-by-side as readable cards so kids can
   walk up and follow their plan. A single athlete renders as one full
   column; 2–8 fill the board side-by-side.
   ───────────────────────────────────────────────────────────────────────── */

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, ScheduledDrill } from '@/lib/api';
import { WorkoutNotes } from '@/components/WorkoutNotes';
import styles from './page.module.css';
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconClipboard } from '../education/EduHeader';
import { parseFacilitySchedule, slotsOnDate, formatTime12, programColor, programWeek } from '@/lib/facility-schedule';
import { useFacilityPrograms, facilityProgramsLoaded } from '@/lib/use-facility-programs';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
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
import { sortScheduled, moveDrillWithinSection, moveSection } from '@/lib/scheduleReorder';

/* A small grip glyph used as the drag handle for coach reorder. The handle —
   not the whole row — carries the dnd-kit listeners so a tap/click on the row
   still plays the video and touch-scroll elsewhere still scrolls the page. */
const GripIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" />
    <circle cx="5.5" cy="8" r="1.4" /><circle cx="10.5" cy="8" r="1.4" />
    <circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
  </svg>
);

/* Custom collision detection for the nested board. With plain closestCenter,
   a dragged DRILL competes against the big section + column droppables, so the
   "over" target keeps snapping to a section edge (drill jumps to top/bottom)
   instead of the neighbour drill. Fix: while dragging a drill, only consider
   OTHER DRILLS; fall back to sections/columns only when no drill is under the
   pointer (empty section, or dropping onto another athlete's column). While
   dragging a section, only consider sections. */
const reorderCollision: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const byType = (...types: string[]) =>
    args.droppableContainers.filter((d) => types.includes(d.data.current?.type as string));

  if (activeType === 'section') {
    return closestCenter({ ...args, droppableContainers: byType('section') });
  }
  // drill
  const drillHits = closestCenter({ ...args, droppableContainers: byType('drill') });
  if (drillHits.length > 0) return drillHits;
  return closestCenter({ ...args, droppableContainers: byType('section', 'column') });
};

/* ── Schedule categories ── */
type ScheduleKey = 'hitting' | 'pitching' | 'catching' | 'infield' | 'outfield' | 'strength';

/** The board most coaches can run at once (two rows of 8 on the TV). */
const MAX_BOARD = 16;

/** Which training-calendar tab a facility program's workouts live on:
 *  the four built-ins directly, a custom type by name ("Infield Program"
 *  → infield). Null = no board for it. Same rule as Apply Calendar. */
function scheduleKeyFor(programKey: string): ScheduleKey | null {
  const builtIn: Record<string, ScheduleKey> = {
    HITTING_PROGRAM: 'hitting', PITCHING_PROGRAM: 'pitching',
    CATCHING_PROGRAM: 'catching', LIFTING_PROGRAM: 'strength',
  };
  if (builtIn[programKey]) return builtIn[programKey];
  const k = (['infield', 'outfield', 'hitting', 'pitching', 'catching', 'strength'] as ScheduleKey[])
    .find(s => programKey.includes(s.toUpperCase()));
  return k ?? null;
}

/** The Mon–Sun week holding `iso`, as seven local YYYY-MM-DD dates. */
function weekOf(iso: string): string[] {
  const [y, m, d] = iso.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    return formatLocalDate(x);
  });
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return formatLocalDate(new Date(y, m - 1, d + days));
}

const SCHEDULE_OPTIONS: { key: ScheduleKey; label: string; color: string }[] = [
  { key: 'hitting',  label: 'Hitting',  color: '#3B82F6' },
  { key: 'pitching', label: 'Pitching', color: '#F59E0B' },
  { key: 'catching', label: 'Catching', color: '#14B8A6' },
  { key: 'infield',  label: 'Infield',  color: '#22C55E' },
  { key: 'outfield', label: 'Outfield', color: '#22C55E' },
  { key: 'strength', label: 'S&C',      color: '#EF4444' },
];

/* ── Session persistence ──
   The coach's Program selection (schedule + athletes + date) is mirrored
   to sessionStorage so it survives navigating away and back while the
   browser tab stays open, and is cleared when the tab closes — exactly
   "persist as long as the webpage is open". SSR-safe (returns the
   fallback on the server; writes are no-ops there). */
const PROGRAM_STORE = {
  program: 'program.facilityProgram',
  sessionTime: 'program.sessionTime',
  selectedIds: 'program.selectedIds',
  sessionDate: 'program.sessionDate',
} as const;

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function saveStored(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

/* ── Small helpers ── */

/* Board colours come from the facility program (Settings → Programs), so a
   Pitching board is the Pitching Program red, Lifting its orange, and so on.
   Sections step from a lighter to a darker shade of that colour top to
   bottom; every section label uses the colour itself. */
function sectionStyle(color: string, index: number, count: number) {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const shade = t < 0.5
    ? `color-mix(in srgb, ${color}, white ${Math.round((0.5 - t) * 2 * 45)}%)`
    : `color-mix(in srgb, ${color}, black ${Math.round((t - 0.5) * 2 * 40)}%)`;
  return { background: `color-mix(in srgb, ${shade} 13%, transparent)`, borderLeft: `3px solid ${shade}` };
}


function todayIso(): string {
  return formatLocalDate(new Date());
}

/* ── Timezone-safe date helpers ──────────────────────────────────────────
   `new Date('2026-04-30')` parses as UTC midnight, which displays as the
   PREVIOUS calendar day for any user west of UTC. The two helpers below
   keep every YYYY-MM-DD ↔ Date conversion in LOCAL time, so the calendar
   always lands on the day the coach actually picked regardless of the
   viewer's timezone. */


/** Format a Date as `YYYY-MM-DD` using its LOCAL date components. */
function formatLocalDate(d: Date): string {
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
      (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
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
        className={`${styles.pickerBtn} ${theme.field} ${open ? styles.pickerBtnOpen : ''}`}
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
                    {p.firstName} {p.lastName}
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

/* One draggable SECTION bubble (a category). The grip in the header carries
   the dnd-kit listeners; the bubble chrome + children (the drill list) are
   otherwise unchanged. Drag disabled for non-coaches. */
function SortableSection({
  id, playerId, category, count, bgStyle, headStyle, isCoach, children,
}: {
  id: string;
  playerId: string;
  category: string;
  count: number;
  bgStyle: React.CSSProperties;
  headStyle: React.CSSProperties;
  isCoach: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, data: { type: 'section', playerId, category }, disabled: !isCoach });
  const style: React.CSSProperties = {
    ...bgStyle,
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 6 : undefined,
  };
  return (
    <div ref={setNodeRef} className={styles.athleteBubble} style={style}>
      <div className={styles.athleteBubbleHead} style={headStyle}>
        {isCoach && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            className={styles.sectionDragHandle}
            title="Drag to reorder this section"
            aria-label="Drag to reorder this section"
            onClick={(e) => e.stopPropagation()}
            style={{ touchAction: 'none', cursor: 'grab' }}
          >
            <GripIcon />
          </button>
        )}
        <span>{category}</span>
        <span className={styles.athleteBubbleCount}>{count}</span>
      </div>
      {children}
    </div>
  );
}

/* One draggable DRILL row. The left grip carries the dnd-kit listeners (and
   doubles as the centering counterweight to the ✎ on the right); the row body
   still plays the video on click. Drag disabled for non-coaches. */
function SortableDrill({
  drill, playerId, category, isCoach, onPlay, onEdit,
}: {
  drill: ScheduledDrill;
  playerId: string;
  category: string;
  isCoach: boolean;
  onPlay: (d: ScheduledDrill) => void;
  onEdit: (d: ScheduledDrill) => void;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: drill.id, data: { type: 'drill', playerId, category }, disabled: !isCoach });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: 'pointer',
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 6 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      className={styles.athleteBubbleItem}
      style={style}
      onClick={() => onPlay(drill)}
      title={isCoach ? 'Click to watch · drag the grip to reorder' : 'Click to watch'}
    >
      {isCoach ? (
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          className={styles.drillDragHandle}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          style={{ flex: '0 0 auto', width: 22, touchAction: 'none', cursor: 'grab' }}
        >
          <GripIcon size={13} />
        </button>
      ) : null}
      <span className={styles.athleteBubbleItemName}>{drill.name}</span>
      {isCoach && (
        <button
          type="button"
          className={styles.drillEditBtn}
          onClick={(e) => { e.stopPropagation(); onEdit(drill); }}
          title="Edit drill"
          aria-label="Edit drill"
        >
          ✎
        </button>
      )}
    </div>
  );
}

function AthleteColumn({
  player,
  drills,
  schedule,
  scheduleColor,
  loading,
  isCoach,
  onClickDrill,
  onPlayDrill,
  checkedIn,
  programBadge,
  sessionDate,
  noteHtml,
  noteReadOnly,
  onNoteSaved,
}: {
  player: Player;
  /** The board's day ("YYYY-MM-DD") -- the workout note's date. */
  sessionDate: string;
  /** This athlete's saved note for the day's workout ('' = none). */
  noteHtml: string;
  /** Full-screen TV mode: show the note without the editor. */
  noteReadOnly: boolean;
  /** A note was saved here -- keep the board's copy in step. */
  onNoteSaved: (html: string) => void;
  /** "Day 1 · 4:00 PM" -- where this athlete is in the program's week. */
  programBadge?: { label: string; color: string } | null;
  /** Has the athlete checked in for the board's day? null = not known yet. */
  checkedIn: boolean | null;
  drills: ScheduledDrill[];
  /** The active schedule key (hitting / pitching / catching / ...) —
   *  drives per-category color lookups so this column's bubbles
   *  graduate light→dark the same way the training calendar does. */
  schedule: ScheduleKey;
  scheduleColor: string;
  loading: boolean;
  isCoach: boolean;
  /** Coach clicked the ✎ on a scheduled drill — opens the inline edit popover. */
  onClickDrill: (drill: ScheduledDrill) => void;
  /** Clicked a scheduled drill name — opens its video (mirrors Training). */
  onPlayDrill: (drill: ScheduledDrill) => void;
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

  /* dnd-kit: the whole column body is a drop target so a coach can drag a
     drill from another athlete and drop it anywhere in this column (even an
     empty one). Section/drill reorder is handled by the nested sortables;
     this is the cross-athlete fallback. */
  const { setNodeRef: setColumnRef, isOver: colIsOver } = useDroppable({
    id: `col:${player.id}`,
    data: { type: 'column', playerId: player.id },
  });

  const scheduleLabel = SCHEDULE_OPTIONS.find(o => o.key === schedule)?.label ?? '';

  return (
    <div className={`${styles.athleteCard} ${theme.inner}`}>
      <div className={styles.athleteCardHead} style={{ borderTopColor: scheduleColor, position: 'relative' }}>
        <div className={styles.athleteName}>
          {player.firstName} <span className={styles.athleteLast}>{player.lastName}</span>
        </div>
        {/* Checked in for the day? Green ✓ / red ✕ -- the same check-in the
            Attendance → Check-In tab shows (the athlete's own check-in on
            their Training page). Replaces the positions line. */}
        <div className={styles.checkInRow}>
          {checkedIn === null ? (
            <span className={`${styles.checkInBox} ${styles.checkInUnknown}`} aria-label="Check-in loading">·</span>
          ) : (
            <span
              className={`${styles.checkInBox} ${checkedIn ? styles.checkInYes : styles.checkInNo}`}
              role="img"
              aria-label={checkedIn ? 'Checked in' : 'Not checked in'}
              title={checkedIn ? 'Checked in' : 'Not checked in yet'}
            >
              {checkedIn ? '✓' : '✕'}
            </span>
          )}
        </div>
        {programBadge && (
          <div className={styles.programBadge} style={{ background: programBadge.color }}>{programBadge.label}</div>
        )}
      </div>
      <div
        ref={setColumnRef}
        className={styles.athleteCardBody}
        style={colIsOver && isCoach ? {
          // Soft highlight when a coach drags a drill over this column.
          outline: `2px dashed ${scheduleColor}`,
          outlineOffset: -2,
          background: 'rgba(126, 182, 255, 0.04)',
        } : undefined}
      >
        {loading ? (
          <div className={styles.athleteEmpty}>Loading…</div>
        ) : (
          <>
          {drills.length === 0 ? (
          <div className={styles.athleteEmpty}>
            {isCoach ? 'No drills scheduled for today. Drag drills here from another athlete.' : 'No drills scheduled for today.'}
          </div>
        ) : (
          /* Category-bubble layout, now drag-sortable for coaches. Outer
             SortableContext = the sections (drag a section header's grip to
             reorder Movement Prep / Vision / Drills …); each section holds an
             inner SortableContext = its drills (drag a row's grip to reorder
             within the section). Click a row to watch, ✎ to edit — unchanged.
             Players (non-coaches) get the same markup with drag disabled. */
          <SortableContext
            items={grouped.map((g) => `sec:${player.id}:${g.category}`)}
            strategy={verticalListSortingStrategy}
          >
          {grouped.map(({ category, items }, i) => {
            const headStyle = { color: 'var(--tab-ink)', '--tab-c': scheduleColor } as React.CSSProperties;
            return (
              <SortableSection
                key={category}
                id={`sec:${player.id}:${category}`}
                playerId={player.id}
                category={category}
                count={items.length}
                bgStyle={sectionStyle(scheduleColor, i, grouped.length)}
                headStyle={headStyle}
                isCoach={isCoach}
              >
                <SortableContext
                  items={items.map((d) => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className={styles.athleteBubbleList}>
                    {items.map((d) => (
                      <SortableDrill
                        key={d.id}
                        drill={d}
                        playerId={player.id}
                        category={category}
                        isCoach={isCoach}
                        onPlay={onPlayDrill}
                        onEdit={onClickDrill}
                      />
                    ))}
                  </div>
                </SortableContext>
              </SortableSection>
            );
          })}
          </SortableContext>
        )}
          {/* This workout's notes, under the day's drills -- the same saved
              note shown across the top of the athlete's Training calendar
              for this day and workout. */}
          <div className={styles.athleteNotes}>
            <WorkoutNotes
              key={`${player.id}|${sessionDate}|${schedule}`}
              playerId={player.id}
              date={sessionDate}
              tab={schedule}
              label={scheduleLabel}
              html={noteHtml}
              canEdit={isCoach && !noteReadOnly}
              accent={scheduleColor}
              onSaved={onNoteSaved}
              minHeight={56}
            />
          </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Inline drill editor — small centered modal a coach gets when they click
   a scheduled drill card on the program board. Edits the four fields a
   coach actually wants to tweak day-of-session: Name, Time, Duration,
   Notes. Save returns the patch to the parent; Delete removes the slot.
   ───────────────────────────────────────────────────────────────────────── */

function DrillEditor({
  drill, onClose, onSave, onDelete,
}: {
  drill: ScheduledDrill;
  onClose: () => void;
  onSave: (patch: { name: string; time: string; duration: number; notes: string | null }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(drill.name);
  const [time, setTime] = useState(drill.time);
  const [duration, setDuration] = useState(drill.duration);
  const [notes, setNotes] = useState(drill.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async () => {
    setSaving(true);
    onSave({
      name: name.trim() || drill.name,
      time,
      duration: Number.isFinite(duration) ? duration : drill.duration,
      notes: notes.trim() ? notes.trim() : null,
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 92vw)',
          background: 'var(--surface, #1a1f25)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '18px 20px 16px',
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <div style={{
            fontSize: rem(11), fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'rgba(126,182,255,0.85)',
          }}>
            Edit Drill
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: rem(20), lineHeight: 1, cursor: 'pointer', padding: 0,
            }}
            aria-label="Close"
          >×</button>
        </div>

        <FieldLabel>Name</FieldLabel>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>Time</FieldLabel>
            <input
              type="time" value={time} onChange={(e) => setTime(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>Duration (min)</FieldLabel>
            <input
              type="number" min={1} max={240} step={1}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10) || 0)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Cues, reps, etc."
          />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 16, gap: 10,
        }}>
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: rem(12), color: 'var(--text)' }}>Delete?</span>
              <button type="button" onClick={onDelete}
                style={{ ...btnStyle, background: '#dc2626', borderColor: '#dc2626', color: 'var(--text-bright)' }}>
                Yes
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} style={btnStyle}>No</button>
            </div>
          ) : (
            <button
              type="button" onClick={() => setConfirmDelete(true)}
              style={{ ...btnStyle, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
            >Delete</button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={btnStyle}>Cancel</button>
            <button
              type="button" onClick={submit} disabled={saving}
              style={{
                ...btnStyle,
                background: 'var(--accent, #3d8bfd)',
                borderColor: 'var(--accent, #3d8bfd)',
                color: 'var(--text-bright)', fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Drill video viewer — opens when a coach clicks a scheduled drill on the
   board. Mirrors the Training calendar's drill→video flow: each scheduled
   drill carries its library `Drill` (`ScheduledDrill.drill`), so we play
   that drill's `videoUrl`. Falls back to a "no video" note when the drill
   has no linked library entry or no clip uploaded.
   ───────────────────────────────────────────────────────────────────────── */
function DrillVideoModal({ drill, onClose }: { drill: ScheduledDrill; onClose: () => void }) {
  const lib = drill.drill;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 94vw)',
          background: 'var(--surface, #1a1f25)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: rem(15), fontWeight: 700, color: 'var(--text-bright)' }}>
            {drill.name}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: rem(22), lineHeight: 1, cursor: 'pointer', padding: 0,
            }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{
          background: '#000', aspectRatio: '16 / 9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {lib?.videoUrl ? (
            <video
              src={lib.videoUrl}
              controls
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: rem(13), fontStyle: 'italic' }}>
              No video uploaded for this drill
            </div>
          )}
        </div>
        {lib?.description && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize: rem(9.5), fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4,
            }}>
              Description
            </div>
            <div style={{ fontSize: rem(13), color: 'var(--text)', lineHeight: 1.45 }}>
              {lib.description}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontSize: rem(9.5), fontWeight: 700, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: 'var(--text-muted)',
    marginBottom: 4,
  }}>
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px',
  background: 'rgba(20,24,32,0.85)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: rem(13),
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: rem(12),
  cursor: 'pointer',
};

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
        setProgramKey('HITTING_PROGRAM');
        setSessionTime('');
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

  /* Top-row state — restored from sessionStorage so the coach's selection
     survives navigating away and back while the tab is open.
     The board runs off a facility program (Settings → Programs): its tab
     picks the program, then a day of the week and one of that day's start
     times fill the board with the athletes due then. "Athletes" adds or
     removes anyone by hand on top. */
  const programs = useFacilityPrograms();
  const programTabs = useMemo(() => programs.filter(p => scheduleKeyFor(p.key)), [programs]);
  const [programKey, setProgramKey] = useState<string>(() => loadStored(PROGRAM_STORE.program, 'HITTING_PROGRAM'));
  /** '' = no time picked, 'all' = every session that day. */
  const [sessionTime, setSessionTime] = useState<string>(() => loadStored(PROGRAM_STORE.sessionTime, ''));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadStored(PROGRAM_STORE.selectedIds, [] as string[]));
  const [sessionDate, setSessionDate] = useState<string>(() => loadStored(PROGRAM_STORE.sessionDate, todayIso()));
  /** The training-calendar tab the board reads drills from. */
  const schedule: ScheduleKey = scheduleKeyFor(programKey) ?? 'hitting';

  /* Mirror each selection back to sessionStorage on change. The sidebar
     "reset" hook above sets these back to their defaults, which this
     persists too — so an explicit reset truly clears the saved state. */
  useEffect(() => { saveStored(PROGRAM_STORE.program, programKey); }, [programKey]);
  useEffect(() => { saveStored(PROGRAM_STORE.sessionTime, sessionTime); }, [sessionTime]);
  useEffect(() => { saveStored(PROGRAM_STORE.selectedIds, selectedIds); }, [selectedIds]);
  useEffect(() => { saveStored(PROGRAM_STORE.sessionDate, sessionDate); }, [sessionDate]);

  /* Everyone the coach can put on the board (no coaches, no paused). */
  const roster = useMemo(
    () => players.filter(p => p.positions !== 'COACH' && !api.isPlayerLocked(p)),
    [players],
  );

  /* The program's sessions on a date: each start time with the athletes due
     then (and which of their program days it is). Times the program offers
     that day are listed even when nobody is booked into them yet. */
  const sessionsFor = (key: string, date: string) => {
    const byTime = new Map<string, { id: string; day: number | null }[]>();
    const weekday = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(`${date}T12:00:00`).getDay()];
    for (const t of programs.find(p => p.key === key)?.hours[weekday] ?? []) byTime.set(t, []);
    for (const p of roster) {
      for (const sl of slotsOnDate(parseFacilitySchedule(p.facilitySchedule), date)) {
        if (sl.program !== key) continue;
        byTime.set(sl.time, [...(byTime.get(sl.time) ?? []), { id: p.id, day: sl.day }]);
      }
    }
    return [...byTime.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, athletes]) => ({ time, athletes }));
  };
  const daySessions = sessionsFor(programKey, sessionDate);
  const week = programWeek(programKey, sessionDate);
  const program = programs.find(p => p.key === programKey);
  const programHex = programColor(programKey);

  /* Fill the board from a session. Without a time, the day's first session
     with anyone in it (or the first time on offer). */
  const fillBoard = (key: string, date: string, time?: string) => {
    const sessions = sessionsFor(key, date);
    const t = time ?? (sessions.find(s => s.athletes.length)?.time ?? sessions[0]?.time ?? '');
    const ids = t === 'all'
      ? [...new Set(sessions.flatMap(s => s.athletes.map(a => a.id)))]
      : sessions.find(s => s.time === t)?.athletes.map(a => a.id) ?? [];
    setSessionTime(t);
    setSelectedIds(ids.slice(0, MAX_BOARD));
  };
  /** The first date from `from` (up to two weeks on) the program has
   *  athletes due, or null. */
  const nextSessionDate = (key: string, from: string): string | null => {
    for (let i = 0; i < 14; i++) {
      const d = shiftIso(from, i);
      if (sessionsFor(key, d).some(s => s.athletes.length)) return d;
    }
    return null;
  };
  /* Switching program keeps the day when that program runs then, otherwise
     moves on to its next session day. */
  const pickProgram = (key: string) => {
    setProgramKey(key);
    const date = sessionsFor(key, sessionDate).some(s => s.athletes.length)
      ? sessionDate
      : nextSessionDate(key, sessionDate) ?? sessionDate;
    setSessionDate(date);
    fillBoard(key, date);
  };

  /* Opening the page with an empty board: go to today's session, or the next
     day the program has one, and fill it. Waits for the roster and the saved
     programs; a board restored from earlier in the visit is left alone. */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || playersLoading || !facilityProgramsLoaded()) return;
    autoOpened.current = true;
    if (selectedIds.length) return;
    const date = nextSessionDate(programKey, todayIso());
    if (!date) return;
    setSessionDate(date);
    fillBoard(programKey, date);
    // Runs once, when both lists are in; the helpers read the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, playersLoading]);
  const pickDay = (date: string) => { setSessionDate(date); fillBoard(programKey, date); };
  const shiftWeek = (dir: 1 | -1) => {
    const date = shiftIso(sessionDate, dir * 7);
    setSessionDate(date);
    /* Same weekday, same time where it still runs. */
    const keep = sessionTime === 'all' || sessionsFor(programKey, date).some(s => s.time === sessionTime);
    fillBoard(programKey, date, sessionTime && keep ? sessionTime : undefined);
  };

  /* Where each athlete on the board is in the program today. */
  const badgeFor = (p: Player) => {
    const sl = slotsOnDate(parseFacilitySchedule(p.facilitySchedule), sessionDate).find(s => s.program === programKey);
    if (!sl) return null;
    return { label: [sl.day ? `Day ${sl.day}` : '', formatTime12(sl.time)].filter(Boolean).join(' · '), color: programHex };
  };

  /* Fetch each selected athlete's scheduled drills for the chosen date
     and category. Keeps a per-player loading flag so newly-added cards
     show a spinner without blocking the others. */
  const [drillsByPlayer, setDrillsByPlayer] = useState<Record<string, ScheduledDrill[]>>({});
  const [loadingByPlayer, setLoadingByPlayer] = useState<Record<string, boolean>>({});

  /* Refetch one or more athletes' schedule for the current sessionDate +
     schedule. Reused by the drag-drop and inline-edit handlers below so
     we don't have to do a full page reload after each mutation. */
  const refetchAthletes = async (playerIds: string[]) => {
    await Promise.all(playerIds.map(async (id) => {
      try {
        const rows = await api.getScheduledDrills(id, { date: sessionDate, tab: schedule });
        setDrillsByPlayer(prev => ({ ...prev, [id]: sortScheduled(rows) }));
      } catch {
        setDrillsByPlayer(prev => ({ ...prev, [id]: prev[id] ?? [] }));
      }
    }));
  };

  /* ── Coach drag-to-reorder (dnd-kit, mouse + touch) ──────────────────
     PointerSensor with a small activation distance so a tap/click still
     plays the drill (and touch-scroll off the grip still scrolls the page);
     KeyboardSensor for accessibility. handleDragEnd reads the active/over
     item data (type: 'section' | 'drill' | 'column') and dispatches. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* Reorder a drill within its own section. Optimistic; resync that column
     on error. */
  const reorderWithinSection = async (playerId: string, category: string, activeId: string, overId: string | null) => {
    const { rows, payload } = moveDrillWithinSection(drillsByPlayer[playerId] || [], category, activeId, overId);
    if (!payload.length) return;
    setDrillsByPlayer(prev => ({ ...prev, [playerId]: rows }));
    try { await api.reorderScheduledDrills(payload); }
    catch (e) { console.error('Reorder drill failed', e); refetchAthletes([playerId]); }
  };

  /* Reorder whole sections within a column. */
  const reorderSectionsHandler = async (playerId: string, fromCat: string, toCat: string) => {
    const { rows, payload } = moveSection(drillsByPlayer[playerId] || [], fromCat, toCat);
    if (!payload.length) return;
    setDrillsByPlayer(prev => ({ ...prev, [playerId]: rows }));
    try { await api.reorderScheduledDrills(payload); }
    catch (e) { console.error('Reorder sections failed', e); refetchAthletes([playerId]); }
  };

  /* Cross-athlete reassign: drop a drill onto another athlete's column /
     section. Moves it (playerId + category + section/drill order) and then
     re-syncs both columns from the server. */
  const moveDrillAcross = async (drillId: string, fromPlayerId: string, toPlayerId: string, toCategory: string, overId: string | null) => {
    const source = drillsByPlayer[fromPlayerId] || [];
    const target = drillsByPlayer[toPlayerId] || [];
    const moved = source.find(d => d.id === drillId);
    if (!moved) return;
    const targetSecRows = target.filter(d => (d.category || 'Drills') === toCategory);
    const targetSectionOrder = targetSecRows.length
      ? targetSecRows[0].sectionOrder
      : target.reduce((m, d) => Math.max(m, d.sectionOrder), -1) + 1;
    const ids = targetSecRows.map(d => d.id);
    let insertAt = overId ? ids.indexOf(overId) : ids.length;
    if (insertAt === -1) insertAt = ids.length;
    const newSecRows = [...targetSecRows];
    newSecRows.splice(insertAt, 0, { ...moved, playerId: toPlayerId, category: toCategory, sectionOrder: targetSectionOrder });
    const orderById = new Map(newSecRows.map((d, i) => [d.id, i]));
    const newSource = source.filter(d => d.id !== drillId);
    const newTarget = [
      ...target.filter(d => (d.category || 'Drills') !== toCategory),
      ...newSecRows.map(d => ({ ...d, order: orderById.get(d.id) ?? 0 })),
    ];
    setDrillsByPlayer(prev => ({
      ...prev,
      [fromPlayerId]: sortScheduled(newSource),
      [toPlayerId]: sortScheduled(newTarget),
    }));
    try {
      await api.reorderScheduledDrills([
        { id: drillId, playerId: toPlayerId, category: toCategory, sectionOrder: targetSectionOrder, order: orderById.get(drillId) ?? 0 },
        ...newSecRows.filter(d => d.id !== drillId).map(d => ({ id: d.id, order: orderById.get(d.id) ?? 0 })),
      ]);
    } catch (e) {
      console.error('Cross-athlete move failed', e);
    } finally {
      refetchAthletes([fromPlayerId, toPlayerId]);
    }
  };

  /* A floating ghost of the dragged item, rendered in a portal by
     <DragOverlay> so it isn't clipped by `.athleteCard { overflow: hidden }`
     when a coach drags a drill toward another athlete's column. */
  const [activeOverlay, setActiveOverlay] = useState<{ type: 'drill' | 'section'; label: string } | null>(null);
  const handleDragStart = (event: DragStartEvent) => {
    const d = event.active.data.current as { type?: string; playerId?: string; category?: string } | undefined;
    if (d?.type === 'drill') {
      const name = (drillsByPlayer[d.playerId || ''] || []).find(x => x.id === event.active.id)?.name || 'Drill';
      setActiveOverlay({ type: 'drill', label: name });
    } else if (d?.type === 'section') {
      setActiveOverlay({ type: 'section', label: d.category || 'Section' });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveOverlay(null);
    const { active, over } = event;
    if (!over) return;
    const a = active.data.current as { type?: string; playerId?: string; category?: string } | undefined;
    const o = over.data.current as { type?: string; playerId?: string; category?: string } | undefined;
    if (!a?.type || !a.playerId) return;

    if (a.type === 'section') {
      // Dropping a section may resolve (via nested contexts) onto another
      // section's header OR a drill inside it — both carry `category`, so map
      // either to the target section. Same column only; ignore self-drops.
      if (!o || o.playerId !== a.playerId || !o.category || o.category === a.category) return;
      reorderSectionsHandler(a.playerId, a.category!, o.category);
      return;
    }
    if (a.type === 'drill') {
      const toPlayer = o?.playerId;
      if (!toPlayer) return;
      // Only meaningful when dropped onto another drill of the same section.
      const overDrillId = o?.type === 'drill' ? String(over.id) : null;
      if (toPlayer === a.playerId) {
        // Same athlete → reorder within the SAME section only. Drills don't
        // hop sections (matches the "reorder within their section" ask); a
        // drop onto a different section (or empty area) just snaps back.
        if (o?.category !== a.category || active.id === over.id) return;
        reorderWithinSection(a.playerId, a.category!, String(active.id), overDrillId);
      } else {
        // Different athlete → reassign, keeping the drill's own category
        // (mirrors the previous reassign behaviour; the drill lands in the
        // matching section of the target column, creating it if needed).
        moveDrillAcross(String(active.id), a.playerId, toPlayer, a.category!, overDrillId);
      }
    }
  };


  /* Inline-edit popover — set when coach clicks a drill, cleared on save
     / cancel / delete. Render is a small modal anchored center-screen. */
  const [editingDrill, setEditingDrill] = useState<ScheduledDrill | null>(null);
  /* Drill clicked for video playback (mirrors the Training calendar). */
  const [viewingDrill, setViewingDrill] = useState<ScheduledDrill | null>(null);
  const closeEditor = () => setEditingDrill(null);
  const saveEditor = async (patch: { name: string; time: string; duration: number; notes: string | null }) => {
    if (!editingDrill) return;
    try {
      await api.updateScheduledDrill(editingDrill.id, patch as any);
      await refetchAthletes([editingDrill.playerId]);
    } catch (e) {
      console.error('Inline-edit save failed', e);
    } finally {
      closeEditor();
    }
  };
  const deleteEditor = async () => {
    if (!editingDrill) return;
    try {
      await api.deleteScheduledDrill(editingDrill.id);
      await refetchAthletes([editingDrill.playerId]);
    } catch (e) {
      console.error('Inline-edit delete failed', e);
    } finally {
      closeEditor();
    }
  };

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
          /* Sort by coach section/drill order, falling back to time. */
          setDrillsByPlayer(prev => ({ ...prev, [id]: sortScheduled(rows) }));
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

  /* Who has checked in for the board's day (Attendance → Check-In's data).
     Re-read every 30 s and whenever the tab regains focus, so the board on
     the facility TV turns athletes green as they check in. */
  const [checkedInIds, setCheckedInIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!isCoach) { setCheckedInIds(null); return; }
    let cancelled = false;
    setCheckedInIds(null);
    const load = () => {
      api.getDayCheckIns(sessionDate)
        .then(rows => { if (!cancelled) setCheckedInIds(new Set(rows.filter(r => r.checkedIn).map(r => r.playerId))); })
        .catch(() => { if (!cancelled) setCheckedInIds(prev => prev ?? new Set()); });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [isCoach, sessionDate]);

  /* Each selected athlete's workout note for the board's day + workout --
     the same saved notes shown on their Training calendar. */
  const [notesByPlayer, setNotesByPlayer] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isCoach || selectedIds.length === 0) { setNotesByPlayer({}); return; }
    let cancelled = false;
    api.getWorkoutNotesForDay(selectedIds, sessionDate, schedule)
      .then(rows => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const r of rows) map[r.playerId] = r.html;
        setNotesByPlayer(map);
      })
      .catch(() => { if (!cancelled) setNotesByPlayer({}); });
    return () => { cancelled = true; };
  }, [isCoach, selectedIds, sessionDate, schedule]);

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

  /* ── Fullscreen fit-to-screen scaler ──
     The TV board is hard-clamped to 100vh with no scroll, so a heavy
     session (a player with lots of drills) used to clip silently. While
     fullscreen, shrink the board's typography + spacing (via the
     `--prog-scale` CSS var the fullscreen rules read) one step at a time
     until the tallest column's content fits — down to a legibility floor.
     If it STILL overflows at the floor (a session too big for any one
     screen), flip `data-fit="scroll"` so the columns scroll instead of
     hiding drills. Off-fullscreen the var is cleared (normal view scrolls
     the page as usual). Re-runs on content + viewport changes. */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    if (!isFullscreen) {
      board.style.removeProperty('--prog-scale');
      board.removeAttribute('data-fit');
      return;
    }
    const FLOOR = 0.5;
    const STEP = 0.05;
    const fit = () => {
      const el = boardRef.current;
      if (!el) return;
      const bodies = () =>
        Array.from(el.querySelectorAll<HTMLElement>('[class*="athleteCardBody"]'));
      const overflowing = () => bodies().some((b) => b.scrollHeight - b.clientHeight > 1);
      let scale = 1;
      el.style.setProperty('--prog-scale', '1');
      el.removeAttribute('data-fit');
      let guard = 0;
      while (overflowing() && scale > FLOOR && guard < 24) {
        scale = Math.max(FLOOR, Math.round((scale - STEP) * 100) / 100);
        el.style.setProperty('--prog-scale', String(scale));
        guard += 1;
      }
      if (overflowing()) el.setAttribute('data-fit', 'scroll');
    };
    const raf = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
    /* notesByPlayer: the workout notes load a beat after the drills and sit
       at the bottom of each card -- refit when they arrive so they are
       sized in, never clipped below the card. */
  }, [isFullscreen, selectedIds, drillsByPlayer, notesByPlayer, schedule, sessionDate]);

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

  /* In full screen only the board is drawn (the browser's top layer), so a
     window opened from it -- the drill video, the drill editor, the template
     picker -- has to be drawn INSIDE the board or it opens unseen. */
  const overBoard = (node: React.ReactNode) =>
    isFullscreen && boardRef.current ? createPortal(node, boardRef.current) : node;

  /* The program's own colour drives the whole board. */
  const scheduleColor = programHex;
  const selectedPlayers: Player[] = selectedIds
    .map(id => players.find(p => p.id === id))
    .filter((p): p is Player => !!p);
  const canFullscreen = selectedPlayers.length >= 1;
  /* A stale saved time (no longer offered that day) reads as unpicked. */
  const timeValue = sessionTime === 'all' || daySessions.some(s => s.time === sessionTime) ? sessionTime : '';
  /* Past 8 athletes the board wraps onto a second row. */
  const boardCols = selectedPlayers.length <= 8 ? selectedPlayers.length : Math.ceil(selectedPlayers.length / 2);
  const sessionDay = (() => {
    const [y, m, d] = sessionDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  })();

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconClipboard />}
        eyebrow="Daily Display"
        title="Program"
        accent="Schedule"
      />

      {/* ── Program tabs (Settings → Programs) ── */}
      <div className={`${eduStyles.sportTabs} ${theme.inner} ${theme.firm}`} role="tablist" aria-label="Program">
        {programTabs.map(p => (
          <button
            key={p.key}
            type="button" role="tab" aria-selected={p.key === programKey}
            className={`${eduStyles.sportTab} ${p.key === programKey ? eduStyles.sportTabActive : ''}`}
            onClick={() => pickProgram(p.key)}
          >
            <span className={styles.tabDot} style={{ background: p.color }} aria-hidden />
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Filter row: day of the week + start time + athletes ── */}
      <div className={`${styles.filterBar} ${theme.bubble}`}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            Day {week && <span className={styles.filterHint}>· Week {week}</span>}
          </label>
          <div className={styles.dateRow}>
            <button type="button" className={`${styles.weekBtn} ${theme.field}`} onClick={() => shiftWeek(-1)} aria-label="Previous week" title="Previous week">‹</button>
            <select
              className={`${styles.scheduleSelect} ${theme.field}`}
              value={sessionDate}
              onChange={e => pickDay(e.target.value)}
            >
              {weekOf(sessionDate).map(d => {
                const [y, m, dd] = d.split('-').map(Number);
                const dt = new Date(y, m - 1, dd);
                const runs = sessionsFor(programKey, d).length > 0;
                return (
                  <option key={d} value={d}>
                    {dt.toLocaleDateString(undefined, { weekday: 'long' })} · {dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {d === todayIso() ? ' (today)' : ''}{runs ? '' : ' — no sessions'}
                  </option>
                );
              })}
            </select>
            <button type="button" className={`${styles.weekBtn} ${theme.field}`} onClick={() => shiftWeek(1)} aria-label="Next week" title="Next week">›</button>
          </div>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Time</label>
          <select
            className={`${styles.scheduleSelect} ${theme.field}`}
            value={timeValue}
            onChange={e => fillBoard(programKey, sessionDate, e.target.value)}
            disabled={daySessions.length === 0}
          >
            {daySessions.length === 0 && <option value="">No {program?.label ?? 'program'} sessions this day</option>}
            {daySessions.length > 0 && timeValue === '' && <option value="">Pick a time…</option>}
            {daySessions.map(s => (
              <option key={s.time} value={s.time}>
                {formatTime12(s.time)} ({s.athletes.length} athlete{s.athletes.length === 1 ? '' : 's'})
              </option>
            ))}
            {daySessions.length > 1 && <option value="all">All times</option>}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            Athletes <span className={styles.filterHint}>(add or remove)</span>
          </label>
          {playersLoading ? (
            <div className={styles.pickerLoading}>Loading roster…</div>
          ) : (
            <AthletePicker
              candidates={roster}
              selected={selectedIds}
              onChange={setSelectedIds}
              maxSelectable={MAX_BOARD}
            />
          )}
        </div>
      </div>

      {/* ── Display board ── */}
      {selectedIds.length === 0 ? (
        <div className={`${styles.boardEmpty} ${theme.bubble}`}>
          <span className={styles.boardEmptyIcon}>📋</span>
          <p className={styles.boardEmptyTitle}>
            {daySessions.length ? 'Pick a time to start the board' : 'Nobody is scheduled for this day'}
          </p>
          <p className={styles.boardEmptyHint}>
            Pick a program, a day and a start time above and everyone due then appears here
            side by side with their {program?.label ?? ''} workout. Use Athletes to add anyone else.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={reorderCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveOverlay(null)}
        >
        <div
          ref={boardRef}
          className={`${styles.board} ${isFullscreen ? styles.boardFullscreen : theme.bubble} ${selectedPlayers.length === 1 && !isFullscreen ? styles.boardSingle : ''}`}
          style={{ '--board-cols': boardCols } as React.CSSProperties}
          data-has-head=""
        >
          {/* Session header: program · Week N · day · time. Spans the board
              so it shows on the TV in full screen too. */}
          <div className={styles.sessionHead} style={{ '--prog': programHex } as React.CSSProperties}>
            <span className={styles.sessionProgram}>{program?.label ?? 'Program'}</span>
            {week && <span className={styles.sessionWeek}>Week {week}</span>}
            <span className={styles.sessionWhen}>
              {sessionDay}
              {timeValue && timeValue !== 'all' ? ` · ${formatTime12(timeValue)}` : ''}
            </span>
          </div>
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
              programBadge={badgeFor(p)}
              drills={drillsByPlayer[p.id] ?? []}
              loading={loadingByPlayer[p.id] ?? false}
              schedule={schedule}
              scheduleColor={scheduleColor}
              isCoach={isCoach}
              onClickDrill={(d) => setEditingDrill(d)}
              onPlayDrill={(d) => setViewingDrill(d)}
              checkedIn={checkedInIds ? checkedInIds.has(p.id) : null}
              sessionDate={sessionDate}
              noteHtml={notesByPlayer[p.id] ?? ''}
              noteReadOnly={isFullscreen}
              onNoteSaved={(h) => setNotesByPlayer(m => ({ ...m, [p.id]: h }))}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOverlay ? (
            <div className={activeOverlay.type === 'section' ? styles.dragGhostSection : styles.dragGhostDrill}>
              {activeOverlay.label}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      )}

      {/* Floating "Full Screen" trigger — only when there's a board to show */}
      {canFullscreen && !isFullscreen && (
        <button
          type="button"
          className={`${styles.fullscreenBtn} ${theme.field}`}
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

      {/* Inline drill editor — opens when a coach clicks a scheduled drill
          card. Edits Name / Time / Duration / Notes in place without
          going through the day-edit modal. Save calls
          api.updateScheduledDrill; Delete removes the slot entirely. */}
      {editingDrill && overBoard(
        <DrillEditor
          drill={editingDrill}
          onClose={closeEditor}
          onSave={saveEditor}
          onDelete={deleteEditor}
        />,
      )}


      {/* Drill video viewer — opens when a coach clicks a drill name. */}
      {viewingDrill && overBoard(
        <DrillVideoModal
          drill={viewingDrill}
          onClose={() => setViewingDrill(null)}
        />,
      )}
    </div>
  );
}
