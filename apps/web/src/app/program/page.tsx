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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';
import { DRILL_TAXONOMY } from '@/lib/drill-taxonomy.generated';

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

/* Per-tab, per-category color matrix — DERIVED from the generated drill
   taxonomy (single source of truth shared with the Drill Library, Training
   modal, and training-colors). Unknown categories fall back to
   DEFAULT_CAT_COLOR via getTabCatStyle below. */
const TAB_CAT_COLORS: Record<string, Record<string, { dot: string; bg: string; text: string }>> =
  Object.fromEntries(
    Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, Record<string, { dot: string; bg: string; text: string }>] => [
      tab,
      Object.fromEntries(
        cats.map((c): [string, { dot: string; bg: string; text: string }] => [c.id, { dot: c.dot, bg: c.bg, text: c.text }]),
      ),
    ]),
  );

const DEFAULT_CAT_COLOR = { dot: '#5A9BD5', bg: 'rgba(90,155,213,0.13)', text: '#5A9BD5' };

/* Per-sport label anchor — the single shade EVERY category-card label
   in a column resolves to, regardless of which category that card is
   for. Replaces the prior "per-category light → dark gradient" treatment
   on the bubble head text, where a Movement Prep card label was pale
   blue and a Live card label was dark navy. Coach-spec called for all
   labels in a Hitting column to read in Batting Practice blue, all
   Pitching labels in Bullpen orange, and so on — picks the "core
   activity" shade per sport so every label sits at a consistent depth
   regardless of its position in the per-tab gradient. Applied
   universally (both themes) — the chosen shades are mid-saturation
   values that read against both the dark-mode surface and the light-
   mode `--panel-bg-light` surface. */
const TAB_LABEL_ANCHOR: Record<string, string> = {
  hitting:  '#4A90D9',  // Batting Practice
  pitching: '#F59E0B',  // Bullpen
  catching: '#14B8A6',  // Machine
  infield:  '#38A850',  // Machine
  outfield: '#88B838',  // Machine
  strength: '#EF4444',  // Exercises
};

function getTabCatStyle(tab: string, category: string) {
  const c = TAB_CAT_COLORS[tab]?.[category] || DEFAULT_CAT_COLOR;
  return {
    dotStyle: { background: c.dot },
    bgStyle: { background: c.bg, borderLeft: `3px solid ${c.dot}` },
    textStyle: { color: c.text },
    color: c.dot,
  };
}

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
  return formatLocalDate(new Date());
}

/* ── Timezone-safe date helpers ──────────────────────────────────────────
   `new Date('2026-04-30')` parses as UTC midnight, which displays as the
   PREVIOUS calendar day for any user west of UTC. The two helpers below
   keep every YYYY-MM-DD ↔ Date conversion in LOCAL time, so the calendar
   always lands on the day the coach actually picked regardless of the
   viewer's timezone. */

/** Parse a `YYYY-MM-DD` string as local-midnight (NOT UTC midnight). */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(s);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

/** Format a Date as `YYYY-MM-DD` using its LOCAL date components. */
function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Add a number of calendar days to a `YYYY-MM-DD` string, returning a new
 *  `YYYY-MM-DD` (handles month/year rollovers correctly via Date math). */
