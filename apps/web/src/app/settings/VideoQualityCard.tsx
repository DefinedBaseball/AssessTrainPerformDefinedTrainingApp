'use client';

/* Settings -> Integrations -> Video Quality (Admin).

   Bunny makes a 1080p copy of every clip whose original is 1080p or more;
   the API moves each clip onto it once Bunny has finished encoding (a pass
   every few minutes). This card shows where clips stand and -- from Bunny's
   own record -- the size and frame rate each recent original arrived at, so
   it's easy to tell whether phones are uploading full-quality files.
   "Check now" runs a pass instead of waiting. */
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import styles from './page.module.css';

const OUTCOME_LABEL: Record<string, string> = {
  '1080p': 'Now plays 1080p',
  'kept 720p': 'No 1080p copy -- stays 720p',
  lower: 'Small original -- plays its 360p / 240p copy',
  pending: 'Bunny still encoding',
  failed: 'Bunny encode failed',
  'not found': 'Not found on Bunny',
};

export function VideoQualityCard() {
  const [data, setData] = useState<api.VideoRenditionStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    api.getVideoRenditionStatus().then(setData).catch((e) => setError(e?.message || 'Could not load video quality'));
  }, []);

  const checkNow = async () => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const r = await api.runVideoRenditionCheck();
      setData(r);
      setNote(r.checked ? `Checked ${r.checked} clip${r.checked === 1 ? '' : 's'}; ${r.upgraded} moved to 1080p.` : 'Nothing waiting to check.');
    } catch (e: any) {
      setError(e?.message || 'Check failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 className={styles.cardTitle} style={{ margin: 0 }}>Video Quality</h3>
        {data?.configured && (
          <button type="button" className={styles.btnSecondary} onClick={checkNow} disabled={busy}>
            {busy ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>
      <p className={styles.cardDesc}>
        Clips play the best copy Bunny made: 1080p when the original was at least 1080p, otherwise 720p, or a smaller
        copy when the original itself was small (Bunny never makes copies bigger than what was uploaded). New uploads
        settle a few minutes after Bunny finishes encoding. Bunny&rsquo;s copies top out at 60 fps. &ldquo;Original&rdquo;
        below is what Bunny received from the phone.
      </p>
      {error && <div style={{ fontSize: 13, color: '#dc2626' }}>{error}</div>}
      {!data && !error && <div className={styles.cardDesc}>Loading…</div>}
      {data && !data.configured && <div className={styles.cardDesc}>Bunny Stream isn&rsquo;t connected on this server.</div>}
      {data?.configured && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
            <span><strong>{data.on1080p}</strong> clips in 1080p</span>
            <span><strong>{data.on720p}</strong> in 720p (no 1080p copy)</span>
            {data.onLower > 0 && (
              <span title="The original was smaller than 720p, so Bunny only made smaller copies">
                <strong>{data.onLower}</strong> below 720p (small original)
              </span>
            )}
            <span><strong>{data.waiting}</strong> waiting to be checked</span>
          </div>
          {note && <div style={{ fontSize: 13, color: '#16a34a' }}>{note}</div>}
          {data.recent.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>Checked</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Original (size @ frame rate)</th>
                    <th style={{ padding: '4px 0 4px 8px', fontWeight: 600 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={`${r.videoId}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.source}</td>
                      <td style={{ padding: '4px 0 4px 8px' }}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.recent.length === 0 && (
            <div className={styles.cardDesc} style={{ margin: 0 }}>No checks since the server last started -- &ldquo;Check now&rdquo; runs one.</div>
          )}
        </div>
      )}
    </div>
  );
}
