'use client';

/* The "+ Add Athlete" chooser.
 *
 * Two ways onto the roster:
 *   Email  -- mail a prospective athlete a link to the public Create an
 *             Account form and let them fill their own profile in.
 *   Manual -- the coach types the profile themselves (/players/new).
 *
 * Styled to match the app's other confirm dialogs (the "Still uploading"
 * panel in ReportModal), and portalled to <body> so it is never clipped by
 * the toolbar it is launched from.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';

type Mode = 'choose' | 'email';

export function AddAthleteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* Esc closes, like every other dialog in the app. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  const send = async () => {
    const v = email.trim();
    if (!v) { setError('Enter an email address'); return; }
    setSending(true);
    setError('');
    try {
      const res = await api.sendRegistrationInvite(v);
      /* A 2xx does NOT mean it was delivered -- the server no-ops when Resend
         is unconfigured -- so report what actually happened. */
      if (res.emailed) {
        setSentTo(res.to);
      } else {
        setError('This server has no mail provider configured, so nothing was sent.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not send that invite.');
    } finally {
      setSending(false);
    }
  };

  const panel: React.CSSProperties = {
    width: 'min(420px, 100%)', borderRadius: 12, padding: 20,
    background: 'var(--panel-bg-light, #14181f)',
    border: '1px solid var(--border)',
  };
  const primaryBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', border: '1px solid var(--text)',
    background: 'var(--text)', color: 'var(--bg, #0e1116)',
  };
  const ghostBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-secondary)',
  };
  const optionBtn: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '14px 16px', borderRadius: 10, marginBottom: 10,
    border: '1px solid var(--border)', background: 'transparent',
    cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.6)',
        display: 'grid', placeItems: 'center', padding: 18,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={panel}>
        {mode === 'choose' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Add Athlete
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              How do you want to add them?
            </p>

            <button type="button" style={optionBtn} onClick={() => setMode('email')}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>✉️ Email</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                Send them a link and let them fill in their own profile.
              </span>
            </button>

            <button
              type="button"
              style={optionBtn}
              onClick={() => { onClose(); router.push('/players/new'); }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>✍️ Manual</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                Type their profile in yourself.
              </span>
            </button>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'email' && !sentTo && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Email an athlete
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
              They&rsquo;ll get a link to create their account and complete their player profile.
            </p>

            <input
              type="email"
              value={email}
              autoFocus
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder="athlete@example.com"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface-bright)',
                border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 12px',
                color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit',
                marginBottom: error ? 8 : 16,
              }}
            />
            {error && (
              <p style={{ fontSize: 12, color: '#E5484D', margin: '0 0 14px', lineHeight: 1.5 }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={ghostBtn} onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button type="button" style={primaryBtn} onClick={() => void send()} disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}

        {sentTo && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Invite sent
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
              {sentTo} has been emailed a link to create their account. They&rsquo;ll appear
              here for approval once they finish signing up.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtn} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
