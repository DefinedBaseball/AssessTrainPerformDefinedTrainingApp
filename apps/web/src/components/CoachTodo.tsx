'use client';

/* Coach To Do list -- the coach dashboard, right under the four tiles.

   One column per coach (Jacob, Connor, Daniel, Cameron, then anyone added
   later). Admins add tasks (+) for All Coaches, one coach or several; a
   task shows in the column of every coach it's assigned to, and each
   column shows THAT coach's own copy -- checking it moves it to Finished
   for that coach only (only the coach can check their own). Everyone sees
   every column.

   Colour = task type: Urgent red, Priority orange, General Task green,
   Reminder blue. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import styles from './CoachTodo.module.css';

export const TASK_TYPES: Array<{ key: api.CoachTaskType; label: string; bg: string }> = [
  { key: 'URGENT', label: 'Urgent', bg: '#c8102e' },
  { key: 'PRIORITY', label: 'Priority', bg: '#e8700f' },
  { key: 'GENERAL', label: 'General Task', bg: '#15803d' },
  { key: 'REMINDER', label: 'Reminder', bg: '#2563eb' },
];
const TYPE_ORDER = TASK_TYPES.map((t) => t.key);
const typeOf = (key: string) => TASK_TYPES.find((t) => t.key === key) ?? TASK_TYPES[2];

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getCoachTasks()
      .then((b) => { setBoard(b); setError(''); })
      .catch((e) => setError(e?.message || 'Could not load the To Do list'));
  }, []);
  useEffect(() => { load(); }, [load]);

  /* One column per coach, each holding that coach's copy of every task
     assigned to them, sorted Urgent → Priority → General → Reminder. */
  const columns = useMemo(() => {
    if (!board) return [];
    return orderCoaches(board.coaches).map((coach) => {
      const items = board.tasks
        .filter((t) => t.allCoaches || t.assigneeIds.includes(coach.id))
        .map((t) => ({ task: t, done: t.completions.some((c) => c.userId === coach.id) }))
        .sort((a, b) =>
          TYPE_ORDER.indexOf(a.task.column) - TYPE_ORDER.indexOf(b.task.column)
          || a.task.createdAt.localeCompare(b.task.createdAt));
      return { coach, items };
    });
  }, [board]);

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
    <section className={styles.card} aria-label="To Do list">
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <h2 className={styles.title}>To Do</h2>
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

      {/* Colour key */}
      <div className={styles.legend} aria-label="Task types">
        {TASK_TYPES.map((t) => (
          <span key={t.key} className={styles.legendItem}>
            <i className={styles.legendDot} style={{ background: t.bg }} aria-hidden="true" />
            {t.label}
          </span>
        ))}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {!board ? (
        <div className={styles.empty}>{error ? '' : 'Loading…'}</div>
      ) : columns.length === 0 ? (
        <div className={styles.empty}>No active coaches yet.</div>
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
                      const type = typeOf(task.column);
                      const shared = sharedLabel(task, coach.id, board.coaches);
                      const key = `${coach.id}:${task.id}`;
                      return (
                        <li key={key} className={styles.task} style={{ background: type.bg, color: '#ffffff' }}>
                          <button
                            type="button"
                            className={`${styles.check} ${done ? styles.checkOn : ''}`}
                            style={{ borderColor: '#ffffff', color: type.bg, background: done ? '#ffffff' : 'transparent' }}
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
                              {type.label}{shared ? ` · ${shared}` : ''}
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
                              style={{ color: '#ffffff' }}
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
          coaches={orderCoaches(board.coaches)}
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
  const [type, setType] = useState<api.CoachTaskType>('URGENT');
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

  const t = typeOf(type);
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
          {TASK_TYPES.map((tt) => (
            <button
              key={tt.key}
              type="button"
              className={`${styles.segmentBtn} ${type === tt.key ? styles.segmentOn : ''}`}
              style={type === tt.key ? { background: tt.bg, borderColor: tt.bg, color: '#ffffff' } : undefined}
              onClick={() => setType(tt.key)}
            >
              <i className={styles.legendDot} style={{ background: tt.bg }} aria-hidden="true" /> {tt.label}
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
          <div className={styles.preview} style={{ background: t.bg, color: '#ffffff' }}>
            <span className={styles.check} style={{ borderColor: '#ffffff' }} aria-hidden="true" />
            <div className={styles.taskText}>
              <span className={styles.taskTitle}>{title.trim() || 'Your task'}</span>
              <span className={styles.taskMeta}>{t.label} · {who}</span>
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
