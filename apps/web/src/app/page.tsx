'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, PostItem, ScheduledDrill } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { MessagesLauncher } from '@/components/MessagesLauncher';
import { RichTextEditor } from '@/components/RichTextEditor';
/* The feed + edit modal now live in the bell's Announcements tab; the
   dashboard keeps only post CREATION, which still needs these two. */
import { POST_TYPES, fileToDataUrl } from '@/components/announcements/AnnouncementFeed';
import { usePlayerProfileData } from './athletes/[id]/usePlayerProfileData';
import styles from './page.module.css';

/* The Player Summary drags in recharts + the whole grades pipeline, and
   only players render it — code-split so a coach's Dashboard never
   downloads it. ssr:false is safe: this page is client-only behind auth. */
const PlayerSummaryTab = nextDynamic(
  () => import('./athletes/[id]/tabs/PlayerSummaryTab').then((m) => m.PlayerSummaryTab),
  {
    ssr: false,
    loading: () => (
      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
        Loading your summary…
      </p>
    ),
  },
);

/* ─── File → data URL helper ─────────────────────────────────────────────
   Used by the Create / Edit Post file-upload inputs. Converts a picked
   `File` into a base64 data URL the form can drop straight into the
   existing `postImageUrl` / `postVideoUrl` string fields without needing
   a server-side upload endpoint. Works in-browser, persists with the
   post payload, and a future upload-to-CDN step can swap the underlying
   transform without changing any caller.

   Caveat: data URLs bloat the row size — large videos (>~25 MB) should
   eventually go through a real upload endpoint. For typical screenshot
   images + short highlight clips it's fine. */


/* ── Helper: get week days (Mon-Sun) ── */
function getCurrentWeekDays(): { label: string; num: number; date: Date; isToday: boolean }[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return labels.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const today = new Date();
    const isToday = d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    return { label, num: d.getDate(), date: d, isToday };
  });
}

/* ── Helper: format date as YYYY-MM-DD ── */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}


const TAB_COLORS: Record<string, string> = {
  HITTING: 'weekDotHitting',
  PITCHING: 'weekDotPitching',
  DEFENSIVE: 'weekDotDefensive',
  WEIGHTROOM: 'weekDotWeightRoom',
};

/* ══════════════════════════════════════════════
   DASHBOARD PAGE
   ══════════════════════════════════════════════ */
