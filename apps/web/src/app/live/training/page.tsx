'use client';

/* ─────────────────────────────────────────────────────────────────────
   /live/training — Phase 2 implementation. Three-step flow:

     STEP 1 — SETUP
       Pick the position being trained (Hitting / Pitching / Infield /
       Outfield / Catching), then select 1..N athletes from the
       filtered roster. "Start Session" hits POST /live-sessions and
       transitions to STEP 2.

     STEP 2 — RECORDING
       Two-pane layout. LEFT: roster list with the currently-selected
       player highlighted. CENTER: camera preview + a Start Video /
       Stop Video toggle. Switching to a different player mid-recording
       auto-stops the current clip, saves the resulting Blob into an
       in-memory map keyed by playerId, then arms the new player's
       clip. The camera stream stays open until the session ends or
       the coach explicitly turns the camera off, so consecutive
       recordings don't re-request permission.

     STEP 3 — SAVE
       List every clip recorded in the session with a thumbnail
       (auto-extracted from the first frame). Per row: "Save to
       profile" (uploads the Blob to /videos/upload tagged with
       category=<position>, then patches the TrainingClip's videoId)
       or "Discard". End-Session button completes once all decisions
       are made or the coach explicitly skips.

   Temp store (Phase 2): clips live in-memory inside this component.
   Refreshing the page during a session loses any clips not yet
   saved — a fully durable IndexedDB store is a Phase 5 follow-up.
   ───────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, LiveSession, TrainingClipDetail } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { getCameraLabel } from '@/lib/camera-labels';
import pageStyles from '../page.module.css';
import styles from './page.module.css';

/* ── Position config ──
   Defines what "Hitting" / "Pitching" / etc. mean in terms of:
     • the Player.positions string codes that qualify a player for
       the roster (mirrors apps/web/src/app/training/page.tsx so the
       roster overlap is identical to the Training calendar).
     • the Video.category that gets stamped on saved clips so they
       file into the right tab on the player's profile. */
const POSITION_OPTIONS = [
  {
    key: 'HITTING',
    label: 'Hitting',
    videoCategory: 'HITTING',
    /** Any field player (non-pitcher-only). */
    matches: (positions: string[]) =>
      positions.some(p => ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'INF', 'UTIL'].includes(p)),
  },
  {
    key: 'PITCHING',
    label: 'Pitching',
    videoCategory: 'PITCHING',
    matches: (positions: string[]) => positions.includes('P'),
  },
  {
    key: 'INFIELD',
    label: 'Infield',
    /* `videoCategory: 'INFIELD'` (was 'FIELDING') so saved clips file
       directly into the Defense tab's Infield video section — the
       per-position filter there matches on `v.category === 'INFIELD'`.
       The previous shared 'FIELDING' value meant infield/outfield
       clips never reached either section. */
    videoCategory: 'INFIELD',
    matches: (positions: string[]) =>
      positions.some(p => ['1B', '2B', '3B', 'SS', 'INF'].includes(p)),
  },
  {
    key: 'OUTFIELD',
    label: 'Outfield',
    /* `videoCategory: 'OUTFIELD'` (was 'FIELDING') so saved clips
       file directly into the Defense tab's Outfield video section. */
    videoCategory: 'OUTFIELD',
    matches: (positions: string[]) =>
      positions.some(p => ['LF', 'CF', 'RF', 'OF'].includes(p)),
  },
  {
    key: 'CATCHING',
    label: 'Catching',
    videoCategory: 'CATCHING',
    matches: (positions: string[]) => positions.includes('C'),
  },
] as const;

type PositionKey = (typeof POSITION_OPTIONS)[number]['key'];

/** Sentinel values for the per-bundle "attach to report" picker on the
 *  Save step. `__none__` = save the clip(s) to the player's profile but
 *  don't attach to any report (the historical behavior). `__create__` =
 *  spin up a fresh empty report of the position's type and attach every
 *  clip in this bundle to it. Anything else is treated as an existing
 *  report id. */
const REPORT_NONE = '__none__';
const REPORT_CREATE = '__create__';

/* ── Implement / drill-type tags ──
   Per-position list of "what the athlete is doing" tags surfaced as a
   button bar in the recording step. The selected tag is snapshotted
   onto each clip when recording starts, then concatenated onto the
   saved video's title so coaches can tell at a glance which clip was
   a Dry rep vs a Tee vs a Live BP, etc. */
const IMPLEMENTS_BY_POSITION: Record<PositionKey, readonly string[]> = {
  HITTING:  ['Dry', 'Tee', 'Flips', 'BP', 'Machine', 'Live'],
  PITCHING: ['Warmup', 'Bullpen', 'Live', 'Cool Down'],
  CATCHING: ['Drills', 'Machine', 'Live', 'Throwing'],
  INFIELD:  ['Drills', "GB's", 'Throwing'],
  OUTFIELD: ['Drills', 'Fly Balls', 'Throwing'],
};

function parsePositions(p: Player | null | undefined): string[] {
  if (!p?.positions) return [];
  return p.positions.split(',').map(s => s.trim()).filter(Boolean);
}

/* ── Local clip type ──
   One entry per recording attempt. While the coach is still in the
   session the clip lives in memory only (`blob` + `previewUrl`); on
   END SESSION the coach picks Save (uploads + creates a Video +
   TrainingClip row) or Discard. */
interface LocalClip {
  /** Stable client-side id used as React key + temp-store key. */
  clientId: string;
  playerId: string;
  /** Recorded video blob — typed as webm or mp4 depending on browser. */
  blob: Blob;
  /** object-URL for inline preview (revoked on unmount). */
  previewUrl: string;
  /** Recording duration in seconds (rounded). */
  durationSec: number;
  /** Implement tag in use when this clip was recorded (e.g. "Tee",
   *  "BP", "Bullpen"). Snapshotted at `startRecorder` so a coach can
   *  change the active implement mid-clip without retro-tagging the
   *  already-rolling recording. Empty string when the position has
   *  no implements configured (defensive — every current position
   *  ships with a list, but new positions added later might not). */
  implement: string;
  /** The camera (MediaDeviceInfo.deviceId) this clip was recorded
   *  from. Multi-angle sessions fire N recorders simultaneously, one
   *  per selected camera — each press of "Start Video" generates N
   *  `LocalClip` entries sharing the same player + implement but
   *  differing in `cameraDeviceId` / `cameraLabel`. */
  cameraDeviceId: string;
  /** Friendly OBS-style camera name (e.g. "Side Angle", "Cage Front")
   *  — pulled from Settings → Cameras at snapshot time, falling back
   *  to the browser's reported device label. Appended to the saved
   *  video's title so the gallery reads at a glance. */
  cameraLabel: string;
  /** Identifier shared by every clip recorded in the same Start
   *  Video press. Multi-angle sessions produce N clips per press
   *  (one per active camera) — they share the same `bundleId` so
   *  the Save step can group them as a single "bundle" card with
   *  each angle nested inside. Set to the press's `startedAt`
   *  timestamp (unique per press per player). */
  bundleId: string;
  /** Decision state controlled by the end-session screen. */
  decision: 'pending' | 'saved' | 'discarded';
  /** Filled in once the upload succeeds — points at the new Video. */
  savedVideoId?: string;
  /** Set when an upload is in-flight. */
  uploading?: boolean;
  /** Set on upload failure. */
  uploadError?: string;
}

