'use client';

import { rem } from '@/lib/rem';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ClubTeam, College, ClubTeamInput, CollegeInput } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

import { getAllCameraLabels, setCameraLabel } from '@/lib/camera-labels';

type TabKey = 'account' | 'notifications' | 'data' | 'teams' | 'cameras' | 'myProfile' | 'staff';

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
    { key: 'notifications', label: 'Notifications' },
    /* Data & Integrations is coach-only — players don't import vendor CSVs.
       Hidden from viewers (read-only). */
    ...(isEditorCoach ? ([{ key: 'data' as TabKey, label: 'Data & Integrations' }]) : []),
    ...(isEditorCoach ? ([{ key: 'teams' as TabKey, label: 'Teams & Colleges' }]) : []),
    /* Admin-only "Staff" tab — create + manage coach accounts and access levels. */
    ...(isAdmin ? ([{ key: 'staff' as TabKey, label: 'Staff' }]) : []),
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
      {tab === 'notifications' && <NotificationsTab isCoach={isCoach} />}
      {tab === 'data' && isEditorCoach && <DataTab isCoach={isCoach} />}
      {tab === 'teams' && isEditorCoach && <TeamsAndCollegesTab />}
      {tab === 'staff' && isAdmin && <StaffTab />}
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
  const [profile, setProfile] = useState<api.AccountProfile | null>(null);
  const [name, setName] = useState('');
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
        setName(p.name || '');
        setPhone(p.phone || '');
        setPosition(p.position || '');
      })
      .catch(() => { /* fall back to session values below */ });
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      const updated = await api.updateAccount({
        name,
        phone,
        ...(isCoach ? { position } : {}),
      });
      setProfile(updated);
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
            <span className={styles.rowSub}>Your login email (cannot be changed here)</span>
          </div>
          <span className={styles.rowSub}>{user.email}</span>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Role</span>
          </div>
          <span className={styles.rowSub}>{user.role}{isPrimaryAdmin ? ' · Primary Admin' : ''}</span>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Full name</span>
            <span className={styles.rowSub}>Shown in place of your email where supported</span>
          </div>
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Connor Olson" />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Phone</span>
            <span className={styles.rowSub}>For text notifications once SMS is enabled</span>
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const em = email.trim();
    if (!em) { setError('Email is required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      await api.register(em, password, 'COACH', level);
      setSuccess(`${LEVEL_LABEL[level]} account created for ${em}. They can sign in now with this email + password.`);
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
      <form className={styles.card} onSubmit={handleCreate} autoComplete="off">
        <h3 className={styles.cardTitle}>Create coach account</h3>
        <p className={styles.cardDesc}>Add another coach to the facility. They sign in at the login page with the email + password you set here.</p>

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

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Coaches</h3>
        <p className={styles.cardDesc}>Everyone with a coach login.</p>
        {loadingCoaches ? (
          <div className={styles.rowSub}>Loading…</div>
        ) : coaches.length === 0 ? (
          <div className={styles.rowSub}>No coach accounts yet.</div>
        ) : (
          coaches.map((c) => {
            /* The primary admin's password is self-only (enforced
               server-side too) — hide the control for everyone else. */
            const canSetPw = !c.isPrimaryAdmin || c.id === me?.id;
            return (
              <div key={c.id}>
                <div className={styles.row}>
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
                      {c.email}{c.position ? ` · ${c.position}` : ''} · Added {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                  </div>
                </div>
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
  { key: 'email', label: 'Email', sub: 'Your login email \u00b7 delivery coming soon' },
  { key: 'phone', label: 'Phone', sub: 'Text messages \u00b7 delivery coming soon' },
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
  { key: 'COMMITMENT', label: 'College Commitments' },
];

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
              const on = locked || isOn(s.key, ch.key);
              return (
                <div key={s.key} className={styles.row}>
                  <div className={styles.rowLabel}>
                    <span className={styles.rowTitle}>{s.label}</span>
                    {locked && <span className={styles.rowSub}>Always on \u00b7 required</span>}
                  </div>
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`${ch.label} \u2014 ${s.label}${locked ? ' (required)' : ''}`}
                    title={locked ? 'Account requests are always on so you never miss one' : undefined}
                    className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
                    style={locked ? { opacity: 0.65, cursor: 'not-allowed' } : undefined}
                    onClick={() => { if (!locked) toggle(s.key, ch.key); }}
                  />
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

function DataTab({ isCoach }: { isCoach: boolean }) {
  const router = useRouter();
  const sources = [
    { key: 'TRACKMAN', label: 'Trackman', desc: 'Pitching + batted ball (radar)' },
    { key: 'FULL_SWING', label: 'Full Swing', desc: 'Swing mechanics + launch data' },
    { key: 'BLAST_MOTION', label: 'Blast Motion', desc: 'Swing sensor metrics' },
    { key: 'VALD', label: 'VALD', desc: 'Force plate + dynamometer' },
    { key: 'HITTRAX', label: 'HitTrax', desc: 'Indoor cage hit tracking' },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>CSV Upload</h3>
        <p className={styles.cardDesc}>Import vendor CSVs to populate metrics across the app</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className={styles.btn} onClick={() => router.push('/upload')}>Go to Upload</button>
        </div>
      </div>

      {isCoach && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Data Analytics</h3>
          <p className={styles.cardDesc}>
            Build custom charts, bubbles, and percent-increase widgets from imported data.
            Moved to its own workspace with a live chart preview.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className={styles.btn} onClick={() => router.push('/analytics')}>Open Data Analytics</button>
          </div>
        </div>
      )}

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Supported sources</h3>
        <p className={styles.cardDesc}>Vendors whose data the app can ingest today</p>
        {sources.map((s) => (
          <div key={s.key} className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.rowTitle}>{s.label}</span>
              <span className={styles.rowSub}>{s.desc}</span>
            </div>
            <span className={styles.configTag}>CSV</span>
          </div>
        ))}
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
  }

  function openEdit(r: EntityRecord) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormLogo(r.logoUrl || '');
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
    setFormWebsite(r.websiteUrl || '');
  }

  function cancel() {
    setEditingId(null);
    setFormName('');
    setFormLogo('');
    setFormLogoFile(null);
    setFormLogoDataUrl(null);
    setFormWebsite('');
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
      ) : (
        <div>
          {records.map((r) => (
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
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── My Profile (PLAYER self-edit) ──────────────────────── */

const POSITION_CHOICES = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'Utility'];

function MyProfileTab({ playerId }: { playerId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [bats, setBats] = useState('');
  const [throws, setThrows] = useState('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [weightLbs, setWeightLbs] = useState<string>('');
  const [gradYear, setGradYear] = useState<string>('');
  const [birthDate, setBirthDate] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [clubTeam, setClubTeam] = useState('');
  const [collegeCommit, setCollegeCommit] = useState('');

  const [clubTeams, setClubTeams] = useState<ClubTeam[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [p, ct, co] = await Promise.all([
          api.getPlayer(playerId),
          api.getClubTeams().catch(() => [] as ClubTeam[]),
          api.getColleges().catch(() => [] as College[]),
        ]);
        setFirstName(p.firstName || '');
        setLastName(p.lastName || '');
        setPositions((p.positions || '').split(',').map(s => s.trim()).filter(Boolean));
        setBats(p.bats || '');
        setThrows(p.throws || '');
        setHeightInches(p.heightInches != null ? String(p.heightInches) : '');
        setWeightLbs(p.weightLbs != null ? String(p.weightLbs) : '');
        setGradYear(p.gradYear != null ? String(p.gradYear) : '');
        setBirthDate(p.birthDate || '');
        setHighSchool(p.highSchool || '');
        setClubTeam(p.clubTeam || '');
        setCollegeCommit(p.collegeCommit || '');
        setClubTeams(ct);
        setColleges(co);
      } catch (e: any) {
        setError(e?.message || 'Failed to load your profile');
      } finally {
        setLoading(false);
      }
    })();
  }, [playerId]);

  function togglePosition(pos: string) {
    setPositions(cur => cur.includes(pos) ? cur.filter(p => p !== pos) : [...cur, pos]);
  }

  async function save() {
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      await api.updatePlayer(playerId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        positions: positions.join(','),
        bats: bats || null,
        throws: throws || null,
        heightInches: heightInches ? parseInt(heightInches, 10) : null,
        weightLbs: weightLbs ? parseInt(weightLbs, 10) : null,
        gradYear: gradYear ? parseInt(gradYear, 10) : null,
        birthDate: birthDate || null,
        highSchool: highSchool.trim() || null,
        clubTeam: clubTeam || null,
        collegeCommit: collegeCommit || null,
      });
      setFeedback('Profile saved.');
      setTimeout(() => setFeedback(''), 2500);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.card}><div className={styles.empty}>Loading your profile…</div></div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Personal Information</h3>
        <p className={styles.cardDesc}>Update the details that appear on your player profile.</p>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>First name</span>
          </div>
          <input className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Last name</span>
          </div>
          <input className={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Positions</span>
            <span className={styles.rowSub}>Tap all that apply</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: 420 }}>
            {POSITION_CHOICES.map(pos => {
              const active = positions.includes(pos);
              return (
                <button
                  key={pos}
                  type="button"
                  onClick={() => togglePosition(pos)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#000' : 'var(--text)',
                    fontSize: rem(12),
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {pos}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Bats</span></div>
          <select className={styles.select} value={bats} onChange={(e) => setBats(e.target.value)}>
            <option value="">—</option>
            <option value="R">R</option>
            <option value="L">L</option>
            <option value="S">S</option>
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Throws</span></div>
          <select className={styles.select} value={throws} onChange={(e) => setThrows(e.target.value)}>
            <option value="">—</option>
            <option value="R">R</option>
            <option value="L">L</option>
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Height (inches)</span></div>
          <input className={styles.input} type="number" min={48} max={96} value={heightInches} onChange={(e) => setHeightInches(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Weight (lbs)</span></div>
          <input className={styles.input} type="number" min={80} max={400} value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Grad Year</span></div>
          <input className={styles.input} type="number" min={2020} max={2045} value={gradYear} onChange={(e) => setGradYear(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>Birthday</span></div>
          <input className={styles.input} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}><span className={styles.rowTitle}>High School</span></div>
          <input className={styles.input} value={highSchool} onChange={(e) => setHighSchool(e.target.value)} />
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Club Team</h3>
        <p className={styles.cardDesc}>Pick from the list your coaches curated. If yours isn't here, ask your coach to add it in Settings.</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Current club team</span>
          </div>
          <select className={styles.select} value={clubTeam} onChange={(e) => setClubTeam(e.target.value)}>
            <option value="">None</option>
            {clubTeams.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        {clubTeam && !clubTeams.some(c => c.name === clubTeam) && (
          <div className={styles.rowSub} style={{ marginTop: 4 }}>
            Legacy value "{clubTeam}" — pick from the list when your club is added.
          </div>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>College Commitment</h3>
        <p className={styles.cardDesc}>Tell us where you've committed. Leave empty if you're uncommitted.</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Committed to</span>
          </div>
          <select className={styles.select} value={collegeCommit} onChange={(e) => setCollegeCommit(e.target.value)}>
            <option value="">Uncommitted</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        {collegeCommit && !colleges.some(c => c.name === collegeCommit) && (
          <div className={styles.rowSub} style={{ marginTop: 4 }}>
            Legacy value "{collegeCommit}" — pick from the list when your school is added.
          </div>
        )}
      </div>

      <div className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className={styles.btn} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
        {error && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div>}
        {feedback && <div className={`${styles.feedback} ${styles.feedbackOk}`}>{feedback}</div>}
      </div>
    </div>
  );
}
