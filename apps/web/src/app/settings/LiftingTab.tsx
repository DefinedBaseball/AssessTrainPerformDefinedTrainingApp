'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Settings -> Lifting (Admins + Lifting editors).

     Dashboard           the default layout -- what every athlete's Lifting
                         Dashboard (and the coach Lifting page) shows.
     Athlete Dashboards  give one or many athletes (ticked) their own
                         layout; it replaces the default for them until
                         "Back to default".
     Editors             (Admin) which coaches may edit layouts.

   A layout is bubbles (a name, the test that feeds it, an optional note),
   each holding boxes (a name, the metric -- any result the test reports,
   including ones VALD sends that the list didn't know yet -- or a ratio of
   two metrics like ER:IR, unit, display factor, decimals, better).
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useFacilityPrograms } from '@/lib/use-facility-programs';
import { activeScheduledPrograms } from '@/lib/facility-schedule';
import styles from './page.module.css';
import ls from '@/components/lifting/lifting.module.css';

type Kpi = api.LiftingKpi;
type Bubble = api.LiftingBubble;
type Catalog = api.LiftingCatalogTest[];
type Sub = 'dashboard' | 'athletes' | 'editors';

const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const RATIO = '__ratio__';
const GROUP_ORDER = ['Main', 'Power', 'Velocity', 'Force', 'Impulse', 'Rate of Force', 'Timing', 'Left / Right', 'Asymmetry', 'More from results'];
const SOURCE_GROUPS: [string, string][] = [
  ['vald:forcedecks', 'VALD ForceDecks'],
  ['vald:dynamo', 'VALD DynaMo'],
  ['manual', 'Typed in by coaches'],
  ['other', 'Other tests (from saved results)'],
];
const small: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 };
const sameLayout = (a: Bubble[], b: Bubble[]) => JSON.stringify(a) === JSON.stringify(b);

export function LiftingTab() {
  const { isAdmin } = useAuth();
  const [sub, setSub] = useState<Sub>('dashboard');
  const [athlete, setAthlete] = useState('');
  const [data, setData] = useState<api.LiftingConfigResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);

  /* Deep link: /settings?tab=lifting&athlete=<id> (athlete dashboard's
     "Customize Layout"). */
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('athlete');
    if (want) { setSub('athletes'); setAthlete(want); }
  }, []);

  useEffect(() => {
    api.getLiftingConfig().then(setData).catch((e) => setLoadError(e?.message || 'Could not load the layout'));
  }, []);

  /* Unsaved edits are lost when you switch -- ask first. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const go = (next: Sub) => {
    if (next === sub) return;
    if (dirty && !window.confirm('Leave without saving your layout changes?')) return;
    setDirty(false);
    setSub(next);
  };

  if (!data) return <div className={styles.section}><div className={styles.card}><div className={styles.cardDesc}>{loadError || 'Loading…'}</div></div></div>;
  if (!data.canEdit) {
    return <div className={styles.section}><div className={styles.card}><div className={styles.cardDesc}>Only Admins and Lifting editors can change the Lifting Report.</div></div></div>;
  }

  const subs: { key: Sub; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'athletes', label: 'Athlete Dashboards' },
    ...(isAdmin ? [{ key: 'editors' as Sub, label: 'Editors' }] : []),
  ];

  return (
    <div className={`${styles.section} ${styles.liftingEditor}`}>
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 className={styles.cardTitle} style={{ margin: 0 }}>Lifting</h3>
        <div className={ls.chips} role="tablist" aria-label="Lifting settings">
          {subs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={sub === t.key}
              className={sub === t.key ? `${ls.chip} ${ls.chipOn}` : ls.chip}
              onClick={() => go(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {sub === 'dashboard' && <DefaultDashboard data={data} onSaved={setData} onDirty={setDirty} />}
      {sub === 'athletes' && (
        <AthleteDashboards
          catalog={data.catalog}
          defaultBubbles={data.config.bubbles}
          initialId={athlete}
          onDirty={setDirty}
        />
      )}
      {sub === 'editors' && isAdmin && <Editors />}
    </div>
  );
}

/* ── Dashboard: the default layout ─────────────────────────────────────── */

