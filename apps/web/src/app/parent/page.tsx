'use client';

/* ─────────────────────────────────────────────────────────────────────
   Parent profile -- the whole app for a PARENT login (AppShell sends every
   other route here). Their own details (editable, except the email, which
   is their login and stays with the coach), a Passes placeholder until
   scheduling is designed, and the athletes linked to them (view only).
   ───────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ParentProfile } from '@/lib/api';
import { AthleteAvatar } from '@/components/AthleteAvatar';
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
    { label: 'First Name', value: profile.firstName, key: 'firstName' },
    { label: 'Last Name', value: profile.lastName, key: 'lastName' },
    { label: 'Email', value: profile.email, hint: 'Your login — ask your coach to change it.' },
    { label: 'Phone', value: profile.phone ?? '', key: 'phone', type: 'tel' },
    { label: 'Birthday', value: formatBirthday(profile.birthDate), key: 'birthDate', type: 'date' },
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
              <h2 className={styles.cardTitle}>My Details</h2>
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

          {/* ── Linked athletes (view only) ── */}
          <section className={`${theme.bubble} ${styles.card}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Athletes</h2>
              <span className={styles.count}>{profile.athletes.length}</span>
            </div>
            {profile.athletes.length === 0 ? (
              <div className={`${theme.inner} ${theme.rowShade} ${styles.empty}`}>
                No athletes are linked to your account yet. Your coach links them.
              </div>
            ) : (
              <div className={styles.athleteList}>
                {profile.athletes.map(a => (
                  <div key={a.id} className={`${theme.inner} ${theme.rowShade} ${styles.athleteRow}`}>
                    <AthleteAvatar photo={a.profilePhoto} firstName={a.firstName} lastName={a.lastName} className={hubStyles.avatar} />
                    <span className={styles.athleteName}>{a.firstName} {a.lastName}</span>
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
