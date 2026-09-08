'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

/* ══════════ DRILL VIDEO RECORDER ══════════

   In-modal camera capture for drill demo clips: record → review →
   Save / Retake / Discard. Sits in place of the Edit Drill form while
   active, so the coach is never looking at two competing sets of
   controls.

   Deliberately single-camera and much simpler than the live/training
   recorder: a drill demo is one angle of one movement, so the
   multi-camera enumeration, bundle grouping, and delayed-mirror
   machinery over there would be dead weight here.

   Capture target is 1080p @ 60 fps per coach spec. Both are `ideal`
   rather than `exact` — a camera that tops out at 30 fps should still
   record a usable clip instead of failing outright with an
   OverconstrainedError. Note the contrast with the live recorders,
   which chase 120-240 fps for swing/pitch analysis: a demo clip is
   watched at normal speed, so 60 keeps the file small. */

/* `novideo` vs `error`: a camera that fails to open when OTHER cameras
   are available is recoverable — the stage shows "No Video" and the
   picker stays put so another device can be chosen. `error` is for the
   unrecoverable case (permission blocked, no cameras at all), where
   there is nothing to pick and the only move is to retry. */
type Phase = 'starting' | 'live' | 'recording' | 'review' | 'novideo' | 'error';

/* The drill upload endpoint caps files at 100MB (multer `fileSize`).
   At the bitrate below that is roughly a minute of 1080p60, which is
   longer than any demo clip — but rather than let a forgotten
   recording hit the server and fail after the whole upload, watch the
   accumulated chunk size and stop cleanly just under the line. */
