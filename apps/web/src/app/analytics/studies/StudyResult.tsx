'use client';

/* Studies: each study type's result — headline in plain English, the key
   numbers, a sample-size warning, the chart, the table and CSV. */
import type * as api from '@/lib/api';
import pageStyles from '../page.module.css';
import s from './studies.module.css';
import { PercentileBars, RankedBars, ScatterChart, SlopeChart, StripChart, TrendChart, type DotPoint } from './StudyCharts';
import {
  SUMMARY_LABEL, cohensD, effectWord, fit, fmtNum, mean, median, monthlyTrend, pText, paired, perAthlete,
  percentile, sampleNote, sd, signed, significant, strengthWord, toCsv, type DateRange, type Summary,
} from './studyMath';
import { Draft, ValdSets, cohortMembers, groupAthletes, newDraft } from './studyModel';

const openAthlete = (id: string) => window.open(`/athletes/${id}`, '_blank', 'noopener');

function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w -]+/g, '').trim() || 'study'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const rangeText = (r: DateRange) => (r.from || r.to ? `${r.from ? fmtDay(r.from) : 'start'} – ${r.to ? fmtDay(r.to) : 'today'}` : 'all time');
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div data-pdf="stat" className={s.stat}>
      <div data-pdf-part="label" className={s.statLabel}>{label}</div>
      <div data-pdf-part="value" className={s.statValue}>{value}</div>
      {sub && <div data-pdf-part="sub" className={s.statSub}>{sub}</div>}
    </div>
  );
}

function SampleNote({ n }: { n: number }) {
  const note = sampleNote(n);
  if (note.level === 'ok') return null;
  return <div data-pdf="note" className={`${s.note} ${note.level === 'low' ? s.noteLow : ''}`}>{note.text}</div>;
}

/** Periods A and B share days -- the same session can count as both "before" and "after". */
function OverlapNote({ a, b }: { a: DateRange; b: DateRange }) {
  const overlap = (!a.to || !b.from || a.to >= b.from) && (!b.to || !a.from || b.to >= a.from);
  return overlap ? <div data-pdf="note" className={`${s.note} ${s.noteLow}`}>The two periods overlap, so a session can count as both before and after. Make period A end before period B starts.</div> : null;
}

const Empty = ({ text }: { text: string }) => <div className={pageStyles.empty} style={{ padding: 32, textAlign: 'center' }}>{text}</div>;

