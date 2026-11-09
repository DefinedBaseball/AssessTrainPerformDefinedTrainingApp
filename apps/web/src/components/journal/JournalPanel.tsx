'use client';

/* ─────────────────────────────────────────────────────────────────────────
   The athlete's Journal (opened from the Journal button beside Videos on
   their profile).

   Tabs: "Check-In Answers" -- what they entered at each day's check-in and
   check-out -- then one "<Area> Journal" per area they play (Hitting,
   Pitching, ...). An area journal opens on the athlete's MOST RECENT entry,
   with a "New Journal Entry" button at the top; that button swaps the entry
   for the form (the coaches' questions from Settings → Journal plus "Other
   thoughts"). Every save is a dated entry; earlier ones are listed below,
   newest first, and the athlete can edit or delete their own. Coaches read
   the same entries under "Personal Notes" on the matching report tab.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { JournalArea, JournalEntry, JournalQuestion } from '@/lib/api';
import { CheckInHistory } from '@/components/CheckInHistory';
import { JournalEntryList, journalDayLabel } from './JournalEntryList';
import eduStyles from '@/app/education/page.module.css';
import styles from './Journal.module.css';

const AREA_LABEL: Record<JournalArea, string> = {
  hitting: 'Hitting', pitching: 'Pitching', catching: 'Catching', infield: 'Infield', outfield: 'Outfield',
};

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function JournalPanel({ playerId, areas }: { playerId: string; areas: JournalArea[] }) {
  const tabs = useMemo(
    () => [{ key: 'checkins', label: 'Check-In Answers' }, ...areas.map((a) => ({ key: a, label: `${AREA_LABEL[a]} Journal` }))],
    [areas],
  );
  const [tab, setTab] = useState<string>('checkins');
  useEffect(() => { if (!tabs.some((t) => t.key === tab)) setTab('checkins'); }, [tabs, tab]);

  return (
    <div className={styles.panel}>
      <div className={eduStyles.sportTabs} role="tablist" aria-label="Journal">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${eduStyles.sportTab} ${tab === t.key ? eduStyles.sportTabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'checkins'
        ? <div className={styles.card}><CheckInHistory playerId={playerId} /></div>
        : <AreaJournal key={tab} playerId={playerId} area={tab as JournalArea} />}
    </div>
  );
}

function AreaJournal({ playerId, area }: { playerId: string; area: JournalArea }) {
  const [questions, setQuestions] = useState<JournalQuestion[] | null>(null);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');

  /* The form is closed until "New Journal Entry" (or Edit) opens it; until
     then the latest entry is what shows. `editing` = the entry being edited. */
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [date, setDate] = useState(todayStr());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [thoughts, setThoughts] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getJournalQuestions(area), api.getJournalEntries(playerId, area)])
      .then(([q, e]) => { if (!cancelled) { setQuestions(q); setEntries(e); } })
      .catch((e) => { if (!cancelled) { setLoadError(e?.message || 'Could not load your journal'); setQuestions([]); setEntries([]); } });
    return () => { cancelled = true; };
  }, [playerId, area]);

  const reset = () => {
    setComposing(false);
    setEditing(null);
    setDate(todayStr());
    setAnswers({});
    setThoughts('');
    setError('');
  };

  /* Editing an entry shows its questions as they were asked, even if the
     coaches have since changed the list. */
  const formQuestions: { id: string; text: string }[] = useMemo(() => {
    if (!editing) return (questions ?? []).map((q) => ({ id: q.id, text: q.text }));
    const current = (questions ?? []).map((q) => ({ id: q.id, text: q.text }));
    const asked = editing.answers.filter((a) => a.questionId && !current.some((q) => q.id === a.questionId))
      .map((a) => ({ id: a.questionId as string, text: a.question }));
    return [...current, ...asked];
  }, [questions, editing]);

  const startNew = () => {
    reset();
    setComposing(true);
    setSavedMsg('');
  };

  const startEdit = (e: JournalEntry) => {
    setComposing(true);
    setEditing(e);
    setDate(e.date);
    setAnswers(Object.fromEntries(e.answers.filter((a) => a.questionId).map((a) => [a.questionId as string, a.answer])));
    setThoughts(e.thoughts ?? '');
    setError('');
    setSavedMsg('');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hasContent = formQuestions.some((q) => (answers[q.id] ?? '').trim()) || thoughts.trim().length > 0;

  const save = async () => {
    setSaving(true);
    setError('');
    setSavedMsg('');
    const body = {
      date,
      answers: formQuestions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '' })),
      thoughts,
    };
    try {
      if (editing) {
        const updated = await api.updateJournalEntry(editing.id, body);
        setEntries((list) => sortEntries((list ?? []).map((x) => (x.id === updated.id ? updated : x))));
        setSavedMsg('Entry updated.');
      } else {
        const created = await api.createJournalEntry({ ...body, area });
        setEntries((list) => sortEntries([created, ...(list ?? [])]));
        setSavedMsg('Saved to your journal.');
      }
      reset();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: JournalEntry) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete your ${AREA_LABEL[area]} journal entry from ${journalDayLabel(e.date)}?`)) return;
    setBusyId(e.id);
    try {
      await api.deleteJournalEntry(e.id);
      setEntries((list) => (list ?? []).filter((x) => x.id !== e.id));
      if (editing?.id === e.id) reset();
    } catch (err: any) {
      setError(err?.message || 'Could not delete');
    } finally {
      setBusyId(null);
    }
  };

  if (questions === null || entries === null) return <div className={styles.card}><div className={styles.empty}>Loading…</div></div>;

  const latest = entries[0] ?? null;
  const earlier = entries.slice(1);
  const formOpen = composing || !!editing;

  return (
    <div className={styles.stack}>
      {/* Top bar: the area's title + New Journal Entry. */}
      <div className={styles.areaBar}>
        <span className={styles.areaTitle}>{AREA_LABEL[area]} Journal</span>
        {!formOpen && (
          <button type="button" className={styles.primaryBtn} onClick={startNew}>
            + New Journal Entry
          </button>
        )}
      </div>
      {savedMsg && !formOpen && <div className={styles.saved} style={{ marginRight: 0 }}>{savedMsg}</div>}
      {loadError && <div className={styles.error}>{loadError}</div>}

      {formOpen ? (
        <section className={styles.card}>
          <div className={styles.formHead}>
            <span className={styles.formTitle}>{editing ? 'Edit entry' : `New ${AREA_LABEL[area]} entry`}</span>
            <label className={styles.dateField}>
              <span>Day</span>
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} disabled={saving} />
            </label>
          </div>
          {formQuestions.map((q) => (
            <label key={q.id} className={styles.field}>
              <span className={styles.fieldLabel}>{q.text}</span>
              <textarea
                className={styles.textarea}
                rows={3}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((m) => ({ ...m, [q.id]: e.target.value }))}
                disabled={saving}
                maxLength={5000}
              />
            </label>
          ))}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Other thoughts</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={thoughts}
              onChange={(e) => setThoughts(e.target.value)}
              disabled={saving}
              placeholder="Anything else on your mind about your training…"
              maxLength={10000}
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryBtn} onClick={reset} disabled={saving}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving || !hasContent || !date}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save entry'}
            </button>
          </div>
          <div className={styles.hint}>Your coaches can read your journal.</div>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.sectionTitle}>Most recent entry</div>
          <JournalEntryList
            entries={latest ? [latest] : []}
            emptyText={`No ${AREA_LABEL[area]} entries yet. Tap “New Journal Entry” to write your first one.`}
            onEdit={startEdit}
            onDelete={remove}
            busyId={busyId}
          />
        </section>
      )}

      {earlier.length > 0 && (
        <section className={styles.card}>
          <div className={styles.sectionTitle}>Earlier entries</div>
          <JournalEntryList entries={earlier} emptyText="" onEdit={startEdit} onDelete={remove} busyId={busyId} />
        </section>
      )}
    </div>
  );
}

function sortEntries(list: JournalEntry[]): JournalEntry[] {
  return [...list].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}
