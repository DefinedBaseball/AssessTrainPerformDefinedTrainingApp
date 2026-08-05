'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Inquiry } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '../athletes/page.module.css';
import styles from './page.module.css';

function initials(f: string, l: string) {
  return `${(f[0] || '').toUpperCase()}${(l[0] || '').toUpperCase()}`;
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

/* Render any extra fields carried in the inquiry's `formData` JSON (so the
   form can add fields later without a code change here). */
function extraFormFields(formData: string | null) {
  if (!formData) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(formData);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const entries = Object.entries(parsed).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => (
    <div key={k} className={styles.field}>
      <div className={styles.fieldLabel}>{k}</div>
      <div className={styles.fieldValue}>{String(v)}</div>
    </div>
  ));
}

export default function InquiriesPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  /* Outcome of a Create Player Profile run — kept in the modal so the coach
     sees what happened (and can jump straight to the new profile) instead of
     an alert() that disappears. */
  const [createResult, setCreateResult] = useState<
    { ok: true; playerId: string; message: string } | { ok: false; message: string } | null
  >(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/'); // inquiries are a coach-only roster
  }, [isLoading, user, isCoach, router]);

  /* Same one-silent-retry pattern as the Athlete Hub — absorbs the Render
     cold-start, then surfaces an honest error + Retry on genuine failure. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const list = await api.getInquiries();
        setInquiries(list);
        setLoading(false);
        return;
      } catch {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        setLoadError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!user || !isCoach) return;
    load();
  }, [user, isCoach, load]);

  const closeModal = () => { setSelected(null); setConfirmDelete(false); setCreateResult(null); };

  /* ── Inquiry → Player profile ──────────────────────────────────────────
     Reuses the exact sequence "+ Add Athlete" runs, just sourced from the
     submitted form instead of typed by the coach:
       1. /auth/register  — creates the ACTIVE player account
       2. /players         — creates the profile (needs the new userId)
       3. PATCH /players   — fills the fields `create` doesn't accept
       4. PATCH status     — archives the inquiry (kept, not deleted, so the
                             original submission and its extra answers survive)
       5. /auth/invite     — mails a set-password link

     The account is created with a random password nobody sees; step 5 is how
     the athlete actually gets in. Steps 3-5 are best-effort: once the profile
     exists the conversion has succeeded, and a failure to (say) send mail
     shouldn't read as "this didn't work" — it's reported separately instead. */
  const handleCreateProfile = async () => {
    if (!selected) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const first = (selected.firstName || '').trim();
      const last = (selected.lastName || '').trim();
      const email = (selected.email || '').trim().toLowerCase();
      if (!first || !last || !email) {
        setCreateResult({ ok: false, message: 'This inquiry is missing a name or email, so a profile can’t be created from it.' });
        return;
      }

      /* `positions` is required by createPlayer. Prospects sometimes skip it,
         so fall back to a placeholder the coach can correct on the profile —
         better than blocking the conversion outright. */
      const positions = (selected.positions || '').trim() || 'ATH';

      /* Random password: the athlete never receives it and sets their own via
         the invite link. Avoids the shared `player123` default that
         "+ Add Athlete" still falls back to. */
      const randomPassword = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}!7`;

      let userId: string;
      try {
        /* `register` returns the new account as `id` (same field
           "+ Add Athlete" reads). It also returns a token for that account —
           the client deliberately doesn't store it, so the coach's own
           session is unaffected. */
        const reg = await api.register(email, randomPassword, 'PLAYER', undefined, `${first} ${last}`);
        userId = reg.id;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        /* Decision 3: the duplicate case is the likeliest failure here and
           deserves a real explanation, not a generic error. */
        if (/already registered|already exists|conflict|409/i.test(msg)) {
          setCreateResult({
            ok: false,
            message: `An account already exists for ${email}. Find that athlete in the Hub instead of creating a duplicate.`,
          });
          return;
        }
        setCreateResult({ ok: false, message: `Could not create the account: ${msg}` });
        return;
      }
      if (!userId) {
        setCreateResult({ ok: false, message: 'The account was created but no id came back — check the Athlete Hub before retrying.' });
        return;
      }

      const player = await api.createPlayer({
        userId,
        firstName: first,
        lastName: last,
        positions,
        gradYear: selected.gradYear ?? undefined,
      });

      /* Everything `createPlayer` doesn't take. The four free-text answers
         have no Player column of their own, so they're folded into
         developmentNotes with labels rather than dropped. */
      const extraNotes = [
        selected.otherSports ? `Other sports: ${selected.otherSports}` : '',
        selected.injuryHistory ? `Injury history: ${selected.injuryHistory}` : '',
        selected.otherHobbies ? `Other hobbies: ${selected.otherHobbies}` : '',
        selected.message ? `Message: ${selected.message}` : '',
      ].filter(Boolean).join('\n\n');

      const updates: Record<string, unknown> = {};
      if (selected.birthDate) updates.birthDate = selected.birthDate;
      if (selected.school) updates.highSchool = selected.school;
      if (selected.clubTeam) updates.clubTeam = selected.clubTeam;
      if (selected.goals) updates.goals = selected.goals;
      if (selected.goalLevel) updates.playingLevelGoal = selected.goalLevel;
      if (extraNotes) updates.developmentNotes = extraNotes;
      if (Object.keys(updates).length > 0) {
        try { await api.updatePlayer(player.id, updates); } catch { /* profile exists; coach can fill the rest */ }
      }

      // Decision 2: archive rather than delete — the submission is kept.
      try {
        await api.updateInquiryStatus(selected.id, 'ARCHIVED');
        setInquiries((prev) => prev.map((i) => (i.id === selected.id ? { ...i, status: 'ARCHIVED' } : i)));
      } catch { /* non-fatal — the profile is what matters */ }

      // Decision 1: invite email carrying the set-password link.
      let emailed = false;
      try {
        const res = await api.inviteUser(email, `${first} ${last}`);
        emailed = !!res?.emailed;
      } catch { /* reported below as "not emailed" */ }

      setCreateResult({
        ok: true,
        playerId: player.id,
        message: emailed
          ? `Profile created. ${first} was emailed a link to set their password.`
          : `Profile created — but the invite email didn’t send. Use "Reset Password" on their profile to get them in.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateResult({ ok: false, message: `Could not create the profile: ${msg}` });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await api.deleteInquiry(selected.id);
      setInquiries((prev) => prev.filter((i) => i.id !== selected.id));
      closeModal();
    } catch {
      window.alert('Could not delete the inquiry. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading || !user) return null;

  return (
    <div className={aStyles.pageRoot}>
      <PageHeader
        eyebrow="Prospective Athletes"
        title="Athlete"
        titleAccent="Inquiries"
        actions={
          <Link href="/athletes" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
            ← Athlete Hub
          </Link>
        }
      />

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Loading inquiries…</p>
      ) : loadError ? (
        <div className={aStyles.empty}>
          <p>Couldn&apos;t load inquiries.</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={load}>Retry</button>
        </div>
      ) : inquiries.length === 0 ? (
        <div className={aStyles.empty}>
          <p>No inquiries yet</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
            Submissions from the public inquiry form will appear here.
          </p>
        </div>
      ) : (
        <div className={aStyles.listWrap}>
          <div className={styles.scrollX}>
            <div className={styles.head}>
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>School</span>
              <span>Grad</span>
              <span>Club Team</span>
            </div>
            {inquiries.map((inq) => (
              <button key={inq.id} type="button" className={styles.row} onClick={() => { setSelected(inq); setConfirmDelete(false); }}>
                <span className={styles.name}>
                  <span className={aStyles.avatar}>{initials(inq.firstName, inq.lastName)}</span>
                  <span className={aStyles.playerName}>{inq.firstName} {inq.lastName}</span>
                </span>
                <span className={styles.cell}>{inq.email || '—'}</span>
                <span className={styles.cell}>{inq.phone || '—'}</span>
                <span className={styles.cell}>{inq.school || '—'}</span>
                <span className={styles.cell}>{inq.gradYear ? api.formatGradYear(inq.gradYear) : '—'}</span>
                <span className={styles.cell}>{inq.clubTeam || '—'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detail modal — the inquiry "form" the athlete submitted. */}
      {selected && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div style={{ minWidth: 0 }}>
                <div className={styles.modalName}>{selected.firstName} {selected.lastName}</div>
                <div className={styles.modalSub}>Submitted {fmtDate(selected.createdAt)} · {selected.status}</div>
              </div>
              <button type="button" onClick={closeModal} aria-label="Close"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Email</div>
                <div className={styles.fieldValue}>{selected.email ? <a href={`mailto:${selected.email}`}>{selected.email}</a> : '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Phone</div>
                <div className={styles.fieldValue}>{selected.phone ? <a href={`tel:${selected.phone}`}>{selected.phone}</a> : '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>School</div>
                <div className={styles.fieldValue}>{selected.school || '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Grad Year</div>
                <div className={styles.fieldValue}>{selected.gradYear ? api.formatGradYear(selected.gradYear) : '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Club Team</div>
                <div className={styles.fieldValue}>{selected.clubTeam || '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Position(s)</div>
                <div className={styles.fieldValue}>{selected.positions ? selected.positions.split(',').map((s) => s.trim()).join(', ') : '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Birthday</div>
                <div className={styles.fieldValue}>{selected.birthDate ? fmtDate(selected.birthDate) : '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Other Sports</div>
                <div className={styles.fieldValue}>{selected.otherSports || '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Other Hobbies</div>
                <div className={styles.fieldValue}>{selected.otherHobbies || '—'}</div>
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>Injury History</div>
                <div className={styles.fieldValue}>{selected.injuryHistory || '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Goal Level</div>
                <div className={styles.fieldValue}>{selected.goalLevel || '—'}</div>
              </div>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <div className={styles.fieldLabel}>Goals</div>
                <div className={styles.fieldValue}>{selected.goals || '—'}</div>
              </div>
              {selected.message && (
                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <div className={styles.fieldLabel}>Message</div>
                  <div className={styles.fieldValue}>{selected.message}</div>
                </div>
              )}
              {extraFormFields(selected.formData)}
            </div>

            <div className={styles.modalActions}>
              {confirmDelete ? (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Delete this inquiry?</span>
                  <button type="button" disabled={deleting} onClick={handleDelete}
                    style={{ border: '1px solid var(--red, #ef4444)', color: 'var(--red, #ef4444)', background: 'transparent', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {deleting ? '…' : 'Yes, delete'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirmDelete(true)}
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Delete
                  </button>
                  {/* Create Player Profile — sits next to Delete per spec.
                      Hidden once the conversion has succeeded so the same
                      inquiry can't be converted twice into duplicate accounts. */}
                  {!(createResult && createResult.ok) && (
                    <button
                      type="button"
                      disabled={creating}
                      onClick={handleCreateProfile}
                      style={{
                        border: '1px solid rgba(126,182,255,0.55)',
                        color: creating ? 'var(--text-muted)' : '#cfe0ff',
                        background: 'rgba(126,182,255,0.16)',
                        borderRadius: 8,
                        padding: '6px 14px',
                        cursor: creating ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {creating ? 'Creating…' : 'Create Player Profile'}
                    </button>
                  )}
                </>
              )}
              <button type="button" className="btn btn-primary" onClick={closeModal}>Close</button>
            </div>

            {/* Conversion outcome — success links straight to the new profile. */}
            {createResult && (
              <div
                style={{
                  margin: '10px 16px 16px',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  border: `1px solid ${createResult.ok ? 'rgba(126,182,255,0.45)' : 'var(--red, #ef4444)'}`,
                  background: createResult.ok ? 'rgba(126,182,255,0.10)' : 'rgba(239,68,68,0.08)',
                  color: 'var(--text)',
                }}
              >
                {createResult.message}
                {createResult.ok && (
                  <>
                    {' '}
                    <Link href={`/athletes/${createResult.playerId}`} style={{ color: '#cfe0ff', fontWeight: 700 }}>
                      Open profile →
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