type Step = 'setup' | 'recording' | 'save';

export default function LiveTrainingPage() {
  const { user, isCoach, isLoading } = useAuth();
  const router = useRouter();

  // ── Auth gate (coach-only) ──
  useEffect(() => {
    /* Wait for the session restore — `user` is null (not undefined) while
       auth-context loads, so checking `user === undefined` never paused and
       a hard refresh of this page bounced every coach to /login → /. */
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  // ── Flow state ──
  const [step, setStep] = useState<Step>('setup');
  const [position, setPosition] = useState<PositionKey | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<LiveSession | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [clips, setClips] = useState<LocalClip[]>([]);

  /* ── Per-bundle "Attach to report" picker (Save step) ──
     A bundle = every clip recorded on a single Start Video press
     (one per active camera angle). All clips in a bundle share the
     same player + moment in time, so the report attachment is a
     bundle-level choice rather than a per-clip choice. Keyed by
     `bundleKey = clip.bundleId ?? clip.clientId`; the value is one
     of `REPORT_NONE`, `REPORT_CREATE`, or an existing report id.

     `bundleCreatedReports` caches the report id created by the
     FIRST clip of a bundle when the picker is set to `REPORT_CREATE`,
     so subsequent clips in the same bundle attach to that report
     instead of spinning up a fresh one per camera angle. */
  const [bundleReportSel, setBundleReportSel] = useState<Record<string, string>>({});
  const [bundleCreatedReports, setBundleCreatedReports] = useState<Record<string, string>>({});

  /* Cached reports per player (lazy-fetched the first time the Save
     step opens). Filtered by the current position's `videoCategory`
     since the picker should only offer reports of the matching type
     (Hitting clips → Hitting reports, Pitching clips → Pitching
     reports, etc.). */
  const [reportsByPlayer, setReportsByPlayer] = useState<Record<string, Array<{ id: string; title: string | null; createdAt: string }>>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  /* Currently-selected implement / drill-type tag (e.g. "Tee", "BP",
     "Bullpen"). Editable any time during the recording step; the
     value is snapshotted at `startRecorder` so changes mid-clip
     don't retroactively re-tag the in-flight recording. */
  const [implement, setImplement] = useState<string>('');

  /* Multi-camera state — every detected video input device + which
     ones are active for this session. The selection is multi-pick
     so the coach can record from several angles simultaneously;
     pressing Start Video fires one MediaRecorder per selected
     camera, and each produces its own `LocalClip` row tagged with
     its camera label. Capped at MAX_CAMERAS so the grid layout
     never has to handle more than 4 tiles (1 big / 2 side / 3 row
     / 2×2 — see `.cameraGrid[data-count=...]` rules in the CSS). */
  const MAX_CAMERAS = 4;
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[]>([]);
  /* Track friendly-label changes from the Settings → Cameras panel
     so the recording UI updates live when the coach renames a
     camera mid-session. The state is just a render trigger — the
     actual values come from `getCameraLabel()`. */
  const [cameraLabelsVersion, setCameraLabelsVersion] = useState(0);
  useEffect(() => {
    const handler = () => setCameraLabelsVersion((v) => v + 1);
    window.addEventListener('camera-labels:changed', handler);
    return () => window.removeEventListener('camera-labels:changed', handler);
  }, []);

  // ── Multi-camera refs (Map-keyed by deviceId) ──
  // Streams + recorders + chunks live per-camera so each angle has
  // an independent capture pipeline. Refs (not state) so React
  // re-renders don't tear streams down. The video element refs
  // are also Map-based — one `<video>` preview per selected camera
  // in the recording grid.
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const recordersRef = useRef<Map<string, MediaRecorder>>(new Map());
  const chunksRef = useRef<Map<string, Blob[]>>(new Map());
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  /* ── 4-second playback delay during recording ─────────────────
     When recording, each camera tile overlays its live <video>
     with a <canvas> that draws frames from `DELAY_MS` ago — so the
     coach sees what happened 4 seconds earlier in real time
     ("delayed mirror"). The MediaRecorder still captures the
     LIVE stream (not the delayed canvas) so saved clips are
     unaffected — this is a display-only buffer for the coach to
     watch the action a beat after it happens. */
  const DELAY_MS = 4000;
  /** Per-camera circular buffer of recent frames. Each entry holds
   *  the capture timestamp + the ImageBitmap; the display loop
   *  picks the frame whose timestamp is closest to `now - DELAY_MS`. */
  const delayBuffersRef = useRef<Map<string, Array<{ ts: number; bitmap: ImageBitmap }>>>(new Map());
  /** Per-camera RAF id for the capture-and-display loop so we can
   *  cancel cleanly when recording stops. */
  const delayRafRef = useRef<Map<string, number>>(new Map());
  /** Canvas refs for the delayed-display overlay tiles. */
  const delayCanvasElsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Pending player-switch — when the coach clicks another player
  // mid-recording, we stop the recorder and wait for the final
  // dataavailable to fire before swapping `activePlayerId`. This
  // ref holds the queued switch target.
  const pendingSwitchRef = useRef<string | null>(null);
  // Tracks whether this component is still mounted so async
  // recorder callbacks (onstop) can bail out of setState if the
  // user navigated away mid-recording. Cleared on unmount via the
  // effect below.
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  /* Warn before tab-close/refresh while any clip is still undecided or
     mid-upload — recordings live only in memory (object URLs) and are
     lost with the page. In-app navigation can't be guarded by the App
     Router; this covers the destructive browser-level exits. */
  const hasUnsavedClips = clips.some((c) => c.decision === 'pending' || c.uploading);
  useEffect(() => {
    if (!hasUnsavedClips) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedClips]);

  // ── Load roster once ──
  useEffect(() => {
    if (!isCoach) return;
    let cancelled = false;
    setLoadingPlayers(true);
    api.getPlayers().then(players => {
      if (cancelled) return;
      setAllPlayers(players);
      setLoadingPlayers(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadingPlayers(false);
    });
    return () => { cancelled = true; };
  }, [isCoach]);

  // ── Roster filtered by picked position ──
  const positionDef = useMemo(
    () => POSITION_OPTIONS.find(p => p.key === position) ?? null,
    [position],
  );
  const eligiblePlayers = useMemo(() => {
    if (!positionDef) return [];
    return allPlayers
      .filter(p => positionDef.matches(parsePositions(p)))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [allPlayers, positionDef]);

  const selectedPlayers = useMemo(
    () => allPlayers.filter(p => selectedIds.has(p.id)),
    [allPlayers, selectedIds],
  );

  /* List of implement tags available for the current position. Empty
     when nothing is selected (Step 1) or the position has no
     implements configured. */
  const availableImplements = useMemo<readonly string[]>(
    () => (position ? IMPLEMENTS_BY_POSITION[position] : []) ?? [],
    [position],
  );

  /* Auto-select the first implement whenever the position changes so
     the coach can hit Start Video immediately without first picking
     an implement. Clears when the position is unset. */
  useEffect(() => {
    if (availableImplements.length > 0) {
      setImplement(availableImplements[0]);
    } else {
      setImplement('');
    }
  }, [availableImplements]);
  const activePlayer = useMemo(
    () => selectedPlayers.find(p => p.id === activePlayerId) ?? null,
    [selectedPlayers, activePlayerId],
  );

  /* ── Enumerate cameras when entering the recording step ──
     Browsers require an active getUserMedia grant before
     `enumerateDevices()` will return real `label` fields, so we
     trigger a one-shot permission request on entry. The result
     populates `availableCameras` and auto-selects the first device
     so single-camera coaches don't have to pick manually. */
  useEffect(() => {
    if (step !== 'recording') return;
    let cancelled = false;
    setCameraError(null);

    const enumerate = async () => {
      try {
        /* One-shot permission grant — open a throwaway stream
           against the default camera so subsequent enumerateDevices
           calls return real device labels. We immediately tear the
           stream down because the per-camera streams below will be
           opened fresh with explicit deviceId constraints. */
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        probe.getTracks().forEach((t) => t.stop());
        if (cancelled) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        /* Filter out virtual cameras (OBS Virtual Camera, NVIDIA
           Broadcast, Snap Camera, generic "Virtual Camera", etc.)
           since they typically wrap another physical camera and
           recording both at once gives you the same stream twice.
           Match on common label substrings — anything else passes
           through. */
        const VIRTUAL_CAM_PATTERNS = [
          /obs\s*virtual/i,
          /\bvirtual\s*camera\b/i,
          /nvidia\s*broadcast/i,
          /snap\s*camera/i,
          /xsplit\s*vcam/i,
        ];
        const isVirtual = (label: string | undefined) =>
          !!label && VIRTUAL_CAM_PATTERNS.some((re) => re.test(label));
        const videoInputs = list.filter((d) =>
          d.kind === 'videoinput'
          && d.deviceId
          && !isVirtual(d.label),
        );
        setAvailableCameras(videoInputs);
        /* Auto-select the first camera on initial entry so coaches
           with a single device don't have to pick. Coaches with
           multiple cameras can add more via the checkbox bar. */
        setSelectedCameraIds((prev) => {
          if (prev.length > 0) return prev;
          return videoInputs.length > 0 ? [videoInputs[0].deviceId] : [];
        });
      } catch (err: any) {
        if (cancelled) return;
        setCameraError(err?.message || 'Camera access denied');
      }
    };
    enumerate();

    return () => { cancelled = true; };
  }, [step]);

  /* ── Per-camera stream lifecycle ──
     Opens a stream for each `selectedCameraIds` entry, tears down
     any stream whose camera was unchecked. Streams persist across
     recording start/stop so the live preview stays warm and the
     next Start Video press doesn't re-trigger a permission grant. */
  useEffect(() => {
    if (step !== 'recording') return;
    let cancelled = false;

    /* Open streams for newly-selected cameras. */
    const openNeeded = async () => {
      for (const id of selectedCameraIds) {
        if (cancelled) return;
        if (streamsRef.current.has(id)) continue;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: id },
              /* Request the camera's native SOURCE up to 4K @ 240 fps.
                 Every constraint uses ONLY `ideal` (no `min`) so the
                 stream still opens when the camera tops out lower —
                 `min` is spec-enforced and would throw
                 `OverconstrainedError` on a typical 30 fps webcam,
                 blocking the whole session. With `ideal` alone, each
                 camera negotiates its highest supported rung under
                 the cap:
                   • 4K @ 60/120 action cams + capture cards → 4K at
                     their native fps
                   • 1080p @ 120/240 high-speed capture cards → 1080p
                     at their full slo-mo rate
                   • 1080p @ 60 webcams → 1080p @ 60
                   • Basic 720p @ 30 devices → 720p @ 30
                 The `videoBitsPerSecond` calculation below reads the
                 actually-negotiated width × height × fps off the
                 track settings so the encoded clip preserves the
                 per-frame quality of whatever resolution + frame
                 rate the camera ended up at. */
              width:     { ideal: 3840 },
              height:    { ideal: 2160 },
              frameRate: { ideal: 240 },
            },
            /* Audio captured only on the FIRST selected camera so the
               combined session has exactly one audio track — most
               coaches narrate over a single mic, and multi-track
               audio on the same recorder confuses some browsers. */
            audio: streamsRef.current.size === 0,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamsRef.current.set(id, stream);
          /* Attach to a preview element if one exists — the element
             refs are populated by the `<video ref=...>` callbacks
             below as React mounts the grid tiles. If the element
             isn't mounted yet, the attach happens via that ref
             callback once it is. */
          const el = videoElsRef.current.get(id);
          if (el) el.srcObject = stream;
        } catch (err: any) {
          if (cancelled) return;
          setCameraError(err?.message || `Camera access denied for ${id}`);
        }
      }
    };

    /* Tear down streams for cameras no longer in the selected list. */
    const closeRemoved = () => {
      const keep = new Set(selectedCameraIds);
      for (const [id, stream] of streamsRef.current.entries()) {
        if (keep.has(id)) continue;
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        streamsRef.current.delete(id);
        const rec = recordersRef.current.get(id);
        if (rec && rec.state !== 'inactive') {
          try { rec.stop(); } catch { /* ignore */ }
        }
        recordersRef.current.delete(id);
        chunksRef.current.delete(id);
      }
    };

    closeRemoved();
    openNeeded();

    return () => {
      cancelled = true;
    };
  }, [step, selectedCameraIds]);

  /* Final teardown — stop every stream + recorder + delay loop
     when leaving the recording step or unmounting. */
  useEffect(() => {
    if (step !== 'recording') return;
    return () => {
      for (const [, rec] of recordersRef.current.entries()) {
        if (rec.state !== 'inactive') {
          try { rec.stop(); } catch { /* ignore */ }
        }
      }
      recordersRef.current.clear();
      chunksRef.current.clear();
      /* Cancel every running delay-display loop and close pending
         ImageBitmaps so we don't leak GPU memory. */
      for (const rafId of delayRafRef.current.values()) {
        cancelAnimationFrame(rafId);
      }
      delayRafRef.current.clear();
      for (const buffer of delayBuffersRef.current.values()) {
        for (const f of buffer) { try { f.bitmap.close(); } catch { /* ignore */ } }
      }
      delayBuffersRef.current.clear();
      delayCanvasElsRef.current.clear();
      for (const [, stream] of streamsRef.current.entries()) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      }
      streamsRef.current.clear();
      videoElsRef.current.clear();
    };
  }, [step]);

  // Revoke object URLs ONCE on unmount (deps `[]`), reading the
  // latest clips array through a ref. The previous version had
  // `[clips]` deps which meant React fired the cleanup from the
  // PREVIOUS effect every time a new clip was appended — that
  // cleanup looped over the OLD clips array and revoked URLs that
  // were still rendered inside the save step's `<video>` elements,
  // breaking the inline previews mid-session.
  const clipsRef = useRef<LocalClip[]>([]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => {
    return () => {
      for (const c of clipsRef.current) {
        try { URL.revokeObjectURL(c.previewUrl); } catch { /* ignore */ }
      }
    };
  }, []);

  // ── Step 1 → Step 2: create the session ──
  const handleStartSession = async () => {
    if (!positionDef || selectedIds.size === 0) return;
    try {
      const created = await api.createLiveSession({
        mode: 'TRAINING',
        position: positionDef.key,
      });
      setSession(created);
      setStep('recording');
      // Auto-select the first roster player so the coach can tap
      // Start Video immediately.
      const first = eligiblePlayers.find(p => selectedIds.has(p.id));
      setActivePlayerId(first?.id ?? null);
    } catch (err: any) {
      setCameraError(`Failed to start session: ${err?.message || err}`);
    }
  };

  /* ── Delay-loop helpers ──────────────────────────────────────
     Each active camera gets a paired capture + display loop that
     reads frames from the live `<video>` element, stores them in
     a rolling buffer, and paints the frame from DELAY_MS ago onto
     the overlay canvas. One `requestAnimationFrame` per camera —
     all browsers we care about handle 4 concurrent rAF loops
     without trouble. Capture uses `createImageBitmap` which is
     async; we guard against frame pile-up with an in-flight flag
     so a slow GPU doesn't queue thousands of pending promises. */
  function startDelayLoop(deviceId: string) {
    const videoEl = videoElsRef.current.get(deviceId);
    const canvasEl = delayCanvasElsRef.current.get(deviceId);
    if (!videoEl || !canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const buffer: Array<{ ts: number; bitmap: ImageBitmap }> = [];
    delayBuffersRef.current.set(deviceId, buffer);
    let captureInFlight = false;

    const tick = () => {
      const now = performance.now();

      /* Capture — pull the current video frame into an ImageBitmap.
         Frame-skip when a previous capture is still resolving so
         the buffer doesn't grow faster than we can drain it. */
      if (
        !captureInFlight
        && videoEl.readyState >= 2
        && videoEl.videoWidth > 0
        && videoEl.videoHeight > 0
      ) {
        captureInFlight = true;
        createImageBitmap(videoEl)
          .then((bitmap) => {
            buffer.push({ ts: now, bitmap });
            /* Trim frames older than DELAY_MS × 1.25 — gives the
               display loop a small safety margin while keeping
               buffer memory bounded. */
            while (buffer.length > 0 && now - buffer[0].ts > DELAY_MS * 1.25) {
              try { buffer.shift()!.bitmap.close(); } catch { /* ignore */ }
            }
            captureInFlight = false;
          })
          .catch(() => { captureInFlight = false; });
      }

      /* Display — find the most recent frame whose timestamp is at
         or before `now - DELAY_MS` and paint it onto the canvas. If
         the buffer is still warming up (first 4 seconds), the
         canvas stays blank with a "Buffering delay…" overlay
         shown via CSS until at least one frame qualifies. */
      const targetTs = now - DELAY_MS;
      let displayBitmap: ImageBitmap | null = null;
      for (const f of buffer) {
        if (f.ts <= targetTs) displayBitmap = f.bitmap;
        else break;
      }
      if (displayBitmap) {
        /* Sync canvas pixel size to the bitmap so we draw at the
           source resolution. CSS handles fitting it to the tile. */
        if (canvasEl.width !== displayBitmap.width) canvasEl.width = displayBitmap.width;
        if (canvasEl.height !== displayBitmap.height) canvasEl.height = displayBitmap.height;
        ctx.drawImage(displayBitmap, 0, 0);
        canvasEl.dataset.warm = '1';
      }

      delayRafRef.current.set(deviceId, requestAnimationFrame(tick));
    };
    delayRafRef.current.set(deviceId, requestAnimationFrame(tick));
  }

  function stopDelayLoop(deviceId: string) {
    const rafId = delayRafRef.current.get(deviceId);
    if (rafId != null) cancelAnimationFrame(rafId);
    delayRafRef.current.delete(deviceId);

    const buffer = delayBuffersRef.current.get(deviceId);
    if (buffer) {
      for (const f of buffer) {
        try { f.bitmap.close(); } catch { /* ignore */ }
      }
    }
    delayBuffersRef.current.delete(deviceId);

    /* Clear the canvas back to transparent so the live <video>
       underneath shows again. Also drop the warm flag so the
       "Buffering…" overlay reappears on the next recording. */
    const canvasEl = delayCanvasElsRef.current.get(deviceId);
    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      delete canvasEl.dataset.warm;
    }
  }

  // ── Step 2: recording controls (multi-camera) ──
  const startRecorder = () => {
    if (!activePlayerId) return;
    /* Build the active-camera list — only cameras whose stream is
       actually open get a recorder. Skips selected-but-not-yet-
       opened cameras (e.g. permission pending) without dropping the
       whole Start press. */
    const activeIds = selectedCameraIds.filter((id) => streamsRef.current.has(id));
    if (activeIds.length === 0) return;

    // Pick the broadest-supported video MIME for MediaRecorder. webm
    // works on Chrome/Edge/Firefox; Safari falls back to mp4 with
    // no explicit MIME (the empty-string options below).
    const mimeCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

    /* Snapshot the shared per-press values ONCE so every recorder's
       onstop callback closes over the same player + implement
       context — even if the coach switches mid-clip, every angle
       saved for this press belongs to the same logical recording. */
    const startedAt = Date.now();
    const playerIdSnapshot = activePlayerId;
    const implementSnapshot = implement;
    /* One bundle id per Start Video press — every angle recorded
       during this press carries the same id so the Save step can
       group them as a bundle card. Use `playerId-startedAt` so the
       id is human-debuggable in the React tree if needed. */
    const bundleId = `${playerIdSnapshot}-${startedAt}`;
    /* Track how many recorders still need to drain so we know when
       the press's full set of clips has landed. Used to complete a
       queued player-switch only after every angle's onstop has
       finalized. */
    let pendingStops = activeIds.length;

    for (const deviceId of activeIds) {
      const stream = streamsRef.current.get(deviceId);
      if (!stream) { pendingStops--; continue; }
      /* Inspect the resolution + frame rate the camera actually
         negotiated (often lower than the 4K @ 240 we requested via
         `getUserMedia` — see the stream-open effect). Use them to
         scale the MediaRecorder bitrate against the source's
         pixels-per-second so the encoded clip preserves the
         per-frame quality of whatever the camera opened at.

         Bits-per-pixel target: 0.10 bpp is a balanced H.264 / VP9
         quality point — visually transparent for swing / pitch
         review at typical viewing distances. Multiply by total
         pixels-per-second (width × height × fps) to get the bitrate
         the encoder needs. Clamped between 3.5 Mbps (low-end webcams
         on 720p30) and 60 Mbps (4K @ 120 ceiling — beyond this the
         file size dwarfs the perceived gain on H.264 / VP9).

         Sample bitrates the formula lands on:
           720p  @ 30  →  ~3.5 Mbps (floored)
           1080p @ 30  →  ~6.2 Mbps
           1080p @ 60  →  ~12.4 Mbps
           1080p @ 120 →  ~24.9 Mbps
           1080p @ 240 →  ~49.8 Mbps
           4K    @ 30  →  ~24.9 Mbps
           4K    @ 60  →  ~49.8 Mbps
           4K    @ 120 →  60 Mbps (capped) */
      const videoTrack = stream.getVideoTracks()[0];
      const trackSettings = videoTrack?.getSettings();
      const negotiatedWidth  = trackSettings?.width      ?? 1920;
      const negotiatedHeight = trackSettings?.height     ?? 1080;
      const negotiatedFps    = trackSettings?.frameRate  ?? 30;
      const pixelsPerSecond = negotiatedWidth * negotiatedHeight * negotiatedFps;
      const videoBitsPerSecond = Math.max(
        3_500_000,
        Math.min(60_000_000, Math.round(pixelsPerSecond * 0.10)),
      );
      const recorderOpts: MediaRecorderOptions = {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond,
      };
      const recorder = new MediaRecorder(stream, recorderOpts);
      const chunks: Blob[] = [];
      chunksRef.current.set(deviceId, chunks);

      const cameraDevice = availableCameras.find((c) => c.deviceId === deviceId);
      const cameraLabelSnapshot = getCameraLabel(
        deviceId,
        cameraDevice?.label || 'Camera',
      );

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        chunksRef.current.delete(deviceId);
        const finalize = () => {
          pendingStops--;
          if (pendingStops === 0 && pendingSwitchRef.current) {
            const next = pendingSwitchRef.current;
            pendingSwitchRef.current = null;
            setActivePlayerId(next);
          }
        };
        if (!playerIdSnapshot || blob.size === 0) { finalize(); return; }
        // Component unmounted while the recorder was stopping (user
        // navigated away). Skip the setState to avoid a "set state
        // on unmounted component" warning and drop the orphan clip.
        if (!isMountedRef.current) { finalize(); return; }
        const duration = Math.round((Date.now() - startedAt) / 1000);
        const previewUrl = URL.createObjectURL(blob);
        setClips((prev) => [
          ...prev,
          {
            clientId: `${playerIdSnapshot}-${deviceId}-${Date.now()}`,
            playerId: playerIdSnapshot,
            blob,
            previewUrl,
            durationSec: duration,
            implement: implementSnapshot,
            cameraDeviceId: deviceId,
            cameraLabel: cameraLabelSnapshot,
            bundleId,
            decision: 'pending',
          },
        ]);
        finalize();
      };
      recorder.start();
      recordersRef.current.set(deviceId, recorder);
      /* Kick off the 4-second display delay for this camera. The
         capture loop reads frames from the same `<video>` element
         the MediaRecorder is sourcing from, so the recording is
         unaffected — only the on-screen preview lags. */
      startDelayLoop(deviceId);
    }

    setRecordStartedAt(Date.now());
    setRecording(true);
  };

  const stopRecorder = () => {
    /* Stop every active recorder. The per-recorder `onstop`
       callbacks above each append their own `LocalClip` row and
       decrement the shared `pendingStops` counter so a queued
       player-switch happens only after every angle has drained. */
    for (const [, rec] of recordersRef.current.entries()) {
      if (rec.state !== 'inactive') {
        try { rec.stop(); } catch { /* ignore */ }
      }
    }
    /* Tear down every delay loop — drops the ImageBitmap buffers
       and reveals the live <video> underneath each tile again. */
    for (const deviceId of Array.from(delayRafRef.current.keys())) {
      stopDelayLoop(deviceId);
    }
    /* Clear the recorders map so the next Start press creates a
       fresh set (the streams stay open for fast subsequent
       starts). */
    recordersRef.current.clear();
    setRecording(false);
    setRecordStartedAt(null);
  };

  const handleSelectPlayer = (playerId: string) => {
    if (playerId === activePlayerId) return;
    if (recording) {
      // Queue the switch — the recorder's onstop handler will
      // complete the player swap after the final blob is flushed.
      pendingSwitchRef.current = playerId;
      stopRecorder();
      return;
    }
    setActivePlayerId(playerId);
  };

  const handleEndSession = () => {
    if (recording) stopRecorder();
    // Skip the save screen if nothing was recorded — just close.
    if (clips.length === 0 && session) {
      api.endLiveSession(session.id).catch(() => { /* ignore */ });
      // /videos is the canonical landing now (the standalone /live
      // picker was retired from the sidebar).
      router.push('/videos');
      return;
    }
    setStep('save');
  };

  /* Lazy-load each clip's player's reports the first time the Save
     step opens. Dedupes by playerId so a clip list with multiple
     bundles for the same player only fetches once. Filtered server-
     side by `positionDef.videoCategory` so only matching-type reports
     appear in the per-bundle picker (Hitting clips → Hitting reports,
     Pitching clips → Pitching reports, etc.). Errors are swallowed —
     the picker falls back to the "No report" default + "+ Create new"
     row, which still work without an existing list. */
  useEffect(() => {
    if (step !== 'save' || !positionDef) return;
    const playerIds = Array.from(new Set(clips.map(c => c.playerId)));
    let cancelled = false;
    playerIds.forEach(async (id) => {
      if (reportsByPlayer[id]) return;
      try {
        const rows = await api.getPlayerReports(id, positionDef.videoCategory);
        if (cancelled) return;
        setReportsByPlayer(prev => ({
          ...prev,
          [id]: rows.map((r: any) => ({ id: r.id, title: r.title, createdAt: r.createdAt })),
        }));
      } catch { /* ignore — picker still works with No-report + Create-new */ }
    });
    return () => { cancelled = true; };
  }, [step, clips, reportsByPlayer, positionDef]);

  // ── Step 3: save clips ──
  const handleSaveClip = async (clientId: string) => {
    const clip = clips.find(c => c.clientId === clientId);
    if (!clip || !session || !positionDef) return;
    const player = selectedPlayers.find(p => p.id === clip.playerId);
    if (!player) return;

    setClips(prev => prev.map(c => c.clientId === clientId ? { ...c, uploading: true, uploadError: undefined } : c));
    try {
      // 1) Upload the recorded blob to /videos/upload as a File.
      //    MediaRecorder produces a Blob, so wrap it in a File for
      //    the multipart upload (videos.controller.ts requires a
      //    file with a name).
      const ext = clip.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File(
        [clip.blob],
        `live-${player.lastName}-${player.firstName}-${clip.clientId}.${ext}`,
        { type: clip.blob.type || 'video/webm' },
      );
      /* Title format: "Training - Hitting - Tee - Side Angle" —
         bookended by simple hyphens so the saved clip reads cleanly
         across the in-app video library, PDF filenames, and any
         future export. The implement tag is appended with a
         trailing " - <tag>" when present; the camera label is
         appended after the implement so the angle is the last
         tag the eye lands on (most relevant when scanning a
         multi-angle gallery row). */
      const implementSuffix = clip.implement ? ` - ${clip.implement}` : '';
      const cameraSuffix = clip.cameraLabel ? ` - ${clip.cameraLabel}` : '';
      const video = await api.uploadVideo(
        file,
        player.id,
        `Training - ${positionDef.label}${implementSuffix}${cameraSuffix}`,
        positionDef.videoCategory,
      );
      // 2) Create the TrainingClip row linking session ↔ player ↔ video.
      await api.createTrainingClip(session.id, {
        playerId: player.id,
        videoId: video.id,
      });

      /* 3) If the coach picked a report on this clip's bundle, attach
          the freshly-uploaded video to it. Bundle-level pick keyed by
          `bundleKey = clip.bundleId ?? clip.clientId` so every camera
          angle from a single Start Video press lands on the SAME
          report. When the pick is `REPORT_CREATE`, the FIRST clip in
          the bundle spins up a new empty Report and caches its id in
          `bundleCreatedReports`; subsequent clips in the same bundle
          read the cache and reuse that id instead of creating one
          report per camera angle.

          Attachment is implemented by appending the new videoId to
          the report's existing `videoIds` CSV string. The Save-all
          handler is serialized below (one `await` per clip), so
          there's no concurrent-write race within a bundle. */
      const bundleKey = clip.bundleId ?? clip.clientId;
      const sel = bundleReportSel[bundleKey] ?? REPORT_NONE;
      if (sel !== REPORT_NONE) {
        let reportIdToAttach: string | null = null;
        if (sel === REPORT_CREATE) {
          const cached = bundleCreatedReports[bundleKey];
          if (cached) {
            reportIdToAttach = cached;
          } else if (user) {
            const created = await api.createReport({
              playerId:    player.id,
              createdById: user.id,
              reportType:  positionDef.videoCategory,
              title:       `Training — ${positionDef.label} — ${new Date().toLocaleDateString()}`,
              content:     '{}',
            });
            reportIdToAttach = created.id;
            setBundleCreatedReports(prev => ({ ...prev, [bundleKey]: created.id }));
          }
        } else {
          reportIdToAttach = sel;
        }
        if (reportIdToAttach) {
          try {
            const existing = await api.getReport(reportIdToAttach);
            const currentIds = (existing.videoIds || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            if (!currentIds.includes(video.id)) {
              const nextIds = [...currentIds, video.id].join(',');
              await api.updateReport(reportIdToAttach, { videoIds: nextIds });
            }
          } catch { /* attach failure shouldn't fail the clip save — video is already on the profile */ }
        }
      }

      setClips(prev => prev.map(c => c.clientId === clientId ? { ...c, uploading: false, decision: 'saved', savedVideoId: video.id } : c));
    } catch (err: any) {
      setClips(prev => prev.map(c => c.clientId === clientId ? { ...c, uploading: false, uploadError: err?.message || 'Upload failed' } : c));
    }
  };

  const handleDiscardClip = (clientId: string) => {
    setClips(prev => prev.map(c => c.clientId === clientId ? { ...c, decision: 'discarded' } : c));
  };

  /* Finish-Session gate: a clip is "decided" ONLY when its decision
   *  is no longer pending AND it isn't mid-upload. The previous
   *  predicate `(decision !== 'pending' || c.uploading)` treated an
   *  in-flight upload as "decided", which let the Finish button
   *  enable while saves were still streaming bytes — clicking it
   *  would route away and abort the fetch. */
  const allDecisionsMade = clips.every(c => c.decision !== 'pending' && !c.uploading);
  const handleFinishSession = async () => {
    if (session) {
      try { await api.endLiveSession(session.id); } catch { /* ignore */ }
    }
    router.push('/videos');
  };

  // ── Render gates ──
  if (isLoading || !user || !isCoach) return null;

  return (
    <div className={pageStyles.page}>
      <PageHeader
        size="bar"
        title="Training"
        subtitle={
          step === 'setup' ? 'Pick a position and roster' :
          step === 'recording' ? `${positionDef?.label} session in progress` :
          'Save or discard recordings'
        }
      />

      {/* Step indicator — three dots with the current step accented. */}
      <div className={styles.stepperRow}>
        {(['setup', 'recording', 'save'] as Step[]).map((s, i) => (
          <div key={s} className={`${styles.stepDot} ${step === s ? styles.stepDotActive : ''}`}>
            <span>{i + 1}</span>
            <em>{s === 'setup' ? 'Setup' : s === 'recording' ? 'Record' : 'Save'}</em>
          </div>
        ))}
      </div>

      {/* ──────────── STEP 1 — SETUP ──────────── */}
      {step === 'setup' && (
        <>
          {/* `data-panel-kind` markers let the light-theme stylesheet
              tune EACH workflow panel independently — Position / Save
              wear the near-white "interior sub-bubble" fill
              (`--bubble-chrome-bg`), while the Athletes (player-select)
              panel wears the cool-slate "outer frame" fill
              (`--panel-bg-light`) so it visually pairs with the Player
              Name bubble on the athlete profile. Without the markers
              every `.panel` would render identical and the
              picker-vs-action hierarchy wouldn't read. */}
          <section className={styles.panel} data-panel-kind="position">
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Position</h2>
            </div>
            <div className={styles.positionGrid}>
              {POSITION_OPTIONS.map(opt => {
                const active = opt.key === position;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setPosition(opt.key); setSelectedIds(new Set()); }}
                    className={`${styles.positionPill} ${active ? styles.positionPillActive : ''}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {position && (
            <section className={styles.panel} data-panel-kind="players">
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Athletes</h2>
                <span className={styles.countChip}>{selectedIds.size} selected</span>
              </div>
              {loadingPlayers ? (
                <div className={styles.dim}>Loading roster…</div>
              ) : eligiblePlayers.length === 0 ? (
                <div className={styles.dim}>No athletes match this position. Add one in Athletes first.</div>
              ) : (
                <div className={styles.rosterGrid}>
                  {eligiblePlayers.map(p => {
                    const checked = selectedIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`${styles.rosterRow} ${checked ? styles.rosterRowActive : ''}`}
                        onClick={() => setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                          return next;
                        })}
                      >
                        <span className={styles.rosterCheck} aria-hidden="true">{checked ? '✓' : ''}</span>
                        <span className={styles.rosterName}>{p.firstName} {p.lastName}</span>
                        <span className={styles.rosterMeta}>{p.positions || '—'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <div className={styles.actionsRow}>
            <Link href="/videos" className={styles.secondaryBtn}>← Back</Link>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!positionDef || selectedIds.size === 0}
              onClick={handleStartSession}
            >
              Start Session
            </button>
          </div>
        </>
      )}

      {/* ──────────── STEP 2 — RECORDING ──────────── */}
      {step === 'recording' && (
        <div className={styles.recordLayout}>
          {/* Roster column */}
          <aside className={styles.rosterColumn}>
            <div className={styles.rosterColumnHead}>Roster</div>
            <div className={styles.rosterColumnList}>
              {selectedPlayers.map(p => {
                const isActive = p.id === activePlayerId;
                const playerClips = clips.filter(c => c.playerId === p.id).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.rosterColumnRow} ${isActive ? styles.rosterColumnRowActive : ''}`}
                    onClick={() => handleSelectPlayer(p.id)}
                  >
                    <span className={styles.rosterColumnName}>{p.firstName} {p.lastName}</span>
                    {playerClips > 0 && (
                      <span className={styles.rosterColumnCount}>{playerClips} clip{playerClips === 1 ? '' : 's'}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Camera + record column */}
          <section className={styles.cameraColumn}>
            {/* Implement / drill-type tag bar — sits above the camera
                frame so the coach can see and switch the current
                tag at a glance. Changing the tag mid-recording is
                allowed; the in-flight clip keeps its snapshotted
                value (see `implementSnapshot` in `startRecorder`),
                so the change applies to the NEXT clip. The bar is
                hidden when the position has no implements
                configured. */}
            {availableImplements.length > 0 && (
              <div className={styles.implementBar} role="radiogroup" aria-label="Implement">
                {availableImplements.map((imp) => {
                  const active = imp === implement;
                  return (
                    <button
                      key={imp}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setImplement(imp)}
                      className={`${styles.implementPill} ${active ? styles.implementPillActive : ''}`}
                    >
                      {imp}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Camera selector bar — pinned at the TOP of the
                video column. Coach picks which detected video
                inputs to record from. Names come from Settings →
                Cameras (OBS-style friendly labels) with the
                browser's reported `MediaDeviceInfo.label` as a
                fallback for un-named devices. Capped at
                `MAX_CAMERAS` (4): once 4 are checked, the
                un-checked pills go disabled until the coach
                un-checks one. The whole bar is disabled
                mid-recording so a press of Stop is required before
                reconfiguring the angle set (avoids the "I started
                a clip with 3 cams but only 2 saved" gotcha). */}
            {availableCameras.length > 0 && (
              <div className={styles.cameraSelectorBar}>
                <div className={styles.cameraSelectorHead}>
                  <span className={styles.cameraSelectorLabel}>Cameras</span>
                  <span className={styles.cameraSelectorCount}>
                    {selectedCameraIds.length} / {MAX_CAMERAS}
                  </span>
                </div>
                <div className={styles.implementBar} role="group" aria-label="Cameras">
                  {/* Hidden span reads `cameraLabelsVersion` so the
                      label values re-render when the coach edits a
                      camera name in Settings while the session is
                      open. */}
                  <span style={{ display: 'none' }}>{cameraLabelsVersion}</span>
                  {availableCameras.map((cam, i) => {
                    const active = selectedCameraIds.includes(cam.deviceId);
                    const atCap = !active && selectedCameraIds.length >= MAX_CAMERAS;
                    const label = getCameraLabel(
                      cam.deviceId,
                      cam.label || `Camera ${i + 1}`,
                    );
                    return (
                      <button
                        key={cam.deviceId}
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        disabled={recording || atCap}
                        onClick={() => setSelectedCameraIds((prev) => {
                          if (prev.includes(cam.deviceId)) {
                            return prev.filter((id) => id !== cam.deviceId);
                          }
                          if (prev.length >= MAX_CAMERAS) return prev;
                          return [...prev, cam.deviceId];
                        })}
                        className={`${styles.implementPill} ${active ? styles.implementPillActive : ''}`}
                        style={(recording || atCap)
                          ? { opacity: 0.55, cursor: 'not-allowed' }
                          : undefined}
                        title={
                          recording ? 'Stop recording to change camera selection'
                          : atCap   ? `Max ${MAX_CAMERAS} cameras at once — uncheck one first`
                          : label
                        }
                      >
                        {active ? '◉ ' : '○ '}{label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Multi-angle preview grid — one tile per selected
                camera. Tiles auto-fit so 1 cam fills the column,
                2 cams split 50/50, 3 wrap to two rows, etc. Each
                video element registers itself in `videoElsRef` via
                the ref callback below so the stream lifecycle
                effect can attach `srcObject` once the stream lands. */}
            {cameraError ? (
              <div className={styles.cameraError}>
                <strong>Camera blocked:</strong> {cameraError}
              </div>
            ) : selectedCameraIds.length === 0 ? (
              <div className={styles.cameraFrame}>
                <div className={styles.cameraError}>
                  Pick at least one camera from the bar above to start recording.
                </div>
              </div>
            ) : (
              <div
                className={styles.cameraGrid}
                /* `data-count` drives the per-count layout in CSS:
                     1 → one big tile (full width)
                     2 → two tiles side-by-side
                     3 → three tiles in a row
                     4 → 2 × 2 grid
                   Clamped to MAX_CAMERAS so the attribute never
                   exceeds the layouts the CSS knows how to draw. */
                data-count={Math.min(selectedCameraIds.length, MAX_CAMERAS)}
              >
                {selectedCameraIds.map((deviceId) => {
                  const cam = availableCameras.find((c) => c.deviceId === deviceId);
                  const label = getCameraLabel(
                    deviceId,
                    cam?.label || 'Camera',
                  );
                  /* Read the negotiated frame rate the camera
                     actually delivered — usually lower than the
                     120 fps we asked for. Surfaces on the tile so
                     coaches can confirm whether they're getting
                     slow-mo quality (≥100) or only standard
                     (≤60). Defaults to "—" when the track hasn't
                     reported settings yet. */
                  const stream = streamsRef.current.get(deviceId);
                  const negotiatedFps = stream?.getVideoTracks()[0]?.getSettings()?.frameRate;
                  const fpsLabel = negotiatedFps ? `${Math.round(negotiatedFps)} fps` : null;
                  return (
                    <div
                      key={deviceId}
                      className={styles.cameraFrame}
                      /* `data-recording` flips the CSS that hides
                         the live <video> behind the delayed canvas
                         while recording, so the coach watches the
                         4-second-old footage instead of the live
                         feed. The MediaRecorder still reads the
                         live <video> for the actual save. */
                      data-recording={recording ? '1' : undefined}
                    >
                      <video
                        ref={(el) => {
                          if (el) {
                            videoElsRef.current.set(deviceId, el);
                            /* Attach the existing stream (if any)
                               so freshly-mounted tiles pick up the
                               live preview without waiting for the
                               selectedCameraIds effect to re-fire. */
                            const stream = streamsRef.current.get(deviceId);
                            if (stream && el.srcObject !== stream) {
                              el.srcObject = stream;
                            }
                          } else {
                            videoElsRef.current.delete(deviceId);
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        className={styles.cameraVideo}
                      />
                      {/* Delayed-display canvas — sits on top of the
                          live <video> while recording. Painted by
                          `startDelayLoop` with frames from
                          `DELAY_MS` ago. Hidden when not
                          recording (CSS keyed off `data-recording`). */}
                      <canvas
                        ref={(el) => {
                          if (el) delayCanvasElsRef.current.set(deviceId, el);
                          else delayCanvasElsRef.current.delete(deviceId);
                        }}
                        className={styles.cameraDelayedCanvas}
                      />
                      {/* "Buffering 4s delay…" overlay — visible
                          during recording until the first delayed
                          frame lands on the canvas (signaled by
                          `data-warm="1"` on the canvas). A sibling
                          div, not a canvas pseudo-element, because
                          `::before` doesn't render on replaced
                          elements like <canvas>. */}
                      <div className={styles.cameraBufferingOverlay}>
                        Buffering 4s delay…
                      </div>
                      {/* Per-tile label so the coach knows which
                          angle each preview is. The negotiated
                          fps chip sits to its right so coaches
                          can spot at a glance whether they got
                          120 fps slow-mo or fell back to 60/30. */}
                      <span className={styles.cameraTileLabel}>
                        {label}
                        {fpsLabel && (
                          <span className={styles.cameraTileFps}>{fpsLabel}</span>
                        )}
                      </span>
                      {recording && (
                        <>
                          <span className={styles.recDot}>● REC</span>
                          {/* "DELAYED 4s" chip pinned next to REC so
                              the coach knows the preview is lagged
                              and the buffering window isn't a
                              latency bug. */}
                          <span className={styles.delayBadge}>DELAY 4s</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.cameraControls}>
              <div className={styles.cameraSubject}>
                {activePlayer
                  ? <>Recording: <strong>{activePlayer.firstName} {activePlayer.lastName}</strong></>
                  : <>Select a player on the left to start recording</>}
              </div>
              <div className={styles.cameraButtons}>
                {!recording ? (
                  <button
                    type="button"
                    /* Disable unless we have an active player AND at
                       least one camera stream open. Without an open
                       stream there's nothing to record; this keeps
                       the coach from pressing Start while permission
                       is still pending or the stream is dead. */
                    disabled={
                      !activePlayer
                      || !!cameraError
                      || selectedCameraIds.length === 0
                      || !selectedCameraIds.some((id) => streamsRef.current.has(id))
                    }
                    onClick={startRecorder}
                    className={styles.primaryBtn}
                  >
                    ● Start Video
                    {selectedCameraIds.length > 1 ? ` (${selectedCameraIds.length} cams)` : ''}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecorder}
                    className={styles.dangerBtn}
                  >
                    ■ Stop Video
                  </button>
                )}
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleEndSession}
                >
                  End Session
                </button>
              </div>
              <div className={styles.dim}>
                {clips.length} clip{clips.length === 1 ? '' : 's'} captured so far. Switching players mid-recording auto-saves the current clip.
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ──────────── STEP 3 — SAVE ──────────── */}
      {step === 'save' && (
        <section className={styles.panel} data-panel-kind="save">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Save Clips</h2>
            <span className={styles.countChip}>{clips.length} recording{clips.length === 1 ? '' : 's'}</span>
          </div>
          {clips.length === 0 ? (
            <div className={styles.dim}>No clips recorded.</div>
          ) : (
            <div className={styles.clipList}>
              {(() => {
                /* Group clips by bundle. A bundle = every clip recorded
                   in a single Start Video press (one per active
                   camera). Iteration is in insertion order, so the
                   resulting bundle list mirrors the order presses
                   happened. Each bundle renders as a card containing
                   one row per angle, plus a bundle header showing the
                   shared player + implement + timestamp + angle count
                   AND a "Save all / Discard all" pair so coaches can
                   make a single decision across every angle when they
                   want to. */
                const bundles = new Map<string, LocalClip[]>();
                for (const c of clips) {
                  /* Pre-bundle clips (saved before this feature
                     existed) have no `bundleId`; bucket each into its
                     own one-clip bundle keyed by `clientId` so they
                     still render properly. */
                  const key = c.bundleId || c.clientId;
                  const arr = bundles.get(key) ?? [];
                  arr.push(c);
                  bundles.set(key, arr);
                }
                return Array.from(bundles.entries()).map(([bundleKey, bundleClips]) => {
                  const first = bundleClips[0];
                  const player = selectedPlayers.find(p => p.id === first.playerId);
                  /* Bundle timestamp — pulled from the bundleId
                     (`${playerId}-${startedAt}`). Falls back to
                     "—" for legacy clips that don't carry a bundleId
                     pattern. */
                  const tsMatch = bundleKey.match(/-(\d{10,})$/);
                  const bundleTs = tsMatch
                    ? new Date(Number(tsMatch[1])).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                    : null;
                  /* Per-bundle action helpers — fire the single-clip
                     handler for every pending clip in this bundle.
                     `handleSaveAll` is awaited per clip so the report-
                     attach flow doesn't race on `Report.videoIds`:
                     the first clip creates the report (when "+ Create
                     new" is picked) and writes its id into
                     `bundleCreatedReports`; subsequent clips read the
                     cached id and append their videoId to the same
                     report's CSV. Without the await, the second clip
                     would fire before the first finished caching the
                     created reportId. */
                  const pendingInBundle = bundleClips.filter(c => c.decision === 'pending' && !c.uploading);
                  const handleSaveAll = async () => {
                    for (const c of pendingInBundle) {
                      await handleSaveClip(c.clientId);
                    }
                  };
                  const handleDiscardAll = () => {
                    for (const c of pendingInBundle) handleDiscardClip(c.clientId);
                  };
                  return (
                    <div key={bundleKey} className={styles.bundleCard}>
                      {/* Bundle header — player + implement + time +
                          angle count + bulk-action buttons. Hidden
                          for single-clip bundles (legacy / one-camera
                          sessions) since the per-clip controls below
                          carry the same information. */}
                      <div className={styles.bundleHeader}>
                        <div className={styles.bundleHeaderInfo}>
                          <span className={styles.bundleHeaderPlayer}>
                            {player ? `${player.firstName} ${player.lastName}` : 'Unknown player'}
                          </span>
                          <span className={styles.bundleHeaderMeta}>
                            {first.implement && <>{first.implement} · </>}
                            {bundleClips.length} angle{bundleClips.length === 1 ? '' : 's'}
                            {bundleTs && <> · {bundleTs}</>}
                          </span>
                        </div>
                        {pendingInBundle.length > 0 && bundleClips.length > 1 && (
                          <div className={styles.bundleHeaderActions}>
                            <button
                              type="button"
                              className={styles.primaryBtn}
                              onClick={handleSaveAll}
                            >
                              Save all
                            </button>
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={handleDiscardAll}
                            >
                              Discard all
                            </button>
                          </div>
                        )}
                      </div>
                      <div className={styles.bundleClips}>
                        {bundleClips.map(clip => (
                          <div key={clip.clientId} className={styles.clipRow}>
                            <video
                              src={clip.previewUrl}
                              controls
                              className={styles.clipPreview}
                            />
                            <div className={styles.clipMeta}>
                              {/* Per-angle title — camera label
                                  leads since the player + implement
                                  already show in the bundle header
                                  above. */}
                              <div className={styles.clipPlayer}>
                                {clip.cameraLabel || 'Camera'}
                              </div>
                              <div className={styles.dim}>
                                {clip.durationSec}s · {Math.round(clip.blob.size / 1024)} KB
                              </div>
                              {clip.uploadError && <div className={styles.clipError}>Upload failed: {clip.uploadError}</div>}
                            </div>
                            <div className={styles.clipActions}>
                              {clip.decision === 'pending' && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.primaryBtn}
                                    disabled={!!clip.uploading}
                                    onClick={() => handleSaveClip(clip.clientId)}
                                  >
                                    {clip.uploading ? 'Saving…' : 'Save to profile'}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.secondaryBtn}
                                    disabled={!!clip.uploading}
                                    onClick={() => handleDiscardClip(clip.clientId)}
                                  >
                                    Discard
                                  </button>
                                </>
                              )}
                              {clip.decision === 'saved' && <div className={styles.clipSaved}>✓ Saved</div>}
                              {clip.decision === 'discarded' && <div className={styles.clipDiscarded}>Discarded</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Attach-to-report picker — bundle-level, anchored
                          BELOW the camera-angle list so the workflow
                          reads top-down: review the recorded angles,
                          THEN pick a target report, THEN tap Save. One
                          picker per bundle since every clip in a
                          bundle shares the same player + moment. Only
                          shown when there's at least one pending clip
                          left (no point picking a target after all
                          clips are saved/discarded). The matching-type
                          report list comes from
                          `reportsByPlayer[first.playerId]`; the
                          "+ Create new" row spins up a fresh report
                          for this position's type. */}
                      {pendingInBundle.length > 0 && positionDef && (() => {
                        const playerReports = reportsByPlayer[first.playerId] ?? [];
                        const sel = bundleReportSel[bundleKey] ?? REPORT_NONE;
                        return (
                          <label className={styles.bundleAttachRow}>
                            <span className={styles.bundleAttachLabel}>Attach to:</span>
                            <select
                              className={styles.bundleAttachSelect}
                              value={sel}
                              onChange={(e) => setBundleReportSel(prev => ({ ...prev, [bundleKey]: e.target.value }))}
                            >
                              <option value={REPORT_NONE}>No report (save to profile only)</option>
                              {playerReports.map(r => (
                                <option key={r.id} value={r.id}>
                                  {r.title || `${positionDef.label} Report — ${new Date(r.createdAt).toLocaleDateString()}`}
                                </option>
                              ))}
                              <option value={REPORT_CREATE}>+ Create new {positionDef.label} Report</option>
                            </select>
                          </label>
                        );
                      })()}
                    </div>
                  );
                });
              })()}
            </div>
          )}
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setStep('recording')}
            >
              ← Back to recording
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!allDecisionsMade && clips.length > 0}
              onClick={handleFinishSession}
            >
              Finish Session
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