export default function DashboardPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [playersError, setPlayersError] = useState(false);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [weekDrills, setWeekDrills] = useState<ScheduledDrill[]>([]);
  const [loading, setLoading] = useState(true);
  /* Bumped by the Player Summary's own refresh callback (e.g. after a
     report is deleted from its selector) to refetch the summary bundle. */
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);

  /* Load the coach roster (drives the stat cards + post-tagging pickers).
     One silent retry absorbs the Render cold-start; on genuine failure we
     flag playersError so the stats show "—" + a Retry, never demo athletes
     masquerading as the real roster. */
  const loadRoster = useCallback(async () => {
    setPlayersError(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const p = await api.getPlayers();
        setPlayers(p.filter((x: Player) => x.positions !== 'COACH'));
        return;
      } catch {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1200)); continue; }
        setPlayers([]);
        setPlayersError(true);
      }
    }
  }, []);

  /* ── Modal state ── */
  const [showModal, setShowModal] = useState(false);
  const [postType, setPostType] = useState<string>('FACILITY_ANNOUNCEMENT');
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postUrgency, setPostUrgency] = useState(false);
  const [postTaggedPlayerId, setPostTaggedPlayerId] = useState('');
  const [postCollegeName, setPostCollegeName] = useState('');
  const [postPosition, setPostPosition] = useState('');
  const [postOrgName, setPostOrgName] = useState('');
  const [postLevel, setPostLevel] = useState('');
  const [postVideoUrl, setPostVideoUrl] = useState('');
  const [postImageUrl, setPostImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
    // NOTE: players are NOT redirected to /profile anymore — the player
    // dashboard below (weekly schedule + announcements + the Messages /
    // Notifications hero bubbles) is their landing page; the sidebar has
    // a separate Profile entry for their own profile.
  }, [isLoading, user, router]);

  /* ── Load dashboard data ── */
  useEffect(() => {
    if (!user) return;

    // Players with a linked playerId don't need coach dashboard data
    if (!isCoach && user.playerId) {
      // Load posts + weekly schedule for player
      const weekDays = getCurrentWeekDays();
      const startDate = fmtDate(weekDays[0].date);
      const endDate = fmtDate(weekDays[6].date);

      Promise.all([
        api.getPosts().catch(() => []),
        api.getScheduledDrills(user.playerId, { startDate, endDate }).catch(() => []),
      ]).then(([p, d]) => {
        setPosts(p);
        setWeekDrills(d);
        setLoading(false);
      });
      return;
    }

    // Roster loads (with its own retry) independently of the feed, so the
    // dashboard paints as soon as posts arrive; the stat cards fill in when
    // the roster resolves. Posts failing just yields an empty feed.
    loadRoster();
    api.getPosts().catch(() => []).then(postsData => {
      setPosts(postsData);
      setLoading(false);
    });
  }, [user, isCoach, loadRoster]);

  /* ── Week data ── */
  const weekDays = useMemo(() => getCurrentWeekDays(), []);

  /* ── Map drills by date ── */
  const drillsByDate = useMemo(() => {
    const map: Record<string, ScheduledDrill[]> = {};
    weekDrills.forEach(d => {
      const key = d.date.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return map;
  }, [weekDrills]);

  /* ── Create post ── */
  const handleCreatePost = useCallback(async () => {
    if (!postTitle.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const newPost = await api.createPost({
        type: postType,
        title: postTitle.trim(),
        body: postBody.trim() || undefined,
        urgency: postUrgency ? 'IMPORTANT' : 'NORMAL',
        taggedPlayerId: postTaggedPlayerId || undefined,
        collegeName: postCollegeName || undefined,
        position: postPosition || undefined,
        organizationName: postOrgName || undefined,
        level: postLevel || undefined,
        videoUrl: postVideoUrl || undefined,
        imageUrl: postImageUrl || undefined,
      });
      setPosts(prev => [newPost, ...prev]);

      // Reset form
      setShowModal(false);
      setPostType('FACILITY_ANNOUNCEMENT');
      setPostTitle('');
      setPostBody('');
      setPostUrgency(false);
      setPostTaggedPlayerId('');
      setPostCollegeName('');
      setPostPosition('');
      setPostOrgName('');
      setPostLevel('');
      setPostVideoUrl('');
      setPostImageUrl('');
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to create post');
    } finally {
      setSubmitting(false);
    }
  }, [postType, postTitle, postBody, postUrgency, postTaggedPlayerId, postCollegeName, postPosition, postOrgName, postLevel, postVideoUrl, postImageUrl]);

  /* Delete + edit handlers moved with the feed into the bell's
     Announcements tab. `posts` is still fetched here because the
     "Pro Signings" stat card counts them. */

  /* ── Player Summary data ──
     A player's Dashboard IS their Player Summary now (Grades/Trends, Tool
     Grades, Upcoming Drills, Videos), so it pulls the same bundle the
     profile page does via the shared hook. Gated to players with a linked
     profile, and `withColleges: false` skips the commitment-logo lookup
     the Dashboard never renders. Hooks can't be called conditionally, so
     this sits above the early returns and no-ops for coaches. */
  const myPlayerId = (user as any)?.playerId as string | undefined;
  const summary = usePlayerProfileData(myPlayerId, {
    enabled: !!user && !isCoach && !!myPlayerId,
    refreshKey: summaryRefreshKey,
    withColleges: false,
  });

  if (isLoading || !user) return null;

  /* ── Player Dashboard ── */
  if (!isCoach && user.playerId) {
    return (
      <div>
        {/* ── Hero ── */}
        <PageHeader
          size="hero"
          eyebrow="Player Dashboard"
          title="Train. Track."
          titleAccent="Improve."
          subtitle="Your weekly schedule and the latest from your coaches."
          readout="Live"
          actions={<MessagesLauncher />}
        />

        {/* ── Content ── */}
        <div className={styles.content}>
          {/* Weekly Schedule replaces stats grid */}
          <WeeklyScheduleStrip weekDays={weekDays} drillsByDate={drillsByDate} />

          {/* ── Player Summary ──
              The four bubbles (Current Grades / Trends, Tool Grades,
              Upcoming Drills, Videos) that used to be a tab on the
              player's profile now live here. `hideHeaderActions` drops
              Edit Profile / Download PDF / the Videos jump — those stay
              on the profile page, which has the modals to serve them.
              The announcement feed moved to the bell's Announcements
              tab (see components/announcements). */}
          {summary.loading ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
              Loading your summary…
            </p>
          ) : summary.player ? (
            <PlayerSummaryTab
              player={summary.player}
              topMetrics={summary.topMetrics}
              progressData={summary.progressData}
              videos={summary.videos}
              reports={summary.reports}
              isCoach={false}
              onRefresh={() => setSummaryRefreshKey((k) => k + 1)}
              hideHeaderActions
            />
          ) : null}
        </div>
      </div>
    );
  }

  /* Players without a linked playerId */
  if (!isCoach) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <h2>Welcome, {user.email}</h2>
        <p style={{ marginTop: 12 }}>Your player profile has not been linked yet. Please contact your coach.</p>
      </div>
    );
  }

  /* ── Coach Dashboard ── */
  const gradYears = new Set(players.map(p => p.gradYear).filter(Boolean));
  const committed = players.filter(p => p.collegeCommit).length;
  const proSignings = posts.filter(p => p.type === 'PRO_SIGNING').length;

  return (
    <div>
      {/* ── Hero ── */}
      <PageHeader
        size="hero"
        eyebrow="Coach Dashboard"
        title="Assess, Train,"
        titleAccent="Perform"
        readout="Live"
        actions={<MessagesLauncher />}
      />

      {/* ── Content ── */}
      <div className={styles.content}>
        {/* Stat KPIs — the three roster-derived cards show "—" (not a scary 0)
            if the roster couldn't load; Pro Signings is posts-derived. */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{playersError ? '—' : players.length}</div>
            <div className={styles.statLabel}>Total Athletes</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{playersError ? '—' : gradYears.size}</div>
            <div className={styles.statLabel}>Grad Years</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{playersError ? '—' : committed}</div>
            <div className={styles.statLabel}>Committed</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{proSignings}</div>
            <div className={styles.statLabel}>Pro Signings</div>
          </div>
        </div>
        {playersError && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
            <span>Couldn&apos;t load the roster.</span>
            <button
              type="button"
              onClick={loadRoster}
              style={{ border: '1px solid var(--accent, #3d8bfd)', color: 'var(--accent, #3d8bfd)', background: 'transparent', borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* The announcement feed moved to the notification bell's
            Announcements tab — the "+" FAB below still creates posts. */}
      </div>

      {/* ── FAB (Coach only) ── */}
      <button className={styles.fab} onClick={() => setShowModal(true)} title="Create Post">
        +
      </button>

      {/* ── Create Post Modal ── */}
      {showModal && (
        <CreatePostModal
          players={players}
          postType={postType}
          setPostType={setPostType}
          postTitle={postTitle}
          setPostTitle={setPostTitle}
          postBody={postBody}
          setPostBody={setPostBody}
          postUrgency={postUrgency}
          setPostUrgency={setPostUrgency}
          postTaggedPlayerId={postTaggedPlayerId}
          setPostTaggedPlayerId={setPostTaggedPlayerId}
          postCollegeName={postCollegeName}
          setPostCollegeName={setPostCollegeName}
          postPosition={postPosition}
          setPostPosition={setPostPosition}
          postOrgName={postOrgName}
          setPostOrgName={setPostOrgName}
          postLevel={postLevel}
          setPostLevel={setPostLevel}
          postVideoUrl={postVideoUrl}
          setPostVideoUrl={setPostVideoUrl}
          postImageUrl={postImageUrl}
          setPostImageUrl={setPostImageUrl}
          submitting={submitting}
          submitError={submitError}
          onSubmit={handleCreatePost}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Editing a post now happens in the bell's Announcements tab, which
          owns the feed and hosts EditPostModal. */}
    </div>
  );
}

/* ══════════════════════════════════════════════
   WEEKLY SCHEDULE STRIP
   ══════════════════════════════════════════════ */
function WeeklyScheduleStrip({
  weekDays,
  drillsByDate,
}: {
  weekDays: { label: string; num: number; date: Date; isToday: boolean }[];
  drillsByDate: Record<string, ScheduledDrill[]>;
}) {
  return (
    <div className={styles.weekStrip}>
      {weekDays.map(day => {
        const dateKey = fmtDate(day.date);
        const drills = drillsByDate[dateKey] || [];
        // Get unique tabs for the dot indicators
        const tabs = [...new Set(drills.map(d => d.tab.toUpperCase()))];

        return (
          <div
            key={day.label}
            className={`${styles.weekDay} ${day.isToday ? styles.weekDayToday : ''}`}
          >
            <span className={styles.weekDayLabel}>{day.label}</span>
            <span className={styles.weekDayNum}>{day.num}</span>
            <div className={styles.weekDayDots}>
              {tabs.map(tab => (
                <span
                  key={tab}
                  className={`${styles.weekDot} ${styles[TAB_COLORS[tab] || 'weekDotHitting']}`}
                />
              ))}
            </div>
            {day.isToday && <span className={styles.weekDayTodayLabel}>Today</span>}
          </div>
        );
      })}
    </div>
  );
}


/* ══════════════════════════════════════════════
   CREATE POST MODAL
   ══════════════════════════════════════════════ */
function CreatePostModal({
  players,
  postType, setPostType,
  postTitle, setPostTitle,
  postBody, setPostBody,
  postUrgency, setPostUrgency,
  postTaggedPlayerId, setPostTaggedPlayerId,
  postCollegeName, setPostCollegeName,
  postPosition, setPostPosition,
  postOrgName, setPostOrgName,
  postLevel, setPostLevel,
  postVideoUrl, setPostVideoUrl,
  postImageUrl, setPostImageUrl,
  submitting,
  submitError,
  onSubmit,
  onClose,
}: {
  players: Player[];
  postType: string;
  setPostType: (v: string) => void;
  postTitle: string;
  setPostTitle: (v: string) => void;
  postBody: string;
  setPostBody: (v: string) => void;
  postUrgency: boolean;
  setPostUrgency: (v: boolean) => void;
  postTaggedPlayerId: string;
  setPostTaggedPlayerId: (v: string) => void;
  postCollegeName: string;
  setPostCollegeName: (v: string) => void;
  postPosition: string;
  setPostPosition: (v: string) => void;
  postOrgName: string;
  setPostOrgName: (v: string) => void;
  postLevel: string;
  setPostLevel: (v: string) => void;
  postVideoUrl: string;
  setPostVideoUrl: (v: string) => void;
  postImageUrl: string;
  setPostImageUrl: (v: string) => void;
  submitting: boolean;
  submitError: string;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const needsPlayer = ['ATHLETE_HIGHLIGHT', 'COLLEGE_COMMITMENT', 'PRO_SIGNING'].includes(postType);
  const isCommitment = postType === 'COLLEGE_COMMITMENT';
  const isProSigning = postType === 'PRO_SIGNING';

  return (
    <div className={styles.modalOverlay} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Create Post</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          {/* ── Type Selector ── */}
          <div className={styles.typeSelector}>
            {POST_TYPES.map(t => (
              <button
                key={t.value}
                className={`${styles.typeBtn} ${postType === t.value ? styles.typeBtnActive : ''}`}
                onClick={() => setPostType(t.value)}
              >
                <span className={styles.typeIcon}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Title ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Title</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="Post title..."
              value={postTitle}
              onChange={e => setPostTitle(e.target.value)}
            />
          </div>

          {/* ── Body (Rich Text) ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Body (optional)</label>
            <RichTextEditor
              value={postBody}
              onChange={setPostBody}
              placeholder="Write your announcement..."
              minHeight={110}
            />
          </div>

          {/* ── Tagged Player (for Highlight, Commitment, Pro Signing) ── */}
          {needsPlayer && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Tagged Athlete</label>
              <select
                className={`${styles.fieldInput} ${styles.fieldSelect}`}
                value={postTaggedPlayerId}
                onChange={e => setPostTaggedPlayerId(e.target.value)}
              >
                <option value="">Select athlete...</option>
                {players.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} {p.gradYear ? `(${p.gradYear})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── College Commitment fields ── */}
          {isCommitment && (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>College / University</label>
                <input
                  type="text"
                  className={styles.fieldInput}
                  placeholder="e.g. University of Texas"
                  value={postCollegeName}
                  onChange={e => setPostCollegeName(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Position</label>
                <input
                  type="text"
                  className={styles.fieldInput}
                  placeholder="e.g. RHP, SS, OF"
                  value={postPosition}
                  onChange={e => setPostPosition(e.target.value)}
                />
              </div>
            </>
          )}

          {/* ── Pro Signing fields ── */}
          {isProSigning && (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Organization</label>
                <input
                  type="text"
                  className={styles.fieldInput}
                  placeholder="e.g. Houston Astros"
                  value={postOrgName}
                  onChange={e => setPostOrgName(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Level</label>
                <select
                  className={`${styles.fieldInput} ${styles.fieldSelect}`}
                  value={postLevel}
                  onChange={e => setPostLevel(e.target.value)}
                >
                  <option value="">Select level...</option>
                  <option value="MLB">MLB</option>
                  <option value="MiLB">MiLB</option>
                  <option value="Independent">Independent</option>
                </select>
              </div>
            </>
          )}

          {/* ── Video — URL OR File upload ──
              Both inputs write into the same `postVideoUrl` state, so
              whichever the user fills last wins. File uploads are
              encoded as base64 data URLs via `fileToDataUrl`, which
              persists in the existing string field with no backend
              changes. */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Video (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="Paste a video URL (https://...)"
              value={postVideoUrl}
              onChange={e => setPostVideoUrl(e.target.value)}
            />
            <input
              type="file"
              accept="video/*"
              className={styles.fileInput}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                setPostVideoUrl(dataUrl);
              }}
            />
          </div>

          {/* ── Image — URL OR File upload (same dual-input pattern) ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Image (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="Paste an image URL (https://...)"
              value={postImageUrl}
              onChange={e => setPostImageUrl(e.target.value)}
            />
            <input
              type="file"
              accept="image/*"
              className={styles.fileInput}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                setPostImageUrl(dataUrl);
              }}
            />
          </div>

          {/* ── Urgency ── */}
          <div className={styles.urgencyToggle}>
            <input
              type="checkbox"
              id="urgency"
              className={styles.urgencyCheckbox}
              checked={postUrgency}
              onChange={e => setPostUrgency(e.target.checked)}
            />
            <label htmlFor="urgency" className={styles.urgencyLabel}>
              Mark as Important
            </label>
          </div>

          {/* ── Submit ── */}
          {submitError && <div className={styles.errorMsg}>{submitError}</div>}
          <button
            className={styles.submitBtn}
            disabled={submitting || !postTitle.trim()}
            onClick={onSubmit}
          >
            {submitting ? 'Creating...' : 'Create Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

