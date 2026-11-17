'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Settings -> Lifting -> VALD Import (Admins + Lifting editors).

     Pull now        a date range + filters, then PULL. Runs in the
                     background (progress shown); afterwards: sessions added
                     / replaced and the VALD athletes that matched no one in
                     the app (fix their name or birthday, then pull again).
     Automatic pull  on / off, every N days (14 by default), with its own
                     filters -- each run picks up everything since the last.

   Filters (empty = no limit): Devices (ForceDecks / DynaMo), Test types
   (all on by default), Sports + Groups (VALD groups -- an athlete in ANY
   chosen sport and ANY chosen group), Tags (ForceDecks only: DynaMo tests
   can't carry tags, so DynaMo is pulled whatever tags are chosen) and
   specific athletes. Pulling the same session again replaces its numbers;
   new sessions become the latest and the older ones move to History.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import styles from './page.module.css';
import ls from '@/components/lifting/lifting.module.css';

type Filters = api.ValdFilters;

const small: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 };
const REASONS: Record<string, string> = {
  'no-match': 'No athlete with this name in the app',
  'birthday-missing-in-app': 'Name matches, but the athlete has no birthday in the app',
  'birthday-different': 'Name matches, but the birthday is different',
  'several-matches': 'More than one athlete matches',
};
const DEVICE_LABEL: Record<string, string> = { forcedecks: 'ForceDecks', dynamo: 'DynaMo' };

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chip({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" className={on ? `${ls.chip} ${ls.chipOn}` : ls.chip} onClick={onClick} aria-pressed={on} title={title}>
      {label}
    </button>
  );
}