function DefaultDashboard({ data, onSaved, onDirty }: {
  data: api.LiftingConfigResponse;
  onSaved: (d: api.LiftingConfigResponse) => void;
  onDirty: (d: boolean) => void;
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>(data.config.bubbles);
  const [saved, setSaved] = useState<Bubble[]>(data.config.bubbles);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = !sameLayout(bubbles, saved);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const done = (d: api.LiftingConfigResponse, text: string) => {
    onSaved(d);
    setBubbles(d.config.bubbles);
    setSaved(d.config.bubbles);
    setMsg({ ok: true, text });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      done(await api.saveLiftingConfig({ version: 1, bubbles }), 'Saved -- every athlete without their own layout, and the Lifting page, now use this.');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not save' });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Reset the default Dashboard to the original bubbles? Your changes to it are lost (results and athletes’ own layouts are not touched).')) return;
    setBusy(true);
    try {
      done(await api.resetLiftingConfig(), 'Back to the original default layout.');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not reset' });
    } finally {
      setBusy(false);
    }
  };

  const saveBtn = <button type="button" className={styles.btn} onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : dirty ? 'Save Dashboard' : 'Saved'}</button>;

  return (
    <>
      <div className={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>Default Dashboard</h3>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={styles.btnSecondary} onClick={reset} disabled={busy}>Reset to original</button>
            {saveBtn}
          </span>
        </div>
        <p className={styles.cardDesc}>
          What every athlete sees on their Lifting Report, and the columns on the Lifting page. Each bubble shows one test;
          each box one number from it -- any result VALD reports for that test (or a ratio of two, like ER:IR). Athletes given
          their own layout under <strong>Athlete Dashboards</strong> see theirs instead. Bubbles an athlete has no results for stay hidden.
          {data.isDefault && ' Showing the original layout.'}
        </p>
        {msg && <div style={{ fontSize: 13, color: msg.ok ? '#16a34a' : '#dc2626' }}>{msg.text}</div>}
      </div>
      <LayoutEditor bubbles={bubbles} setBubbles={setBubbles} catalog={data.catalog} />
      <div className={styles.card} style={{ display: 'flex', justifyContent: 'flex-end' }}>{saveBtn}</div>
    </>
  );
}

/* ── Athlete Dashboards: own layouts for one or many athletes ──────────── */

