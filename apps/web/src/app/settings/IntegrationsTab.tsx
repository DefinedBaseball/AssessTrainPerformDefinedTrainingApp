'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Settings → Integrations (Admin) — outside companies sending data in.

   • API keys: one per company (MOVE now; Trackman, VALD, ... later), Test or
     Live. The key is shown ONCE when created -- copy it and send it to the
     developer privately. Revoke stops it instantly.
   • Recent deliveries: everything a partner has sent, stored untouched, with
     the raw data viewable. MOVE sessions are placed on the athlete's Catching
     report as they arrive; each row says where one went (or why it didn't):
     Unmatched rows get an athlete picker, and the link is remembered.
   • Linked athletes: the saved "MOVE account = this athlete" links.
   • Quick start: the base URL and example requests to hand the developer.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import styles from './page.module.css';

/** The permanent public address of the API (custom domain on Render). */
const API_BASE = (process.env.NEXT_PUBLIC_API_PUBLIC_URL || 'https://api.definedbaseball.com').replace(/\/+$/, '');

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const pill = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
  letterSpacing: '0.04em', background: bg, color: fg,
});
const MODE_PILL = { live: pill('rgba(22,163,74,0.18)', '#16a34a'), test: pill('rgba(234,179,8,0.2)', '#b45309') };
/** Processing outcome per delivery. */
const STATUS: Record<string, { label: string; style: React.CSSProperties }> = {
  processed:  { label: 'ON REPORT',     style: pill('rgba(22,163,74,0.18)', '#16a34a') },
  preview:    { label: 'TEST PREVIEW',  style: pill('rgba(59,130,246,0.18)', '#2563eb') },
  unmatched:  { label: 'UNMATCHED',     style: pill('rgba(234,179,8,0.22)', '#b45309') },
  superseded: { label: 'OLDER VERSION', style: pill('rgba(127,127,127,0.2)', 'var(--text-muted)') },
  error:      { label: 'ERROR',         style: pill('rgba(239,68,68,0.18)', '#dc2626') },
  received:   { label: 'NOT PROCESSED', style: pill('rgba(127,127,127,0.2)', 'var(--text-muted)') },
};
const MATCHED_BY: Record<string, string> = { link: 'saved link', email: 'email', athleteId: 'Athlete ID' };

/** "Nov 13" from "2026-11-13" (a calendar date, no time zone shift). */
function day(date?: string): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One line saying where a delivery went, or why it didn't. */
function outcomeText(d: api.IntegrationDeliveryRow): string {
  const r = d.result;
  if (!r) return d.status === 'received' ? 'Not processed yet' : '';
  if (d.status === 'error') return r.error || 'Could not read this delivery';
  const catches = r.catches != null ? `${r.counted ?? r.catches} of ${r.catches} catches` : '';
  if (d.status === 'unmatched') {
    return `No athlete found for "${r.externalId || r.moveId || '?'}" -- pick one below (or set it as an Athlete ID / email)`;
  }
  const where = `${r.athlete ?? 'Athlete'} · ${day(r.date)}${catches ? ` · ${catches}` : ''}${r.matchedBy ? ` · matched by ${MATCHED_BY[r.matchedBy] ?? r.matchedBy}` : ''}`;
  if (d.status === 'preview') {
    return `${where} -- test key: nothing saved (would ${r.wouldCreateReport ? 'create a new' : 'add to the existing'} Catching report)`;
  }
  if (d.status === 'superseded') return `${where} -- ${r.note || 'a newer version is already on the report'}`;
  return `${where}${r.createdReport ? ' · new Catching report' : ' · added to Catching report'}`;
}
const codeBox: React.CSSProperties = {
  fontFamily: "ui-monospace, 'DM Mono', monospace", fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  background: 'var(--surface2, rgba(127,127,127,0.1))', border: '1px solid var(--border)', borderRadius: 8,
  padding: '10px 12px', margin: 0, color: 'var(--text)',
};

