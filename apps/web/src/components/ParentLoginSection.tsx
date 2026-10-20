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
      /* Siblings: other athletes listing the same Parent Email. Nothing is
         pre-ticked -- the coach picks which to link. */
      const linkedEmail = email.trim();
      try {
        const others = await api.getMatchingAthletes(linkedEmail, playerId);
        setSuggestions(others.length ? { email: linkedEmail, athletes: others } : null);
        setSuggestPicked(new Set());
      } catch { setSuggestions(null); }
    } catch (e: any) {
      setError(e?.message || 'Could not create the parent login.');
    } finally {
      setBusy(false);
    }
  };

  /* "Also link?" -- other athletes with the same Parent Email. */
  const [suggestions, setSuggestions] = useState<{
    email: string;
    athletes: { id: string; firstName: string; lastName: string; gradYear: number | null }[];
  } | null>(null);
  const [suggestPicked, setSuggestPicked] = useState<Set<string>>(new Set());
  const [suggestBusy, setSuggestBusy] = useState(false);

  const linkSuggested = async () => {
    if (!suggestions || suggestPicked.size === 0) return;
    setSuggestBusy(true);
    setError('');
    const done: string[] = [];
    try {
      for (const a of suggestions.athletes) {
        if (!suggestPicked.has(a.id)) continue;
        await api.createParentLogin({ playerId: a.id, email: suggestions.email });
        done.push(`${a.firstName} ${a.lastName}`);
      }
      setNotice(`Also linked: ${done.join(', ')}.`);
      setSuggestions(null);
    } catch (e: any) {
      setError(e?.message || 'Could not link those athletes.');
      if (done.length) setNotice(`Also linked: ${done.join(', ')}.`);
    } finally {
      setSuggestBusy(false);
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
          {suggestions && (
            <div className={styles.suggest}>
              <span className={styles.suggestTitle}>
                These athletes also list {suggestions.email} as Parent Email. Link them too?
              </span>
              {suggestions.athletes.map(a => (
                <label key={a.id} className={styles.suggestRow}>
                  <input
                    type="checkbox"
                    checked={suggestPicked.has(a.id)}
                    onChange={() => setSuggestPicked(prev => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                      return next;
                    })}
                  />
                  <span>{a.firstName} {a.lastName}{a.gradYear ? ` · ${api.formatGradYear(a.gradYear)}` : ''}</span>
                </label>
              ))}
              <div className={styles.suggestActions}>
                <button type="button" className={styles.createBtn} onClick={() => void linkSuggested()} disabled={suggestBusy || suggestPicked.size === 0}>
                  {suggestBusy ? 'Linking…' : 'Link Selected'}
                </button>
                <button type="button" className={styles.removeBtn} style={{ color: 'var(--text-muted)' }} onClick={() => setSuggestions(null)} disabled={suggestBusy}>
                  Not now
                </button>
              </div>
            </div>
          )}
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
