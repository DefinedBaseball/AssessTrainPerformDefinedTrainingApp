'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Data -> Comparison: athletes head to head. Pick 2-6 athletes and up to
   10 measures (any source: reports, VALD, weight, check-ins, season stats).
   A table puts each athlete's value side by side (the best one marked), and
   a line chart shows any one measure over time for all of them.

   Grad year: pick one or more classes and every athlete in them is compared
   (no 6-athlete cap; the athlete picker then narrows within those classes).
   The table turns to one row per athlete, with each class's average on
   top, sortable by any measure; the chart shows each class's monthly
   average (3 classes at most on one chart).
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import pageStyles from '../page.module.css';
import s from './studies.module.css';
import { AthleteLines, TrendChart } from './StudyCharts';
import { AthletesField, DatesField, MeasurePicker, SummarySelect } from './StudyControls';
import { fillStatSeries, statMeasures } from './statMeasures';
import { fmtNum, inRange, mean, monthlyTrend, perAthlete, toCsv, type DateRange, type Summary } from './studyMath';

const KEY = 'data.comparison';

interface Saved { athleteIds: string[]; measureIds: string[]; summary: Summary; range: DateRange; gradYears: number[] }

const EMPTY: Saved = { athleteIds: [], measureIds: [], summary: 'best', range: {}, gradYears: [] };

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.athleteIds) && Array.isArray(v.measureIds)) {
      return {
        athleteIds: v.athleteIds,
        measureIds: v.measureIds,
        summary: v.summary || 'best',
        range: v.range || {},
        gradYears: Array.isArray(v.gradYears) ? v.gradYears.filter((y: unknown) => Number.isInteger(y)) : [],
      };
    }
  } catch { /* fresh */ }
  return EMPTY;
}

const toggleYear = (list: number[], y: number) => (list.includes(y) ? list.filter((x) => x !== y) : [...list, y].sort((a, b) => a - b));