export function StudyResult({ d, data, byId, valdSets, onOpen }: {
  d: Draft;
  data: api.StudyData;
  byId: Map<string, api.StudyMeasure>;
  valdSets?: ValdSets | null;
  onOpen: (d: Draft) => void;
}) {
  const c = d.config;
  const { athletes, series } = data;
  const members = cohortMembers(athletes, c.cohort, valdSets);
  const m = (id?: string) => (id ? byId.get(id) : undefined);
  const unitOf = (x?: api.StudyMeasure) => (x?.unit ? ` ${x.unit}` : '');
  const fmtOf = (x?: api.StudyMeasure) => (v: number) => `${fmtNum(v, x?.digits ?? 1)}${unitOf(x)}`;
  const nameOf = (x?: api.StudyMeasure, summary?: string) => (x ? `${x.label}${summary ? ` (${SUMMARY_LABEL[summary as keyof typeof SUMMARY_LABEL].toLowerCase()})` : ''}` : '');
  const title = d.title || 'study';

  /* ── Relationship ── */
  if (d.type === 'relationship') {
    const mx = m(c.x?.id), my = m(c.y?.id);
    if (!c.x || !c.y || !mx || !my) return <Empty text="Pick the two measures on the left." />;
    const xs = perAthlete(series[c.x.id], c.x.summary, mx.better, c.range, members);
    const ys = perAthlete(series[c.y.id], c.y.summary, my.better, c.range, members);
    const groups = c.groupBy && c.groupBy !== 'none' ? groupAthletes(athletes, members, c.groupBy, c.groupA, c.groupB).slice(0, 3) : null;
    const groupOf = (i: number) => (groups ? groups.findIndex((g) => g.members.has(i)) : 0);
    const both = [...xs.keys()].filter((i) => ys.has(i) && (!groups || groupOf(i) >= 0));
    const pts: DotPoint[] = both.map((i) => ({ id: athletes[i].id, label: athletes[i].name, x: xs.get(i)!, y: ys.get(i)!, group: groupOf(i), sub: athletes[i].gradYear ? `Class of ${athletes[i].gradYear}` : undefined }));
    const f = fit(pts.map((p) => p.x), pts.map((p) => p.y));
    if (pts.length < 3) return <Empty text={`Only ${pts.length} athlete${pts.length === 1 ? ' has' : 's have'} both numbers — at least 3 are needed.`} />;
    return (
      <>
        <div data-pdf="headline" className={s.headline}>{f ? strengthWord(f.r) : 'No relationship can be measured'}</div>
        {f && (
          <div className={s.statRow}>
            <Stat label="Correlation (r)" value={f.r.toFixed(2)} sub="-1 to 1; 0 = none" />
            <Stat label="Explains" value={`${Math.round(f.r2 * 100)}%`} sub={`of the spread in ${my.label}`} />
            <Stat label="Each +1 in X" value={`${signed(f.slope, Math.max(2, my.digits))}${unitOf(my)}`} sub={`in ${my.label}`} />
            <Stat label="Athletes" value={String(f.n)} sub={significant(f.p) ? `${pText(f.p)} · unlikely chance` : `${pText(f.p)} · could be chance`} />
          </div>
        )}
        <SampleNote n={pts.length} />
        <ScatterChart points={pts} xTitle={nameOf(mx, c.x.summary)} yTitle={nameOf(my, c.y.summary)} fmtX={fmtOf(mx)} fmtY={fmtOf(my)} line={f} groups={groups?.map((g) => g.name)} onPick={openAthlete} />
        <p data-pdf="explain" className={s.explain}>
          Each dot is an athlete ({rangeText(c.range)}). A relationship doesn&rsquo;t prove one causes the other — older or bigger
          athletes are often better at both. Try grouping by grad year or comparing within one class.
        </p>
        <ResultTable
          title={title}
          head={['Athlete', 'Grad year', nameOf(mx, c.x.summary), nameOf(my, c.y.summary)]}
          rows={pts.sort((a, b) => b.y - a.y).map((p) => [p.label, athletes.find((a) => a.id === p.id)?.gradYear ?? '', fmtNum(p.x, mx.digits), fmtNum(p.y, my.digits)])}
        />
      </>
    );
  }

  /* ── Change vs change ── */
  if (d.type === 'change') {
    const mx = m(c.x?.id), my = m(c.y?.id);
    if (!c.x || !c.y || !mx || !my) return <Empty text="Pick the two measures on the left." />;
    const dx = changes(series[c.x.id], c.x.summary, mx.better, c.a, c.b, members);
    const dy = changes(series[c.y.id], c.y.summary, my.better, c.a, c.b, members);
    const both = [...dx.keys()].filter((i) => dy.has(i));
    const pts: DotPoint[] = both.map((i) => ({ id: athletes[i].id, label: athletes[i].name, x: dx.get(i)!, y: dy.get(i)! }));
    if (pts.length < 3) return <Empty text={`Only ${pts.length} athlete${pts.length === 1 ? ' has' : 's have'} both measures in BOTH periods — at least 3 are needed.`} />;
    const f = fit(pts.map((p) => p.x), pts.map((p) => p.y));
    return (
      <>
        <div data-pdf="headline" className={s.headline}>{f ? `${strengthWord(f.r)} between the changes` : 'No relationship can be measured'}</div>
        {f && (
          <div className={s.statRow}>
            <Stat label="Correlation (r)" value={f.r.toFixed(2)} />
            <Stat label="Avg change X" value={`${signed(mean(pts.map((p) => p.x)), mx.digits)}${unitOf(mx)}`} sub={mx.label} />
            <Stat label="Avg change Y" value={`${signed(mean(pts.map((p) => p.y)), my.digits)}${unitOf(my)}`} sub={my.label} />
            <Stat label="Athletes" value={String(f.n)} sub={pText(f.p)} />
          </div>
        )}
        <SampleNote n={pts.length} />
        <OverlapNote a={c.a} b={c.b} />
        <ScatterChart points={pts} xTitle={`Change in ${mx.label}`} yTitle={`Change in ${my.label}`} fmtX={(v) => `${signed(v, mx.digits)}${unitOf(mx)}`} fmtY={(v) => `${signed(v, my.digits)}${unitOf(my)}`} line={f} onPick={openAthlete} />
        <p data-pdf="explain" className={s.explain}>Change = {SUMMARY_LABEL[c.x.summary].toLowerCase()} in period B ({rangeText(c.b)}) minus period A ({rangeText(c.a)}). Only athletes with data in both periods count.</p>
        <ResultTable title={title} head={['Athlete', `Change in ${mx.label}`, `Change in ${my.label}`]}
          rows={pts.sort((a, b) => b.y - a.y).map((p) => [p.label, signed(p.x, mx.digits), signed(p.y, my.digits)])} />
      </>
    );
  }

  /* ── What goes with it? ── */
  if (d.type === 'drivers') {
    const mt = m(c.target?.id);
    if (!c.target || !mt) return <Empty text="Pick the result on the left, then add measures to check." />;
    if (!(c.candidates ?? []).length) return <Empty text="Add measures to check against the result (a whole group at once works too)." />;
    const ys = perAthlete(series[c.target.id], c.target.summary, mt.better, c.range, members);
    const rows = (c.candidates ?? []).flatMap((id) => {
      const mc = m(id);
      if (!mc) return [];
      const xs = perAthlete(series[id], c.candSummary ?? 'best', mc.better, c.range, members);
      const both = [...xs.keys()].filter((i) => ys.has(i));
      const f = fit(both.map((i) => xs.get(i)!), both.map((i) => ys.get(i)!));
      return f ? [{ id, label: `${mc.label}${mc.group.includes('·') ? ` · ${mc.group.split('·').pop()!.trim()}` : ''}`, r: f.r, n: f.n, p: f.p }] : [];
    }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    if (!rows.length) return <Empty text="Not enough athletes have both the result and these measures (3+ needed for each)." />;
    const top = rows[0];
    return (
      <>
        <div data-pdf="headline" className={s.headline}>Strongest: {top.label} ({strengthWord(top.r).toLowerCase()}, r = {top.r.toFixed(2)})</div>
        <div data-pdf="explain" className={s.explain}>
          How closely each measure goes with <strong>{nameOf(mt, c.target.summary)}</strong> across athletes ({rangeText(c.range)}). Faded bars could be
          chance. Click a bar to open it as a Relationship study.
        </div>
        <SampleNote n={Math.max(...rows.map((r) => r.n))} />
        <RankedBars rows={rows} onPick={(id) => {
          const next = newDraft('relationship');
          next.title = `${byId.get(id)?.label ?? 'Measure'} vs ${mt.label}`;
          next.config = { ...next.config, x: { id, summary: c.candSummary ?? 'best' }, y: c.target, cohort: c.cohort, range: c.range };
          onOpen(next);
        }} />
        <ResultTable title={title} head={['Measure', 'r', 'Athletes', 'Could be chance?']}
          rows={rows.map((r) => [r.label, r.r.toFixed(2), r.n, significant(r.p) ? 'Unlikely' : 'Yes'])} />
      </>
    );
  }

  /* ── Before / After ── */
  if (d.type === 'beforeAfter') {
    const mm = m(c.measure?.id);
    if (!c.measure || !mm) return <Empty text="Pick the measure on the left." />;
    const a = perAthlete(series[c.measure.id], c.measure.summary, mm.better, c.a, members);
    const b = perAthlete(series[c.measure.id], c.measure.summary, mm.better, c.b, members);
    const both = [...a.keys()].filter((i) => b.has(i));
    if (!both.length) return <Empty text="No athlete has this measure in both periods. Widen the dates or pick other periods." />;
    const res = paired(both.map((i) => a.get(i)!), both.map((i) => b.get(i)!), mm.better)!;
    const rows = both.map((i) => {
      const before = a.get(i)!, after = b.get(i)!;
      return { id: athletes[i].id, label: athletes[i].name, before, after, improved: after === before ? null : mm.better === 'low' ? after < before : after > before };
    });
    const better = mm.better === 'low' ? 'lower' : 'higher';
    return (
      <>
        <div data-pdf="headline" className={s.headline}>
          {res.improved} of {res.n} athletes improved · average {signed(res.meanChange, mm.digits)}{unitOf(mm)}
          {Number.isFinite(res.pctChange) ? ` (${signed(res.pctChange, 1)}%)` : ''}
        </div>
        <div className={s.statRow}>
          <Stat label="Before (avg)" value={fmtOf(mm)(res.meanBefore)} sub={rangeText(c.a)} />
          <Stat label="After (avg)" value={fmtOf(mm)(res.meanAfter)} sub={rangeText(c.b)} />
          <Stat label="Effect size" value={Number.isFinite(res.dz) ? Math.abs(res.dz).toFixed(2) : '—'} sub={effectWord(res.dz) ? `${effectWord(res.dz)} change` : undefined} />
          <Stat label="Athletes" value={String(res.n)} sub={res.n >= 3 ? `${pText(res.p)} · ${significant(res.p) ? 'unlikely chance' : 'could be chance'}` : undefined} />
        </div>
        <SampleNote n={res.n} />
        <OverlapNote a={c.a} b={c.b} />
        <SlopeChart rows={rows} beforeLabel="Before (A)" afterLabel="After (B)" fmt={fmtOf(mm)} onPick={openAthlete} />
        <p data-pdf="explain" className={s.explain}>
          Each line is an athlete: their {SUMMARY_LABEL[c.measure.summary].toLowerCase()} {mm.label} in period A vs period B. Improved = {better}
          {mm.better ? '' : ' (this measure has no better direction, so higher counts as improved)'}. Only athletes with data in both periods count.
        </p>
        <ResultTable title={title} head={['Athlete', 'Before', 'After', 'Change']}
          rows={rows.sort((x, y) => (y.after - y.before) - (x.after - x.before)).map((r) => [r.label, fmtNum(r.before, mm.digits), fmtNum(r.after, mm.digits), signed(r.after - r.before, mm.digits)])} />
      </>
    );
  }

  /* ── Compare groups ── */
  if (d.type === 'groups') {
    const mm = m(c.measure?.id);
    if (!c.measure || !mm) return <Empty text="Pick the measure on the left." />;
    const vals = perAthlete(series[c.measure.id], c.measure.summary, mm.better, c.range, members);
    const groups = groupAthletes(athletes, members, c.groupBy ?? 'gradYear', c.groupA, c.groupB)
      .map((g) => {
        const values = [...g.members].filter((i) => vals.has(i)).map((i) => ({ id: athletes[i].id, label: athletes[i].name, v: vals.get(i)! }));
        const v = values.map((x) => x.v);
        return { name: g.name, values, mean: mean(v), sd: sd(v), median: median(v) };
      })
      .filter((g) => g.values.length > 0)
      .slice(0, 8);
    if (!groups.length) return <Empty text="No athletes in these groups have this measure yet." />;
    const two = groups.length === 2 ? groups : null;
    const dEff = two ? cohensD(two[0].values.map((x) => x.v), two[1].values.map((x) => x.v)) : NaN;
    /* Lead with groups big enough to mean something (3+ athletes) when there are any. */
    const solid = groups.filter((g) => g.values.length >= 3);
    const sorted = [...(solid.length ? solid : groups)].sort((x, y) => (mm.better === 'low' ? x.mean - y.mean : y.mean - x.mean));
    return (
      <>
        <div data-pdf="headline" className={s.headline}>
          {two
            ? `${two[0].name} ${fmtOf(mm)(two[0].mean)} vs ${two[1].name} ${fmtOf(mm)(two[1].mean)} — a ${effectWord(dEff) || 'unclear'} gap`
            : mm.better ? `${sorted[0].name} leads (${fmtOf(mm)(sorted[0].mean)} average)` : `${sorted[0].name}: ${fmtOf(mm)(sorted[0].mean)} average`}
        </div>
        <div className={s.statRow}>
          {two && <Stat label="Gap" value={`${signed(two[0].mean - two[1].mean, mm.digits)}${unitOf(mm)}`} sub={`${two[0].name} minus ${two[1].name}`} />}
          {two && <Stat label="Effect size (d)" value={Number.isFinite(dEff) ? Math.abs(dEff).toFixed(2) : '—'} sub="0.2 small · 0.5 medium · 0.8 large" />}
          <Stat label="Athletes" value={String(groups.reduce((a, g) => a + g.values.length, 0))} sub={`${groups.length} groups`} />
        </div>
        <SampleNote n={Math.min(...groups.map((g) => g.values.length))} />
        <StripChart groups={groups} yTitle={nameOf(mm, c.measure.summary)} fmt={fmtOf(mm)} onPick={openAthlete} />
        {(c.groupBy === 'type') && <p data-pdf="explain" className={s.explain}>An athlete with two athlete types counts in both groups.</p>}
        <ResultTable title={title} head={['Group', 'Athletes', 'Average', 'Median', 'Spread (SD)']}
          rows={groups.map((g) => [g.name, g.values.length, fmtNum(g.mean, mm.digits), fmtNum(g.median, mm.digits), fmtNum(g.sd, mm.digits)])} />
      </>
    );
  }

  /* ── Group over time ── */
  if (d.type === 'trend') {
    const mm = m(c.measure?.id);
    if (!c.measure || !mm) return <Empty text="Pick the measure on the left." />;
    const all = groupAthletes(athletes, members, c.groupBy ?? 'none', c.groupA, c.groupB);
    const groups = all.map((g) => ({ name: g.name, points: monthlyTrend(series[c.measure!.id], g.members, c.range) }))
      .filter((g) => g.points.length).slice(0, 3);
    if (!groups.length) return <Empty text="No data for this measure in these dates." />;
    const first = groups.map((g) => ({ name: g.name, change: g.points.length > 1 ? g.points[g.points.length - 1].mean - g.points[0].mean : NaN }));
    return (
      <>
        <div data-pdf="headline" className={s.headline}>
          {first.map((g) => `${g.name}: ${Number.isFinite(g.change) ? `${signed(g.change, mm.digits)}${unitOf(mm)} first to last month` : 'one month of data'}`).join(' · ')}
        </div>
        {all.length > 3 && <div data-pdf="note" className={s.note}>Showing the 3 largest groups (more lines can&rsquo;t be told apart). Narrow the athletes to see others.</div>}
        <TrendChart groups={groups} yTitle={`${mm.label}${mm.unit ? ` (${mm.unit})` : ''}`} fmt={fmtOf(mm)} />
        <p data-pdf="explain" className={s.explain}>Each month: every athlete&rsquo;s average that month, then the group&rsquo;s average of those. A month with few athletes can jump around — check n in the tooltip.</p>
        <ResultTable title={title} head={['Group', 'Month', 'Average', 'Spread (SD)', 'Athletes']}
          rows={groups.flatMap((g) => g.points.map((p) => [g.name, p.month, fmtNum(p.mean, mm.digits), fmtNum(p.sd, mm.digits), p.n]))} />
      </>
    );
  }

  /* ── Athlete vs group ── */
  const athleteIdx = athletes.findIndex((a) => a.id === c.athleteId);
  if (athleteIdx < 0) return <Empty text="Pick an athlete on the left." />;
  if (!(c.measures ?? []).length) return <Empty text="Add the measures to compare." />;
  const who = athletes[athleteIdx];
  const peers = new Set([...members].filter((i) => c.sameClass === false || (who.gradYear != null && athletes[i].gradYear === who.gradYear)));
  peers.add(athleteIdx);
  const summary = c.candSummary ?? 'best';
  const rows = (c.measures ?? []).flatMap((id) => {
    const mm = m(id);
    if (!mm) return [];
    const vals = perAthlete(series[id], summary, mm.better, c.range, peers);
    const mine = vals.get(athleteIdx);
    if (mine == null) return [];
    const group = [...vals.values()];
    return [{ id, label: mm.label, pct: percentile(mine, group, mm.better), value: fmtOf(mm)(mine), n: group.length, median: fmtOf(mm)(median(group)), better: mm.better }];
  });
  if (!rows.length) return <Empty text={`${who.name} has none of these measures${c.range.from || c.range.to ? ' in these dates' : ''}.`} />;
  const groupName = c.sameClass === false || who.gradYear == null ? 'the selected athletes' : `the class of ${who.gradYear}`;
  const top = [...rows].sort((a, b) => b.pct - a.pct)[0];
  return (
    <>
      <div data-pdf="headline" className={s.headline}>{who.name} vs {groupName}: best at {top.label} (top {Math.max(1, Math.round(100 - top.pct))}%)</div>
      {c.sameClass !== false && who.gradYear == null && <div data-pdf="note" className={s.note}>{who.name} has no grad year, so the comparison uses everyone selected.</div>}
      <SampleNote n={Math.min(...rows.map((r) => r.n))} />
      <PercentileBars rows={rows} />
      <p data-pdf="explain" className={s.explain}>Bar = percentile: the share of {groupName} this athlete is better than ({SUMMARY_LABEL[summary].toLowerCase()} value each, {rangeText(c.range)}). 50 = the middle of the group. For times, lower counts as better.</p>
      <ResultTable title={title} head={['Measure', who.name, 'Group median', 'Percentile', 'Athletes']}
        rows={rows.map((r) => [r.label, r.value, r.median, Math.round(r.pct), r.n])} />
    </>
  );
}

/** Each athlete's change: summary in period B minus summary in period A. */
function changes(series: api.StudyPoint[] | undefined, summary: Summary, better: api.StudyMeasure['better'], a: DateRange, b: DateRange, members: Set<number>) {
  const va = perAthlete(series, summary, better, a, members);
  const vb = perAthlete(series, summary, better, b, members);
  const out = new Map<number, number>();
  for (const [i, v] of va) if (vb.has(i)) out.set(i, vb.get(i)! - v);
  return out;
}

function ResultTable({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details>
      <summary className={s.linkBtn} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
        <span>Table ({rows.length} rows)</span>
        <button type="button" className={s.linkBtn} onClick={(e) => { e.preventDefault(); downloadCsv(title, [head, ...rows]); }}>Download CSV</button>
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table data-pdf="table" className={s.table}>
          <thead><tr>{head.map((h, i) => <th key={h + i} className={i ? s.num : undefined}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((v, i) => <td key={i} className={i ? s.num : undefined}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
