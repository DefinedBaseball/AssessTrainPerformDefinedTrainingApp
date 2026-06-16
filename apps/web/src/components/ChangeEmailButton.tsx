'use client';

/* Coach-only control to change a player account's LOGIN email (their username),
   shown on the athlete profile next to Reset Password. The backend scopes this
   to PLAYER targets and enforces a valid, unique email. */

import { useState } from 'react';
import * as api from '@/lib/api';
import { rem } from '@/lib/rem';

export function ChangeEmailButton({ userId, currentEmail }: { userId: string; currentEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(currentEmail || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setMsg('Enter a valid email'); return; }
    setSaving(true);
    setMsg('');
    try {
      await api.setUserEmail(userId, v);
      setMsg('Email updated.');
      setTimeout(() => { setOpen(false); setMsg(''); }, 1500);
    } catch (e: any) {
      setMsg(e?.message || 'Could not update email');
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
    width: 220,
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
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="new@email.com"
            autoComplete="off"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
          <button type="button" style={{ ...btnStyle, background: '#3d8bfd', border: 'none', color: '#fff' }} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && (
            <span style={{ fontSize: rem(11.5), color: msg === 'Email updated.' ? '#34D399' : '#E5484D' }}>
              {msg}
            </span>
          )}
        </>
      )}
      <button
        type="button"
        style={btnStyle}
        onClick={() => { setOpen((o) => !o); setEmail(currentEmail || ''); setMsg(''); }}
        title="Change this player's login email"
      >
        {open ? 'Cancel' : '✉️ Change Email'}
      </button>
    </span>
  );
}
