'use client';

/* Settings → Drills (coaches).

   The whole drill library as a spreadsheet: a tab per position, then a tab
   per library category (Hitting = Movement Prep / Vision / Drills), each a
   one-column sheet of drill names. The bottom row is always blank: type a
   name and press Enter and the drill is in the library at once, with the
   cursor waiting in the new blank row -- so a list can be typed straight in.

   After the drill types come the position's per-drill drop-down lists
   (Hitting: Feed Type / Implement / Situation / Goal; Pitching: Reps /
   Tool / Intensity-Goal) -- the same sheet, adding an option to the list
   the Modular set pickers offer. Drills filed outside a position's
   categories (Hitting's "Not on List" from the 2026-10 reshape) get a
   read-only tab last. */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DRILL_LIBRARY } from '@/lib/drill-taxonomy.generated';
import { DRILL_OPTION_FIELDS, optionsFor, setDrillOptionLists, useDrillOptionLists } from '@/lib/drill-options';
import { TAB_LABELS } from '@/lib/training-colors';
import styles from './DrillsTab.module.css';
import pageStyles from './page.module.css';
import theme from '../dashTheme.module.css';

/* Position order as coaches asked for it. */
const POSITIONS = ['pitching', 'hitting', 'catching', 'infield', 'outfield', 'strength'];
const OTHER = '__other';
const OPTION = 'opt:';

const keyOf = (s: string) => s.trim().toLowerCase();

/** The old section a "Not on List" drill came from (tags: was:<section>). */
function oldSection(d: api.Drill): string {
  const tags = (d as api.Drill & { tags?: string | null }).tags || '';
  return tags.split(',').map((t) => t.trim()).find((t) => t.startsWith('was:'))?.slice(4) || d.category;
}

/** One sheet row: a drill, or an option of a drop-down list. */
type Row = { id: string; name: string; video?: boolean; old?: string };

