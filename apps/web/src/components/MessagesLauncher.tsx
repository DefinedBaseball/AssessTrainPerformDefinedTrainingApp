'use client';

/* ─────────────────────────────────────────────────────────────────────
   MessagesLauncher — the two round "bubbles" that live in the Dashboard
   hero's actions slot:
     • 🔔 Notifications — a live list (account requests with Accept/Decline,
                          posts, reports, videos, schedules) + unread badge.
     • ✉️ Messages      — opens a right-hand slide-over for 1-to-1 direct
                          messaging between coaches and players, with
                          optional video attachments.

   Self-contained: it owns its own poll for the unread badge and renders
   its panels through a portal to <body>, so it can be dropped straight
   into <PageHeader actions={…}> on both the coach and player dashboards
   without being clipped by the header's `overflow: hidden`.
   ───────────────────────────────────────────────────────────────────── */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { uploadVideoFile } from '@/lib/api';
import styles from './MessagesLauncher.module.css';

type Panel = null | 'messages' | 'notifications';
type View = 'list' | 'contacts' | 'thread';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* Emoji glyph per notification type — keeps the popover readable without a
   second icon set. */
const NOTIF_GLYPH: Record<api.NotificationType, string> = {
  ACCOUNT_REQUEST: '👤',
  ANNOUNCEMENT: '📣',
  COMMITMENT: '🎓',
  COACH_REVIEW: '🎬',
  REPORT: '📋',
  VIDEO: '📹',
  SCHEDULE: '📅',
};

function Avatar({ contact, size = 38 }: { contact: api.MessageContact; size?: number }) {
  return contact.photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={contact.photo}
      alt=""
      className={styles.avatar}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      data-fallback
    >
      {initials(contact.name) || '?'}
    </span>
  );
}

