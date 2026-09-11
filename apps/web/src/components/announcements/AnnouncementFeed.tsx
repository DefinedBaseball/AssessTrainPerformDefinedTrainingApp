'use client';

/* ─────────────────────────────────────────────────────────────────────
   Announcements — shared between the Dashboard and the notification bell.

   These lived inside app/page.tsx until the announcement feed moved into
   the bell's Announcements tab. They had to be extracted rather than
   imported from the page: the dashboard imports MessagesLauncher, so the
   bell importing back from the page would be a circular import.

   Split of responsibilities after the move:
     • Dashboard      — keeps the "+" FAB + CreatePostModal (create only)
     • Bell → tab 2   — renders AnnouncementFeed and owns edit / delete

   Styling still resolves from the dashboard's CSS module so the feed
   renders identically in either host.
   ───────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { PostItem, Player } from '@/lib/api';
import { RichTextEditor, RichTextView } from '@/components/RichTextEditor';
import { ATHLETE_TYPES } from '@/lib/athlete-types';
import styles from '@/app/page.module.css';

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ── Helper: format relative time ── */
export function timeAgo(dateStr: string): string {
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

/* ── Post type config ──
   Four tags, and the tag is what decides who the post reaches. The first
   three are staff-only; only Athletes Announcement can leave the coach
   dashboard, and it carries the audience fields that say which players. */
export const POST_TYPES = [
  { value: 'GENERAL', label: 'General', icon: '📌' },
  { value: 'COACHING', label: 'Coaching', icon: '🧢' },
  { value: 'ANNOUNCEMENT', label: 'Announcement', icon: '📣' },
  { value: 'ATHLETES_ANNOUNCEMENT', label: 'Athletes Announcement', icon: '🏅' },
] as const;

/** The one tag with an audience beyond the coaching staff. */
export const ATHLETES_TAG = 'ATHLETES_ANNOUNCEMENT';

/* Tag tint classes. These are the ORIGINAL class names from
   page.module.css reused against the new tags — the classes are just colour
   pairs, so renaming them across the stylesheet would be churn for nothing. */
export const TAG_STYLES: Record<string, string> = {
  GENERAL: 'tagFacility',                 // blue accent
  COACHING: 'tagProgram',                 // steel blue
  ANNOUNCEMENT: 'tagHighlight',           // green
  ATHLETES_ANNOUNCEMENT: 'tagCommitment', // gold
};

/** Audience scopes an Athletes Announcement can use. */
export const AUDIENCE_SCOPES = [
  { value: 'ALL_PLAYERS', label: 'All Players' },
  { value: 'INDIVIDUAL',  label: 'Individual' },
  { value: 'PROGRAM',     label: 'Program' },
] as const;

/**
 * Is this post urgent?
 *
 * Accepts the retired 'IMPORTANT' value as well as today's 'URGENT', so a
 * post written before the rename still pins and still shows its flag.
 */
export function isUrgent(post: { urgency: string }): boolean {
  return post.urgency === 'URGENT' || post.urgency === 'IMPORTANT';
}

/* ── Shared audience picker ──
   Used by BOTH the create modal (on the dashboard) and the edit modal below,
   so the two cannot drift apart on what an audience means. Renders nothing
   unless the active tag is Athletes Announcement. */
export function AudiencePicker({
  postType, scope, setScope, playerIds, setPlayerIds, program, setProgram, players,
}: {
  postType: string;
  scope: string;
  setScope: (v: string) => void;
  playerIds: string[];
  setPlayerIds: (v: string[]) => void;
  program: string;
  setProgram: (v: string) => void;
  players: Player[];
}) {
  if (postType !== ATHLETES_TAG) return null;

  /* Alphabetical by last name, then first — the order a coach scanning a
     roster expects. */
  const sorted = [...players].sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || '') ||
    (a.firstName || '').localeCompare(b.firstName || ''));

  const toggle = (id: string) => {
    setPlayerIds(playerIds.includes(id) ? playerIds.filter(x => x !== id) : [...playerIds, id]);
  };

  return (
    <>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>Send To</label>
        <select
          className={`${styles.fieldInput} ${styles.fieldSelect}`}
          value={scope}
          onChange={e => setScope(e.target.value)}
        >
          {AUDIENCE_SCOPES.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {scope === 'INDIVIDUAL' && (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>
            Athletes {playerIds.length > 0 && `(${playerIds.length} selected)`}
          </label>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            maxHeight: 190, overflowY: 'auto',
            padding: 8, borderRadius: 8, border: '1px solid var(--border)',
          }}>
            {sorted.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No athletes on the roster.</span>
            )}
            {sorted.map(pl => {
              const on = playerIds.includes(pl.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => toggle(pl.id)}
                  style={{
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    padding: '4px 10px', borderRadius: 999,
                    border: `1px solid ${on ? 'var(--accent, #3d8bfd)' : 'var(--border)'}`,
                    background: on ? 'var(--accent-dim, rgba(61,139,253,0.14))' : 'transparent',
                    color: on ? 'var(--accent-light, #3d8bfd)' : 'var(--text-secondary)',
                  }}
                >
                  {pl.lastName}, {pl.firstName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {scope === 'PROGRAM' && (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Program</label>
          <select
            className={`${styles.fieldInput} ${styles.fieldSelect}`}
            value={program}
            onChange={e => setProgram(e.target.value)}
          >
            <option value="">Select program...</option>
            {ATHLETE_TYPES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          {/* The tag has to be on the athlete's profile for this to reach
              them — say so rather than letting a send quietly hit nobody. */}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
            Goes to every athlete carrying this tag on their profile.
          </span>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ANNOUNCEMENT FEED
   ══════════════════════════════════════════════ */
export function AnnouncementFeed({
  posts,
  isCoach,
  onDelete,
  onEdit,
  onFlagSeen,
  title = 'Announcements & Spotlights',
  emptyHint = true,
}: {
  posts: PostItem[];
  isCoach: boolean;
  onDelete: (id: string) => void;
  onEdit: (post: PostItem) => void;
  /** Supplied only where flagging makes sense (the pinned urgent row on the
   *  coach dashboard). Without it the flag renders as a static marker. */
  onFlagSeen?: (id: string) => void;
  /** Heading — the pinned row overrides it with its own. */
  title?: string;
  emptyHint?: boolean;
}) {
  if (posts.length === 0) {
    return (
      <div className={styles.feedSection}>
        <div className={styles.feedHeader}>
          <div className={styles.feedTitle}>
            {title}
          </div>
        </div>
        <div className={styles.feedEmpty}>
          No announcements yet.
          {isCoach && emptyHint && <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: 'var(--faint)' }}>
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
          {title}
          <span className={styles.feedBadge}>{posts.length}</span>
        </div>
      </div>
      <div className={styles.feedList}>
        {posts.map(post => {
          const typeLabel = POST_TYPES.find(t => t.value === post.type)?.label || post.type;
          const tagClass = TAG_STYLES[post.type] || 'tagFacility';
          const urgent = isUrgent(post);

          return (
            <div
              key={post.id}
              className={`${styles.postCard} ${urgent ? styles.postCardImportant : ''}`}
            >
              {/* Full-width type bar — the announcement type, the Important
                  marking, and the time live in this header strip, tinted by
                  the post type. */}
              <div className={`${styles.postTop} ${styles[tagClass]}`}>
                <div className={styles.postMeta}>
                  <span className={styles.postBarLabel}>{typeLabel}</span>
                  {urgent && (
                    <span className={styles.postUrgentBadge}>Urgent</span>
                  )}
                  <span className={styles.postDate}>{timeAgo(post.createdAt)}</span>
                </div>
                {/* Urgent flag, pinned to the top-right of the bubble. On the
                    dashboard's pinned row it is the "Flag as Seen" button;
                    everywhere else it is a static marker. Deliberately NOT
                    inside .postActions, which is hidden until card hover. */}
                {urgent && (
                  onFlagSeen ? (
                    <button
                      type="button"
                      className={styles.postFlagBtn}
                      title="Flag as Seen"
                      onClick={() => onFlagSeen(post.id)}
                    >
                      🚩
                    </button>
                  ) : (
                    <span className={styles.postFlagStatic} title="Urgent">🚩</span>
                  )
                )}
                {isCoach && (
                  <div className={styles.postActions}>
                    <button
                      className={styles.postEditBtn}
                      onClick={() => onEdit(post)}
                      title="Edit post"
                    >
                      &#9998;
                    </button>
                    <button
                      className={styles.postDeleteBtn}
                      onClick={() => onDelete(post.id)}
                      title="Delete post"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>

              <div className={styles.postTitle}>{post.title}</div>
              {post.body && <RichTextView html={post.body} className={styles.postBody} />}

              {/* Uploaded media — image and/or video — shown under the text as
                  small squares in a 3-up grid. */}
              {(post.imageUrl || post.videoUrl) && (
                <div className={styles.postMediaGrid}>
                  {post.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className={styles.postMedia} src={post.imageUrl} alt={post.title} />
                  )}
                  {post.videoUrl && (
                    <video className={styles.postMedia} src={post.videoUrl} controls preload="metadata" />
                  )}
                </div>
              )}

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

                {/* Audience read-back, so a coach can see at a glance who an
                    Athletes Announcement actually went to. */}
                {post.type === ATHLETES_TAG && (
                  <span className={styles.postPlayerChip}>
                    {post.audienceScope === 'ALL_PLAYERS' && 'All players'}
                    {post.audienceScope === 'INDIVIDUAL' &&
                      `${post.audiencePlayerIds.split(',').filter(Boolean).length} athlete(s)`}
                    {post.audienceScope === 'PROGRAM' &&
                      (ATHLETE_TYPES.find(t => t.key === post.audienceProgram)?.label || post.audienceProgram)}
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
   EDIT POST MODAL
   ══════════════════════════════════════════════ */
export function EditPostModal({
  post,
  players,
  onClose,
  onSaved,
}: {
  post: PostItem;
  players: Player[];
  onClose: () => void;
  onSaved: (p: PostItem) => void;
}) {
  const [postType, setPostType] = useState(post.type);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body || '');
  const [urgency, setUrgency] = useState(isUrgent(post));
  const [taggedPlayerId, setTaggedPlayerId] = useState(post.taggedPlayerId || '');
  const [scope, setScope] = useState<string>(
    post.audienceScope && post.audienceScope !== 'COACHES' ? post.audienceScope : 'ALL_PLAYERS');
  const [audiencePlayerIds, setAudiencePlayerIds] = useState<string[]>(
    (post.audiencePlayerIds || '').split(',').map(x => x.trim()).filter(Boolean));
  const [program, setProgram] = useState(post.audienceProgram || '');
  const [videoUrl, setVideoUrl] = useState(post.videoUrl || '');
  const [imageUrl, setImageUrl] = useState(post.imageUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* An Athletes Announcement can still spotlight one athlete by name; the
     audience picker below is a separate question from the tagged player. */
  const needsPlayer = postType === ATHLETES_TAG;

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updatePost(post.id, {
        type: postType,
        title: title.trim(),
        body: body.trim() || undefined,
        urgency: urgency ? 'URGENT' : 'NORMAL',
        taggedPlayerId: taggedPlayerId || undefined,
        ...(postType === ATHLETES_TAG
          ? {
              audienceScope: scope as api.PostAudienceScope,
              audiencePlayerIds: scope === 'INDIVIDUAL' ? audiencePlayerIds.join(',') : '',
              audienceProgram: scope === 'PROGRAM' ? program : undefined,
            }
          : {}),
        videoUrl: videoUrl || undefined,
        imageUrl: imageUrl || undefined,
      });
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to update post');
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Edit Post</span>
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
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* ── Body (Rich Text) ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Body (optional)</label>
            <RichTextEditor
              value={body}
              onChange={setBody}
              placeholder="Write your announcement..."
              minHeight={110}
            />
          </div>

          {/* ── Tagged Player ── */}
          {needsPlayer && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Tagged Athlete</label>
              <select
                className={`${styles.fieldInput} ${styles.fieldSelect}`}
                value={taggedPlayerId}
                onChange={e => setTaggedPlayerId(e.target.value)}
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
            scope={scope}
            setScope={setScope}
            playerIds={audiencePlayerIds}
            setPlayerIds={setAudiencePlayerIds}
            program={program}
            setProgram={setProgram}
            players={players}
          />

          {/* ── Video — URL OR File upload (mirrors CreatePostModal) ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Video (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="Paste a video URL (https://...)"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
            />
            <input
              type="file"
              accept="video/*"
              className={styles.fileInput}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                setVideoUrl(dataUrl);
              }}
            />
          </div>

          {/* ── Image — URL OR File upload ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Image (optional)</label>
            <input
              type="text"
              className={styles.fieldInput}
              placeholder="Paste an image URL (https://...)"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
            />
            <input
              type="file"
              accept="image/*"
              className={styles.fileInput}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                setImageUrl(dataUrl);
              }}
            />
          </div>

          {/* ── Urgency ── */}
          <div className={styles.urgencyToggle}>
            <input
              type="checkbox"
              id="editUrgency"
              className={styles.urgencyCheckbox}
              checked={urgency}
              onChange={e => setUrgency(e.target.checked)}
            />
            <label htmlFor="editUrgency" className={styles.urgencyLabel}>
              Mark as Urgent
            </label>
          </div>

          {/* ── Submit ── */}
          {error && <div className={styles.errorMsg}>{error}</div>}
          <button
            className={styles.submitBtn}
            disabled={saving || !title.trim()}
            onClick={save}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
