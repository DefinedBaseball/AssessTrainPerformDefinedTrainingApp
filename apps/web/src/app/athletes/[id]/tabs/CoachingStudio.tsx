'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Section, SectionHeader } from '@/components/assessment';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { TabProps } from '../helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   COACHING STUDIO
   - Load any video (athlete / other / MLB / drill / local upload) for review
   - Frame-by-frame transport, variable playback speed
   - Canvas drawing overlay (annotations stored with their video timestamp)
   - Voice-over recording via MediaRecorder
   - Side-by-side comparison with optional synced playback
   - Save → creates a COACHING report on the player profile
   ─────────────────────────────────────────────────────────────────────────── */

interface VideoSrc {
  id: string;            // 'video:<uuid>' for stored, 'local:<n>' for local file
  url: string;
  title: string;
  category?: string;
  origin: 'athlete' | 'other' | 'mlb' | 'drill' | 'local';
}

interface AnnotationPoint { x: number; y: number; }

interface Annotation {
  id: string;
  pane: 'primary' | 'compare';
  color: string;
  width: number;
  points: AnnotationPoint[];
  startTime: number;     // video time when annotation started (seconds)
  endTime: number;       // video time when stroke finished
}

interface VoiceOverSegment {
  id: string;
  url: string;           // local object-url (not persisted yet)
  durationMs: number;
  startVideoTime: number; // video time when recording began
  createdAt: string;
}

const ANNOTATION_COLORS = [
  { hex: '#FF4444', label: 'Red' },
  { hex: '#FFD93D', label: 'Yellow' },
  { hex: '#4ADE80', label: 'Green' },
  { hex: '#60A5FA', label: 'Blue' },
  { hex: '#FFFFFF', label: 'White' },
];

