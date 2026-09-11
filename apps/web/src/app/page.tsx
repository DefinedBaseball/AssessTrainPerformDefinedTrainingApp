'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, PostItem } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { MessagesLauncher } from '@/components/MessagesLauncher';
import { RichTextEditor } from '@/components/RichTextEditor';
/* The feed + edit modal now live in the bell's Announcements tab; the
   dashboard keeps only post CREATION, which still needs these two. */
import {
  POST_TYPES, fileToDataUrl, AnnouncementFeed, EditPostModal, AudiencePicker,
  ATHLETES_TAG, isUrgent,
} from '@/components/announcements/AnnouncementFeed';
import { usePlayerProfileData } from './athletes/[id]/usePlayerProfileData';
import { REPORT_TYPE_TO_TAB } from './athletes/[id]/helpers';
import styles from './page.module.css';

/* Non-breaking space — used as the hero title's placeholder while the
   player's name is still loading, so the <h1> keeps its line box instead
   of collapsing and making the whole bubble resize when the name lands. */
const NBSP = ' ';

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


/* The week-day / date helpers and the per-tab dot colors went away with the
   weekly schedule strip — Upcoming Drills inside the Player Summary is the
   Dashboard's only schedule surface now. */

/* ══════════════════════════════════════════════
   DASHBOARD PAGE
   ══════════════════════════════════════════════ */
