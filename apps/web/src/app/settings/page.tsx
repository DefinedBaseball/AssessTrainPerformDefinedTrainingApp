'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { ClubTeam, College, ClubTeamInput, CollegeInput } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

type TabKey = 'account' | 'appearance' | 'notifications' | 'data' | 'teams' | 'myProfile';

const ACCENT_CHOICES = [
  { name: 'Gold', value: '#D4AF37' },
  { name: 'Blue', value: '#4682FF' },
  { name: 'Green', value: '#34D399' },
  { name: 'Crimson', value: '#E11D48' },
  { name: 'Violet', value: '#8B5CF6' },
  { name: 'White', value: '#F3F4F6' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading, isCoach, logout } = useAuth();
  const [tab, setTab] = useState<TabKey>('account');

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const playerId: string | null = (user as any)?.playerId || null;

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'account', label: 'Account' },
    ...(!isCoach && playerId ? ([{ key: 'myProfile' as TabKey, label: 'My Profile' }]) : []),
    { key: 'appearance', label: 'Appearance' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'data', label: 'Data & Integrations' },
    ...(isCoach ? ([{ key: 'teams' as TabKey, label: 'Teams & Colleges' }]) : []),
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

      {tab === 'account' && <AccountTab user={user} onLogout={logout} />}
      {tab === 'myProfile' && !isCoach && playerId && <MyProfileTab playerId={playerId} />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'data' && <DataTab isCoach={isCoach} />}
      {tab === 'teams' && isCoach && <TeamsAndCollegesTab />}
    </div>
  );
}

/* ─── Account ──────────────────────────────────────────────── */

function AccountTab({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [displayName, setDisplayName] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('pref_display_name') || '' : '',
  );
  const [feedback, setFeedback] = useState('');

  const save = () => {
    localStorage.setItem('pref_display_name', displayName);
    setFeedback('Saved.');
    setTimeout(() => setFeedback(''), 2000);
  };

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Profile</h3>
        <p className={styles.cardDesc}>Basic account information</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Email</span>
            <span className={styles.rowSub}>{user.email}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Role</span>
            <span className={styles.rowSub}>{user.role}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Display name</span>
            <span className={styles.rowSub}>Shown in place of your email where supported</span>
          </div>
          <input
            className={styles.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Coach Johnson"
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className={styles.btn} onClick={save}>Save</button>
        </div>
        <div className={`${styles.feedback} ${styles.feedbackOk}`}>{feedback}</div>
      </div>

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

/* ─── Appearance ──────────────────────────────────────────── */

function AppearanceTab() {
  const [accent, setAccent] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('pref_accent') || '#D4AF37' : '#D4AF37',
  );
  const [density, setDensity] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('pref_density') || 'comfortable' : 'comfortable',
  );

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    localStorage.setItem('pref_accent', accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('pref_density', density);
  }, [density]);

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Accent color</h3>
        <p className={styles.cardDesc}>Applied to buttons, highlights, and active states</p>
        <div className={styles.swatchRow}>
          {ACCENT_CHOICES.map((c) => (
            <button
              key={c.value}
              className={`${styles.swatch} ${accent === c.value ? styles.swatchActive : ''}`}
              style={{ background: c.value }}
              onClick={() => setAccent(c.value)}
              title={c.name}
              aria-label={c.name}
            />
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Layout density</h3>
        <p className={styles.cardDesc}>Controls spacing across lists and cards</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Density</span>
          </div>
          <select className={styles.select} value={density} onChange={(e) => setDensity(e.target.value)}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
      </div>
    </div>
  );
}

/* ─── Notifications ──────────────────────────────────────── */

function NotificationsTab() {
  const [prefs, setPrefs] = useState(() => {
    if (typeof window === 'undefined') {
      return { newReport: true, newPost: true, weeklyDigest: false, email: true, push: false };
    }
    const raw = localStorage.getItem('pref_notifications');
    return raw ? JSON.parse(raw) : { newReport: true, newPost: true, weeklyDigest: false, email: true, push: false };
  });

  const toggle = (key: string) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    localStorage.setItem('pref_notifications', JSON.stringify(next));
  };

  const rows = [
    { key: 'newReport', title: 'New report posted', sub: 'When a coach publishes a new report for you or your athletes' },
    { key: 'newPost', title: 'New announcement', sub: 'Facility posts, highlights, commitments' },
    { key: 'weeklyDigest', title: 'Weekly digest', sub: 'Summary of the week\u2019s activity every Monday' },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Channels</h3>
        <p className={styles.cardDesc}>How you\u2019d like to receive notifications</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Email</span>
            <span className={styles.rowSub}>Sent to your login email</span>
          </div>
          <button className={`${styles.toggle} ${prefs.email ? styles.toggleOn : ''}`} onClick={() => toggle('email')} />
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Push (mobile)</span>
            <span className={styles.rowSub}>Requires the mobile app</span>
          </div>
          <button className={`${styles.toggle} ${prefs.push ? styles.toggleOn : ''}`} onClick={() => toggle('push')} />
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Events</h3>
        <p className={styles.cardDesc}>Choose what you want to be notified about</p>
        {rows.map((r) => (
          <div key={r.key} className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.rowTitle}>{r.title}</span>
              <span className={styles.rowSub}>{r.sub}</span>
            </div>
            <button
              className={`${styles.toggle} ${prefs[r.key] ? styles.toggleOn : ''}`}
              onClick={() => toggle(r.key)}
            />
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
    setFormWebsite('');
  }

  function openEdit(r: EntityRecord) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormLogo(r.logoUrl || '');
    setFormWebsite(r.websiteUrl || '');
  }

  function cancel() {
    setEditingId(null);
    setFormName('');
    setFormLogo('');
    setFormWebsite('');
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
      const payload: ClubTeamInput | CollegeInput = {
        name: trimmed,
        logoUrl: formLogo.trim() || null,
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
          <div className={styles.builderField}>
            <label>Logo URL (optional)</label>
            <input
              className={styles.input}
              value={formLogo}
              onChange={(e) => setFormLogo(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className={styles.builderField}>
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
                      color: 'var(--muted)', fontSize: 13, fontWeight: 700,
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
                    fontSize: 12,
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
