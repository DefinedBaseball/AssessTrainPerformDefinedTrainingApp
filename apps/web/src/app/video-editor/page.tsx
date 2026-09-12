'use client';

/* ─────────────────────────────────────────────────────────────────────────────
   VIDEO EDITOR — timeline + live narration capture

   Reached from the Video Editor card on the coach dashboard.

     Import panel (left third)  — browse Athletes / Drills / Major League Video
                                  and pull clips into the Uploaded pool. Each
                                  pooled clip has a "+" that pushes it onto the
                                  timeline.
     Preview (right two thirds) — plays the timeline as ONE program: transport,
                                  slow-mo, and the same drawing overlay the
                                  video modal uses.
     Timeline (full width)      — the clips in order, with a playhead.

   RECORDING IS A PERFORMANCE, NOT AN EXPORT. Record captures the preview live
   — every frame the coach sees, including rewinds, slow-mo and drawings — by
   compositing to a canvas at 30fps and muxing a mic track over it. A four
   minute timeline takes four minutes to record. That is the coach spec ("it
   will record WHATEVER is happening in the preview pane"), and it is why
   there is no render step.

   The capture pipeline is the same one VideoBundleModal.startRecording uses.

   TWO THINGS THAT WILL BITE A FUTURE EDITOR HERE:

   1. CANVAS TAINT. Drawing a cross-origin video onto a canvas taints it and
      captureStream() then refuses to hand over frames. Bunny sends CORS
      headers, so `crossOrigin="anonymous"` keeps the canvas clean — but a
      source that does NOT send them fails to load at all with that attribute
      set. So each clip tries anonymous first and falls back to a plain load,
      and a clip that had to fall back is marked `tainted` and blocks Record
      with an explanation rather than failing at the MediaRecorder call.

   2. CLIP SWITCHES. Every timeline clip is mounted as its own <video> with
      preload="auto"; only the active one is visible. Switching is a
      show/hide + play(), so there is no load stall landing in the middle of
      a recording. Do not "optimise" this into one element with a changing
      src — that stall is exactly what it avoids.
   ─────────────────────────────────────────────────────────────────────────── */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Video, Drill, MlbPlayer } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { VideoDrawingOverlay } from '@/components/VideoDrawingOverlay';
import s from './page.module.css';

/* ── Types ── */

type MediaSource = 'ATHLETE' | 'DRILL' | 'MLB';

interface MediaItem {
  /** Stable key for the pool — source-scoped so the same clip can't double. */
  key: string;
  url: string;
  label: string;
  sublabel: string;
  source: MediaSource;
  /** Set only for athlete clips — used to default the save target. */
  playerId?: string;
  category?: string;
}

interface TimelineClip {
  /** Unique per placement: the same pool clip can sit on the timeline twice. */
  id: string;
  media: MediaItem;
  /** Filled in from loadedmetadata; null until the element reports. */
  durationSec: number | null;
  /** True once the clip had to load without crossOrigin — see header note. */
  tainted: boolean;
}

