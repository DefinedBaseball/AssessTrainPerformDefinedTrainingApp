'use client';

/* Settings → Programs (coaches).

   One card per facility program -- Hitting, Pitching, Lifting and Catching to
   start, plus any types the academy adds (Infield, Outfield, ...). Each sets
   the season's start / end dates and the start times offered on each weekday.

   The dates define the program's weeks (Mon–Sun, Week 1 = the week it starts
   in); the times are what an athlete's facility schedule (the clock on
   Upcoming Workouts) offers for each day. Saved as one list. */

import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { type FacilityProgram, type WeekdayKey, WEEKDAYS, formatTime12, formatDay } from '@/lib/facility-schedule';
import { publishFacilityPrograms, useFacilityPrograms } from '@/lib/use-facility-programs';
import { TimeSelect } from '@/components/FacilitySchedule';
import styles from './page.module.css';

/** Colours offered for a new program type (muted, like the defaults). */
const NEW_COLORS = ['#8a6fd1', '#3fa5a8', '#c2a23a', '#c06a9b', '#6b8e4e', '#7d8590'];

function mondayLabel(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekCount(start: string | null, end: string | null): number | null {
  if (!start || !end || end < start) return null;
  const mon = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return dt.getTime();
  };
  return Math.round((mon(end) - mon(start)) / (7 * 24 * 3600 * 1000)) + 1;
}

