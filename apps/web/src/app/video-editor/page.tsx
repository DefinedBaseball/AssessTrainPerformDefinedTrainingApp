'use client';

/* ─────────────────────────────────────────────────────────────────────────────
   VIDEO EDITOR — placeholder

   Reached from the Video Editor card on the coach dashboard. The real build is
   a CapCut-style timeline editor:

     • Import panel (top-left third) — browse Athletes / Drills / Major League
       Video, "+" a clip to push it onto the timeline
     • Preview (top-right two thirds) — plays the timeline as ONE program,
       with transport, slow-mo and the drawing tools
     • Timeline (full width, below) — ordered clips, playhead, reorder

   Record then captures the preview live (mic + the composited canvas), which
   is the one piece that already exists: VideoBundleModal paints its panes to a
   1280x720 canvas, pulls captureStream(30), merges a getUserMedia mic track
   and runs MediaRecorder over the pair. That pipeline is what this page will
   reuse — see components/assessment/VideoBundleModal.tsx (startRecording).

   This file is deliberately a stub so the dashboard card has a real
   destination while the editor is built.
   ─────────────────────────────────────────────────────────────────────────── */

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { PageHeader } from '@/components/PageHeader';

export default function VideoEditorPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  /* Coach-only, same as the dashboard that links here. Gate on `isLoading`
     rather than `!user` — during the auth bootstrap `user` is undefined and a
     bare falsy check would bounce a signed-in coach to /login. */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  if (isLoading || !user || !isCoach) return null;

  return (
    <div>
      <PageHeader
        size="hero"
        eyebrow="Coach Tools"
        title="Video"
        titleAccent="Editor"
      />

      <div style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 14 }} aria-hidden="true">✂️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          Under construction
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 18 }}>
          This is where the timeline editor will live — import clips from athletes,
          drills or the Major League library, drop them on a timeline, then record
          your voice over the preview as you play, slow down and draw.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)', marginBottom: 22 }}>
          Until then, the same narration-and-compare tools live inside any video
          in the library — open a clip and use Compare + Record.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/videos/library"
            style={{
              padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700,
              textDecoration: 'none', color: 'var(--accent-light, #3d8bfd)',
              border: '1px solid var(--accent, #3d8bfd)',
            }}
          >
            Open Video Library
          </Link>
          <Link
            href="/"
            style={{
              padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700,
              textDecoration: 'none', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
