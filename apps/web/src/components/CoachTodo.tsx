'use client';

/* Coach Tasks board -- the coach dashboard, right under the four tiles.

   One column per coach (Jacob, Connor, Daniel, Cameron, then anyone added
   later). Admins add tasks (+) for All Coaches, one coach or several; a
   task shows in the column of every coach it's assigned to, and each
   column shows THAT coach's own copy -- checking it moves it to Finished
   for that coach only (only the coach can check their own). Everyone sees
   every column.

   Colour = task type (Urgent, Priority, General Task, Reminder, plus any
   types admins create). Admins use Edit (left of +) to choose which coaches
   have a column, pick each type's colour and add / rename / remove custom
   types; those board settings are shared by everyone. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import styles from './CoachTodo.module.css';

export const TASK_TYPES: Array<{ key: string; label: string }> = [
  { key: 'URGENT', label: 'Urgent' },
  { key: 'PRIORITY', label: 'Priority' },
  { key: 'GENERAL', label: 'General Task' },
  { key: 'REMINDER', label: 'Reminder' },
];
/* Fallbacks only -- the board settings from the server are the source. */
export const DEFAULT_TASK_COLORS: Record<api.CoachTaskType, string> = {
  URGENT: '#c8102e',
  PRIORITY: '#e8700f',
  GENERAL: '#15803d',
  REMINDER: '#2563eb',
};
/** Built-ins then the admin's custom types, in board order. */
function allTypesOf(board: api.CoachTaskBoard | null): Array<{ key: string; label: string }> {
  return [...TASK_TYPES, ...(board?.settings?.customTypes ?? [])];
}
const labelIn = (types: Array<{ key: string; label: string }>, key: string) =>
  types.find((t) => t.key === key)?.label ?? 'General Task';

/* Starting colours offered for a new custom type, in turn. */
const NEW_TYPE_COLORS = ['#7c3aed', '#0d9488', '#db2777', '#4b5563', '#ca8a04', '#0369a1'];

/** White or near-black text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.42 ? '#111111' : '#ffffff';
}

/* Column order the academy asked for; anyone else follows alphabetically. */
const COACH_ORDER = ['jacob', 'connor', 'daniel', 'cameron'];

type Coach = api.CoachTaskBoard['coaches'][number];

function displayName(c: Coach): string {
  return c.name?.trim().split(/\s+/)[0] || c.email.split('@')[0];
}

function orderCoaches(coaches: Coach[]): Coach[] {
  const rank = (c: Coach) => {
    const i = COACH_ORDER.indexOf(displayName(c).toLowerCase());
    return i === -1 ? COACH_ORDER.length : i;
  };
  return [...coaches].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)));
}

/** Who else shares a task, for the small line under its name. */
function sharedLabel(task: api.CoachTask, columnCoachId: string, coaches: Coach[]): string {
  if (task.allCoaches) return 'All Coaches';
  const others = task.assigneeIds
    .filter((id) => id !== columnCoachId)
    .map((id) => coaches.find((c) => c.id === id))
    .filter((c): c is Coach => !!c)
    .map(displayName);
  return others.length ? `With ${others.join(', ')}` : '';
}

