'use client';

/* Edit Profile → "Parent Login": the parent logins linked to this athlete,
   and a form that creates one from the parent's email plus a password the
   coach sets. If a parent login with that email already exists (a sibling's
   parent) the athlete is just added to it and its password is left alone.
   Viewer coaches see the list only. Lives inside the Edit Profile <form>, so
   Enter in these fields runs Create here instead of saving the profile. */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { LinkedParent } from '@/lib/api';
import rs from '@/components/assessment/report-form.module.css';
import styles from './ParentLoginSection.module.css';

interface ParentLoginSectionProps {
  playerId: string;
  /** Pre-fills the email (the Parent Email field already on the profile). */
  defaultEmail: string;
  /** Pre-fills the parent's last name (usually the athlete's). */
  defaultLastName: string;
  canEdit: boolean;
}

export function ParentLoginSection({ playerId, defaultEmail, defaultLastName, canEdit }: ParentLoginSectionProps) {
  const [parents, setParents] = useState<LinkedParent[] | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState(defaultLastName);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setParents(await api.getParentsForPlayer(playerId)); } catch { setParents([]); }
  }, [playerId]);
  useEffect(() => { void load(); }, [load]);

  /* Keep the email in step with the Parent Email field until it's typed in. */
  const [emailTouched, setEmailTouched] = useState(false);
  useEffect(() => { if (!emailTouched) setEmail(defaultEmail); }, [defaultEmail, emailTouched]);

  const create = async () => {
    if (busy) return;
    setError('');
    setNotice('');
    if (!email.trim()) { setError('Enter the parent’s email.'); return; }
    setBusy(true);
    try {
      const res = await api.createParentLogin({
        playerId,
        email: email.trim(),
        password: password || undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      setParents(res.parents);
      setPassword('');
      setNotice(res.created
        ? 'Parent login created. They can sign in with this email and password.'
        : 'Linked to the parent login that already uses this email (its password is unchanged).');
    } catch (e: any) {
      setError(e?.message || 'Could not create the parent login.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (p: LinkedParent) => {
    if (!window.confirm(`Remove ${p.firstName} ${p.lastName} from this athlete?\n\nTheir parent login stays; they just won't see this athlete.`)) return;
    setError('');
    setNotice('');
    try {
      setParents((await api.unlinkParent(p.id, playerId)).parents);
    } catch (e: any) {
      setError(e?.message || 'Could not remove the parent.');
    }
  };

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void create(); }
  };

  return (
    <div className={`${rs.section} ${styles.wrap}`}>
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>👪</span>
        <span className={rs.sectionTitle}>Parent Login</span>
      </div>

      {parents && parents.length > 0 && (
        <div className={styles.list}>
          {parents.map(p => (
            <div key={p.id} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowName}>{p.firstName} {p.lastName}</span>
                <span className={styles.rowMeta}>
                  {p.email}{p.phone ? ` · ${p.phone}` : ''} · {p.hasSignedIn ? 'Has signed in' : 'Not signed in yet'}
                </span>
              </div>
              {canEdit && (
                <button type="button" className={styles.removeBtn} onClick={() => void unlink(p)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      )}
      {parents && parents.length === 0 && !canEdit && (
        <p className={styles.hint}>No parent login yet.</p>
      )}

      {canEdit && (
        <>
          <p className={styles.hint}>
            Give a parent their own login. They sign in to a profile page listing their athletes, and can’t change any athlete data.
            Using the email of an existing parent login adds this athlete to it.
          </p>
          <div className={rs.summaryGrid}>
            <div className={rs.summaryField}>
              <label className={rs.summaryLabel}>Parent First Name</label>
              <input className={rs.summaryInput} value={firstName} onChange={e => setFirstName(e.target.value)} onKeyDown={onEnter} placeholder="First name" />
            </div>
            <div className={rs.summaryField}>
              <label className={rs.summaryLabel}>Parent Last Name</label>
              <input className={rs.summaryInput} value={lastName} onChange={e => setLastName(e.target.value)} onKeyDown={onEnter} placeholder="Last name" />
            </div>
            <div className={rs.summaryField}>
              <label className={rs.summaryLabel}>Parent Login Email</label>
              <input type="email" className={rs.summaryInput} value={email} onChange={e => { setEmailTouched(true); setEmail(e.target.value); }} onKeyDown={onEnter} placeholder="parent@example.com" autoComplete="off" />
            </div>
            <div className={rs.summaryField}>
              <label className={rs.summaryLabel}>Password (new logins)</label>
              <input type="password" className={rs.summaryInput} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onEnter} placeholder="At least 8 characters" autoComplete="new-password" />
            </div>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          {notice && <div className={styles.notice}>{notice}</div>}
          <div>
            <button type="button" className={styles.createBtn} onClick={() => void create()} disabled={busy}>
              {busy ? 'Saving…' : 'Create Parent Login'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
