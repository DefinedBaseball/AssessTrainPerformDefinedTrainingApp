'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Settings → Integrations (Admin) — outside companies sending data in.

   • API keys: one per company (MOVE now; Trackman, VALD, ... later), Test or
     Live. The key is shown ONCE when created -- copy it and send it to the
     developer privately. Revoke stops it instantly.
   • Recent deliveries: everything a partner has sent, stored untouched, with
     the raw data viewable -- so a partner can start sending before the
     format is final and we build the mapping from what really arrives.
   • Quick start: the base URL and example requests to hand the developer.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(() => {
    setError('');
    Promise.all([api.getIntegrationProviders(), api.getIntegrationKeys(), api.getIntegrationDeliveries()])
      .then(([p, k, d]) => { setProviders(p); setKeys(k); setDeliveries(d); })
      .catch((e) => { setError(e?.message || 'Could not load integrations'); setKeys([]); setDeliveries([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

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
          Everything sent in, stored exactly as received. Matching it to athletes and reports comes next, once we know
          each company&rsquo;s data format.
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
                      {d.status === 'duplicate' && <span style={pill('rgba(127,127,127,0.2)', 'var(--text-muted)')}>DUPLICATE</span>}
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {when(d.createdAt)} · {d.keyLabel ?? 'deleted key'}{d.externalId ? ` · id ${d.externalId}` : ''} · {(d.bytes / 1024).toFixed(1)} KB
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{openId === d.id ? 'Hide ▲' : 'View ▼'}</span>
                    </button>
                    {openId === d.id && <pre style={{ ...codeBox, borderRadius: 0, borderWidth: '1px 0 0', maxHeight: 360, overflow: 'auto' }}>{openPayload}</pre>}
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  );
}