const ALL_PROGRAMS = '__all__';
const DEFAULT_START = '__default__';
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function AthleteDashboards({ catalog, defaultBubbles, initialId, onDirty }: {
  catalog: Catalog;
  defaultBubbles: Bubble[];
  initialId: string;
  onDirty: (d: boolean) => void;
}) {
  const programs = useFacilityPrograms();
  const [players, setPlayers] = useState<api.Player[] | null>(null);
  const [own, setOwn] = useState<api.LiftingOwnLayout[]>([]);
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState(ALL_PROGRAMS);
  const [selected, setSelected] = useState<string[]>(() => (initialId ? [initialId] : []));
  const [start, setStart] = useState(DEFAULT_START);
  /* null = not editing yet. Picking more athletes while editing keeps the
     edits -- Save applies them to everyone picked at that moment. */
  const [bubbles, setBubbles] = useState<Bubble[] | null>(null);
  const [saved, setSaved] = useState<{ layout: string; ids: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadOwn = () => api.getLiftingLayouts().then(setOwn).catch(() => setOwn([]));
  useEffect(() => {
    api.getPlayers().then(setPlayers).catch(() => setPlayers([]));
    loadOwn();
  }, []);
  useEffect(() => {
    if (initialId) setSelected((cur) => (cur.includes(initialId) ? cur : [...cur, initialId]));
  }, [initialId]);

  const ownBy = useMemo(() => new Map(own.map((o) => [o.playerId, o])), [own]);
  const sorted = useMemo(
    () => [...(players ?? [])].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)),
    [players],
  );
  const byId = useMemo(() => new Map(sorted.map((p) => [p.id, p])), [sorted]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayIso();
    return sorted.filter((p) =>
      (!q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
      && (program === ALL_PROGRAMS || activeScheduledPrograms(p.facilitySchedule, today).has(program)));
  }, [sorted, search, program]);

  const picked = new Set(selected);
  const nameOf = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.firstName} ${p.lastName}` : ownBy.get(id)?.name ?? 'Athlete';
  };
  const selectedOwn = selected.filter((id) => ownBy.has(id));
  const n = selected.length;
  const who = n === 1 ? nameOf(selected[0]) : `${n} athletes`;
  const idsKey = [...selected].sort().join(',');

  /* "Start from": one picked athlete's own layout, else the default. */
  useEffect(() => {
    if (bubbles) return;
    setStart(selectedOwn.length === 1 && n === 1 ? selectedOwn[0] : DEFAULT_START);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, own]);

  const dirty = bubbles != null && (saved == null || saved.layout !== JSON.stringify(bubbles) || saved.ids !== idsKey);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const selectShown = () => setSelected((cur) => [...new Set([...cur, ...shown.map((p) => p.id)])]);

  const customize = () => {
    const from = start === DEFAULT_START ? defaultBubbles : ownBy.get(start)?.config?.bubbles ?? defaultBubbles;
    setBubbles(JSON.parse(JSON.stringify(from)));
    setSaved(null);
    setMsg(null);
  };

  const save = async () => {
    if (!bubbles || !n) return;
    const replaced = selectedOwn.filter((id) => JSON.stringify(ownBy.get(id)?.config?.bubbles) !== JSON.stringify(bubbles));
    if (n > 1 || replaced.length) {
      const list = replaced.map(nameOf);
      const shownNames = list.slice(0, 6).join(', ') + (list.length > 6 ? ` and ${list.length - 6} more` : '');
      const note = replaced.length ? `\n\nThis replaces the own layout of ${shownNames}.` : '';
      if (!window.confirm(`Save this layout for ${who}?${note}`)) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      setOwn(await api.saveLiftingLayouts(selected, { version: 1, bubbles }));
      setSaved({ layout: JSON.stringify(bubbles), ids: idsKey });
      setMsg({ ok: true, text: `Saved -- ${who} now ${n === 1 ? 'sees' : 'see'} this layout instead of the default.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not save' });
    } finally {
      setBusy(false);
    }
  };

  const backToDefault = async () => {
    if (!selectedOwn.length) return;
    const list = selectedOwn.map(nameOf);
    const names = list.slice(0, 6).join(', ') + (list.length > 6 ? ` and ${list.length - 6} more` : '');
    if (!window.confirm(`Put ${names} back on the default Dashboard? Their own layout is removed (results are not touched).`)) return;
    setBusy(true);
    try {
      setOwn(await api.resetLiftingLayouts(selectedOwn));
      setBubbles(null);
      setSaved(null);
      setMsg({ ok: true, text: `${selectedOwn.length === 1 ? names : `${selectedOwn.length} athletes`} back on the default Dashboard.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not reset' });
    } finally {
      setBusy(false);
    }
  };

  const saveLabel = busy ? 'Saving…' : dirty ? `Save for ${n === 1 ? nameOf(selected[0]).split(' ')[0] : `${n} Athletes`}` : 'Saved';

  return (
    <>
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 className={styles.cardTitle} style={{ margin: 0 }}>Athlete Dashboards</h3>
        <p className={styles.cardDesc} style={{ margin: 0 }}>
          Give athletes their own layout -- e.g. extra shoulder boxes for your pitchers, or no Plyo Push-up for novices. Tick one
          athlete or many; the layout you save goes to every athlete ticked. It replaces the default Dashboard for them only, and
          later changes to the default don&rsquo;t reach them until you put them back on the default.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={small}>
            Find an athlete
            <input className={styles.input} value={search} placeholder="Type a name" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label style={small}>
            Program
            <select className={styles.input} value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value={ALL_PROGRAMS}>All athletes</option>
              {programs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={styles.btnSecondary} onClick={selectShown} disabled={!shown.length}>Select all shown ({shown.length})</button>
          <button type="button" className={styles.btnSecondary} onClick={() => setSelected([])} disabled={!n}>Clear</button>
          {own.length > 0 && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setSelected((cur) => [...new Set([...cur, ...own.map((o) => o.playerId)])])}
            >
              Select everyone with their own layout ({own.length})
            </button>
          )}
        </div>
        <div
          role="group"
          aria-label="Athletes"
          style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '4px 0' }}
        >
          {!players && <div className={styles.cardDesc} style={{ padding: 8 }}>Loading…</div>}
          {players && !shown.length && <div className={styles.cardDesc} style={{ padding: 8 }}>No athletes match.</div>}
          {shown.map((p) => (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span style={{ fontWeight: 600 }}>{p.lastName}, {p.firstName}</span>
              {ownBy.has(p.id) && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>own layout</span>}
            </label>
          ))}
        </div>
        {n > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={small}>Selected ({n})</span>
            <div className={ls.chips}>
              {selected.map((id) => (
                <button key={id} type="button" className={`${ls.chip} ${ls.chipOn}`} onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`}>
                  {nameOf(id)} ✕
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {n > 0 && (
        <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h3 className={styles.cardTitle} style={{ margin: 0 }}>
              {who}
              <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                {bubbles
                  ? (saved && saved.ids === idsKey ? 'Own layout' : 'Editing (not saved yet)')
                  : n === 1
                    ? (selectedOwn.length ? 'Own layout' : 'Uses the default Dashboard')
                    : `${n - selectedOwn.length} on the default · ${selectedOwn.length} with their own layout`}
              </span>
            </h3>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {n === 1 && (
                <Link href={`/athletes/${selected[0]}?tab=strength`} className={styles.btnSecondary} style={{ textDecoration: 'none' }}>View dashboard →</Link>
              )}
              {selectedOwn.length > 0 && (
                <button type="button" className={styles.btnSecondary} onClick={backToDefault} disabled={busy}>
                  {n === 1 ? 'Back to default' : `Put ${selectedOwn.length} back on default`}
                </button>
              )}
              {bubbles ? (
                <>
                  <button type="button" className={styles.btnSecondary} onClick={() => { setBubbles(null); setSaved(null); }} disabled={busy}>
                    {dirty ? 'Cancel' : 'Done'}
                  </button>
                  <button type="button" className={styles.btn} onClick={save} disabled={busy || !dirty}>{saveLabel}</button>
                </>
              ) : (
                <button type="button" className={styles.btn} onClick={customize}>
                  {n === 1 && selectedOwn.length ? 'Edit layout' : 'Customize'}
                </button>
              )}
            </span>
          </div>
          {!bubbles && (
            <label style={{ ...small, maxWidth: 360 }}>
              Start from
              <select className={styles.input} value={start} onChange={(e) => setStart(e.target.value)}>
                <option value={DEFAULT_START}>The default Dashboard</option>
                {own.filter((o) => picked.has(o.playerId) || n === 0).concat(own.filter((o) => !picked.has(o.playerId))).map((o) => (
                  <option key={o.playerId} value={o.playerId}>{o.name}&rsquo;s own layout</option>
                ))}
              </select>
            </label>
          )}
          {msg && <div style={{ fontSize: 13, color: msg.ok ? '#16a34a' : '#dc2626' }}>{msg.text}</div>}
        </div>
      )}

      {n > 0 && bubbles && (
        <>
          <LayoutEditor bubbles={bubbles} setBubbles={(f) => setBubbles((cur) => (cur ? f(cur) : cur))} catalog={catalog} />
          <div className={styles.card} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className={styles.btn} onClick={save} disabled={busy || !dirty}>{saveLabel}</button>
          </div>
        </>
      )}
    </>
  );
}

/* ── Editors (Admin) ───────────────────────────────────────────────────── */

function Editors() {
  const [editors, setEditors] = useState<{ id: string; name: string; level: string; liftingEditor: boolean }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.getLiftingEditors().then(setEditors).catch(() => setEditors([])); }, []);

  const toggle = async (id: string, on: boolean) => {
    setEditors((list) => list?.map((e) => (e.id === id ? { ...e, liftingEditor: on } : e)) ?? null);
    try { await api.setLiftingEditor(id, on); } catch (e: any) {
      setEditors((list) => list?.map((x) => (x.id === id ? { ...x, liftingEditor: !on } : x)) ?? null);
      setError(e?.message || 'Could not change that');
    }
  };

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Who can edit Lifting layouts</h3>
      <p className={styles.cardDesc}>Admins can always edit the default Dashboard and athletes&rsquo; own layouts. Switch on any other coach (e.g. your strength coach) to let them too.</p>
      {error && <div style={{ fontSize: 13, color: '#dc2626' }}>{error}</div>}
      {editors === null ? <div className={styles.cardDesc}>Loading…</div> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {editors.filter((e) => e.level !== 'VIEWER').map((e) => (
            <label key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={e.level === 'ADMIN' || e.liftingEditor}
                disabled={e.level === 'ADMIN'}
                onChange={(ev) => toggle(e.id, ev.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>{e.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.level === 'ADMIN' ? 'Admin' : 'Coach'}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── The layout editor (default and athlete layouts share it) ──────────── */

function MetricOptions({ metrics }: { metrics: api.LiftingCatalogMetric[] }) {
  const groups = new Map<string, api.LiftingCatalogMetric[]>();
  for (const m of metrics) {
    const g = m.group || 'Main';
    groups.set(g, [...(groups.get(g) ?? []), m]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <>
      {order.map((g) => (
        <optgroup key={g} label={g}>
          {groups.get(g)!.map((m) => <option key={m.key} value={m.key}>{m.label}{m.unit ? ` (${m.unit})` : ''}</option>)}
        </optgroup>
      ))}
    </>
  );
}

function TestOptions({ catalog }: { catalog: Catalog }) {
  return (
    <>
      {SOURCE_GROUPS.map(([src, label]) => {
        const list = catalog.filter((t) => (SOURCE_GROUPS.some(([s]) => s === t.source) ? t.source : 'other') === src);
        if (!list.length) return null;
        return (
          <optgroup key={src} label={label}>
            {list.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}

function LayoutEditor({ bubbles, setBubbles, catalog }: {
  bubbles: Bubble[];
  setBubbles: (f: (list: Bubble[]) => Bubble[]) => void;
  catalog: Catalog;
}) {
  const metricsFor = (test: string) => catalog.find((t) => t.code === test)?.metrics ?? [];
  const testCodes = useMemo(() => new Set(catalog.map((t) => t.code)), [catalog]);

  const setBubble = (i: number, patch: Partial<Bubble>) =>
    setBubbles((list) => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setKpi = (bi: number, ki: number, patch: Partial<Kpi>) =>
    setBubbles((list) => list.map((b, j) => (j === bi ? { ...b, kpis: b.kpis.map((k, n) => (n === ki ? { ...k, ...patch } : k)) } : b)));
  const move = <T,>(arr: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const newKpi = (test: string): Kpi => {
    const m = metricsFor(test)[0];
    return { id: newId('k'), label: m?.label ?? 'Value', metric: m?.key ?? 'value', unit: m?.unit ?? '', factor: 1, digits: 1, better: 'high' };
  };

  const addBubble = () => {
    const test = catalog[0]?.code ?? 'CMJ';
    setBubbles((list) => [...list, { id: newId('b'), title: 'New bubble', test, kpis: [newKpi(test)] }]);
  };

  /* Picking a metric fills in its name and unit when they were the
     previous metric's defaults. */
  const pickMetric = (bi: number, ki: number, value: string) => {
    const b = bubbles[bi];
    const k = b.kpis[ki];
    if (value === RATIO) {
      setKpi(bi, ki, {
        metric: undefined, unit: '', factor: 1, digits: 2, better: null,
        ratio: { num: { test: 'ER', metric: 'peakForce' }, den: { test: 'IR', metric: 'peakForce' } },
        label: k.ratio ? k.label : 'Ratio',
      });
      return;
    }
    const m = metricsFor(b.test).find((x) => x.key === value);
    const old = metricsFor(b.test).find((x) => x.key === k.metric);
    setKpi(bi, ki, {
      metric: value, ratio: undefined,
      label: !old || k.label === old.label || k.label === 'Ratio' ? (m?.label ?? k.label) : k.label,
      unit: !old || k.unit === old.unit ? (m?.unit ?? k.unit) : k.unit,
    });
  };

  return (
    <>
      {bubbles.map((b, bi) => (
        <div key={b.id} className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 10, alignItems: 'end' }}>
            <label style={small}>
              Bubble name
              <input className={styles.input} value={b.title} maxLength={60} onChange={(e) => setBubble(bi, { title: e.target.value })} />
            </label>
            <label style={small}>
              Test
              <select className={styles.input} value={b.test} onChange={(e) => setBubble(bi, { test: e.target.value })}>
                {!testCodes.has(b.test) && <option value={b.test}>{b.test}</option>}
                <TestOptions catalog={catalog} />
              </select>
            </label>
            <label style={small}>
              Note (optional)
              <input className={styles.input} value={b.note ?? ''} maxLength={60} placeholder="e.g. Advanced athletes" onChange={(e) => setBubble(bi, { note: e.target.value || undefined })} />
            </label>
            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className={styles.btnSecondary} aria-label="Move bubble up" onClick={() => setBubbles((l) => move(l, bi, -1))} disabled={bi === 0}>↑</button>
              <button type="button" className={styles.btnSecondary} aria-label="Move bubble down" onClick={() => setBubbles((l) => move(l, bi, 1))} disabled={bi === bubbles.length - 1}>↓</button>
              <button type="button" className={styles.btnSecondary} onClick={() => setBubbles((l) => l.filter((_, j) => j !== bi))}>Remove</button>
            </span>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {b.kpis.map((k, ki) => (
              <div key={k.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))', gap: 8, alignItems: 'end', padding: 8, border: '1px solid var(--border)', borderRadius: 10 }}>
                <label style={small}>
                  Box name
                  <input className={styles.input} value={k.label} maxLength={60} onChange={(e) => setKpi(bi, ki, { label: e.target.value })} />
                </label>
                <label style={small}>
                  Metric
                  <select className={styles.input} value={k.ratio ? RATIO : k.metric ?? ''} onChange={(e) => pickMetric(bi, ki, e.target.value)}>
                    {k.metric && !metricsFor(b.test).some((m) => m.key === k.metric) && <option value={k.metric}>{k.metric}</option>}
                    <MetricOptions metrics={metricsFor(b.test)} />
                    <optgroup label="Computed">
                      <option value={RATIO}>Ratio of two metrics…</option>
                    </optgroup>
                  </select>
                </label>
                {k.ratio && (['num', 'den'] as const).map((side) => (
                  <label key={side} style={small}>
                    {side === 'num' ? 'Top' : 'Bottom'}
                    <select
                      className={styles.input}
                      value={`${k.ratio![side].test}.${k.ratio![side].metric}`}
                      onChange={(e) => {
                        const [test, metric] = e.target.value.split('.');
                        setKpi(bi, ki, { ratio: { ...k.ratio!, [side]: { test, metric } } });
                      }}
                    >
                      {!metricsFor(k.ratio![side].test).some((m) => m.key === k.ratio![side].metric) && (
                        <option value={`${k.ratio![side].test}.${k.ratio![side].metric}`}>{k.ratio![side].test}: {k.ratio![side].metric}</option>
                      )}
                      {catalog.map((t) => (
                        <optgroup key={t.code} label={t.label}>
                          {t.metrics.map((m) => <option key={m.key} value={`${t.code}.${m.key}`}>{t.label}: {m.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                ))}
                <label style={small}>
                  Unit
                  <input className={styles.input} value={k.unit} maxLength={12} onChange={(e) => setKpi(bi, ki, { unit: e.target.value })} />
                </label>
                <label style={small} title="Shown value = stored value × this (e.g. 0.3937 turns cm into inches)">
                  × Factor
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={String(k.factor)}
                    onChange={(e) => { const n = Number(e.target.value); setKpi(bi, ki, { factor: Number.isFinite(n) && n > 0 ? n : 1 }); }}
                  />
                </label>
                <label style={small}>
                  Decimals
                  <select className={styles.input} value={k.digits} onChange={(e) => setKpi(bi, ki, { digits: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label style={small}>
                  Better
                  <select className={styles.input} value={k.better ?? ''} onChange={(e) => setKpi(bi, ki, { better: (e.target.value || null) as Kpi['better'] })}>
                    <option value="high">Higher</option>
                    <option value="low">Lower</option>
                    <option value="">No direction</option>
                  </select>
                </label>
                <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button type="button" className={styles.btnSecondary} aria-label="Move box up" onClick={() => setBubble(bi, { kpis: move(b.kpis, ki, -1) })} disabled={ki === 0}>↑</button>
                  <button type="button" className={styles.btnSecondary} aria-label="Move box down" onClick={() => setBubble(bi, { kpis: move(b.kpis, ki, 1) })} disabled={ki === b.kpis.length - 1}>↓</button>
                  <button type="button" className={styles.btnSecondary} aria-label="Remove box" onClick={() => setBubble(bi, { kpis: b.kpis.filter((_, n) => n !== ki) })} disabled={b.kpis.length === 1}>✕</button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className={styles.btnSecondary} style={{ alignSelf: 'flex-start' }} onClick={() => setBubble(bi, { kpis: [...b.kpis, newKpi(b.test)] })}>+ Add box</button>
        </div>
      ))}

      <div className={styles.card}>
        <button type="button" className={styles.btnSecondary} onClick={addBubble}>+ Add bubble</button>
      </div>
    </>
  );
}