export function MessagesLauncher() {
  const { user, isCoach, isAdmin } = useAuth();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [unread, setUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifList, setNotifList] = useState<api.AppNotification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifBusy, setNotifBusy] = useState<string | null>(null);

  const [view, setView] = useState<View>('list');
  const [conversations, setConversations] = useState<api.Conversation[]>([]);
  const [contacts, setContacts] = useState<api.MessageContact[]>([]);
  const [thread, setThread] = useState<api.MessageThread | null>(null);
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [pendingVideo, setPendingVideo] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const threadBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  /* Poll the unread badge: on mount + every 20s. */
  const refreshUnread = useCallback(() => {
    api.getUnreadMessageCount().then((r) => setUnread(r.count)).catch(() => {});
  }, []);
  const refreshNotifUnread = useCallback(() => {
    api.getUnreadNotificationCount().then((r) => setNotifUnread(r.count)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    refreshNotifUnread();
    const id = window.setInterval(() => {
      refreshUnread();
      refreshNotifUnread();
    }, 20000);
    return () => window.clearInterval(id);
  }, [user, refreshUnread, refreshNotifUnread]);

  /* ── Panel loaders ── */
  const openMessages = useCallback(() => {
    setPanel('messages');
    setView('list');
    setThread(null);
    setLoading(true);
    api.getConversations().then(setConversations).catch(() => setConversations([])).finally(() => setLoading(false));
  }, []);

  const openContacts = useCallback(() => {
    setView('contacts');
    setLoading(true);
    api.getMessageContacts().then(setContacts).catch(() => setContacts([])).finally(() => setLoading(false));
  }, []);

  const openThread = useCallback((userId: string) => {
    setView('thread');
    setThread(null);
    setDraft('');
    setPendingVideo(null);
    setLoading(true);
    api
      .getMessageThread(userId)
      .then(setThread)
      .catch(() => setThread(null))
      .finally(() => {
        setLoading(false);
        refreshUnread();
      });
  }, [refreshUnread]);

  const closePanel = useCallback(() => {
    setPanel(null);
    refreshUnread();
    refreshNotifUnread();
  }, [refreshUnread, refreshNotifUnread]);

  /* ── Notifications ── */
  const openNotifications = useCallback(() => {
    setPanel('notifications');
    setNotifLoading(true);
    api
      .getNotifications()
      .then(setNotifList)
      .catch(() => setNotifList([]))
      .finally(() => setNotifLoading(false));
  }, []);

  const handleNotifClick = useCallback(
    async (n: api.AppNotification) => {
      if (!n.readAt) {
        try { await api.markNotificationRead(n.id); } catch { /* ignore */ }
        setNotifList((list) =>
          list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
        );
        refreshNotifUnread();
      }
      if (n.linkUrl) {
        setPanel(null);
        router.push(n.linkUrl);
      }
    },
    [router, refreshNotifUnread],
  );

  const handleMarkAllRead = useCallback(async () => {
    try { await api.markAllNotificationsRead(); } catch { /* ignore */ }
    // Account requests stay unread until accepted/declined — leave them be.
    setNotifList((list) =>
      list.map((x) =>
        x.type === 'ACCOUNT_REQUEST' ? x : { ...x, readAt: x.readAt ?? new Date().toISOString() },
      ),
    );
    refreshNotifUnread();
  }, [refreshNotifUnread]);

  /* Coach Accept/Decline on an ACCOUNT_REQUEST notification. */
  const respondToRequest = useCallback(
    async (n: api.AppNotification, accept: boolean) => {
      if (!n.entityId) return;
      setNotifBusy(n.id);
      try {
        if (accept) await api.approvePlayer(n.entityId);
        else await api.declinePlayer(n.entityId);
        // Backend clears the request for every coach; just drop it locally.
        setNotifList((list) => list.filter((x) => x.id !== n.id));
        refreshNotifUnread();
      } catch {
        window.alert(accept ? 'Could not approve this account.' : 'Could not decline this account.');
      } finally {
        setNotifBusy(null);
      }
    },
    [refreshNotifUnread],
  );

  /* Keep the thread scrolled to the newest message. */
  useEffect(() => {
    if (view === 'thread') {
      const el = threadBodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [thread?.messages.length, view]);

  /* ── Composer ── */
  const onPickVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttaching(true);
    try {
      const { url } = await uploadVideoFile(file);
      setPendingVideo(url);
    } catch {
      window.alert('Video upload failed. Please try again.');
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    if (!thread) return;
    const body = draft.trim();
    if (!body && !pendingVideo) return;
    setSending(true);
    try {
      const msg = await api.sendMessage({
        recipientId: thread.user.id,
        body: body || undefined,
        videoUrl: pendingVideo || undefined,
      });
      setThread((t) => (t ? { ...t, messages: [...t.messages, msg] } : t));
      setDraft('');
      setPendingVideo(null);
    } catch {
      window.alert('Could not send the message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  /* ── Header bubbles ── */
  const buttons = (
    <div className={styles.launcher}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label="Notifications"
        title="Notifications"
        onClick={() => (panel === 'notifications' ? closePanel() : openNotifications())}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {notifUnread > 0 && (
          <span className={styles.badge}>{notifUnread > 99 ? '99+' : notifUnread}</span>
        )}
      </button>

      <button
        type="button"
        className={styles.iconBtn}
        aria-label="Messages"
        title="Messages"
        onClick={openMessages}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );

  /* ── Notifications popover ── */
  const notifications = panel === 'notifications' && mounted
    ? createPortal(
        <>
          <div className={styles.backdrop} onClick={closePanel} />
          <div className={styles.notifCard} role="dialog" aria-label="Notifications">
            <div className={styles.notifHead}>
              <span>Notifications</span>
              <div className={styles.notifHeadActions}>
                {notifList.some((n) => !n.readAt && n.type !== 'ACCOUNT_REQUEST') && (
                  <button
                    type="button"
                    className={styles.markAllBtn}
                    onClick={() => void handleMarkAllRead()}
                  >
                    Mark all read
                  </button>
                )}
                <button type="button" className={styles.closeBtn} aria-label="Close" onClick={closePanel}>
                  <CloseIcon />
                </button>
              </div>
            </div>

            {notifLoading ? (
              <div className={styles.notifLoadingState}>
                <span className={styles.spinner} />
              </div>
            ) : notifList.length === 0 ? (
              <div className={styles.notifEmpty}>
                <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.notifEmptyIcon}>
                  <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p className={styles.notifEmptyTitle}>You’re all caught up</p>
                <p className={styles.notifEmptyHint}>New activity will show up here.</p>
              </div>
            ) : (
              <div className={styles.notifList}>
                {notifList.map((n) => {
                  // Only admins act on account requests (the API enforces it too).
                  const isRequest = n.type === 'ACCOUNT_REQUEST' && isAdmin;
                  const clickable = !isRequest && !!n.linkUrl;
                  return (
                    <div
                      key={n.id}
                      className={`${styles.notifRow} ${n.readAt ? '' : styles.notifRowUnread} ${clickable ? styles.notifRowClickable : ''}`}
                      onClick={clickable ? () => void handleNotifClick(n) : undefined}
                      role={clickable ? 'button' : undefined}
                    >
                      <span className={styles.notifGlyph} data-type={n.type} aria-hidden="true">
                        {NOTIF_GLYPH[n.type] ?? '•'}
                      </span>
                      <div className={styles.notifContent}>
                        <div className={styles.notifRowTop}>
                          <span className={styles.notifTitle}>{n.title}</span>
                          <span className={styles.notifTime}>{timeLabel(n.createdAt)}</span>
                        </div>
                        {n.body && <span className={styles.notifText}>{n.body}</span>}
                        {isRequest && (
                          <div className={styles.notifActions}>
                            <button
                              type="button"
                              className={styles.approveBtn}
                              disabled={notifBusy === n.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void respondToRequest(n, true);
                              }}
                            >
                              {notifBusy === n.id ? '…' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              className={styles.declineBtn}
                              disabled={notifBusy === n.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void respondToRequest(n, false);
                              }}
                            >
                              Decline
                            </button>
                          </div>
                        )}
                      </div>
                      {!n.readAt && <span className={styles.notifDot} aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>,
        document.body,
      )
    : null;

  /* ── Messages slide-over ── */
  const messages = panel === 'messages' && mounted
    ? createPortal(
        <>
          <div className={styles.backdrop} onClick={closePanel} />
          <aside className={styles.panel} role="dialog" aria-label="Messages">
            {/* Header */}
            <div className={styles.panelHead}>
              {view !== 'list' ? (
                <button
                  type="button"
                  className={styles.backBtn}
                  aria-label="Back"
                  onClick={() => (view === 'thread' ? openMessages() : setView('list'))}
                >
                  <BackIcon />
                </button>
              ) : (
                <span className={styles.panelHeadIcon}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
              )}
              <span className={styles.panelTitle}>
                {view === 'thread' && thread ? thread.user.name : view === 'contacts' ? 'New Message' : 'Messages'}
              </span>
              {view === 'list' && (
                <button type="button" className={styles.newBtn} onClick={openContacts}>
                  <PlusIcon /> New
                </button>
              )}
              <button type="button" className={styles.closeBtn} aria-label="Close" onClick={closePanel}>
                <CloseIcon />
              </button>
            </div>

            {/* Body */}
            {loading ? (
              <div className={styles.centerState}>
                <span className={styles.spinner} />
              </div>
            ) : view === 'list' ? (
              conversations.length === 0 ? (
                <div className={styles.centerState}>
                  <p className={styles.emptyTitle}>No conversations yet</p>
                  <p className={styles.emptyHint}>Start one with the New button above.</p>
                </div>
              ) : (
                <div className={styles.scroll}>
                  {conversations.map((c) => (
                    <button
                      key={c.user.id}
                      type="button"
                      className={styles.convRow}
                      onClick={() => openThread(c.user.id)}
                    >
                      <Avatar contact={c.user} />
                      <span className={styles.convMid}>
                        <span className={styles.convTop}>
                          <span className={styles.convName}>{c.user.name}</span>
                          <span className={styles.convTime}>{timeLabel(c.lastMessage.createdAt)}</span>
                        </span>
                        <span className={styles.convPreview}>
                          {c.lastMessage.videoUrl && !c.lastMessage.body ? '📹 Video' : c.lastMessage.body}
                        </span>
                      </span>
                      {c.unreadCount > 0 && <span className={styles.convUnread}>{c.unreadCount}</span>}
                    </button>
                  ))}
                </div>
              )
            ) : view === 'contacts' ? (
              contacts.length === 0 ? (
                <div className={styles.centerState}>
                  <p className={styles.emptyTitle}>No one to message yet</p>
                </div>
              ) : (
                <div className={styles.scroll}>
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={styles.convRow}
                      onClick={() => openThread(c.id)}
                    >
                      <Avatar contact={c} />
                      <span className={styles.convMid}>
                        <span className={styles.convName}>{c.name}</span>
                        <span className={styles.roleChip} data-role={c.role}>
                          {c.role === 'COACH' ? 'Coach' : 'Player'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              /* thread */
              <>
                <div className={styles.threadBody} ref={threadBodyRef}>
                  {thread && thread.messages.length === 0 && (
                    <p className={styles.threadEmpty}>
                      Say hello to {thread.user.name} — send a message or a video below.
                    </p>
                  )}
                  {thread?.messages.map((m) => {
                    const mine = m.senderId === user.id;
                    return (
                      <div key={m.id} className={`${styles.msgRow} ${mine ? styles.msgMine : styles.msgTheirs}`}>
                        <div className={styles.bubble}>
                          {m.videoUrl && (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <video src={m.videoUrl} controls className={styles.msgVideo} />
                          )}
                          {m.body && <span className={styles.msgText}>{m.body}</span>}
                          <span className={styles.msgTime}>{timeLabel(m.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Composer */}
                <div className={styles.composer}>
                  {pendingVideo && (
                    <div className={styles.attachChip}>
                      <span>📹 Video attached</span>
                      <button type="button" onClick={() => setPendingVideo(null)} aria-label="Remove video">
                        <CloseIcon />
                      </button>
                    </div>
                  )}
                  <div className={styles.composerRow}>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={onPickVideo}
                    />
                    <button
                      type="button"
                      className={styles.attachBtn}
                      aria-label="Attach video"
                      title="Attach video"
                      disabled={attaching}
                      onClick={() => fileRef.current?.click()}
                    >
                      {attaching ? <span className={styles.spinnerSm} /> : <ClipIcon />}
                    </button>
                    <textarea
                      className={styles.textarea}
                      placeholder="Write a message…"
                      value={draft}
                      rows={1}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={styles.sendBtn}
                      aria-label="Send"
                      disabled={sending || (!draft.trim() && !pendingVideo)}
                      onClick={() => void send()}
                    >
                      {sending ? <span className={styles.spinnerSm} /> : <SendIcon />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </aside>
        </>,
        document.body,
      )
    : null;

  return (
    <>
      {buttons}
      {notifications}
      {messages}
    </>
  );
}

/* ── Inline icons ── */
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconSm}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconSm}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconXs}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconSm}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconSm}>
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
