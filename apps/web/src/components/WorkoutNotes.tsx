'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Workout Notes — the coach's notes for ONE athlete's workout on ONE day
   (one per workout type: Hitting, Pitching, ...).

   The same note shows in two places and both read and write the same saved
   row (WorkoutNote: player + date + workout type):
     • the top of that workout on the athlete's Training calendar
     • under the athlete's workout on the Program board
   so typing in either updates the other.

   Coaches type and it saves on its own (shortly after typing stops, and
   when the box is closed). "Report" pulls in the Notes from the athlete's
   latest report of the matching type (Hitting workout → latest Hitting
   report). Athletes, parents and read-only displays (the Program board's
   full-screen TV mode) see the note without the editor, and nothing at all
   when it is blank.

   Mount it with a `key` of player|date|tab so a different day starts fresh.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as api from '@/lib/api';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeHtml, isBlankNoteHtml } from '@/lib/sanitize';
import styles from './WorkoutNotes.module.css';

/** Report notes saved before the rich editor are plain text: keep their line breaks. */
function asHtml(notes: string): string {
  if (/<[a-z][\s\S]*>/i.test(notes)) return notes;
  return notes
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function WorkoutNotes({
  playerId,
  date,
  tab,
  label,
  html,
  canEdit,
  accent,
  onSaved,
  minHeight = 64,
  style,
}: {
  playerId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Workout type: hitting / pitching / catching / infield / outfield / strength. */
  tab: string;
  /** "Hitting" -- titles the box ("Hitting Notes"). */
  label: string;
  /** The saved note (HTML), '' when there is none. */
  html: string;
  /** Coach editing; false = read-only (athlete, parent, TV mode). */
  canEdit: boolean;
  /** Title colour (the workout's colour). */
  accent?: string;
  /** Tell the page what is now saved, so its other views stay in step. */
  onSaved?: (html: string) => void;
  minHeight?: number;
  style?: CSSProperties;
}) {
  const [value, setValue] = useState(html);
  const valueRef = useRef(html);   // latest typed value (for the unmount flush)
  const savedRef = useRef(html);   // what the server has
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [pulling, setPulling] = useState(false);
  const hasReport = tab !== 'strength';

  /* A newer saved copy arrived (saved from the other place, or reloaded):
     take it unless the coach has unsaved typing here. */
  useEffect(() => {
    if (valueRef.current === savedRef.current) {
      setValue(html);
      valueRef.current = html;
    }
    savedRef.current = html;
  }, [html]);

  const save = async (next: string) => {
    if (next === savedRef.current) return;
    setStatus('saving');
    try {
      const res = await api.saveWorkoutNote({ playerId, date, tab, html: next });
      savedRef.current = next;
      setStatus('saved');
      onSaved?.(res.html ?? '');
    } catch (e: any) {
      setStatus('error');
      setMsg(e?.message || 'Could not save');
    }
  };

  /* Save on its own: shortly after typing stops, and when the box goes
     away (another day, another workout, leaving the page). */
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      if (valueRef.current !== savedRef.current) {
        void api.saveWorkoutNote({ playerId, date, tab, html: valueRef.current }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount flush only
  }, []);

  const change = (h: string) => {
    const next = isBlankNoteHtml(h) ? '' : h;
    setValue(next);
    valueRef.current = next;
    setMsg('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(next); }, 900);
  };

  const pullReport = async () => {
    setMsg('');
    setPulling(true);
    try {
      const { report } = await api.getLatestReportNotes(playerId, tab);
      if (!report) { setMsg(`No ${label} report notes yet`); return; }
      const add = asHtml(report.notes);
      const cur = valueRef.current;
      if (!isBlankNoteHtml(cur) && cur.includes(add)) { setMsg('Those report notes are already here'); return; }
      const next = isBlankNoteHtml(cur) ? add : `${cur}<br><br>${add}`;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setValue(next);
      valueRef.current = next;
      await save(next);
      setMsg(`Added from ${report.title || `${label} report`} · ${shortDate(report.createdAt)}`);
    } catch (e: any) {
      setMsg(e?.message || 'Could not load the report notes');
    } finally {
      setPulling(false);
    }
  };

  const title = (
    <span className={styles.title} style={accent ? { color: accent } : undefined}>{label} Notes</span>
  );

  if (!canEdit) {
    if (isBlankNoteHtml(value)) return null;
    return (
      /* data-workout-note* hooks let a host restyle the read-only card (the
         Program board's full-screen TV mode scales it with the drills). */
      <div className={styles.card} style={style} data-workout-note="">
        <div className={styles.head} data-workout-note-head="">{title}</div>
        <div className={styles.body} data-workout-note-body="" dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }} />
      </div>
    );
  }

  const statusText = msg || (status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : '');

  return (
    <div className={styles.wrap} style={style}>
      <RichTextEditor
        value={value}
        onChange={change}
        placeholder={`Notes for this ${label} workout…`}
        minHeight={minHeight}
        className={styles.editorCard}
        label={
          <span className={styles.headRow}>
            {title}
            {hasReport && (
              <button
                type="button"
                className={styles.reportBtn}
                onClick={pullReport}
                disabled={pulling}
                title={`Add the notes from the latest ${label} report`}
                style={accent ? { borderColor: accent, color: accent } : undefined}
              >
                {pulling ? '…' : 'Report'}
              </button>
            )}
          </span>
        }
        editorStyle={{
          background: 'var(--notes-bg, transparent)',
          border: 'none',
          borderRadius: 0,
          padding: '8px 10px',
          fontSize: '0.85rem',
          wordBreak: 'break-word',
        }}
      />
      {statusText && (
        <div className={`${styles.status} ${status === 'error' ? styles.statusError : ''}`} aria-live="polite">
          {statusText}
        </div>
      )}
    </div>
  );
}

export default WorkoutNotes;
