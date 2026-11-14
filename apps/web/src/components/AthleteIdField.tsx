'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Athlete ID -- a coach-set secondary ID on the athlete (Edit Profile).
   Outside apps (MOVE Catching Sensor, ...) can identify the athlete by it
   instead of their email. Saves on its own button, separately from the
   profile form: the server upper-cases it, refuses one another athlete
   already has, and then retries any MOVE sessions that were waiting for a
   match.
   ───────────────────────────────────────────────────────────────────────── */
import { useState } from 'react';
import * as api from '@/lib/api';
import rs from '@/components/assessment/report-form.module.css';

export function AthleteIdField({ playerId, initial }: { playerId: string; initial: string | null | undefined }) {
  const [saved, setSaved] = useState(initial ?? '');
  const [value, setValue] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = value.trim().toUpperCase() !== saved;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.setAthleteCode(playerId, value);
      const code = r.athleteCode ?? '';
      setSaved(code);
      setValue(code);
      setMsg({
        ok: true,
        text: !code ? 'Athlete ID cleared'
          : r.placed ? `Saved -- ${r.placed} waiting MOVE session${r.placed === 1 ? '' : 's'} placed`
            : 'Saved',
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not save the Athlete ID' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={rs.summaryField}>
      <label className={rs.summaryLabel} htmlFor={`athlete-id-${playerId}`}>Athlete ID</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          id={`athlete-id-${playerId}`}
          className={rs.summaryInput}
          value={value}
          onChange={(e) => { setValue(e.target.value); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty && !busy) { e.preventDefault(); void save(); } }}
          placeholder="e.g. DB-1042 (for MOVE and other apps)"
          maxLength={80}
          autoComplete="off"
          style={{ flex: 1, textTransform: 'uppercase' }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className={rs.summaryInput}
          style={{ flex: '0 0 auto', width: 'auto', padding: '0 14px', fontWeight: 700, cursor: dirty && !busy ? 'pointer' : 'default', opacity: dirty ? 1 : 0.55 }}
        >
          {busy ? 'Saving…' : 'Save ID'}
        </button>
      </div>
      {msg && (
        <div role="status" style={{ fontSize: 12, marginTop: 4, color: msg.ok ? '#16a34a' : '#dc2626' }}>{msg.text}</div>
      )}
    </div>
  );
}