export function DrillsTab() {
  const { isViewer } = useAuth();
  const [drills, setDrills] = useState<api.Drill[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const optionLists = useDrillOptionLists();
  const [pos, setPos] = useState('hitting');
  const [tab, setTab] = useState<string>((DRILL_LIBRARY.hitting || [])[0]?.id || '');
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
  const optionFields = useMemo(() => DRILL_OPTION_FIELDS[pos] || [], [pos]);
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

  const field = tab.startsWith(OPTION) ? optionFields.find((f) => f.key === tab.slice(OPTION.length)) : undefined;
  const isOther = tab === OTHER;

  const rows: Row[] = useMemo(() => {
    /* Drop-down lists keep their own order (2, 4, 6 … / 30% … 100%). */
    if (field) return optionsFor(optionLists, pos, field).map((o) => ({ id: o, name: o }));
    const list = byCat[tab] || [];
    const added = addedIds.map((id) => list.find((d) => d.id === id)).filter((d): d is api.Drill => !!d);
    const rest = list.filter((d) => !addedIds.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name));
    return [...rest, ...added].map((d) => ({ id: d.id, name: d.name, video: !!d.videoUrl, old: isOther ? oldSection(d) : undefined }));
  }, [field, optionLists, pos, byCat, tab, addedIds, isOther]);

  const canEdit = !isViewer;
  const canAdd = canEdit && !isOther && (!field || !!optionLists);

  const switchTo = (p: string, t: string) => {
    setPos(p);
    setTab(t);
    setDraft('');
    setError('');
    setAddedIds([]);
  };

  const refocus = () => requestAnimationFrame(() => {
    inputRef.current?.focus();
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  });

  const add = async () => {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name || saving) return;
    if (rows.some((r) => keyOf(r.name) === keyOf(name))) {
      setError(`"${name}" is already on this list.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (field) {
        setDrillOptionLists(await api.addDrillOption(pos, field.key, name));
        setAddedIds((prev) => [...prev, name]);
      } else {
        const created = await api.createDrill({ name, tab: pos, category: tab });
        setDrills((prev) => [...(prev || []), created]);
        setAddedIds((prev) => [...prev, created.id]);
      }
      setDraft('');
    } catch (e: any) {
      setError(e?.message || 'Could not add that.');
    } finally {
      setSaving(false);
      refocus();
    }
  };

  const removeOption = async (value: string) => {
    if (!field || !window.confirm(`Remove "${value}" from ${field.label}? Drills already tagged with it keep it.`)) return;
    setError('');
    try {
      setDrillOptionLists(await api.removeDrillOption(pos, field.key, value));
    } catch (e: any) {
      setError(e?.message || 'Could not remove that option.');
    }
  };

  if (loadError) return <div className={pageStyles.card}><p className={pageStyles.feedbackErr}>{loadError}</p></div>;
  if (!drills) return <div className={pageStyles.card}><p className={pageStyles.rowSub}>Loading the drill library…</p></div>;

  const tabButton = (id: string, label: string, count: number) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`${styles.catTab} ${tab === id ? styles.catTabOn : ''}`}
      onClick={() => switchTo(pos, id)}
    >
      {label}
      <span className={styles.catCount}>{count}</span>
    </button>
  );
  const what = field ? `${field.label} option` : tab === 'Drills' ? 'drill' : `${tab} drill`;

  return (
    <div className={pageStyles.section}>
      <div className={pageStyles.card}>
        <h3 className={pageStyles.cardTitle}>Drill Library</h3>
        <p className={pageStyles.cardDesc}>
          Every drill, by position and type, plus the drop-down lists each drill gets in a Modular set.
          {canEdit ? ' Type in the blank bottom row and press Enter to add.' : ''}
        </p>

        {/* Position tabs, then that position's drill types and drop-downs. */}
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
          {cats.map((c) => tabButton(c.id, c.id, (byCat[c.id] || []).length))}
          {optionFields.length > 0 && (
            <>
              <span className={styles.catDivider} aria-hidden="true" />
              {optionFields.map((f) => tabButton(`${OPTION}${f.key}`, f.label, optionsFor(optionLists, pos, f).length))}
            </>
          )}
          {(byCat[OTHER]?.length ?? 0) > 0 && (
            <>
              <span className={styles.catDivider} aria-hidden="true" />
              {tabButton(OTHER, 'Not on List', byCat[OTHER].length)}
            </>
          )}
        </div>

        {isOther && (
          <p className={styles.note}>
            Drills that aren&apos;t in any of {TAB_LABELS[pos]}&apos;s sections (for Hitting: the old drills left off the new list).
            They no longer show in the calendar pickers or the Drill Library, but calendars that used them still do.
          </p>
        )}
        {field && (
          <p className={styles.note}>
            The {field.label} drop-down on each {TAB_LABELS[pos]} drill in a Modular set
            {field.single ? ' (one pick' : ' (pick any number'}
            {field.defaultPick ? `, starts at ${field.defaultPick}` : ''}).
          </p>
        )}

        <div className={styles.sheetWrap}>
          <table className={styles.sheet}>
            <thead>
              <tr>
                <th className={styles.corner} aria-hidden="true" />
                <th className={styles.colHead}>{field ? field.label : 'Drill'}</th>
                {isOther && <th className={`${styles.colHead} ${styles.colNarrow}`}>Old Section</th>}
                {field
                  ? (canEdit && <th className={`${styles.colHead} ${styles.colVideo}`} aria-label="Remove" />)
                  : <th className={`${styles.colHead} ${styles.colVideo}`}>Video</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={addedIds.includes(r.id) ? styles.rowNew : undefined}>
                  <th className={styles.rowNum} scope="row">{i + 1}</th>
                  <td className={styles.cell}>{r.name}{field?.suffix && <span className={styles.muted}>{field.suffix}</span>}</td>
                  {isOther && <td className={`${styles.cell} ${styles.muted}`}>{r.old}</td>}
                  {field
                    ? (canEdit && (
                      <td className={`${styles.cell} ${styles.colVideo}`}>
                        <button type="button" className={styles.removeBtn} onClick={() => removeOption(r.name)} aria-label={`Remove ${r.name}`} title="Remove">×</button>
                      </td>
                    ))
                    : <td className={`${styles.cell} ${styles.colVideo}`}>{r.video ? '✓' : ''}</td>}
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
                      inputMode={field?.key === 'reps' ? 'numeric' : undefined}
                      placeholder={saving ? 'Adding…' : `Type a new ${what}, then Enter…`}
                      aria-label={`Add a ${TAB_LABELS[pos]} ${what}`}
                      /* Read-only (not disabled) while saving: a disabled
                         field drops focus, and the cursor should stay put. */
                      readOnly={saving}
                      maxLength={field ? 60 : 120}
                    />
                  </td>
                  <td className={`${styles.cell} ${styles.colVideo}`} />
                </tr>
              )}
              {!canAdd && rows.length === 0 && (
                <tr><td className={`${styles.cell} ${styles.muted}`} colSpan={4}>Nothing here yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className={`${pageStyles.feedback} ${pageStyles.feedbackErr}`}>{error}</p>}
      </div>
    </div>
  );
}
