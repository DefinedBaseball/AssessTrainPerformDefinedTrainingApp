'use client';

/**
 * VideoBundleModal — full-screen grid viewer for a multi-angle bundle.
 *
 * Modes:
 *   • Synced (default) — every angle plays in lockstep via a single
 *     master control bar (Play/Pause + frame-step + speed presets +
 *     speed slider). Drift-corrected every 250 ms.
 *   • Unsynced — each pane gets its own VideoControlBar; coaches can
 *     play, scrub, frame-step, and dial in slow-mo independently.
 *
 * Additional controls (work in either mode):
 *   • Record — captures the composite grid + mic audio and uploads
 *     it as a Coach Review clip under the player. Mirrors the
 *     VideoPlayerModal flow.
 *   • Compare — adds a second pane that duplicates the first angle
 *     so the coach can A/B the same angle at different timestamps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { splitVideoTitle, normalizeVideoTitle } from '@/lib/video-titles';
import { VideoControlBar } from '../PlaybackSpeedControl';
import { VideoDrawingOverlay } from '../VideoDrawingOverlay';
import { useTheme } from '@/lib/theme-context';
import * as api from '@/lib/api';
import type { Player, Video } from '@/lib/api';

interface BundleVideo {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  originalUrl?: string | null;
}

/** Lightweight shape of a player report — accepted by the modal's
 *  Attach-to-Report dropdown in the Save preview. Matches the
 *  `ReportSummary` shape callers already have on hand without
 *  pulling in the full helpers typings. */
export interface AttachableReport {
  id: string;
  reportType: string;
  title?: string | null;
  createdAt: string;
  content?: string | null;
}

interface VideoBundleModalProps {
  videos: BundleVideo[];
  label: string;
  onClose: () => void;
  /** Player ID — required for the Record button to upload the
   *  resulting Coach Review clip. Falsy → Record button hides. */
  playerId?: string;
  /** Category stamp for the uploaded narration clip. Defaults to the
   *  first video's category. */
  recordingCategory?: string;
  /** Fires after a Coach Review clip is successfully uploaded so the
   *  parent tab can refetch its video list and surface the new clip
   *  in the gallery immediately. Without this the recorded clip
   *  stays invisible until the user reloads. */
  onUploaded?: () => void;
  /** Reports the coach can optionally attach the new Coach Review
   *  clip to. When attached, the clip's video ID gets persisted into
   *  the report's content blob under `coachReviewVideoIds` so the
   *  matching tab can surface it in a per-report Coach Reviews
   *  panel. Empty / omitted → the attach UI hides and the clip
   *  saves only into the global gallery. */
  reports?: AttachableReport[];
}

type RecordState = 'idle' | 'starting' | 'recording' | 'uploading' | 'saved' | 'error';

