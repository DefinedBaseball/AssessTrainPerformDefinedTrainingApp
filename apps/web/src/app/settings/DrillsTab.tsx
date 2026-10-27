'use client';

/* Settings → Drills (coaches).

   The whole drill library as a spreadsheet: a tab per position, then a tab
   per library category (Hitting = Movement Prep / Vision / Drills), each a
   one-column sheet of drill names. The bottom row is always blank: type a
   name and press Enter and the drill is in the library at once, with the
   cursor waiting in the new blank row -- so a list can be typed straight in.
   Drills filed outside a position's categories (Hitting's "Not on List"
   from the 2026-10 reshape) get a read-only tab of their own. */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DRILL_LIBRARY } from '@/lib/drill-taxonomy.generated';
import { TAB_LABELS } from '@/lib/training-colors';
import styles from './DrillsTab.module.css';
import pageStyles from './page.module.css';
import theme from '../dashTheme.module.css';

/* Position order as coaches asked for it. */
const POSITIONS = ['pitching', 'hitting', 'catching', 'infield', 'outfield', 'strength'];
const OTHER = '__other';

const keyOf = (s: string) => s.trim().toLowerCase();

/** The old section a "Not on List" drill came from (tags: was:<section>). */
function oldSection(d: api.Drill): string {
  const tags = (d as api.Drill & { tags?: string | null }).tags || '';
  return tags.split(',').map((t) => t.trim()).find((t) => t.startsWith('was:'))?.slice(4) || d.category;
}

export function DrillsTab() {
  const { isViewer } = useAuth();
  const [drills, setDrills] = useState<api.Drill[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pos, setPos] = useState('hitting');
  const [cat, setCat] = useState<string>((DRILL_LIBRARY.hitting || [])[0]?.id || '');
  /* Added this visit, in typing order: they stay at the bottom (just above
     the blank row) rather than jumping into alphabetical order mid-list. */
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    api.getDrills()
      .then(setDrills)
      .catch((e) => setLoadError(e?.message || 'Could not load the drill library.'));
  }, []);

  const cats = useMemo(() => DRILL_LIBRARY[pos] || [], [pos]);
  const known = useMemo(() => new Set(cats.map((c) => c.id)), [cats]);

  /* Drills per category tab for the open position (+ any filed elsewhere). */
  const byCat = useMemo(() => {
    const out: Record<string, api.Drill[]> = {};
    for (const d of drills || []) {
      if (d.tab !== pos) continue;
      (out[known.has(d.category) ? d.category : OTHER] ||= []).push(d);
    }
    return out;
  }, [drills, pos, known]);

  const isOther = cat === OTHER;
  const rows = useMemo(() => {
    const list = byCat[cat] || [];
    const added = addedIds.map((id) => list.find((d) => d.id === id)).filter((d): d is api.Drill => !!d);
    const rest = list.filter((d) => !addedIds.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name));
    return [...rest, ...added];
  }, [byCat, cat, addedIds]);

  const canAdd = !isViewer && !isOther;

  const switchTo = (p: string, c: string) => {
    setPos(p);
    setCat(c);
    setDraft('');
    setError('');
    setAddedIds([]);
  };

  const add = async () => {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name || saving) return;
    if (rows.some((d) => keyOf(d.name) === keyOf(name))) {
      setError(`"${name}" is already on this list.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createDrill({ name, tab: pos, category: cat });
      setDrills((prev) => [...(prev || []), created]);
      setAddedIds((prev) => [...prev, created.id]);
      setDraft('');
    } catch (e: any) {
      setError(e?.message || 'Could not add that drill.');
    } finally {
      setSaving(false);
      /* Back into the (new) blank row for the next name. */
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        bottomRef.current?.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  if (loadError) return <div className={pageStyles.card}><p className={pageStyles.feedbackErr}>{loadError}</p></div>;
  if (!drills) return <div className={pageStyles.card}><p className={pageStyles.rowSub}>Loading the drill library…</p></div>;

  const catTabs = [
    ...cats.map((c) => ({ id: c.id, label: c.id })),
    ...(byCat[OTHER]?.length ? [{ id: OTHER, label: 'Not on List' }] : []),
  ];

  return (
    <div className={pageStyles.section}>
      <div className={pageStyles.card}>
        <h3 className={pageStyles.cardTitle}>Drill Library</h3>
        <p className={pageStyles.cardDesc}>
          Every drill, by position and type.{!isViewer ? ' Type a new drill in the blank bottom row and press Enter to add it to the library.' : ''}
        </p>

        {/* Position tabs, then that position's drill types. */}
        <div className={styles.tabRow} role="tablist" aria-label="Position">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pos === p}
              className={`${styles.posTab} ${pos === p ? styles.posTabOn : `${theme.field} ${theme.firm}`}`}
              onClick={() => switchTo(p, (DRILL_LIBRARY[p] || [])[0]?.id || '')}
            >
              {TAB_LABELS[p] || p}
            </button>
          ))}
        </div>
        <div className={styles.catRow} role="tablist" aria-label="Drill type">
          {catTabs.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={`${styles.catTab} ${cat === c.id ? styles.catTabOn : ''}`}
              onClick={() => switchTo(pos, c.id)}
            >
              {c.label}
              <span className={styles.catCount}>{(byCat[c.id] || []).length}</span>
            </button>
          ))}
        </div>

        {isOther && (
          <p className={styles.note}>
            Drills that aren&apos;t in any of {TAB_LABELS[pos]}&apos;s sections (for Hitting: the old drills left off the new list).
            They no longer show in the calendar pickers or the Drill Library, but calendars that used them still do.
          </p>
        )}

        <div className={styles.sheetWrap}>
          <table className={styles.sheet}>
            <thead>
              <tr>
                <th className={styles.corner} aria-hidden="true" />
                <th className={styles.colHead}>Drill</th>
                {isOther && <th className={`${styles.colHead} ${styles.colNarrow}`}>Old Section</th>}
                <th className={`${styles.colHead} ${styles.colVideo}`}>Video</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={d.id} className={addedIds.includes(d.id) ? styles.rowNew : undefined}>
                  <th className={styles.rowNum} scope="row">{i + 1}</th>
                  <td className={styles.cell}>{d.name}</td>
                  {isOther && <td className={`${styles.cell} ${styles.muted}`}>{oldSection(d)}</td>}
                  <td className={`${styles.cell} ${styles.colVideo}`}>{d.videoUrl ? '✓' : ''}</td>
                </tr>
              ))}
              {canAdd && (
                <tr ref={bottomRef}>
                  <th className={styles.rowNum} scope="row">{rows.length + 1}</th>
                  <td className={`${styles.cell} ${styles.inputCell}`}>
                    <input
                      ref={inputRef}
                      className={styles.cellInput}
                      value={draft}
                      onChange={(e) => { setDraft(e.target.value); if (error) setError(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); add(); }
                        if (e.key === 'Escape') { setDraft(''); setError(''); }
                      }}
                      placeholder={saving ? 'Adding…' : cat === 'Drills' ? 'Type a new drill, then Enter…' : `Type a new ${cat} drill, then Enter…`}
                      aria-label={`Add a ${TAB_LABELS[pos]} ${cat} drill`}
                      disabled={saving}
                      maxLength={120}
                    />
                  </td>
                  <td className={`${styles.cell} ${styles.colVideo}`} />
                </tr>
              )}
              {!canAdd && rows.length === 0 && (
                <tr><td className={`${styles.cell} ${styles.muted}`} colSpan={4}>No drills here yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className={`${pageStyles.feedback} ${pageStyles.feedbackErr}`}>{error}</p>}
      </div>
    </div>
  );
}