export function IntegrationsTab() {
  const [providers, setProviders] = useState<api.IntegrationProvider[]>([]);
  const [keys, setKeys] = useState<api.IntegrationKeyRow[] | null>(null);
  const [deliveries, setDeliveries] = useState<api.IntegrationDeliveryRow[] | null>(null);
  const [error, setError] = useState('');

  const [provider, setProvider] = useState('move');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; label: string; mode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openPayload, setOpenPayload] = useState<string>('');

  const [links, setLinks] = useState<api.IntegrationAthleteLinkRow[]>([]);
  const [athletes, setAthletes] = useState<api.Player[]>([]);
  /** Athlete picked in an Unmatched row's picker, by delivery id. */
  const [linkPick, setLinkPick] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    Promise.all([api.getIntegrationProviders(), api.getIntegrationKeys(), api.getIntegrationDeliveries(), api.getIntegrationLinks()])
      .then(([p, k, d, l]) => { setProviders(p); setKeys(k); setDeliveries(d); setLinks(l); })
      .catch((e) => { setError(e?.message || 'Could not load integrations'); setKeys([]); setDeliveries([]); });
  }, []);
  useEffect(() => { load(); }, [load]);
  /* The athlete list is only needed for the Unmatched picker. */
  const needsAthletes = !!deliveries?.some((d) => d.status === 'unmatched');
  useEffect(() => {
    if (!needsAthletes || athletes.length) return;
    api.getPlayers()
      .then((ps) => setAthletes([...ps].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))))
      .catch(() => { /* picker stays empty; the error shows on Link */ });
  }, [needsAthletes, athletes.length]);

  const runOn = async (id: string, fn: () => Promise<unknown>, failMsg: string) => {
    setBusyId(id);
    setError('');
    try { await fn(); load(); } catch (e: any) { setError(e?.message || failMsg); } finally { setBusyId(null); }
  };
  const processAgain = (d: api.IntegrationDeliveryRow) =>
    runOn(d.id, () => api.processIntegrationDelivery(d.id), 'Could not process that delivery');
  const linkAthlete = (d: api.IntegrationDeliveryRow) => {
    const playerId = linkPick[d.id];
    if (!playerId) { setError('Pick an athlete first'); return; }
    return runOn(d.id, () => api.linkIntegrationDelivery(d.id, playerId), 'Could not link that athlete');
  };
  const unlink = async (l: api.IntegrationAthleteLinkRow) => {
    if (!window.confirm(`Remove the link "${l.externalRef}" -> ${l.athlete}? Sessions already on reports stay; new ones from that account will show as Unmatched.`)) return;
    await runOn(l.id, () => api.removeIntegrationLink(l.id), 'Could not remove the link');
  };

  const providerName = (slug: string) => providers.find((p) => p.slug === slug)?.label ?? slug;

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const r = await api.createIntegrationKey({ provider, label: label.trim(), mode });
      setNewKey({ key: r.key, label: r.label, mode: r.mode });
      setCopied(false);
      setLabel('');
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not create the key');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (k: api.IntegrationKeyRow) => {
    if (!window.confirm(`Revoke "${k.label}"? Anything using it stops working immediately. This can't be undone.`)) return;
    try { await api.revokeIntegrationKey(k.id); load(); } catch (e: any) { setError(e?.message || 'Could not revoke'); }
  };

  const toggleDelivery = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setOpenPayload('Loading…');
    try {
      const d = await api.getIntegrationDelivery(id);
      setOpenPayload(typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload, null, 2));
    } catch (e: any) {
      setOpenPayload(e?.message || 'Could not load that delivery');
    }
  };

  const clearTest = async () => {
    if (!window.confirm('Delete all TEST deliveries? Live deliveries are kept.')) return;
    try { await api.clearTestIntegrationDeliveries(); load(); } catch (e: any) { setError(e?.message || 'Could not clear'); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className={styles.section}>
      {/* ── Quick start ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Integrations</h3>
        <p className={styles.cardDesc}>
          Outside companies send data to one address, each on its own path, with their own API key. A key only works
          for its own company, can be revoked any time, and can&rsquo;t read anything in the app.
        </p>
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          <div><strong>API base URL:</strong> <code>{API_BASE}</code></div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Send the key in a header: <code>Authorization: Bearer &lt;key&gt;</code>
          </div>
          <pre style={codeBox}>{`# Check the key works
curl ${API_BASE}/api/integrations/ping \\
  -H "Authorization: Bearer <key>"

# MOVE: send one session (JSON body; include your own sessionId so resends are ignored)
curl -X POST ${API_BASE}/api/integrations/move/sessions \\
  -H "Authorization: Bearer <key>" \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId":"abc-123", ...}'`}</pre>
        </div>
      </div>

      {/* ── Keys ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>API Keys</h3>
        <p className={styles.cardDesc}>
          Start a developer on a <strong>Test</strong> key (its deliveries are marked test and can be cleared), then give
          them a <strong>Live</strong> key once it works. The key is shown once — copy it and send it privately.
        </p>

        {newKey && (
          <div style={{ border: '2px solid #16a34a', borderRadius: 10, padding: 12, marginBottom: 14, display: 'grid', gap: 8 }}>
            <strong>New key for {newKey.label} — copy it now, it won&rsquo;t be shown again.</strong>
            <pre style={codeBox}>{newKey.key}</pre>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={styles.btn} onClick={() => copy(newKey.key)}>{copied ? 'Copied ✓' : 'Copy key'}</button>
              <button type="button" className={styles.btnSecondary} onClick={() => setNewKey(null)}>I&rsquo;ve saved it</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Company
            <select className={styles.input} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, flex: '1 1 200px' }}>
            Name (optional)
            <input className={styles.input} value={label} maxLength={80} placeholder="e.g. MOVE developer — test"
              onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700 }}>
            Type
            <select className={styles.input} value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
          <button type="button" className={styles.btn} onClick={create} disabled={creating || !providers.length}>
            {creating ? 'Creating…' : '+ New key'}
          </button>
        </div>

        {error && <div style={{ color: '#e5484d', fontSize: 13, marginBottom: 10 }}>{error}</div>}

        {keys === null ? <div className={styles.cardDesc}>Loading…</div>
          : keys.length === 0 ? <div className={styles.cardDesc}>No keys yet.</div>
            : (
              <div style={{ display: 'grid', gap: 8 }}>
                {keys.map((k) => (
                  <div key={k.id} style={{
                    display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px',
                    opacity: k.revokedAt ? 0.55 : 1,
                  }}>
                    <div style={{ display: 'grid', gap: 2, flex: '1 1 220px', minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>{k.label}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {providerName(k.provider)} · <code>{k.keyPrefix}…</code> · created {when(k.createdAt)} · last used {when(k.lastUsedAt)} · {k.deliveries} deliver{k.deliveries === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                    <span style={MODE_PILL[k.mode]}>{k.mode.toUpperCase()}</span>
                    {k.revokedAt
                      ? <span style={pill('rgba(229,72,77,0.15)', '#e5484d')}>REVOKED</span>
                      : <button type="button" className={styles.btnSecondary} onClick={() => revoke(k)}>Revoke</button>}
                  </div>
                ))}
              </div>
            )}
      </div>

      {/* ── Deliveries ── */}
      <div className={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>Recent Deliveries</h3>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={styles.btnSecondary} onClick={load}>Refresh</button>
            <button type="button" className={styles.btnSecondary} onClick={clearTest}>Clear test data</button>
          </span>
        </div>
        <p className={styles.cardDesc}>
          Everything sent in, stored exactly as received. MOVE sessions go onto the athlete&rsquo;s Catching report for that
          day (a new report if there isn&rsquo;t one), matched by the athlete&rsquo;s email or Athlete ID. Test keys only
          preview where a session would go.
        </p>
        {deliveries === null ? <div className={styles.cardDesc}>Loading…</div>
          : deliveries.length === 0 ? <div className={styles.cardDesc}>Nothing received yet.</div>
            : (
              <div style={{ display: 'grid', gap: 6 }}>
                {deliveries.map((d) => (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <button type="button" onClick={() => toggleDelivery(d.id)} style={{
                      width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '8px 12px', color: 'var(--text)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    }}>
                      <span style={{ fontWeight: 700 }}>{providerName(d.provider)} · {d.kind}</span>
                      <span style={MODE_PILL[d.mode]}>{d.mode.toUpperCase()}</span>
                      {STATUS[d.status] && <span style={STATUS[d.status].style}>{STATUS[d.status].label}</span>}
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {when(d.createdAt)} · {d.keyLabel ?? 'deleted key'}{d.externalId ? ` · id ${d.externalId}` : ''} · {(d.bytes / 1024).toFixed(1)} KB
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{openId === d.id ? 'Hide ▲' : 'View ▼'}</span>
                    </button>
                    {/* Where it went + what can be done about it. */}
                    {(outcomeText(d) || d.status !== 'processed') && (
                      <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                        <span style={{ color: d.status === 'error' ? '#dc2626' : 'var(--text)', flex: '1 1 260px' }}>{outcomeText(d)}</span>
                        {d.status === 'processed' && d.playerId && (
                          <Link href={`/athletes/${d.playerId}?tab=catching`} className={styles.btnSecondary}>Open report</Link>
                        )}
                        {d.status === 'unmatched' && (
                          <>
                            <select
                              aria-label="Athlete for this MOVE account"
                              value={linkPick[d.id] ?? ''}
                              onChange={(e) => setLinkPick((m) => ({ ...m, [d.id]: e.target.value }))}
                              className={styles.input}
                              style={{ maxWidth: 220 }}
                            >
                              <option value="">Pick athlete…</option>
                              {athletes.map((a) => <option key={a.id} value={a.id}>{a.lastName}, {a.firstName}</option>)}
                            </select>
                            <button type="button" className={styles.btn} disabled={busyId === d.id || !linkPick[d.id]} onClick={() => linkAthlete(d)}>
                              {busyId === d.id ? 'Linking…' : 'Link'}
                            </button>
                          </>
                        )}
                        {d.provider === 'move' && d.kind === 'sessions' && d.status !== 'unmatched' && (
                          <button type="button" className={styles.btnSecondary} disabled={busyId === d.id} onClick={() => processAgain(d)}>
                            {busyId === d.id ? 'Working…' : d.status === 'received' ? 'Process' : 'Process again'}
                          </button>
                        )}
                      </div>
                    )}
                    {openId === d.id && <pre style={{ ...codeBox, borderRadius: 0, borderWidth: '1px 0 0', maxHeight: 360, overflow: 'auto' }}>{openPayload}</pre>}
                  </div>
                ))}
              </div>
            )}
      </div>

      {/* ── Linked athletes ── */}
      {links.length > 0 && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Linked Athletes</h3>
          <p className={styles.cardDesc}>
            Outside accounts a coach matched to an athlete. Sessions from them go straight to that athlete.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {links.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ fontWeight: 700 }}>{l.athlete}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{providerName(l.provider)} · {l.externalRef}</span>
                <button type="button" className={styles.btnSecondary} style={{ marginLeft: 'auto' }} disabled={busyId === l.id} onClick={() => unlink(l)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
