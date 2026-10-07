'use client';

import { rem } from '@/lib/rem';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ClubTeam, College, ClubTeamInput, CollegeInput } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { SignOutEverywhereButton } from '@/components/SignOutEverywhereButton';
import { AcademyTab } from './AcademyTab';
import nextDynamic from 'next/dynamic';
import styles from './page.module.css';

/* The athlete's My Profile tab IS the profile's Edit Profile window (same
   form, every field), loaded only when an athlete opens the tab. */
const ReportModal = nextDynamic(
  () => import('@/app/athletes/[id]/ReportModal').then((m) => m.ReportModal),
  { ssr: false },
);

import { getAllCameraLabels, setCameraLabel } from '@/lib/camera-labels';
import { tzOpt } from '@/lib/academy';

type TabKey = 'account' | 'notifications' | 'data' | 'teams' | 'cameras' | 'myProfile' | 'staff' | 'academy';

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading, isCoach, isAdmin, isViewer, logout } = useAuth();
  const [tab, setTab] = useState<TabKey>('account');
  // Coach config tools (import/manage) are for editing coaches; viewers are read-only.
  const isEditorCoach = isCoach && !isViewer;

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const playerId: string | null = (user as any)?.playerId || null;

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'account', label: 'Account' },
    ...(!isCoach && playerId ? ([{ key: 'myProfile' as TabKey, label: 'My Profile' }]) : []),
    /* Athletes have no notification settings: report, video and Coach
       Review notifications always reach them. */
    ...(isCoach ? ([{ key: 'notifications' as TabKey, label: 'Notifications' }]) : []),
    /* Data & Integrations is coach-only — players don't import vendor CSVs.
       Hidden from viewers (read-only). */
    ...(isEditorCoach ? ([{ key: 'data' as TabKey, label: 'Data & Integrations' }]) : []),
    ...(isEditorCoach ? ([{ key: 'teams' as TabKey, label: 'Teams & Colleges' }]) : []),
    /* Admin-only "Staff" tab — create + manage coach accounts and access levels. */
    ...(isAdmin ? ([{ key: 'staff' as TabKey, label: 'Staff' }]) : []),
    /* Admin-only "Academy" tab — name, logos, contact info, email wording,
       reply-to, new-athlete switch, time zone. */
    ...(isAdmin ? ([{ key: 'academy' as TabKey, label: 'Academy' }]) : []),
    /* Coach "Cameras" tab — OBS-style friendly names for each attached video
       input, used by Live Training's multi-angle recording. Hidden from viewers. */
    ...(isEditorCoach ? ([{ key: 'cameras' as TabKey, label: 'Cameras' }]) : []),
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        titleAccent="Hub"
        subtitle="Manage your account and preferences"
      />

      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab user={user} onLogout={logout} isCoach={isCoach} />}
      {tab === 'myProfile' && !isCoach && playerId && <MyProfileTab playerId={playerId} />}
      {tab === 'notifications' && isCoach && <NotificationsTab isCoach={isCoach} />}
      {tab === 'data' && isEditorCoach && <DataTab isCoach={isCoach} />}
      {tab === 'teams' && isEditorCoach && <TeamsAndCollegesTab />}
      {tab === 'staff' && isAdmin && <StaffTab />}
      {tab === 'academy' && isAdmin && <AcademyTab />}
      {tab === 'cameras' && isEditorCoach && <CamerasTab />}
    </div>
  );
}

/* ─── Cameras ──────────────────────────────────────────────────
   Lists every detected video input device (built-in cameras, USB
   webcams, capture cards). The coach types a friendly OBS-style
   label per device; labels are saved to localStorage via the shared
   helper and consumed by Live Training's multi-angle capture flow.

   Permission gating: browsers hide device labels until the page has
   been granted camera access at least once. The panel surfaces a
   "Grant camera access" button when needed so coaches see actual
   names like "Logitech BRIO" instead of "Camera 1" / "Camera 2".
   ──────────────────────────────────────────────────────────────── */
function CamerasTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>(() => getAllCameraLabels());
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [refreshKey, setRefreshKey] = useState(0);

  /* Refresh the device list. Calls enumerateDevices() and filters
     to video inputs only. Re-runs when `refreshKey` bumps (after
     a permission grant) so the now-labeled devices appear. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    navigator.mediaDevices.enumerateDevices().then((list) => {
      if (cancelled) return;
      /* Hide virtual cameras (OBS Virtual Camera, NVIDIA Broadcast,
         etc.) — they wrap physical cams and just clutter the
         settings list. Same filter the Live Training page uses so
         the two surfaces report the same camera roster. */
      const VIRTUAL_CAM_PATTERNS = [
        /obs\s*virtual/i,
        /\bvirtual\s*camera\b/i,
        /nvidia\s*broadcast/i,
        /snap\s*camera/i,
        /xsplit\s*vcam/i,
      ];
      const isVirtual = (label: string | undefined) =>
        !!label && VIRTUAL_CAM_PATTERNS.some((re) => re.test(label));
      const videoInputs = list.filter(
        (d) => d.kind === 'videoinput' && !isVirtual(d.label),
      );
      setDevices(videoInputs);
      /* If any device reports an empty `label`, permission probably
         hasn't been granted yet — Chrome / Firefox hide the label
         until then. Surface the prompt button below. */
      const anyEmpty = videoInputs.some((d) => !d.label);
      setPermissionState(anyEmpty ? 'unknown' : 'granted');
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [refreshKey]);

  async function requestPermission() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      /* Immediately stop the stream — we only needed the permission
         grant; the device list will refresh with real labels on the
         next enumerateDevices() pass below. */
      stream.getTracks().forEach((t) => t.stop());
      setPermissionState('granted');
      setRefreshKey((k) => k + 1);
    } catch {
      setPermissionState('denied');
    }
  }

  function handleLabelChange(deviceId: string, newLabel: string) {
    setCameraLabel(deviceId, newLabel);
    /* Update the local mirror so the input re-renders with the new
       value immediately (the shared helper is the source of truth
       for everyone else). */
    setLabels((prev) => {
      const next = { ...prev };
      if (newLabel.trim()) next[deviceId] = newLabel.trim();
      else delete next[deviceId];
      return next;
    });
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Camera Inputs</h2>
        <p className={styles.cardDesc}>
          Type a friendly name for each connected camera (OBS-style).
          Names are used by Live Training&apos;s multi-angle recording —
          each saved clip&apos;s title appends the camera label so the
          gallery reads at a glance.
        </p>

        {permissionState !== 'granted' && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={styles.btn}
              onClick={requestPermission}
            >
              Grant camera access
            </button>
            {permissionState === 'denied' && (
              <p style={{ marginTop: 8, color: 'var(--danger, #fda4af)', fontSize: rem(12) }}>
                Camera permission was denied. Enable it in your browser settings, then refresh.
              </p>
            )}
          </div>
        )}

        {devices.length === 0 ? (
          <p className={styles.cardDesc}>No cameras detected. Plug one in and refresh the page.</p>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {devices.map((d, i) => {
            const fallback = d.label || `Camera ${i + 1}`;
            const saved = labels[d.deviceId] || '';
            return (
              <div
                key={d.deviceId || i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: rem(13), fontWeight: 600, color: 'var(--text)' }}>
                    {fallback}
                  </div>
                  <div style={{ fontSize: rem(10), color: 'var(--text-muted)', fontFamily: "'DM Mono', ui-monospace, monospace", marginTop: 2 }}>
                    {/* Short id chip so the coach can match the
                        camera back if browsers display the same name
                        for two devices. */}
                    {d.deviceId.slice(0, 8) || '—'}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Side Angle, Bullpen Mound, Cage Front"
                  value={saved}
                  onChange={(e) => handleLabelChange(d.deviceId, e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: 'var(--text)',
                    fontSize: rem(13),
                    fontFamily: 'inherit',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}

/* ─── Account ──────────────────────────────────────────────── */

function AccountTab({ user, onLogout, isCoach }: { user: any; onLogout: () => void; isCoach: boolean }) {
  const { refresh, isAdmin, isViewer } = useAuth();
  /* Three account types. Viewer-level coaches are Coaches with view-only
     access, noted underneath. */
  const accountType = !isCoach ? 'Athlete' : isAdmin ? 'Coach Admin' : 'Coach';
  const [profile, setProfile] = useState<api.AccountProfile | null>(null);
  const [email, setEmail] = useState(user.email || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // Change-password form
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  useEffect(() => {
    api.getMe()
      .then((p) => {
        setProfile(p);
        const nameParts = (p.name || '').trim().split(/\s+/);
        setFirstName(nameParts[0] || '');
        setLastName(nameParts.slice(1).join(' '));
        setPhone(p.phone || '');
        setPosition(p.position || '');
        setEmail(p.email || user.email || '');
      })
      .catch(() => { /* fall back to session values below */ });
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
      /* An athlete's name is edited in My Profile (the player profile), not
         here -- so their save leaves the account name alone. */
      const updated = await api.updateAccount({
        ...(isCoach ? { name: fullName, position } : {}),
        email,
        phone,
      });
      setProfile(updated);
      // The login email may have changed -- refresh the session so the stored
      // email (and what they sign in with) reflects it.
      await refresh();
      setProfileMsg('Saved.');
      setTimeout(() => setProfileMsg(''), 2000);
    } catch (e: any) {
      setProfileErr(e?.message || 'Save failed');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr('');
    setPwMsg('');
    if (newPw.length < 6) { setPwErr('New password must be at least 6 characters'); return; }
    if (newPw !== confirmPw) { setPwErr('Passwords do not match'); return; }
    setSavingPw(true);
    try {
      await api.changePassword(curPw, newPw);
      setPwMsg('Password changed.');
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => setPwMsg(''), 2500);
    } catch (e: any) {
      setPwErr(e?.message || 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  };

  const isPrimaryAdmin = profile?.isPrimaryAdmin ?? false;

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>Account Information</h3>
          {/* Coaches sign themselves out everywhere here; athletes have the
              same button on My Profile. */}
          {isCoach && <span style={{ marginLeft: 'auto' }}><SignOutEverywhereButton /></span>}
          {isPrimaryAdmin && (
            <span
              style={{
                fontSize: rem(10), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: '#3d8bfd', border: '1px solid rgba(61,139,253,0.4)', borderRadius: 999,
                padding: '3px 9px',
              }}
            >
              Primary Admin
            </span>
          )}
        </div>
        <p className={styles.cardDesc}>Your account details and contact info.</p>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Email</span>
            <span className={styles.rowSub}>The email you sign in with — update it here</span>
          </div>
          <input
            className={styles.input}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Account type</span>
            {isViewer && <span className={styles.rowSub}>View-only access</span>}
          </div>
          <span className={styles.rowSub}>{accountType}{isPrimaryAdmin ? ' · Primary Admin' : ''}</span>
        </div>
        {isCoach && (
          <>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={styles.rowTitle}>First name</span>
                <span className={styles.rowSub}>Shown in place of your email where supported</span>
              </div>
              <input className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Connor" />
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={styles.rowTitle}>Last name</span>
              </div>
              <input className={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="e.g. Olson" />
            </div>
          </>
        )}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Phone</span>
          </div>
          <input className={styles.input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
        </div>
        {isCoach && (
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.rowTitle}>Position</span>
              <span className={styles.rowSub}>Your role at the facility</span>
            </div>
            <input className={styles.input} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Hitting Coordinator" />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className={styles.btn} onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save'}
          </button>
        </div>
        {profileErr && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{profileErr}</div>}
        {profileMsg && <div className={`${styles.feedback} ${styles.feedbackOk}`}>{profileMsg}</div>}
      </div>

      <form className={styles.card} onSubmit={savePassword} autoComplete="off">
        <h3 className={styles.cardTitle}>Change password</h3>
        <p className={styles.cardDesc}>Update the password you sign in with.</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Current password</span></div>
          <input className={styles.input} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>New password</span><span className={styles.rowSub}>At least 6 characters</span></div>
          <input className={styles.input} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Confirm new password</span></div>
          <input className={styles.input} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
        </div>
        {pwErr && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{pwErr}</div>}
        {pwMsg && <div className={`${styles.feedback} ${styles.feedbackOk}`}>{pwMsg}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className={styles.btn} type="submit" disabled={savingPw}>
            {savingPw ? 'Saving…' : 'Change Password'}
          </button>
        </div>
      </form>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Session</h3>
        <p className={styles.cardDesc}>Sign out of this device</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className={styles.btnDanger} onClick={onLogout}>Sign Out</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Staff (coach account creation) ──────────────────────────
   Coach-only. Creates another COACH login via the `register`
   endpoint (role = COACH). The new coach signs in at /login with
   the email + password set here. */
function StaffTab() {
  const { user: me } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [level, setLevel] = useState<'ADMIN' | 'COACH' | 'VIEWER'>('COACH');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [coaches, setCoaches] = useState<api.CoachAccount[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);

  const LEVEL_LABEL: Record<string, string> = { ADMIN: 'Admin', COACH: 'Coach', VIEWER: 'Viewer' };

  /** Admin changes another coach's access level inline. */
  const changeLevel = async (coachId: string, newLevel: 'ADMIN' | 'COACH' | 'VIEWER') => {
    try {
      await api.setCoachLevel(coachId, newLevel);
      loadCoaches();
    } catch (e: any) {
      setError(e?.message || 'Could not change access level');
    }
  };

  // Per-coach "Set password" inline form state
  const [pwForId, setPwForId] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const savePassword = async (coachId: string) => {
    if (pwValue.length < 6) { setPwMsg('At least 6 characters'); return; }
    setPwSaving(true);
    setPwMsg('');
    try {
      await api.setUserPassword(coachId, pwValue);
      setPwMsg('Password updated.');
      setPwValue('');
      setTimeout(() => { setPwForId(null); setPwMsg(''); }, 1500);
    } catch (e: any) {
      setPwMsg(e?.message || 'Could not update password');
    } finally {
      setPwSaving(false);
    }
  };

  // Per-coach inline "Edit name" — admin edits another coach's display name.
  const [nameForId, setNameForId] = useState<string | null>(null);
  const [nameFirst, setNameFirst] = useState('');
  const [nameLast, setNameLast] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  /* ── Pause / remove / change email (admin) ── */
  const [pausedOpen, setPausedOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [emailForId, setEmailForId] = useState<string | null>(null);
  const [emailValue, setEmailValue] = useState('');

  const flash = (id: string, text: string, ok: boolean) => {
    setRowMsg({ id, text, ok });
    window.setTimeout(() => setRowMsg((m) => (m && m.id === id && m.text === text ? null : m)), 2600);
  };

  const setPaused = async (c: api.CoachAccount, paused: boolean) => {
    setBusyId(c.id);
    try {
      await api.setCoachStatus(c.id, paused ? 'LOCKED' : 'ACTIVE');
      await loadCoaches();
      flash(c.id, paused ? 'Paused — they can’t sign in.' : 'Unpaused.', true);
    } catch (e: any) {
      flash(c.id, e?.message || 'Could not update', false);
    } finally {
      setBusyId(null);
    }
  };

  const removeCoach = async (c: api.CoachAccount) => {
    setBusyId(c.id);
    try {
      await api.deleteCoach(c.id);
      setConfirmDeleteId(null);
      await loadCoaches();
    } catch (e: any) {
      flash(c.id, e?.message || 'Could not delete', false);
    } finally {
      setBusyId(null);
    }
  };

  const saveEmail = async (c: api.CoachAccount) => {
    setBusyId(c.id);
    try {
      await api.setUserEmail(c.id, emailValue.trim());
      setEmailForId(null);
      await loadCoaches();
      flash(c.id, 'Email updated.', true);
    } catch (e: any) {
      flash(c.id, e?.message || 'Could not update email', false);
    } finally {
      setBusyId(null);
    }
  };

  /* ── Invite by email ── */
  const [invFirst, setInvFirst] = useState('');
  const [invLast, setInvLast] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invLevel, setInvLevel] = useState<'ADMIN' | 'COACH' | 'VIEWER'>('COACH');
  const [inviting, setInviting] = useState(false);
  const [invMsg, setInvMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvMsg(null);
    const em = invEmail.trim();
    if (!em) { setInvMsg({ text: 'Email is required', ok: false }); return; }
    setInviting(true);
    try {
      const name = [invFirst.trim(), invLast.trim()].filter(Boolean).join(' ') || undefined;
      const res = await api.inviteCoach({ email: em, name, coachLevel: invLevel });
      setInvMsg(res.emailed
        ? { text: `Invite sent to ${res.email}. They'll set their own password from the email.`, ok: true }
        : { text: `Account created for ${res.email}, but the email could not be sent. Use "Set password" on their row instead.`, ok: false });
      setInvFirst(''); setInvLast(''); setInvEmail(''); setInvLevel('COACH');
      loadCoaches();
    } catch (err: any) {
      setInvMsg({ text: err?.message || 'Could not send the invite', ok: false });
    } finally {
      setInviting(false);
    }
  };

  const saveName = async (coachId: string) => {
    setNameSaving(true);
    setNameMsg('');
    try {
      await api.setUserName(coachId, [nameFirst.trim(), nameLast.trim()].filter(Boolean).join(' '));
      setNameMsg('Name updated.');
      loadCoaches();
      setTimeout(() => { setNameForId(null); setNameMsg(''); }, 1200);
    } catch (e: any) {
      setNameMsg(e?.message || 'Could not update name');
    } finally {
      setNameSaving(false);
    }
  };

  const loadCoaches = async () => {
    try {
      setCoaches(await api.getCoaches());
    } catch {
      /* non-critical — the create form still works without the list */
    } finally {
      setLoadingCoaches(false);
    }
  };
  useEffect(() => { loadCoaches(); }, []);

  const activeCoaches = coaches.filter((c) => c.status !== 'LOCKED');
  const pausedCoaches = coaches.filter((c) => c.status === 'LOCKED');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const em = email.trim();
    if (!em) { setError('Email is required'); return; }
    if (!password.trim()) { setError('Create Password to Continue'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      const coachName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || undefined;
      await api.register(em, password, 'COACH', level, coachName);
      setSuccess(`${LEVEL_LABEL[level]} account created for ${em}. They can sign in now with this email + password.`);
      setFirstName('');
      setLastName('');
      setEmail('');
      setPassword('');
      setConfirm('');
      setLevel('COACH');
      loadCoaches();
    } catch (err: any) {
      setError(err?.message || 'Failed to create coach account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.section}>
      {/* Invite by email: the coach sets their own password from the link. */}
      <form className={styles.card} onSubmit={sendInvite} autoComplete="off">
        <h3 className={styles.cardTitle}>Invite coach by email</h3>
        <p className={styles.cardDesc}>We create their account and email them a link to set their own password (good for 7 days).</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>First name</span></div>
          <input className={styles.input} type="text" value={invFirst} onChange={(e) => setInvFirst(e.target.value)} placeholder="First name" autoComplete="off" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Last name</span></div>
          <input className={styles.input} type="text" value={invLast} onChange={(e) => setInvLast(e.target.value)} placeholder="Last name" autoComplete="off" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Email</span><span className={styles.rowSub}>Where the invite goes, and their login</span></div>
          <input className={styles.input} type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="coach@example.com" autoComplete="off" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Access level</span></div>
          <select className={styles.input} value={invLevel} onChange={(e) => setInvLevel(e.target.value as 'ADMIN' | 'COACH' | 'VIEWER')}>
            <option value="ADMIN">Admin</option>
            <option value="COACH">Coach</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </div>
        {invMsg && (
          <div className={`${styles.feedback} ${invMsg.ok ? styles.feedbackOk : ''}`} style={invMsg.ok ? undefined : { color: '#E11D48' }}>{invMsg.text}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className={styles.btn} type="submit" disabled={inviting}>{inviting ? 'Sending…' : 'Send Invite'}</button>
        </div>
      </form>

      <form className={styles.card} onSubmit={handleCreate} autoComplete="off">
        <h3 className={styles.cardTitle}>Create coach account</h3>
        <p className={styles.cardDesc}>Add another coach to the facility. They sign in at the login page with the email + password you set here.</p>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>First name</span>
            <span className={styles.rowSub}>Optional — shown in place of their email</span>
          </div>
          <input className={styles.input} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Connor" autoComplete="off" />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Last name</span>
          </div>
          <input className={styles.input} type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Olson" autoComplete="off" />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Email</span>
            <span className={styles.rowSub}>Login email for the new coach</span>
          </div>
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="coach@example.com"
            autoComplete="off"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Password</span>
            <span className={styles.rowSub}>At least 6 characters</span>
          </div>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="new-password"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Confirm password</span>
            <span className={styles.rowSub}>Re-enter the password</span>
          </div>
          <input
            className={styles.input}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Access level</span>
            <span className={styles.rowSub}>Admin manages coach accounts &amp; approvals · Coach edits players, data &amp; schedules · Viewer is read-only</span>
          </div>
          <select
            className={styles.input}
            value={level}
            onChange={(e) => setLevel(e.target.value as 'ADMIN' | 'COACH' | 'VIEWER')}
          >
            <option value="ADMIN">Admin</option>
            <option value="COACH">Coach</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </div>

        {error && <div className={styles.feedback} style={{ color: '#E11D48' }}>{error}</div>}
        {success && <div className={`${styles.feedback} ${styles.feedbackOk}`}>{success}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className={styles.btn} type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Coach Account'}
          </button>
        </div>
      </form>

      <div className={styles.card} style={{ order: -1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 className={styles.cardTitle}>Coaches</h3>
            <p className={styles.cardDesc}>Everyone with a coach login.</p>
          </div>
          {/* Paused coaches live behind this lock until unpaused. */}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setPausedOpen((o) => !o)}
            aria-expanded={pausedOpen}
            title="Paused coach accounts"
          >
            🔒 Paused ({pausedCoaches.length})
          </button>
        </div>
        {pausedOpen && (
          <div className={styles.pausedPanel}>
            {pausedCoaches.length === 0 ? (
              <div className={styles.rowSub}>No paused coaches.</div>
            ) : pausedCoaches.map((c) => (
              <div key={c.id} className={styles.row}>
                <div className={styles.rowLabel}>
                  <span className={styles.rowTitle}>{c.name || c.email.split('@')[0]}</span>
                  <span className={styles.rowSub}>{c.email} · Paused — can’t sign in</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {rowMsg?.id === c.id && (
                    <span className={styles.rowSub} style={{ color: rowMsg.ok ? '#34D399' : '#E11D48' }}>{rowMsg.text}</span>
                  )}
                  <button type="button" className={styles.btn} disabled={busyId === c.id} onClick={() => void setPaused(c, false)}>
                    {busyId === c.id ? '…' : 'Unpause'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {loadingCoaches ? (
          <div className={styles.rowSub}>Loading…</div>
        ) : activeCoaches.length === 0 ? (
          <div className={styles.rowSub}>No coach accounts yet.</div>
        ) : (
          activeCoaches.map((c) => {
            /* The primary admin's password is self-only (enforced
               server-side too) — hide the control for everyone else. */
            const canSetPw = !c.isPrimaryAdmin || c.id === me?.id;
            /* Pause / delete: never yourself, never the primary admin
               (both enforced server-side too). */
            const manageable = c.id !== me?.id && !c.isPrimaryAdmin;
            const canSetEmail = !c.isPrimaryAdmin || c.id === me?.id;
            return (
              <div key={c.id}>
                <div className={`${styles.row} ${styles.staffRow}`}>
                  <div className={styles.rowLabel}>
                    <span className={styles.rowTitle}>
                      {c.name || c.email.split('@')[0]}
                      {c.isPrimaryAdmin && (
                        <span style={{
                          marginLeft: 8, fontSize: rem(9), fontWeight: 700,
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: '#3d8bfd', border: '1px solid rgba(61,139,253,0.4)',
                          borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle',
                        }}>
                          Primary Admin
                        </span>
                      )}
                    </span>
                    <span className={styles.rowSub}>
                      {c.email}{c.position ? ` · ${c.position}` : ''} · Added {new Date(c.createdAt).toLocaleDateString(undefined, tzOpt())}
                    </span>
                  </div>
                  <div className={styles.staffActions}>
                    {/* Access level — admin can change any coach except the
                        primary admin (who can only be changed by themselves). */}
                    <select
                      className={styles.input}
                      style={{ maxWidth: 120, padding: '6px 8px' }}
                      value={c.coachLevel || 'ADMIN'}
                      disabled={c.isPrimaryAdmin && c.id !== me?.id}
                      onChange={(e) => changeLevel(c.id, e.target.value as 'ADMIN' | 'COACH' | 'VIEWER')}
                      title="Access level"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="COACH">Coach</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    {canSetPw && (
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => {
                          setPwForId(pwForId === c.id ? null : c.id);
                          setPwValue('');
                          setPwMsg('');
                        }}
                      >
                        {pwForId === c.id ? 'Cancel' : 'Set password'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => {
                        setNameForId(nameForId === c.id ? null : c.id);
                        const parts = (c.name || '').trim().split(/\s+/);
                        setNameFirst(parts[0] || '');
                        setNameLast(parts.slice(1).join(' '));
                        setNameMsg('');
                      }}
                    >
                      {nameForId === c.id ? 'Cancel' : 'Edit name'}
                    </button>
                    {canSetEmail && (
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => {
                          setEmailForId(emailForId === c.id ? null : c.id);
                          setEmailValue(c.email);
                        }}
                      >
                        {emailForId === c.id ? 'Cancel' : 'Edit email'}
                      </button>
                    )}
                    {manageable && (
                      <>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => void setPaused(c, true)}
                          disabled={busyId === c.id}
                          title={`Pause ${c.name || c.email} — they can't sign in until unpaused`}
                          aria-label={`Pause ${c.name || c.email}`}
                        >🔒</button>
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => setConfirmDeleteId(confirmDeleteId === c.id ? null : c.id)}
                          disabled={busyId === c.id}
                          title={`Delete ${c.name || c.email} permanently`}
                          aria-label={`Delete ${c.name || c.email}`}
                        >×</button>
                      </>
                    )}
                  </div>
                </div>
                {rowMsg?.id === c.id && (
                  <div className={styles.rowSub} style={{ padding: '0 0 10px', color: rowMsg.ok ? '#34D399' : '#E11D48' }}>{rowMsg.text}</div>
                )}
                {confirmDeleteId === c.id && (
                  <div className={styles.deleteConfirm}>
                    <span>
                      Delete <strong>{c.name || c.email}</strong> permanently? Their account, posts, messages and
                      notifications are erased. Athletes&rsquo; reports and at-bats they recorded stay with the athletes.
                    </span>
                    <span style={{ display: 'inline-flex', gap: 8 }}>
                      <button type="button" className={styles.btnDanger} disabled={busyId === c.id} onClick={() => void removeCoach(c)}>
                        {busyId === c.id ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button type="button" className={styles.btnSecondary} onClick={() => setConfirmDeleteId(null)}>No</button>
                    </span>
                  </div>
                )}
                {emailForId === c.id && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0 12px', flexWrap: 'wrap' }}>
                    <input
                      className={styles.input}
                      type="email"
                      value={emailValue}
                      onChange={(e) => setEmailValue(e.target.value)}
                      placeholder="coach@example.com"
                      autoComplete="off"
                      style={{ maxWidth: 280 }}
                    />
                    <button type="button" className={styles.btn} disabled={busyId === c.id} onClick={() => void saveEmail(c)}>
                      {busyId === c.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
                {pwForId === c.id && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0 12px', flexWrap: 'wrap' }}>
                    <input
                      className={styles.input}
                      type="password"
                      value={pwValue}
                      onChange={(e) => setPwValue(e.target.value)}
                      placeholder="New password (min 6 chars)"
                      autoComplete="new-password"
                      style={{ maxWidth: 260 }}
                    />
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={pwSaving}
                      onClick={() => void savePassword(c.id)}
                    >
                      {pwSaving ? 'Saving…' : 'Save'}
                    </button>
                    {pwMsg && (
                      <span className={styles.rowSub} style={pwMsg === 'Password updated.' ? { color: '#34D399' } : { color: '#E11D48' }}>
                        {pwMsg}
                      </span>
                    )}
                  </div>
                )}
                {nameForId === c.id && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0 12px', flexWrap: 'wrap' }}>
                    <input className={styles.input} type="text" value={nameFirst} onChange={(e) => setNameFirst(e.target.value)} placeholder="First name" autoComplete="off" style={{ maxWidth: 160 }} />
                    <input className={styles.input} type="text" value={nameLast} onChange={(e) => setNameLast(e.target.value)} placeholder="Last name" autoComplete="off" style={{ maxWidth: 160 }} />
                    <button type="button" className={styles.btn} disabled={nameSaving} onClick={() => void saveName(c.id)}>
                      {nameSaving ? 'Saving…' : 'Save'}
                    </button>
                    {nameMsg && (
                      <span className={styles.rowSub} style={nameMsg === 'Name updated.' ? { color: '#34D399' } : { color: '#E11D48' }}>
                        {nameMsg}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── Notifications ──────────────────────────────────────── */

/* Delivery channels (the three "bubbles") + the role-specific subjects.
   Subject keys MUST match the backend notification `type` so the App-channel
   toggle actually gates in-app notifications. Email/Phone are saved but not
   delivered yet (no provider until go-live). */
const NOTIF_CHANNELS: { key: keyof api.NotifChannelPrefs; label: string; sub: string }[] = [
  { key: 'app', label: 'App', sub: 'In-app bell notifications' },
  { key: 'email', label: 'Email', sub: 'Your login email' },
];
const NOTIF_CHANNEL_DEFAULTS: api.NotifChannelPrefs = { app: true, email: true, phone: false };
const NOTIF_SUBJECTS_PLAYER = [
  { key: 'ANNOUNCEMENT', label: 'Dashboard Announcements' },
  { key: 'SCHEDULE', label: 'Training Schedule Updates' },
  { key: 'REPORT', label: 'New Reports' },
  { key: 'VIDEO', label: 'New Videos' },
  { key: 'COACH_REVIEW', label: 'Coach Reviews' },
];
const NOTIF_SUBJECTS_COACH = [
  { key: 'ANNOUNCEMENT', label: 'Dashboard Posts' },
  { key: 'ACCOUNT_REQUEST', label: 'Account Creation Requests' },
  { key: 'VIDEO', label: 'Athlete Video Uploads' },
  { key: 'INQUIRY', label: 'New Inquiries' },
  { key: 'MESSAGE', label: 'New Messages' },
  { key: 'PROFILE_UPDATE', label: 'Athlete Profile & Stats Updates' },
];
/* Subjects with LIVE email delivery (must match the API's
   EMAIL_DELIVERED_SUBJECTS). Every other subject's Email toggle renders as a
   muted "Soon" so we don't imply delivery that isn't wired yet. */
const EMAIL_DELIVERED_SUBJECTS = new Set(['COACH_REVIEW']);

function NotificationsTab({ isCoach }: { isCoach: boolean }) {
  const subjects = isCoach ? NOTIF_SUBJECTS_COACH : NOTIF_SUBJECTS_PLAYER;
  const [prefs, setPrefs] = useState<api.NotificationPrefs>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getNotificationPrefs()
      .then((p) => setPrefs(p || {}))
      .catch(() => setPrefs({}))
      .finally(() => setLoading(false));
  }, []);

  const isOn = (subject: string, channel: keyof api.NotifChannelPrefs) =>
    prefs[subject]?.[channel] ?? NOTIF_CHANNEL_DEFAULTS[channel];

  const toggle = async (subject: string, channel: keyof api.NotifChannelPrefs) => {
    const current = { ...NOTIF_CHANNEL_DEFAULTS, ...(prefs[subject] || {}) };
    const next: api.NotificationPrefs = {
      ...prefs,
      [subject]: { ...current, [channel]: !current[channel] },
    };
    setPrefs(next);
    setSaved(false);
    try {
      await api.setNotificationPrefs(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch {
      /* keep optimistic state; a reload reconciles with the server */
    }
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.card}><div className={styles.empty}>Loading preferences\u2026</div></div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Notification delivery</h3>
        <p className={styles.cardDesc}>
          Turn each delivery type on or off per subject.
          {saved && <span style={{ marginLeft: 8, color: '#34D399', fontWeight: 600 }}>Saved</span>}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 16,
        }}
      >
        {NOTIF_CHANNELS.map((ch) => (
          <div key={ch.key} className={styles.card}>
            <h3 className={styles.cardTitle}>{ch.label}</h3>
            <p className={styles.cardDesc}>{ch.sub}</p>
            {subjects.map((s) => {
              /* Account requests are mandatory in-app so a coach can never
                 miss a pending player \u2014 lock that one toggle on. */
              const locked = ch.key === 'app' && s.key === 'ACCOUNT_REQUEST';
              /* Email delivery is wired for Coach Reviews only right now \u2014 every
                 other subject's Email toggle shows "Soon" instead of a switch. */
              const emailNotWired = ch.key === 'email' && !EMAIL_DELIVERED_SUBJECTS.has(s.key);
              const on = locked || isOn(s.key, ch.key);
              return (
                <div key={s.key} className={styles.row}>
                  <div className={styles.rowLabel}>
                    <span className={styles.rowTitle}>{s.label}</span>
                    {locked && <span className={styles.rowSub}>Always on \u00b7 required</span>}
                  </div>
                  {emailNotWired ? (
                    <span
                      className={styles.rowSub}
                      title="Email delivery for this notification is coming soon"
                      style={{ opacity: 0.7 }}
                    >
                      Soon
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={locked}
                      aria-label={`${ch.label} \u2014 ${s.label}${locked ? ' (required)' : ''}`}
                      title={locked ? 'Account requests are always on so you never miss one' : undefined}
                      className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
                      style={locked ? { opacity: 0.65, cursor: 'not-allowed' } : undefined}
                      onClick={() => { if (!locked) toggle(s.key, ch.key); }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Data & Integrations ────────────────────────────────── */

/* Data & Integrations is now a contact hub: the sales rep for each
   technology the academy uses, shared by every coach. Data files are
   uploaded on each report (its Upload button), and Data Analytics lives
   in the sidebar. */
function DataTab(_props: { isCoach: boolean }) {
  const [contacts, setContacts] = useState<api.VendorContact[] | null>(null);
  const [draft, setDraft] = useState<api.VendorContact[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getVendorContacts()
      .then(setContacts)
      .catch((e) => { setContacts([]); setError(e?.message || 'Could not load contacts'); });
  }, []);

  const editing = draft !== null;
  const rows = draft ?? contacts ?? [];

  const setField = (source: string, field: 'contactName' | 'contactEmail' | 'contactPhone', value: string) => {
    setDraft((d) => (d ? d.map((c) => (c.source === source ? { ...c, [field]: value } : c)) : d));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const next = await api.saveVendorContacts(draft.map(({ source, contactName, contactEmail, contactPhone }) => ({
        source, contactName, contactEmail, contactPhone,
      })));
      setContacts(next);
      setDraft(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Could not save contacts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 className={styles.cardTitle}>Supported Sources</h3>
            <p className={styles.cardDesc} style={{ marginBottom: 0 }}>
              Sales rep contacts for each technology we use.
              {saved && <span style={{ marginLeft: 8, color: '#34D399', fontWeight: 600 }}>Saved</span>}
            </p>
          </div>
          {contacts && (editing ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={styles.btnSecondary} onClick={() => { setDraft(null); setError(''); }} disabled={saving}>Cancel</button>
              <button className={styles.btn} onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          ) : (
            <button className={styles.btnSecondary} onClick={() => setDraft(contacts.map((c) => ({ ...c })))}>Edit</button>
          ))}
        </div>

        {error && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div>}

        {contacts === null ? (
          <div className={styles.empty}>Loading…</div>
        ) : (
          <div className={styles.vendorTable} role="table" aria-label="Technology contacts">
            <div className={`${styles.vendorRow} ${styles.vendorHead}`} role="row">
              <span role="columnheader">Source</span>
              <span role="columnheader">Source Contact</span>
              <span role="columnheader">Contact Email</span>
              <span role="columnheader">Contact Phone</span>
            </div>
            {rows.map((c) => (
              <div key={c.source} className={styles.vendorRow} role="row">
                <span role="cell" className={styles.vendorSource}>{c.label}</span>
                {editing ? (
                  <>
                    <input className={styles.input} aria-label={`${c.label} contact name`} value={c.contactName}
                      onChange={(e) => setField(c.source, 'contactName', e.target.value)} placeholder="Sales rep name" maxLength={100} />
                    <input className={styles.input} type="email" aria-label={`${c.label} contact email`} value={c.contactEmail}
                      onChange={(e) => setField(c.source, 'contactEmail', e.target.value)} placeholder="rep@company.com" maxLength={200} />
                    <input className={styles.input} type="tel" aria-label={`${c.label} contact phone`} value={c.contactPhone}
                      onChange={(e) => setField(c.source, 'contactPhone', e.target.value)} placeholder="(555) 123-4567" maxLength={40} />
                  </>
                ) : (
                  <>
                    <span role="cell" data-label="Contact">{c.contactName || <span className={styles.rowSub}>—</span>}</span>
                    <span role="cell" data-label="Email">
                      {c.contactEmail ? <a href={`mailto:${c.contactEmail}`} className={styles.vendorLink}>{c.contactEmail}</a> : <span className={styles.rowSub}>—</span>}
                    </span>
                    <span role="cell" data-label="Phone">
                      {c.contactPhone ? <a href={`tel:${c.contactPhone.replace(/[^\d+]/g, '')}`} className={styles.vendorLink}>{c.contactPhone}</a> : <span className={styles.rowSub}>—</span>}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Teams & Colleges (COACH) ───────────────────────────── */

function TeamsAndCollegesTab() {
  return (
    <div className={styles.section}>
      <EntityCrudCard
        kind="clubTeam"
        title="Club Teams"
        description="Teams coaches can pick from when filling out a player's report. Logo and website are optional."
        addLabel="Add Club Team"
      />
      <EntityCrudCard
        kind="college"
        title="Colleges"
        description="Schools that appear as commitment options on player profiles."
        addLabel="Add College"
      />
    </div>
  );
}

type EntityKind = 'clubTeam' | 'college';
type EntityRecord = ClubTeam | College;

function EntityCrudCard({
  kind,
  title,
  description,
  addLabel,
}: {
  kind: EntityKind;
  title: string;
  description: string;
  addLabel: string;
}) {
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');

  // Inline form state for add/edit
  const [editingId, setEditingId] = useState<string | null>(null); // null = no form open; 'new' = adding
  const [formName, setFormName] = useState('');
  const [formLogo, setFormLogo] = useState('');
  /* Logo file uploader state — when set, the file's contents win over
     `formLogo` (the URL field) on save. We read the file with
     FileReader → base64 data URL and persist that into the same
     `logoUrl` column on the College / ClubTeam record. */
  const [formLogoFile, setFormLogoFile] = useState<File | null>(null);
  const [formLogoDataUrl, setFormLogoDataUrl] = useState<string | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const [formWebsite, setFormWebsite] = useState('');
  /* Division applies to Colleges only -- Club Teams have no such
     concept, so the picker below is gated on `kind`. Kept as a plain
     string so an unrecognised legacy value survives an edit round-trip
     instead of being silently reset. */
  const [formDivision, setFormDivision] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const list = kind === 'clubTeam' ? await api.getClubTeams() : await api.getColleges();
      setRecords(list);
    } catch (e: any) {
      setError(e?.message || `Failed to load ${title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function openAdd() {
    setEditingId('new');
    setFormName('');
    setFormLogo('');
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
    setFormWebsite('');
    setFormDivision('');
  }

  function openEdit(r: EntityRecord) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormLogo(r.logoUrl || '');
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
    setFormWebsite(r.websiteUrl || '');
    setFormDivision((r as College).division || '');
  }

  function cancel() {
    setEditingId(null);
    setFormName('');
    setFormLogo('');
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
    setFormWebsite('');
    setFormDivision('');
  }

  /* Read the picked logo file into a base64 data URL. Stored in
     `formLogoDataUrl`; on save this value wins over the typed-in
     Logo URL so the file upload takes precedence when both are
     populated. */
  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setFormLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => setFormLogoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => {
      setError('Failed to read file');
      setFormLogoFile(null);
      setFormLogoDataUrl(null);
    };
    reader.readAsDataURL(file);
  }

  function clearLogoFile() {
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
  }

  async function save() {
    const trimmed = formName.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      /* Precedence for the logo column: an uploaded file (read as a
         base64 data URL) overrides any URL typed into the URL field.
         If neither is present, the column is cleared to null. */
      const resolvedLogo =
        formLogoDataUrl
          ? formLogoDataUrl
          : (formLogo.trim() || null);
      const payload: ClubTeamInput | CollegeInput = {
        name: trimmed,
        logoUrl: resolvedLogo,
        websiteUrl: formWebsite.trim() || null,
        /* Colleges only. The ClubTeam DTO has no `division`, so it is
           spread in conditionally rather than always sent as null. */
        ...(kind === 'college' ? { division: formDivision || null } : {}),
      };
      if (editingId === 'new') {
        if (kind === 'clubTeam') await api.createClubTeam(payload);
        else await api.createCollege(payload);
        setFeedback(`${title.replace(/s$/, '')} added.`);
      } else if (editingId) {
        if (kind === 'clubTeam') await api.updateClubTeam(editingId, payload);
        else await api.updateCollege(editingId, payload);
        setFeedback('Saved.');
      }
      cancel();
      await load();
      setTimeout(() => setFeedback(''), 2500);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      if (kind === 'clubTeam') await api.deleteClubTeam(id);
      else await api.deleteCollege(id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  }

  /* One record row. Extracted so the flat (Club Teams) and the
     division-grouped (Colleges) lists render byte-identical rows
     instead of keeping two copies of this markup in sync. */
  const renderRecordRow = (r: EntityRecord) => (
            <div key={r.id} className={styles.row}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {r.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.logoUrl}
                    alt=""
                    style={{
                      width: 36, height: 36, borderRadius: 8, objectFit: 'cover',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border)',
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px dashed var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--muted)', fontSize: rem(13), fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className={styles.rowLabel}>
                  <span className={styles.rowTitle}>{r.name}</span>
                  {r.websiteUrl && (
                    <span className={styles.rowSub}>
                      <a
                        href={r.websiteUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{ color: 'var(--muted)' }}
                      >
                        {r.websiteUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={styles.btnSecondary} onClick={() => openEdit(r)}>Edit</button>
                <button className={styles.btnDanger} onClick={() => remove(r.id, r.name)}>Delete</button>
              </div>
            </div>
  );

  return (
    <div className={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div>
          <h3 className={styles.cardTitle}>{title}</h3>
          <p className={styles.cardDesc} style={{ marginBottom: 0 }}>{description}</p>
        </div>
        {editingId === null && (
          <button className={styles.btn} onClick={openAdd}>+ {addLabel}</button>
        )}
      </div>

      {error && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div>}
      {feedback && <div className={`${styles.feedback} ${styles.feedbackOk}`}>{feedback}</div>}

      {/* Inline add/edit form */}
      {editingId !== null && (
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            marginTop: 6,
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          {/* TOP ROW — Name (full width) */}
          <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
            <label>Name</label>
            <input
              className={styles.input}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={kind === 'clubTeam' ? 'Canes National' : 'University of Florida'}
              autoFocus
            />
          </div>

          {/* MIDDLE ROW — Logo URL + Logo File Upload, side by side.
              When both are populated, the uploaded file wins on save
              (see `resolvedLogo` in the save handler). */}
          <div className={styles.builderField}>
            <label>Logo URL (optional)</label>
            <input
              className={styles.input}
              value={formLogo}
              onChange={(e) => setFormLogo(e.target.value)}
              placeholder="https://..."
              /* Visually de-emphasize the URL field when a file is
                 staged, so it's clear the file takes precedence. */
              style={formLogoFile ? { opacity: 0.55 } : undefined}
            />
          </div>
          <div className={styles.builderField}>
            <label>
              Logo File (optional)
              {formLogoFile && (
                <span style={{
                  marginLeft: 8,
                  fontSize: rem(10),
                  fontWeight: 700,
                  color: 'var(--accent-light, #7eb6ff)',
                  letterSpacing: '0.08em',
                }}>
                  ACTIVE
                </span>
              )}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => logoFileInputRef.current?.click()}
                style={{ flexShrink: 0 }}
              >
                {formLogoFile ? 'Replace file…' : 'Choose file…'}
              </button>
              {formLogoFile ? (
                <>
                  <span style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: rem(12),
                    color: 'var(--text-bright, #ffffff)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }} title={formLogoFile.name}>
                    {formLogoFile.name}
                  </span>
                  <button
                    type="button"
                    className={styles.btnDanger}
                    onClick={clearLogoFile}
                    style={{ flexShrink: 0, padding: '4px 10px', fontSize: rem(11) }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span style={{ fontSize: rem(12), color: 'var(--muted)', opacity: 0.7 }}>
                  No file chosen
                </span>
              )}
              <input
                ref={logoFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleLogoFileChange}
              />
            </div>
          </div>

          {/* THIRD ROW — Website URL (full width) */}
          <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
            <label>Website URL (optional)</label>
            <input
              className={styles.input}
              value={formWebsite}
              onChange={(e) => setFormWebsite(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* FOURTH ROW — Division (Colleges only). Club Teams have no
              governing body, so this whole field is omitted for them and
              the Website row above keeps the full width it always had.
              Blank option = unassigned, which the list groups last. A
              legacy value that is not in COLLEGE_DIVISIONS is preserved
              as an extra option so editing a school can't silently drop
              a division nobody has migrated yet. */}
          {kind === 'college' && (
            <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
              <label>Division (optional)</label>
              <select
                className={styles.select}
                value={formDivision}
                onChange={(e) => setFormDivision(e.target.value)}
              >
                <option value="">— Unassigned —</option>
                {api.COLLEGE_DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
                {formDivision
                  && !(api.COLLEGE_DIVISIONS as readonly string[]).includes(formDivision) && (
                  <option value={formDivision}>{formDivision} (legacy)</option>
                )}
              </select>
            </div>
          )}

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className={styles.btnSecondary} onClick={cancel} disabled={saving}>Cancel</button>
            <button className={styles.btn} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : records.length === 0 ? (
        <div className={styles.empty}>No {title.toLowerCase()} yet. Click "{addLabel}" to create one.</div>
      ) : kind === 'college' ? (
        /* Colleges group into division sections, ordered by
           COLLEGE_DIVISIONS with unassigned schools last. Empty
           divisions render nothing, so the headings that appear are
           only the ones actually in use. */
        <div>
          {api.groupCollegesByDivision(records as College[]).map((section) => (
            <div key={section.division} style={{ marginTop: 14 }}>
              <div
                style={{
                  padding: '0 0 6px', marginBottom: 2,
                  borderBottom: '1px solid var(--border)',
                  fontSize: rem(11), fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-bright, #ffffff)',
                }}
              >
                {section.division}
              </div>
              {section.colleges.map(renderRecordRow)}
            </div>
          ))}
        </div>
      ) : (
        <div>{records.map(renderRecordRow)}</div>
      )}
    </div>
  );
}

/* ─── My Profile (athlete) ─────────────────────────────────────
   The profile's own Edit Profile form -- every field (personal info,
   Goals, Training History / Availability, Other Sports, Injury History,
   rankings ...) -- shown right in the tab, so Settings and the profile
   can never drift apart. */
function MyProfileTab({ playerId }: { playerId: string }) {
  const { user } = useAuth();
  const [player, setPlayer] = useState<api.Player | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getPlayer(playerId)
      .then((p) => setPlayer(p as api.Player))
      .catch((e) => setError(e?.message || 'Failed to load your profile'));
  };
  useEffect(load, [playerId]);

  const userId = (user as any)?.id || (user as any)?.sub || '';

  if (error) {
    return (
      <div className={styles.section}>
        <div className={styles.card}><div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div></div>
      </div>
    );
  }
  if (!player) {
    return (
      <div className={styles.section}>
        <div className={styles.card}><div className={styles.empty}>Loading your profile…</div></div>
      </div>
    );
  }
  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SignOutEverywhereButton />
      </div>
      <ReportModal
        player={player}
        userId={userId}
        initialReportType="SUMMARY"
        profileOnly
        inline
        onClose={() => {}}
        onSaved={load}
      />
    </div>
  );
}