const RATES = [0.25, 0.5, 1, 1.5, 2];

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
export default function VideoEditorPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  /* Coach-only, same as the dashboard that links here. Gate on `isLoading`
     rather than `!user` — during auth bootstrap `user` is undefined and a bare
     falsy check would bounce a signed-in coach to /login. */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  /* ── Media pool + timeline ── */
  const [pool, setPool] = useState<MediaItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineClip[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  /* ── Playback ── */
  const [activeIdx, setActiveIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [clipTime, setClipTime] = useState(0);

  /* ── Drawing ── */
  /* Tool names mirror VideoDrawingOverlay's own union — 'freehand', not
     'pen'. Rename one and the overlay silently stops drawing. */
  const [tool, setTool] = useState<'freehand' | 'line' | 'arrow' | 'circle' | null>(null);
  const [color, setColor] = useState<'#ef4444' | '#facc15' | '#7eb6ff'>('#facc15');
  const clearDrawingRef = useRef<(() => void) | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /* ── Recording ── */
  const [recState, setRecState] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  const [recError, setRecError] = useState<string | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [saveTarget, setSaveTarget] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* The rAF composite loop recurses into ITS OWN closure, so anything it
     reads from React state is frozen at the moment recording started. The
     active index has to come through a ref or the recording keeps painting
     clip 1 while the program has moved on to clip 2. */
  const activeIdxRef = useRef(0);
  /* Clip ids currently parked at the end by the webm duration probe. */
  const probedRef = useRef<Set<string>>(new Set());

  /* Roster — used both by the import browser and the save-target picker. */
  const [players, setPlayers] = useState<Player[]>([]);
  useEffect(() => {
    if (!isCoach) return;
    api.getPlayers()
      .then(p => setPlayers(p.filter((x: Player) => x.positions !== 'COACH')))
      .catch(() => setPlayers([]));
  }, [isCoach]);

  /* ── The timeline as ONE program ──
     Clips play back to back, so the transport has to speak in timeline
     seconds, not clip seconds. Without this the counter and scrubber reset
     at every boundary and three clips read as three separate videos rather
     than one 41-second piece. `clipStarts[i]` is where clip i begins on
     that shared ruler. A clip whose duration hasn't resolved yet counts as
     0 — it slots in at the right place the moment metadata lands. */
  const clipStarts = useMemo(() => {
    let acc = 0;
    return timeline.map(c => { const at = acc; acc += c.durationSec ?? 0; return at; });
  }, [timeline]);
  const totalDuration = useMemo(
    () => timeline.reduce((sum, c) => sum + (c.durationSec ?? 0), 0),
    [timeline]);
  const globalTime = (clipStarts[activeIdx] ?? 0) + clipTime;

  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  const activeClip = timeline[activeIdx] ?? null;
  const activeVideo = () => videoRefs.current[activeIdx] ?? null;
  const anyTainted = timeline.some(c => c.tainted);

  /* ── Pool / timeline mutations ── */
  const addToPool = useCallback((item: MediaItem) => {
    setPool(prev => (prev.some(p => p.key === item.key) ? prev : [...prev, item]));
  }, []);

  const addToTimeline = useCallback((item: MediaItem) => {
    setTimeline(prev => [...prev, {
      id: `${item.key}-${Date.now()}-${prev.length}`,
      media: item,
      durationSec: null,
      tainted: false,
    }]);
  }, []);

  const setClipDuration = useCallback((id: string, d: number) => {
    setTimeline(prev => prev.map(c => (c.id === id ? { ...c, durationSec: d } : c)));
  }, []);

  /**
   * Pull a duration out of an element that may not have one yet.
   *
   * Clips recorded BY this app are MediaRecorder webm, and that container
   * carries no duration in its header — `duration` is Infinity until the
   * browser has scanned to the end. Seeking past the end forces that scan;
   * `durationchange` then fires with the real value and we rewind. Without
   * this every coach-review clip shows "—" and its scrubber is dead.
   */
  const probeDuration = useCallback((el: HTMLVideoElement, id: string) => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setClipDuration(id, el.duration);
      return;
    }
    if (el.paused) {
      probedRef.current.add(id);
      try { el.currentTime = 1e7; } catch { /* not seekable yet */ }
    }
  }, [setClipDuration]);

  /* NOTE ON BOTH HANDLERS BELOW: they compute the next timeline and the next
     active index OUTSIDE the state updaters and then set each once.

     Do not fold the index maths back inside a setTimeline(prev => …). React
     double-invokes updaters under StrictMode, so any non-idempotent step in
     there runs twice in dev and once in production — the two builds then
     disagree. That is exactly how deleting a clip walked the playhead two
     slots instead of one. */
  const removeClip = (id: string) => {
    const removed = timeline.findIndex(c => c.id === id);
    if (removed < 0) return;
    const next = timeline.filter(c => c.id !== id);
    /* A clip pulled out from BEFORE the active one shifts every later index
       down by one; without this the preview silently swaps to a different
       video. Removing the active clip keeps the index, which now lands on
       whatever followed it. */
    const shifted = removed < activeIdx ? activeIdx - 1 : activeIdx;
    setTimeline(next);
    setActiveIdx(Math.max(0, Math.min(shifted, next.length - 1)));
    if (next.length === 0) {
      /* Nothing left to play, and the drawing canvas the recorder composites
         from has just unmounted — drop the stale handle. */
      videoRefs.current.forEach(v => v?.pause());
      setPlaying(false);
      setClipTime(0);
      drawCanvasRef.current = null;
    }
  };

  const moveClip = (id: string, dir: -1 | 1) => {
    const i = timeline.findIndex(c => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= timeline.length) return;
    const next = [...timeline];
    [next[i], next[j]] = [next[j], next[i]];
    setTimeline(next);
    /* Follow the clip being moved so the preview does not jump to whatever
       slid into the old slot. */
    setActiveIdx(activeIdx === i ? j : activeIdx === j ? i : activeIdx);
  };
  /* ── Transport ── */
  const play = useCallback(() => {
    const v = activeVideo();
    if (!v) return;
    v.playbackRate = rate;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }, [activeIdx, rate]);

  const pause = useCallback(() => {
    videoRefs.current.forEach(v => v?.pause());
    setPlaying(false);
  }, []);

  const goToClip = useCallback((idx: number, autoplay: boolean) => {
    if (idx < 0 || idx >= timeline.length) { pause(); return; }
    videoRefs.current.forEach((v, i) => { if (v && i !== idx) v.pause(); });
    setActiveIdx(idx);
    const v = videoRefs.current[idx];
    if (v) {
      try { v.currentTime = 0; } catch { /* not seekable yet */ }
      v.playbackRate = rate;
      if (autoplay) v.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [timeline.length, rate, pause]);

  /**
   * Seek by TIMELINE seconds: find which clip that lands in, switch to it
   * if needed, and offset into it. This is what makes one scrubber drag
   * across a clip boundary behave like scrubbing a single video.
   */
  const seekGlobal = useCallback((t: number, keepPlaying: boolean) => {
    if (timeline.length === 0) return;
    const clamped = Math.max(0, Math.min(t, totalDuration));
    let idx = 0;
    for (let i = 0; i < timeline.length; i++) {
      const start = clipStarts[i];
      const end = start + (timeline[i].durationSec ?? 0);
      /* `< end` so a boundary hit lands on the NEXT clip's first frame
         rather than the previous clip's last one. */
      if (clamped < end || i === timeline.length - 1) { idx = i; break; }
    }
    const offset = clamped - clipStarts[idx];
    if (idx !== activeIdx) {
      videoRefs.current.forEach((v, i) => { if (v && i !== idx) v.pause(); });
      setActiveIdx(idx);
    }
    const v = videoRefs.current[idx];
    if (v) {
      try { v.currentTime = offset; } catch { /* not seekable yet */ }
      v.playbackRate = rate;
      if (keepPlaying) v.play().then(() => setPlaying(true)).catch(() => {});
    }
    setClipTime(offset);
  }, [timeline, clipStarts, totalDuration, activeIdx, rate]);

  /* Keep every mounted element on the current rate so a mid-play switch
     doesn't snap back to 1x. */
  useEffect(() => {
    videoRefs.current.forEach(v => { if (v) v.playbackRate = rate; });
  }, [rate, timeline.length]);

  /* ── Composite canvas (what Record captures) ── */
  const drawFrame = useCallback(() => {
    const c = compositeRef.current;
    if (c) {
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, c.width, c.height);
        const v = videoRefs.current[activeIdxRef.current];
        if (v && v.videoWidth > 0) {
          /* Letterbox into the 16:9 frame rather than stretching — a
             portrait phone clip has to keep its shape. */
          const scale = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
          const w = v.videoWidth * scale;
          const h = v.videoHeight * scale;
          const x = (c.width - w) / 2;
          const y = (c.height - h) / 2;
          try {
            ctx.drawImage(v, x, y, w, h);
            /* Drawings sit in their own canvas sized to the RENDERED video
               box, so it maps onto the same letterboxed rect. */
            const dc = drawCanvasRef.current;
            if (dc && dc.width > 0 && dc.height > 0) ctx.drawImage(dc, x, y, w, h);
          } catch { /* a tainted frame — Record is already blocked for these */ }
        }
      }
    }
    rafRef.current = requestAnimationFrame(drawFrame);
    /* No deps: the loop must stay the SAME function for its whole life, and
       everything it reads is a ref for exactly that reason. */
  }, []);

  const startRecording = useCallback(async () => {
    if (timeline.length === 0) return;
    setRecError(null);
    setRecState('starting');
    try {
      if (!compositeRef.current) compositeRef.current = document.createElement('canvas');
      const c = compositeRef.current;
      c.width = 1280;
      c.height = 720;

      /* Mic first — if it's blocked, bail before starting the canvas pump so
         we never produce a silent "narration". */
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      audioStreamRef.current = audioStream;
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length === 0) throw new Error('No microphone detected — connect a mic and try again.');

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      drawFrame();

      const canvasStream = c.captureStream(30);
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].find(m => MediaRecorder.isTypeSupported(m)) ?? '';

      chunksRef.current = [];
      const recorder = mime ? new MediaRecorder(combined, { mimeType: mime }) : new MediaRecorder(combined);
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        audioStreamRef.current?.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mime || 'video/webm' });
        chunksRef.current = [];
        setPendingBlob(blob);
        setRecState('idle');
      };
      recorderRef.current = recorder;
      recorder.start();

      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
      setRecState('recording');

      /* Start the program from the top so the recording opens on clip one. */
      goToClip(0, true);
    } catch (err: any) {
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setRecError(err?.message || 'Could not start recording.');
      setRecState('idle');
    }
  }, [timeline.length, drawFrame, goToClip]);

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    recorderRef.current?.stop();
    recorderRef.current = null;
    pause();
  }, [pause]);

  /* Tear down on unmount — a live mic or rAF loop outliving the page is the
     kind of leak nobody notices until the tab is hot. */
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  /* Default the save target to the first athlete-sourced clip. */
  useEffect(() => {
    if (!pendingBlob) return;
    const fromClip = timeline.find(c => c.media.playerId)?.media.playerId;
    setSaveTarget(prev => prev || fromClip || '');
  }, [pendingBlob, timeline]);

  const saveRecording = useCallback(async () => {
    if (!pendingBlob || !saveTarget) return;
    setRecState('saving');
    setRecError(null);
    try {
      const file = new File([pendingBlob], `video-editor-${Date.now()}.webm`, { type: pendingBlob.type || 'video/webm' });
      const title = `Coach Review — Editor — ${new Date().toLocaleDateString()}`;
      const category = timeline.find(c => c.media.category)?.media.category || 'HITTING';
      await api.uploadVideo(file, saveTarget, title, category);
      setPendingBlob(null);
      setSaveMsg('Saved to the athlete’s videos.');
      setRecState('idle');
    } catch (err: any) {
      setRecError(err?.message || 'Upload failed.');
      setRecState('idle');
    }
  }, [pendingBlob, saveTarget, timeline]);

  if (isLoading || !user || !isCoach) return null;

  const recording = recState === 'recording';

  return (
    <div>
      <PageHeader
        size="hero"
        eyebrow="Coach Tools"
        title="Video"
        titleAccent="Editor"
        actions={
          <Link href="/" style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            textDecoration: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border)',
          }}>Dashboard</Link>
        }
      />

      <div style={{ padding: '0 18px 28px' }}>
        {/* ── Top row: pool (1/3) + preview (2/3) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 14, alignItems: 'stretch' }}>
          {/* ── Uploaded pool ── */}
          <section style={panel}>
            <div style={panelHead}>
              <span style={panelTitle}>Uploaded</span>
              <button type="button" onClick={() => setImportOpen(true)} className={s.primaryBtn}>+ Import</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
              {pool.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  Nothing imported yet. Use <strong>Import</strong> to pull clips from an
                  athlete, the drill library, or Major League video.
                </p>
              )}
              {pool.map(item => (
                <div key={item.key} style={poolRow}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {item.sublabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Add to timeline"
                    onClick={() => addToTimeline(item)}
                    className={s.ghostBtn}
                    style={{ ...iconBtn, fontSize: 16, fontWeight: 800 }}
                  >+</button>
                </div>
              ))}
            </div>
          </section>

          {/* ── Preview ── */}
          <section style={panel}>
            <div style={panelHead}>
              <span style={panelTitle}>Created Video Preview</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace" }}>
                {timeline.length === 0
                  ? 'Empty timeline'
                  : `${fmt(totalDuration)} · ${timeline.length} clip${timeline.length === 1 ? '' : 's'} · on ${activeIdx + 1}`}
              </span>
            </div>

            <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '16 / 9' }}>
              {timeline.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                  Add a clip to the timeline to start building.
                </div>
              )}
              {/* EVERY clip stays mounted and preloaded; only the active one is
                  visible. See the header note on clip switches. */}
              {timeline.map((clip, i) => (
                <video
                  key={clip.id}
                  ref={el => { videoRefs.current[i] = el; }}
                  src={clip.media.url}
                  crossOrigin={clip.tainted ? undefined : 'anonymous'}
                  preload="auto"
                  playsInline
                  onLoadedMetadata={e => probeDuration(e.target as HTMLVideoElement, clip.id)}
                  onDurationChange={e => {
                    const el = e.target as HTMLVideoElement;
                    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
                    setClipDuration(clip.id, el.duration);
                    /* Undo the probe seek — otherwise the clip sits parked at
                       its last frame and Play looks like it does nothing.
                       Checked against the probe set rather than comparing
                       currentTime to duration: the browser CLAMPS the seek to
                       exactly duration, so a `>` test never fires. */
                    if (probedRef.current.has(clip.id)) {
                      probedRef.current.delete(clip.id);
                      try { el.currentTime = 0; } catch { /* ignore */ }
                    }
                  }}
                  onError={() => {
                    /* Most likely the source sent no CORS headers, which makes
                       an anonymous request fail outright. Retry plainly and
                       mark it — the clip plays, but it can't be recorded. */
                    if (!clip.tainted) {
                      setTimeline(prev => prev.map(c => c.id === clip.id ? { ...c, tainted: true } : c));
                    }
                  }}
                  onTimeUpdate={e => { if (i === activeIdx) setClipTime((e.target as HTMLVideoElement).currentTime); }}
                  onEnded={() => {
                    if (i !== activeIdx) return;
                    /* Roll into the next clip — this is what makes the
                       timeline play as one program. */
                    if (activeIdx + 1 < timeline.length) goToClip(activeIdx + 1, true);
                    else setPlaying(false);
                  }}
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'contain',
                    visibility: i === activeIdx ? 'visible' : 'hidden',
                  }}
                />
              ))}

              {/* Drawing overlay rides on the active element. */}
              {activeClip && (
                <VideoDrawingOverlay
                  videoRef={{ current: videoRefs.current[activeIdx] ?? null }}
                  externalTool={tool}
                  externalColor={color}
                  hideToolbar
                  onCanvasReady={c => { drawCanvasRef.current = c; }}
                  onClearReady={fn => { clearDrawingRef.current = fn; }}
                />
              )}

              {recording && (
                <div style={{
                  position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '5px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.66)',
                  color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: '#ef4444' }} />
                  REC {fmt(recSeconds)}
                </div>
              )}
            </div>

            {/* ── Transport ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className={s.ghostBtn} style={iconBtn} title="Previous clip" disabled={!activeClip}
                onClick={() => goToClip(activeIdx - 1, playing)}>⏮</button>
              <button type="button" className={s.primaryBtn} style={{ minWidth: 74 }} disabled={!activeClip}
                onClick={() => (playing ? pause() : play())}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button type="button" className={s.ghostBtn} style={iconBtn} title="Next clip" disabled={!activeClip}
                onClick={() => goToClip(activeIdx + 1, playing)}>⏭</button>

              {/* One ruler across the WHOLE timeline — dragging past a clip's
                  end walks into the next clip instead of stopping dead. */}
              <input
                type="range" min={0} max={totalDuration || 0} step={0.05} value={globalTime}
                disabled={timeline.length === 0}
                onChange={e => seekGlobal(parseFloat(e.target.value), playing)}
                style={{ flex: 1, minWidth: 120 }}
              />
              <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text-muted)', minWidth: 84, textAlign: 'right' }}>
                {fmt(globalTime)} / {fmt(totalDuration)}
              </span>

              <select value={rate} onChange={e => setRate(parseFloat(e.target.value))} className={s.selectBox} style={selectBox} title="Playback speed">
                {RATES.map(r => <option key={r} value={r}>{r}x</option>)}
              </select>
            </div>

            {/* ── Draw tools + Record ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {(['freehand', 'line', 'arrow', 'circle'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTool(tool === t ? null : t)}
                  className={tool === t ? s.activeBtn : s.ghostBtn}
                  style={{ ...iconBtn, textTransform: 'capitalize', width: 'auto', padding: '0 12px', fontSize: 11 }}>
                  {t}
                </button>
              ))}
              {(['#ef4444', '#facc15', '#7eb6ff'] as const).map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} title="Draw colour"
                  style={{
                    width: 22, height: 22, borderRadius: 999, background: c, cursor: 'pointer',
                    border: color === c ? '2px solid var(--text)' : '1px solid var(--border)',
                  }} />
              ))}
              <button type="button" className={s.ghostBtn} style={iconBtn} title="Clear drawings" onClick={() => clearDrawingRef.current?.()}>⌫</button>

              <div style={{ flex: 1 }} />

              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={timeline.length === 0 || anyTainted || recState !== 'idle'}
                  title={anyTainted ? 'A clip on the timeline can’t be recorded (see the warning below)' : 'Record the preview with your voice'}
                  className={s.recordBtn}
                >● Record</button>
              ) : (
                <button type="button" onClick={stopRecording} className={s.recordBtn}>
                  ■ Stop
                </button>
              )}
            </div>

            {anyTainted && (
              <p style={warnText}>
                One or more clips had to load without CORS, so the browser won’t let
                them be captured. They still play here — remove them from the timeline
                to record.
              </p>
            )}
            {recError && <p style={{ ...warnText, color: '#b3303c' }}>{recError}</p>}
            {saveMsg && <p style={{ ...warnText, color: 'var(--text-secondary)' }}>{saveMsg}</p>}
          </section>
        </div>

        {/* ── Timeline ── */}
        <section style={{ ...panel, marginTop: 14 }}>
          <div style={panelHead}>
            <span style={panelTitle}>Timeline</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {timeline.length === 0 ? 'No clips' : `${timeline.length} clip${timeline.length === 1 ? '' : 's'} · ${fmt(totalDuration)}`}
            </span>
          </div>

          {timeline.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Press <strong>+</strong> on an imported clip to drop it here. Clips play top
              to bottom, left to right.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
              {timeline.map((clip, i) => {
                const isActive = i === activeIdx;
                return (
                  <div key={clip.id} style={{
                    /* Width tracks duration so the strip reads like a timeline,
                       with a floor so a one-second clip stays clickable. */
                    flex: `0 0 ${Math.max(128, Math.round((clip.durationSec ?? 4) * 26))}px`,
                    border: `1px solid ${isActive ? 'var(--text)' : 'var(--border)'}`,
                    background: isActive ? 'rgba(127,127,127,0.14)' : 'rgba(127,127,127,0.05)',
                    borderRadius: 9, padding: 9,
                  }}>
                    <button type="button" onClick={() => goToClip(i, false)} style={{
                      display: 'block', width: '100%', textAlign: 'left', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, marginBottom: 7,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {i + 1}. {clip.media.label}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace" }}>
                        {/* Where this clip sits on the shared ruler, so the strip
                            reads as one program rather than a pile of clips. */}
                        {clip.durationSec == null ? '—' : `${fmt(clipStarts[i])} → ${fmt(clipStarts[i] + clip.durationSec)}`}
                        {clip.tainted && ' · no capture'}
                      </div>
                    </button>

                    {/* Playhead: fills as this clip plays, so you can see the
                        program move from block to block. */}
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(127,127,127,0.25)', marginBottom: 7, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${i < activeIdx ? 100 : i > activeIdx ? 0
                          : Math.min(100, ((clipTime / (clip.durationSec || 1)) * 100))}%`,
                        background: 'var(--text)',
                      }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className={s.ghostBtn} style={miniBtn} title="Move left" onClick={() => moveClip(clip.id, -1)}>←</button>
                      <button type="button" className={s.ghostBtn} style={miniBtn} title="Move right" onClick={() => moveClip(clip.id, 1)}>→</button>
                      <button type="button" className={s.ghostBtn} style={miniBtn} title="Remove" onClick={() => removeClip(clip.id)}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {importOpen && (
        <ImportBrowser
          players={players}
          onClose={() => setImportOpen(false)}
          onPick={item => { addToPool(item); }}
        />
      )}

      {pendingBlob && (
        <SaveDialog
          players={players}
          target={saveTarget}
          setTarget={setSaveTarget}
          saving={recState === 'saving'}
          blob={pendingBlob}
          onDiscard={() => setPendingBlob(null)}
          onSave={saveRecording}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPORT BROWSER — athletes / drills / major league
   ═══════════════════════════════════════════════════════════════════════════ */
function ImportBrowser({ players, onClose, onPick }: {
  players: Player[];
  onClose: () => void;
  onPick: (item: MediaItem) => void;
}) {
  const [tab, setTab] = useState<MediaSource>('ATHLETE');
  const [athleteId, setAthleteId] = useState('');
  const [athleteVideos, setAthleteVideos] = useState<Video[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [mlb, setMlb] = useState<MlbPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) =>
      (a.lastName || '').localeCompare(b.lastName || '') ||
      (a.firstName || '').localeCompare(b.firstName || '')),
    [players]);

  useEffect(() => {
    if (tab !== 'ATHLETE' || !athleteId) { setAthleteVideos([]); return; }
    setLoading(true);
    api.getPlayerVideos(athleteId)
      .then((v: Video[]) => setAthleteVideos(v))
      .catch(() => setAthleteVideos([]))
      .finally(() => setLoading(false));
  }, [tab, athleteId]);

  useEffect(() => {
    if (tab !== 'DRILL' || drills.length > 0) return;
    setLoading(true);
    api.getDrills()
      .then((d: Drill[]) => setDrills(d))
      .catch(() => setDrills([]))
      .finally(() => setLoading(false));
  }, [tab, drills.length]);

  useEffect(() => {
    if (tab !== 'MLB' || mlb.length > 0) return;
    setLoading(true);
    api.getMlbPlayers()
      .then((p: MlbPlayer[]) => setMlb(p))
      .catch(() => setMlb([]))
      .finally(() => setLoading(false));
  }, [tab, mlb.length]);

  const take = (item: MediaItem) => {
    onPick(item);
    setAdded(prev => new Set(prev).add(item.key));
  };

  const rows: MediaItem[] = useMemo(() => {
    if (tab === 'ATHLETE') {
      const p = players.find(x => x.id === athleteId);
      return athleteVideos
        .filter(v => v.originalUrl)
        .map(v => ({
          key: `athlete:${v.id}`,
          url: v.originalUrl as string,
          label: v.title || 'Untitled clip',
          sublabel: `${p ? `${p.firstName} ${p.lastName}` : 'Athlete'} · ${v.category || 'video'}`,
          source: 'ATHLETE' as const,
          playerId: v.playerId,
          category: v.category,
        }));
    }
    if (tab === 'DRILL') {
      return drills
        .filter(d => d.videoUrl)
        .map(d => ({
          key: `drill:${d.id}`,
          url: d.videoUrl as string,
          label: d.name,
          sublabel: `Drill · ${d.category || d.tab}`,
          source: 'DRILL' as const,
        }));
    }
    return mlb.flatMap(p => (p.videos || [])
      .filter(v => v.url)
      .map(v => ({
        key: `mlb:${v.id}`,
        url: v.url as string,
        label: v.title || p.name,
        sublabel: `${p.name} · ${v.category || 'MLB'}`,
        source: 'MLB' as const,
      })));
  }, [tab, players, athleteId, athleteVideos, drills, mlb]);

  return (
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: 'var(--text)' }}>Import clips</strong>
          <button type="button" onClick={onClose} className={s.ghostBtn} style={iconBtn}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([['ATHLETE', 'Athletes'], ['DRILL', 'Drills'], ['MLB', 'Major League']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={tab === k ? s.activeBtn : s.ghostBtn}
              style={{ ...iconBtn, width: 'auto', padding: '0 14px', fontSize: 12 }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'ATHLETE' && (
          <select value={athleteId} onChange={e => setAthleteId(e.target.value)} className={s.selectBox} style={{ ...selectBox, width: '100%', marginBottom: 10 }}>
            <option value="">Select athlete…</option>
            {sortedPlayers.map(p => (
              <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>
            ))}
          </select>
        )}

        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
          {!loading && rows.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {tab === 'ATHLETE' && !athleteId ? 'Pick an athlete to see their clips.' : 'No playable clips here.'}
            </p>
          )}
          {rows.map(item => (
            <div key={item.key} style={poolRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.sublabel}</div>
              </div>
              <button type="button" onClick={() => take(item)} disabled={added.has(item.key)}
                className={s.ghostBtn}
                style={{ ...iconBtn, width: 'auto', padding: '0 12px', fontSize: 11, opacity: added.has(item.key) ? 0.5 : 1 }}>
                {added.has(item.key) ? 'Added' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SAVE DIALOG
   ═══════════════════════════════════════════════════════════════════════════ */
function SaveDialog({ players, target, setTarget, saving, blob, onDiscard, onSave }: {
  players: Player[];
  target: string;
  setTarget: (v: string) => void;
  saving: boolean;
  blob: Blob;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  /* A MediaRecorder webm has no duration in its header and no decoded frame
     until something asks for one, so a plain <video src=blob> shows a black
     box with a dead scrubber. Seeking past the end forces the browser to
     scan (which fixes the duration), then a nudge to 0.01s forces it to
     decode and paint frame one. */
  const probed = useRef(false);
  const [dur, setDur] = useState<number | null>(null);
  const paintFirstFrame = (el: HTMLVideoElement) => {
    try { el.currentTime = 0.01; } catch { /* not seekable yet */ }
  };
  const sorted = [...players].sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || '') ||
    (a.firstName || '').localeCompare(b.firstName || ''));

  return (
    <div className={s.overlay}>
      <div className={s.modal}>
        <strong style={{ fontSize: 15, color: 'var(--text)', display: 'block', marginBottom: 10 }}>Save recording</strong>
        <video
          src={url}
          controls
          playsInline
          preload="auto"
          onLoadedMetadata={e => {
            const el = e.target as HTMLVideoElement;
            if (Number.isFinite(el.duration) && el.duration > 0) {
              setDur(el.duration);
              paintFirstFrame(el);
            } else {
              probed.current = true;
              try { el.currentTime = 1e7; } catch { /* not seekable yet */ }
            }
          }}
          onDurationChange={e => {
            const el = e.target as HTMLVideoElement;
            if (!Number.isFinite(el.duration) || el.duration <= 0) return;
            setDur(el.duration);
            if (probed.current) { probed.current = false; paintFirstFrame(el); }
          }}
          style={{ width: '100%', borderRadius: 9, background: '#000', marginBottom: 8 }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px', fontFamily: "'DM Mono', monospace" }}>
          {dur == null ? 'Reading length…' : `${fmt(dur)} recorded`}
        </p>
        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>
          Save to athlete
        </label>
        <select value={target} onChange={e => setTarget(e.target.value)} className={s.selectBox} style={{ ...selectBox, width: '100%', marginBottom: 6 }}>
          <option value="">Select athlete…</option>
          {sorted.map(p => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>)}
        </select>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          It lands in that athlete’s videos as a Coach Review, the same as a narration
          recorded from the video library.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onDiscard} disabled={saving} className={s.ghostBtn} style={{ ...iconBtn, width: 'auto', padding: '0 14px', fontSize: 12 }}>Discard</button>
          <a href={url} download="video-editor.webm" className={s.ghostBtn} style={{ ...iconBtn, width: 'auto', padding: '0 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Download</a>
          <button type="button" onClick={onSave} disabled={saving || !target} className={s.primaryBtn}>
            {saving ? 'Saving…' : 'Save to profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Inline style tokens ── */
const panel: React.CSSProperties = {
  background: 'var(--bubble-chrome-bg, rgba(127,127,127,0.04))',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
};
const panelHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
};
const panelTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)',
};
const poolRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  border: '1px solid var(--border)', borderRadius: 9, padding: '7px 9px',
};
/* GEOMETRY ONLY — the border/background/colour live in .ghostBtn.
   Keeping them inline here is what made the selected-tab pill invisible:
   an inline `background: transparent` outranks .activeBtn no matter what
   the class says. Anything that can be SELECTED must not set colour inline. */
const iconBtn: React.CSSProperties = {
  height: 30, minWidth: 30, borderRadius: 8, cursor: 'pointer',
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
};
/* The filled-button and modal tokens moved into page.module.css — they need
   a [data-theme] override, and the variables an inline style could reach
   either hold a gradient (--bubble-chrome-bg) or nothing at all
   (--panel-bg). See the note at the top of that file. */
const miniBtn: React.CSSProperties = {
  flex: 1, height: 22, borderRadius: 6, cursor: 'pointer',
  fontSize: 11, fontFamily: 'inherit',
};
const selectBox: React.CSSProperties = {
  height: 30, borderRadius: 8, padding: '0 8px', fontSize: 12, fontFamily: 'inherit',
};

const warnText: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, margin: '6px 0 0',
};
