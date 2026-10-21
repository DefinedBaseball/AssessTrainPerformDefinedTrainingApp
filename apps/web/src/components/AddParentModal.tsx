'use client';

/* The "+ Add Parent" chooser (Athlete Hub), the parent twin of Add Athlete.
 *
 *   Email  -- mail the parent a sign-up link. When they sign up through it
 *             with that email, the athletes picked here are linked straight
 *             away (the coach has vouched for them). If that email already
 *             has a parent login, the athletes are just linked to it.
 *   Manual -- the coach types the parent's details, sets a password and
 *             picks the athletes; the parent login exists immediately.
 *
 * Styled like AddAthleteModal and portalled to <body>.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';

type Mode = 'choose' | 'email' | 'manual';

export interface AddParentAthlete {
  id: string;
  firstName: string;
  lastName: string;
  gradYear?: number | null;
}

export function AddParentModal({ athletes, onClose, onDone }: {
  /** The roster to pick from (the Hub's list). */
  athletes: AddParentAthlete[];
  onClose: () => void;
  /** After a parent is created or linked. */
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('choose');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Shared fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  // Manual only
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [hometown, setHometown] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...athletes].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    return q ? list.filter((a) => `${a.firstName} ${a.lastName}`.toLowerCase().includes(q)) : list;
  }, [athletes, query]);

  const nameOf = (id: string) => {
    const a = athletes.find((x) => x.id === id);
    return a ? `${a.firstName} ${a.lastName}` : '';
  };
  const pickedNames = () => [...picked].map(nameOf).filter(Boolean).join(', ');

  if (!mounted) return null;

  const sendInvite = async () => {
    const v = email.trim();
    if (!v) { setError('Enter the parent’s email'); return; }
    setBusy(true);
    setError('');
    try {
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
      const res = await api.inviteParent({ email: v, name: name || undefined, playerIds: [...picked] });
      onDone?.();
      if (res.alreadyParent) {
        setResult(res.linked
          ? `${res.to} already has a parent login, so nothing was emailed — ${pickedNames()} ${res.linked === 1 ? 'is' : 'are'} now linked to it.`
          : `${res.to} already has a parent login, so nothing was emailed.`);
      } else if (res.emailed) {
        setResult(`${res.to} has been emailed a link to create their parent account (it works for 7 days).${picked.size ? ` When they sign up, ${pickedNames()} will be linked automatically.` : ''}`);
      } else {
        setError('This server has no mail provider configured, so nothing was sent.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not send that invite.');
    } finally {
      setBusy(false);
    }
  };

  const createManual = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError('First and last name are required'); return; }
    if (!email.trim()) { setError('Enter the parent’s email'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.createParentManual({
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
        phone: phone.trim() || undefined, birthDate: birthDate || undefined,
        hometown: hometown.trim() || undefined, password, playerIds: [...picked],
      });
      onDone?.();
      setResult(`${firstName.trim()} ${lastName.trim()} can now sign in with ${email.trim()} and the password you set.${res.linked ? ` Linked to ${pickedNames()}.` : ''}`);
    } catch (err: any) {
      setError(err?.message || 'Could not create that parent.');
    } finally {
      setBusy(false);
    }
  };

  /* ── Styles (match AddAthleteModal) ── */
  const panel: React.CSSProperties = {
    width: mode === 'manual' ? 'min(520px, 100%)' : 'min(440px, 100%)', borderRadius: 12, padding: 20,
    background: 'var(--panel-bg-light, #14181f)', border: '1px solid var(--border)',
    maxHeight: 'calc(100dvh - 36px)', overflowY: 'auto',
  };
  const title: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 };
  const sub: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 };
  const primaryBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: '1px solid var(--text)', background: 'var(--text)', color: 'var(--bg, #0e1116)',
  };
  const ghostBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  };
  const optionBtn: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', borderRadius: 10, marginBottom: 10,
    border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
  };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'var(--surface-bright)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 12px', color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit',
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 5px' };
  const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 };

  const athletePicker = (
    <div style={{ marginBottom: 14 }}>
      <span style={label}>Link to athletes {picked.size > 0 && `(${picked.size})`}</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search athletes…"
        style={{ ...input, marginBottom: 8 }}
        aria-label="Search athletes"
      />
      <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
        {shown.length === 0 ? (
          <div style={{ padding: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>No athletes match.</div>
        ) : shown.map((a) => (
          <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={picked.has(a.id)}
              onChange={() => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                return next;
              })}
              style={{ width: 16, height: 16, flex: 'none' }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>{a.firstName} {a.lastName}</span>
            {a.gradYear ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{api.formatGradYear(a.gradYear)}</span> : null}
          </label>
        ))}
      </div>
      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
        Optional — they can also use Link Athlete from their profile later.
      </span>
    </div>
  );

  const errorLine = error && (
    <p style={{ fontSize: 12, color: '#E5484D', margin: '0 0 14px', lineHeight: 1.5 }}>{error}</p>
  );

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', padding: 18 }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={panel} role="dialog" aria-modal="true" aria-label="Add Parent">
        {result ? (
          <>
            <div style={{ ...title, marginBottom: 8 }}>{mode === 'manual' ? 'Parent added' : 'Done'}</div>
            <p style={{ ...sub, color: 'var(--text-secondary)', margin: '0 0 16px' }}>{result}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtn} onClick={onClose}>Done</button>
            </div>
          </>
        ) : mode === 'choose' ? (
          <>
            <div style={title}>Add Parent</div>
            <p style={sub}>How do you want to add them?</p>
            <button type="button" style={optionBtn} onClick={() => setMode('email')}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>✉️ Email</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                Send them a link to create their own parent account.
              </span>
            </button>
            <button type="button" style={optionBtn} onClick={() => setMode('manual')}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>✍️ Manual</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                Fill in their details and set a password yourself.
              </span>
            </button>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : mode === 'email' ? (
          <>
            <div style={title}>Email a parent</div>
            <p style={sub}>They&rsquo;ll get a link to create their parent account. Athletes you pick are linked when they sign up with this email.</p>
            <div style={grid2}>
              <input style={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name (optional)" autoFocus aria-label="First name" />
              <input style={input} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name (optional)" aria-label="Last name" />
            </div>
            <input
              type="email"
              style={{ ...input, marginBottom: 14 }}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="parent@example.com"
              aria-label="Email"
            />
            {athletePicker}
            {errorLine}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={ghostBtn} onClick={() => { setMode('choose'); setError(''); }} disabled={busy}>Back</button>
              <button type="button" style={primaryBtn} onClick={() => void sendInvite()} disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={title}>Add a parent</div>
            <p style={sub}>Their parent login works as soon as you create it.</p>
            <div style={grid2}>
              <div><span style={label}>First name *</span><input style={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus /></div>
              <div><span style={label}>Last name *</span><input style={input} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
              <div><span style={label}>Email *</span><input type="email" style={input} value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="parent@example.com" autoComplete="off" /></div>
              <div><span style={label}>Phone</span><input type="tel" style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(407) 555-0100" /></div>
              <div><span style={label}>Birthday</span><input type="date" style={input} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></div>
              <div><span style={label}>Hometown</span><input style={input} value={hometown} onChange={(e) => setHometown(e.target.value)} /></div>
              <div><span style={label}>Password *</span><input type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></div>
            </div>
            {athletePicker}
            {errorLine}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={ghostBtn} onClick={() => { setMode('choose'); setError(''); }} disabled={busy}>Back</button>
              <button type="button" style={primaryBtn} onClick={() => void createManual()} disabled={busy}>
                {busy ? 'Creating…' : 'Create Parent'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
