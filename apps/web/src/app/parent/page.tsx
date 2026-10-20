'use client';

/* ─────────────────────────────────────────────────────────────────────
   Parent profile -- the whole app for a PARENT login (AppShell sends every
   other route here). Their own details (editable, except the email, which
   is their login and stays with the coach), a Passes placeholder until
   scheduling is designed, and the athletes linked to them (view only).
   ───────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ParentProfile } from '@/lib/api';
import { AthleteAvatar } from '@/components/AthleteAvatar';
import { MessagesLauncher } from '@/components/MessagesLauncher';
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconAthletes } from '../education/EduHeader';
import styles from './page.module.css';
/* The Athlete Hub's initials/photo circle (incl. its light-theme puck). */
import hubStyles from '../athletes/page.module.css';

type Draft = { firstName: string; lastName: string; phone: string; birthDate: string; hometown: string };

const toDraft = (p: ParentProfile): Draft => ({
  firstName: p.firstName,
  lastName: p.lastName,
  phone: p.phone ?? '',
  birthDate: p.birthDate ?? '',
  hometown: p.hometown ?? '',
});

/** "2026-03-04" -> "Mar 4, 2026" (date-only, no time-zone shift). */
function formatBirthday(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ParentProfilePage() {
  const router = useRouter();
  const { user, isParent, isLoading } = useAuth();
  const [profile, setProfile] = useState<ParentProfile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  /* Guard on isLoading, never on `user` alone (undefined while auth
     resolves). Only parent logins belong here. */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isParent) router.replace('/');
  }, [isLoading, user, isParent, router]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setProfile(await api.getMyParentProfile());
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your profile.');
    }
  }, []);

  useEffect(() => {
    if (!isLoading && isParent) void load();
  }, [isLoading, isParent, load]);

  /* ── Link Athlete: find profiles whose Parent Email is this login,
     request the ones that are theirs, an admin allows/denies. ── */
  const [linkOpen, setLinkOpen] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; name: string; gradYear: number | null }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkNotice, setLinkNotice] = useState('');

  const openLink = async () => {
    setLinkOpen(true);
    setCandidates(null);
    setPicked(new Set());
    setLinkError('');
    setLinkNotice('');
    try {
      setCandidates(await api.getParentLinkCandidates());
    } catch (e: any) {
      setCandidates([]);
      setLinkError(e?.message || 'Could not look up athletes.');
    }
  };

  const sendLinkRequest = async () => {
    if (picked.size === 0) return;
    setLinkBusy(true);
    setLinkError('');
    try {
      setProfile(await api.requestParentLinks([...picked]));
      setLinkOpen(false);
      setLinkNotice('Request sent. A coach will approve the link.');
    } catch (e: any) {
      setLinkError(e?.message || 'Could not send the request.');
    } finally {
      setLinkBusy(false);
    }
  };

  const startEdit = () => {
    if (!profile) return;
    setDraft(toDraft(profile));
    setSaveError('');
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setSaveError('First and last name are required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      setProfile(await api.updateMyParentProfile(draft));
      setEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !isParent) return null;

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => (d ? { ...d, [k]: e.target.value } : d));

  const rows: { label: string; value: string; key?: keyof Draft; type?: string; hint?: string }[] = profile ? [
    /* Three per row: names + birthday, then the contact details. */
    { label: 'First Name', value: profile.firstName, key: 'firstName' },
    { label: 'Last Name', value: profile.lastName, key: 'lastName' },
    { label: 'Birthday', value: formatBirthday(profile.birthDate), key: 'birthDate', type: 'date' },
    { label: 'Email', value: profile.email, hint: 'Your login — change it in Settings.' },
    { label: 'Phone Number', value: profile.phone ?? '', key: 'phone', type: 'tel' },
    { label: 'Hometown', value: profile.hometown ?? '', key: 'hometown' },
  ] : [];

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconAthletes />}
        eyebrow="Parent Profile"
        title={profile?.firstName || 'My'}
        accent={profile?.lastName || 'Profile'}
        actions={<MessagesLauncher />}
      />

      {loadError && (
        <div className={`${theme.bubble} ${theme.pad} ${styles.error}`}>
          {loadError}{' '}
          <button type="button" className={`btn btn-outline ${theme.field} ${theme.firm}`} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {profile && (
        <>
          {/* ── Details ── */}
          <section className={`${theme.bubble} ${styles.card}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Personal Details</h2>
              {!editing ? (
                <button type="button" className={`btn btn-outline ${theme.field} ${theme.firm}`} onClick={startEdit}>
                  Edit
                </button>
              ) : (
                <div className={styles.headActions}>
                  <button type="button" className={`btn btn-outline ${theme.field} ${theme.firm}`} onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className={`btn btn-primary ${theme.firm}`} onClick={() => void save()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
            {saveError && <div className={styles.error}>{saveError}</div>}
            <div className={styles.fieldGrid}>
              {rows.map(r => (
                <div key={r.label} className={`${theme.inner} ${theme.rowShade} ${styles.field}`}>
                  <span className={styles.fieldLabel}>{r.label}</span>
                  {editing && r.key && draft ? (
                    <input
                      className={`${theme.field} ${theme.firm} ${styles.input}`}
                      type={r.type || 'text'}
                      value={draft[r.key]}
                      onChange={set(r.key)}
                      aria-label={r.label}
                    />
                  ) : (
                    <span className={r.value ? styles.fieldValue : styles.fieldEmpty}>
                      {r.value || 'Not added'}
                    </span>
                  )}
                  {editing && r.hint && <span className={styles.fieldHint}>{r.hint}</span>}
                </div>
              ))}
            </div>
          </section>

          {/* ── Passes (placeholder until scheduling is designed) ── */}
          <section className={`${theme.bubble} ${styles.card}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Passes</h2>
            </div>
            <div className={`${theme.inner} ${theme.rowShade} ${styles.passes}`}>
              <span className={styles.passCount}>0</span>
              <span className={styles.passText}>
                Lesson passes will show here once online booking opens.
              </span>
            </div>
          </section>

          {/* ── Linked athletes (view only) + Link Athlete ── */}
          <section className={`${theme.bubble} ${styles.card}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>My Athletes <span className={styles.count}>{profile.athletes.length}</span></h2>
              {!linkOpen && (
                <button type="button" className={`btn btn-outline ${theme.field} ${theme.firm}`} onClick={() => void openLink()}>
                  Link Athlete
                </button>
              )}
            </div>

            {linkNotice && <div className={styles.notice}>{linkNotice}</div>}

            {linkOpen && (
              <div className={`${theme.inner} ${theme.rowShade} ${styles.linkPanel}`}>
                {candidates === null ? (
                  <span className={styles.linkHint}>Looking for athletes…</span>
                ) : candidates.length === 0 ? (
                  <span className={styles.linkHint}>
                    No new athletes found. Athletes are found by the Parent Email on their profile ({profile.email}) —
                    ask your athlete or your coach to add it, then try again.
                  </span>
                ) : (
                  <>
                    <span className={styles.linkHint}>
                      These athletes list <strong>{profile.email}</strong> as their Parent Email. Pick yours, and a coach will approve the link.
                    </span>
                    <div className={styles.pickList}>
                      {candidates.map(c => (
                        <label key={c.id} className={`${theme.field} ${theme.firm} ${styles.pickRow}`}>
                          <input
                            type="checkbox"
                            checked={picked.has(c.id)}
                            onChange={() => setPicked(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            })}
                          />
                          <span className={styles.pickName}>{c.name}</span>
                          <span className={styles.athleteMeta}>{api.formatGradYear(c.gradYear)}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {linkError && <div className={styles.error}>{linkError}</div>}
                <div className={styles.headActions}>
                  <button type="button" className={`btn btn-outline ${theme.field} ${theme.firm}`} onClick={() => setLinkOpen(false)} disabled={linkBusy}>
                    Cancel
                  </button>
                  {candidates && candidates.length > 0 && (
                    <button type="button" className={`btn btn-primary ${theme.firm}`} onClick={() => void sendLinkRequest()} disabled={linkBusy || picked.size === 0}>
                      {linkBusy ? 'Sending…' : 'Request Link'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {profile.pendingRequests.length > 0 && (
              <div className={styles.athleteList}>
                {profile.pendingRequests.map(r => (
                  <div key={r.id} className={`${theme.inner} ${theme.rowShade} ${styles.pendingRow}`}>
                    <span className={styles.athleteName}>{r.name}</span>
                    <span className={styles.athleteMeta}>{api.formatGradYear(r.gradYear)}</span>
                    <span className={styles.pendingTag}>Waiting for coach approval</span>
                  </div>
                ))}
              </div>
            )}

            {profile.athletes.length === 0 ? (
              profile.pendingRequests.length === 0 && !linkOpen && (
                <div className={`${theme.inner} ${theme.rowShade} ${styles.empty}`}>
                  No athletes are linked to your account yet. Use Link Athlete to find yours.
                </div>
              )
            ) : (
              <div className={styles.athleteList}>
                {profile.athletes.map(a => (
                  <div key={a.id} className={`${theme.inner} ${theme.rowShade} ${styles.athleteRow}`}>
                    <AthleteAvatar photo={a.profilePhoto} firstName={a.firstName} lastName={a.lastName} className={hubStyles.avatar} />
                    {/* Opens the athlete's profile, read-only. */}
                    <Link href={`/athletes/${a.id}`} className={`${styles.athleteName} ${styles.athleteLink}`}>
                      {a.firstName} {a.lastName}
                    </Link>
                    <span className={styles.athleteMeta}>{api.formatGradYear(a.gradYear)}</span>
                    <span className={styles.positions}>
                      {a.positions.split(',').filter(Boolean).map(pos => (
                        <span key={pos.trim()} className="badge">{pos.trim()}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
