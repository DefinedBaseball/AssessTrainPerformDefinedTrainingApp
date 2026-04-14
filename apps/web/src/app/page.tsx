'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, PostItem, ScheduledDrill } from '@/lib/api';
import { MOCK_PLAYERS } from '@/lib/mock-data';
import styles from './page.module.css';

/* ── Player Profile (inline) ── */
import PlayerProfilePage from './athletes/[id]/page';

/* ── Helper: format relative time ── */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

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

/* ── Post type config ── */
const POST_TYPES = [
  { value: 'FACILITY_ANNOUNCEMENT', label: 'Facility Announcement', icon: '🏟️' },
  { value: 'ATHLETE_HIGHLIGHT', label: 'Athlete Highlight', icon: '⭐' },
  { value: 'PROGRAM_ANNOUNCEMENT', label: 'Program Announcement', icon: '📋' },
  { value: 'COLLEGE_COMMITMENT', label: 'College Commitment', icon: '🎓' },
  { value: 'PRO_SIGNING', label: 'Pro Signing', icon: '✍️' },
] as const;

const TAG_STYLES: Record<string, string> = {
  FACILITY_ANNOUNCEMENT: 'tagFacility',
  ATHLETE_HIGHLIGHT: 'tagHighlight',
  PROGRAM_ANNOUNCEMENT: 'tagProgram',
  COLLEGE_COMMITMENT: 'tagCommitment',
  PRO_SIGNING: 'tagProSigning',
};

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
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [weekDrills, setWeekDrills] = useState<ScheduledDrill[]>([]);
  const [loading, setLoading] = useState(true);

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

    const promises: Promise<any>[] = [
      api.getPlayers().then(p => {
        const athletes = p.filter((x: Player) => x.positions !== 'COACH');
        return athletes.length > 0 ? athletes : MOCK_PLAYERS;
      }).catch(() => MOCK_PLAYERS),
      api.getPosts().catch(() => []),
    ];

    Promise.all(promises).then(([p, postsData]) => {
      setPlayers(p);
      setPosts(postsData);
      setLoading(false);
    });
  }, [user, isCoach]);

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

  /* ── Delete post ── */
  const handleDeletePost = useCallback(async (id: string) => {
    try {
      await api.deletePost(id);
      setPosts(prev => prev.filter(p => p.id !== id));
    } catch { /* silent */ }
  }, []);

  if (isLoading || !user) return null;

  /* ── Player view: show their own profile ── */
  if (!isCoach && user.playerId) {
    return (
      <div>
        {/* Weekly Schedule Strip */}
        <div style={{ padding: '24px 24px 0' }}>
          <WeeklyScheduleStrip weekDays={weekDays} drillsByDate={drillsByDate} />
        </div>

        {/* Announcement Feed */}
        <div style={{ padding: '24px' }}>
          <AnnouncementFeed
            posts={posts}
            isCoach={false}
            onDelete={handleDeletePost}
          />
        </div>

        {/* Player Profile */}
        <PlayerProfilePage />
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
      <div className={styles.heroOuter}>
        <div className={styles.hero}>
          <div className={styles.heroEyebrow}>Coach Dashboard</div>
          <h1 className={styles.heroTitle}>Assess, Train, Perform</h1>
          <p className={styles.heroSub}>
            Manage your athletes, upload data, and track development.
          </p>
        </div>
      </div>

      {/* ── Content ── */}
      <div className={styles.content}>
        {/* Stat KPIs */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{players.length}</div>
            <div className={styles.statLabel}>Total Athletes</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{gradYears.size}</div>
            <div className={styles.statLabel}>Grad Years</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{committed}</div>
            <div className={styles.statLabel}>Committed</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{proSignings}</div>
            <div className={styles.statLabel}>Pro Signings</div>
          </div>
        </div>

        {/* ── Announcement & Spotlight Feed ── */}
        <AnnouncementFeed
          posts={posts}
          isCoach={isCoach}
          onDelete={handleDeletePost}
        />
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
   ANNOUNCEMENT FEED
   ══════════════════════════════════════════════ */
function AnnouncementFeed({
  posts,
  isCoach,
  onDelete,
}: {
  posts: PostItem[];
  isCoach: boolean;
  onDelete: (id: string) => void;
}) {
  if (posts.length === 0) {
    return (
      <div className={styles.feedSection}>
        <div className={styles.feedHeader}>
          <div className={styles.feedTitle}>
            Announcements & Spotlights
          </div>
        </div>
        <div className={styles.feedEmpty}>
          No announcements yet.
          {isCoach && <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: 'var(--faint)' }}>
            Tap the + button to create one.
          </span>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.feedSection}>
      <div className={styles.feedHeader}>
        <div className={styles.feedTitle}>
          Announcements & Spotlights
          <span className={styles.feedBadge}>{posts.length}</span>
        </div>
      </div>
      <div className={styles.feedList}>
        {posts.map(post => {
          const typeLabel = POST_TYPES.find(t => t.value === post.type)?.label || post.type;
          const tagClass = TAG_STYLES[post.type] || 'tagFacility';

          return (
            <div
              key={post.id}
              className={`${styles.postCard} ${post.urgency === 'IMPORTANT' ? styles.postCardImportant : ''}`}
            >
              <div className={styles.postTop}>
                <div className={styles.postMeta}>
                  <span className={`${styles.postTag} ${styles[tagClass]}`}>
                    {typeLabel}
                  </span>
                  {post.urgency === 'IMPORTANT' && (
                    <span className={styles.postUrgentBadge}>Important</span>
                  )}
                  <span className={styles.postDate}>{timeAgo(post.createdAt)}</span>
                </div>
                {isCoach && (
                  <button
                    className={styles.postDeleteBtn}
                    onClick={() => onDelete(post.id)}
                    title="Delete post"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className={styles.postTitle}>{post.title}</div>
              {post.body && <div className={styles.postBody}>{post.body}</div>}

              <div className={styles.postFooter}>
                <span className={styles.postAuthor}>
                  by {post.author?.email || 'Coach'}
                </span>

                {post.taggedPlayer && (
                  <Link
                    href={`/athletes/${post.taggedPlayer.id}`}
                    className={styles.postPlayerChip}
                  >
                    {post.taggedPlayer.firstName} {post.taggedPlayer.lastName}
                  </Link>
                )}

                {post.type === 'COLLEGE_COMMITMENT' && post.collegeName && (
                  <span className={styles.postCommitInfo}>
                    {post.collegeName}
                    {post.position && ` · ${post.position}`}
                  </span>
                )}

                {post.type === 'PRO_SIGNING' && post.organizationName && (
                  <span className={styles.postProInfo}>
                    {post.organizationName}
                    {post.level && ` · ${post.level}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

          {/* ── Body ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Body (optional)</label>
            <textarea
              className={`${styles.fieldInput} ${styles.fieldTextarea}`}
              placeholder="Write your announcement..."
              value={postBody}
              onChange={e => setPostBody(e.target.value)}
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

          {/* ── Video / Image URL ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Video URL (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="https://..."
              value={postVideoUrl}
              onChange={e => setPostVideoUrl(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Image URL (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="https://..."
              value={postImageUrl}
              onChange={e => setPostImageUrl(e.target.value)}
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