export function CoachingStudio({
  player, videos, isCoach, onSaved, onRefresh,
}: TabProps & { onSaved: () => void }) {
  const { user } = useAuth();

  // ── Video sources ─────────────────────────────────────────────────────────
  const [primarySrc, setPrimarySrc] = useState<VideoSrc | null>(null);
  const [compareSrc, setCompareSrc] = useState<VideoSrc | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [syncCompare, setSyncCompare] = useState(true);

  // ── Playback state (mirrored from primary <video>) ────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fps, setFps] = useState(30);

  // ── Drawing state ─────────────────────────────────────────────────────────
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeColor, setActiveColor] = useState(ANNOTATION_COLORS[0].hex);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [drawingPane, setDrawingPane] = useState<null | 'primary' | 'compare'>(null);
  const drawingAnnotation = useRef<Annotation | null>(null);

  // ── Voice-over state ──────────────────────────────────────────────────────
  const [voiceOvers, setVoiceOvers] = useState<VoiceOverSegment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordStartRef = useRef<{ wallMs: number; videoTime: number } | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // ── Save flow ─────────────────────────────────────────────────────────────
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const compareVideoRef = useRef<HTMLVideoElement>(null);
  const primaryCanvasRef = useRef<HTMLCanvasElement>(null);
  const compareCanvasRef = useRef<HTMLCanvasElement>(null);
  const localFileCounterRef = useRef(0);

  // ── Browse-videos modal ──────────────────────────────────────────────────
  // Richer alternative to the cramped <select> dropdown. Tracks which slot
  // the picker is opening for so the chosen video drops into the correct
  // pane (primary or compare).
  const [browseOpen, setBrowseOpen] = useState<null | 'primary' | 'compare'>(null);
  const [browseQuery, setBrowseQuery] = useState('');
  const [browseCategory, setBrowseCategory] = useState<string>('all');

  // Source-database browser modals — each pulls from the corresponding
  // backend DB (MlbVideo / Drill / other Player's videos) so coaches can
  // study or compare against real material instead of re-uploading files.
  const [mlbBrowseOpen, setMlbBrowseOpen] = useState<null | 'primary' | 'compare'>(null);
  const [drillBrowseOpen, setDrillBrowseOpen] = useState<null | 'primary' | 'compare'>(null);
  const [otherAthleteOpen, setOtherAthleteOpen] = useState<null | 'primary' | 'compare'>(null);

  // Athlete's videos = those with a playable URL
  const athleteVideos = useMemo(
    () => videos.filter(v => (v.originalUrl || v.hlsUrl) && (v.status === 'READY' || v.status == null)),
    [videos],
  );

  // ── Video element lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    const v = primaryVideoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onDur  = () => setDuration(isFinite(v.duration) ? v.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onDur);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onDur);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [primarySrc?.id]);

  // Mirror primary -> compare when sync is enabled
  useEffect(() => {
    if (!syncCompare || !showCompare) return;
    const c = compareVideoRef.current;
    if (!c) return;
    if (Math.abs(c.currentTime - currentTime) > 0.05) c.currentTime = currentTime;
  }, [currentTime, syncCompare, showCompare]);

  useEffect(() => {
    primaryVideoRef.current && (primaryVideoRef.current.playbackRate = playbackRate);
    compareVideoRef.current && (compareVideoRef.current.playbackRate = playbackRate);
  }, [playbackRate, primarySrc?.id, compareSrc?.id]);

  // ── Canvas redraw ─────────────────────────────────────────────────────────
  const drawAnnotations = useCallback((pane: 'primary' | 'compare') => {
    const canvas = pane === 'primary' ? primaryCanvasRef.current : compareCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const list = annotations.filter(a => a.pane === pane);
    // Also draw the in-progress stroke if it's on this pane
    const strokes = drawingAnnotation.current && drawingAnnotation.current.pane === pane
      ? [...list, drawingAnnotation.current]
      : list;
    for (const a of strokes) {
      if (a.points.length < 1) continue;
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.points[0].x, a.points[0].y);
      for (let i = 1; i < a.points.length; i++) {
        ctx.lineTo(a.points[i].x, a.points[i].y);
      }
      ctx.stroke();
      // Single-point annotation → render a dot
      if (a.points.length === 1) {
        ctx.beginPath();
        ctx.arc(a.points[0].x, a.points[0].y, a.width / 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [annotations]);

  // Re-draw both panes whenever annotations change
  useEffect(() => {
    drawAnnotations('primary');
    drawAnnotations('compare');
  }, [drawAnnotations, primarySrc?.id, compareSrc?.id, showCompare]);

  // Resize canvases to match video display size
  const resizeCanvas = useCallback((pane: 'primary' | 'compare') => {
    const v = pane === 'primary' ? primaryVideoRef.current : compareVideoRef.current;
    const c = pane === 'primary' ? primaryCanvasRef.current : compareCanvasRef.current;
    if (!v || !c) return;
    const r = v.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (c.width !== Math.floor(r.width) || c.height !== Math.floor(r.height))) {
      c.width = Math.floor(r.width);
      c.height = Math.floor(r.height);
      drawAnnotations(pane);
    }
  }, [drawAnnotations]);

  useEffect(() => {
    const handler = () => { resizeCanvas('primary'); resizeCanvas('compare'); };
    handler();
    const id = setInterval(handler, 600); // cheap layout sync
    window.addEventListener('resize', handler);
    return () => { clearInterval(id); window.removeEventListener('resize', handler); };
  }, [resizeCanvas, primarySrc?.id, compareSrc?.id, showCompare]);

  // ── Drawing handlers ──────────────────────────────────────────────────────
  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): AnnotationPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(pane: 'primary' | 'compare') {
    return (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!primarySrc) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = (pane === 'primary' ? primaryVideoRef.current : compareVideoRef.current)?.currentTime ?? currentTime;
      drawingAnnotation.current = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pane,
        color: activeColor,
        width: strokeWidth,
        points: [pointFromEvent(e)],
        startTime: t,
        endTime: t,
      };
      setDrawingPane(pane);
      drawAnnotations(pane);
    };
  }

  function onPointerMove(pane: 'primary' | 'compare') {
    return (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cur = drawingAnnotation.current;
      if (!cur || cur.pane !== pane || drawingPane !== pane) return;
      cur.points.push(pointFromEvent(e));
      drawAnnotations(pane);
    };
  }

  function onPointerUp(pane: 'primary' | 'compare') {
    return (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cur = drawingAnnotation.current;
      if (!cur || cur.pane !== pane) return;
      const t = (pane === 'primary' ? primaryVideoRef.current : compareVideoRef.current)?.currentTime ?? currentTime;
      cur.endTime = t;
      setAnnotations(prev => [...prev, cur]);
      drawingAnnotation.current = null;
      setDrawingPane(null);
    };
  }

  function clearAnnotations() {
    if (!annotations.length) return;
    if (!confirm('Clear all drawings?')) return;
    setAnnotations([]);
  }

  function undoLast() {
    setAnnotations(prev => prev.slice(0, -1));
  }

  // ── Voice-over: record / stop ─────────────────────────────────────────────
  async function startRecording() {
    setSaveError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Your browser does not support microphone capture.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      recordChunksRef.current = [];
      recordStartRef.current = {
        wallMs: Date.now(),
        videoTime: primaryVideoRef.current?.currentTime ?? currentTime,
      };
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        const start = recordStartRef.current;
        const seg: VoiceOverSegment = {
          id: `vo-${Date.now()}`,
          url: URL.createObjectURL(blob),
          durationMs: start ? Date.now() - start.wallMs : 0,
          startVideoTime: start?.videoTime ?? 0,
          createdAt: new Date().toISOString(),
        };
        setVoiceOvers(prev => [...prev, seg]);
        // free mic
        audioStreamRef.current?.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
      };
      rec.start();
      setIsRecording(true);
    } catch (e) {
      alert('Could not access microphone: ' + (e as Error).message);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setIsRecording(false);
  }

  function deleteVoiceOver(id: string) {
    setVoiceOvers(prev => {
      const target = prev.find(v => v.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter(v => v.id !== id);
    });
  }

  // ── Source picker handlers ────────────────────────────────────────────────
  function pickAthleteVideo(slot: 'primary' | 'compare', vId: string) {
    const v = athleteVideos.find(x => x.id === vId);
    if (!v) return;
    const url = v.originalUrl || v.hlsUrl;
    if (!url) return;
    const src: VideoSrc = {
      id: `video:${v.id}`,
      url,
      title: v.title,
      category: v.category,
      origin: 'athlete',
    };
    if (slot === 'primary') { setPrimarySrc(src); setAnnotations(a => a.filter(x => x.pane !== 'primary')); }
    else                    { setCompareSrc(src); setAnnotations(a => a.filter(x => x.pane !== 'compare')); }
  }

  function pickLocalFile(slot: 'primary' | 'compare', file: File, origin: VideoSrc['origin'] = 'local') {
    const url = URL.createObjectURL(file);
    const n = ++localFileCounterRef.current;
    const src: VideoSrc = {
      id: `local:${n}`,
      url,
      title: file.name,
      origin,
    };
    if (slot === 'primary') { setPrimarySrc(src); setAnnotations(a => a.filter(x => x.pane !== 'primary')); }
    else                    { setCompareSrc(src); setAnnotations(a => a.filter(x => x.pane !== 'compare')); }
  }

  /**
   * Load a video into the studio from an existing URL — used by the MLB,
   * Drill, and Other-Athlete browsers. The id prefix tells the save flow
   * what database the source came from so we can persist a stable
   * reference (vs `local:` blobs which die with the page).
   */
  function loadFromUrl(
    slot: 'primary' | 'compare',
    opts: { id: string; url: string; title: string; category?: string; origin: VideoSrc['origin'] },
  ) {
    const src: VideoSrc = {
      id: opts.id,
      url: opts.url,
      title: opts.title,
      category: opts.category,
      origin: opts.origin,
    };
    if (slot === 'primary') { setPrimarySrc(src); setAnnotations(a => a.filter(x => x.pane !== 'primary')); }
    else                    { setCompareSrc(src); setAnnotations(a => a.filter(x => x.pane !== 'compare')); }
  }

  // ── Transport controls ────────────────────────────────────────────────────
  const playPause = () => {
    const v = primaryVideoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      if (syncCompare && showCompare) compareVideoRef.current?.play();
    } else {
      v.pause();
      compareVideoRef.current?.pause();
    }
  };

  const stepFrames = (delta: number) => {
    const v = primaryVideoRef.current;
    if (!v) return;
    const nt = Math.max(0, Math.min(duration || 0, v.currentTime + delta * (1 / fps)));
    v.pause();
    compareVideoRef.current?.pause();
    v.currentTime = nt;
    if (syncCompare && showCompare && compareVideoRef.current) {
      compareVideoRef.current.currentTime = nt;
    }
  };

  const seekRel = (deltaSec: number) => {
    const v = primaryVideoRef.current;
    if (!v) return;
    const nt = Math.max(0, Math.min(duration || 0, v.currentTime + deltaSec));
    v.currentTime = nt;
    if (syncCompare && showCompare && compareVideoRef.current) {
      compareVideoRef.current.currentTime = nt;
    }
  };

  const seekAbsolute = (pct: number) => {
    if (!duration) return;
    const v = primaryVideoRef.current;
    if (!v) return;
    const nt = pct * duration;
    v.currentTime = nt;
    if (syncCompare && showCompare && compareVideoRef.current) {
      compareVideoRef.current.currentTime = nt;
    }
  };

  // ── Save flow ─────────────────────────────────────────────────────────────
  async function saveSession() {
    if (!primarySrc) { setSaveError('Load a primary video before saving.'); return; }
    if (!user) { setSaveError('Not signed in.'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const userId = (user as any).id || (user as any).sub;
      const titleFinal = sessionTitle.trim() ||
        `Coaching · ${primarySrc.title}${compareSrc ? ` vs ${compareSrc.title}` : ''}`;
      const content = {
        title: titleFinal,
        primaryVideoId: primarySrc.id,
        primaryVideoTitle: primarySrc.title,
        primaryVideoOrigin: primarySrc.origin,
        compareVideoId: compareSrc?.id ?? null,
        compareVideoTitle: compareSrc?.title ?? null,
        compareVideoOrigin: compareSrc?.origin ?? null,
        durationSec: duration,
        annotations: annotations.map(a => ({
          pane: a.pane, color: a.color, width: a.width,
          startTime: a.startTime, endTime: a.endTime,
          // points stored as flat arrays for compactness
          points: a.points,
        })),
        voiceOvers: voiceOvers.map(v => ({
          id: v.id,
          durationMs: v.durationMs,
          startVideoTime: v.startVideoTime,
          createdAt: v.createdAt,
          // url is local-only for now; backend persistence is V2
        })),
        notes: sessionNotes,
        savedAt: new Date().toISOString(),
      };
      // Pull videoIds for stored references (not local files)
      const refIds: string[] = [];
      if (primarySrc.id.startsWith('video:')) refIds.push(primarySrc.id.slice('video:'.length));
      if (compareSrc?.id.startsWith('video:')) refIds.push(compareSrc.id.slice('video:'.length));

      await api.createReport({
        playerId: player.id,
        createdById: userId,
        reportType: 'COACHING',
        title: titleFinal,
        content: JSON.stringify(content),
        notes: sessionNotes || undefined,
        videoIds: refIds.length ? refIds.join(',') : undefined,
      });
      onRefresh?.();
      onSaved();
    } catch (e) {
      setSaveError((e as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function fmtTime(t: number) {
    if (!isFinite(t)) return '0:00.00';
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  function SourcePicker({ slot }: { slot: 'primary' | 'compare' }) {
    const cur = slot === 'primary' ? primarySrc : compareSrc;
    return (
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}>
        <span style={{
          fontSize: rem(10), fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {slot === 'primary' ? 'Primary' : 'Compare'}
        </span>

        {/* Browse the athlete's uploaded videos (rich picker with thumbs) */}
        <button
          type="button"
          onClick={() => {
            setBrowseQuery('');
            setBrowseCategory('all');
            setBrowseOpen(slot);
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px',
            background: 'rgba(232,175,52,0.12)',
            border: '1px solid rgba(232,175,52,0.35)',
            borderRadius: 7,
            fontSize: rem(11.5),
            color: 'var(--gold)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
          title="Browse this player's uploaded videos"
        >
          📁 {player.firstName}&apos;s Videos
          <span style={{
            fontSize: rem(10), fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'rgba(232,175,52,0.20)',
          }}>
            {athleteVideos.length}
          </span>
        </button>

        {/* MLB Clip — opens picker against the MlbVideo database */}
        <button
          type="button"
          onClick={() => setMlbBrowseOpen(slot)}
          style={pickerBtnStyle}
          title="Pull a clip from the MLB Video Library"
        >
          + MLB Clip
        </button>

        {/* Drill — opens picker against the Drill library's videoUrls */}
        <button
          type="button"
          onClick={() => setDrillBrowseOpen(slot)}
          style={pickerBtnStyle}
          title="Pull a video from the Drill Library"
        >
          + Drill
        </button>

        {/* Other Athlete — pick another player → pick one of their uploaded videos */}
        <button
          type="button"
          onClick={() => setOtherAthleteOpen(slot)}
          style={pickerBtnStyle}
          title="Compare against another athlete's uploaded videos"
        >
          + Other Athlete
        </button>

        {/* Local file upload — for ad-hoc files outside any database */}
        <label style={pickerBtnStyle}>
          + Upload
          <input
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickLocalFile(slot, f, 'local');
              e.target.value = '';
            }}
          />
        </label>

        {cur && (
          <span style={{
            fontSize: rem(11), color: 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6,
            background: 'rgba(74,222,128,0.10)',
            border: '1px solid rgba(74,222,128,0.30)',
          }}>
            ▶ {cur.title}
          </span>
        )}
      </div>
    );
  }

  function VideoPane({ pane }: { pane: 'primary' | 'compare' }) {
    const src = pane === 'primary' ? primarySrc : compareSrc;
    const videoRef = pane === 'primary' ? primaryVideoRef : compareVideoRef;
    const canvasRef = pane === 'primary' ? primaryCanvasRef : compareCanvasRef;
    return (
      <div style={{
        position: 'relative',
        background: '#000',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        aspectRatio: '16 / 9',
        flex: 1,
        minWidth: 0,
      }}>
        {src ? (
          <>
            <video
              ref={videoRef}
              src={src.url}
              playsInline
              style={{
                width: '100%', height: '100%', display: 'block', objectFit: 'contain',
              }}
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown(pane)}
              onPointerMove={onPointerMove(pane)}
              onPointerUp={onPointerUp(pane)}
              onPointerLeave={onPointerUp(pane)}
              onPointerCancel={onPointerUp(pane)}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
            <div style={{
              position: 'absolute', top: 8, left: 10,
              fontSize: rem(10), fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase',
              padding: '4px 9px',
              background: 'rgba(0,0,0,0.55)',
              color: '#cfe0ff',
              borderRadius: 6,
              pointerEvents: 'none',
            }}>
              {pane === 'primary' ? '▶ PRIMARY' : '↔ COMPARE'} · {src.origin}
            </div>
          </>
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: rem(13), textAlign: 'center', padding: 20,
          }}>
            {pane === 'primary'
              ? 'Pick a primary video above to begin.'
              : 'Pick a compare video to load it side-by-side.'}
          </div>
        )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!isCoach) {
    return (
      <Section>
        <SectionHeader icon="🎬" iconColor="gold" title="Coaching Studio"
          subtitle="Coach-only · sign in as a coach to record analysis sessions" />
        <div style={{
          padding: '24px', border: '1px dashed var(--border)', borderRadius: 12,
          color: 'var(--text-muted)', fontSize: rem(13), textAlign: 'center',
        }}>
          The Coaching Studio is available to coaches only.
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section>
        <SectionHeader
          icon="🎬"
          iconColor="gold"
          title="Coaching Studio"
          subtitle="Frame review · drawing · voice-over · side-by-side compare"
        />

        {/* ── Source pickers ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          <SourcePicker slot="primary" />
          {showCompare ? (
            <SourcePicker slot="compare" />
          ) : (
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 14px',
                background: 'rgba(126,182,255,0.08)',
                border: '1px dashed rgba(126,182,255,0.40)',
                color: 'var(--accent-light)',
                borderRadius: 7,
                fontSize: rem(11.5), fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Add comparison video
            </button>
          )}
        </div>

        {/* ── Video panes ── */}
        <div style={{
          display: 'flex', gap: 14,
          flexDirection: showCompare ? 'row' : 'column',
          flexWrap: 'wrap',
        }}>
          <VideoPane pane="primary" />
          {showCompare && <VideoPane pane="compare" />}
        </div>

        {/* ── Transport controls ── */}
        <div style={{
          marginTop: 14,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <button type="button" onClick={() => stepFrames(-1)} title="Previous frame"
            style={transportBtnStyle}>⏮ −1f</button>
          <button type="button" onClick={() => seekRel(-0.5)} title="Back 0.5s" style={transportBtnStyle}>−0.5s</button>
          <button type="button" onClick={playPause} title="Play / pause"
            style={{ ...transportBtnStyle, padding: '8px 18px', fontSize: rem(14), fontWeight: 800 }}>
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button type="button" onClick={() => seekRel(0.5)}  title="Forward 0.5s" style={transportBtnStyle}>+0.5s</button>
          <button type="button" onClick={() => stepFrames(1)} title="Next frame" style={transportBtnStyle}>+1f ⏭</button>

          <span style={{
            fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: rem(12), color: 'var(--text-muted)', minWidth: 110, textAlign: 'center',
          }}>
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>

          <span style={{ fontSize: rem(11), color: 'var(--text-muted)' }}>Speed</span>
          {[0.25, 0.5, 1, 1.5, 2].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setPlaybackRate(r)}
              style={{
                ...transportBtnStyle,
                background: playbackRate === r ? 'rgba(126,182,255,0.20)' : 'rgba(20,24,32,0.85)',
                borderColor: playbackRate === r ? 'rgba(126,182,255,0.55)' : 'var(--border)',
                fontSize: rem(11.5), padding: '6px 10px',
              }}
            >
              {r}×
            </button>
          ))}

          <span style={{ fontSize: rem(11), color: 'var(--text-muted)' }}>FPS</span>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            style={{
              background: 'rgba(20,24,32,0.85)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '5px 8px',
              borderRadius: 6,
              fontSize: rem(11.5),
            }}
          >
            {[24, 30, 60, 120, 240].map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          {showCompare && (
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
              fontSize: rem(11.5), color: 'var(--text-muted)',
            }}>
              <input type="checkbox" checked={syncCompare}
                     onChange={(e) => setSyncCompare(e.target.checked)} />
              Sync compare playback
            </label>
          )}
        </div>

        {/* Scrubber */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range"
            min={0} max={1} step={0.001}
            value={duration > 0 ? currentTime / duration : 0}
            onChange={(e) => seekAbsolute(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>

        {/* ── Drawing toolbar ── */}
        <div style={{
          marginTop: 14,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <span style={toolLabelStyle}>Draw</span>
          {ANNOTATION_COLORS.map(c => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setActiveColor(c.hex)}
              title={c.label}
              style={{
                width: 26, height: 26, borderRadius: 13,
                background: c.hex,
                border: activeColor === c.hex ? '3px solid #ffffff' : '2px solid rgba(255,255,255,0.25)',
                cursor: 'pointer',
                boxShadow: activeColor === c.hex ? '0 0 0 2px rgba(126,182,255,0.6)' : undefined,
              }}
            />
          ))}
          <span style={toolLabelStyle}>Width</span>
          {[2, 3, 5, 8].map(w => (
            <button
              key={w}
              type="button"
              onClick={() => setStrokeWidth(w)}
              style={{
                ...transportBtnStyle,
                background: strokeWidth === w ? 'rgba(126,182,255,0.20)' : 'rgba(20,24,32,0.85)',
                borderColor: strokeWidth === w ? 'rgba(126,182,255,0.55)' : 'var(--border)',
                width: 30, height: 30, padding: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span style={{ display: 'inline-block', width: w * 2, height: w * 2, borderRadius: '50%', background: '#ffffff' }} />
            </button>
          ))}
          <button type="button" onClick={undoLast} disabled={!annotations.length} style={transportBtnStyle}>↶ Undo</button>
          <button type="button" onClick={clearAnnotations} disabled={!annotations.length} style={transportBtnStyle}>🗑 Clear</button>
          <span style={{ marginLeft: 'auto', fontSize: rem(11), color: 'var(--text-muted)' }}>
            {annotations.length} stroke{annotations.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* ── Voice-over toolbar ── */}
        <div style={{
          marginTop: 10,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <span style={toolLabelStyle}>Voice-over</span>
          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={!primarySrc}
              style={{
                ...transportBtnStyle,
                background: 'rgba(244,63,94,0.16)',
                borderColor: 'rgba(244,63,94,0.45)',
                color: '#fda4af',
                fontWeight: 700,
              }}
            >
              ● Record
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              style={{
                ...transportBtnStyle,
                background: 'rgba(244,63,94,0.30)',
                borderColor: '#f43f5e',
                color: 'var(--text-bright)',
                fontWeight: 800,
                animation: 'pulse-rec 1.2s infinite',
              }}
            >
              ⏹ Stop ({voiceOvers.length + 1})
            </button>
          )}
          <span style={{ fontSize: rem(11), color: 'var(--text-muted)', flex: 1 }}>
            {isRecording
              ? 'Recording — narrate while the video plays.'
              : voiceOvers.length === 0
                ? 'Capture coaching commentary while reviewing the clip.'
                : `${voiceOvers.length} segment${voiceOvers.length === 1 ? '' : 's'} captured.`}
          </span>
        </div>

        {voiceOvers.length > 0 && (
          <div style={{
            marginTop: 10,
            display: 'grid', gap: 8,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}>
            {voiceOvers.map((seg, i) => (
              <div key={seg.id} style={{
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.18em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  <span>VO #{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => deleteVoiceOver(seg.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    title="Discard"
                  >×</button>
                </div>
                <audio controls src={seg.url} style={{ width: '100%' }} />
                <div style={{ fontSize: rem(10.5), color: 'var(--text-muted)' }}>
                  Began at {fmtTime(seg.startVideoTime)} · {(seg.durationMs / 1000).toFixed(1)}s
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Save panel ── */}
        <div style={{
          marginTop: 18,
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(74,222,128,0.05), rgba(74,222,128,0.02))',
          border: '1px solid rgba(74,222,128,0.30)',
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <input
              type="text"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder={`Session title (e.g., "${player.firstName}'s swing — front-shoulder fix")`}
              style={{
                flex: 1, minWidth: 240,
                background: 'rgba(20,24,32,0.85)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: rem(13),
              }}
            />
            <button
              type="button"
              onClick={saveSession}
              disabled={saving || !primarySrc}
              style={{
                padding: '10px 22px', borderRadius: 9,
                background: 'linear-gradient(135deg, rgba(74,222,128,0.30), rgba(74,222,128,0.18))',
                border: '1px solid rgba(74,222,128,0.55)',
                color: '#ecfdf5',
                fontSize: rem(13), fontWeight: 700, letterSpacing: '0.04em',
                cursor: saving || !primarySrc ? 'not-allowed' : 'pointer',
                opacity: saving || !primarySrc ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving…' : '💾 Save Coaching Session'}
            </button>
          </div>
          <textarea
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Coaching notes — what to focus on next time, drill assignments, etc."
            rows={3}
            style={{
              background: 'rgba(20,24,32,0.85)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: rem(12.5),
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          {saveError && (
            <div style={{ color: '#fda4af', fontSize: rem(12) }}>{saveError}</div>
          )}
        </div>
      </Section>

      {/* ── Browse player videos modal ── */}
      {browseOpen && (
        <BrowseVideosModal
          slot={browseOpen}
          playerName={player.firstName}
          videos={athleteVideos}
          query={browseQuery}
          setQuery={setBrowseQuery}
          category={browseCategory}
          setCategory={setBrowseCategory}
          onPick={(videoId) => {
            pickAthleteVideo(browseOpen, videoId);
            setBrowseOpen(null);
          }}
          onClose={() => setBrowseOpen(null)}
        />
      )}

      {mlbBrowseOpen && (
        <MlbClipBrowserModal
          slot={mlbBrowseOpen}
          onPick={(opts) => {
            loadFromUrl(mlbBrowseOpen, opts);
            setMlbBrowseOpen(null);
          }}
          onClose={() => setMlbBrowseOpen(null)}
        />
      )}

      {drillBrowseOpen && (
        <DrillBrowserModal
          slot={drillBrowseOpen}
          onPick={(opts) => {
            loadFromUrl(drillBrowseOpen, opts);
            setDrillBrowseOpen(null);
          }}
          onClose={() => setDrillBrowseOpen(null)}
        />
      )}

      {otherAthleteOpen && (
        <OtherAthleteBrowserModal
          slot={otherAthleteOpen}
          excludePlayerId={player.id}
          onPick={(opts) => {
            loadFromUrl(otherAthleteOpen, opts);
            setOtherAthleteOpen(null);
          }}
          onClose={() => setOtherAthleteOpen(null)}
        />
      )}

      <style jsx global>{`
        @keyframes pulse-rec {
          0%, 100% { box-shadow: 0 0 0 0 rgba(244,63,94,0.45); }
          50%      { box-shadow: 0 0 0 6px rgba(244,63,94,0); }
        }
      `}</style>
    </>
  );
}

/* ─── Browse player videos modal ────────────────────────────────────────────
   Rich picker for the athlete's already-uploaded videos. Replaces the cramped
   <select> dropdown — coaches can search, filter by category, and click a
   thumbnail to drop the clip into the chosen studio slot.
   ───────────────────────────────────────────────────────────────────────── */
function BrowseVideosModal({
  slot, playerName, videos, query, setQuery, category, setCategory, onPick, onClose,
}: {
  slot: 'primary' | 'compare';
  playerName: string;
  videos: api.Video[];
  query: string;
  setQuery: (q: string) => void;
  category: string;
  setCategory: (c: string) => void;
  onPick: (videoId: string) => void;
  onClose: () => void;
}) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => v.category && set.add(v.category));
    return ['all', ...Array.from(set).sort()];
  }, [videos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos
      .filter((v) => category === 'all' || v.category === category)
      .filter((v) => !q || v.title.toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q))
      // Newest uploads first — more useful when you're studying recent work.
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [videos, query, category]);

  function fmtDuration(sec: number | null) {
    if (!sec || !isFinite(sec)) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
    } catch { return ''; }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(18,22,30,0.98)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.025)',
        }}>
          <div>
            <div style={{ fontSize: rem(14), fontWeight: 700, color: 'var(--text)' }}>
              Pick a video for the {slot === 'primary' ? 'Primary' : 'Compare'} pane
            </div>
            <div style={{ fontSize: rem(11), color: 'var(--text-muted)', marginTop: 2 }}>
              {playerName}&apos;s uploaded videos · {filtered.length} of {videos.length} shown
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: rem(18), lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or category…"
            style={{
              flex: '1 1 220px',
              minWidth: 220,
              background: 'rgba(20,24,32,0.85)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '7px 10px',
              borderRadius: 7,
              fontSize: rem(12),
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                style={{
                  padding: '5px 11px',
                  borderRadius: 999,
                  fontSize: rem(11), fontWeight: 600,
                  cursor: 'pointer',
                  background: category === c ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  color: category === c ? '#000' : 'var(--text-muted)',
                  border: `1px solid ${category === c ? 'transparent' : 'var(--border)'}`,
                  textTransform: 'capitalize',
                }}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: 18,
        }}>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 16px',
              color: 'var(--text-muted)', fontSize: rem(13),
            }}>
              {videos.length === 0
                ? `No uploaded videos for ${playerName} yet.`
                : 'No videos match the current filters.'}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
            }}>
              {filtered.map((v) => {
                const playable = !!(v.originalUrl || v.hlsUrl);
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!playable}
                    onClick={() => onPick(v.id)}
                    style={{
                      display: 'flex', flexDirection: 'column',
                      textAlign: 'left',
                      background: 'rgba(20,24,32,0.85)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      overflow: 'hidden',
                      cursor: playable ? 'pointer' : 'not-allowed',
                      opacity: playable ? 1 : 0.45,
                      padding: 0,
                      transition: 'border-color 0.15s, transform 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (playable) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-light)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    }}
                    title={playable ? 'Load into the studio' : 'No playable URL on this video'}
                  >
                    {/* Thumbnail */}
                    <div style={{
                      position: 'relative',
                      aspectRatio: '16 / 9',
                      background: '#000',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {v.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.thumbnailUrl}
                          alt={v.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span style={{ fontSize: rem(28), color: 'rgba(255,255,255,0.35)' }}>🎬</span>
                      )}
                      {v.durationSec && (
                        <span style={{
                          position: 'absolute', bottom: 6, right: 6,
                          background: 'rgba(0,0,0,0.75)',
                          color: 'var(--text-bright)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: rem(10), fontWeight: 600,
                        }}>
                          {fmtDuration(v.durationSec)}
                        </span>
                      )}
                      {!playable && (
                        <span style={{
                          position: 'absolute', top: 6, left: 6,
                          background: 'rgba(244,63,94,0.85)',
                          color: 'var(--text-bright)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: rem(9), fontWeight: 700, letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}>
                          {v.status || 'No URL'}
                        </span>
                      )}
                    </div>
                    {/* Body */}
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{
                        fontSize: rem(12.5), fontWeight: 700, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {v.title}
                      </div>
                      <div style={{
                        fontSize: rem(10.5), color: 'var(--text-muted)', marginTop: 4,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{
                          background: 'rgba(126,182,255,0.12)',
                          color: 'var(--accent-light)',
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontSize: rem(10), fontWeight: 600,
                        }}>{v.category || 'Uncategorized'}</span>
                        <span>{fmtDate(v.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const transportBtnStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: 'rgba(20,24,32,0.85)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 7,
  fontSize: rem(12),
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: "'DM Mono', ui-monospace, monospace",
  letterSpacing: '0.04em',
};

/* Shared style for the source-picker buttons in SourcePicker
   (MLB Clip / Drill / Other Athlete / Upload). */
const pickerBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px',
  background: 'rgba(126,182,255,0.10)',
  border: '1px solid rgba(126,182,255,0.32)',
  borderRadius: 7,
  fontSize: rem(11.5),
  color: 'var(--accent-light)',
  cursor: 'pointer',
  fontWeight: 600,
};

const toolLabelStyle: React.CSSProperties = {
  fontSize: rem(10), fontWeight: 700, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
  marginRight: 4,
};

/* ─── Generic modal shell (shared by all browse modals) ──────────────────
   Centered card with header (title + close), content slot, and the same
   dimming overlay used by BrowseVideosModal so the studio's UX stays
   consistent across every source picker.
   ────────────────────────────────────────────────────────────────────── */
function StudioModal({
  title, subtitle, onClose, children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(18,22,30,0.98)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.025)',
        }}>
          <div>
            <div style={{ fontSize: rem(14), fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: rem(11), color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: rem(18), lineHeight: 1,
            }}
            aria-label="Close"
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* Helpers used across browse modals */
function isDirectVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // YouTube embeds and watch URLs can't play in a <video> element, so the
  // studio (which scrubs frame-by-frame) can't use them.
  if (/youtube\.com|youtu\.be/.test(url)) return false;
  return true;
}

function StudioVideoCard({
  title, subtitle, thumbnail, badge, durationSec, disabled, onClick,
}: {
  title: string;
  subtitle?: string;
  thumbnail?: string | null;
  badge?: string;
  durationSec?: number | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        textAlign: 'left',
        background: 'rgba(20,24,32,0.85)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        padding: 0,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-light)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
      }}
      title={disabled ? 'Not playable in the studio (likely a YouTube link or missing URL)' : 'Load into the studio'}
    >
      <div style={{
        position: 'relative',
        aspectRatio: '16 / 9',
        background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: rem(28), color: 'rgba(255,255,255,0.35)' }}>🎬</span>
        )}
        {durationSec ? (
          <span style={{
            position: 'absolute', bottom: 6, right: 6,
            background: 'rgba(0,0,0,0.75)',
            color: 'var(--text-bright)',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: rem(10), fontWeight: 600,
          }}>{fmtDuration(durationSec)}</span>
        ) : null}
        {disabled && (
          <span style={{
            position: 'absolute', top: 6, left: 6,
            background: 'rgba(244,63,94,0.85)',
            color: 'var(--text-bright)',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: rem(9), fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>Unsupported</span>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: rem(12.5), fontWeight: 700, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</div>
        <div style={{
          fontSize: rem(10.5), color: 'var(--text-muted)', marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {badge && (
            <span style={{
              background: 'rgba(126,182,255,0.12)',
              color: 'var(--accent-light)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: rem(10), fontWeight: 600,
            }}>{badge}</span>
          )}
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
    </button>
  );
}

/* ─── MLB Clip Browser ────────────────────────────────────────────────── */

function MlbClipBrowserModal({
  slot, onPick, onClose,
}: {
  slot: 'primary' | 'compare';
  onPick: (opts: { id: string; url: string; title: string; category?: string; origin: VideoSrc['origin'] }) => void;
  onClose: () => void;
}) {
  // Two-stage flow: pick MLB player → pick clip. Players' video summaries
  // come from the list endpoint; the full video records (with URLs) need
  // the per-player detail call.
  const [players, setPlayers] = useState<api.MlbPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<api.MlbPlayer | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMlbPlayers()
      .then((rows) => setPlayers(rows))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedPlayerId) { setSelectedPlayer(null); return; }
    let cancelled = false;
    api.getMlbPlayer(selectedPlayerId).then((p) => {
      if (!cancelled) setSelectedPlayer(p);
    });
    return () => { cancelled = true; };
  }, [selectedPlayerId]);

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [players, query]);

  return (
    <StudioModal
      title={`Pick an MLB clip for the ${slot === 'primary' ? 'Primary' : 'Compare'} pane`}
      subtitle={selectedPlayer ? `${selectedPlayer.name} · ${(selectedPlayer.videos || []).length} clips` : 'Choose an MLB player'}
      onClose={onClose}
    >
      {!selectedPlayer ? (
        <>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search MLB players or teams…"
              style={{
                width: '100%',
                background: 'rgba(20,24,32,0.85)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '7px 10px', borderRadius: 7, fontSize: rem(12),
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading…</div>
            ) : filteredPlayers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: rem(13) }}>
                No MLB players in the library yet. Add some from the Education page.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 10,
              }}>
                {filteredPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlayerId(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      background: 'rgba(20,24,32,0.85)',
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: rem(22) }}>{p.emoji}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: rem(12), fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{p.name}</div>
                      <div style={{ fontSize: rem(10.5), color: 'var(--text-muted)' }}>
                        {(p.videos || []).length} clip{(p.videos || []).length === 1 ? '' : 's'}
                        {p.team ? ` · ${p.team}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 18px', borderBottom: '1px solid var(--border)',
          }}>
            <button
              type="button"
              onClick={() => setSelectedPlayerId(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                fontSize: rem(11), fontWeight: 600,
              }}
            >← Back to players</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {(selectedPlayer.videos || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: rem(13) }}>
                No clips on this player yet.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 14,
              }}>
                {(selectedPlayer.videos || []).map((v) => {
                  const playable = isDirectVideoUrl(v.url);
                  return (
                    <StudioVideoCard
                      key={v.id}
                      title={v.title}
                      subtitle={v.notes || undefined}
                      badge={v.category}
                      disabled={!playable}
                      onClick={() => onPick({
                        id: `mlb:${v.id}`,
                        url: v.url || '',
                        title: `${selectedPlayer.name} — ${v.title}`,
                        category: v.category,
                        origin: 'mlb',
                      })}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </StudioModal>
  );
}

/* ─── Drill Browser ───────────────────────────────────────────────────── */

function DrillBrowserModal({
  slot, onPick, onClose,
}: {
  slot: 'primary' | 'compare';
  onPick: (opts: { id: string; url: string; title: string; category?: string; origin: VideoSrc['origin'] }) => void;
  onClose: () => void;
}) {
  const [drills, setDrills] = useState<api.Drill[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDrills()
      .then((rows) => setDrills(rows))
      .finally(() => setLoading(false));
  }, []);

  // Only drills with a videoUrl are useful here.
  const playable = useMemo(() => drills.filter((d) => !!d.videoUrl), [drills]);

  const tabs = useMemo(() => {
    const set = new Set<string>();
    playable.forEach((d) => d.tab && set.add(d.tab));
    return ['all', ...Array.from(set).sort()];
  }, [playable]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return playable
      .filter((d) => tab === 'all' || d.tab === tab)
      .filter((d) => !q
        || d.name.toLowerCase().includes(q)
        || (d.description || '').toLowerCase().includes(q)
        || (d.category || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [playable, query, tab]);

  return (
    <StudioModal
      title={`Pick a drill video for the ${slot === 'primary' ? 'Primary' : 'Compare'} pane`}
      subtitle={`${filtered.length} of ${playable.length} drills with video shown`}
      onClose={onClose}
    >
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        padding: '10px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drills…"
          style={{
            flex: '1 1 220px', minWidth: 220,
            background: 'rgba(20,24,32,0.85)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '7px 10px', borderRadius: 7, fontSize: rem(12),
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: '5px 11px', borderRadius: 999,
                fontSize: rem(11), fontWeight: 600, cursor: 'pointer',
                background: tab === t ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                color: tab === t ? '#000' : 'var(--text-muted)',
                border: `1px solid ${tab === t ? 'transparent' : 'var(--border)'}`,
                textTransform: 'capitalize',
              }}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: rem(13) }}>
            {playable.length === 0
              ? 'No drills with videos in the library yet. Upload demo videos from the Education → Drills page.'
              : 'No drills match the current filters.'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}>
            {filtered.map((d) => (
              <StudioVideoCard
                key={d.id}
                title={d.name}
                subtitle={d.description || undefined}
                badge={`${d.tab} · ${d.category}`}
                onClick={() => onPick({
                  id: `drill:${d.id}`,
                  url: d.videoUrl || '',
                  title: d.name,
                  category: d.category,
                  origin: 'drill',
                })}
              />
            ))}
          </div>
        )}
      </div>
    </StudioModal>
  );
}

/* ─── Other Athlete Browser ───────────────────────────────────────────── */

function OtherAthleteBrowserModal({
  slot, excludePlayerId, onPick, onClose,
}: {
  slot: 'primary' | 'compare';
  excludePlayerId: string;
  onPick: (opts: { id: string; url: string; title: string; category?: string; origin: VideoSrc['origin'] }) => void;
  onClose: () => void;
}) {
  const [players, setPlayers] = useState<api.Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<api.Player | null>(null);
  const [videos, setVideos] = useState<api.Video[]>([]);
  const [playerQuery, setPlayerQuery] = useState('');
  const [videoQuery, setVideoQuery] = useState('');
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);

  useEffect(() => {
    api.getPlayers()
      .then((rows) => setPlayers(rows.filter((p) => p.id !== excludePlayerId)))
      .finally(() => setLoadingPlayers(false));
  }, [excludePlayerId]);

  useEffect(() => {
    if (!selectedPlayer) { setVideos([]); return; }
    let cancelled = false;
    setLoadingVideos(true);
    api.browseVideos({ playerId: selectedPlayer.id })
      .then((rows) => {
        if (!cancelled) setVideos(rows as api.Video[]);
      })
      .finally(() => {
        if (!cancelled) setLoadingVideos(false);
      });
    return () => { cancelled = true; };
  }, [selectedPlayer]);

  const filteredPlayers = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    return players
      .filter((p) => !q
        || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
        || (p.positions || '').toLowerCase().includes(q))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [players, playerQuery]);

  const playableVideos = useMemo(
    () => videos.filter((v) => (v.originalUrl || v.hlsUrl) && (v.status === 'READY' || v.status == null)),
    [videos],
  );

  const filteredVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    return playableVideos
      .filter((v) => !q || v.title.toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [playableVideos, videoQuery]);

  return (
    <StudioModal
      title={`Pick another athlete's video for the ${slot === 'primary' ? 'Primary' : 'Compare'} pane`}
      subtitle={selectedPlayer
        ? `${selectedPlayer.firstName} ${selectedPlayer.lastName} · ${filteredVideos.length} of ${playableVideos.length} videos`
        : 'Choose an athlete'}
      onClose={onClose}
    >
      {!selectedPlayer ? (
        <>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              placeholder="Search athletes by name or position…"
              style={{
                width: '100%',
                background: 'rgba(20,24,32,0.85)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '7px 10px', borderRadius: 7, fontSize: rem(12),
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {loadingPlayers ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading athletes…</div>
            ) : filteredPlayers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: rem(13) }}>
                No other athletes match.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 10,
              }}>
                {filteredPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlayer(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      background: 'rgba(20,24,32,0.85)',
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      textAlign: 'left',
                    }}
                  >
                    {p.profilePhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.profilePhoto} alt={p.firstName} style={{
                        width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
                      }} />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'rgba(126,182,255,0.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: rem(13), fontWeight: 700, color: 'var(--accent-light)',
                      }}>
                        {p.firstName?.[0] || '?'}{p.lastName?.[0] || ''}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: rem(12), fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {p.firstName} {p.lastName}
                      </div>
                      <div style={{ fontSize: rem(10.5), color: 'var(--text-muted)' }}>
                        {p.gradYear ? `'${String(p.gradYear).slice(-2)} ` : ''}{p.positions || ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
            padding: '10px 18px', borderBottom: '1px solid var(--border)',
          }}>
            <button
              type="button"
              onClick={() => setSelectedPlayer(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                fontSize: rem(11), fontWeight: 600,
              }}
            >← Back to athletes</button>
            <input
              type="text"
              value={videoQuery}
              onChange={(e) => setVideoQuery(e.target.value)}
              placeholder="Search videos…"
              style={{
                flex: '1 1 220px', minWidth: 220,
                background: 'rgba(20,24,32,0.85)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '7px 10px', borderRadius: 7, fontSize: rem(12),
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            {loadingVideos ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading videos…</div>
            ) : filteredVideos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: rem(13) }}>
                {playableVideos.length === 0
                  ? `${selectedPlayer.firstName} doesn't have any uploaded videos yet.`
                  : 'No videos match the search.'}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 14,
              }}>
                {filteredVideos.map((v) => {
                  const url = v.originalUrl || v.hlsUrl || '';
                  return (
                    <StudioVideoCard
                      key={v.id}
                      title={v.title}
                      subtitle={new Date(v.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                      badge={v.category}
                      thumbnail={v.thumbnailUrl}
                      durationSec={v.durationSec}
                      onClick={() => onPick({
                        id: `video:${v.id}`,
                        url,
                        title: `${selectedPlayer.firstName} ${selectedPlayer.lastName} — ${v.title}`,
                        category: v.category,
                        origin: 'other',
                      })}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </StudioModal>
  );
}
