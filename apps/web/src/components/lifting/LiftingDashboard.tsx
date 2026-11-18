'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Lifting Report -- one athlete (Physical tab -> Lifting Report).

   Bubbles and boxes come from the athlete's own layout when a coach gave
   them one, else the default (Settings -> Lifting); results from VALD
   (once connected) and from coaches' typed
   results. Each box: latest value, change since the previous result (green
   = better, red = worse) and the athlete's best. Bubbles the athlete has no
   results for are hidden -- a novice never sees an empty Plyo Push-up.
   "History" under a bubble lists every result for that test.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SectionHeader } from '@/components/assessment/SectionHeader';
import { ValdLogo } from '@/components/brand/VendorLogos';
import { WEIGHT_CHANGED_EVENT, type WeightChangedDetail } from '@/components/WeightTracker';
import { headerChipStyle } from '@/app/athletes/[id]/components/ReportInlineEditing';
import aStyles from '@/components/assessment/assessment.module.css';
import { AVG_SUFFIX, bubbleView, byTest, changeColor, fmt, fmtChange, fmtDate } from '@/lib/lifting';
import s from './lifting.module.css';

/* Phone width -- the Hitting / Pitching Reports' 768px breakpoint. */
function useIsPhone(breakpoint = 768): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return phone;
}

/** `headerEnd`: shown at the right end of the title row (the Physical
 *  tab's report date chip). */
