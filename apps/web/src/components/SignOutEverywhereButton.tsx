'use client';

/* "Sign out of all devices".

   Without `userId` it signs out the CURRENT account everywhere -- this
   device included -- then goes to the sign-in page. With `userId` (a coach
   in an athlete's Edit Profile) it signs that athlete out everywhere and
   stays put. Asks first, inline, so a stray tap can't do it. */

import type React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export function SignOutEverywhereButton({
  userId, subjectName, style,
}: {
  /** Sign out this account instead of the current one. */
  userId?: string | null;
  /** Shown in the confirm text, e.g. "John Smith". */
  subjectName?: string;
  style?: React.CSSProperties;
}) {
  const { logout } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const forOther = !!userId;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      if (forOther) {
        await api.logoutUserEverywhere(userId!);
        setDone(true);
        setConfirming(false);
        window.setTimeout(() => setDone(false), 3000);
      } else {
        await api.logoutEverywhere();
        logout();
        router.replace('/login');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not sign out');
    } finally {
      setBusy(false);
    }
  };

  const base: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid rgba(239,68,68,0.55)',
    background: 'transparent',
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    ...style,
  };

  if (done) {
    return <span style={{ ...base, border: '1px solid transparent', color: '#34D399', cursor: 'default' }}>Signed out everywhere</span>;
  }

  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {forOther
            ? `Sign ${subjectName || 'this athlete'} out on every device?`
            : 'Sign out on every device, including this one?'}
        </span>
        <button type="button" style={base} onClick={() => void run()} disabled={busy}>{busy ? '…' : 'Yes'}</button>
        <button
          type="button"
          style={{ ...base, border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          onClick={() => { setConfirming(false); setError(''); }}
          disabled={busy}
        >No</button>
        {error && <span role="alert" style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      style={base}
      onClick={() => setConfirming(true)}
      title={forOther ? 'End every session this athlete has open' : 'End every session on every device'}
    >
      Sign Out of All Devices
    </button>
  );
}