export function CoachTodo() {
  const { user, isAdmin } = useAuth();
  const me = user?.id ?? '';
  const [board, setBoard] = useState<api.CoachTaskBoard | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'current' | 'finished'>('current');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getCoachTasks()
      .then((b) => { setBoard(b); setError(''); })
      .catch((e) => setError(e?.message || 'Could not load tasks'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const colors: Record<string, string> = { ...DEFAULT_TASK_COLORS, ...(board?.settings?.colors ?? {}) };
  const types = allTypesOf(board);
  const typeOrder = types.map((t) => t.key);
  const hidden = new Set(board?.settings?.hiddenCoachIds ?? []);
  /** Coaches with a column (checked in Edit), in the board's order. */
  const columnCoaches = useMemo(
    () => (board ? orderCoaches(board.coaches).filter((c) => !hidden.has(c.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board],
  );

  /* One column per shown coach, each holding that coach's copy of every
     task assigned to them, sorted Urgent → Priority → General → Reminder. */
  const columns = useMemo(() => {
    if (!board) return [];
    return columnCoaches.map((coach) => {
      const items = board.tasks
        .filter((t) => t.allCoaches || t.assigneeIds.includes(coach.id))
        .map((t) => ({ task: t, done: t.completions.some((c) => c.userId === coach.id) }))
        .sort((a, b) =>
          typeOrder.indexOf(a.task.column) - typeOrder.indexOf(b.task.column)
          || a.task.createdAt.localeCompare(b.task.createdAt));
      return { coach, items };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, columnCoaches]);

  const finishedCount = columns.reduce((n, col) => n + col.items.filter((i) => i.done).length, 0);

  const toggleDone = async (id: string, done: boolean) => {
    setBusyId(id);
    try {
      setBoard(await api.setCoachTaskDone(id, done));
    } catch (e: any) {
      setError(e?.message || 'Could not update the task');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      setBoard(await api.deleteCoachTask(id));
      setConfirmDeleteId(null);
    } catch (e: any) {
      setError(e?.message || 'Could not delete the task');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.card} aria-label="Tasks">
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <h2 className={styles.title}>Tasks</h2>
        </div>
        <div className={styles.headActions}>
          {isAdmin && board && (
            <button type="button" className={styles.editBtn} onClick={() => setEditing(true)} aria-label="Edit task board" title="Edit columns and colours">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          )}
          {isAdmin && (
            <button type="button" className={styles.addBtn} onClick={() => setAdding(true)} aria-label="Add task" title="Add task">
              +
            </button>
          )}
          <div className={styles.toggle} role="tablist" aria-label="Show">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'current'}
              className={`${styles.toggleBtn} ${view === 'current' ? styles.toggleOn : ''}`}
              onClick={() => setView('current')}
            >
              Current
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'finished'}
              className={`${styles.toggleBtn} ${view === 'finished' ? styles.toggleOn : ''}`}
              onClick={() => setView('finished')}
            >
              Finished{finishedCount ? ` (${finishedCount})` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Colour key */}
      <div className={styles.legend} aria-label="Task types">
        {types.map((t) => (
          <span key={t.key} className={styles.legendItem}>
            <i className={styles.legendDot} style={{ background: colors[t.key] }} aria-hidden="true" />
            {t.label}
          </span>
        ))}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {!board ? (
        <div className={styles.empty}>{error ? '' : 'Loading…'}</div>
      ) : columns.length === 0 ? (
        <div className={styles.empty}>
          {board.coaches.length === 0 ? 'No active coaches yet.' : 'No coach columns are turned on.'}
          {isAdmin && board.coaches.length > 0 && ' Use Edit to choose coaches.'}
        </div>
      ) : (
        <div className={styles.columns} style={{ '--cols': Math.min(columns.length, 4) } as React.CSSProperties}>
          {columns.map(({ coach, items }) => {
            const shown = items.filter((i) => (view === 'finished' ? i.done : !i.done));
            const isMe = coach.id === me;
            return (
              <div key={coach.id} className={styles.column}>
                <div className={styles.columnHead}>
                  <span className={styles.columnTitle}>{displayName(coach)}{isMe ? ' (you)' : ''}</span>
                  <span className={styles.columnHint}>
                    {items.filter((i) => !i.done).length} open
                  </span>
                </div>
                {shown.length === 0 ? (
                  <div className={styles.columnEmpty}>{view === 'current' ? 'All clear' : 'Nothing finished yet'}</div>
                ) : (
                  <ul className={styles.list}>
                    {shown.map(({ task, done }) => {
                      const bg = colors[task.column] ?? colors.GENERAL;
                      const fg = textOn(bg);
                      const shared = sharedLabel(task, coach.id, board.coaches);
                      const key = `${coach.id}:${task.id}`;
                      return (
                        <li key={key} className={styles.task} style={{ background: bg, color: fg }}>
                          <button
                            type="button"
                            className={`${styles.check} ${done ? styles.checkOn : ''}`}
                            style={{ borderColor: fg, color: bg, background: done ? fg : 'transparent' }}
                            onClick={() => isMe && void toggleDone(task.id, !done)}
                            disabled={!isMe || busyId === task.id}
                            aria-label={done ? `Move "${task.title}" back to current` : `Mark "${task.title}" finished`}
                            title={isMe ? (done ? 'Move back to current' : 'Mark finished') : `Only ${displayName(coach)} can check this off`}
                          >
                            {done ? '✓' : ''}
                          </button>
                          <div className={styles.taskText}>
                            <span className={styles.taskTitle}>{task.title}</span>
                            <span className={styles.taskMeta}>
                              {labelIn(types, task.column)}{shared ? ` · ${shared}` : ''}
                            </span>
                          </div>
                          {isAdmin && (confirmDeleteId === key ? (
                            <span className={styles.confirm}>
                              <button type="button" onClick={() => void remove(task.id)} disabled={busyId === task.id}>Delete</button>
                              <button type="button" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.deleteBtn}
                              style={{ color: fg }}
                              onClick={() => setConfirmDeleteId(key)}
                              aria-label={`Delete "${task.title}"`}
                              title={task.allCoaches || task.assigneeIds.length > 1 ? 'Delete task (for every coach)' : 'Delete task'}
                            >
                              ×
                            </button>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && board && (
        <AddTaskDialog
          coaches={columnCoaches}
          colors={colors}
          types={types}
          onClose={() => setAdding(false)}
          onCreated={(b) => { setBoard(b); setAdding(false); setView('current'); }}
        />
      )}

      {editing && board && (
        <BoardSettingsDialog
          board={board}
          onClose={() => setEditing(false)}
          onSaved={(b) => { setBoard(b); setEditing(false); }}
        />
      )}
    </section>
  );
}

/* ── Edit: coach columns + type colours ──────────────────────────────── */

function BoardSettingsDialog({
  board, onClose, onSaved,
}: {
  board: api.CoachTaskBoard;
  onClose: () => void;
  onSaved: (b: api.CoachTaskBoard) => void;
}) {
  const coaches = orderCoaches(board.coaches);
  const [shownIds, setShownIds] = useState<Set<string>>(
    () => new Set(coaches.map((c) => c.id).filter((id) => !(board.settings?.hiddenCoachIds ?? []).includes(id))),
  );
  const [colors, setColors] = useState<Record<string, string>>(
    () => ({ ...DEFAULT_TASK_COLORS, ...(board.settings?.colors ?? {}) }),
  );
  /* Custom types being edited. `id` is the saved key, or a temp id for a
     type added in this window (saved without a key → the server makes one). */
  const [custom, setCustom] = useState<Array<{ id: string; key?: string; label: string; color: string }>>(
    () => (board.settings?.customTypes ?? []).map((t) => ({
      id: t.key, key: t.key, label: t.label, color: board.settings?.colors?.[t.key] ?? '#6b7280',
    })),
  );
  const [focusId, setFocusId] = useState<string | null>(null);

  const addType = () => {
    const id = `new-${Date.now()}`;
    setCustom((c) => [...c, { id, label: '', color: NEW_TYPE_COLORS[c.length % NEW_TYPE_COLORS.length] }]);
    setFocusId(id);
  };
  const updateType = (id: string, patch: Partial<{ label: string; color: string }>) =>
    setCustom((c) => c.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeType = (id: string) => setCustom((c) => c.filter((t) => t.id !== id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleCoach = (id: string) => setShownIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const isDefaultColors = TASK_TYPES.every((t) => colors[t.key]?.toLowerCase() === DEFAULT_TASK_COLORS[t.key as api.CoachTaskType]);
  const removedCount = (board.settings?.customTypes ?? []).filter((t) => !custom.some((c) => c.key === t.key)).length;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      /* Keep hidden coaches who aren't active right now hidden too, so a
         paused coach doesn't pop back in when they're unpaused. */
      const otherHidden = (board.settings?.hiddenCoachIds ?? []).filter((id) => !coaches.some((c) => c.id === id));
      const hiddenCoachIds = [...otherHidden, ...coaches.filter((c) => !shownIds.has(c.id)).map((c) => c.id)];
      if (custom.some((t) => !t.label.trim())) {
        setError('Give every new task type a name (or remove it).');
        setSaving(false);
        return;
      }
      const builtInColors = Object.fromEntries(TASK_TYPES.map((t) => [t.key, colors[t.key]]));
      onSaved(await api.saveCoachTaskSettings({
        hiddenCoachIds,
        colors: builtInColors,
        customTypes: custom.map((t) => ({ ...(t.key ? { key: t.key } : {}), label: t.label.trim(), color: t.color })),
      }));
    } catch (e: any) {
      setError(e?.message || 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Edit task board">
        <div className={styles.dialogHead}>
          <h3 className={styles.title}>Edit Tasks</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.fieldLabel}>Coach columns</div>
        <p className={styles.fieldHint}>Checked coaches get a column on the board.</p>
        {coaches.length === 0 ? (
          <div className={styles.columnEmpty}>No active coaches.</div>
        ) : (
          <ul className={styles.checkList}>
            {coaches.map((c) => (
              <li key={c.id}>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={shownIds.has(c.id)} onChange={() => toggleCoach(c.id)} />
                  <span className={styles.checkName}>{displayName(c)}</span>
                  <span className={styles.checkSub}>{c.email}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.fieldLabel}>Task colours</div>
        <ul className={styles.colorList}>
          {TASK_TYPES.map((t) => (
            <li key={t.key} className={styles.colorRow}>
              <span className={styles.colorSample} style={{ background: colors[t.key], color: textOn(colors[t.key]) }}>
                {t.label}
              </span>
              <input
                type="color"
                className={styles.colorInput}
                value={colors[t.key]}
                onChange={(e) => setColors((c) => ({ ...c, [t.key]: e.target.value }))}
                aria-label={`${t.label} colour`}
              />
              <span className={styles.colorHex}>{colors[t.key].toUpperCase()}</span>
            </li>
          ))}
          {custom.map((t) => (
            <li key={t.id} className={styles.colorRow}>
              <input
                className={`${styles.colorSample} ${styles.colorName}`}
                style={{ background: t.color, color: textOn(t.color) }}
                value={t.label}
                maxLength={30}
                placeholder="Type name"
                autoFocus={focusId === t.id}
                onChange={(e) => updateType(t.id, { label: e.target.value })}
                aria-label="Task type name"
              />
              <input
                type="color"
                className={styles.colorInput}
                value={t.color}
                onChange={(e) => updateType(t.id, { color: e.target.value })}
                aria-label={`${t.label || 'New type'} colour`}
              />
              <span className={styles.colorHex}>{t.color.toUpperCase()}</span>
              <button
                type="button"
                className={styles.removeTypeBtn}
                onClick={() => removeType(t.id)}
                aria-label={`Remove ${t.label || 'this task type'}`}
                title="Remove this task type"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.addTypeBtn} onClick={addType}>
          + Add task type
        </button>
        {removedCount > 0 && (
          <p className={styles.fieldHint} style={{ marginTop: 8 }}>
            Tasks of a removed type move to General Task when you save.
          </p>
        )}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => setColors({ ...DEFAULT_TASK_COLORS })}
          disabled={isDefaultColors}
        >
          Reset colours
        </button>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add task ────────────────────────────────────────────────────────── */

function AddTaskDialog({
  coaches, colors, types, onClose, onCreated,
}: {
  coaches: Coach[];
  colors: Record<string, string>;
  types: Array<{ key: string; label: string }>;
  onClose: () => void;
  onCreated: (b: api.CoachTaskBoard) => void;
}) {
  const [type, setType] = useState<string>('URGENT');
  const [title, setTitle] = useState('');
  const [allCoaches, setAllCoaches] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleCoach = (id: string) => {
    setAllCoaches(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const bg = colors[type];
  const fg = textOn(bg);
  const ready = title.trim().length > 0 && (allCoaches || picked.length > 0);
  const who = allCoaches
    ? 'All Coaches'
    : picked.map((id) => coaches.find((c) => c.id === id)).filter((c): c is Coach => !!c).map(displayName).join(', ');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      onCreated(await api.createCoachTask({ title: title.trim(), column: type, allCoaches, assigneeIds: allCoaches ? [] : picked }));
    } catch (err: any) {
      setError(err?.message || 'Could not add the task');
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-label="Add task" onSubmit={submit}>
        <div className={styles.dialogHead}>
          <h3 className={styles.title}>Add Task</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.fieldLabel}>Type</div>
        <div className={styles.segment}>
          {types.map((tt) => (
            <button
              key={tt.key}
              type="button"
              className={`${styles.segmentBtn} ${type === tt.key ? styles.segmentOn : ''}`}
              style={type === tt.key ? { background: colors[tt.key], borderColor: colors[tt.key], color: textOn(colors[tt.key]) } : undefined}
              onClick={() => setType(tt.key)}
            >
              <i className={styles.legendDot} style={{ background: colors[tt.key] }} aria-hidden="true" /> {tt.label}
            </button>
          ))}
        </div>

        <label className={styles.fieldLabel} htmlFor="todo-title">Task</label>
        <input
          id="todo-title"
          className={styles.input}
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Upload this week's bullpen videos"
        />

        <div className={styles.fieldLabel}>Assign to</div>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${allCoaches ? styles.chipOn : ''}`}
            onClick={() => { setAllCoaches((v) => !v); setPicked([]); }}
          >
            All
          </button>
          {coaches.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.chip} ${picked.includes(c.id) ? styles.chipOn : ''}`}
              onClick={() => toggleCoach(c.id)}
              title={c.email}
            >
              {displayName(c)}
            </button>
          ))}
        </div>

        {(allCoaches || picked.length > 0) && (
          <div className={styles.preview} style={{ background: bg, color: fg }}>
            <span className={styles.check} style={{ borderColor: fg }} aria-hidden="true" />
            <div className={styles.taskText}>
              <span className={styles.taskTitle}>{title.trim() || 'Your task'}</span>
              <span className={styles.taskMeta}>{labelIn(types, type)} · {who}</span>
            </div>
          </div>
        )}

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={styles.primaryBtn} disabled={!ready || saving}>
            {saving ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
