'use client';

/* Emails one athlete a reminder to finish filling in their profile.
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
  variant = 'icon',
}: {
  playerId: string;
  playerName: string;
  /** The athlete's login email. Absent = nowhere to send, so the button is
   *  disabled with a reason rather than failing after the confirm. */
  email?: string | null;
  variant?: Variant;
}) {
  const { isCoach } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  /* The dialog is portalled to <body>, which only exists client-side. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isCoach) return null;

  const hasEmail = !!email?.trim();

  const send = async () => {
    setConfirming(false);
    setSending(true);
    try {
      const res = await api.sendProfileReminder(playerId);
      /* The request can succeed while nothing was actually sent -- the server
         no-ops when Resend isn't configured. Saying "Sent" on that would be a
         lie the coach only discovers when the athlete never replies. */
      if (res.emailed) {
        setSent(true);
        setTimeout(() => setSent(false), 2500);
      } else {
        window.alert(
          `The reminder was not emailed to ${playerName}. This server has no mail provider configured.`,
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
    : `${playerName} has no email address on file`;

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
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
              Do you want to send a reminder email to {playerName}?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => void send()}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: 'pointer', border: '1px solid var(--text)',
                  background: 'var(--text)', color: 'var(--bg, #0e1116)',
                }}
              >Yes</button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                }}
              >No</button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  const open = () => { if (hasEmail && !sending) setConfirming(true); };

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
