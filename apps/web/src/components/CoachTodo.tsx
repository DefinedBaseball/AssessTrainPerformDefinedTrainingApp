'use client';

/* Coach To Do list -- the coach dashboard, right under the four tiles.

   Four columns: Urgent, Long Term, Daily, Weekly. Admins add tasks (+) and
   assign them to one coach, several, or All Coaches; everyone sees every
   task, coloured by who it's for.

   Finishing is PER COACH: checking a task moves it to Finished on your
   dashboard only -- the other assigned coaches still have it until they
   check it too. A coach who isn't assigned sees it finished once every
   assigned coach has. Daily tasks come back each day and Weekly each
   Monday (academy time zone): a check only counts for the current day /
   week. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { tzDayKey, tzOpt } from '@/lib/academy';
import styles from './CoachTodo.module.css';

const COLUMNS: Array<{ key: api.CoachTaskColumn; label: string; hint: string }> = [
  { key: 'URGENT', label: 'Urgent', hint: 'Do these first' },
  { key: 'LONG_TERM', label: 'Long Term', hint: 'Bigger projects' },
  { key: 'DAILY', label: 'Daily', hint: 'Comes back every day' },
  { key: 'WEEKLY', label: 'Weekly', hint: 'Comes back every Monday' },
];

/* ── Colours ─────────────────────────────────────────────────────────── */

interface TaskTheme { bg: string; fg: string; label: string }

const BLACK = { bg: '#000000', fg: '#ffffff' };
const GREY = { bg: '#6b7280', fg: '#ffffff' };
const SOLO: Record<string, { bg: string; fg: string }> = {
  connor: { bg: '#1b2a4e', fg: '#ffffff' }, // navy
  daniel: { bg: '#7b1e2e', fg: '#ffffff' }, // maroon
  cameron: { bg: '#6b2fa3', fg: '#ffffff' }, // purple
  jacob: { bg: '#c8102e', fg: '#ffffff' }, // red
};
const HITTING = ['connor', 'daniel'];
const PITCHING = ['jacob', 'cameron'];
const ROYAL = { bg: '#2a5bd7', fg: '#ffffff' };
const ORANGE = { bg: '#e8700f', fg: '#ffffff' };

type Coach = api.CoachTaskBoard['coaches'][number];

function displayName(c: Coach): string {
  return c.name?.trim().split(/\s+/)[0] || c.email.split('@')[0];
}

export function taskTheme(allCoaches: boolean, assigneeIds: string[], coaches: Coach[]): TaskTheme {
  if (allCoaches) return { ...BLACK, label: 'All Coaches' };
  const people = assigneeIds
    .map((id) => coaches.find((c) => c.id === id))
    .filter((c): c is Coach => !!c);
  const keys = people.map((c) => displayName(c).toLowerCase());
  if (people.length === 0) return { ...GREY, label: 'Unassigned' };
  if (people.length === 1) return { ...(SOLO[keys[0]] ?? GREY), label: displayName(people[0]) };
  if (keys.every((k) => HITTING.includes(k))) return { ...ROYAL, label: 'Hitting Coaches' };
  if (keys.every((k) => PITCHING.includes(k))) return { ...ORANGE, label: 'Pitching Coaches' };
  return { ...GREY, label: people.map(displayName).join(' & ') };
}

/* ── Daily / weekly reset ────────────────────────────────────────────── */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** YYYY-MM-DD of the Monday starting the week `d` falls in (academy zone). */
function weekKey(d: Date): string {
  const [y, m, day] = tzDayKey(d).split('-').map(Number);
  const offset = Math.max(0, WEEKDAYS.indexOf(d.toLocaleDateString('en-US', { ...tzOpt(), weekday: 'short' })));
  return new Date(Date.UTC(y, m - 1, day - offset)).toISOString().slice(0, 10);
}