export function VideoBundleModal({
  videos, label, onClose, playerId, recordingCategory, onUploaded, reports,
}: VideoBundleModalProps) {
  /* Theme-aware chrome for the modal — the major surfaces flip
     between the dark playback palette (default) and a light-theme
     palette matching the rest of the app when `[data-theme="light"]`
     is active. Video tiles themselves stay `#000` regardless of
     theme — videos always read best on a black backdrop, and a
     light video bg would wash out lower-luma frames.

     What flips per theme:
       • Outer modal backdrop overlay
       • PendingClip preview backdrop overlay
       • PendingClip preview card surface
       • Header label text
       • Pane surrounds (the area around each black video tile —
         already adapts via existing tokens, only the few hardcoded
         backdrops above need theme-conditional values) */
  const { theme } = useTheme();
  const isLight = theme === 'light';
  /* Slight grey-tinted overlay in light theme so the modal sits
     above the page but still feels native to the light palette.
     Dark theme keeps the prior 0.88 black for high contrast. */
  const modalBackdrop = isLight
    ? 'rgba(174, 174, 174, 0.96)'      // --bg page-grey at 96 % alpha
    : 'rgba(0, 0, 0, 0.88)';
  /* Header text color (the "{n} angles" eyebrow + bundle label). */
  const headerTextColor = isLight ? 'var(--text)' : 'var(--text-bright)';
  /* PendingClip review preview — backdrop + inner card. */
  const previewBackdrop = isLight
    ? 'rgba(174, 174, 174, 0.96)'
    : 'rgba(0, 0, 0, 0.86)';
  const previewCardBg = isLight
    ? 'var(--bubble-chrome-bg)'        // near-white Swing color
    : 'rgba(15, 18, 22, 0.95)';
  const previewCardTextColor = isLight ? 'var(--text)' : 'var(--text-bright)';
  /* Bottom playback toolbar — TWO surfaces, both flip per theme:
       • Scrubber row (the master seek bar + time readouts that
         sits ABOVE the playback transport)
       • Unified bottom bar (the chunky toolbar that hosts the
         transport, draw, record, compare buttons)
     In light theme both surfaces flip to `--bubble-chrome-bg`
     (the same near-white Swing color the rest of the light-theme
     interior bubbles wear) so the playback toolbar reads as part
     of the light palette instead of a floating dark chip. */
  const scrubberRowBg = isLight ? 'var(--bubble-chrome-bg)' : 'rgba(255, 255, 255, 0.04)';
  const scrubberRowTextColor = isLight ? 'var(--text)' : 'var(--text-bright)';
  const playbackBarBg = isLight ? 'var(--bubble-chrome-bg)' : 'rgba(10, 14, 20, 0.85)';
  const playbackBarShadow = isLight
    ? '0 2px 8px rgba(0, 0, 0, 0.10)'
    : '0 2px 8px rgba(0, 0, 0, 0.40)';

  const [synced, setSynced] = useState(true);
  const [compareOn, setCompareOn] = useState(false);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordError, setRecordError] = useState<string | null>(null);

  /* Master scrubber state — tracked off the first video's currentTime.
     Updates live via the `timeupdate` listener wired below. */
  const [masterTime, setMasterTime] = useState(0);
  const [masterDuration, setMasterDuration] = useState(0);

  /* Hidden-pane set — indexes the coach has eye-toggled out of view.
     Hidden panes appear in the "Hidden" chip strip with click-to-restore. */
  const [hiddenIdx, setHiddenIdx] = useState<Set<number>>(new Set());
  const [compareHidden, setCompareHidden] = useState(false);

  /* Compare picker state — when `compareSrc` is null, the compare
     pane renders the picker UI. Once a video is chosen, the pane
     plays it (Change button reverts to the picker). */
  type CompareSrc = { url: string; label: string };
  const [compareSrc, setCompareSrc] = useState<CompareSrc | null>(null);
  const [picker, setPicker] = useState<{
    position: string;
    athleteId: string;
    library: '' | 'mlb' | 'drills';
  }>({ position: '', athleteId: '', library: '' });
  const [athletes, setAthletes] = useState<Player[]>([]);
  const [athleteVideos, setAthleteVideos] = useState<Video[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [athleteVideosLoading, setAthleteVideosLoading] = useState(false);

  /* Refs for every <video> in the grid — index by videos array index.
     The first ref doubles as the "master" in synced mode; the rest
     follow its state changes via the propagation effects below. */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  /* Compare-pane ref (duplicate of the first angle when Compare is on). */
  const compareVideoRef = useRef<HTMLVideoElement | null>(null);

  /* Drawing-canvas refs per pane — `VideoDrawingOverlay.onCanvasReady`
     pushes its <canvas> here so the recording composite (and any
     downstream snapshotting) can layer the coach's annotations on
     top of the matching video frame. Index matches `videoRefs`. */
  const drawingCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const compareDrawingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /* Per-pane Clear-strokes handles. The global "Clear All" button
     at the bottom toolbar walks this array and fires each one to
     purge every visible annotation in one click. */
  const drawingClearFnsRef = useRef<(() => void)[]>([]);
  const compareDrawingClearFnRef = useRef<(() => void) | null>(null);

  /* Drawing tool + color are lifted to the modal level so the
     bottom-toolbar picker controls ALL panes' overlays at once.
     Replaces the previous per-pane top-left tool palettes. */
  type DrawingTool = 'circle' | 'line' | 'arrow' | 'freehand' | null;
  type DrawingColor = '#ef4444' | '#facc15' | '#7eb6ff';
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null);
  const [drawingColor, setDrawingColor] = useState<DrawingColor>('#facc15');

  /* While the user is actively dragging the master scrubber thumb,
     `timeupdate` fires from the video element are ignored so the
     thumb doesn't fight the cursor. Set true on pointerdown / input
     and cleared on pointerup / blur. */
  const scrubbingRef = useRef(false);

  /* Recording infrastructure — same shape as VideoPlayerModal. */
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number>(0);

  /* Pending clip — set after Stop. Triggers the 3-option preview
     overlay (Save to Profile / Restart / Discard). When null, the
     preview is hidden. `previewUrl` is an object-URL the preview
     <video> plays back so the coach can review the take. */
  const [pendingClip, setPendingClip] = useState<{
    blob: Blob;
    previewUrl: string;
    durationSec: number;
    mime: string;
  } | null>(null);

  /* Selected report ID to attach the Coach Review to on Save.
     '' = attach to no report (clip lives only in the global
     gallery — the existing behavior). The dropdown only renders
     when the modal was passed a non-empty `reports` array. */
  const [attachReportId, setAttachReportId] = useState<string>('');

  /* Filter the report list to ONLY those matching the recording
     category. Coach-spec: a Hitting video's report-attach picker
     should only offer Hitting reports, a Pitching video should
     only offer Pitching reports, and so on — even when the parent
     hands over every report on the athlete. The first video's
     `category` (or the explicit `recordingCategory` override) is
     the reference; report.reportType uses the same conventions
     ('HITTING', 'PITCHING', 'CATCHING', 'INFIELD', 'OUTFIELD',
     'STRENGTH'). If the category is empty (rare — most galleries
     pass it explicitly), no filtering applies. If filtered to
     zero matches, the dropdown auto-hides (per the
     `reportsFiltered && reportsFiltered.length > 0` guard
     below), and the coach saves to the gallery only. */
  const targetReportType = (recordingCategory || videos[0]?.category || '').toUpperCase();
  const reportsFiltered = (!reports || !targetReportType)
    ? reports
    : reports.filter((r) => (r.reportType || '').toUpperCase() === targetReportType);

  /* Escape closes the modal; Space toggles play in synced mode. */
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === ' ' && synced) {
      e.preventDefault();
      const master = videoRefs.current[0];
      if (!master) return;
      if (master.paused) master.play().catch(() => undefined);
      else master.pause();
    }
  }, [onClose, synced]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [handleKey]);

  /* Sync mode entering/exiting — pause everything on transition so
     the master controls don't fight the natives. */
  useEffect(() => {
    const els = [
      ...videoRefs.current.filter((el): el is HTMLVideoElement => !!el),
      ...(compareVideoRef.current ? [compareVideoRef.current] : []),
    ];
    if (synced) {
      /* Entering synced mode — pause all, zero them out so the master
         play starts every angle at frame 0. Mute all but the first to
         avoid cacophony. */
      for (let i = 0; i < els.length; i++) {
        els[i].pause();
        try { els[i].currentTime = 0; } catch { /* ignore */ }
        els[i].muted = i !== 0;
      }
    } else {
      /* Exiting synced — pause; let each pane run its own controls. */
      for (const el of els) {
        el.pause();
        el.muted = false;
      }
    }
  }, [synced, compareOn]);

  /* Propagate master-video events to every follower in synced mode.
     Listening on the master <video> means the existing VideoControlBar
     drives ALL videos via this fan-out without modification to the
     control-bar component. */
  useEffect(() => {
    if (!synced) return;
    const master = videoRefs.current[0];
    if (!master) return;

    const followers = (): HTMLVideoElement[] => {
      const arr: HTMLVideoElement[] = [];
      for (let i = 1; i < videoRefs.current.length; i++) {
        const el = videoRefs.current[i];
        if (el) arr.push(el);
      }
      if (compareVideoRef.current) arr.push(compareVideoRef.current);
      return arr;
    };

    const onPlay = () => {
      for (const f of followers()) {
        if (f.paused) f.play().catch(() => undefined);
      }
    };
    const onPause = () => {
      for (const f of followers()) f.pause();
    };
    const onSeeked = () => {
      for (const f of followers()) {
        try { f.currentTime = master.currentTime; } catch { /* ignore */ }
      }
    };
    const onRateChange = () => {
      for (const f of followers()) {
        f.playbackRate = master.playbackRate;
      }
    };

    master.addEventListener('play', onPlay);
    master.addEventListener('pause', onPause);
    master.addEventListener('seeked', onSeeked);
    master.addEventListener('ratechange', onRateChange);

    /* Drift correction — runs continuously while synced even if not
       playing, so manual scrubs on the master pull every follower
       along even between explicit seeked events. */
    const drift = window.setInterval(() => {
      const followersNow = followers();
      for (const f of followersNow) {
        const d = f.currentTime - master.currentTime;
        if (Math.abs(d) > 0.08) {
          try { f.currentTime = master.currentTime; } catch { /* ignore */ }
        }
        if (f.playbackRate !== master.playbackRate) {
          f.playbackRate = master.playbackRate;
        }
      }
    }, 250);

    return () => {
      master.removeEventListener('play', onPlay);
      master.removeEventListener('pause', onPause);
      master.removeEventListener('seeked', onSeeked);
      master.removeEventListener('ratechange', onRateChange);
      window.clearInterval(drift);
    };
  }, [synced, compareOn, videos.length]);

  /* When a new compare video is picked in synced mode, snap it to
     the master's currentTime + playbackRate on `loadedmetadata` so
     it starts aligned with the bundle instead of jumping in at 0
     while the master is mid-play. Unsync mode skips this so each
     pane plays independently. */
  useEffect(() => {
    if (!compareSrc || !synced) return;
    const compare = compareVideoRef.current;
    const master = videoRefs.current[0];
    if (!compare || !master) return;
    const onMeta = () => {
      try { compare.currentTime = master.currentTime; } catch { /* ignore */ }
      compare.playbackRate = master.playbackRate;
      compare.muted = true; // synced — only the first angle is audible
    };
    compare.addEventListener('loadedmetadata', onMeta);
    return () => compare.removeEventListener('loadedmetadata', onMeta);
  }, [compareSrc, synced]);

  /* Master scrubber — track currentTime + duration off the first
     video.
     Subscribes to a wider net of events (loadedmetadata, durationchange,
     loadeddata, canplay, progress) because some sources (WebM files
     written by MediaRecorder, HLS streams, partially-buffered uploads)
     report `duration` as Infinity or a stale-small value at first and
     only resolve to the real length after additional data has loaded.
     The previous version only listened to loadedmetadata + durationchange,
     which let the scrubber's `max` get stuck at a small value while
     the video's actual playable range grew — that's what produced
     the "first 75 % of the bar is the first 3 seconds" symptom.
     A 500 ms polling interval is a safety net for browsers that
     don't fire durationchange when the real duration arrives. */
  useEffect(() => {
    const master = videoRefs.current[0];
    if (!master) return;

    const onTime = () => {
      /* Skip live updates while the user is dragging the scrubber —
         otherwise timeupdate (firing 4×/sec) overwrites the user's
         in-progress drag value with the video's current position,
         making the thumb fight the cursor. */
      if (scrubbingRef.current) return;
      setMasterTime(master.currentTime);
    };
    const readDuration = () => {
      const d = master.duration;
      if (Number.isFinite(d) && d > 0) {
        /* Always accept the latest finite duration — sources that
           probe the file gradually (HLS, WebM streamed) sometimes
           report a tiny "metadata-block" duration first and then
           update once more frames are decoded. Taking the latest
           value over `Math.max(prev, d)` lets the scrubber follow
           legitimate downward changes too (e.g. when a file is
           reloaded with a different source). */
        setMasterDuration(d);
      }
    };

    master.addEventListener('timeupdate', onTime);
    master.addEventListener('durationchange', readDuration);
    master.addEventListener('loadedmetadata', readDuration);
    master.addEventListener('loadeddata', readDuration);
    master.addEventListener('canplay', readDuration);
    master.addEventListener('progress', readDuration);
    readDuration();

    /* Safety-net poll — re-read duration every 500 ms while the
       modal is open. Cheap, and rescues us when none of the above
       events fire with the real value (rare but observed on some
       Chromium builds for files with broken metadata). */
    const pollId = window.setInterval(readDuration, 500);

    return () => {
      master.removeEventListener('timeupdate', onTime);
      master.removeEventListener('durationchange', readDuration);
      master.removeEventListener('loadedmetadata', readDuration);
      master.removeEventListener('loadeddata', readDuration);
      master.removeEventListener('canplay', readDuration);
      master.removeEventListener('progress', readDuration);
      window.clearInterval(pollId);
    };
    /* `compareOn` removed from deps — the master is always
       videoRefs.current[0] regardless, and re-running this effect
       on compareOn toggle would briefly drop listeners during the
       reattach window. */
  }, [videos.length]);

  /* Athletes list — lazily fetched the first time the Compare picker
     opens. `position` filter is applied client-side because the API
     returns the full string ("OF,P", "INF,3B") and the picker wants
     a simple "match any" filter against the umbrella codes. */
  useEffect(() => {
    if (!compareOn || athletes.length > 0 || athletesLoading) return;
    setAthletesLoading(true);
    api.getPlayers()
      .then((list) => setAthletes(Array.isArray(list) ? list : []))
      .catch(() => setAthletes([]))
      .finally(() => setAthletesLoading(false));
  }, [compareOn, athletes.length, athletesLoading]);

  /* Athlete's videos — fetched on athlete select. Cleared when the
     athlete dropdown changes back to "All / None". */
  useEffect(() => {
    if (!picker.athleteId) { setAthleteVideos([]); return; }
    setAthleteVideosLoading(true);
    api.getPlayerVideos(picker.athleteId)
      .then((list) => setAthleteVideos(Array.isArray(list) ? list : []))
      .catch(() => setAthleteVideos([]))
      .finally(() => setAthleteVideosLoading(false));
  }, [picker.athleteId]);

  /* Athletes filtered client-side by the Position dropdown. */
  const filteredAthletes = useMemo(() => {
    if (!picker.position) return athletes;
    const wanted = picker.position.toUpperCase();
    return athletes.filter((a) => {
      const pos = (a.positions || '').toUpperCase();
      return pos.split(',').map((s) => s.trim()).includes(wanted);
    });
  }, [athletes, picker.position]);

  /* ── Recording (composite of every visible pane + mic audio) ───── */

  const drawCompositeFrame = useCallback(() => {
    const c = compositeCanvasRef.current;
    if (!c) {
      rafRef.current = requestAnimationFrame(drawCompositeFrame);
      return;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;

    /* WYSIWYG composite — mirror exactly what's visible on screen.
       Skip eye-hidden panes, skip Compare if hidden, use the SAME
       column layout the on-screen grid uses, draw camera-label
       chips onto each pane so the recording reads with the same
       chrome the coach saw while reviewing. */
    type Pane = {
      el: HTMLVideoElement;
      label: string;
      accent?: string;
      drawing?: HTMLCanvasElement | null;
    };
    const panes: Pane[] = [];
    for (let i = 0; i < videoRefs.current.length; i++) {
      if (hiddenIdx.has(i)) continue;
      const el = videoRefs.current[i];
      if (!el || el.readyState < 2) continue;
      const camera = splitVideoTitle(videos[i]?.title || '').cameraLabel || `Angle ${i + 1}`;
      panes.push({
        el,
        label: camera,
        drawing: drawingCanvasRefs.current[i] ?? null,
      });
    }
    if (compareOn && !compareHidden && compareVideoRef.current && compareVideoRef.current.readyState >= 2) {
      panes.push({
        el: compareVideoRef.current,
        label: compareSrc?.label || 'Compare',
        accent: 'rgba(126,182,255,0.55)',
        drawing: compareDrawingCanvasRef.current,
      });
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);

    if (panes.length > 0) {
      /* Identical column rule to the on-screen grid. */
      const gridCols =
        panes.length <= 1 ? 1
        : panes.length === 2 ? 2
        : panes.length <= 4 ? 2
        : 3;
      const rows = Math.ceil(panes.length / gridCols);
      const gap = 12;
      const cellW = (c.width - gap * (gridCols - 1)) / gridCols;
      const cellH = (c.height - gap * (rows - 1)) / rows;

      panes.forEach((p, i) => {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const x = col * (cellW + gap);
        const y = row * (cellH + gap);

        /* Letterbox the video to preserve its aspect ratio inside
           the cell — matches `object-fit: contain` on the actual
           on-screen video element. */
        const v = p.el;
        const vw = v.videoWidth || 16;
        const vh = v.videoHeight || 9;
        const cellAspect = cellW / cellH;
        const vidAspect = vw / vh;
        let drawW = cellW;
        let drawH = cellH;
        if (vidAspect > cellAspect) {
          drawH = cellW / vidAspect;
        } else {
          drawW = cellH * vidAspect;
        }
        const dx = x + (cellW - drawW) / 2;
        const dy = y + (cellH - drawH) / 2;

        try {
          ctx.drawImage(v, dx, dy, drawW, drawH);
        } catch { /* ignore decode-not-ready */ }

        /* Drawing layer — coach annotations sit ABOVE the video
           frame in the composite, mirroring how they render on
           screen. Drawn in the same letterbox so a circle on a
           ball lines up pixel-for-pixel between live view and
           recording. */
        const dc = p.drawing;
        if (dc && dc.width > 0 && dc.height > 0) {
          try {
            ctx.drawImage(dc, dx, dy, drawW, drawH);
          } catch { /* ignore */ }
        }

        /* Subtle cell border. Accent color for the Compare pane. */
        ctx.strokeStyle = p.accent || 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

        /* Camera label badge — top-left of the cell. Matches the
           on-screen badge styling so the recording reads with the
           same UI chrome. */
        const padding = 8;
        const labelText = p.label;
        const labelFont = '700 14px system-ui, -apple-system, Helvetica, Arial, sans-serif';
        ctx.font = labelFont;
        const metrics = ctx.measureText(labelText);
        const labelW = Math.min(metrics.width + 16, cellW - 16);
        const labelH = 24;
        const lx = x + padding;
        const ly = y + padding;
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.beginPath();
        const rr = 6;
        // Rounded rect — no roundRect in older canvases, build manually.
        ctx.moveTo(lx + rr, ly);
        ctx.lineTo(lx + labelW - rr, ly);
        ctx.quadraticCurveTo(lx + labelW, ly, lx + labelW, ly + rr);
        ctx.lineTo(lx + labelW, ly + labelH - rr);
        ctx.quadraticCurveTo(lx + labelW, ly + labelH, lx + labelW - rr, ly + labelH);
        ctx.lineTo(lx + rr, ly + labelH);
        ctx.quadraticCurveTo(lx, ly + labelH, lx, ly + labelH - rr);
        ctx.lineTo(lx, ly + rr);
        ctx.quadraticCurveTo(lx, ly, lx + rr, ly);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = p.accent || 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, lx + 8, ly + labelH / 2 + 1, labelW - 16);
      });
    }

    rafRef.current = requestAnimationFrame(drawCompositeFrame);
  }, [compareOn, compareHidden, compareSrc, hiddenIdx, videos]);

  const startRecording = useCallback(async () => {
    if (!playerId) return;
    setRecordError(null);
    setRecordState('starting');
    try {
      if (!compositeCanvasRef.current) {
        compositeCanvasRef.current = document.createElement('canvas');
      }
      const c = compositeCanvasRef.current;
      /* 16:9 composite. The grid is laid out by drawCompositeFrame. */
      c.width = 1280;
      c.height = 720;

      /* Mic narration — request mic at standard speech-recording
         specs. Echo cancellation + noise suppression on so the
         coach's voice over the playing video sources reads cleanly.
         If the user blocks the permission OR no audio device is
         attached, abort with a clear error rather than silently
         producing a video-only recording. */
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      audioStreamRef.current = audioStream;
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length === 0 || !audioTracks[0].enabled) {
        throw new Error('No microphone detected — connect a mic and try again.');
      }

      drawCompositeFrame();

      const canvasStream = c.captureStream(30);
      const combined = new MediaStream([
        ...canvasStream.getVideoTracks(),
        /* Mic audio merged with the canvas video stream so the final
           recording carries the coach's voice over the silent video
           composite (the source videos' own audio is intentionally
           NOT captured — coach narration is the whole point). */
        ...audioTracks,
      ]);

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

      chunksRef.current = [];
      const recorder = mime
        ? new MediaRecorder(combined, { mimeType: mime })
        : new MediaRecorder(combined);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        audioStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
        canvasStream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: mime || 'video/webm' });
        chunksRef.current = [];
        if (!blob.size) {
          setRecordState('idle');
          return;
        }

        /* Stash the clip and pop the 3-option preview overlay. The
           upload is deferred until the coach picks Save to Profile.
           Restart drops it and rolls straight back into recording;
           Discard drops it and returns to idle. */
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
        const previewUrl = URL.createObjectURL(blob);
        setPendingClip({ blob, previewUrl, durationSec, mime: mime || 'video/webm' });
        setRecordState('idle');
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      setRecordState('recording');
    } catch (err: any) {
      setRecordError(err?.message || 'Failed to start recording');
      setRecordState('error');
    }
  }, [playerId, recordingCategory, videos, label, drawCompositeFrame]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  /* Pending-clip actions — fired from the 3-option preview overlay
     that pops after Stop. */
  const saveClip = useCallback(async () => {
    if (!pendingClip || !playerId) return;
    setRecordError(null);
    setRecordState('uploading');
    try {
      const ext = (pendingClip.mime || '').includes('mp4') ? 'mp4' : 'webm';
      const filename = `coach-narration-bundle-${Date.now()}.${ext}`;
      const file = new File([pendingClip.blob], filename, { type: pendingClip.mime });
      const cat = recordingCategory || videos[0]?.category || 'HITTING';
      const title = `Coach Review — ${label} — ${new Date().toLocaleDateString()}`;
      const uploaded = await api.uploadVideo(file, playerId, title, cat);

      /* If the coach picked a report from the Attach dropdown,
         persist the association into that report's content blob.
         `coachReviewVideoIds` is the canonical key the matching
         tab's per-report Coach Reviews panel reads from. Existing
         non-video keys on the report are preserved by merging onto
         the parsed content object. */
      if (attachReportId && reports) {
        const target = reports.find((r) => r.id === attachReportId);
        if (target) {
          let parsed: Record<string, any> = {};
          if (target.content) {
            try { parsed = JSON.parse(target.content) || {}; } catch { /* keep {} */ }
          }
          const prevIds: string[] = Array.isArray(parsed.coachReviewVideoIds)
            ? parsed.coachReviewVideoIds
            : [];
          const nextIds = prevIds.includes(uploaded.id)
            ? prevIds
            : [...prevIds, uploaded.id];
          parsed.coachReviewVideoIds = nextIds;
          try {
            await api.updateReport(attachReportId, {
              content: JSON.stringify(parsed),
            });
          } catch (err: any) {
            /* Non-fatal — the video did upload, the attach just
               failed. Surface a soft warning rather than aborting
               the whole flow. */
            console.error('Failed to attach Coach Review to report:', err);
            setRecordError('Saved to gallery, but attaching to the report failed.');
          }
        }
      }

      /* Free the preview blob URL — the upload's done and the
         pending preview is closing. */
      URL.revokeObjectURL(pendingClip.previewUrl);
      setPendingClip(null);
      setAttachReportId('');
      setRecordState('saved');
      /* Tell the parent tab to refetch so the new Coach Review
         surfaces in the gallery immediately (instead of waiting
         for a manual reload). */
      onUploaded?.();
      window.setTimeout(() => setRecordState('idle'), 2500);
    } catch (err: any) {
      console.error('Bundle recording upload failed:', err);
      setRecordError(err?.message || 'Upload failed');
      setRecordState('error');
    }
  }, [pendingClip, playerId, recordingCategory, videos, label, onUploaded, attachReportId, reports]);

  const discardClip = useCallback(() => {
    if (!pendingClip) return;
    URL.revokeObjectURL(pendingClip.previewUrl);
    setPendingClip(null);
    setRecordError(null);
    setRecordState('idle');
  }, [pendingClip]);

  const restartClip = useCallback(async () => {
    if (!pendingClip) return;
    URL.revokeObjectURL(pendingClip.previewUrl);
    setPendingClip(null);
    setRecordError(null);
    /* Small async beat before kicking off the next recording so the
       prior preview's media elements have a chance to tear down. */
    setRecordState('idle');
    await new Promise((r) => setTimeout(r, 60));
    await startRecording();
  }, [pendingClip, startRecording]);

  /* Cleanup on unmount — stop any active recording / audio stream
     and free the pending preview URL. The preview blob URL must be
     revoked or it leaks memory across opens. */
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        try { r.stop(); } catch { /* ignore */ }
      }
      if (pendingClip?.previewUrl) {
        URL.revokeObjectURL(pendingClip.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Grid columns — counts only VISIBLE panes (eye-hidden ones don't
     contribute to the column math so the layout doesn't get stuck
     in 3-col when half the panes are hidden). */
  const visibleMainCount = videos.length - hiddenIdx.size;
  const visibleCompare = compareOn && !compareHidden ? 1 : 0;
  const baseCount = visibleMainCount + visibleCompare;
  const cols =
    baseCount <= 1 ? 1
    : baseCount === 2 ? 2
    : baseCount <= 4 ? 2
    : 3;

  /* Time formatter — used by the scrubber readouts. */
  const fmtTime = (t: number) => {
    if (!Number.isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /* Hidden-pane chip style. Text hardcoded to `#ffffff` (was
     `var(--text-bright)`) and border bumped to a brighter
     `rgba(255,255,255,0.45)` so the chip text + outline read
     clearly on the dim strip background regardless of theme. The
     theme-aware token would resolve to near-black in light mode,
     making the chip text disappear against the dark
     `var(--border)` fill. Background stays
     `rgba(255,255,255,0.10)` so the chips lift off the row's own
     0.04 surface. The SVG eye icon inside picks up `currentColor`
     and renders white too. */
  const hiddenChipStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.45)',
    color: '#ffffff',
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  /* Per-pane eye toggle button — top-right corner of each video.
     Same chrome whether it's a main angle or the Compare pane.
     Color hardcoded to `#ffffff` (was `var(--text-bright)`) so the
     SVG icon inside reads white against the dark badge backdrop in
     both themes; theme-aware token would resolve to near-black in
     light mode and disappear into the dark 0.65-alpha background.
     Slight contrast bump on the background + border too so the
     button reads as a deliberate UI affordance rather than a faint
     overlay. */
  const paneEyeBtnStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.72)',
    border: '1px solid rgba(255,255,255,0.45)',
    color: '#ffffff',
    width: 26,
    height: 26,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  };

  /* Inline white-stroke SVG eye glyph — replaces the `👁` emoji which
     OSes render with fixed color (couldn't respond to CSS `color`).
     The SVG inherits `currentColor` so it picks up the white from
     `paneEyeBtnStyle.color` and stays consistently bright on the
     dark badge backdrop. 16px box (62% of the 26-px button) lands
     visually-centered with a touch of breathing room. */
  const EyeIconSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  /* Record button — IDLE state flips per theme so the chip reads on
     whatever surface it's sitting on (white bubble in light theme,
     dark backdrop in dark theme). The active states
     (recording-red / saved-green) stay constant since accent colors
     work on either backdrop. */
  const recBg =
    recordState === 'recording' ? 'rgba(239, 68, 68, 0.22)'
    : recordState === 'saved' ? 'rgba(74, 222, 128, 0.18)'
    : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255,255,255,0.06)');
  const recBorder =
    recordState === 'recording' ? 'rgba(239, 68, 68, 0.65)'
    : recordState === 'saved' ? 'rgba(74, 222, 128, 0.55)'
    : (isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255,255,255,0.18)');
  const recColor =
    recordState === 'recording' ? '#fecaca'
    : recordState === 'saved' ? '#bbf7d0'
    : (isLight ? '#0a0d12' : '#fff');

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: modalBackdrop,
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
      }}
    >
      {/* Outer WHITE BUBBLE — wraps EVERYTHING inside the modal:
          header row (title + Sync + Close), error banner, video
          grid, AND the bottom playback toolbar. Hardcoded `#ffffff`
          in both themes (same way the video tiles stay `#000` in
          both) so the entire playback UI reads as one unified
          white card lifted off the dim modal backdrop. The
          pendingClip preview overlay still sits OUTSIDE this
          bubble (absolute-positioned over the whole modal) so a
          recorded take floats on top of the bubble.
          `flex: 1` + `minHeight: 0` lets the bubble fill the
          backdrop's available height while the video grid inside
          scrolls if the content exceeds the viewport. */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: '#ffffff',
        border: '1px solid rgba(0, 0, 0, 0.10)',
        borderRadius: 14,
        padding: 14,
        color: '#0a0d12',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.10), 0 4px 12px rgba(0, 0, 0, 0.08)',
      }}>
      {/* Header row — plain flex row inside the outer bubble.
          Chrome (background / border / radius / shadow) was retired
          here when the bubble was expanded to wrap everything;
          the row no longer needs its own pill since it sits inside
          the larger white surface. Sync + Close buttons keep their
          translucent-black-on-white styles so they read against
          the bubble fill in both themes. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: '#0a0d12',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: 0.65,
          }}>
            {videos.length} angles
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {label}
          </div>
        </div>

        {/* Sync toggle — sits inside the white bubble alongside the
            title. Active (synced) state keeps the accent-blue tint;
            inactive flips to a translucent-BLACK chip so it reads on
            the white bg (the prior `rgba(255,255,255,0.06)` chip
            would have disappeared into the bubble surface). */}
        <button
          type="button"
          onClick={() => setSynced((v) => !v)}
          title={synced ? 'Currently synced — click to unsync' : 'Currently unsynced — click to re-sync'}
          style={{
            background: synced ? 'rgba(96,165,250,0.18)' : 'rgba(0, 0, 0, 0.04)',
            border: `1px solid ${synced ? 'rgba(96,165,250,0.55)' : 'rgba(0, 0, 0, 0.14)'}`,
            color: synced ? '#1F5FD1' : '#0a0d12',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {synced ? '⇄ Synced' : '⇆ Unsynced'}
        </button>

        {/* Close affordance — also lives inside the bubble now so the
            three header elements (title / sync / close) read as one
            row. Same translucent-black-on-white chrome as the
            inactive Sync chip above so the two controls match. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 36, height: 36,
            borderRadius: 10,
            border: '1px solid rgba(0, 0, 0, 0.14)',
            background: 'rgba(0, 0, 0, 0.04)',
            color: '#0a0d12',
            fontSize: 18,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Inline error readout. */}
      {recordError && (
        <div style={{
          padding: '6px 12px',
          marginBottom: 10,
          borderRadius: 6,
          fontSize: 12,
          color: '#fecaca',
          background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.30)',
        }}>
          {recordError}
        </div>
      )}

      {/* Scrubber + master control bar relocated to a bottom toolbar
          beneath the video grid — see the bottom-toolbar block below
          the grid. Their position used to be above the grid; moved
          per coach-spec so all playback controls live in one row at
          the bottom of the modal, freeing the top edge for the
          label + sync toggle alone. */}

      {/* Hidden-pane chip strip — only renders when at least one pane
          is eye-toggled out. Each chip restores that pane on click. */}
      {(hiddenIdx.size > 0 || (compareOn && compareHidden)) && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          marginBottom: 10,
          padding: '6px 10px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
            textTransform: 'uppercase',
            /* Bumped 0.6 → 0.92 so the "Hidden:" eyebrow reads
               clearly against the dim 0.04-alpha strip background.
               Still slightly under pure white so it doesn't compete
               with the white chip text alongside it. */
            color: 'rgba(255,255,255,0.92)',
            alignSelf: 'center', marginRight: 4,
          }}>
            Hidden:
          </span>
          {Array.from(hiddenIdx).sort((a, b) => a - b).map((i) => {
            const camera = splitVideoTitle(videos[i]?.title || '').cameraLabel || `Angle ${i + 1}`;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setHiddenIdx((prev) => {
                    const next = new Set(prev);
                    next.delete(i);
                    return next;
                  });
                }}
                style={hiddenChipStyle}
                title="Restore this angle"
              >
                {EyeIconSvg} {camera}
              </button>
            );
          })}
          {compareOn && compareHidden && (
            <button
              type="button"
              onClick={() => setCompareHidden(false)}
              style={hiddenChipStyle}
              title="Restore Compare pane"
            >
              {EyeIconSvg} Compare
            </button>
          )}
        </div>
      )}

      {/* Grid of every visible angle. Hidden panes are skipped
          (restorable via the Hidden chip strip above).
          `gridAutoRows: minmax(200px, 1fr)` lets each row stretch
          to fill the available modal height when there are few
          panes — so a single-video view inflates to the full
          screen rather than sitting at its 200 px minimum — while
          still respecting a floor for high-count views (e.g., 9
          angles in a 3 × 3 grid each get at least 200 px). */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: 'minmax(200px, 1fr)',
        gap: 12,
        minHeight: 0,
        overflow: 'auto',
      }}>
        {videos.map((v, i) => {
          /* IMPORTANT: keep the <video> mounted even when hidden so
             refs / sync continue to work and the master controls
             still drive playback. Just hide it visually + bail on
             rendering the chrome. */
          if (hiddenIdx.has(i)) {
            return (
              <video
                key={v.id}
                ref={(el) => { videoRefs.current[i] = el; }}
                src={v.originalUrl || ''}
                playsInline
                muted
                style={{ display: 'none' }}
              />
            );
          }
          const camera = splitVideoTitle(v.title || '').cameraLabel || `Angle ${i + 1}`;
          return (
            <div
              key={v.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minHeight: 0,
                /* Stretch the pane column to fill its grid cell so
                   the inner video container has a real height to
                   expand into (otherwise it caps at minHeight: 200
                   even when the cell is much taller). */
                height: '100%',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  background: '#000',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  /* `flex: 1` so the video container grows to fill
                     the pane column's remaining height (after the
                     control bar / camera badge etc. below it).
                     Combined with the grid's `minmax(200px, 1fr)`
                     row sizing, single-pane views now inflate to
                     the full modal height instead of sitting at
                     the 200 px minimum. */
                  flex: 1,
                  minHeight: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {v.originalUrl ? (
                  <>
                    <video
                      ref={(el) => { videoRefs.current[i] = el; }}
                      src={v.originalUrl}
                      controls={!synced}
                      playsInline
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                    {/* Drawing overlay — canvas + tool palette
                        layered over each video. Tools: circle /
                        line / arrow / freehand + colors + clear.
                        Click-through when no tool is selected so the
                        native player controls remain interactive.
                        The `onCanvasReady` callback hands the host
                        a ref to this pane's drawing canvas so the
                        recording composite (`drawCompositeFrame`)
                        can layer the annotations onto the captured
                        stream pixel-for-pixel. */}
                    <VideoDrawingOverlay
                      videoRef={{ current: videoRefs.current[i] }}
                      onCanvasReady={(canvas) => {
                        drawingCanvasRefs.current[i] = canvas;
                      }}
                      externalTool={drawingTool}
                      externalColor={drawingColor}
                      hideToolbar
                      onClearReady={(fn) => {
                        drawingClearFnsRef.current[i] = fn;
                      }}
                    />
                  </>
                ) : (
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                    No video URL
                  </div>
                )}
                {/* Camera label badge — top-left. Text color is
                    hardcoded `#ffffff` (not the theme-aware
                    `var(--text-bright)`) because the badge background
                    is a constant dark 0.78-alpha black in both themes,
                    so white is the always-correct foreground. The
                    theme-aware token would resolve to near-black in
                    light theme — invisible against the dark badge. */}
                <div style={{
                  position: 'absolute',
                  top: 8, left: 8,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.78)',
                  border: '1px solid var(--border-light)',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  pointerEvents: 'none',
                }}>
                  {camera}
                </div>
                {/* Eye toggle — top-right corner of the video pane.
                    Click to hide this angle from the grid (restorable
                    via the Hidden chip strip above the grid).

                    The absolute positioning is applied INLINE here
                    (not via the shared `paneEyeBtnStyle`) because the
                    Compare pane reuses `paneEyeBtnStyle` inside its
                    own already-positioned wrapper — adding
                    position:absolute to the shared style would
                    conflict with that wrapper's flex layout. */}
                <button
                  type="button"
                  onClick={() => {
                    setHiddenIdx((prev) => {
                      const next = new Set(prev);
                      next.add(i);
                      return next;
                    });
                  }}
                  aria-label="Hide this angle"
                  title="Hide this angle"
                  style={{
                    ...paneEyeBtnStyle,
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 2,
                  }}
                >
                  {EyeIconSvg}
                </button>
              </div>

              {!synced && videoRefs.current[i] && (
                <VideoControlBar
                  videoRef={{ current: videoRefs.current[i] }}
                  style={{ alignSelf: 'flex-start' }}
                />
              )}
            </div>
          );
        })}

        {/* Compare pane — picker UI when no source selected, otherwise
            the chosen video. Eye-toggleable like the main panes. */}
        {compareOn && !compareHidden && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minHeight: 0,
            height: '100%',
          }}>
            {compareSrc ? (
              <>
                <div style={{
                  position: 'relative',
                  background: '#000',
                  borderRadius: 10,
                  border: '1px solid rgba(126,182,255,0.45)',
                  overflow: 'hidden',
                  flex: 1,
                  minHeight: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <video
                    ref={compareVideoRef}
                    src={compareSrc.url}
                    controls={!synced}
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                  {/* Drawing overlay on the Compare pane — same
                      tools as the main angles. Captured into the
                      composite via `compareDrawingCanvasRef`. */}
                  <VideoDrawingOverlay
                    videoRef={compareVideoRef}
                    onCanvasReady={(canvas) => {
                      compareDrawingCanvasRef.current = canvas;
                    }}
                    externalTool={drawingTool}
                    externalColor={drawingColor}
                    hideToolbar
                    onClearReady={(fn) => {
                      compareDrawingClearFnRef.current = fn;
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: 8, left: 8,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'rgba(126,182,255,0.30)',
                    border: '1px solid rgba(126,182,255,0.55)',
                    color: 'var(--text-bright)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    maxWidth: 'calc(100% - 100px)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {compareSrc.label}
                  </div>
                  {/* Top-right cluster: Change + Eye */}
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    display: 'flex', gap: 4,
                  }}>
                    <button
                      type="button"
                      onClick={() => setCompareSrc(null)}
                      style={{
                        ...paneEyeBtnStyle,
                        width: 'auto',
                        padding: '0 8px',
                        fontSize: 10,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                      title="Choose a different video"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareHidden(true)}
                      aria-label="Hide Compare pane"
                      title="Hide Compare pane"
                      style={paneEyeBtnStyle}
                    >
                      {EyeIconSvg}
                    </button>
                  </div>
                </div>
                {!synced && compareVideoRef.current && (
                  <VideoControlBar
                    videoRef={compareVideoRef}
                    style={{ alignSelf: 'flex-start' }}
                  />
                )}
              </>
            ) : (
              <ComparePicker
                picker={picker}
                setPicker={setPicker}
                athletes={filteredAthletes}
                athletesLoading={athletesLoading}
                athleteVideos={athleteVideos}
                athleteVideosLoading={athleteVideosLoading}
                onPick={(src) => setCompareSrc(src)}
                onHide={() => setCompareHidden(true)}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Bottom playback toolbar ──
          Hosts the master scrubber + master control bar (synced
          mode) plus the Record + Compare buttons + MIC LIVE
          indicator. Moved here from the modal header per coach
          spec so every playback control sits in one row at the
          bottom of the video grid, freeing the top edge for the
          label + Sync toggle alone. Unsynced mode renders only
          the Record / Compare row (per-pane VideoControlBars
          beneath each video carry the playback transport). */}
      <div style={{
        marginTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {/* Master scrubber — synced mode only. Wide horizontal seek
            bar with current time / total duration readouts. Seek
            fans out to every follower via the `seeked` event the
            master fires on currentTime change. */}
        {synced && videoRefs.current[0] && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 14px',
            background: scrubberRowBg,
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: scrubberRowTextColor,
          }}>
            <span style={{ fontSize: 12, opacity: 0.8, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(masterTime)}
            </span>
            <input
              type="range"
              min={0}
              /* Scrubber stays interactive even while the video's
                 duration is still loading (some sources — streamed
                 WebM, partially-buffered uploads — never report a
                 finite `duration` until after first play). Falls
                 back to a 60 s range when unknown so the user can
                 click without seeing a stuck "wait" cursor; the
                 actual seek will clamp to whatever range the
                 browser eventually exposes. */
              max={masterDuration > 0 ? masterDuration : 60}
              step={0.05}
              value={masterDuration > 0
                ? Math.min(Math.max(masterTime, 0), masterDuration)
                : Math.min(Math.max(masterTime, 0), 60)}
              onPointerDown={() => { scrubbingRef.current = true; }}
              onPointerUp={() => { scrubbingRef.current = false; }}
              onBlur={() => { scrubbingRef.current = false; }}
              onInput={(e) => {
                const t = Number((e.target as HTMLInputElement).value);
                setMasterTime(t);
                const master = videoRefs.current[0];
                if (master) {
                  try { master.currentTime = t; } catch { /* ignore */ }
                }
              }}
              onChange={(e) => {
                scrubbingRef.current = false;
                const t = Number((e.target as HTMLInputElement).value);
                setMasterTime(t);
                const master = videoRefs.current[0];
                if (master) {
                  try { master.currentTime = t; } catch { /* ignore */ }
                }
              }}
              aria-label="Playback position"
              style={{
                flex: 1,
                accentColor: '#60A5FA',
                /* Always pointer — the wait-cursor on duration-unknown
                   state was producing a "spinny wheel" hover that
                   made the scrubber feel broken even when the video
                   was playing fine. */
                cursor: 'pointer',
                height: 16,
              }}
            />
            <span style={{ fontSize: 12, opacity: 0.8, minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(masterDuration)}
            </span>
          </div>
        )}

        {/* Unified bottom bar — Playback / Draw / Record + Compare
            all live inside ONE container with shared bg + border so
            the bottom reads as a single chunky toolbar rather than
            three separate floating chips. Group spacers (tall
            translucent rules) divide the sections inside.
            `justify-content: space-between` still distributes the
            three groups across the full width; each wraps
            internally on narrow viewports so nothing overlaps. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          padding: '6px 12px',
          background: playbackBarBg,
          border: '1px solid var(--border-light)',
          boxShadow: playbackBarShadow,
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {synced && videoRefs.current[0] && (
              <VideoControlBar
                videoRef={{ current: videoRefs.current[0] }}
                /* Override the bar's built-in chrome (bg / border /
                   box-shadow) so it sits flush inside the outer
                   unified bottom toolbar instead of looking like a
                   floating chip-in-a-chip. */
                style={{
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  boxShadow: 'none',
                }}
              />
            )}
          </div>

          {/* Section separator — tall vertical rule between Playback
              and Draw groups. Only renders when the playback bar is
              visible (synced mode) so unsynced view doesn't show a
              dangling divider. */}
          {synced && videoRefs.current[0] && (
            <span style={{
              width: 1,
              alignSelf: 'stretch',
              background: 'var(--border-strong)',
            }} />
          )}

          {/* Drawing toolbar — global tool + color picker. Sits
              between the playback bar and Record per coach spec so
              annotation controls land in the natural visual path
              from "control playback" → "annotate frame" → "record
              narration". Now lives inside the unified bottom bar
              with no own chrome — divider rules on either side
              separate it from neighboring sections. */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)',
              marginRight: 4,
            }}>
              Draw
            </span>
            {([
              { key: 'circle',   label: 'Circle',   svg: <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="6" cy="6" r="4.2" /></svg> },
              { key: 'line',     label: 'Line',     svg: <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="2" y1="10" x2="10" y2="2" /></svg> },
              { key: 'arrow',    label: 'Arrow',    svg: <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="10" x2="9" y2="3" /><polyline points="5,2 9,2 9,6" /></svg> },
              { key: 'freehand', label: 'Freehand', svg: <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 9 Q4 5 6 6 T10 3" /></svg> },
            ] as const).map((t) => {
              const active = drawingTool === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => setDrawingTool(active ? null : (t.key as DrawingTool))}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28, height: 28,
                    borderRadius: 6,
                    background: active ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.04)',
                    border: '1px solid ' + (active ? 'rgba(126,182,255,0.55)' : 'rgba(255,255,255,0.14)'),
                    color: active ? 'var(--text-bright)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  {t.svg}
                </button>
              );
            })}

            {/* Vertical separator before color swatches. */}
            <span style={{ width: 1, height: 18, background: 'var(--border-strong)', alignSelf: 'center', margin: '0 4px' }} />

            {(['#ef4444', '#facc15', '#7eb6ff'] as const).map((c) => {
              const active = drawingColor === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  title={`Color ${c}`}
                  onClick={() => setDrawingColor(c as DrawingColor)}
                  style={{
                    width: 22, height: 22,
                    borderRadius: '50%',
                    background: c,
                    border: '2px solid ' + (active ? '#fff' : 'rgba(255,255,255,0.30)'),
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 8px rgba(255,255,255,0.55)' : 'none',
                    padding: 0,
                  }}
                />
              );
            })}

            <button
              type="button"
              onClick={() => {
                for (const fn of drawingClearFnsRef.current) {
                  if (fn) fn();
                }
                if (compareDrawingClearFnRef.current) compareDrawingClearFnRef.current();
              }}
              title="Clear all annotations across every pane"
              style={{
                marginLeft: 4,
                padding: '4px 10px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.40)',
                color: '#fca5a5',
                fontFamily: 'inherit',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Clear All
            </button>
          </div>

          {/* Section separator — tall vertical rule between Draw
              and Record/Compare groups. Matches the rule between
              Playback and Draw on the other side of the Draw block. */}
          <span style={{
            width: 1,
            alignSelf: 'stretch',
            background: 'var(--border-strong)',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Record button — composite recording of the grid. */}
            {playerId && (
              <button
                type="button"
                onClick={recordState === 'recording' ? stopRecording : startRecording}
                disabled={recordState === 'starting' || recordState === 'uploading'}
                title="Record narration (composite of all visible angles + mic)"
                style={{
                  background: recBg,
                  border: `1px solid ${recBorder}`,
                  color: recColor,
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: (recordState === 'starting' || recordState === 'uploading') ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {recordState === 'recording' && (
                  <span style={{
                    display: 'inline-block', width: 7, height: 7, borderRadius: 4,
                    background: '#ef4444',
                    animation: 'bundle-rec-pulse 1.2s ease-in-out infinite',
                  }} />
                )}
                {recordState === 'starting' && '…'}
                {recordState === 'recording' && '■ Stop'}
                {recordState === 'uploading' && 'Saving…'}
                {recordState === 'saved' && '✓ Saved'}
                {recordState === 'error' && '⚠ Retry'}
                {recordState === 'idle' && '● Record'}
                <style>{`@keyframes bundle-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
              </button>
            )}

            {/* Mic-active indicator — appears next to Record while
                recording. Confirms the coach's mic is hot AND being
                captured into the MediaRecorder stream alongside the
                silent video composite. */}
            {recordState === 'recording' && (
              <span
                title="Microphone is being captured"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.45)',
                  color: '#fecaca',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>🎙</span>
                MIC LIVE
              </span>
            )}

            {/* Compare toggle — opens a picker pane (Position / Athlete
                / MLB / Drills). The selected video populates a grid
                cell for side-by-side comparison. */}
            <button
              type="button"
              onClick={() => {
                setCompareOn((v) => {
                  const next = !v;
                  if (next) {
                    setCompareHidden(false);
                  } else {
                    setCompareSrc(null);
                  }
                  return next;
                });
              }}
              title="Pick a video to compare alongside the bundle"
              /* Compare button — IDLE state flips per theme like the
                 Record button above. Active (compareOn) state keeps
                 the accent-blue chip in both themes — the blue
                 reads on either backdrop. In light theme the active
                 text shifts a touch darker so it still reads against
                 the lighter blue tint without disappearing into the
                 surrounding white bubble. */
              style={{
                background: compareOn
                  ? 'rgba(126,182,255,0.20)'
                  : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255,255,255,0.06)'),
                border: `1px solid ${compareOn
                  ? 'rgba(126,182,255,0.55)'
                  : (isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255,255,255,0.18)')}`,
                color: compareOn
                  ? (isLight ? '#1F5FD1' : '#cfe0ff')
                  : (isLight ? '#0a0d12' : '#fff'),
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {compareOn ? '✓ Compare' : 'Compare'}
            </button>
          </div>
        </div>
      </div>
      </div>{/* /outer white bubble — contains header + error + grid + playback toolbar */}

      {/* Pending clip preview overlay — sits on top of the modal
          when `pendingClip` is set (i.e. recording just stopped).
          Shows a playable preview of the take + 3 actions:
            • Save to Profile — uploads, refreshes parent, closes preview
            • Restart         — discards this take and starts a new one
            • Discard         — drops the take and returns to idle
          Click on the dim backdrop is a no-op to prevent accidental
          loss of a recorded take. */}
      {pendingClip && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: previewBackdrop,
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{
            width: '100%',
            maxWidth: 880,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            background: previewCardBg,
            border: '1px solid var(--border-light)',
            borderRadius: 14,
            padding: 18,
            color: previewCardTextColor,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  opacity: 0.75,
                }}>
                  Coach Review · {pendingClip.durationSec}s
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                  Review your recording
                </div>
              </div>
              <div style={{
                fontSize: 11,
                opacity: 0.6,
                letterSpacing: '0.04em',
              }}>
                Choose Save / Restart / Discard
              </div>
            </div>

            <video
              src={pendingClip.previewUrl}
              controls
              autoPlay
              playsInline
              style={{
                width: '100%',
                maxHeight: '50vh',
                background: '#000',
                borderRadius: 10,
                border: '1px solid var(--border)',
              }}
            />

            {/* Attach to report dropdown — only renders when the
                modal was given a `reports` list. Leaving the
                dropdown at the default ("Don't attach") saves the
                clip only into the global gallery; picking a report
                additionally writes the video ID into that report's
                content.coachReviewVideoIds list so the per-report
                Coach Reviews panel can surface it. */}
            {reportsFiltered && reportsFiltered.length > 0 && (
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.65)',
              }}>
                Attach to report (optional)
                <select
                  value={attachReportId}
                  onChange={(e) => setAttachReportId(e.target.value)}
                  disabled={recordState === 'uploading'}
                  style={{
                    background: 'var(--border)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-bright)',
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                >
                  <option value="">Don&apos;t attach — save to gallery only</option>
                  {reportsFiltered.map((r) => {
                    const dt = new Date(r.createdAt).toLocaleDateString();
                    const lbl = r.title?.trim() || `${r.reportType} — ${dt}`;
                    return (
                      <option key={r.id} value={r.id}>{lbl}</option>
                    );
                  })}
                </select>
              </label>
            )}

            {recordError && (
              <div style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                color: '#fecaca',
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.30)',
              }}>
                {recordError}
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}>
              <button
                type="button"
                onClick={discardClip}
                disabled={recordState === 'uploading'}
                style={pendingBtnStyle('neutral', recordState === 'uploading')}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={restartClip}
                disabled={recordState === 'uploading'}
                style={pendingBtnStyle('neutral', recordState === 'uploading')}
              >
                ⟳ Restart
              </button>
              <button
                type="button"
                onClick={saveClip}
                disabled={recordState === 'uploading' || !playerId}
                style={pendingBtnStyle('primary', recordState === 'uploading')}
              >
                {recordState === 'uploading' ? 'Saving…' : '✓ Save to Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pending preview button helper ────────────────────────────────── */
function pendingBtnStyle(
  variant: 'primary' | 'neutral',
  disabled: boolean,
): React.CSSProperties {
  const primary = variant === 'primary';
  return {
    padding: '10px 18px',
    borderRadius: 8,
    border: '1px solid ' + (primary ? 'rgba(74,222,128,0.55)' : 'rgba(255,255,255,0.18)'),
    background: primary ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.05)',
    color: primary ? '#bbf7d0' : '#fff',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.03em',
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontFamily: 'inherit',
  };
}

/* ─── ComparePicker — dropdown panel that fills the Compare grid pane
   until the coach has chosen a video to compare against. Four
   sources:
     • Position — client-side filter over the Athletes list
     • Athlete — fetches that athlete's videos on select
     • Major League Video — stubbed (no backend endpoint yet)
     • Drills — stubbed (no backend endpoint yet)
   When the coach clicks a result video, `onPick` populates the
   compare pane with that video. */
function ComparePicker({
  picker,
  setPicker,
  athletes,
  athletesLoading,
  athleteVideos,
  athleteVideosLoading,
  onPick,
  onHide,
}: {
  picker: { position: string; athleteId: string; library: '' | 'mlb' | 'drills' };
  setPicker: React.Dispatch<React.SetStateAction<{
    position: string; athleteId: string; library: '' | 'mlb' | 'drills';
  }>>;
  athletes: Player[];
  athletesLoading: boolean;
  athleteVideos: Video[];
  athleteVideosLoading: boolean;
  onPick: (src: { url: string; label: string }) => void;
  onHide: () => void;
}) {
  const POSITIONS = ['C', 'INF', 'OF', 'P', 'UTIL'];

  return (
    <div
      style={{
        background: 'rgba(126,182,255,0.05)',
        border: '1px dashed rgba(126,182,255,0.55)',
        borderRadius: 10,
        padding: 14,
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        color: 'var(--text-bright)',
        position: 'relative',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.10em',
          textTransform: 'uppercase', color: '#cfe0ff',
        }}>
          Pick a video to compare
        </div>
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide Compare pane"
          title="Hide Compare pane"
          style={{
            background: 'rgba(0,0,0,0.72)',
            border: '1px solid rgba(255,255,255,0.45)',
            color: '#ffffff',
            width: 24, height: 24,
            borderRadius: 6,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Inline white-stroke SVG eye — duplicate of `EyeIconSvg`
              inside VideoBundleModal, but this `ComparePicker` is a
              separate component declared lower in the same file and
              that constant isn't in scope here. Kept identical so
              both eye buttons render the same glyph. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" focusable="false">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      <PickerField label="Position">
        <select
          value={picker.position}
          onChange={(e) => setPicker((p) => ({ ...p, position: e.target.value }))}
          style={pickerSelectStyle}
        >
          <option value="">All positions</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </PickerField>

      <PickerField label="Athlete">
        <select
          value={picker.athleteId}
          onChange={(e) => setPicker((p) => ({ ...p, athleteId: e.target.value }))}
          style={pickerSelectStyle}
        >
          <option value="">
            {athletesLoading ? 'Loading athletes…' : 'Select athlete…'}
          </option>
          {athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.firstName} {a.lastName} {a.positions ? `(${a.positions})` : ''}
            </option>
          ))}
        </select>
      </PickerField>

      <PickerField label="Library">
        <select
          value={picker.library}
          onChange={(e) => setPicker((p) => ({ ...p, library: e.target.value as '' | 'mlb' | 'drills' }))}
          style={pickerSelectStyle}
        >
          <option value="">— None —</option>
          <option value="mlb">Major League Video</option>
          <option value="drills">Drills</option>
        </select>
      </PickerField>

      {/* Results: athlete video list, or stub for MLB / Drills. */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        marginTop: 4,
        paddingTop: 6,
        borderTop: '1px solid var(--border)',
      }}>
        {picker.athleteId ? (
          athleteVideosLoading ? (
            <div style={pickerEmptyStyle}>Loading videos…</div>
          ) : athleteVideos.length === 0 ? (
            <div style={pickerEmptyStyle}>No videos for this athlete.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {athleteVideos.map((v) => {
                const url = v.hlsUrl || v.originalUrl;
                if (!url) return null;
                const title = normalizeVideoTitle(v.title || '');
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onPick({ url, label: title })}
                    style={pickerVideoRowStyle}
                  >
                    <span style={{ fontSize: 11, color: 'var(--text-bright)', fontWeight: 600 }}>
                      {title}
                    </span>
                    <span style={{
                      fontSize: 9, color: 'rgba(255,255,255,0.55)',
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}>
                      {v.category}
                    </span>
                  </button>
                );
              })}
            </div>
          )
        ) : picker.library === 'mlb' ? (
          <div style={pickerEmptyStyle}>
            Major League Video library — endpoint not yet wired. Ask
            an admin to provision the MLB clip library to enable this.
          </div>
        ) : picker.library === 'drills' ? (
          <div style={pickerEmptyStyle}>
            Drills library — endpoint not yet wired. Ask an admin to
            provision the Drills library to enable this.
          </div>
        ) : (
          <div style={pickerEmptyStyle}>
            Choose a Position, an Athlete, or a Library above.
          </div>
        )}
      </div>
    </div>
  );
}

function PickerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)',
    }}>
      {label}
      {children}
    </label>
  );
}

const pickerSelectStyle: React.CSSProperties = {
  background: 'var(--border)',
  border: '1px solid var(--border-strong)',
  color: 'var(--text-bright)',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};

const pickerVideoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  color: 'var(--text-bright)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const pickerEmptyStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 11,
  padding: '8px 4px',
  textAlign: 'center',
};