function addDays(yyyymmdd: string, days: number): string {
  const d = parseLocalDate(yyyymmdd);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
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
  schedule,
  scheduleColor,
  loading,
  isCoach,
  onDragStartDrill,
  onDropOnAthlete,
  onClickDrill,
}: {
  player: Player;
  drills: ScheduledDrill[];
  /** The active schedule key (hitting / pitching / catching / ...) —
   *  drives per-category color lookups so this column's bubbles
   *  graduate light→dark the same way the training calendar does. */
  schedule: ScheduleKey;
  scheduleColor: string;
  loading: boolean;
  isCoach: boolean;
  /** Coach started dragging this drill from this athlete's column. */
  onDragStartDrill: (drillId: string, fromPlayerId: string) => void;
  /** Coach dropped a drill onto this athlete's column.
   *  Swallow the event in the parent — the parent has the source info. */
  onDropOnAthlete: (toPlayerId: string) => void;
  /** Coach clicked a scheduled drill — opens the inline edit popover. */
  onClickDrill: (drill: ScheduledDrill) => void;
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

  /* Drag-over highlight for the column body. Visual cue that a dropped
     drill will land on this athlete. Coach-only — players never drag. */
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className={styles.athleteCard}>
      <div className={styles.athleteCardHead} style={{ borderTopColor: scheduleColor }}>
        <div className={styles.athleteName}>
          {player.firstName} <span className={styles.athleteLast}>{player.lastName}</span>
        </div>
        <div className={styles.athletePositions}>{player.positions || '—'}</div>
      </div>
      <div
        className={styles.athleteCardBody}
        onDragOver={(e) => {
          if (!isCoach) return;
          e.preventDefault(); // required for onDrop to fire
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!isCoach) return;
          e.preventDefault();
          setDragOver(false);
          onDropOnAthlete(player.id);
        }}
        style={dragOver ? {
          // Soft highlight for drop target — kept inline so we don't have
          // to add a new CSS class to the existing module.
          outline: `2px dashed ${scheduleColor}`,
          outlineOffset: -2,
          background: 'rgba(126, 182, 255, 0.04)',
        } : undefined}
      >
        {loading ? (
          <div className={styles.athleteEmpty}>Loading…</div>
        ) : drills.length === 0 ? (
          <div className={styles.athleteEmpty}>
            {isCoach ? 'No drills scheduled for today. Drag drills here from another athlete.' : 'No drills scheduled for today.'}
          </div>
        ) : (
          /* Category bubble layout — matches the training calendar's
             DayView. One tinted bubble per category, drill names listed
             inside separated by hairline dividers. Notes/time/duration
             drop out of the row to mirror the training-cal treatment;
             coaches still see and edit those by clicking a name (opens
             DrillEditor with the full record). Click + drag handlers
             attach to each name row, so reassign-by-drag still works. */
          grouped.map(({ category, items }) => {
            /* Per-category shading from the same matrix the training
             * calendar uses, so a Movement Prep bubble in /program
             * looks identical to a Movement Prep bubble in /training.
             * Categories within a schedule still graduate from
             * lightest (Movement Prep) → darkest (Live / Post-Throw). */
            const catStyle = getTabCatStyle(schedule, category);
            /* Per-sport label anchor — every category label in this
               column flips to the SAME `TAB_LABEL_ANCHOR[schedule]`
               shade (Hitting → Batting Practice blue, Pitching →
               Bullpen orange, etc.) regardless of which category the
               card represents. The card background + left border still
               graduate per-category via `catStyle.bgStyle` so the
               gradient cue lives on the card chrome instead of the
               label text. Falls back to `catStyle.textStyle` if the
               schedule key isn't in the anchor map (e.g. a future
               sport that hasn't been wired up yet). */
            const labelAnchor = TAB_LABEL_ANCHOR[schedule];
            const headStyle = labelAnchor ? { color: labelAnchor } : catStyle.textStyle;
            return (
              <div
                key={category}
                className={styles.athleteBubble}
                style={catStyle.bgStyle}
              >
                <div className={styles.athleteBubbleHead} style={headStyle}>
                  <span>{category}</span>
                  <span className={styles.athleteBubbleCount}>{items.length}</span>
                </div>
                <div className={styles.athleteBubbleList}>
                  {items.map((d) => (
                    <div
                      key={d.id}
                      className={styles.athleteBubbleItem}
                      draggable={isCoach}
                      onDragStart={(e) => {
                        if (!isCoach) return;
                        onDragStartDrill(d.id, player.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', d.id);
                      }}
                      onClick={() => { if (isCoach) onClickDrill(d); }}
                      title={isCoach ? 'Click to edit · drag to reassign' : undefined}
                      style={isCoach ? { cursor: 'grab' } : undefined}
                    >
                      <span className={styles.athleteBubbleItemName}>{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
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

  /* Refetch one or more athletes' schedule for the current sessionDate +
     schedule. Reused by the drag-drop and inline-edit handlers below so
     we don't have to do a full page reload after each mutation. */
  const refetchAthletes = async (playerIds: string[]) => {
    await Promise.all(playerIds.map(async (id) => {
      try {
        const rows = await api.getScheduledDrills(id, { date: sessionDate, tab: schedule });
        const sorted = [...rows].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        setDrillsByPlayer(prev => ({ ...prev, [id]: sorted }));
      } catch {
        setDrillsByPlayer(prev => ({ ...prev, [id]: prev[id] ?? [] }));
      }
    }));
  };

  /* Active drag state — set when a coach starts dragging a drill, read
     when they drop on a column. We keep both the drillId AND the source
     playerId so we know whether to refetch one column or two on drop. */
  const dragRef = useRef<{ drillId: string; fromPlayerId: string } | null>(null);
  const onDragStartDrill = (drillId: string, fromPlayerId: string) => {
    dragRef.current = { drillId, fromPlayerId };
  };
  const onDropOnAthlete = async (toPlayerId: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.fromPlayerId === toPlayerId) return; // dropped on self — no-op
    try {
      await api.updateScheduledDrill(drag.drillId, { playerId: toPlayerId } as any);
      // Refetch both columns so the moved drill disappears from source
      // and appears in target without a full page reload.
      await refetchAthletes([drag.fromPlayerId, toPlayerId]);
    } catch (e) {
      console.error('Drag-drop reassign failed', e);
    }
  };

  /* Inline-edit popover — set when coach clicks a drill, cleared on save
     / cancel / delete. Render is a small modal anchored center-screen. */
  const [editingDrill, setEditingDrill] = useState<ScheduledDrill | null>(null);
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
      // Use the local-date helpers so the "next year" / "last year" window
      // doesn't wobble across a UTC date boundary.
      const oneYear = new Date();
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      const endDate = formatLocalDate(oneYear);
      const all = await Promise.all(selectedIds.map(id =>
        api.getScheduledDrills(id, { startDate: today, endDate, tab: schedule })
          .catch(() => [] as ScheduledDrill[]),
      ));
      const dates = all.flat().map(d => d.date).filter(Boolean).sort();
      if (dates.length === 0) {
        // Fall back to the past year — maybe everything they have is older.
        const aYearAgo = new Date();
        aYearAgo.setFullYear(aYearAgo.getFullYear() - 1);
        const startBack = formatLocalDate(aYearAgo);
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
    if (selectedIds.length < 1) return;
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
  const canFullscreen = selectedPlayers.length >= 1;

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
            Athletes <span className={styles.filterHint}>(1–8)</span>
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
            Choose 1 to 8 athletes from the dropdown above. Each athlete&apos;s
            scheduled {SCHEDULE_OPTIONS.find(o => o.key === schedule)?.label} workout
            for the session date will appear side-by-side here.
          </p>
        </div>
      ) : (
        <div
          ref={boardRef}
          className={`${styles.board} ${isFullscreen ? styles.boardFullscreen : ''} ${selectedPlayers.length === 1 && !isFullscreen ? styles.boardSingle : ''}`}
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
              schedule={schedule}
              scheduleColor={scheduleColor}
              isCoach={isCoach}
              onDragStartDrill={onDragStartDrill}
              onDropOnAthlete={onDropOnAthlete}
              onClickDrill={(d) => setEditingDrill(d)}
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

      {/* Inline drill editor — opens when a coach clicks a scheduled drill
          card. Edits Name / Time / Duration / Notes in place without
          going through the day-edit modal. Save calls
          api.updateScheduledDrill; Delete removes the slot entirely. */}
      {editingDrill && (
        <DrillEditor
          drill={editingDrill}
          onClose={closeEditor}
          onSave={saveEditor}
          onDelete={deleteEditor}
        />
      )}
    </div>
  );
}