/** Does a check made at `completedAt` still count right now? */
function stillCounts(column: api.CoachTaskColumn, completedAt: string, now: Date): boolean {
  const at = new Date(completedAt);
  if (column === 'DAILY') return tzDayKey(at) === tzDayKey(now);
  if (column === 'WEEKLY') return weekKey(at) === weekKey(now);
  return true;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function CoachTodo() {
  const { user, isAdmin } = useAuth();
  const me = user?.id ?? '';
  const [board, setBoard] = useState<api.CoachTaskBoard | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'current' | 'finished'>('current');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /* Re-evaluated every minute so Daily / Weekly tasks reappear at the
     turnover without a reload. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(() => {
    api.getCoachTasks()
      .then((b) => { setBoard(b); setError(''); })
      .catch((e) => setError(e?.message || 'Could not load the To Do list'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!board) return [];
    const activeIds = board.coaches.map((c) => c.id);
    return board.tasks.map((t) => {
      const assigned = t.allCoaches ? activeIds : t.assigneeIds;
      const doneBy = new Set(
        t.completions.filter((c) => stillCounts(t.column, c.completedAt, now)).map((c) => c.userId),
      );
      const mine = t.allCoaches || t.assigneeIds.includes(me);
      const doneCount = assigned.filter((id) => doneBy.has(id)).length;
      const finished = mine ? doneBy.has(me) : assigned.length > 0 && doneCount === assigned.length;
      return { task: t, mine, finished, doneCount, total: assigned.length, theme: taskTheme(t.allCoaches, t.assigneeIds, board.coaches) };
    });
  }, [board, me, now]);

  const visible = rows.filter((r) => (view === 'finished' ? r.finished : !r.finished));
  const finishedCount = rows.filter((r) => r.finished).length;
  const currentCount = rows.length - finishedCount;

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
    <section className={styles.card} aria-label="To Do list">
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <h2 className={styles.title}>To Do</h2>
          <span className={styles.count}>{view === 'current' ? currentCount : finishedCount}</span>
        </div>
        <div className={styles.headActions}>
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

      {error && <div className={styles.error} role="alert">{error}</div>}

      {!board ? (
        <div className={styles.empty}>{error ? '' : 'Loading…'}</div>
      ) : (
        <div className={styles.columns}>
          {COLUMNS.map((col) => {
            const items = visible.filter((r) => r.task.column === col.key);
            return (
              <div key={col.key} className={styles.column}>
                <div className={styles.columnHead}>
                  <span className={styles.columnTitle}>{col.label}</span>
                  <span className={styles.columnHint}>{col.hint}</span>
                </div>
                {items.length === 0 ? (
                  <div className={styles.columnEmpty}>{view === 'current' ? 'All clear' : 'Nothing finished yet'}</div>
                ) : (
                  <ul className={styles.list}>
                    {items.map(({ task, mine, finished, doneCount, total, theme }) => (
                      <li key={task.id} className={styles.task} style={{ background: theme.bg, color: theme.fg }}>
                        <button
                          type="button"
                          className={`${styles.check} ${finished ? styles.checkOn : ''}`}
                          style={{ borderColor: theme.fg, color: theme.bg, background: finished ? theme.fg : 'transparent' }}
                          onClick={() => mine && void toggleDone(task.id, !finished)}
                          disabled={!mine || busyId === task.id}
                          aria-label={finished ? `Move "${task.title}" back to current` : `Mark "${task.title}" finished`}
                          title={mine ? (finished ? 'Move back to current' : 'Mark finished') : `Assigned to ${theme.label}`}
                        >
                          {finished ? '✓' : ''}
                        </button>
                        <div className={styles.taskText}>
                          <span className={styles.taskTitle}>{task.title}</span>
                          <span className={styles.taskMeta}>
                            {theme.label}
                            {total > 1 && ` · ${doneCount}/${total} done`}
                          </span>
                        </div>
                        {isAdmin && (confirmDeleteId === task.id ? (
                          <span className={styles.confirm}>
                            <button type="button" onClick={() => void remove(task.id)} disabled={busyId === task.id}>Delete</button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            style={{ color: theme.fg }}
                            onClick={() => setConfirmDeleteId(task.id)}
                            aria-label={`Delete "${task.title}"`}
                            title="Delete task"
                          >
                            ×
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && board && (
        <AddTaskDialog
          coaches={board.coaches}
          onClose={() => setAdding(false)}
          onCreated={(b) => { setBoard(b); setAdding(false); setView('current'); }}
        />
      )}
    </section>
  );
}

/* ── Add task ────────────────────────────────────────────────────────── */

function AddTaskDialog({
  coaches, onClose, onCreated,
}: {
  coaches: Coach[];
  onClose: () => void;
  onCreated: (b: api.CoachTaskBoard) => void;
}) {
  const [column, setColumn] = useState<api.CoachTaskColumn>('URGENT');
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

  const theme = taskTheme(allCoaches, picked, coaches);
  const ready = title.trim().length > 0 && (allCoaches || picked.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      onCreated(await api.createCoachTask({ title: title.trim(), column, allCoaches, assigneeIds: allCoaches ? [] : picked }));
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

        <div className={styles.fieldLabel}>Column</div>
        <div className={styles.segment}>
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`${styles.segmentBtn} ${column === c.key ? styles.segmentOn : ''}`}
              onClick={() => setColumn(c.key)}
            >
              {c.label}
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
            All Coaches
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
          <div className={styles.preview} style={{ background: theme.bg, color: theme.fg }}>
            <span className={styles.check} style={{ borderColor: theme.fg }} aria-hidden="true" />
            <div className={styles.taskText}>
              <span className={styles.taskTitle}>{title.trim() || 'Your task'}</span>
              <span className={styles.taskMeta}>{theme.label}</span>
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
