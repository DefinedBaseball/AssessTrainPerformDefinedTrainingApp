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

/* ── Post type config ── */
export const POST_TYPES = [
  { value: 'FACILITY_ANNOUNCEMENT', label: 'Facility Announcement', icon: '🏟️' },
  { value: 'ATHLETE_HIGHLIGHT', label: 'Athlete Highlight', icon: '⭐' },
  { value: 'PROGRAM_ANNOUNCEMENT', label: 'Program Announcement', icon: '📋' },
  { value: 'COLLEGE_COMMITMENT', label: 'College Commitment', icon: '🎓' },
  { value: 'PRO_SIGNING', label: 'Pro Signing', icon: '✍️' },
] as const;

export const TAG_STYLES: Record<string, string> = {
  FACILITY_ANNOUNCEMENT: 'tagFacility',
  ATHLETE_HIGHLIGHT: 'tagHighlight',
  PROGRAM_ANNOUNCEMENT: 'tagProgram',
  COLLEGE_COMMITMENT: 'tagCommitment',
  PRO_SIGNING: 'tagProSigning',
};

/* ══════════════════════════════════════════════
   ANNOUNCEMENT FEED
   ══════════════════════════════════════════════ */
export function AnnouncementFeed({
  posts,
  isCoach,
  onDelete,
  onEdit,
}: {
  posts: PostItem[];
  isCoach: boolean;
  onDelete: (id: string) => void;
  onEdit: (post: PostItem) => void;
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
              {/* Full-width type bar — the announcement type, the Important
                  marking, and the time live in this header strip, tinted by
                  the post type. */}
              <div className={`${styles.postTop} ${styles[tagClass]}`}>
                <div className={styles.postMeta}>
                  <span className={styles.postBarLabel}>{typeLabel}</span>
                  {post.urgency === 'IMPORTANT' && (
                    <span className={styles.postUrgentBadge}>Important</span>
                  )}
                  <span className={styles.postDate}>{timeAgo(post.createdAt)}</span>
                </div>
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
  const [urgency, setUrgency] = useState(post.urgency === 'IMPORTANT');
  const [taggedPlayerId, setTaggedPlayerId] = useState(post.taggedPlayerId || '');
  const [collegeName, setCollegeName] = useState(post.collegeName || '');
  const [position, setPosition] = useState(post.position || '');
  const [orgName, setOrgName] = useState(post.organizationName || '');
  const [level, setLevel] = useState(post.level || '');
  const [videoUrl, setVideoUrl] = useState(post.videoUrl || '');
  const [imageUrl, setImageUrl] = useState(post.imageUrl || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const needsPlayer = ['ATHLETE_HIGHLIGHT', 'COLLEGE_COMMITMENT', 'PRO_SIGNING'].includes(postType);
  const isCommitment = postType === 'COLLEGE_COMMITMENT';
  const isProSigning = postType === 'PRO_SIGNING';

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updatePost(post.id, {
        type: postType,
        title: title.trim(),
        body: body.trim() || undefined,
        urgency: urgency ? 'IMPORTANT' : 'NORMAL',
        taggedPlayerId: taggedPlayerId || undefined,
        collegeName: collegeName || undefined,
        position: position || undefined,
        organizationName: orgName || undefined,
        level: level || undefined,
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

          {/* ── College Commitment fields ── */}
          {isCommitment && (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>College / University</label>
                <input
                  type="text"
                  className={styles.fieldInput}
                  placeholder="e.g. University of Texas"
                  value={collegeName}
                  onChange={e => setCollegeName(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Position</label>
                <input
                  type="text"
                  className={styles.fieldInput}
                  placeholder="e.g. RHP, SS, OF"
                  value={position}
                  onChange={e => setPosition(e.target.value)}
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
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Level</label>
                <select
                  className={`${styles.fieldInput} ${styles.fieldSelect}`}
                  value={level}
                  onChange={e => setLevel(e.target.value)}
                >
                  <option value="">Select level...</option>
                  <option value="MLB">MLB</option>
                  <option value="MiLB">MiLB</option>
                  <option value="Independent">Independent</option>
                </select>
              </div>
            </>
          )}

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
              Mark as Important
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
