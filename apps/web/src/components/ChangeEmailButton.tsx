'use client';

/* Changes a LOGIN email (the account's username). Lives in the Edit Profile
   form for both roles:

     coach  → changes the athlete's, via the admin endpoint. The backend
              scopes that to PLAYER targets, so a coach cannot rename another
              coach's login out from under the prod seed.

     player → changes their own, via the same self-service endpoint Settings →
              Account already uses.

   Both paths enforce a valid, unique address server-side. */

import { useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { rem } from '@/lib/rem';

export function ChangeEmailButton({ userId, currentEmail, block }: { userId: string; currentEmail?: string; block?: boolean }) {
  const { isCoach } = useAuth();
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
      if (isCoach) await api.setUserEmail(userId, v);
      else await api.updateAccount({ email: v });
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

  /* `block` fills the grid cell it sits in and matches the metrics of a
     .summaryInput bubble, so the trigger is the same size as the fields
     beside it. The expanded form is wider than one cell, so it spans the
     whole grid row while it is open. */
  const triggerStyle: React.CSSProperties = block && !open
    ? { ...btnStyle, width: '100%', padding: '9px 12px', borderRadius: 14, fontSize: rem(14), lineHeight: 'normal', border: '1px solid var(--border)' }
    : btnStyle;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      ...(block ? { width: '100%' } : null),
      ...(block && open ? { gridColumn: '1 / -1' } : null),
    }}>
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
        style={triggerStyle}
        onClick={() => { setOpen((o) => !o); setEmail(currentEmail || ''); setMsg(''); }}
        title={isCoach ? "Change this player's login email" : 'Change your login email'}
      >
        {open ? 'Cancel' : '✉️ Change Email'}
      </button>
    </span>
  );
}
