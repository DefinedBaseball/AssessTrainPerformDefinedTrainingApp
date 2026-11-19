'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Data -> Data Sets (coaches only): reference tables uploaded as CSV or
   Excel -- MLB / college / age-group averages, published study numbers.
   First row = column names. The coach picks the group column (MLB, D1,
   Age 16 ...), keeps the number columns, sets units, and can link a column
   to a Player Data metric so charts can put an athlete beside the groups
   (Chart Builder -> Data Source) or draw a benchmark line.
   The file is read in the browser; only the cleaned table is sent.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import styles from './page.module.css';

type Cell = string | number | null;
interface Draft {
  id?: string;
  name: string;
  description: string;
  source: string;
  labelColumn: string;
  /** Where each row's group name sits in `table`. */
  labelKey: string;
  /** All file columns with whether they're kept as numbers. */
  columns: { key: string; name: string; unit: string; keep: boolean; numeric: boolean; link: string }[];
  /** Raw rows by file column name (new upload) -- or the saved rows (editing). */
  table: Record<string, Cell>[];
}

const toNumber = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/[%,$\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const keyOf = (name: string, i: number) => (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'col') + `_${i}`;
/** "Exit Velo (mph)" -> "mph". */
const unitFrom = (name: string) => /\(([^)]{1,12})\)\s*$/.exec(name)?.[1] ?? '';
/** A row's cell for a column: by key (a saved data set) or by file column name (a new upload). */
const cellOf = (r: Record<string, Cell>, c: { key: string; name: string }): Cell => (r[c.key] !== undefined ? r[c.key] : r[c.name] ?? null);
const linkValue = (l?: { source: string; metricType: string } | null) => (l ? `${l.source}::${l.metricType}` : '');

/* Suggest a Player Data metric from a column name (only when it's a clear match). */
function suggestLink(name: string, cols: api.AnalyticsColumn[]): string {
  const n = name.toLowerCase();
  const pick = (source: string, metricType: string) => (cols.some((c) => c.source === source && c.metricType === metricType) ? `${source}::${metricType}` : '');
  if (/exit\s*velo|\bev\b/.test(n)) return pick('BATTED_BALL', 'max_exit_velo');
  if (/bat\s*speed/.test(n)) return pick('BLAST_MOTION', 'max_bat_speed');
  if (/attack\s*angle/.test(n)) return pick('BLAST_MOTION', 'attack_angle');
  if (/launch\s*angle/.test(n)) return pick('BATTED_BALL', 'launch_angle');
  if (/(fastball|fb).*velo|velo.*(fastball|fb)/.test(n)) return pick('TM_PITCH', 'relSpeed|Fastball');
  if (/spin/.test(n) && /(fastball|fb)/.test(n)) return pick('TM_PITCH', 'spinRate|Fastball');
  if (/pop\s*time/.test(n)) return pick('MANUAL', 'pop_time');
  if (/body\s*weight|^weight/.test(n)) return pick('BODY_WEIGHT', 'weight');
  if (/jump\s*height|cmj/.test(n)) return pick('LIFTING', 'CMJ:JUMP_HEIGHT_INCHES_IMP_MOM');
  return '';
}

