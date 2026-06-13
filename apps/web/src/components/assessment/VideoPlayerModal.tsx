'use client';

import { rem } from '@/lib/rem';
import { useEffect, useRef, useCallback, useState } from 'react';
import styles from './video-player.module.css';
import { PlaybackSpeedControl } from '../PlaybackSpeedControl';
import { VideoStopwatch } from '../VideoStopwatch';
import { VideoDrawingOverlay } from '../VideoDrawingOverlay';
import * as api from '@/lib/api';

interface VideoPlayerModalProps {
  videoUrl: string;
  title: string;
  onClose: () => void;
  /** When set, enables the Record button in the modal header.
   *  Captured narration clips (composite of the playing video(s) +
   *  drawings + mic audio) auto-upload as a new Video under this
   *  player ID. Falsy = Record button is hidden. */
  playerId?: string;
  /** Category stamp for narration uploads (e.g. 'HITTING',
   *  'PITCHING', 'CATCHING'). Defaults to 'HITTING'. */
  category?: string;
}

type LoadState = 'loading' | 'ready' | 'error';
type RecordState = 'idle' | 'starting' | 'recording' | 'uploading' | 'saved' | 'error';

export function VideoPlayerModal({ videoUrl, title, onClose, playerId, category = 'HITTING' }: VideoPlayerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /* Track whether the video has loaded enough metadata to play. The bare
     <video> tag previously rendered a silent black rectangle on dead URLs
     / 404s — now we show a spinner while loading and a clear error
     message if the file can't be reached. */
  const [state, setState] = useState<LoadState>('loading');
  /* Compare mode — when enabled, a second video player renders next
     to the primary one. Both share the same source URL for now (the
     coach can pause one and let the other run to compare moments).
     Mirrors the Coaching Studio's compare pattern but lighter-weight.
     A separate `compareVideoRef` lets the compare pane carry its
     own playback / drawing state independent of the primary. */
  const [compareOn, setCompareOn] = useState(false);
  const compareVideoRef = useRef<HTMLVideoElement>(null);

  /* ── Recording state ─────────────────────────────────────────
     The Record button (header) captures the live composite of all
     visible video panes + drawing overlays + microphone audio and
     uploads the result as a NEW Video under `playerId`.
     - `recordState` drives the button label + colour + readout
       ("Record" → "Recording…" → "Uploading…" → "Saved ✓").
     - `compositeCanvasRef` is the hidden off-screen canvas that
       `MediaRecorder` actually records from. Each animation frame
       we draw the current frame of every visible <video> onto it
       (plus each pane's drawing-canvas) so what gets captured is
       the same composite the coach sees on-screen. */
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordError, setRecordError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvas2Ref = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number>(0);
  /* Pending-clip state — when recording stops, the blob lands here
     and the modal shows a preview + Save / Discard buttons instead
     of auto-uploading. `previewUrl` is an object URL the user can
     scrub to review the clip before deciding what to do with it. */
  const [pendingClip, setPendingClip] = useState<{ blob: Blob; previewUrl: string; durationSec: number; mime: string } | null>(null);
  /* Ref to the pending-clip preview <video> so the stopwatch in the
     Save panel can time the just-recorded take. */
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Reset load state if the URL changes (re-using the modal for a different video).
  useEffect(() => { setState('loading'); }, [videoUrl]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  /* ── Composite draw loop ────────────────────────────────────
     Runs on every animation frame while recording. Reads the current
     frame of every visible <video> and the matching drawing canvas,
     then composites them onto `compositeCanvasRef` (the off-screen
     canvas the MediaRecorder is reading from). Compare-mode lays
     the two panes side-by-side on a 1280×360 canvas; single-pane
     mode uses 640×360. */
  const drawCompositeFrame = useCallback(() => {
    const c = compositeCanvasRef.current;
    const v1 = videoRef.current;
    if (!c || !v1) {
      rafRef.current = requestAnimationFrame(drawCompositeFrame);
      return;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);

    if (compareOn) {
      const halfW = c.width / 2;
      ctx.drawImage(v1, 0, 0, halfW, c.height);
      const dc1 = drawingCanvas1Ref.current;
      if (dc1 && dc1.width > 0 && dc1.height > 0) {
        ctx.drawImage(dc1, 0, 0, halfW, c.height);
      }
      const v2 = compareVideoRef.current;
      if (v2 && v2.readyState >= 2) {
        ctx.drawImage(v2, halfW, 0, halfW, c.height);
        const dc2 = drawingCanvas2Ref.current;
        if (dc2 && dc2.width > 0 && dc2.height > 0) {
          ctx.drawImage(dc2, halfW, 0, halfW, c.height);
        }
      }
      /* Vertical divider line between the two panes so the
         composite reads as side-by-side. */
      ctx.fillStyle = 'rgba(255,255,255,0.40)';
      ctx.fillRect(halfW - 1, 0, 2, c.height);
    } else {
      ctx.drawImage(v1, 0, 0, c.width, c.height);
      const dc1 = drawingCanvas1Ref.current;
      if (dc1 && dc1.width > 0 && dc1.height > 0) {
        ctx.drawImage(dc1, 0, 0, c.width, c.height);
      }
    }

    rafRef.current = requestAnimationFrame(drawCompositeFrame);
  }, [compareOn]);

  const startRecording = useCallback(async () => {
    if (!playerId) return;
    setRecordError(null);
    setRecordState('starting');
    try {
      const c = compositeCanvasRef.current;
      if (!c) throw new Error('Recording canvas not ready');

      /* Canvas dimensions — compare-mode widens to 1280 so each
         pane gets a 640 px half. Single-pane uses 960×540 for a
         reasonable 16:9 quality at modest file size. */
      const dims = compareOn
        ? { w: 1280, h: 360 }
        : { w: 960, h: 540 };
      c.width = dims.w;
      c.height = dims.h;

      /* Request microphone — coach's narration is the whole point. */
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = audioStream;

      /* Kick off the composite render loop so the canvas has live
         frames the moment MediaRecorder starts pulling. */
      drawCompositeFrame();

      /* Combine the canvas's video stream + mic audio into one
         MediaStream for MediaRecorder. 30 fps gives clean playback
         at small file sizes; coach narration doesn't need 60 fps. */
      const canvasStream = c.captureStream(30);
      const combined = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
      ]);

      /* Pick the best supported MediaRecorder MIME — VP9+Opus is
         the gold standard but isn't supported everywhere. */
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
      recorder.onstop = async () => {
        /* Tear down the streams + animation loop FIRST so the
           webcam light goes off the moment Stop is tapped. */
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

        /* Park the clip in pendingClip state and show the preview
           panel — the actual upload is deferred until the coach
           clicks Save (or discarded entirely on Discard). Lets the
           coach review the narration before it lands in the
           player's video library. */
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
        const previewUrl = URL.createObjectURL(blob);
        setPendingClip({ blob, previewUrl, durationSec, mime: mime || 'video/webm' });
        setRecordState('idle');
      };

      recorder.start(1000); // collect chunks every 1s for resilience
      recorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      setRecordState('recording');
    } catch (err: any) {
      setRecordError(err?.message || 'Failed to start recording');
      setRecordState('error');
    }
  }, [playerId, category, compareOn, drawCompositeFrame]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const saveClip = useCallback(async () => {
    if (!pendingClip || !playerId) return;
    setRecordError(null);
    setRecordState('uploading');
    try {
      const ext = (pendingClip.mime || '').includes('mp4') ? 'mp4' : 'webm';
      const filename = `coach-narration-${Date.now()}.${ext}`;
      const file = new File([pendingClip.blob], filename, { type: pendingClip.mime });
      /* Title prefix "Coach Review" is the canonical marker every
         tab's video gallery uses to surface review clips at the top
         of its list and to render a "Coach Review" tag chip on the
         placeholder card. Keep this prefix in sync with the
         detection in HittingTab / PitchingTab / DefenseTab and the
         `title.startsWith('Coach Review')` branch in
         VideoPlaceholder. The timestamp is `toLocaleDateString()`
         (date only — no time of day) per spec; the per-clip
         duration is preserved so coaches can tell short cues apart
         from full breakdowns. Detection downstream uses
         `startsWith('Coach Review')` which matches BOTH the new
         prefix and the legacy "Coach Reviewed" prefix so older
         clips still surface as coach-reviewed. */
      const narrationTitle = `Coach Review — ${new Date().toLocaleDateString()} (${pendingClip.durationSec}s)`;
      await api.uploadVideo(file, playerId, narrationTitle, category);
      URL.revokeObjectURL(pendingClip.previewUrl);
      setPendingClip(null);
      setRecordState('saved');
      setTimeout(() => setRecordState('idle'), 2200);
    } catch (err: any) {
      setRecordError(err?.message || 'Upload failed');
      setRecordState('error');
    }
  }, [pendingClip, playerId, category]);

  const discardClip = useCallback(() => {
    if (!pendingClip) return;
    URL.revokeObjectURL(pendingClip.previewUrl);
    setPendingClip(null);
    setRecordError(null);
    setRecordState('idle');
  }, [pendingClip]);

  /* Clean up streams + the animation loop if the modal unmounts
     while a recording is still active. */
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {/* Record + Compare buttons relocated — they now sit
               INSIDE the bottom playback control bar below the
               video so all the controls (Play / Pause / Speed /
               Record / Compare) live in one bar instead of being
               split across the header + bottom bar. Only the close
               affordance remains in the header. */}
            <button className={styles.closeBtn} onClick={onClose}>
              &times;
            </button>
          </div>
          {/* Inline error readout — surfaces mic-permission denials
             or upload failures right under the header so the coach
             sees the problem without opening dev tools. */}
          {recordError && (
            <div style={{
              gridColumn: '1 / -1',
              padding: '4px 10px',
              marginTop: 6,
              borderRadius: 4,
              fontSize: rem(11),
              color: '#fecaca',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.30)',
            }}>
              {recordError}
            </div>
          )}
        </div>
        <div className={styles.videoWrap} style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {/* Pane row — single primary pane, or two side-by-side panes
              when `compareOn` is true. Each pane carries its own
              video element, its own drawing canvas overlay, and its
              own playback control bar so the coach can scrub them
              independently. */}
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Primary pane */}
            <div style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ position: 'relative' }}>
                <video
                  ref={videoRef}
                  className={styles.video}
                  src={videoUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => setState('ready')}
                  onError={() => setState('error')}
                  style={state === 'error' ? { display: 'none' } : undefined}
                />
                {/* Drawing overlay — canvas + tool palette layered
                   over the video. Tools: circle / line / arrow /
                   freehand + color swatches + clear. Click-through
                   when no tool is selected so the video and native
                   controls remain interactive. */}
                {state === 'ready' && (
                  <VideoDrawingOverlay
                    videoRef={videoRef}
                    onCanvasReady={(c) => { drawingCanvas1Ref.current = c; }}
                  />
                )}
              </div>
              {/* Custom video control bar — sits BELOW the native
                  player. Adds Play/Pause, frame-by-frame stepper,
                  0.5× / 0.25× presets, and a continuous 0.10× –
                  2.00× speed slider. */}
              {state === 'ready' && (
                <div style={{
                  marginTop: 6,
                  display: 'flex', alignItems: 'center', gap: 6,
                  flexWrap: 'wrap',
                }}>
                  <PlaybackSpeedControl videoRef={videoRef} />
                  {/* Record narration button — lifted from the
                     header into this bottom row so all the playback
                     controls live together. Only renders when
                     `playerId` is set (the modal needs to know
                     where to upload the resulting clip). */}
                  {playerId && (
                    <button
                      type="button"
                      onClick={recordState === 'recording' ? stopRecording : startRecording}
                      disabled={recordState === 'starting' || recordState === 'uploading'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: recordState === 'recording'
                          ? 'rgba(239, 68, 68, 0.22)'
                          : recordState === 'saved'
                            ? 'rgba(74, 222, 128, 0.18)'
                            : 'rgba(10, 14, 20, 0.85)',
                        border: '1px solid ' + (
                          recordState === 'recording' ? 'rgba(239, 68, 68, 0.65)'
                          : recordState === 'saved' ? 'rgba(74, 222, 128, 0.55)'
                          : 'rgba(255,255,255,0.14)'
                        ),
                        color: recordState === 'recording' ? '#fecaca'
                          : recordState === 'saved' ? '#bbf7d0'
                          : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: rem(9), fontWeight: 700, letterSpacing: '0.10em',
                        textTransform: 'uppercase',
                        cursor: (recordState === 'starting' || recordState === 'uploading') ? 'wait' : 'pointer',
                      }}
                    >
                      {recordState === 'recording' && (
                        <span style={{
                          display: 'inline-block', width: 7, height: 7, borderRadius: 4,
                          background: '#ef4444',
                          animation: 'rec-pulse 1.2s ease-in-out infinite',
                        }} />
                      )}
                      {recordState === 'starting' && '…'}
                      {recordState === 'recording' && '■ Stop'}
                      {recordState === 'uploading' && 'Saving…'}
                      {recordState === 'saved' && '✓ Saved'}
                      {recordState === 'error' && '⚠ Retry'}
                      {recordState === 'idle' && '● Record'}
                      <style>{`@keyframes rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
                    </button>
                  )}
                  {/* Compare toggle — lifted from the header. Opens
                     a second player pane next to the primary so the
                     coach can A/B two moments of the same clip. */}
                  <button
                    type="button"
                    onClick={() => setCompareOn(v => !v)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: compareOn ? 'rgba(126,182,255,0.20)' : 'rgba(10, 14, 20, 0.85)',
                      border: '1px solid ' + (compareOn ? 'rgba(126,182,255,0.55)' : 'rgba(255,255,255,0.14)'),
                      color: compareOn ? 'var(--text-bright)' : 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: rem(9), fontWeight: 700, letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    {compareOn ? '✓ Compare' : 'Compare'}
                  </button>
                </div>
              )}
            </div>

            {/* Compare pane — only renders when the toggle is on.
               Independent video element + drawing overlay + control
               bar (no sync to the primary; each is scrubbable on
               its own so the coach can pause two moments side-by-
               side and annotate both). */}
            {compareOn && state === 'ready' && (
              <div style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
              }}>
                <div style={{ position: 'relative' }}>
                  <video
                    ref={compareVideoRef}
                    className={styles.video}
                    src={videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <VideoDrawingOverlay
                    videoRef={compareVideoRef}
                    onCanvasReady={(c) => { drawingCanvas2Ref.current = c; }}
                  />
                </div>
                <div style={{ marginTop: 6 }}>
                  <PlaybackSpeedControl videoRef={compareVideoRef} />
                </div>
              </div>
            )}
          </div>
          {/* Hidden off-screen composite canvas — drawn to every
              animation frame while recording. MediaRecorder reads
              from `canvas.captureStream(30)` on this element, so
              what gets recorded is the live composite of all
              visible video panes + drawings. */}
          <canvas
            ref={compositeCanvasRef}
            style={{ position: 'absolute', left: -99999, top: -99999, width: 1, height: 1, pointerEvents: 'none' }}
            aria-hidden="true"
          />

          {/* Pending-clip review panel — sits under the video panes
              once a recording has been stopped. Lets the coach
              scrub the captured clip and decide whether to save it
              to the player's video library or throw it away.
              Without this, recordings auto-uploaded on stop and
              there was no way to undo a mistake mid-narration. */}
          {pendingClip && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: 'rgba(10,14,20,0.85)',
                border: '1px solid rgba(126,182,255,0.45)',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' }}>
                <video
                  ref={previewVideoRef}
                  src={pendingClip.previewUrl}
                  controls
                  preload="metadata"
                  style={{
                    width: 240,
                    aspectRatio: '16 / 9',
                    background: '#000',
                    borderRadius: 6,
                  }}
                />
                {/* Stopwatch for timing the recorded take in the Save panel. */}
                <VideoStopwatch videoRef={previewVideoRef} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: rem(10), fontWeight: 700, letterSpacing: '0.18em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  Review Recording
                </div>
                <div style={{ fontSize: rem(13), color: 'var(--text)' }}>
                  {pendingClip.durationSec}s · {(pendingClip.blob.size / 1024 / 1024).toFixed(1)} MB
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button
                    type="button"
                    onClick={saveClip}
                    disabled={recordState === 'uploading'}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      background: 'rgba(74, 222, 128, 0.18)',
                      border: '1px solid rgba(74, 222, 128, 0.55)',
                      color: '#bbf7d0',
                      fontFamily: 'var(--font-mono)',
                      fontSize: rem(11), fontWeight: 700, letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      cursor: recordState === 'uploading' ? 'wait' : 'pointer',
                    }}
                  >
                    {recordState === 'uploading' ? 'Saving…' : '✓ Save'}
                  </button>
                  <button
                    type="button"
                    onClick={discardClip}
                    disabled={recordState === 'uploading'}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.45)',
                      color: '#fecaca',
                      fontFamily: 'var(--font-mono)',
                      fontSize: rem(11), fontWeight: 700, letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      cursor: recordState === 'uploading' ? 'wait' : 'pointer',
                    }}
                  >
                    ✕ Discard
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loading overlay — fades the spinner over the player while the
              first frame loads. */}
          {state === 'loading' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.55)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: rem(13), fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase',
              pointerEvents: 'none',
            }}>
              <div style={{
                width: 22, height: 22,
                borderRadius: '50%',
                border: '2px solid var(--border-strong)',
                borderTopColor: 'rgba(126,182,255,0.9)',
                animation: 'spin 0.9s linear infinite',
                marginRight: 12,
              }} />
              Loading video…
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Error fallback — clear message instead of a silent black box. */}
          {state === 'error' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: 24, textAlign: 'center',
              background: 'rgba(0,0,0,0.65)',
              color: 'rgba(255,255,255,0.9)',
            }}>
              <div style={{ fontSize: rem(32), marginBottom: 10 }}>⚠</div>
              <div style={{ fontSize: rem(14), fontWeight: 700, marginBottom: 6 }}>
                Couldn't load this video
              </div>
              <div style={{ fontSize: rem(12), color: 'rgba(255,255,255,0.6)', maxWidth: 360 }}>
                The video file may have been removed or the connection failed.
                Try refreshing, or contact a coach if the issue persists.
              </div>
              <button
                type="button"
                onClick={() => {
                  setState('loading');
                  // Re-trigger the load by nudging the element.
                  const v = videoRef.current;
                  if (v) { v.load(); }
                }}
                style={{
                  marginTop: 16,
                  padding: '6px 14px',
                  background: 'var(--border)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6, color: 'var(--text-bright)',
                  fontSize: rem(12), fontWeight: 600, cursor: 'pointer',
                }}
              >Retry</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
