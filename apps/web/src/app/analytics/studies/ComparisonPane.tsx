'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Data -> Comparison: athletes head to head. Pick 2-6 athletes and up to
   10 measures (any source: reports, VALD, weight, check-ins). A table puts
   each athlete's value side by side (the best one marked), and a line chart
   shows any one measure over time for all of them.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import pageStyles from '../page.module.css';
import s from './studies.module.css';
import { AthleteLines } from './StudyCharts';
import { AthletesField, DatesField, MeasurePicker, SummarySelect } from './StudyControls';
import { fillStatSeries, statMeasures } from './statMeasures';
import { fmtNum, inRange, perAthlete, toCsv, type DateRange, type Summary } from './studyMath';

const KEY = 'data.comparison';

interface Saved { athleteIds: string[]; measureIds: string[]; summary: Summary; range: DateRange }

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.athleteIds) && Array.isArray(v.measureIds)) return { athleteIds: v.athleteIds, measureIds: v.measureIds, summary: v.summary || 'best', range: v.range || {} };
  } catch { /* fresh */ }
  return { athleteIds: [], measureIds: [], summary: 'best', range: {} };
}

export function ComparisonPane() {
  const [measures, setMeasures] = useState<api.StudyMeasure[] | null>(null);
  const [athletes, setAthletes] = useState<api.StudyAthlete[]>([]);
  const [series, setSeries] = useState<Record<string, api.StudyPoint[]>>({});
  const [st, setSt] = useState<Saved>(() => (typeof window === 'undefined' ? { athleteIds: [], measureIds: [], summary: 'best', range: {} } : loadSaved()));
  const [lineMeasure, setLineMeasure] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getStudyMeasures().then((m) => setMeasures([...m, ...statMeasures()])).catch((e) => setError(e?.message || 'Could not load the measures'));
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode */ } }, [st]);

  const idsKey = st.measureIds.join('|');
  useEffect(() => {
    const missing = st.measureIds.filter((id) => !series[id]);
    if (!missing.length && athletes.length) return;
    api.getStudyData(missing.length ? missing : ['weight'])
      .then((raw) => { const res = fillStatSeries(raw, missing); setAthletes(res.athletes); setSeries((prev) => ({ ...prev, ...res.series })); })
      .catch((e) => setError(e?.message || 'Could not load the data'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const byId = useMemo(() => new Map((measures ?? []).map((m) => [m.id, m])), [measures]);
  const idx = useMemo(() => new Map(athletes.map((a, i) => [a.id, i])), [athletes]);
  const chosen = st.athleteIds.filter((id) => idx.has(id));
  const only = new Set(chosen.map((id) => idx.get(id)!));
  const shownLine = st.measureIds.includes(lineMeasure) ? lineMeasure : st.measureIds[0] ?? '';

  if (!measures) return <div className={pageStyles.empty}>{error || 'Loading…'}</div>;

  const rows = st.measureIds.flatMap((id) => {
    const m = byId.get(id);
    if (!m) return [];
    const vals = perAthlete(series[id], st.summary, m.better, st.range, only);
    const present = chosen.map((a) => vals.get(idx.get(a)!)).filter((v): v is number => v != null);
    const best = present.length > 1 && m.better ? (m.better === 'low' ? Math.min(...present) : Math.max(...present)) : null;
    return [{ m, cells: chosen.map((a) => vals.get(idx.get(a)!) ?? null), best }];
  });

  const csv = () => {
    const head = ['Measure', 'Unit', ...chosen.map((id) => athletes[idx.get(id)!].name)];
    const body = rows.map((r) => [`${r.m.group} · ${r.m.label}`, r.m.unit, ...r.cells.map((v) => (v == null ? '' : fmtNum(v, r.m.digits)))]);
    const blob = new Blob([toCsv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = 'athlete-comparison.csv';
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const lineM = byId.get(shownLine);
  const lines = lineM ? chosen.map((id) => ({
    id,
    name: athletes[idx.get(id)!].name,
    points: (series[shownLine] ?? []).filter(([i, day]) => i === idx.get(id) && inRange(day, st.range)).map(([, day, value]) => ({ day, value })),
  })).filter((l) => l.points.length) : [];

  return (
    <div className={pageStyles.card} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 className={pageStyles.cardTitle}>Compare athletes</h3>
        <p className={pageStyles.cardDesc}>Up to 6 athletes side by side on any measure — assessments, VALD, body weight, check-ins.</p>
      </div>
      <div className={s.studyLayout}>
        <div className={s.settings}>
          <div className={s.field}>Athletes ({chosen.length} of 6)
            <AthletesField athletes={athletes} value={chosen} max={6} onChange={(athleteIds) => setSt({ ...st, athleteIds })} />
          </div>
          <div className={s.field}>Measures ({st.measureIds.length} of 10)
            <MeasurePicker measures={measures} exclude={st.measureIds} placeholder="Add a measure…"
              onPick={(id) => setSt({ ...st, measureIds: [...st.measureIds, id].slice(0, 10) })} />
            {st.measureIds.length > 0 && (
              <div className={s.pills}>
                {st.measureIds.map((id) => (
                  <span key={id} className={s.pill} title={byId.get(id)?.group}>
                    {byId.get(id)?.label ?? id}
                    <button type="button" onClick={() => setSt({ ...st, measureIds: st.measureIds.filter((x) => x !== id) })} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <SummarySelect value={st.summary} onChange={(summary) => setSt({ ...st, summary })} label="Value per athlete" />
          <DatesField label="Dates" value={st.range} onChange={(range) => setSt({ ...st, range })} />
        </div>
        <div className={s.result}>
          {error && <div className={`${s.note} ${s.noteLow}`}>{error}</div>}
          {chosen.length < 2 || !st.measureIds.length ? (
            <div className={pageStyles.empty} style={{ padding: 32, textAlign: 'center' }}>Pick at least 2 athletes and 1 measure.</div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      {chosen.map((id) => <th key={id} className={s.num}>{athletes[idx.get(id)!].name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.m.id} style={{ cursor: 'pointer' }} onClick={() => setLineMeasure(r.m.id)}>
                        <td>
                          <div style={{ fontWeight: r.m.id === shownLine ? 700 : 500 }}>{r.m.label}{r.m.unit ? ` (${r.m.unit})` : ''}</div>
                          <div className={s.savedMeta}>{r.m.group}</div>
                        </td>
                        {r.cells.map((v, i) => (
                          <td key={i} className={s.num} style={{ fontWeight: v != null && v === r.best ? 800 : 500 }}>
                            {v == null ? '—' : fmtNum(v, r.m.digits)}{v != null && v === r.best ? ' ★' : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={s.toolbar}>
                <span className={s.savedMeta}>★ = best of these athletes · click a row to chart it over time</span>
                <button type="button" className={s.linkBtn} onClick={csv}>Download CSV</button>
              </div>
              {lineM && (lines.length ? (
                <>
                  <div className={s.headline} style={{ fontSize: 15 }}>{lineM.label} over time</div>
                  <AthleteLines lines={lines} yTitle={`${lineM.label}${lineM.unit ? ` (${lineM.unit})` : ''}`} fmt={(v) => `${fmtNum(v, lineM.digits)}${lineM.unit ? ` ${lineM.unit}` : ''}`} />
                </>
              ) : <div className={s.explain}>None of these athletes has {lineM.label} in these dates.</div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
