'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Settings → Journal — the questions athletes answer in each area's
   journal (Hitting Journal, Pitching Journal, ...).

   Each area starts with a few default questions. Coaches add, reword,
   reorder and remove them here; Save replaces the area's list. A removed
   question is only retired: athletes' past entries keep the question text
   they answered. View-only coaches see the lists without editing.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { JournalArea } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import styles from './page.module.css';
import eduStyles from '../education/page.module.css';

const AREA_LABEL: Record<JournalArea, string> = {
  hitting: 'Hitting', pitching: 'Pitching', catching: 'Catching', infield: 'Infield', outfield: 'Outfield',
};

type Row = { id?: string; text: string; key: string };
/* Compact square ↑ ↓ ✕ so a row fits a phone screen beside its question. */
const ICON_BTN: React.CSSProperties = { padding: '6px 0', width: 30, minWidth: 30, flex: '0 0 30px', textAlign: 'center' };
let keySeq = 0;
const nextKey = () => `q${++keySeq}`;

export function JournalTab() {
  const { isViewer } = useAuth();
  const canEdit = !isViewer;
  const [area, setArea] = useState<JournalArea>('hitting');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saved, setSaved] = useState<string>('[]');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const load = (a: JournalArea) => {
    setRows(null);
    setError('');
    setOkMsg('');
    api.getJournalQuestions(a)
      .then((qs) => {
        const r = qs.map((q) => ({ id: q.id, text: q.text, key: nextKey() }));
        setRows(r);
        setSaved(JSON.stringify(r.map(({ id, text }) => ({ id, text }))));
      })
      .catch((e) => { setRows([]); setError(e?.message || 'Could not load the questions'); });
  };
  useEffect(() => { load(area); }, [area]);

  const dirty = rows !== null && JSON.stringify(rows.map(({ id, text }) => ({ id, text }))) !== saved;

  const switchArea = (a: JournalArea) => {
    if (a === area) return;
    if (dirty && typeof window !== 'undefined' && !window.confirm('Discard your unsaved question changes?')) return;
    setArea(a);
  };

  const update = (key: string, text: string) => setRows((r) => (r ?? []).map((x) => (x.key === key ? { ...x, text } : x)));
  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const list = [...(r ?? [])];
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
  const remove = (key: string) => setRows((r) => (r ?? []).filter((x) => x.key !== key));
  const add = () => setRows((r) => [...(r ?? []), { text: '', key: nextKey() }]);

  const save = async () => {
    if (!rows) return;
    const clean = rows.map((r) => ({ ...r, text: r.text.trim() }));
    if (clean.some((r) => !r.text)) { setError('Fill in or remove the blank question.'); return; }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const qs = await api.saveJournalQuestions(area, clean.map(({ id, text }) => (id ? { id, text } : { text })));
      const r = qs.map((q) => ({ id: q.id, text: q.text, key: nextKey() }));
      setRows(r);
      setSaved(JSON.stringify(r.map(({ id, text }) => ({ id, text }))));
      setOkMsg('Saved');
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Journal Questions</h3>
        <p className={styles.cardDesc}>
          The questions athletes answer in each area&rsquo;s journal, opened from the Journal button beside
          Videos on their profile. Coaches read the answers under <strong>Personal Notes</strong> on that
          area&rsquo;s report tab. Removing a question never changes entries athletes already wrote.
        </p>

        <div className={eduStyles.sportTabs} role="tablist" aria-label="Journal area" style={{ marginBottom: 14 }}>
          {api.JOURNAL_AREAS.map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={area === a}
              className={`${eduStyles.sportTab} ${area === a ? eduStyles.sportTabActive : ''}`}
              onClick={() => switchArea(a)}
            >
              {AREA_LABEL[a]}
            </button>
          ))}
        </div>

        {rows === null ? (
          <div className={styles.cardDesc}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.length === 0 && <div className={styles.cardDesc}>No questions. Athletes will only see &ldquo;Other thoughts&rdquo;.</div>}
            {rows.map((r, i) => (
              <div key={r.key} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <span style={{ width: 18, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, flex: '0 0 auto' }}>{i + 1}.</span>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0, width: 'auto' }}
                  value={r.text}
                  onChange={(e) => update(r.key, e.target.value)}
                  placeholder="Type a question…"
                  maxLength={300}
                  disabled={!canEdit || saving}
                  aria-label={`Question ${i + 1}`}
                />
                {canEdit && (
                  <>
                    <button type="button" className={styles.btnSecondary} style={ICON_BTN} onClick={() => move(i, -1)} disabled={i === 0 || saving} aria-label="Move up" title="Move up">↑</button>
                    <button type="button" className={styles.btnSecondary} style={ICON_BTN} onClick={() => move(i, 1)} disabled={i === rows.length - 1 || saving} aria-label="Move down" title="Move down">↓</button>
                    <button type="button" className={styles.btnSecondary} style={ICON_BTN} onClick={() => remove(r.key)} disabled={saving} aria-label="Remove question" title="Remove">✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ color: '#e5484d', fontSize: 13, marginTop: 10 }}>{error}</div>}
        {canEdit && rows !== null && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" className={styles.btnSecondary} onClick={add} disabled={saving || rows.length >= 20}>
              + Add question
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{okMsg && !dirty ? okMsg : ''}</span>
            <button type="button" className={styles.btn} onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : `Save ${AREA_LABEL[area]} questions`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