export function LiftingDashboard({ playerId, headerEnd }: { playerId: string; headerEnd?: React.ReactNode }) {
  const { isCoach, isViewer } = useAuth();
  const canEnter = isCoach && !isViewer;
  /* Phone: the header buttons go icon-only (like Pitching's Upload) so
     title, buttons and the report date share one line. */
  const isPhone = useIsPhone();
  const chip = isPhone ? { ...headerChipStyle, padding: '3px 7px' } : headerChipStyle;
  const [cfg, setCfg] = useState<api.LiftingPlayerLayoutResponse | null>(null);
  const [tests, setTests] = useState<api.LiftingTestRow[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    Promise.all([api.getLiftingPlayerLayout(playerId), api.getLiftingTests(playerId)])
      .then(([c, t]) => { setCfg(c); setTests(t); })
      .catch((e) => setError(e?.message || 'Could not load the Lifting Report'));
  }, [playerId]);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => byTest(tests ?? []), [tests]);
  const views = useMemo(
    () => (cfg ? cfg.config.bubbles.map((b) => bubbleView(b, grouped)) : []),
    [cfg, grouped],
  );
  const shown = views.filter((v) => v.hasData);

  /* Body Weight results are the athlete's weight history: after one is
     added or removed, the name bubble's weight follows the newest. */
  const announceWeight = useCallback(async () => {
    try {
      const list = await api.getWeightEntries(playerId, 1);
      window.dispatchEvent(new CustomEvent<WeightChangedDetail>(WEIGHT_CHANGED_EVENT, { detail: { playerId, weightLbs: list[0]?.weightLbs ?? null } }));
    } catch { /* the name bubble catches up on the next load */ }
  }, [playerId]);

  const remove = async (t: api.LiftingTestRow) => {
    const what = t.testType === 'BODYWEIGHT' ? 'weigh-in' : `${t.testType} result`;
    if (!window.confirm(`Remove the ${what} from ${fmtDate(t.recordedAt)}?`)) return;
    try {
      await api.deleteLiftingTest(t.id);
      load();
      if (t.testType === 'BODYWEIGHT') void announceWeight();
    } catch (e: any) { setError(e?.message || 'Could not remove it'); }
  };

  return (
    /* paddingTop 10: the same title-to-bubble-top spacing as the Pitching
       and Catching Reports (their bubbles use 10px; .profilePanel's 1.4rem). */
    <div className={aStyles.profilePanel} style={{ marginBottom: 18, paddingTop: 10 }}>
      <SectionHeader
        title="Lifting Report"
        titleLogo={<ValdLogo />}
        rightSlot={(canEnter && cfg) || headerEnd ? (
          <span style={{ display: 'flex', gap: isPhone ? 5 : 8, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {canEnter && cfg?.canEdit && (
              <Link
                href={`/settings?tab=lifting&athlete=${playerId}`}
                style={{ ...chip, textDecoration: 'none' }}
                title={cfg.personal ? 'Edit this athlete’s own layout' : 'Customize this athlete’s layout'}
                aria-label={cfg.personal ? 'Edit Their Layout' : 'Customize Layout'}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11.5 2.5a1.6 1.6 0 0 1 2.3 2.3L5.5 13.1 2.5 14l.9-3z" />
                  <path d="M10.3 3.7l2 2" />
                </svg>
                {!isPhone && (cfg.personal ? 'Edit Their Layout' : 'Customize Layout')}
              </Link>
            )}
            {canEnter && cfg && <button type="button" style={chip} onClick={() => setAdding(true)} title="Add a result" aria-label="Add Result">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              {!isPhone && 'Add Result'}
            </button>}
            {headerEnd}
          </span>
        ) : undefined}
      />
      <div style={{ marginTop: 12 }}>
        {error && <div className={s.empty} style={{ color: '#dc2626' }}>{error}</div>}
        {!error && (!cfg || !tests) && <div className={s.empty}>Loading…</div>}
        {cfg && tests && shown.length === 0 && (
          <div className={s.empty}>
            No results yet. VALD tests will show up here automatically once VALD is connected
            {canEnter ? <>, and coaches can add results with <strong>Add Result</strong>.</> : '.'}
          </div>
        )}
        {shown.length > 0 && (
          <div className={s.grid}>
            {shown.map((v) => {
              const history = (tests ?? []).filter((t) => t.testType === v.bubble.test)
                .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
              const open = openHistory === v.bubble.id;
              return (
                <div key={v.bubble.id} className={s.card}>
                  <div className={s.cardHead}>
                    <span className={s.cardTitle}>{v.bubble.title}</span>
                    <span className={s.cardMeta}>
                      {v.bubble.note ? `${v.bubble.note} · ` : ''}{fmtDate(v.latestAt)}
                    </span>
                  </div>
                  <div className={s.kpis}>
                    {v.kpis.map((k) => (
                      <div key={k.kpi.id} className={s.kpi}>
                        <span className={s.kpiLabel}>{k.kpi.label}</span>
                        <span className={s.kpiValue}>
                          {fmt(k.latest, k.kpi.digits)}
                          {k.latest != null && k.kpi.unit && <span className={s.kpiUnit}>{k.kpi.unit}</span>}
                        </span>
                        {(() => {
                          /* Under the session's best: its average (VALD sessions
                             have several trials / reps) and the change since the
                             session before. */
                          const showAvg = k.average != null && k.latest != null;
                          const showChange = k.change != null && k.change !== 0;
                          if (!showAvg && !showChange) return null;
                          return (
                            <span className={s.kpiSub}>
                              {showAvg && `Avg ${fmt(k.average, k.kpi.digits)}`}
                              {showAvg && showChange && ' · '}
                              {showChange && (
                                <span style={{ color: changeColor(k.improved), fontWeight: 700 }}>{fmtChange(k.change, k.kpi.digits)}</span>
                              )}
                            </span>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                  {history.length > 0 && (
                    <button type="button" className={s.linkBtn} onClick={() => setOpenHistory(open ? null : v.bubble.id)}>
                      {open ? 'Hide history' : `History (${history.length})`}
                    </button>
                  )}
                  {open && (
                    <div style={{ overflowX: 'auto' }}>
                      <table className={s.history}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            {v.bubble.kpis.filter((k) => k.metric).map((k) => <th key={k.id}>{k.label}</th>)}
                            {canEnter && <th aria-label="Actions" />}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((r) => (
                            <tr key={r.id}>
                              <td>{fmtDate(r.recordedAt)}{r.source === 'manual' ? ' ·' : ''}</td>
                              {v.bubble.kpis.filter((k) => k.metric).map((k) => {
                                const best = r.metrics?.[k.metric!];
                                const avg = r.metrics?.[k.metric! + AVG_SUFFIX];
                                const f = k.factor || 1;
                                return (
                                  <td key={k.id}>
                                    {fmt(typeof best === 'number' ? best * f : null, k.digits)}
                                    {typeof avg === 'number' && <span className={s.kpiSub}> / {fmt(avg * f, k.digits)}</span>}
                                  </td>
                                );
                              })}
                              {canEnter && (
                                <td>
                                  {r.source === 'manual' && (
                                    <button type="button" className={s.linkBtn} onClick={() => remove(r)} aria-label="Remove this result">Remove</button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className={s.kpiSub} style={{ marginTop: 4 }}>Best / average of each session · = typed in by a coach</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {adding && cfg && (
        <AddResultDialog
          playerId={playerId}
          cfg={cfg}
          onClose={() => setAdding(false)}
          onSaved={(testType) => { setAdding(false); load(); if (testType === 'BODYWEIGHT') void announceWeight(); }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   + Add Result -- a coach types a result in. The boxes offered are the
   layout's boxes for that test (in their display units, converted back to
   the stored units on save); a test the layout doesn't show uses the
   catalog's metrics in stored units.
   ───────────────────────────────────────────────────────────────────────── */
function AddResultDialog({ playerId, cfg, onClose, onSaved }: {
  playerId: string;
  cfg: api.LiftingPlayerLayoutResponse;
  onClose: () => void;
  onSaved: (testType: string) => void;
}) {
  const tests = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of cfg.config.bubbles) if (!seen.has(b.test)) seen.set(b.test, b.title);
    for (const t of cfg.catalog) if (!seen.has(t.code)) seen.set(t.code, t.label);
    return [...seen.entries()].map(([code, label]) => ({ code, label }));
  }, [cfg]);
  const [test, setTest] = useState(tests[0]?.code ?? '');
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* Fields: the layout's boxes for this test, else the catalog metrics. */
  const fields = useMemo(() => {
    const out: { metric: string; label: string; unit: string; factor: number }[] = [];
    for (const b of cfg.config.bubbles.filter((x) => x.test === test)) {
      for (const k of b.kpis) {
        if (k.metric && !out.some((f) => f.metric === k.metric)) out.push({ metric: k.metric, label: k.label, unit: k.unit, factor: k.factor || 1 });
      }
    }
    if (!out.length) {
      for (const m of cfg.catalog.find((t) => t.code === test)?.metrics ?? []) out.push({ metric: m.key, label: m.label, unit: m.unit, factor: 1 });
    }
    return out;
  }, [cfg, test]);

  useEffect(() => { setValues({}); }, [test]);

  const save = async () => {
    setError('');
    const metrics: Record<string, number> = {};
    for (const f of fields) {
      const raw = (values[f.metric] ?? '').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) { setError(`${f.label} must be a number`); return; }
      metrics[f.metric] = n / f.factor;
    }
    if (!Object.keys(metrics).length) { setError('Enter at least one value'); return; }
    setSaving(true);
    try {
      /* Noon local time, so the date never slips a day in another zone. */
      await api.addLiftingTest(playerId, { testType: test, recordedAt: new Date(`${date}T12:00:00`).toISOString(), metrics, notes: notes.trim() || undefined });
      onSaved(test);
    } catch (e: any) {
      setError(e?.message || 'Could not save the result');
      setSaving(false);
    }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Add a Lifting result">
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Add Result</div>
        <div className={s.row2}>
          <label className={s.field}>
            Test
            <select className={s.input} value={test} onChange={(e) => setTest(e.target.value)}>
              {tests.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </label>
          <label className={s.field}>
            Date
            <input className={s.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className={s.row2}>
          {fields.map((f) => (
            <label key={f.metric} className={s.field}>
              {f.label}{f.unit ? ` (${f.unit})` : ''}
              <input
                className={s.input}
                inputMode="decimal"
                value={values[f.metric] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.metric]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <label className={s.field}>
          Notes (optional)
          <input className={s.input} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <div style={{ color: '#dc2626', fontSize: '0.8rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className={s.btn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={s.btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
