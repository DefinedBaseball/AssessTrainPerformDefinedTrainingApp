'use client';

/* Small coach-only control that sets a new login password for another
   account (used on the athlete profile next to the back-link; Settings →
   Staff has its own inline variant for coach accounts). The backend
   enforces that the primary admin's password is self-only. */

import { useState } from 'react';
import * as api from '@/lib/api';
import { rem } from '@/lib/rem';

export function ResetPasswordButton({ userId, label }: { userId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (pw.length < 6) { setMsg('At least 6 characters'); return; }
    setSaving(true);
    setMsg('');
    try {
      await api.setUserPassword(userId, pw);
      setMsg('Password updated.');
      setPw('');
      setTimeout(() => { setOpen(false); setMsg(''); }, 1500);
    } catch (e: any) {
      setMsg(e?.message || 'Could not update password');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-bright)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    padding: '6px 10px',
    color: 'var(--text)',
    fontSize: rem(12.5),
    fontFamily: 'inherit',
    width: 190,
  };
  const btnStyle: React.CSSProperties = {
    border: '1px solid var(--border-light)',
    background: 'var(--card-elev)',
    color: 'var(--text-secondary)',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: rem(11.5),
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {open && (
        <>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password (min 6)"
            autoComplete="new-password"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
          <button type="button" style={{ ...btnStyle, background: '#3d8bfd', border: 'none', color: '#fff' }} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && (
            <span style={{ fontSize: rem(11.5), color: msg === 'Password updated.' ? '#34D399' : '#E5484D' }}>
              {msg}
            </span>
          )}
        </>
      )}
      <button
        type="button"
        style={btnStyle}
        onClick={() => { setOpen((o) => !o); setPw(''); setMsg(''); }}
        title="Set a new login password for this account"
      >
        {open ? 'Cancel' : (label || '🔑 Reset Password')}
      </button>
    </span>
  );
}