function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = name;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ComparisonPane() {
  const [measures, setMeasures] = useState<api.StudyMeasure[] | null>(null);
  const [athletes, setAthletes] = useState<api.StudyAthlete[]>([]);
  const [series, setSeries] = useState<Record<string, api.StudyPoint[]>>({});
  const [st, setSt] = useState<Saved>(() => (typeof window === 'undefined' ? EMPTY : loadSaved()));
  const [lineMeasure, setLineMeasure] = useState<string>('');
  /* Class view: sort the athletes by a measure (its better direction first). */
  const [sortBy, setSortBy] = useState<string>('');
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
  const years = useMemo(() => [...new Set(athletes.map((a) => a.gradYear).filter((y): y is number => y != null))].sort((a, b) => a - b), [athletes]);
  const byClass = st.gradYears.length > 0;
  /* With classes picked, the athlete list narrows to them (and an empty pick = the whole classes). */
  const inClasses = (a: api.StudyAthlete) => a.gradYear != null && st.gradYears.includes(a.gradYear);
  const pickable = byClass ? athletes.filter(inClasses) : athletes;
  const chosen = st.athleteIds.filter((id) => idx.has(id) && (!byClass || inClasses(athletes[idx.get(id)!])));
  const roster = byClass ? (chosen.length ? chosen : athletes.filter(inClasses).map((a) => a.id)) : chosen;
  const only = new Set(roster.map((id) => idx.get(id)!));
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
    downloadCsv('athlete-comparison.csv', [head, ...body]);
  };

  /* ── Class view: one row per athlete, a column per measure ── */
  const cols = st.measureIds.flatMap((id) => {
    const m = byId.get(id);
    if (!m) return [];
    const vals = perAthlete(series[id], st.summary, m.better, st.range, only);
    const present = [...vals.values()];
    const best = present.length > 1 && m.better ? (m.better === 'low' ? Math.min(...present) : Math.max(...present)) : null;
    return [{ m, vals, best }];
  });
  const classRows = roster.map((id) => idx.get(id)!)
    .filter((i) => cols.some((c) => c.vals.has(i)));
  const sortCol = cols.find((c) => c.m.id === sortBy);
  classRows.sort((x, y) => {
    if (sortCol) {
      const a = sortCol.vals.get(x), b = sortCol.vals.get(y);
      if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
      return sortCol.m.better === 'low' ? a - b : b - a;
    }
    return (athletes[x].gradYear ?? 0) - (athletes[y].gradYear ?? 0) || athletes[x].name.localeCompare(athletes[y].name);
  });
  const classAvg = st.gradYears.map((y) => {
    const members = classRows.filter((i) => athletes[i].gradYear === y);
    return {
      year: y,
      n: members.length,
      cells: cols.map((c) => {
        const v = members.map((i) => c.vals.get(i)).filter((x): x is number => x != null);
        return v.length ? { avg: mean(v), n: v.length } : null;
      }),
    };
  });
  const noData = roster.length - classRows.length;
  const classCsv = () => {
    const head = ['Athlete', 'Grad year', ...cols.map((c) => `${c.m.label}${c.m.unit ? ` (${c.m.unit})` : ''}`)];
    const avgRows = classAvg.map((ca) => [`Class of ${ca.year} average`, ca.year, ...ca.cells.map((x, k) => (x ? fmtNum(x.avg, cols[k].m.digits) : ''))]);
    const body = classRows.map((i) => [athletes[i].name, athletes[i].gradYear ?? '', ...cols.map((c) => { const v = c.vals.get(i); return v == null ? '' : fmtNum(v, c.m.digits); })]);
    downloadCsv('class-comparison.csv', [head, ...avgRows, ...body]);
  };
  const lineMC = byId.get(shownLine);
  const classLines = lineMC ? st.gradYears.slice(0, 3).map((y) => ({
    name: `Class of ${y}`,
    points: monthlyTrend(series[shownLine], new Set(roster.map((id) => idx.get(id)!).filter((i) => athletes[i].gradYear === y)), st.range),
  })).filter((g) => g.points.length) : [];

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
        <p className={pageStyles.cardDesc}>
          Up to 6 athletes side by side on any measure — assessments, VALD, body weight, check-ins, season stats — or pick grad
          years to compare every athlete in those classes.
        </p>
      </div>
      <div className={s.studyLayout}>
        <div className={s.settings}>
          <div className={s.field}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Grad year
              {byClass && <button type="button" className={s.linkBtn} onClick={() => setSt({ ...st, gradYears: [] })}>Clear</button>}
            </span>
            <div className={s.chips}>
              {years.length === 0 && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>No grad years yet.</span>}
              {years.map((y) => (
                <button key={y} type="button" className={`${s.chip} ${st.gradYears.includes(y) ? s.chipOn : ''}`}
                  onClick={() => setSt({ ...st, gradYears: toggleYear(st.gradYears, y) })}>{y}</button>
              ))}
            </div>
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {byClass ? `Comparing every athlete in ${st.gradYears.length > 1 ? 'these classes' : 'this class'}${chosen.length ? ' (only the athletes picked below)' : ''}.` : 'Pick a class to compare all of its athletes.'}
            </span>
          </div>
          <div className={s.field}>{byClass ? `Athletes (optional — ${chosen.length ? `${chosen.length} picked` : 'all in these classes'})` : `Athletes (${chosen.length} of 6)`}
            <AthletesField athletes={pickable} value={chosen} max={byClass ? undefined : 6}
              placeholder={byClass ? 'Only these athletes (optional)…' : 'Add athletes…'}
              onChange={(athleteIds) => setSt({ ...st, athleteIds })} />
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
          {byClass ? (
            !st.measureIds.length ? (
              <div className={pageStyles.empty} style={{ padding: 32, textAlign: 'center' }}>Add at least 1 measure.</div>
            ) : !classRows.length ? (
              <div className={pageStyles.empty} style={{ padding: 32, textAlign: 'center' }}>No athlete in {st.gradYears.length > 1 ? 'these classes' : 'this class'} has these measures{st.range.from || st.range.to ? ' in these dates' : ''}.</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Athlete</th>
                        <th className={s.num}>Class</th>
                        {cols.map((c) => (
                          <th key={c.m.id} className={s.num} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                            title={`${c.m.group} — click to sort and chart`}
                            onClick={() => { setSortBy(c.m.id); setLineMeasure(c.m.id); }}>
                            {c.m.label}{c.m.unit ? ` (${c.m.unit})` : ''}{sortBy === c.m.id ? ' ▾' : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {classAvg.map((ca) => (
                        <tr key={`avg-${ca.year}`} style={{ background: 'rgba(70, 130, 255, 0.08)' }}>
                          <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Class of {ca.year} avg</td>
                          <td className={s.num}>{ca.n}</td>
                          {ca.cells.map((x, k) => (
                            <td key={k} className={s.num} style={{ fontWeight: 700 }} title={x ? `${x.n} athlete${x.n === 1 ? '' : 's'} with data` : undefined}>
                              {x ? fmtNum(x.avg, cols[k].m.digits) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {classRows.map((i) => (
                        <tr key={athletes[i].id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{athletes[i].name}</td>
                          <td className={s.num}>{athletes[i].gradYear ?? '—'}</td>
                          {cols.map((c) => {
                            const v = c.vals.get(i);
                            const top = v != null && v === c.best;
                            return <td key={c.m.id} className={s.num} style={{ fontWeight: top ? 800 : 500 }}>{v == null ? '—' : fmtNum(v, c.m.digits)}{top ? ' ★' : ''}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={s.toolbar}>
                  <span className={s.savedMeta}>
                    {classRows.length} athletes · ★ = best · click a column to sort and chart it
                    {noData > 0 ? ` · ${noData} athlete${noData === 1 ? '' : 's'} in ${st.gradYears.length > 1 ? 'these classes have' : 'this class has'} none of these measures` : ''}
                  </span>
                  <button type="button" className={s.linkBtn} onClick={classCsv}>Download CSV</button>
                </div>
                {lineMC && (classLines.length ? (
                  <>
                    <div className={s.headline} style={{ fontSize: 15 }}>{lineMC.label} by class, month to month</div>
                    {st.gradYears.length > 3 && <div className={s.note}>Showing the first 3 classes picked (more lines can&rsquo;t be told apart).</div>}
                    <TrendChart groups={classLines} yTitle={`${lineMC.label}${lineMC.unit ? ` (${lineMC.unit})` : ''}`} fmt={(v) => `${fmtNum(v, lineMC.digits)}${lineMC.unit ? ` ${lineMC.unit}` : ''}`} />
                  </>
                ) : <div className={s.explain}>No {lineMC.label} for these classes in these dates.</div>)}
              </>
            )
          ) : chosen.length < 2 || !st.measureIds.length ? (
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
