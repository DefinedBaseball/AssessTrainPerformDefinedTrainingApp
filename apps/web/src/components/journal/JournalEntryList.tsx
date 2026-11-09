'use client';

/* ─────────────────────────────────────────────────────────────────────────
   A list of journal entries, newest first: the day, each question with the
   athlete's answer, and their other thoughts.

   Shared by the athlete's Journal (with Edit / Delete on their own entries)
   and the coach's "Personal Notes" on a report tab (read-only). Answers are
   plain text and render as text (React escapes them), keeping line breaks.
   ───────────────────────────────────────────────────────────────────────── */
import type { JournalEntry } from '@/lib/api';
import styles from './Journal.module.css';

export function journalDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function JournalEntryList({
  entries,
  emptyText,
  onEdit,
  onDelete,
  busyId,
}: {
  entries: JournalEntry[];
  emptyText: string;
  /** Owner only: edit / delete controls on each entry. */
  onEdit?: (e: JournalEntry) => void;
  onDelete?: (e: JournalEntry) => void;
  busyId?: string | null;
}) {
  if (entries.length === 0) return <div className={styles.empty}>{emptyText}</div>;
  return (
    <div className={styles.list}>
      {entries.map((e) => (
        <article key={e.id} className={styles.entry}>
          <header className={styles.entryHead}>
            <span className={styles.entryDate}>{journalDayLabel(e.date)}</span>
            {(onEdit || onDelete) && (
              <span className={styles.entryActions}>
                {onEdit && (
                  <button type="button" className={styles.linkBtn} onClick={() => onEdit(e)} disabled={busyId === e.id}>
                    Edit
                  </button>
                )}
                {onDelete && (
                  <button type="button" className={`${styles.linkBtn} ${styles.linkDanger}`} onClick={() => onDelete(e)} disabled={busyId === e.id}>
                    {busyId === e.id ? '…' : 'Delete'}
                  </button>
                )}
              </span>
            )}
          </header>
          {e.answers.map((a, i) => (
            <div key={i} className={styles.qa}>
              <div className={styles.q}>{a.question}</div>
              <div className={styles.a}>{a.answer}</div>
            </div>
          ))}
          {e.thoughts && (
            <div className={styles.qa}>
              <div className={styles.q}>Other thoughts</div>
              <div className={styles.a}>{e.thoughts}</div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
