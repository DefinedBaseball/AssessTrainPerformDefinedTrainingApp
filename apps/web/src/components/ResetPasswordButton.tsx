'use client';

/* Sets a login password. Lives in the Edit Profile form for both roles,
   and behaves differently depending on who is looking:

     coach  → sets ANOTHER account's password outright (the athlete has
              usually forgotten theirs, so there is nothing to confirm
              against). The backend still refuses coach targets for
              non-admins and makes the primary admin self-only.

     player → changing their OWN password, so the current one is required.
              Without that, anyone who found an athlete's session open on a
              shared facility iPad could lock them out of their account.

   Settings → Staff has its own inline variant for coach accounts. */

import { useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { rem } from '@/lib/rem';

export function ResetPasswordButton({ userId, label, block }: { userId: string; label?: string; block?: boolean }) {
  const { isCoach } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (pw.length < 8) { setMsg('At least 8 characters'); return; }
    if (!isCoach && !currentPw) { setMsg('Enter your current password'); return; }
    setSaving(true);
    setMsg('');
    try {
      if (isCoach) await api.setUserPassword(userId, pw);
      else await api.changePassword(currentPw, pw);
      setMsg('Password updated.');
      setPw('');
      setCurrentPw('');
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
          {/* Players confirm the password they already have; coaches are
              resetting someone else's and have nothing to confirm against. */}
          {!isCoach && (
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            />
          )}
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
        style={triggerStyle}
        onClick={() => { setOpen((o) => !o); setPw(''); setCurrentPw(''); setMsg(''); }}
        title={isCoach ? 'Set a new login password for this account' : 'Change your login password'}
      >
        {open ? 'Cancel' : (label || (isCoach ? '🔑 Reset Password' : '🔑 Change Password'))}
      </button>
    </span>
  );
}
