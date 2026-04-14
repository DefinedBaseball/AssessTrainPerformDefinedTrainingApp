'use client';

import styles from './assessment.module.css';

interface Note {
  text: string;
  placeholder?: boolean;
}

interface NotesBoxProps {
  label: string;
  notes: Note[];
}

export function NotesBox({ label, notes }: NotesBoxProps) {
  return (
    <div className={styles.notesBox}>
      <div className={styles.notesLabel}>{label}</div>
      <div className={styles.notesContent}>
        {notes.map((note, i) => (
          <div
            key={i}
            className={styles.noteLine}
            style={i === notes.length - 1 ? { borderBottom: 'none' } : undefined}
          >
            <div
              className={styles.noteDot}
              style={note.placeholder ? { background: 'var(--faint)' } : undefined}
            />
            <div style={note.placeholder ? { color: 'var(--faint)', fontStyle: 'italic' } : undefined}>
              {note.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
