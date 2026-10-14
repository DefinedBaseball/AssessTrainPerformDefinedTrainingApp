'use client';

/* "Pending Invites" -- people invited who haven't finished setting up their
   account. Sits at the bottom of the Athletes list (athletes) and the Staff
   coaches card (coaches). Each row: name, email, when the invite went out
   (or that it expired -- invites last 7 days), and Resend / Remove. */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { tzOpt } from '@/lib/academy';
import styles from './PendingInvites.module.css';

export interface PendingInviteRow {
  key: string;
  name: string | null;
  email: string;
  sentAt: string;
  /** Opens their profile (athletes whose account already exists). */
  href?: string;
  resend?: () => Promise<unknown>;
  remove?: () => Promise<unknown>;
}

/** Athletes invited but not set up yet: accounts a coach created that are
 *  waiting on a password, plus sign-up links to people with no account.
 *  Shared by the Athletes tab and the Client Directory so both lists agree.
 *  `reloadPlayers` refetches the page's roster after a resend. */
export function useAthletePendingInvites(players: api.Player[], reloadPlayers: () => unknown, enabled: boolean) {
  const [regInvites, setRegInvites] = useState<api.RegistrationInvite[]>([]);
  const loadInvites = useCallback(async () => {
    try { setRegInvites(await api.getRegistrationInvites()); } catch { /* keep what's shown */ }
  }, []);
  useEffect(() => { if (enabled) void loadInvites(); }, [enabled, loadInvites]);

  const isPendingInvite = useCallback(
    (p: api.Player) => !api.isPlayerLocked(p) && !!p.user?.invitedAt, [],
  );
  const rows: PendingInviteRow[] = [
    ...players.filter(isPendingInvite).map((p) => ({
      key: `u-${p.id}`,
      name: `${p.firstName} ${p.lastName}`.trim(),
      email: p.user!.email,
      sentAt: p.user!.invitedAt!,
      href: `/athletes/${p.id}`,
      resend: p.user?.id ? () => api.resendAccountInvite(p.user!.id!) : undefined,
    })),
    ...regInvites.map((i) => ({
      key: `r-${i.id}`,
      name: i.name,
      email: i.email,
      sentAt: i.sentAt,
      resend: () => api.resendRegistrationInvite(i.id),
      remove: () => api.removeRegistrationInvite(i.id),
    })),
  ].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  const refresh = () => { void reloadPlayers(); void loadInvites(); };
  return { rows, isPendingInvite, refresh, loadInvites };
}

export function PendingInvites({ rows, onChanged, tone = 'red', canManage = true, inCard = false }: {
  rows: PendingInviteRow[];
  /** Refresh the list after a resend / remove. */
  onChanged: () => void;
  /** 'red' shades each row (athletes); 'plain' doesn't (coaches). */
  tone?: 'red' | 'plain';
  canManage?: boolean;
  /** Inside a padded settings card: no extra side padding. */
  inCard?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  if (rows.length === 0) return null;

  const run = async (row: PendingInviteRow, what: 'resend' | 'remove') => {
    const fn = what === 'resend' ? row.resend : row.remove;
    if (!fn) return;
    if (what === 'remove' && !window.confirm(`Withdraw the invite to ${row.email}?`)) return;
    setBusy(`${row.key}:${what}`);
    setNote(null);
    try {
      const res: any = await fn();
      if (what === 'resend') {
        setNote({
          key: row.key,
          ok: res?.emailed !== false,
          text: res?.emailed === false ? 'Not emailed: this server has no mail provider.' : 'Invite re-sent.',
        });
      }
      onChanged();
    } catch (e: any) {
      setNote({ key: row.key, ok: false, text: e?.message || 'That didn’t work.' });
    } finally {
      setBusy(null);
    }
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...tzOpt() });

  return (
    <section className={`${styles.wrap} ${inCard ? styles.inCard : ''}`} aria-label="Pending invites">
      <div className={styles.head}>
        <span>Pending Invites</span>
        <span className={styles.count}>{rows.length}</span>
      </div>
      <div className={styles.colHead} aria-hidden="true">
        <span>Name</span>
        <span className={styles.emailCol}>Email</span>
        <span>Sent</span>
        <span />
      </div>
      {rows.map((r) => {
        const expired = api.isInviteExpired(r.sentAt);
        return (
          <div key={r.key} className={`${styles.row} ${tone === 'red' ? styles.rowRed : ''}`}>
            <span className={styles.name}>
              {r.href ? <Link href={r.href}>{r.name || '—'}</Link> : (r.name || '—')}
              <span className={styles.emailSub}>{r.email}</span>
            </span>
            <span className={`${styles.emailCol} ${styles.email}`}>{r.email}</span>
            <span className={styles.sent}>
              {expired ? <span className={styles.expired}>Expired</span> : null}
              {expired ? ` · sent ${fmt(r.sentAt)}` : fmt(r.sentAt)}
            </span>
            <span className={styles.actions}>
              {canManage && r.resend && (
                <button type="button" className={styles.btn} disabled={!!busy} onClick={() => void run(r, 'resend')}>
                  {busy === `${r.key}:resend` ? 'Sending…' : 'Resend'}
                </button>
              )}
              {canManage && r.remove && (
                <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} disabled={!!busy} onClick={() => void run(r, 'remove')}>
                  {busy === `${r.key}:remove` ? 'Removing…' : 'Remove'}
                </button>
              )}
            </span>
            {note?.key === r.key && (
              <span className={`${styles.note} ${note.ok ? styles.noteOk : styles.noteErr}`}>{note.text}</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
