'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Data -> Studies (coach-only). A study = a question + its settings; it is
   never "run" and stored — it recalculates from the newest data whenever
   it's opened. Home: saved studies (pinned first), the study types, and
   ready-made starter studies. Editor: settings on the left, the chart +
   plain-English numbers + table on the right; Save (title + conclusion).
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import pageStyles from '../page.module.css';
import s from './studies.module.css';
import { AthletesField, CohortField, DatesField, MeasureField, MeasurePicker, SummarySelect } from './StudyControls';
import { StudyResult } from './StudyResult';
import { fillStatSeries, statMeasures } from './statMeasures';
import { Draft, GROUP_BY_LABEL, GroupBy, STUDY_TYPES, StudyType, TYPE_TITLE, ValdSets, neededIds, newDraft, starterStudies, typeLabel } from './studyModel';

export function StudiesPane() {
  const { isViewer } = useAuth();
  const [measures, setMeasures] = useState<api.StudyMeasure[] | null>(null);
  const [saved, setSaved] = useState<api.SavedStudy[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  /* VALD groups / tags as athlete filters (read from VALD -- loads in the background). */
  const [vald, setVald] = useState<api.StudyValdFilters | null>(null);
  useEffect(() => {
    api.getStudyValdFilters().then(setVald).catch(() => setVald({ configured: false, groups: [], tags: [] }));
  }, []);
  const valdSets = useMemo<ValdSets | null>(() => {
    if (!vald) return null;
    return new Map([...vald.groups, ...vald.tags].map((x) => [x.id, new Set(x.playerIds)]));
  }, [vald]);

  const loadSaved = useCallback(() => {
    api.listStudies().then(setSaved).catch((e) => setError(e?.message || 'Could not load studies'));
  }, []);
  useEffect(() => {
    api.getStudyMeasures().then((m) => setMeasures([...m, ...statMeasures()])).catch((e) => setError(e?.message || 'Could not load the measures'));
    loadSaved();
  }, [loadSaved]);

  const starters = useMemo(() => (measures ? starterStudies(measures) : []), [measures]);

  if (error && !measures) return <div className={pageStyles.empty}>{error}</div>;
  if (!measures || !saved) return <div className={pageStyles.empty}>Loading…</div>;

  if (draft) {
    return (
      <StudyEditor
        key={draft.id ?? `new-${draft.type}-${draft.title}`}
        initial={draft}
        measures={measures}
        canSave={!isViewer}
        vald={vald}
        valdSets={valdSets}
        onBack={() => { setDraft(null); loadSaved(); }}
        onOpen={(d) => setDraft(d)}
      />
    );
  }

  const open = (st: api.SavedStudy) => {
    const base = newDraft(st.type as StudyType);
    setDraft({ id: st.id, title: st.title, type: st.type as StudyType, conclusion: st.conclusion ?? '', pinned: st.pinned, config: { ...base.config, ...(st.config || {}) } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className={pageStyles.card}>
        <div className={pageStyles.cardHeader}>
          <div>
            <h3 className={pageStyles.cardTitle}>Studies</h3>
            <p className={pageStyles.cardDesc}>
              Ask a question across your athletes: does one number go with another, how groups compare, what changed between two
              periods. A saved study keeps its question and settings, so it always shows the newest data when it&rsquo;s opened. Coaches only.
            </p>
          </div>
        </div>
        <h4 className={s.sectionTitle}>Saved studies</h4>
        {saved.length === 0 ? (
          <div className={s.explain}>No saved studies yet. Start one below, or open a starter study.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {saved.map((st) => (
              <div key={st.id} className={s.savedRow} role="button" tabIndex={0} onClick={() => open(st)} onKeyDown={(e) => { if (e.key === 'Enter') open(st); }}>
                <span className={s.tag}>{TYPE_TITLE[st.type] ?? st.type}</span>
                <div className={s.savedMain}>
                  <div className={s.savedTitle}>{st.pinned ? '★ ' : ''}{st.title}</div>
                  {st.conclusion && <div className={s.savedConclusion}>{st.conclusion}</div>}
                  <div className={s.savedMeta}>
                    {st.createdBy ? `${st.createdBy} · ` : ''}updated {new Date(st.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={pageStyles.card}>
        <h4 className={s.sectionTitle}>New study</h4>
        <div className={s.galleryGrid}>
          {STUDY_TYPES.map((t) => (
            <button key={t.type} type="button" className={s.typeCard} onClick={() => setDraft(newDraft(t.type))}>
              <span className={s.typeTitle}>{t.title}</span>
              <span className={s.typeQuestion}>{t.question}</span>
              <span className={s.typeChart}>{t.chart}</span>
            </button>
          ))}
        </div>
      </div>

      {starters.length > 0 && (
        <div className={pageStyles.card}>
          <h4 className={s.sectionTitle}>Starter studies</h4>
          <p className={s.explain} style={{ marginTop: -4 }}>Ready-made questions from your data — open one, change anything, and save it as your own.</p>
          <div className={s.galleryGrid}>
            {starters.map((d) => (
              <button key={d.title} type="button" className={s.typeCard} onClick={() => setDraft(d)}>
                <span className={s.typeTitle}>{d.title}</span>
                <span className={s.typeChart}>{TYPE_TITLE[d.type]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────── */

function StudyEditor({ initial, measures, canSave, vald, valdSets, onBack, onOpen }: {
  initial: Draft;
  measures: api.StudyMeasure[];
  canSave: boolean;
  vald: api.StudyValdFilters | null;
  valdSets: ValdSets | null;
  onBack: () => void;
  onOpen: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [data, setData] = useState<api.StudyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const c = d.config;
  const set = (patch: Partial<Draft['config']>) => setD((x) => ({ ...x, config: { ...x.config, ...patch } }));
  const byId = useMemo(() => new Map(measures.map((m) => [m.id, m])), [measures]);

  /* Fetch every needed measure once (all-time; dates filter on the page). */
  const ids = neededIds(d);
  const idsKey = ids.join('|');
  useEffect(() => {
    const missing = ids.filter((id) => !data?.series[id]);
    if (!missing.length && data) return;
    let stop = false;
    setLoading(true);
    setError('');
    api.getStudyData(missing.length ? missing : ['weight'])
      .then((raw) => {
        if (stop) return;
        const res = fillStatSeries(raw, missing);
        setData((prev) => ({ athletes: res.athletes, series: { ...(prev?.series ?? {}), ...res.series } }));
      })
      .catch((e) => { if (!stop) setError(e?.message || 'Could not load the data'); })
      .finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const save = async () => {
    if (!d.title.trim()) { setError('Give the study a title first'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.saveStudy({ id: d.id, title: d.title.trim(), type: d.type, config: d.config, conclusion: d.conclusion, pinned: d.pinned });
      setD((x) => ({ ...x, id: res.id }));
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (e: any) {
      setError(e?.message || 'Could not save the study');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!d.id || !window.confirm(`Delete the study "${d.title}"? This can't be undone.`)) return;
    try { await api.deleteStudy(d.id); onBack(); } catch (e: any) { setError(e?.message || 'Could not delete it'); }
  };

  const athletes = data?.athletes ?? [];
  const t = STUDY_TYPES.find((x) => x.type === d.type)!;

  /* "Which athletes" in words, for the PDF. */
  const scopeText = () => {
    const co = c.cohort;
    const parts: string[] = [];
    if (co.gradYears.length) parts.push(`Class of ${co.gradYears.join(', ')}`);
    if (co.positions.length) parts.push(co.positions.join(', '));
    if (co.types.length) parts.push(co.types.map(typeLabel).join(', '));
    const vNames = [...(co.valdGroups ?? []).map((id) => vald?.groups.find((g) => g.id === id)?.name), ...(co.valdTags ?? []).map((id) => vald?.tags.find((x) => x.id === id)?.name)].filter(Boolean);
    if (vNames.length) parts.push(`VALD: ${vNames.join(', ')}`);
    if (co.playerIds.length) parts.push(`${co.playerIds.length} chosen athlete${co.playerIds.length === 1 ? '' : 's'}`);
    return `Athletes: ${parts.length ? parts.join(' · ') : 'everyone'}`;
  };

  const pdf = async () => {
    if (!resultRef.current) return;
    setPdfBusy(true);
    setError('');
    try {
      /* react-pdf loads only when a PDF is asked for. */
      const { downloadStudyPdf } = await import('./studyPdf');
      await downloadStudyPdf(resultRef.current, { title: d.title.trim() || t.title, typeTitle: t.title, scope: scopeText(), conclusion: d.conclusion });
    } catch (e: any) {
      setError(e?.message || 'Could not build the PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className={s.toolbar}>
        <button type="button" className={pageStyles.btnSecondary} onClick={onBack}>← All studies</button>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className={pageStyles.btnSecondary} onClick={pdf} disabled={pdfBusy || !data}>{pdfBusy ? 'Building PDF…' : 'Download PDF'}</button>
          <span className={s.tag}>{t.title}</span>
        </span>
      </div>

      <div className={pageStyles.card}>
        <div className={s.fieldRow} style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className={s.field} style={{ flex: 3, minWidth: 220 }}>
            Title
            <input className={pageStyles.input} value={d.title} maxLength={120} placeholder={t.question.split('?')[0] + '?'} onChange={(e) => setD({ ...d, title: e.target.value })} />
          </label>
          {canSave && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none' }}>
              <label className={s.chip} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={d.pinned} onChange={(e) => setD({ ...d, pinned: e.target.checked })} /> Pin to top
              </label>
              <button type="button" className={pageStyles.btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : d.id ? 'Save changes' : 'Save study'}</button>
              {d.id && <button type="button" className={pageStyles.btnDanger} onClick={remove}>Delete</button>}
              {savedMsg && <span className={s.savedMeta}>{savedMsg}</span>}
            </div>
          )}
        </div>
        {error && <div className={`${s.note} ${s.noteLow}`} style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className={s.studyLayout}>
        <div className={`${pageStyles.card} ${s.settings}`}>
          <Settings d={d} set={set} measures={measures} athletes={athletes} byId={byId} />
          <CohortField athletes={athletes} value={c.cohort} onChange={(cohort) => set({ cohort })} vald={vald} />
        </div>
        <div className={`${pageStyles.card} ${s.result}`} ref={resultRef}>
          {loading && !data && <div className={pageStyles.empty}>Loading data…</div>}
          {data && (
            <StudyResult
              d={d}
              data={data}
              byId={byId}
              valdSets={valdSets}
              onOpen={onOpen}
            />
          )}
          <label className={s.field}>
            What we concluded
            <textarea className={s.textarea} value={d.conclusion} maxLength={4000} placeholder="Notes for the staff: what this shows, what you'll change…" onChange={(e) => setD({ ...d, conclusion: e.target.value })} readOnly={!canSave} />
          </label>
        </div>
      </div>
    </div>
  );
}

/* ── Settings per study type ────────────────────────────────────────── */

function Settings({ d, set, measures, athletes, byId }: {
  d: Draft;
  set: (p: Partial<Draft['config']>) => void;
  measures: api.StudyMeasure[];
  athletes: api.StudyAthlete[];
  byId: Map<string, api.StudyMeasure>;
}) {
  const c = d.config;
  const groupBySelect = (options: GroupBy[]) => (
    <label className={s.field}>
      Group by
      <select className={pageStyles.select} value={c.groupBy ?? 'none'} onChange={(e) => set({ groupBy: e.target.value as GroupBy })}>
        {options.map((g) => <option key={g} value={g}>{GROUP_BY_LABEL[g]}</option>)}
      </select>
    </label>
  );
  switch (d.type) {
    case 'relationship':
      return (
        <>
          <MeasureField label="Across (X)" measures={measures} value={c.x} onChange={(x) => set({ x })} />
          <MeasureField label="Up (Y)" measures={measures} value={c.y} onChange={(y) => set({ y })} />
          <DatesField label="Dates" value={c.range} onChange={(range) => set({ range })} />
          {groupBySelect(['none', 'pitcher', 'type', 'custom'])}
          {c.groupBy === 'custom' && <CustomGroups athletes={athletes} c={c} set={set} />}
        </>
      );
    case 'change':
      return (
        <>
          <MeasureField label="Change in (X)" measures={measures} value={c.x} onChange={(x) => set({ x })} />
          <MeasureField label="Change in (Y)" measures={measures} value={c.y} onChange={(y) => set({ y })} />
          <DatesField label="Before (period A)" value={c.a} onChange={(a) => set({ a })} presets={false} />
          <DatesField label="After (period B)" value={c.b} onChange={(b) => set({ b })} presets={false} />
        </>
      );
    case 'drivers':
      return (
        <>
          <MeasureField label="The result" measures={measures} value={c.target} onChange={(target) => set({ target })} />
          <div className={s.field}>
            Measures to check ({(c.candidates ?? []).length} of 39)
            <MeasurePicker
              measures={measures}
              exclude={[...(c.candidates ?? []), ...(c.target ? [c.target.id] : [])]}
              placeholder="Add a measure (or a whole group)…"
              onPick={(id) => set({ candidates: [...(c.candidates ?? []), id].slice(0, 39) })}
              onPickGroup={(ids) => set({ candidates: [...new Set([...(c.candidates ?? []), ...ids])].filter((x) => x !== c.target?.id).slice(0, 39) })}
            />
            {(c.candidates ?? []).length > 0 && (
              <div className={s.pills}>
                {(c.candidates ?? []).map((id) => (
                  <span key={id} className={s.pill} title={byId.get(id)?.group}>
                    {byId.get(id)?.label ?? id}
                    <button type="button" onClick={() => set({ candidates: (c.candidates ?? []).filter((x) => x !== id) })} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <SummarySelect value={c.candSummary ?? 'best'} onChange={(candSummary) => set({ candSummary })} label="Their value per athlete" />
          <DatesField label="Dates" value={c.range} onChange={(range) => set({ range })} />
        </>
      );
    case 'beforeAfter':
      return (
        <>
          <MeasureField label="Measure" measures={measures} value={c.measure} onChange={(measure) => set({ measure })} />
          <DatesField label="Before (period A)" value={c.a} onChange={(a) => set({ a })} presets={false} />
          <DatesField label="After (period B)" value={c.b} onChange={(b) => set({ b })} presets={false} />
        </>
      );
    case 'groups':
      return (
        <>
          <MeasureField label="Measure" measures={measures} value={c.measure} onChange={(measure) => set({ measure })} />
          {groupBySelect(['gradYear', 'pitcher', 'position', 'type', 'custom'])}
          {c.groupBy === 'custom' && <CustomGroups athletes={athletes} c={c} set={set} />}
          <DatesField label="Dates" value={c.range} onChange={(range) => set({ range })} />
        </>
      );
    case 'trend':
      return (
        <>
          <MeasureField label="Measure" measures={measures} value={c.measure} onChange={(measure) => set({ measure })} />
          {groupBySelect(['none', 'gradYear', 'pitcher', 'type', 'custom'])}
          {c.groupBy === 'custom' && <CustomGroups athletes={athletes} c={c} set={set} />}
          <DatesField label="Dates" value={c.range} onChange={(range) => set({ range })} />
        </>
      );
    case 'profile':
      return (
        <>
          <div className={s.field}>
            Athlete
            <AthletesField athletes={athletes} value={c.athleteId ? [c.athleteId] : []} onChange={(ids) => set({ athleteId: ids[ids.length - 1] })} placeholder="Pick an athlete…" max={1} />
          </div>
          <div className={s.field}>
            Measures ({(c.measures ?? []).length} of 20)
            <MeasurePicker
              measures={measures}
              exclude={c.measures}
              placeholder="Add a measure (or a whole group)…"
              onPick={(id) => set({ measures: [...(c.measures ?? []), id].slice(0, 20) })}
              onPickGroup={(ids) => set({ measures: [...new Set([...(c.measures ?? []), ...ids])].slice(0, 20) })}
            />
            {(c.measures ?? []).length > 0 && (
              <div className={s.pills}>
                {(c.measures ?? []).map((id) => (
                  <span key={id} className={s.pill} title={byId.get(id)?.group}>
                    {byId.get(id)?.label ?? id}
                    <button type="button" onClick={() => set({ measures: (c.measures ?? []).filter((x) => x !== id) })} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <SummarySelect value={c.candSummary ?? 'best'} onChange={(candSummary) => set({ candSummary })} label="Value per athlete" />
          <label className={s.chip} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={c.sameClass !== false} onChange={(e) => set({ sameClass: e.target.checked })} /> Compare with their grad year only
          </label>
          <DatesField label="Dates" value={c.range} onChange={(range) => set({ range })} />
        </>
      );
  }
}

function CustomGroups({ athletes, c, set }: { athletes: api.StudyAthlete[]; c: Draft['config']; set: (p: Partial<Draft['config']>) => void }) {
  return (
    <>
      <div className={s.field}>Group A<AthletesField athletes={athletes} value={c.groupA ?? []} onChange={(groupA) => set({ groupA })} /></div>
      <div className={s.field}>Group B<AthletesField athletes={athletes} value={c.groupB ?? []} onChange={(groupB) => set({ groupB })} /></div>
    </>
  );
}
