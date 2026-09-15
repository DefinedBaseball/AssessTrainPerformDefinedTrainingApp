'use client';

/* ─────────────────────────────────────────────────────────────────────────────
   BACKGROUND VIDEO UPLOAD QUEUE

   Report saving used to block on the video upload: the Save button went dark
   and the whole modal sat there until every clip reached Bunny. This inverts
   it — the report saves and closes immediately, and the clips attach to it
   afterwards while the coach carries on working.

   WHY THE QUEUE LIVES IN MEMORY AND IS NEVER PERSISTED
   ---------------------------------------------------
   A browser upload dies with the tab, and so does the File object behind it.
   Writing "pending" rows into the report would therefore create permanent
   zombies: after any refresh they could never finish and Retry would have
   nothing to retry from. So pending clips exist ONLY here, and the report on
   the server is always the truth about what actually landed. Refreshing
   mid-upload loses the upload — which is honest, because the upload really is
   gone — rather than leaving a spinner that lies forever.

   WHY UPLOADS RUN ONE AT A TIME
   -----------------------------
   Attaching is a read-modify-write of the report's content JSON (append to
   `videos[]`, append to `videoIds`). Two clips finishing together would both
   read the same content and the second write would clobber the first. Serial
   processing makes that race impossible. The upload itself is no longer on
   anybody's critical path, so the lost parallelism costs nothing.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import * as api from '@/lib/api';

export type UploadJobStatus = 'queued' | 'uploading' | 'attaching' | 'done' | 'error';

export interface UploadJob {
  id: string;
  /** Kept in memory so Retry has something to retry with. */
  file: File;
  playerId: string;
  /** Final video title, including any " - Angle N" suffix. */
  title: string;
  /** Video category — the report type it was uploaded under. */
  category: string;
  /** The report this clip attaches to once it lands. */
  reportId: string;
  section: 'swing' | 'decision';
  status: UploadJobStatus;
  /** 0-100. Only meaningful while `uploading`. */
  progress: number;
  error?: string;
}

/** What a caller hands in — the queue assigns id/status/progress itself. */
export type NewUploadJob = Omit<UploadJob, 'id' | 'status' | 'progress' | 'error'>;

interface UploadQueueValue {
  jobs: UploadJob[];
  /** Jobs still in flight — what the "still uploading?" guards check. */
  activeCount: number;
  enqueue: (jobs: NewUploadJob[]) => void;
  retry: (jobId: string) => void;
  dismiss: (jobId: string) => void;
  /** Jobs belonging to one report, for the placeholder cards. */
  jobsForReport: (reportId: string | null | undefined) => UploadJob[];
}

const UploadQueueContext = createContext<UploadQueueValue | null>(null);

