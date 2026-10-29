'use client';

/* Emails one athlete a reminder to finish filling in their profile -- to the
 * player's email, the parent's email or both, ticked in the dialog.
 *
 * Shared by the Edit Profile form and the Client Directory so the confirm
 * wording, the "no email on file" rule and the result handling exist once --
 * two copies would drift the moment either surface changed.
 *
 * Coach-only: the send endpoint is @Roles('COACH'), and the component renders
 * nothing for anyone else rather than offering a button that would 401.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { rem } from '@/lib/rem';

type Variant = 'icon' | 'block';

export function ProfileReminderButton({
  playerId,
  playerName,
  email,
  parentEmail,
  variant = 'icon',
}: {
  playerId: string;
  playerName: string;
  /** The athlete's login email. With no parent email either there is
   *  nowhere to send, so the button is disabled with a reason rather than
   *  failing after the confirm. */
  email?: string | null;
  /** The parent email on the profile -- the second address offered. */
  parentEmail?: string | null;
  variant?: Variant;
}) {
  const { isCoach } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [picks, setPicks] = useState<{ player: boolean; guardian: boolean }>({ player: false, guardian: false });
  /* The dialog is portalled to <body>, which only exists client-side. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isCoach) return null;

  const playerAddr = email?.trim() || '';
  const parentAddr = parentEmail?.trim() || '';
  const hasEmail = !!playerAddr || !!parentAddr;
  const chosen = (['player', 'guardian'] as const).filter((r) => picks[r]);

  const send = async () => {
    if (chosen.length === 0) return;
    setConfirming(false);
    setSending(true);
    try {
      const res = await api.sendProfileReminder(playerId, chosen);
      /* The request can succeed while nothing was actually sent -- the server
         no-ops when Resend isn't configured. Saying "Sent" on that would be a
         lie the coach only discovers when the athlete never replies. */
      const failed = res.results.filter((r) => !r.sent);
      if (failed.length === 0) {
        setSent(true);
        setTimeout(() => setSent(false), 2500);
      } else {
        window.alert(
          `The reminder was not emailed to ${failed.map((r) => r.email).join(' or ')}. `
          + (res.emailed ? 'The other address was sent.' : 'This server has no mail provider configured.'),
        );
      }
    } catch (err: any) {
      window.alert(err?.message || `Could not send the reminder to ${playerName}.`);
    } finally {
      setSending(false);
    }
  };

  const title = hasEmail
    ? `Email ${playerName} a reminder to complete their profile`
    : `${playerName} has no player or parent email on file`;

  /* One checkbox per address; one with nothing on file is shown greyed so
     the coach can see why it can't be picked. */
  const option = (key: 'player' | 'guardian', label: string, addr: string) => (
    <label
      key={key}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 11px',
        border: '1px solid var(--border)', borderRadius: 9, textAlign: 'left',
        cursor: addr ? 'pointer' : 'not-allowed', opacity: addr ? 1 : 0.45,
      }}
    >
      <input
        type="checkbox"
        checked={picks[key]}
        disabled={!addr}
        onChange={(e) => setPicks((p) => ({ ...p, [key]: e.target.checked }))}
        style={{ marginTop: 2, cursor: 'inherit' }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {addr || 'None on file'}
        </span>
      </span>
    </label>
  );

  /* The app's own dialog, not window.confirm: a native confirm's buttons are
     browser-supplied and always read "OK"/"Cancel" -- the labels cannot be
     changed. Matches the "Still uploading" dialog in ReportModal.
     Portalled to <body> so it can't be clipped or mis-positioned by the
     Edit Profile modal it is sometimes rendered inside. */
  const dialog = confirming && mounted
    ? createPortal(
        <div
          style={{
            /* Above the Edit Profile modal (its overlay is z-index 1000, with
               inner layers up to 1200) -- the portal escapes that stacking
               context, so it does NOT inherit a position above it the way
               ReportModal's own inline confirm does. Deliberately below the
               fullscreen video player at 9999. */
            position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.6)',
            display: 'grid', placeItems: 'center', padding: 18,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
        >
          <div style={{
            width: 'min(380px, 100%)', borderRadius: 12, padding: 18,
            background: 'var(--panel-bg-light, #14181f)',
            border: '1px solid var(--border)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Send reminder
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Which email(s) should get {playerName}&apos;s profile reminder?
            </p>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {option('player', 'Player Email', playerAddr)}
              {option('guardian', 'Parent Email', parentAddr)}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => void send()}
                disabled={chosen.length === 0}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: chosen.length ? 'pointer' : 'not-allowed', border: '1px solid var(--text)',
                  background: 'var(--text)', color: 'var(--bg, #0e1116)',
                  opacity: chosen.length ? 1 : 0.4,
                }}
              >Send</button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  const open = () => {
    if (!hasEmail || sending) return;
    setPicks({ player: !!playerAddr, guardian: !!parentAddr });
    setConfirming(true);
  };

  if (variant === 'icon') {
    return (
      <>
        <button
          type="button"
          onClick={open}
          disabled={!hasEmail || sending}
          title={title}
          aria-label={title}
          style={{
            border: '1px solid var(--border)',
            background: 'transparent',
            borderRadius: 8,
            padding: '4px 8px',
            fontSize: rem(13),
            lineHeight: 'normal',
            cursor: hasEmail && !sending ? 'pointer' : 'not-allowed',
            opacity: hasEmail ? 1 : 0.4,
          }}
        >
          {sent ? '✓' : sending ? '…' : '✉️'}
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={!hasEmail || sending}
        title={title}
        style={{
          width: '100%',
          border: '1px solid var(--border)',
          background: 'var(--card-elev)',
          color: 'var(--text-secondary)',
          borderRadius: 14,
          padding: '9px 12px',
          fontSize: rem(14),
          fontWeight: 600,
          lineHeight: 'normal',
          whiteSpace: 'nowrap',
          cursor: hasEmail && !sending ? 'pointer' : 'not-allowed',
          opacity: hasEmail ? 1 : 0.5,
        }}
      >
        {sent ? '✓ Reminder Sent' : sending ? 'Sending…' : '✉️ Profile Reminder'}
      </button>
      {dialog}
    </>
  );
}