export function ProgramsTab() {
  const { isViewer } = useAuth();
  const saved = useFacilityPrograms();
  const [draft, setDraft] = useState<FacilityProgram[]>(saved);
  /* Time being typed in for each program + day before "+ Add". */
  const [pending, setPending] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  /* Pick up the saved list when it arrives (until the coach edits). */
  const savedJson = JSON.stringify(saved);
  const [baseJson, setBaseJson] = useState(savedJson);
  useEffect(() => {
    setDraft(JSON.parse(savedJson));
    setBaseJson(savedJson);
  }, [savedJson]);
  const dirty = useMemo(() => JSON.stringify(draft) !== baseJson, [draft, baseJson]);

  const patch = (key: string, fields: Partial<FacilityProgram>) => {
    setSavedAt(0);
    setDraft((list) => list.map((p) => (p.key === key ? { ...p, ...fields } : p)));
  };

  const addTime = (p: FacilityProgram, day: WeekdayKey) => {
    const t = pending[`${p.key}|${day}`] || '16:00';
    const list = [...new Set([...(p.hours[day] ?? []), t])].sort();
    patch(p.key, { hours: { ...p.hours, [day]: list } });
  };
  const removeTime = (p: FacilityProgram, day: WeekdayKey, t: string) => {
    const list = (p.hours[day] ?? []).filter((x) => x !== t);
    const hours = { ...p.hours };
    if (list.length) hours[day] = list; else delete hours[day];
    patch(p.key, { hours });
  };

  const addType = () => {
    const label = newName.trim();
    if (!label) return;
    if (draft.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      setError(`There is already a program called "${label}".`);
      return;
    }
    setError('');
    setSavedAt(0);
    const color = NEW_COLORS[draft.filter((p) => !p.builtIn).length % NEW_COLORS.length];
    /* Empty key: the server makes one from the name on save. */
    setDraft((list) => [...list, { key: '', label, color, startDate: null, endDate: null, hours: {}, builtIn: false }]);
    setNewName('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const list = await api.saveFacilityPrograms(draft);
      publishFacilityPrograms(list);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Could not save the programs.');
    } finally {
      setSaving(false);
    }
  };

  const readOnly = isViewer;

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Programs</h3>
        <p className={styles.cardDesc}>
          Each program&rsquo;s season and the start times it runs each day. An athlete&rsquo;s facility schedule
          (the clock on Upcoming Workouts, or Edit Profile) picks from these days and times. Weeks run Monday to
          Sunday: Week 1 is the week the program starts in, and an athlete&rsquo;s Day 1, Day 2&hellip; are their
          days in that order &mdash; what Apply Calendar matches between athletes.
        </p>
      </div>

      {draft.map((p, idx) => {
        const weeks = weekCount(p.startDate, p.endDate);
        const cardKey = p.key || `new-${idx}`;
        return (
          <div key={cardKey} className={styles.card} style={{ borderLeft: `4px solid ${p.color}` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <input
                type="color"
                value={p.color}
                disabled={readOnly}
                onChange={(e) => (p.key ? patch(p.key, { color: e.target.value }) : setDraft((l) => l.map((x, j) => (j === idx ? { ...x, color: e.target.value } : x))))}
                aria-label={`${p.label} colour`}
                style={{ width: 34, height: 34, padding: 0, border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', cursor: readOnly ? 'default' : 'pointer' }}
              />
              <input
                className={styles.input}
                value={p.label}
                maxLength={40}
                disabled={readOnly}
                aria-label="Program name"
                onChange={(e) => (p.key ? patch(p.key, { label: e.target.value }) : setDraft((l) => l.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x))))}
                style={{ flex: '1 1 200px', fontWeight: 700 }}
              />
              {!p.builtIn && !readOnly && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => { setSavedAt(0); setDraft((l) => l.filter((_, j) => j !== idx)); }}
                  title="Remove this program type (athletes already on it keep their days until changed)"
                >Remove</button>
              )}
            </div>

            <div className={styles.contactGrid} style={{ marginBottom: 14 }}>
              <label className={styles.field}><span>Start date</span>
                <input className={styles.input} type="date" value={p.startDate || ''} disabled={readOnly}
                  onChange={(e) => (p.key ? patch(p.key, { startDate: e.target.value || null }) : setDraft((l) => l.map((x, j) => (j === idx ? { ...x, startDate: e.target.value || null } : x))))} />
              </label>
              <label className={styles.field}><span>End date</span>
                <input className={styles.input} type="date" value={p.endDate || ''} min={p.startDate || undefined} disabled={readOnly}
                  onChange={(e) => (p.key ? patch(p.key, { endDate: e.target.value || null }) : setDraft((l) => l.map((x, j) => (j === idx ? { ...x, endDate: e.target.value || null } : x))))} />
              </label>
            </div>
            {p.startDate && (
              <p className={styles.rowSub} style={{ margin: '-4px 0 14px' }}>
                Week 1 starts {mondayLabel(p.startDate)}
                {p.endDate ? ` · ends ${formatDay(p.endDate)}` : ''}
                {weeks ? ` · ${weeks} week${weeks === 1 ? '' : 's'}` : ''}
              </p>
            )}

            {!p.key ? (
              <p className={styles.rowSub}>Save to set this program&rsquo;s days and times.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className={styles.rowTitle}>Days &amp; start times</span>
                {WEEKDAYS.map((d) => {
                  const times = p.hours[d.key] ?? [];
                  const pendKey = `${p.key}|${d.key}`;
                  return (
                    <div
                      key={d.key}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10,
                        opacity: times.length ? 1 : 0.85,
                      }}
                    >
                      <span style={{ width: 86, fontSize: 13, fontWeight: 700, color: times.length ? p.color : 'var(--text-muted)' }}>{d.label}</span>
                      {times.length === 0 && <span className={styles.rowSub}>Not running</span>}
                      {times.map((t) => (
                        <span
                          key={t}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px',
                            borderRadius: 999, background: p.color, color: '#fff', fontSize: 12, fontWeight: 700,
                          }}
                        >
                          {formatTime12(t)}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => removeTime(p, d.key, t)}
                              aria-label={`Remove ${formatTime12(t)} on ${d.label}`}
                              style={{ border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', borderRadius: '50%', width: 18, height: 18, lineHeight: '16px', cursor: 'pointer', padding: 0 }}
                            >×</button>
                          )}
                        </span>
                      ))}
                      {!readOnly && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                          <TimeSelect
                            value={pending[pendKey] || '16:00'}
                            onChange={(t) => setPending((m) => ({ ...m, [pendKey]: t }))}
                          />
                          <button type="button" className={styles.btnSecondary} style={{ padding: '7px 12px' }} onClick={() => addTime(p, d.key)}>
                            + Add
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Add a Program Type</h3>
          <p className={styles.cardDesc}>e.g. Infield Program or Outfield Program. It appears in every athlete&rsquo;s schedule picker, the legend, Apply Calendar and Facility Check In.</p>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={newName}
              maxLength={40}
              placeholder="Program name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addType(); } }}
            />
            <button type="button" className={styles.btnSecondary} onClick={addType} disabled={!newName.trim()}>+ Add Program</button>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className={styles.saveBar}>
          {error && <span className={styles.feedbackErr} style={{ fontSize: 13 }}>{error}</span>}
          {!error && savedAt > 0 && <span className={styles.feedbackOk} style={{ fontSize: 13, fontWeight: 600 }}>Saved</span>}
          {!error && !savedAt && dirty && <span className={styles.rowSub}>Unsaved changes</span>}
          {dirty && (
            <button className={styles.btnSecondary} onClick={() => { setDraft(JSON.parse(baseJson)); setError(''); }} disabled={saving}>
              Discard
            </button>
          )}
          <button className={styles.btn} onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save Programs'}
          </button>
        </div>
      )}
    </div>
  );
}