/** Fired after a clip successfully attaches, so open profile views can refetch. */
export const VIDEO_ATTACHED_EVENT = 'pdapp:video-attached';

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  /* The worker reads jobs through a ref so the loop isn't re-created on every
     progress tick — a setState-per-percent would otherwise restart it. */
  const jobsRef = useRef<UploadJob[]>([]);
  const runningRef = useRef(false);
  jobsRef.current = jobs;

  const patch = useCallback((id: string, next: Partial<UploadJob>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  /**
   * Append one finished upload to its report.
   *
   * Re-reads the report immediately before writing: the coach may have edited
   * it between save and upload completion, and this must not stamp a stale
   * copy back over their changes.
   */
  const attach = useCallback(async (job: UploadJob, video: api.Video) => {
    const report = await api.getReport(job.reportId);
    let content: any = {};
    try { content = report?.content ? JSON.parse(report.content) : {}; } catch { content = {}; }

    const entry = {
      name: job.file.name,
      size: job.file.size,
      id: video.id,
      url: video.originalUrl || undefined,
      section: job.section,
    };
    const videos = Array.isArray(content.videos) ? content.videos : [];
    /* Guard against a double-attach (a retry that actually succeeded the first
       time, or two tabs racing) — the id is what identifies the clip. */
    const alreadyThere = videos.some((v: any) => v && v.id === video.id);
    const nextVideos = alreadyThere ? videos : [...videos, entry];

    const existingIds = (report?.videoIds || '')
      .split(',').map((x: string) => x.trim()).filter(Boolean);
    const nextIds = existingIds.includes(video.id) ? existingIds : [...existingIds, video.id];

    await api.updateReport(job.reportId, {
      content: JSON.stringify({ ...content, videos: nextVideos }),
      videoIds: nextIds.join(','),
    });
  }, []);

  /* ── The worker ──
     One job at a time; see the header note on why it isn't parallel. */
  useEffect(() => {
    if (runningRef.current) return;
    const next = jobs.find(j => j.status === 'queued');
    if (!next) return;

    runningRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        patch(next.id, { status: 'uploading', progress: 0, error: undefined });
        const video = await api.uploadVideo(
          next.file, next.playerId, next.title, next.category, undefined,
          (pct: number) => { if (!cancelled) patch(next.id, { progress: Math.round(pct) }); },
        );
        if (cancelled) return;

        patch(next.id, { status: 'attaching', progress: 100 });
        await attach(next, video);
        if (cancelled) return;

        patch(next.id, { status: 'done', progress: 100 });
        /* Tell any open profile view to refetch so the real card replaces the
           placeholder without a manual refresh. */
        window.dispatchEvent(new CustomEvent(VIDEO_ATTACHED_EVENT, {
          detail: { reportId: next.reportId, playerId: next.playerId, videoId: video.id },
        }));
        /* Leave the finished card up briefly so the coach sees it complete,
           then drop it — the real video card has taken its place by then. */
        setTimeout(() => {
          setJobs(prev => prev.filter(j => j.id !== next.id));
        }, 2500);
      } catch (err: any) {
        if (!cancelled) {
          patch(next.id, {
            status: 'error',
            error: err?.message || 'Upload failed',
          });
        }
      } finally {
        runningRef.current = false;
        /* Nudge the effect so the next queued job starts. */
        if (!cancelled) setJobs(prev => [...prev]);
      }
    })();

    return () => { cancelled = true; };
  }, [jobs, patch, attach]);

  const enqueue = useCallback((incoming: NewUploadJob[]) => {
    if (incoming.length === 0) return;
    setJobs(prev => [
      ...prev,
      ...incoming.map((j, i) => ({
        ...j,
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'queued' as const,
        progress: 0,
      })),
    ]);
  }, []);

  const retry = useCallback((jobId: string) => {
    patch(jobId, { status: 'queued', progress: 0, error: undefined });
  }, [patch]);

  const dismiss = useCallback((jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const jobsForReport = useCallback(
    (reportId: string | null | undefined) =>
      (reportId ? jobsRef.current.filter(j => j.reportId === reportId) : []),
    [],
  );

  /* Anything not finished counts as active — an errored job is NOT active
     (it will never finish on its own, so it must not block a close). */
  const activeCount = jobs.filter(
    j => j.status === 'queued' || j.status === 'uploading' || j.status === 'attaching',
  ).length;

  /* Tab close. The browser hard-blocks custom wording here — Chrome shows its
     own "Leave site?" text no matter what string we return — so this only
     guarantees a prompt appears, not what it says. The wording we DO control
     lives on the in-app close dialog. */
  useEffect(() => {
    if (activeCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [activeCount]);

  const value = useMemo<UploadQueueValue>(
    () => ({ jobs, activeCount, enqueue, retry, dismiss, jobsForReport }),
    [jobs, activeCount, enqueue, retry, dismiss, jobsForReport],
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

/**
 * Queue handle.
 *
 * Returns a no-op queue when no provider is mounted rather than throwing, so a
 * component can use it without every test/story having to wrap itself.
 */
export function useUploadQueue(): UploadQueueValue {
  const ctx = useContext(UploadQueueContext);
  return ctx ?? {
    jobs: [],
    activeCount: 0,
    enqueue: () => {},
    retry: () => {},
    dismiss: () => {},
    jobsForReport: () => [],
  };
}

/**
 * Re-run a callback whenever a clip finishes attaching.
 *
 * Profile views use this to refetch so the real video card replaces the
 * placeholder on its own.
 */
export function useVideoAttachedListener(onAttached: () => void) {
  const cbRef = useRef(onAttached);
  cbRef.current = onAttached;
  useEffect(() => {
    const handler = () => cbRef.current();
    window.addEventListener(VIDEO_ATTACHED_EVENT, handler);
    return () => window.removeEventListener(VIDEO_ATTACHED_EVENT, handler);
  }, []);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PENDING VIDEO CARDS

   Dropped into a report's video section so a clip that is still uploading
   occupies the same slot its finished card will. Uploading shows a progress
   ring; a failure turns the same tile into Failed + Retry rather than the clip
   silently vanishing, which is what the old blocking save did.
   ═══════════════════════════════════════════════════════════════════════════ */
export function PendingVideoCards({ reportId, tag }: {
  reportId: string | null | undefined;
  /** Category chip text, matching the finished cards around it. */
  tag?: string;
}) {
  const { jobs, retry, dismiss } = useUploadQueue();
  const mine = reportId ? jobs.filter(j => j.reportId === reportId) : [];
  if (mine.length === 0) return null;

  return (
    <>
      {mine.map(job => {
        const failed = job.status === 'error';
        const done = job.status === 'done';
        const label = failed ? 'Upload failed'
          : done ? 'Uploaded'
          : job.status === 'attaching' ? 'Finishing…'
          : job.status === 'uploading' ? `${job.progress}%`
          : 'Queued';
        return (
          <div
            key={job.id}
            style={{
              position: 'relative',
              aspectRatio: '16 / 10',
              borderRadius: 10,
              border: `1px solid ${failed ? 'rgba(179,48,60,0.55)' : 'var(--border)'}`,
              background: 'rgba(127,127,127,0.06)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 7, padding: 10, textAlign: 'center', overflow: 'hidden',
            }}
          >
            {tag && (
              <span style={{
                position: 'absolute', top: 7, left: 8,
                fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                color: 'var(--text-muted)',
              }}>{tag}</span>
            )}

            {!failed && !done && (
              /* Progress ring — conic-gradient rather than SVG so the whole
                 indicator is one element that can't drift out of sync. */
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: `conic-gradient(var(--text) ${job.progress * 3.6}deg, rgba(127,127,127,0.22) 0deg)`,
                display: 'grid', placeItems: 'center',
              }}>
                <div style={{
                  width: 25, height: 25, borderRadius: '50%',
                  background: 'var(--bg, #0e1116)',
                }} />
              </div>
            )}
            {done && <span style={{ fontSize: 22, lineHeight: 1 }}>✓</span>}
            {failed && <span style={{ fontSize: 20, lineHeight: 1 }}>⚠</span>}

            <span style={{
              fontSize: 10, fontWeight: 700, color: failed ? '#b3303c' : 'var(--text-secondary)',
            }}>{label}</span>

            <span style={{
              fontSize: 9, color: 'var(--text-muted)', maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{job.file.name}</span>

            {failed && (
              <span style={{ display: 'inline-flex', gap: 5, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => retry(job.id)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                    cursor: 'pointer', border: '1px solid var(--text)',
                    background: 'var(--text)', color: 'var(--bg, #0e1116)',
                  }}
                >Retry</button>
                <button
                  type="button"
                  onClick={() => dismiss(job.id)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                    cursor: 'pointer', border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-muted)',
                  }}
                >Discard</button>
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