export function DataSetsPane() {
  const { isViewer } = useAuth();
  const [sets, setSets] = useState<api.DataSetSummary[] | null>(null);
  const [playerCols, setPlayerCols] = useState<api.AnalyticsColumn[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<api.DataSetSummary | null>(null);

  const load = () => api.listDataSets().then(setSets).catch((e) => setError(e?.message || 'Could not load data sets'));
  useEffect(() => {
    load();
    api.getAnalyticsColumns('builder').then(setPlayerCols).catch(() => setPlayerCols([]));
  }, []);

  const linkGroups = useMemo(() => {
    const m = new Map<string, api.AnalyticsColumn[]>();
    for (const c of playerCols) m.set(c.group ?? c.source, [...(m.get(c.group ?? c.source) ?? []), c]);
    return [...m.entries()];
  }, [playerCols]);

  /* ── Reading a file (CSV or Excel) ── */
  const onFile = async (file: File) => {
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('That file is over 5 MB'); return; }
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
      const header = (grid[0] ?? []).map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
      const body = grid.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
      if (!header.length || !body.length) { setError('The file needs a header row and at least one row of data'); return; }
      if (body.length > 2000) { setError('2,000 rows at most'); return; }
      /* Rows keyed by column key; "Exit Velo (mph)" -> name "Exit Velo", unit "mph". */
      const keys = header.map((h, i) => keyOf(h, i));
      const table = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
      const columns = header.map((h, i) => {
        const vals = table.map((r) => r[keys[i]]).filter((v) => v != null && String(v).trim() !== '');
        const nums = vals.filter((v) => toNumber(v) != null).length;
        const numeric = vals.length > 0 && nums / vals.length >= 0.6;
        const unit = unitFrom(h);
        const name = unit ? h.replace(/\s*\([^)]{1,12}\)\s*$/, '') : h;
        return { key: keys[i], name, unit, keep: numeric, numeric, link: numeric ? suggestLink(h, playerCols) : '' };
      });
      const label = columns.find((c) => !c.numeric) ?? columns[0];
      setDraft({
        name: file.name.replace(/\.(csv|xlsx|xls)$/i, ''),
        description: '',
        source: '',
        labelColumn: label.name,
        labelKey: label.key,
        columns: columns.map((c) => (c.key === label.key ? { ...c, keep: false } : c)),
        table,
      });
    } catch (e: any) {
      setError(`Could not read that file${e?.message ? ` (${e.message})` : ''}`);
    }
  };

  /* ── Editing a saved one (name, units, links) ── */
  const edit = async (id: string) => {
    setError('');
    try {
      const d = await api.getDataSet(id);
      const label = d.labelColumn || 'Group';
      setDraft({
        id: d.id,
        name: d.name,
        description: d.description ?? '',
        source: d.source ?? '',
        labelColumn: label,
        labelKey: '__label',
        columns: [
          { key: '__label', name: label, unit: '', keep: false, numeric: false, link: '' },
          ...d.columns.map((c) => ({ key: c.key, name: c.name, unit: c.unit, keep: true, numeric: true, link: linkValue(c.link) })),
        ],
        table: (d.rows ?? []).map((r) => ({ __label: r.label, ...Object.fromEntries(d.columns.map((c) => [c.key, r.values[c.key]])) })),
      });
    } catch (e: any) { setError(e?.message || 'Could not open it'); }
  };

  const save = async () => {
    if (!draft) return;
    const kept = draft.columns.filter((c) => c.keep && c.key !== draft.labelKey);
    if (!draft.name.trim()) { setError('Give the data set a name'); return; }
    if (!kept.length) { setError('Keep at least one number column'); return; }
    setBusy(true);
    setError('');
    try {
      const body: api.DataSetInput = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        source: draft.source.trim() || null,
        labelColumn: draft.labelColumn,
        columns: kept.map((c) => {
          const [source, metricType] = c.link ? c.link.split('::') : [];
          return { key: c.key, name: c.name, unit: c.unit.trim(), link: c.link ? { source, metricType } : null };
        }),
        rows: draft.table.map((r) => ({
          label: String(r[draft.labelKey] ?? '').trim(),
          values: Object.fromEntries(kept.map((c) => [c.key, toNumber(cellOf(r, c))])),
        })),
      };
      await api.saveDataSet(body, draft.id);
      setDraft(null);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save the data set');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: api.DataSetSummary) => {
    if (!window.confirm(`Delete the data set "${d.name}"? Charts using it will show nothing for it. This can't be undone.`)) return;
    try { await api.deleteDataSet(d.id); load(); } catch (e: any) { setError(e?.message || 'Could not delete it'); }
  };

  const view = async (id: string) => {
    try { setViewing(await api.getDataSet(id)); } catch (e: any) { setError(e?.message || 'Could not open it'); }
  };

  const setCol = (key: string, patch: Partial<Draft['columns'][number]>) =>
    setDraft((d) => (d ? { ...d, columns: d.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) } : d));

  /* ── Upload / edit form ── */
  if (draft) {
    const isEdit = !!draft.id;
    return (
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>{isEdit ? 'Edit data set' : 'New data set'}</h3>
            <p className={styles.cardDesc}>
              Pick the column that names each group, keep the number columns you want, and link a column to a Player Data
              metric to compare athletes with it.
            </p>
          </div>
          <button className={styles.btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
        </div>
        <div className={styles.builderForm}>
          <div className={styles.builderField}>
            <label>Name</label>
            <input className={styles.input} value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className={styles.builderField}>
            <label>Group column</label>
            <select className={styles.select} value={draft.labelKey} disabled={isEdit}
              onChange={(e) => {
                const col = draft.columns.find((c) => c.key === e.target.value);
                if (!col) return;
                setDraft({ ...draft, labelColumn: col.name, labelKey: col.key, columns: draft.columns.map((c) => (c.key === col.key ? { ...c, keep: false } : c)) });
              }}>
              {draft.columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </div>
          <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
            <label>Source (optional)</label>
            <input className={styles.input} value={draft.source} maxLength={500} placeholder="Where the numbers come from (a link or citation)" onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
          </div>
          <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
            <label>Description (optional)</label>
            <input className={styles.input} value={draft.description} maxLength={2000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={styles.dsTable}>
            <thead>
              <tr><th>Use</th><th>Column</th><th>Unit</th><th>Compare with Player Data</th><th>First rows</th></tr>
            </thead>
            <tbody>
              {draft.columns.filter((c) => c.key !== draft.labelKey && c.key !== '__label').map((c) => (
                <tr key={c.key} style={{ opacity: c.keep ? 1 : 0.55 }}>
                  <td><input type="checkbox" checked={c.keep} disabled={!c.numeric && !c.keep} onChange={(e) => setCol(c.key, { keep: e.target.checked })} aria-label={`Use ${c.name}`} /></td>
                  <td>
                    {c.keep
                      ? <input className={styles.input} value={c.name} maxLength={80} onChange={(e) => setCol(c.key, { name: e.target.value })} />
                      : c.name}
                    {!c.numeric && <div className={styles.cardDesc}>Not numbers</div>}
                  </td>
                  <td><input className={styles.input} style={{ width: 80 }} value={c.unit} maxLength={16} disabled={!c.keep} onChange={(e) => setCol(c.key, { unit: e.target.value })} /></td>
                  <td>
                    <select className={styles.select} value={c.link} disabled={!c.keep} onChange={(e) => setCol(c.key, { link: e.target.value })}>
                      <option value="">— not linked —</option>
                      {linkGroups.map(([g, list]) => (
                        <optgroup key={g} label={g}>
                          {list.map((x) => <option key={`${x.source}::${x.metricType}`} value={`${x.source}::${x.metricType}`}>{x.label ?? x.metricType}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className={styles.cardDesc}>{draft.table.slice(0, 3).map((r) => { const v = cellOf(r, c); return v == null ? '—' : String(v); }).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.cardDesc}>
          {draft.table.length} groups: {draft.table.slice(0, 8).map((r) => String(r[draft.labelKey] ?? '—')).join(', ')}{draft.table.length > 8 ? '…' : ''}
        </div>
        {error && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div>}
        <div className={styles.formActions}>
          <button className={styles.btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Save data set'}</button>
        </div>
      </div>
    );
  }

  /* ── One data set's table ── */
  if (viewing) {
    return (
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>{viewing.name}</h3>
            {viewing.description && <p className={styles.cardDesc}>{viewing.description}</p>}
            {viewing.source && <p className={styles.cardDesc}>Source: {viewing.source}</p>}
          </div>
          <button className={styles.btnSecondary} onClick={() => setViewing(null)}>← All data sets</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.dsTable}>
            <thead>
              <tr>
                <th>{viewing.labelColumn}</th>
                {viewing.columns.map((c) => (
                  <th key={c.key} style={{ textAlign: 'right' }} title={c.link ? `Compared with ${c.link.metricType}` : 'Not linked'}>
                    {c.name}{c.unit ? ` (${c.unit})` : ''}{c.link ? ' 🔗' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(viewing.rows ?? []).map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  {viewing.columns.map((c) => <td key={c.key} style={{ textAlign: 'right' }}>{r.values[c.key] ?? '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.cardDesc}>🔗 = linked to a Player Data metric (charts can put an athlete beside these groups).</div>
      </div>
    );
  }

  /* ── List ── */
  return (
    <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Data Sets</h3>
          <p className={styles.cardDesc}>
            Reference numbers to compare athletes with — MLB, college or age-group averages, published study results. Upload a CSV
            or Excel file (first row = column names); then pick it as a chart&rsquo;s Data Source or as a Benchmark Line in the Chart Builder.
          </p>
        </div>
        {!isViewer && (
          <label className={styles.btn} style={{ cursor: 'pointer' }}>
            Upload CSV / Excel
            <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
          </label>
        )}
      </div>
      {error && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div>}
      {!sets ? (
        <div className={styles.empty}>Loading…</div>
      ) : sets.length === 0 ? (
        <div className={styles.empty}>No data sets yet.</div>
      ) : (
        <div className={styles.savedList}>
          {sets.map((d) => (
            <div key={d.id} className={styles.savedItem}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={styles.savedTitle}>{d.name}</div>
                <div className={styles.savedMeta}>
                  {d.rowCount} groups · {d.columns.length} columns · {d.columns.filter((c) => c.link).length} linked
                  {d.source ? ` · ${d.source}` : ''}
                </div>
              </div>
              <div className={styles.savedActions}>
                <button className={styles.btnSecondary} onClick={() => view(d.id)}>View</button>
                {!isViewer && <button className={styles.btnSecondary} onClick={() => edit(d.id)}>Edit</button>}
                {!isViewer && <button className={styles.btnDanger} onClick={() => remove(d)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