/** The shared filter controls (manual pull + automatic pull). */
function FilterEditor({ value, onChange, options }: { value: Filters; onChange: (f: Filters) => void; options: api.ValdOptions }) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const [search, setSearch] = useState('');
  const athleteName = useMemo(() => new Map(options.athletes.map((a) => [a.id, a.name])), [options.athletes]);
  const matches = search.trim()
    ? options.athletes.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()) && !value.playerIds.includes(a.id)).slice(0, 8)
    : [];
  const groupsByCategory = useMemo(() => {
    const m = new Map<string, api.ValdOptions['groups']>();
    for (const g of options.groups) m.set(g.category || 'Other', [...(m.get(g.category || 'Other') ?? []), g]);
    return [...m.entries()];
  }, [options.groups]);
  const tagsByType = useMemo(() => {
    const m = new Map<string, api.ValdOptions['tags']>();
    for (const t of options.tags) m.set(t.type || 'Tag', [...(m.get(t.type || 'Tag') ?? []), t]);
    return [...m.entries()];
  }, [options.tags]);
  const types = options.testTypes.filter((t) => value.devices.includes(t.device));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={small}>
        Devices
        <div className={ls.chips}>
          {(['forcedecks', 'dynamo'] as const).map((d) => (
            <Chip
              key={d}
              on={value.devices.includes(d)}
              label={DEVICE_LABEL[d]}
              onClick={() => {
                const next = toggle(value.devices, d) as Filters['devices'];
                if (next.length) set({ devices: next });
              }}
            />
          ))}
        </div>
      </div>

      <div style={small}>
        <span>
          Test types{' '}
          <button type="button" className={ls.linkBtn} onClick={() => set({ excludedTestTypes: [] })}>All</button>{' · '}
          <button type="button" className={ls.linkBtn} onClick={() => set({ excludedTestTypes: options.testTypes.map((t) => t.code) })}>None</button>
        </span>
        {(['forcedecks', 'dynamo'] as const).filter((d) => value.devices.includes(d)).map((d) => (
          <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{DEVICE_LABEL[d]}</span>
            <div className={ls.chips}>
              {types.filter((t) => t.device === d).map((t) => (
                <Chip
                  key={t.code}
                  on={!value.excludedTestTypes.includes(t.code)}
                  label={t.label}
                  title={t.code}
                  onClick={() => set({ excludedTestTypes: toggle(value.excludedTestTypes, t.code) })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={small}>
        Sports <span style={{ fontWeight: 400 }}>(none chosen = every sport)</span>
        <div className={ls.chips}>
          {options.sports.length === 0 && <span style={{ fontWeight: 400 }}>No sports in VALD.</span>}
          {options.sports.map((g) => (
            <Chip key={g.id} on={value.sportIds.includes(g.id)} label={g.name} onClick={() => set({ sportIds: toggle(value.sportIds, g.id) })} />
          ))}
        </div>
      </div>

      <div style={small}>
        Groups <span style={{ fontWeight: 400 }}>(none chosen = every group)</span>
        {groupsByCategory.map(([cat, list]) => (
          <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{cat}</span>
            <div className={ls.chips}>
              {list.map((g) => (
                <Chip key={g.id} on={value.groupIds.includes(g.id)} label={g.name} onClick={() => set({ groupIds: toggle(value.groupIds, g.id) })} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={small}>
        Tags <span style={{ fontWeight: 400 }}>(ForceDecks only -- DynaMo tests can&rsquo;t be tagged, so they&rsquo;re pulled whatever is chosen here)</span>
        {tagsByType.length === 0 && <span style={{ fontWeight: 400 }}>No tags used in VALD in the last year.</span>}
        {tagsByType.map(([type, list]) => (
          <div key={type} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{type}</span>
            <div className={ls.chips}>
              {list.map((t) => (
                <Chip key={t.id} on={value.tagIds.includes(t.id)} label={t.name} onClick={() => set({ tagIds: toggle(value.tagIds, t.id) })} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={small}>
        Athletes <span style={{ fontWeight: 400 }}>(none chosen = everyone)</span>
        <input className={styles.input} value={search} placeholder="Find an athlete" onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        {matches.length > 0 && (
          <div className={ls.chips}>
            {matches.map((a) => (
              <Chip key={a.id} on={false} label={`+ ${a.name}`} onClick={() => { set({ playerIds: [...value.playerIds, a.id] }); setSearch(''); }} />
            ))}
          </div>
        )}
        {value.playerIds.length > 0 && (
          <div className={ls.chips}>
            {value.playerIds.map((id) => (
              <Chip key={id} on label={`${athleteName.get(id) ?? 'Athlete'} ✕`} onClick={() => set({ playerIds: value.playerIds.filter((x) => x !== id) })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PullReport({ report }: { report: api.ValdPullReport }) {
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {report.kind === 'auto' ? 'Automatic pull' : 'Pull'} {report.from.slice(0, 10)} to {new Date(Date.parse(report.to) - 1).toISOString().slice(0, 10)}
          {report.running ? ` · ${report.phase}…` : ` · finished ${when(report.finishedAt)}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><strong>{report.added}</strong> new sessions</span>
        <span><strong>{report.replaced}</strong> replaced (pulled again)</span>
        <span><strong>{report.filteredOut}</strong> left out by the filters</span>
        {!!report.physicalShown && <span><strong>{report.physicalShown}</strong> athletes&rsquo; Physical tab turned on</span>}
        <span><strong>{report.unmatched.length}</strong> unmatched athletes</span>
      </div>
      {report.error && <div style={{ color: '#dc2626' }}>Stopped: {report.error}</div>}
      {!report.running && report.unmatched.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Unmatched VALD athletes</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Their tests weren&rsquo;t imported. Fix the name or birthday (in the app or in VALD) so they match, then pull again.
          </span>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>VALD athlete</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Birthday in VALD</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Why</th>
                  <th style={{ padding: '4px 0 4px 8px', fontWeight: 600 }}>Tests</th>
                </tr>
              </thead>
              <tbody>
                {report.unmatched.map((u, i) => (
                  <tr key={`${u.name}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>{u.name}</td>
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{u.birthday ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{REASONS[u.reason] ?? u.reason}</td>
                    <td style={{ padding: '4px 0 4px 8px' }}>{u.tests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ValdImport({ onDirty }: { onDirty: (d: boolean) => void }) {
  const [status, setStatus] = useState<api.ValdStatus | null>(null);
  const [options, setOptions] = useState<api.ValdOptions | null>(null);
  const [manual, setManual] = useState<api.ValdSettings['manual'] | null>(null);
  const [auto, setAuto] = useState<api.ValdSettings['auto'] | null>(null);
  const [savedAuto, setSavedAuto] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyStatus = useCallback((s: api.ValdStatus, takeSettings: boolean) => {
    setStatus(s);
    if (takeSettings) {
      setManual(s.settings.manual);
      setAuto(s.settings.auto);
      setSavedAuto(JSON.stringify(s.settings.auto));
    }
  }, []);

  const loadOptions = useCallback((refresh = false) => {
    setLoadingOptions(true);
    api.getValdOptions(refresh)
      .then(setOptions)
      .catch((e) => setError(e?.message || 'Could not read the lists from VALD'))
      .finally(() => setLoadingOptions(false));
  }, []);

  useEffect(() => {
    api.getValdStatus().then((s) => applyStatus(s, true)).catch((e) => setError(e?.message || 'Could not load the VALD import'));
    loadOptions();
    return () => { if (poll.current) clearTimeout(poll.current); };
  }, [applyStatus, loadOptions]);

  /* While a pull runs, check on it every 2 s. */
  const running = !!status?.job?.running;
  useEffect(() => {
    if (!running) return;
    poll.current = setTimeout(() => {
      api.getValdStatus().then((s) => applyStatus(s, false)).catch(() => undefined);
    }, 2000);
    return () => { if (poll.current) clearTimeout(poll.current); };
  }, [running, status, applyStatus]);

  const autoDirty = !!auto && JSON.stringify(auto) !== savedAuto;
  useEffect(() => { onDirty(autoDirty); }, [autoDirty, onDirty]);

  const pull = async () => {
    if (!manual) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      applyStatus(await api.startValdPull(manual), false);
    } catch (e: any) {
      setError(e?.message || 'Could not start the pull');
    } finally {
      setBusy(false);
    }
  };

  const saveAuto = async () => {
    if (!auto) return;
    setBusy(true);
    setError('');
    try {
      const s = await api.saveValdSettings({ auto });
      applyStatus(s, false);
      setAuto(s.settings.auto);
      setSavedAuto(JSON.stringify(s.settings.auto));
      setNote('Automatic pull settings saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div className={styles.card}><div className={styles.cardDesc}>{error || 'Loading…'}</div></div>;
  }
  if (!status.configured) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>VALD Import</h3>
        <p className={styles.cardDesc}>
          VALD isn&rsquo;t connected on this server. An Admin adds VALD_CLIENT_ID, VALD_CLIENT_SECRET and VALD_TENANT_ID to the
          API&rsquo;s environment (Render: pdev-api &rarr; Environment).
        </p>
      </div>
    );
  }
  const report = status.job ?? status.last;

  return (
    <>
      <div className={styles.card} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>Pull from VALD</h3>
          <button type="button" className={styles.btnSecondary} onClick={() => loadOptions(true)} disabled={loadingOptions}>
            {loadingOptions ? 'Reading VALD…' : 'Refresh VALD lists'}
          </button>
        </div>
        <p className={styles.cardDesc} style={{ margin: 0 }}>
          Imports ForceDecks and DynaMo sessions into athletes&rsquo; Lifting Reports. Athletes are matched by VALD&rsquo;s External ID
          (= Athlete ID) when set, otherwise by first + last name and birthday. Pulling a session again replaces its numbers; a
          newer session becomes the latest and the older ones stay in History. A new session turns the athlete&rsquo;s Physical tab on.
        </p>
        {manual && options && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label style={small}>
                From
                <input className={styles.input} type="date" value={manual.from} max={manual.to} onChange={(e) => setManual({ ...manual, from: e.target.value })} />
              </label>
              <label style={small}>
                To
                <input className={styles.input} type="date" value={manual.to} min={manual.from} onChange={(e) => setManual({ ...manual, to: e.target.value })} />
              </label>
            </div>
            <FilterEditor value={manual} onChange={(f) => setManual({ ...manual, ...f })} options={options} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className={styles.btn} onClick={pull} disabled={busy || running || !manual.from || !manual.to}>
                {running ? 'Pulling…' : 'PULL'}
              </button>
              {running && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{status.job?.phase}… you can leave this page; it keeps going.</span>}
            </div>
          </>
        )}
        {!options && <div className={styles.cardDesc}>{loadingOptions ? 'Reading sports, groups and tags from VALD…' : ''}</div>}
        {error && <div style={{ fontSize: 13, color: '#dc2626' }}>{error}</div>}
        {report && <PullReport report={report} />}
      </div>

      {auto && options && (
        <div className={styles.card} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h3 className={styles.cardTitle} style={{ margin: 0 }}>Automatic pull</h3>
            <button type="button" className={styles.btn} onClick={saveAuto} disabled={busy || !autoDirty}>{autoDirty ? 'Save' : 'Saved'}</button>
          </div>
          <p className={styles.cardDesc} style={{ margin: 0 }}>
            When on, the app pulls on its own every few days, picking up every session since the last automatic pull, with these
            filters.
          </p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={auto.enabled} onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })} />
              On
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Every
              <input
                className={styles.input}
                type="number"
                min={1}
                max={90}
                value={auto.everyDays}
                onChange={(e) => setAuto({ ...auto, everyDays: Math.max(1, Math.min(90, Math.round(Number(e.target.value) || 14))) })}
                style={{ width: 70, minWidth: 0 }}
              />
              days
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {auto.lastRunAt ? `Last: ${new Date(auto.lastRunAt).toLocaleDateString()}` : 'Not run yet'}
              {status.nextAutoAt && auto.enabled && !autoDirty ? ` · Next: ${new Date(status.nextAutoAt).toLocaleDateString()}` : ''}
            </span>
          </div>
          <FilterEditor value={auto} onChange={(f) => setAuto({ ...auto, ...f })} options={options} />
          {note && <div style={{ fontSize: 13, color: '#16a34a' }}>{note}</div>}
        </div>
      )}
    </>
  );
}