export default function DashboardPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  const [players, setPlayers] = useState<Player[]>([]);
  const [playersError, setPlayersError] = useState(false);
  const [posts, setPosts] = useState<PostItem[]>([]);
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
  const [editingPost, setEditingPost] = useState<PostItem | null>(null);
  const [postType, setPostType] = useState<string>('GENERAL');
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postUrgency, setPostUrgency] = useState(false);
  const [postTaggedPlayerId, setPostTaggedPlayerId] = useState('');
  /* Audience — only meaningful on an Athletes Announcement; the service
     forces everything else back to COACHES regardless of what we send. */
  const [postScope, setPostScope] = useState('ALL_PLAYERS');
  const [postAudienceIds, setPostAudienceIds] = useState<string[]>([]);
  const [postProgram, setPostProgram] = useState('');
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

    // Players with a linked playerId don't need coach dashboard data.
    // The week-of-drills fetch went away with the weekly schedule strip —
    // Upcoming Drills inside the Player Summary covers that now.
    if (!isCoach && user.playerId) {
      api.getPosts().catch(() => []).then((p) => {
        setPosts(p);
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

  /* Week-day + drills-by-date derivations retired with the weekly schedule
     strip — the Player Summary's Upcoming Drills bubble is the single
     schedule surface on the Dashboard now. */

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
        urgency: postUrgency ? 'URGENT' : 'NORMAL',
        taggedPlayerId: postTaggedPlayerId || undefined,
        ...(postType === ATHLETES_TAG
          ? {
              audienceScope: postScope as api.PostAudienceScope,
              audiencePlayerIds: postScope === 'INDIVIDUAL' ? postAudienceIds.join(',') : '',
              audienceProgram: postScope === 'PROGRAM' ? postProgram : undefined,
            }
          : {}),
        videoUrl: postVideoUrl || undefined,
        imageUrl: postImageUrl || undefined,
      });
      setPosts(prev => [newPost, ...prev]);

      // Reset form
      setShowModal(false);
      setPostType('GENERAL');
      setPostTitle('');
      setPostBody('');
      setPostUrgency(false);
      setPostTaggedPlayerId('');
      setPostScope('ALL_PLAYERS');
      setPostAudienceIds([]);
      setPostProgram('');
      setPostVideoUrl('');
      setPostImageUrl('');
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to create post');
    } finally {
      setSubmitting(false);
    }
  }, [postTitle, postType, postBody, postUrgency, postTaggedPlayerId,
      postScope, postAudienceIds, postProgram, postVideoUrl, postImageUrl]);

  /* ── Feed handlers ──
     The feed lives on the dashboard again, so edit / delete / flag are
     owned here rather than by the bell. */
  const handleDeletePost = useCallback(async (id: string) => {
    if (!confirm('Delete this post?')) return;
    const prev = posts;
    setPosts(p => p.filter(x => x.id !== id));
    try {
      await api.deletePost(id);
    } catch {
      setPosts(prev);   // put it back rather than lying about the delete
    }
  }, [posts]);

  /* Flag as Seen is per coach, so this only unpins it for ME. Optimistic:
     the row disappears on click and comes back if the write fails. */
  const handleFlagSeen = useCallback(async (id: string) => {
    const prev = posts;
    setPosts(p => p.map(x => (x.id === id ? { ...x, seen: true } : x)));
    try {
      await api.markPostSeen(id);
    } catch {
      setPosts(prev);
    }
  }, [posts]);

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

  /* Which Tool Grades cards to show. `computeAggregateScores` builds its
     sections from the player's POSITIONS, so a two-way / utility athlete
     gets a card for every position they list — including ones they have no
     report for, which renders as an empty card. On the Dashboard we narrow
     that to the sections the player actually has a report for, so Tool
     Grades only shows sections with real data. (The profile's Summary tab
     still follows the tab bar, which stays position-based so a coach can
     open an empty tab to CREATE that first report.) */
  const summaryTabKeys = useMemo(() => {
    const keys = new Set<string>();
    summary.reports.forEach((r) => {
      const key = REPORT_TYPE_TO_TAB[r.reportType];
      if (key) keys.add(key);
    });
    return Array.from(keys);
  }, [summary.reports]);

  if (isLoading || !user) return null;

  /* ── Player Dashboard ── */
  if (!isCoach && user.playerId) {
    /* Hero title is the player's own name, split first / last so the last
       name picks up the accent treatment (same as the profile's megaName).

       The fallback used while the summary bundle is still in flight is the
       ACCOUNT name only — never the email. It used to fall through to
       `user.email.split('@')[0]`, which meant every cold load flashed
       "connor" (or whatever precedes the @) for a beat and then swapped to
       the real name. An email prefix is not a name, so it's not shown at
       all; accounts whose `name` was stored as an email address are caught
       by the `@` test. With no usable fallback we render nothing and let
       the name appear once — the "Player Dashboard" eyebrow still labels
       the bar in the meantime, so it never looks broken. */
    const accountName = (user.name || '').trim();
    const fallbackName = accountName.includes('@') ? '' : accountName;
    const resolvedFirst = summary.player?.firstName || fallbackName.split(/\s+/)[0] || '';
    /* A truly empty <h1> collapses to zero height, so the hero would grow
       when the name lands. The nbsp holds the line box at its full size and
       the bubble never resizes. */
    const heroFirst = resolvedFirst || NBSP;
    const heroLast = summary.player?.lastName || fallbackName.split(/\s+/).slice(1).join(' ');

    return (
      <div className={styles.playerDash}>
        {/* ── Hero ── */}
        <PageHeader
          size="hero"
          eyebrow="Player Dashboard"
          title={heroFirst}
          titleAccent={heroLast}
          actions={<MessagesLauncher />}
        />

        {/* ── Content ── */}
        <div className={`${styles.content} ${styles.playerContent}`}>
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
              visibleTabKeys={summaryTabKeys}
              hideHeaderActions
              dense
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
  const committed = players.filter(p => p.collegeCommit).length;
  /* The old "Pro Signings" card counted posts of a tag that no longer
     exists. Unflagged urgent posts is the number that actually matters on
     a staff comms board — and it is MY unflagged count, since seen state
     is per coach. */
  const pinnedPosts = posts.filter(p => isUrgent(p) && !p.seen);
  const normalPosts = posts.filter(p => !(isUrgent(p) && !p.seen));

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
            <div className={styles.statValue}>{playersError ? '—' : committed}</div>
            <div className={styles.statLabel}>Committed</div>
          </div>
          {/* The last two cards are DESTINATIONS, not counts — same tile
              chrome so the row still reads as one strip, with a glyph
              standing in for the number. */}
          <Link href="/videos/library" className={styles.statCard} style={{ display: 'block', textDecoration: 'none' }}>
            <div className={styles.statValue} aria-hidden="true">🎬</div>
            <div className={styles.statLabel}>Videos</div>
          </Link>
          <Link href="/video-editor" className={styles.statCard} style={{ display: 'block', textDecoration: 'none' }}>
            <div className={styles.statValue} aria-hidden="true">✂️</div>
            <div className={styles.statLabel}>Video Editor</div>
          </Link>
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

        {/* ── Urgent, unflagged ──
            Pinned directly under the stat cards and held there until THIS
            coach clicks the flag. Seen state is per coach, so one person
            clearing it cannot hide it from the rest of the staff. */}
        {pinnedPosts.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <AnnouncementFeed
              posts={pinnedPosts}
              isCoach
              onDelete={handleDeletePost}
              onEdit={setEditingPost}
              onFlagSeen={handleFlagSeen}
              title="Urgent"
            />
          </div>
        )}

        {/* ── Everything else ──
            Suppressed while the only posts there are sit pinned above, so
            the page never says "No announcements yet" directly under one. */}
        {(normalPosts.length > 0 || pinnedPosts.length === 0) && (
        <div style={{ marginTop: 18 }}>
          <AnnouncementFeed
            posts={normalPosts}
            isCoach
            onDelete={handleDeletePost}
            onEdit={setEditingPost}
          />
        </div>
        )}
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
          postScope={postScope}
          setPostScope={setPostScope}
          postAudienceIds={postAudienceIds}
          setPostAudienceIds={setPostAudienceIds}
          postProgram={postProgram}
          setPostProgram={setPostProgram}
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

      {editingPost && (
        <EditPostModal
          post={editingPost}
          players={players}
          onClose={() => setEditingPost(null)}
          onSaved={(updated) => {
            /* The PUT response carries no `seen` (that is a per-viewer
               field on GET), so keep the flag we already had rather than
               letting an edit silently re-pin a post someone cleared. */
            setPosts(prev => prev.map(x =>
              x.id === updated.id ? { ...updated, seen: x.seen } : x));
            setEditingPost(null);
          }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   WEEKLY SCHEDULE STRIP


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
  postScope, setPostScope,
  postAudienceIds, setPostAudienceIds,
  postProgram, setPostProgram,
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
  postScope: string;
  setPostScope: (v: string) => void;
  postAudienceIds: string[];
  setPostAudienceIds: (v: string[]) => void;
  postProgram: string;
  setPostProgram: (v: string) => void;
  postVideoUrl: string;
  setPostVideoUrl: (v: string) => void;
  postImageUrl: string;
  setPostImageUrl: (v: string) => void;
  submitting: boolean;
  submitError: string;
  onSubmit: () => void;
  onClose: () => void;
}) {
  /* An Athletes Announcement may also spotlight one athlete by name. That
     is a separate question from the audience picker below it. */
  const needsPlayer = postType === ATHLETES_TAG;

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

          {/* ── Tagged Player (Athletes Announcement only) ── */}
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

          {/* ── Audience (Athletes Announcement only) ── */}
          <AudiencePicker
            postType={postType}
            scope={postScope}
            setScope={setPostScope}
            playerIds={postAudienceIds}
            setPlayerIds={setPostAudienceIds}
            program={postProgram}
            setProgram={setPostProgram}
            players={players}
          />

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
              Mark as Urgent
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