const MAX_BYTES = 95 * 1024 * 1024;

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function DrillVideoRecorder({ onSave, onDiscard }: {
  /** Hands the finished clip back to the parent, which commits it to the drill. */
  onSave: (file: File) => void;
  /** Abandons the recording AND the drill edit. */
  onDiscard: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sizeMb, setSizeMb] = useState(0);
  const [autoStopped, setAutoStopped] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  /* Mirrors `cameras` for reads inside `openCamera`. Reading the state
     there instead would put `cameras` in its dep array, which would
     rebuild the callback on every enumeration and re-fire the mount
     effect that calls it — reopening the camera in a loop. */
  const camerasRef = useRef<MediaDeviceInfo[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const fileRef = useRef<File | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  /* Release the camera. Called on unmount and on every exit path —
     leaving tracks open keeps the hardware light on and locks the
     device against other apps. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  /* Enumerate video inputs. Only worth calling AFTER a stream is open:
     browsers withhold device `label`s until a capture permission has
     been granted, so calling it earlier yields a list of unnamed
     entries the coach can't choose between.

     Virtual cameras (OBS, NVIDIA Broadcast, ...) are deliberately NOT
     filtered out here, unlike the multi-camera live recorder — that one
     drops them because recording every selected camera at once would
     capture the same underlying feed twice. Picking one device
     explicitly has no such problem, and a coach running their rig
     through OBS should be able to choose it. */
  const refreshCameras = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = list.filter(d => d.kind === 'videoinput' && d.deviceId);
      camerasRef.current = vids;
      setCameras(vids);
    } catch { /* enumeration is best-effort — the recorder still works */ }
  }, []);

  /* ── Open the camera ─────────────────────────────────────────── */
  const openCamera = useCallback(async (requestedId?: string) => {
    setError(null);
    setPhase('starting');
    /* Release any stream still open before requesting another, so
       switching cameras doesn't leave the previous device held. */
    stopStream();
    try {
      const video: MediaTrackConstraints = {
        ...(requestedId ? { deviceId: { exact: requestedId } } : {}),
        width:     { ideal: 1920 },
        height:    { ideal: 1080 },
        frameRate: { ideal: 60 },
      };
      let stream: MediaStream;
      try {
        /* Audio on by default — coaching cues over the demo are the
           whole point of a drill clip. */
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch (err: any) {
        /* A missing/blocked microphone shouldn't cost us the video.
           Retry without audio rather than failing the capture. */
        if (err?.name === 'NotFoundError' || err?.name === 'NotAllowedError') {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;
      /* Read the device back off the track rather than trusting the
         request: with no explicit id the browser picks the default, and
         the dropdown needs to show what's actually running. */
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId || requestedId || '');
      refreshCameras();
      setPhase('live');
    } catch (err: any) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera access for this site and try again.'
          : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError'
            ? 'That camera is no longer available.'
            : err?.name === 'NotReadableError' || err?.name === 'TrackStartError'
              ? 'That camera is in use by another app.'
              : `Could not start the camera: ${err?.message || err}`,
      );
      /* Keep the attempted device selected so the dropdown reflects what
         was picked, and re-enumerate in case it vanished entirely. */
      /* AWAITED: the recoverable-vs-fatal decision below reads the
         camera list this populates. Firing it un-awaited raced the
         enumeration and the first failure always saw an empty list,
         which dropped every failed camera into the locked-out `error`
         state instead of offering the picker. */
      await refreshCameras();
      /* Recoverable as long as there is another camera to switch to. */
      /* Keep the picker's selection honest: the attempted device when
         there was one, otherwise the first camera — which is what the
         <select> falls back to displaying. Leaving it '' would show one
         camera while state held another, and re-picking the displayed
         entry would fire no change event. */
      setDeviceId(requestedId || camerasRef.current[0]?.deviceId || '');
      setPhase(camerasRef.current.length > 1 ? 'novideo' : 'error');
    }
  }, [refreshCameras, stopStream]);

  useEffect(() => {
    openCamera();
    return () => { stopStream(); };
  }, [openCamera, stopStream]);

  /* Keep the list current when a camera is plugged in or removed
     mid-session. */
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { refreshCameras(); };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshCameras]);

  /* Attach the stream once the <video> for the current phase is
     mounted. Set in an effect rather than inline because `srcObject`
     is a property, not an attribute, so React can't set it via JSX. */
  useEffect(() => {
    const el = liveVideoRef.current;
    if (!el || !streamRef.current) return;
    if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
  }, [phase]);

  /* Elapsed-time ticker, live only while recording. */
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  /* ── Start ───────────────────────────────────────────────────── */
  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    /* MP4/H.264 FIRST, webm only as a fallback.

       This is a playback constraint, not a recording one: iOS Safari
       does not play .webm, and players watch drill demos on their
       phones. A VP9 clip recorded on the coach's desktop Chrome would
       upload fine and then refuse to play for half the roster.

       Codec level is deliberately left unpinned (`avc1`, not
       `avc1.42E01E`) so the encoder picks a level that can carry
       1080p60 instead of being held to baseline 720p30. Chrome gained
       MP4 recording support in 126; anything older falls through to
       webm, which still plays everywhere except iOS. */
    const mime = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find(m => MediaRecorder.isTypeSupported(m)) ?? '';

    /* Bitrate scaled off what the camera actually negotiated, not what
       we asked for, at the same 0.10 bits-per-pixel target the live
       recorders use. 1080p60 lands near 12.4 Mbps. */
    const settings = stream.getVideoTracks()[0]?.getSettings();
    const pixelsPerSecond =
      (settings?.width ?? 1920) * (settings?.height ?? 1080) * (settings?.frameRate ?? 60);
    const videoBitsPerSecond = Math.max(
      3_500_000,
      Math.min(60_000_000, Math.round(pixelsPerSecond * 0.10)),
    );

    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond,
    });
    recorderRef.current = recorder;
    chunksRef.current = [];
    bytesRef.current = 0;
    setElapsed(0);
    setSizeMb(0);
    setAutoStopped(false);

    recorder.ondataavailable = ev => {
      if (!ev.data || ev.data.size === 0) return;
      chunksRef.current.push(ev.data);
      bytesRef.current += ev.data.size;
      setSizeMb(bytesRef.current / (1024 * 1024));
      /* Stop just under the endpoint's limit so the clip we hand back
         is always uploadable. */
      if (bytesRef.current >= MAX_BYTES && recorder.state === 'recording') {
        setAutoStopped(true);
        recorder.stop();
      }
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mime || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      /* Wrapped as a File so it flows through the existing
         `uploadDrillVideo` path unchanged — the server derives the
         stored extension from this name.

         The File carries the BASE mime only, with any `;codecs=...`
         parameters stripped. MediaRecorder reports the full
         `video/webm;codecs=vp9,opus`, and multipart parsing on the
         server does not surface that as a `video/*` mimetype, so the
         upload endpoint's `video/` filter rejects the clip with
         "Only video files are allowed". Verified against the live
         endpoint: the parameterised type 400s, the bare type passes.
         The Blob above keeps the full type so the review player still
         knows the codecs. */
      const uploadType = type.split(';')[0].trim() || 'video/webm';
      fileRef.current = new File([blob], `drill-recording-${Date.now()}.${ext}`, { type: uploadType });
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setPhase('review');
    };

    // 1s timeslice so the size guard above has something to measure.
    recorder.start(1000);
    setPhase('recording');
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  };

  /* ── Retake — back to a live viewfinder, clip thrown away ────── */
  const retake = () => {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    fileRef.current = null;
    chunksRef.current = [];
    bytesRef.current = 0;
    setElapsed(0);
    setSizeMb(0);
    setAutoStopped(false);
    /* The stream stays open across a retake, so this is instant. If it
       was lost (device unplugged, tab backgrounded on mobile), reopen. */
    if (streamRef.current && streamRef.current.getVideoTracks().some(t => t.readyState === 'live')) {
      setPhase('live');
    } else {
      openCamera(deviceId || undefined);
    }
  };

  const save = () => {
    const file = fileRef.current;
    if (!file) return;
    stopStream();
    onSave(file);
  };

  const discard = () => {
    stopRecording();
    stopStream();
    onDiscard();
  };

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <>
      <div className={styles.modalBody}>
        {phase === 'error' ? (
          <div className={styles.recorderError}>{error}</div>
        ) : phase === 'novideo' ? (
          <div className={styles.recorderStage}>
            <div className={styles.recorderNoVideo}>No Video</div>
          </div>
        ) : (
          <div className={styles.recorderStage}>
            {phase === 'review' && previewUrl ? (
              <video className={styles.recorderVideo} src={previewUrl} controls playsInline autoPlay />
            ) : (
              /* Muted is required for autoplay of the viewfinder, and
                 stops the room echoing while the mic is hot. */
              <video ref={liveVideoRef} className={styles.recorderVideo} autoPlay muted playsInline />
            )}
            {phase === 'recording' && (
              <div className={styles.recorderBadge}>
                <span className={styles.recorderDot} />
                REC {formatElapsed(elapsed)}
                <span className={styles.recorderSize}>{sizeMb.toFixed(0)} MB</span>
              </div>
            )}
          </div>
        )}

        {/* Offered only with something to choose between, and only
            before recording starts — swapping devices mid-clip would
            end the take. */}
        {(phase === 'live' || phase === 'novideo') && cameras.length > 1 && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Camera</label>
            <select
              className={styles.fieldInput}
              value={deviceId}
              onChange={e => openCamera(e.target.value)}
            >
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {phase === 'novideo' && (
          <span className={styles.fileUploadMeta}>{error} Pick another camera above.</span>
        )}
        {phase === 'starting' && <span className={styles.fileUploadMeta}>Starting camera…</span>}
        {phase === 'live' && (
          <span className={styles.fileUploadMeta}>Recording at 1080p 60fps.</span>
        )}
        {phase === 'review' && (
          <span className={styles.fileUploadMeta}>
            {formatElapsed(elapsed)} · {sizeMb.toFixed(1)} MB
            {autoStopped && ' · stopped at the 100MB upload limit'}
          </span>
        )}
      </div>

      <div className={styles.modalFooter}>
        {phase === 'review' ? (
          <>
            <button className={styles.btnCancel} onClick={discard}>Discard</button>
            <button className={styles.btnCancel} onClick={retake}>Retake</button>
            <button className={styles.btnSave} onClick={save}>Save</button>
          </>
        ) : phase === 'recording' ? (
          <>
            <button className={styles.btnCancel} onClick={discard}>Discard</button>
            <button className={styles.btnSave} onClick={stopRecording}>Stop Recording</button>
          </>
        ) : (
          <>
            <button className={styles.btnCancel} onClick={discard}>Discard</button>
            {phase === 'error' && (
              <button className={styles.btnCancel} onClick={() => openCamera()}>Try Again</button>
            )}
            {phase === 'novideo' && (
              /* Retries the camera currently shown in the picker — the
                 coach may have just closed whatever was holding it. */
              <button className={styles.btnCancel} onClick={() => openCamera(deviceId || undefined)}>Try Again</button>
            )}
            <button className={styles.btnSave} onClick={startRecording} disabled={phase !== 'live'}>
              Start Recording
            </button>
          </>
        )}
      </div>
    </>
  );
}
