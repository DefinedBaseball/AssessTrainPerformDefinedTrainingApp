'use client';

/* ─────────────────────────────────────────────────────────────────────
   /live/at-bat — Phase 3 implementation. Two-step flow:

     STEP 1 — SETUP
       Two side-by-side roster columns: pick Pitchers (left) and
       Hitters (right) for this Live session. "Start Session" hits
       POST /live-sessions { mode: "LIVE" } and transitions to STEP 2.

     STEP 2 — TRACKER
       Three columns: Pitchers list (far left) | Hitters list (next) |
       At-Bat tracker (right, fills remaining width).

       The tracker is gated by both a selected pitcher AND a selected
       hitter — until both are picked, it shows a "pick a pitcher and
       hitter" hint. Once both are set, picking the second one auto-
       creates an AtBat row via POST /live-sessions/:id/at-bats and
       arms the pitch-input panel.

       Each pitch row inside the tracker:
         • Pitch-type picker (9 buttons: FASTBALL / SINKER / CUTTER /
           SLIDER / CURVEBALL / SWEEPER / CHANGEUP / SPLITTER /
           KNUCKLEBALL).
         • Ball/Strike toggle (umpire's call, optional).
         • Result picker (11 buttons: 4 strike/strikeout variants +
           FOUL / BALL / FLY_BALL / GROUND_BALL / LINE_DRIVE / BARREL /
           WALK).
       Picking BOTH a pitchType AND a result POSTs the pitch immediately
       (pitchNumber is auto-incremented server-side). If the result is
       terminal (strike-out, walk, ball-in-play, line drive, barrel),
       the AB closes automatically via POST .../close. Otherwise a
       fresh pitch row appears for the next delivery.

       "Next At-Bat" — closes any in-progress AB without an outcome
       (recorded as a manual close) and resets the input panel so the
       coach can pick the next hitter or stay on the same hitter for a
       new AB. Pitchers stay selected across at-bats; switching pitcher
       or hitter mid-AB closes the current AB first.

   Phase 4 will add a camera bubble (Start Video / preview / record on
   AB start / auto-stop on AB close) under the result panel. Phase 5
   adds the session-end save dialog that attaches AB videos to a new or
   existing Report. Phase 6 wires the saved data into the Hitting tab's
   Swing-Decision spray chart + the Pitching tab's Live Results bubble.
   ───────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type {
  Player, LiveSession, AtBat, Pitch, PitchType, PitchResult,
} from '@/lib/api';
import { TERMINAL_PITCH_RESULTS } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import pageStyles from '../page.module.css';
import trainingStyles from '../training/page.module.css';
import styles from './page.module.css';

/* ── Position split for the roster ──
   Pitchers list = players whose `positions` includes 'P'.
   Hitters list  = all non-pitcher-only players (any field position).
   A two-way player (P + IF, P + OF, etc.) appears in BOTH columns —
   common in HS / college rosters and the user expects that. */

function parsePositions(p: Player | null | undefined): string[] {
  if (!p?.positions) return [];
  return p.positions.split(',').map(s => s.trim()).filter(Boolean);
}

const HITTER_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'INF', 'UTIL'];

function isPitcher(p: Player) { return parsePositions(p).includes('P'); }
function isHitter(p: Player)  { return parsePositions(p).some(pos => HITTER_POSITIONS.includes(pos)); }

/* ── Display helpers ── */

function fmtPitchType(t: PitchType | string): string {
  const map: Record<string, string> = {
    FASTBALL: 'Fastball',  SINKER: 'Sinker',    CUTTER: 'Cutter',
    SLIDER:   'Slider',    CURVEBALL: 'Curveball', SWEEPER: 'Sweeper',
    CHANGEUP: 'Changeup',  SPLITTER: 'Splitter',  KNUCKLEBALL: 'Knuckleball',
  };
  return map[t] ?? t;
}

/* Scorekeeping-style result labels.
 * - STRIKE_LOOKING  → backward "K" (mirror-flipped via CSS transform)
 * - STRIKE_SWINGING → forward "K"
 * - GROUND_BALL / FLY_BALL / LINE_DRIVE → short codes "GB" / "FB" / "LD"
 * Everything else reads in full. Returns `ReactNode` so the
 * backward K can render as a span with `transform: scaleX(-1)`. */
function fmtResult(r: PitchResult | string): ReactNode {
  if (r === 'STRIKE_LOOKING') {
    return (
      <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>K</span>
    );
  }
  if (r === 'STRIKE_SWINGING') return 'K';
  const map: Record<string, string> = {
    STRIKE_OUT_LOOKING:  'Strikeout — Looking',
    STRIKE_OUT_SWINGING: 'Strikeout — Swinging',
    FOUL:        'Foul',
    BALL:        'Ball',
    FLY_BALL:    'FB',
    GROUND_BALL: 'GB',
    LINE_DRIVE:  'LD',
    BARREL:      'Barrel',
    WALK:        'Walk',
  };
  return map[r] ?? r;
}

/* ── Pitch-input result set, grouped into rows ──
   The result picker surfaces only the per-pitch outcomes the coach
   actually taps in real time. Strikeouts (looking/swinging) and walks
   are NEVER picked directly — they are inferred from the count: a
   third STRIKE_LOOKING becomes STRIKE_OUT_LOOKING, a third
   STRIKE_SWINGING becomes STRIKE_OUT_SWINGING, and a fourth BALL
   becomes WALK.
   The rows are intentional UX groupings:
     Row 1 — strike-level outcomes the coach taps repeatedly mid-AB
     Row 2 — Ball, isolated so it's visually distinct
     Row 3 — in-play outcomes that always end the AB */
const PITCH_RESULT_ROWS: PitchResult[][] = [
  ['STRIKE_LOOKING', 'STRIKE_SWINGING', 'FOUL'],
  ['BALL'],
  ['GROUND_BALL', 'FLY_BALL', 'LINE_DRIVE', 'BARREL'],
];

/* Pitch-type rows mirror the way coaches read a pitch chart:
   Row 1 — fastballs (4-seam / 2-seam family)
   Row 2 — breaking balls
   Row 3 — offspeed */
const PITCH_TYPE_ROWS: PitchType[][] = [
  ['FASTBALL', 'SINKER', 'CUTTER'],
  ['SLIDER', 'CURVEBALL', 'SWEEPER'],
  ['CHANGEUP', 'SPLITTER', 'KNUCKLEBALL'],
];

/** Walk a pitch list and compute the running count. Mirrors MLB
 *  rules: BALL increments balls, STRIKE_LOOKING / STRIKE_SWINGING
 *  increment strikes, FOUL increments strikes only while strikes < 2
 *  (a two-strike foul keeps the count at 0-2). Other results
 *  (in-play / outcomes) are ignored — they end the AB and aren't
 *  counted against the strike total. */
function computeCount(pitches: Pitch[]): { balls: number; strikes: number } {
  let balls = 0;
  let strikes = 0;
  for (const p of pitches) {
    if (p.result === 'BALL') balls++;
    else if (p.result === 'STRIKE_LOOKING' || p.result === 'STRIKE_SWINGING') strikes++;
    else if (p.result === 'FOUL' && strikes < 2) strikes++;
  }
  return { balls, strikes };
}

type Step = 'setup' | 'tracker' | 'save';

/** Sentinel values for the per-clip "attach to report" picker. */
const REPORT_NONE   = '__none__';
const REPORT_CREATE = '__create__';

/* ── Per-AB recorded clip ──
   Phase 4 in-memory store. One entry per finished recording. The
   Phase 5 session-end save dialog will let the coach upload each
   clip to the corresponding AtBat row (and optionally a Report). */
interface AtBatClip {
  clientId: string;
  atBatId: string;
  hitterId: string;
  pitcherId: string | null;
  hitterName: string;
  pitcherName: string;
  blob: Blob;
  previewUrl: string;
  durationSec: number;
  decision: 'pending' | 'saved' | 'discarded';
  savedVideoId?: string;
  uploading?: boolean;
  uploadError?: string;
}

export default function LiveAtBatPage() {
  const { user, isCoach } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user === undefined) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [user, isCoach, router]);

  // ── Setup state ──
  const [step, setStep] = useState<Step>('setup');
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [pitcherIds, setPitcherIds] = useState<Set<string>>(new Set());
  const [hitterIds,  setHitterIds]  = useState<Set<string>>(new Set());
  const [session, setSession] = useState<LiveSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Tracker state ──
  const [activePitcherId, setActivePitcherId] = useState<string | null>(null);
  const [activeHitterId,  setActiveHitterId]  = useState<string | null>(null);
  const [currentAB, setCurrentAB] = useState<AtBat | null>(null);
  // Pitches recorded for the current AB (in display order).
  const [currentPitches, setCurrentPitches] = useState<Pitch[]>([]);
  // Draft pitch — the picker buttons populate this. When BOTH
  // pitchType and result are set, the draft is POSTed and cleared.
  const [draftType, setDraftType] = useState<PitchType | null>(null);
  const [draftCall, setDraftCall] = useState<'BALL' | 'STRIKE' | null>(null);
  const [submittingPitch, setSubmittingPitch] = useState(false);
  /* Per-pitcher session pitch count — `{ [pitcherId]: pitchesThrown }`.
     Increments on every successful `submitPitch`; survives across
     at-bats so a pitcher's total reflects their whole outing.
     Reset only when the coach taps End Session. Surfaces in the
     matchup row as "P: N" under the pitcher's name. */
  const [pitchCountByPitcher, setPitchCountByPitcher] = useState<Record<string, number>>({});
  /* Per-hitter outcome tally — `{ [hitterId]: { good, total } }`.
     `good` = barrels + line drives (the productive batted-ball
     outcomes the coach wants to highlight). `total` = every closed
     AB with a terminal outcome (BARREL + LINE_DRIVE + FLY_BALL +
     GROUND_BALL + STRIKE_OUT_* + WALK). Surfaces under each
     hitter's row in the Hitters column as "good-total" (e.g. "2-4"
     = 2 productive outcomes in 4 completed ABs). Reset only on
     End Session, same as the per-pitcher pitch counter. */
  const [hitterOutcomes, setHitterOutcomes] = useState<Record<string, { good: number; total: number }>>({});
  /* Pending spray-chart click — when the result picker fires an
     in-play outcome (BARREL / FLY_BALL / GROUND_BALL / LINE_DRIVE),
     we DON'T close the AB immediately. Instead we set this state
     to the outcome value and render the mini field below the
     Result picker. The next click on that field captures the
     normalized (x,y) coords and finalizes the close call. Cleared
     after close, or on AB switch / Next AB. */
  const [pendingInPlayOutcome, setPendingInPlayOutcome] = useState<PitchResult | null>(null);
  // Recent at-bats list — surfaces under the tracker for context.
  // Re-fetched whenever the active hitter changes or an AB closes.
  const [recentAtBats, setRecentAtBats] = useState<api.AtBatDetail[]>([]);
  const [recentFilterLimit, setRecentFilterLimit] = useState<number>(25);

  // ── Phase 5 — Save step: per-clip report-attach selection ──
  // Map clip.clientId → selected report id (or the sentinel
  // REPORT_NONE / REPORT_CREATE). Loaded fresh whenever the save
  // step opens so the hitter's existing reports are visible in the
  // picker.
  const [clipReportSel, setClipReportSel] = useState<Record<string, string>>({});
  // hitterId → list of their HITTING reports (loaded lazily on entry
  // to the save step). Keeps the picker dropdown options scoped to
  // the actual hitter for each clip.
  const [reportsByHitter, setReportsByHitter] = useState<Record<string, Array<{ id: string; title: string | null; createdAt: string }>>>({});

  // ── Video state (Phase 4) ──
  // Camera lifecycle is INDEPENDENT of recording: once the coach
  // enables the camera, the stream stays alive across at-bats until
  // they explicitly turn it off. Recording is per-AB and auto-stops
  // when the AB closes (via terminal pitch result OR "Next At-Bat").
  const [cameraOn, setCameraOn]       = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording]     = useState(false);
  const [clips, setClips]             = useState<AtBatClip[]>([]);
  const videoElRef  = useRef<HTMLVideoElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  // Metadata snapshot for the currently-recording AB — captured at
  // recording-start so we can stamp the clip even if `currentAB`
  // is cleared by the parent flow before `onstop` fires.
  const recMetaRef  = useRef<{
    atBatId: string;
    hitterId: string;
    pitcherId: string | null;
    hitterName: string;
    pitcherName: string;
    startedAt: number;
  } | null>(null);
  // Tracks whether this component is still mounted so async
  // recorder callbacks (onstop) can bail out of setState if the
  // user navigated away mid-recording.
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  // ── Load roster once ──
  useEffect(() => {
    if (!isCoach) return;
    let cancelled = false;
    setLoadingPlayers(true);
    api.getPlayers().then(p => {
      if (cancelled) return;
      setAllPlayers(p);
      setLoadingPlayers(false);
    }).catch(() => { if (!cancelled) setLoadingPlayers(false); });
    return () => { cancelled = true; };
  }, [isCoach]);

  const pitchersAll = useMemo(
    () => allPlayers.filter(isPitcher).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)),
    [allPlayers],
  );
  const hittersAll = useMemo(
    () => allPlayers.filter(isHitter).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)),
    [allPlayers],
  );

  const sessionPitchers = useMemo(() => pitchersAll.filter(p => pitcherIds.has(p.id)), [pitchersAll, pitcherIds]);
  const sessionHitters  = useMemo(() => hittersAll.filter(p => hitterIds.has(p.id)),    [hittersAll,  hitterIds]);
  const activePitcher   = useMemo(() => sessionPitchers.find(p => p.id === activePitcherId) ?? null, [sessionPitchers, activePitcherId]);
  const activeHitter    = useMemo(() => sessionHitters.find(p  => p.id === activeHitterId)  ?? null, [sessionHitters,  activeHitterId]);
  // Live balls/strikes count for the in-progress AB. Drives both the
  // count display in the matchup banner and the dynamic "would this
  // end the AB?" highlighting on the result picker buttons.
  const liveCount       = useMemo(() => computeCount(currentPitches), [currentPitches]);

  // ── Reload "Recent At-Bats" when the active hitter changes or an AB closes ──
  useEffect(() => {
    if (!activeHitterId) { setRecentAtBats([]); return; }
    let cancelled = false;
    api.listAtBats({ hitterId: activeHitterId, limit: recentFilterLimit })
      .then(list => { if (!cancelled) setRecentAtBats(list); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [activeHitterId, recentFilterLimit, currentAB?.id]);

  // ── Step 1 → Step 2: start the session ──
  const handleStartSession = async () => {
    if (pitcherIds.size === 0 || hitterIds.size === 0) return;
    setError(null);
    try {
      const created = await api.createLiveSession({ mode: 'LIVE' });
      setSession(created);
      // Auto-pick the first pitcher + first hitter so the tracker
      // is immediately usable on entry.
      const firstPitcher = pitchersAll.find(p => pitcherIds.has(p.id));
      const firstHitter  = hittersAll.find(p => hitterIds.has(p.id));
      setActivePitcherId(firstPitcher?.id ?? null);
      setActiveHitterId(firstHitter?.id ?? null);
      setStep('tracker');
    } catch (err: any) {
      setError(`Failed to start session: ${err?.message || err}`);
    }
  };

  // ── Start a new AB when both a pitcher + hitter are armed ──
  // Tracks the in-flight AB-create across rapid pitcher/hitter
  // switches: if the coach picks a new pair before the previous
  // POST resolves, `cancelled` blocks the stale `setCurrentAB`
  // BUT also fires a fire-and-forget end-stamp on the orphan AB
  // the server just created, so we don't accumulate "open" AB
  // rows that nothing in the UI ever closes.
  useEffect(() => {
    if (step !== 'tracker') return;
    if (!session) return;
    if (!activePitcherId || !activeHitterId) return;
    if (currentAB) return;
    const pitcher = sessionPitchers.find(p => p.id === activePitcherId);
    const handedness = pitcher?.throws === 'L' ? 'L' : pitcher?.throws === 'R' ? 'R' : null;
    let cancelled = false;
    api.createAtBat(session.id, {
      hitterId: activeHitterId,
      pitcherId: activePitcherId,
      pitcherHandedness: handedness,
    }).then(ab => {
      if (cancelled) {
        // The coach switched pitcher/hitter while this create was
        // in flight. The AB row exists on the server but the UI
        // already moved past it — stamp it ended so it doesn't
        // linger as a perpetually-open at-bat.
        api.updateAtBat(ab.id, { endedAt: new Date().toISOString() }).catch(() => { /* ignore */ });
        return;
      }
      setCurrentAB(ab);
      setCurrentPitches([]);
      setDraftType(null);
      setDraftCall(null);
    }).catch(err => {
      if (!cancelled) setError(`Failed to start at-bat: ${err?.message || err}`);
    });
    return () => { cancelled = true; };
  }, [step, session, activePitcherId, activeHitterId, currentAB, sessionPitchers]);

  // ── Camera lifecycle (Phase 4) ──
  // Open the stream when `cameraOn` flips true; tear it down when
  // it flips false OR the page unmounts. Critically, the stream
  // teardown lives in the RETURNED cleanup function — not the
  // `if (!cameraOn) {…}` early-return branch — so navigating away
  // while the camera is still on (End Session, sidebar click,
  // browser back button) actually releases the device. Previously
  // the unmount path only set `cancelled = true` and the stream
  // tracks stayed alive, leaving the OS camera light on.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    setCameraError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'environment',
          /* Request the camera's native SOURCE up to 4K @ 240 fps so
             pitch-by-pitch review captures at the device's full
             slow-motion / high-resolution capability. Every constraint
             uses ONLY `ideal` (no `min`) so the camera negotiates its
             highest supported rung under the cap and falls back
             gracefully on lower-tier devices instead of throwing
             OverconstrainedError. The MediaRecorder bitrate inside
             `startRecording` below reads the actually-negotiated
             width × height × fps off the track settings and scales
             the encoded bitrate accordingly so the saved clip
             preserves the source per-frame quality. */
          width:     { ideal: 3840 },
          height:    { ideal: 2160 },
          frameRate: { ideal: 240 },
        },
        audio: true,
      })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoElRef.current) videoElRef.current.srcObject = stream;
      })
      .catch(err => {
        if (cancelled) return;
        setCameraError(err?.message || 'Camera access denied');
        setCameraOn(false);
      });
    return () => {
      cancelled = true;
      // Stop any active recording before killing the stream so the
      // final blob still flushes through onstop.
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        streamRef.current = null;
      }
      if (videoElRef.current) videoElRef.current.srcObject = null;
      setRecording(false);
    };
  }, [cameraOn]);

  // Revoke object URLs ONCE on unmount, reading the latest clips
  // through a ref. The previous version had `[clips]` deps which
  // caused the cleanup of the PREVIOUS effect (capturing the old
  // clips list) to run every time a new clip was appended — that
  // revoked URLs that were still rendered inside the save-step
  // `<video src={clip.previewUrl}>` elements, breaking inline
  // previews mid-session.
  const clipsRef = useRef<AtBatClip[]>([]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => {
    return () => {
      for (const c of clipsRef.current) {
        try { URL.revokeObjectURL(c.previewUrl); } catch { /* ignore */ }
      }
    };
  }, []);

  /** Begin recording for the CURRENT at-bat. Captures a metadata
   *  snapshot in `recMetaRef` so the resulting clip can be stamped
   *  with hitter / pitcher names even after `currentAB` is cleared
   *  by the AB-close flow. */
  const startRecording = () => {
    if (!streamRef.current || !currentAB || !activeHitter) return;
    chunksRef.current = [];
    const mimeCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mime = mimeCandidates.find((m: string) => MediaRecorder.isTypeSupported(m)) ?? '';
    /* Adaptive bitrate — matches the /live/training page recipe.
       Reads back the camera's actually-negotiated width × height ×
       fps and scales the MediaRecorder bitrate against 0.10 bits per
       pixel so the encoded clip preserves source quality (~3.5 Mbps
       on 720p30, ~12 Mbps on 1080p60, ~25 Mbps on 1080p120, ~50 Mbps
       on 1080p240 / 4K60, capped at 60 Mbps on 4K120). Default
       browser bitrate is ~2.5 Mbps which falls apart at high fps /
       resolution; this keeps the saved at-bat clips watchable for
       slow-motion review. */
    const videoTrack = streamRef.current.getVideoTracks()[0];
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
    const recorder = new MediaRecorder(streamRef.current, recorderOpts);
    recMetaRef.current = {
      atBatId:     currentAB.id,
      hitterId:    activeHitter.id,
      pitcherId:   activePitcher?.id ?? null,
      hitterName:  `${activeHitter.firstName} ${activeHitter.lastName}`,
      pitcherName: activePitcher ? `${activePitcher.firstName} ${activePitcher.lastName}` : 'Unknown',
      startedAt:   Date.now(),
    };
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const meta = recMetaRef.current;
      recMetaRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mime || 'video/webm' });
      chunksRef.current = [];
      if (!meta || blob.size === 0) return;
      // Component unmounted while the recorder was stopping. Skip
      // the setState to avoid a "set state on unmounted component"
      // warning and drop the orphan clip.
      if (!isMountedRef.current) return;
      const duration = Math.round((Date.now() - meta.startedAt) / 1000);
      const previewUrl = URL.createObjectURL(blob);
      setClips(prev => [
        ...prev,
        {
          clientId: `${meta.atBatId}-${Date.now()}`,
          atBatId: meta.atBatId,
          hitterId: meta.hitterId,
          pitcherId: meta.pitcherId,
          hitterName: meta.hitterName,
          pitcherName: meta.pitcherName,
          blob,
          previewUrl,
          durationSec: duration,
          decision: 'pending',
        },
      ]);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  /** Stop the current recording. The recorder's `onstop` handler
   *  fires async and persists the clip into `clips`. Returns a
   *  promise that resolves when onstop has fired — callers (AB
   *  close, Next-At-Bat, session-end) can await this so the clip
   *  is in `clips` before they navigate away. */
  const stopRecording = (): Promise<void> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') { setRecording(false); resolve(); return; }
      const prevOnStop = rec.onstop;
      rec.onstop = (ev: Event) => {
        // Wrap prevOnStop in try/catch so callers awaiting this
        // promise always settle. Without this, an exception inside
        // the original onstop (e.g. an unmount-time setState that
        // throws) would let the promise hang forever and freeze
        // `submitPitch` / `handleNextAtBat` / `handleEndSession`.
        try { if (prevOnStop) (prevOnStop as any).call(rec, ev); } catch { /* swallow */ }
        setRecording(false);
        resolve();
      };
      try { rec.stop(); } catch { setRecording(false); resolve(); }
    });
  };

  // ── Close + start fresh AB helpers ──

  /** Persist (and close, if terminal) a pitch. Called when the
   *  coach taps a result button after picking a pitch type.
   *
   *  Count-aware terminal logic: the coach never picks STRIKE_OUT_*
   *  or WALK directly. Instead, we compute the running count after
   *  appending this pitch and infer the terminal outcome:
   *    • 3rd STRIKE_LOOKING   → close as STRIKE_OUT_LOOKING
   *    • 3rd STRIKE_SWINGING  → close as STRIKE_OUT_SWINGING
   *    • 4th BALL             → close as WALK
   *  Direct in-play terminals (FLY_BALL / GROUND_BALL / LINE_DRIVE /
   *  BARREL) still close on first tap. FOUL never closes — its count
   *  contribution is capped at 2 strikes in `computeCount`. */
  const submitPitch = async (result: PitchResult) => {
    /* `draftCall` is now required (was optional). Without an
       umpire call we can't compute in-zone swing percentages
       downstream — the result picker buttons are also disabled
       below until both `draftType` and `draftCall` are set. */
    if (!currentAB || !draftType || !draftCall || submittingPitch) return;
    setSubmittingPitch(true);
    try {
      const pitch = await api.createPitch(currentAB.id, {
        pitchType: draftType,
        callBallStrike: draftCall,
        result,
      });
      const nextPitches = [...currentPitches, pitch];
      setCurrentPitches(nextPitches);
      setDraftType(null);
      setDraftCall(null);

      /* Bump this pitcher's session pitch count. Survives across
         at-bats — only reset by the End Session handler. The
         increment is scoped to the pitcher that's currently active
         when the pitch is recorded, so switching pitchers mid-
         session carries each one's running count independently. */
      if (currentAB.pitcherId) {
        const pid = currentAB.pitcherId;
        setPitchCountByPitcher(prev => ({
          ...prev,
          [pid]: (prev[pid] || 0) + 1,
        }));
      }

      // Resolve any terminal outcome from THIS pitch.
      const { balls, strikes } = computeCount(nextPitches);
      let terminalOutcome: PitchResult | null = null;
      if (result === 'STRIKE_LOOKING' && strikes >= 3) {
        terminalOutcome = 'STRIKE_OUT_LOOKING';
      } else if (result === 'STRIKE_SWINGING' && strikes >= 3) {
        terminalOutcome = 'STRIKE_OUT_SWINGING';
      } else if (result === 'BALL' && balls >= 4) {
        terminalOutcome = 'WALK';
      } else if (TERMINAL_PITCH_RESULTS.has(result)) {
        // In-play terminals (FLY_BALL / GROUND_BALL / LINE_DRIVE /
        // BARREL). FOUL is intentionally excluded — it can never
        // terminate an AB.
        terminalOutcome = result;
      }

      if (terminalOutcome) {
        /* `TERMINAL_PITCH_RESULTS` is a superset — it includes
           STRIKE_OUT_LOOKING / STRIKE_OUT_SWINGING / WALK, which
           are NOT in-play and should auto-close. The spray-chart
           flow only applies to true batted-ball outcomes (GB / FB /
           LD / BARREL); everything else closes immediately. */
        const isInPlay =
          terminalOutcome === 'GROUND_BALL'
          || terminalOutcome === 'FLY_BALL'
          || terminalOutcome === 'LINE_DRIVE'
          || terminalOutcome === 'BARREL';
        if (isInPlay) {
          /* In-play outcomes (BARREL / FLY_BALL / GROUND_BALL /
             LINE_DRIVE) defer the AB close until the coach taps a
             spot on the mini spray field below the Result picker.
             We park the outcome here and let `finalizeInPlayAtBat`
             (wired to the spray-chart click handler) close the AB
             with the captured coordinates. The pitch row IS already
             persisted by `createPitch` above, so a refresh mid-
             selection just leaves the AB open with the last pitch
             recorded — coaches can retry the spray click. */
          setPendingInPlayOutcome(terminalOutcome);
        } else {
          /* Strikeouts and walks close immediately — no spray
             location applies. */
          if (recording) await stopRecording();
          await api.closeAtBat(currentAB.id, terminalOutcome);
          /* Tally the hitter outcome — `good` counts barrels + line
             drives (productive batted-ball outcomes); `total` counts
             every closed AB. The "good-total" pair drives the per-
             hitter ratio in the Hitters list. K's / BB's bump `total`
             only. */
          if (currentAB.hitterId) {
            const hid = currentAB.hitterId;
            setHitterOutcomes(prev => {
              const prior = prev[hid] || { good: 0, total: 0 };
              return {
                ...prev,
                [hid]: { good: prior.good, total: prior.total + 1 },
              };
            });
          }
          setCurrentAB(null);
        }
      }
    } catch (err: any) {
      /* `currentPitches` is intentionally NOT updated until the
         `createPitch` promise resolves — the state mutation lives
         AFTER the `await`, so a server failure leaves the local
         pitch log untouched (no optimistic insert to roll back).
         `draftType` / `draftCall` are also preserved so the coach
         can retry their last selection with one tap. */
      setError(`Failed to record pitch: ${err?.message || err}`);
      // Auto-dismiss the banner after 5s so a stale "Failed…" line
      // from a transient network blip doesn't linger above a
      // subsequent successful pitch entry.
      setTimeout(() => setError(prev => (
        prev?.startsWith('Failed to record pitch:') ? null : prev
      )), 5000);
    } finally {
      setSubmittingPitch(false);
    }
  };

  /** Finalize an in-play AB after the coach clicks the mini spray
   *  field. Receives normalized coordinates in [0,1] and closes
   *  the AB with both the outcome (carried in
   *  `pendingInPlayOutcome`) AND the spray location. The saved
   *  coords flow into `AtBat.sprayX`/`sprayY` so the Hitting tab's
   *  Spray Chart can render the point — and clicking that point
   *  later opens the AB's linked video clip when one exists. */
  const finalizeInPlayAtBat = async (x: number, y: number) => {
    if (!currentAB || !pendingInPlayOutcome || submittingPitch) return;
    setSubmittingPitch(true);
    try {
      if (recording) await stopRecording();
      await api.closeAtBat(currentAB.id, pendingInPlayOutcome, { x, y });
      /* Tally the hitter outcome — in-play paths always come
         through here (so the K / BB branch in submitPitch above
         and this branch together cover every terminal outcome).
         `good` = barrels + line drives. */
      if (currentAB.hitterId) {
        const hid = currentAB.hitterId;
        const isGood = pendingInPlayOutcome === 'BARREL' || pendingInPlayOutcome === 'LINE_DRIVE';
        setHitterOutcomes(prev => {
          const prior = prev[hid] || { good: 0, total: 0 };
          return {
            ...prev,
            [hid]: {
              good: prior.good + (isGood ? 1 : 0),
              total: prior.total + 1,
            },
          };
        });
      }
      setPendingInPlayOutcome(null);
      setCurrentAB(null);
    } catch (err: any) {
      setError(`Failed to close at-bat: ${err?.message || err}`);
      setTimeout(() => setError(prev => (
        prev?.startsWith('Failed to close at-bat:') ? null : prev
      )), 5000);
    } finally {
      setSubmittingPitch(false);
    }
  };

  /** Manual "Next At-Bat" — closes the current AB if open (with no
   *  outcome / status untouched) and clears the input panel so the
   *  coach can pick another hitter or stay on the same one. Stops
   *  any in-flight recording first so its clip is captured. */
  const handleNextAtBat = async () => {
    if (recording) await stopRecording();
    if (currentAB) {
      try {
        // Mark the AB as ended even if the coach didn't pick a
        // terminal result. Outcome stays null in that case so it's
        // distinguishable from genuine outcomes downstream.
        await api.updateAtBat(currentAB.id, { endedAt: new Date().toISOString() });
      } catch { /* ignore */ }
    }
    setCurrentAB(null);
    setCurrentPitches([]);
    setDraftType(null);
    setDraftCall(null);
    /* Drop any in-play outcome that was waiting for a spray-chart
       click — moving past the AB without finalizing the spray
       location means the AB closes via `updateAtBat` above with
       no outcome / location, which is the right behaviour for a
       coach who deliberately walks away from the spray pick. */
    setPendingInPlayOutcome(null);
  };

  const handlePickPitcher = async (id: string) => {
    if (id === activePitcherId) return;
    // Switching the pitcher mid-AB closes the in-progress AB without
    // a forced outcome.
    if (currentAB) await handleNextAtBat();
    setActivePitcherId(id);
  };

  const handlePickHitter = async (id: string) => {
    if (id === activeHitterId) return;
    if (currentAB) await handleNextAtBat();
    setActiveHitterId(id);
  };

  const handleEndSession = async () => {
    if (recording) await stopRecording();
    if (currentAB) await handleNextAtBat();
    if (cameraOn) setCameraOn(false); // tears down stream via the camera effect
    /* Clear each pitcher's session pitch count + each hitter's
       outcome tally — these only track the current outing, never
       persist across sessions. */
    setPitchCountByPitcher({});
    setHitterOutcomes({});
    // Phase 5: if any clips were captured, transition to the save
    // step so the coach can attach each clip to its AtBat (and
    // optionally a Report) before the session is marked complete.
    // The session itself is closed by `handleFinishSession` once
    // the save decisions are made.
    if (clips.length > 0) {
      setStep('save');
      return;
    }
    if (session) {
      try { await api.endLiveSession(session.id); } catch { /* ignore */ }
    }
    router.push('/live');
  };

  // ── Phase 5 — Save step helpers ──

  /** Lazy-load each clip's hitter reports the first time the save
   *  step opens. We dedupe by hitterId so a clip-list with multiple
   *  ABs against the same hitter only fetches once. */
  useEffect(() => {
    if (step !== 'save') return;
    const hitterIds = Array.from(new Set(clips.map(c => c.hitterId)));
    let cancelled = false;
    hitterIds.forEach(async (id) => {
      if (reportsByHitter[id]) return;
      try {
        const rows = await api.getPlayerReports(id, 'HITTING');
        if (cancelled) return;
        setReportsByHitter(prev => ({
          ...prev,
          [id]: rows.map((r: any) => ({ id: r.id, title: r.title, createdAt: r.createdAt })),
        }));
      } catch { /* ignore — picker still works with the No-Report default */ }
    });
    return () => { cancelled = true; };
  }, [step, clips, reportsByHitter]);

  /** Per-clip save. Uploads the recorded blob to /api/videos/upload
   *  as a HITTING-category Video, patches the parent AtBat to
   *  attach the videoId (and optionally a reportId), then marks
   *  the clip's local decision as `saved`. If the user picked
   *  "Create new report", we POST a fresh empty HITTING report
   *  for the hitter first and use its id as the reportId. */
  const handleSaveClip = async (clientId: string) => {
    const clip = clips.find(c => c.clientId === clientId);
    if (!clip || clip.uploading) return;
    const sel = clipReportSel[clientId] ?? REPORT_NONE;
    setClips(prev => prev.map(c => c.clientId === clientId
      ? { ...c, uploading: true, uploadError: undefined }
      : c));
    try {
      // 1) Upload the recorded blob as a Video tied to the hitter.
      const ext = clip.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const fileName = `live-${clip.hitterName.replace(/\s+/g, '-')}-vs-${clip.pitcherName.replace(/\s+/g, '-')}-${clip.clientId}.${ext}`;
      /* Strip any codec parameters from `clip.blob.type` (e.g.
         "video/webm;codecs=vp9,opus" → "video/webm") before
         stamping the File. Some browsers drop the parameterized
         MIME during the File→multipart conversion and the server
         receives an empty Content-Type; using the canonical
         `video/<container>` MIME ensures the server's filter
         picks it up reliably. */
      const cleanType = (clip.blob.type || `video/${ext}`).split(';')[0] || `video/${ext}`;
      const file = new File([clip.blob], fileName, { type: cleanType });
      const video = await api.uploadVideo(file, clip.hitterId, `Live At-Bat vs ${clip.pitcherName}`, 'HITTING');

      // 2) If the coach picked "Create new report", spin one up
      //    for this hitter and use its id below. Otherwise resolve
      //    the existing report id from the dropdown selection.
      let reportId: string | null = null;
      if (sel === REPORT_CREATE) {
        if (!user) throw new Error('User session expired');
        const created = await api.createReport({
          playerId:    clip.hitterId,
          createdById: user.id,
          reportType:  'HITTING',
          title:       `Training — ${new Date().toLocaleDateString()}`,
          content:     '{}',
        });
        reportId = created.id;
      } else if (sel !== REPORT_NONE) {
        reportId = sel;
      }

      // 3) PATCH the AtBat with the new videoId (+ optional
      //    reportId). The AtBat row stays the source of truth;
      //    the Video lives on Player.videos.
      await api.updateAtBat(clip.atBatId, {
        videoId: video.id,
        ...(reportId ? { reportId } : {}),
      });

      setClips(prev => prev.map(c => c.clientId === clientId
        ? { ...c, uploading: false, decision: 'saved', savedVideoId: video.id }
        : c));
    } catch (err: any) {
      setClips(prev => prev.map(c => c.clientId === clientId
        ? { ...c, uploading: false, uploadError: err?.message || 'Upload failed' }
        : c));
    }
  };

  const handleDiscardClip = (clientId: string) => {
    setClips(prev => prev.map(c => c.clientId === clientId ? { ...c, decision: 'discarded' } : c));
  };

  /** Finish the session: closes the LiveSession on the server and
   *  routes back to the mode picker. Pending-decision clips are
   *  effectively discarded since the in-memory store doesn't
   *  persist across navigation. */
  const handleFinishSession = async () => {
    if (session) {
      try { await api.endLiveSession(session.id); } catch { /* ignore */ }
    }
    router.push('/live');
  };

  /* Finish-Session gate: a clip is "decided" ONLY when its decision
   *  is no longer pending AND it isn't mid-upload. The previous
   *  predicate `(decision !== 'pending' || c.uploading)` treated an
   *  in-flight upload as "decided", which let the Finish button
   *  enable while saves were still streaming bytes — clicking it
   *  would route away and abort the fetch. */
  const allDecisionsMade = clips.every(c => c.decision !== 'pending' && !c.uploading);

  // ── Render gates ──
  if (user === undefined || !user || !isCoach) return null;

  return (
    <div className={pageStyles.page}>
      <PageHeader
        size="bar"
        title="Training — At-Bat"
        subtitle={
          step === 'setup'
            ? 'Pick pitchers and hitters for this session'
            : 'Pitch-by-pitch at-bat tracking'
        }
        /* End Session button lifted out of the At-Bat Tracker
           panel head and into the PageHeader's `actions` slot so
           it sits on the right side of the top "Live Session —
           At-Bat" bubble. Only rendered on the tracker step (no
           session to end during setup / save). */
        actions={step === 'tracker' ? (
          <button
            type="button"
            className={trainingStyles.secondaryBtn}
            onClick={handleEndSession}
          >
            End Session
          </button>
        ) : undefined}
      />

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* ──────────── STEP 1 — SETUP ──────────── */}
      {step === 'setup' && (
        <>
          <div className={styles.setupGrid}>
            <RosterPicker
              title="Pitchers"
              countLabel={`${pitcherIds.size} selected`}
              players={pitchersAll}
              selected={pitcherIds}
              loading={loadingPlayers}
              emptyHint="No pitchers found. Add one in Athletes first."
              onToggle={(id) => setPitcherIds(prev => {
                const n = new Set(prev);
                if (n.has(id)) n.delete(id); else n.add(id);
                return n;
              })}
            />
            <RosterPicker
              title="Hitters"
              countLabel={`${hitterIds.size} selected`}
              players={hittersAll}
              selected={hitterIds}
              loading={loadingPlayers}
              emptyHint="No hitters found. Add one in Athletes first."
              onToggle={(id) => setHitterIds(prev => {
                const n = new Set(prev);
                if (n.has(id)) n.delete(id); else n.add(id);
                return n;
              })}
            />
          </div>

          <div className={trainingStyles.actionsRow}>
            <Link href="/live" className={trainingStyles.secondaryBtn}>← Back</Link>
            <button
              type="button"
              className={trainingStyles.primaryBtn}
              disabled={pitcherIds.size === 0 || hitterIds.size === 0}
              onClick={handleStartSession}
            >
              Start Session
            </button>
          </div>
        </>
      )}

      {/* ──────────── STEP 3 — SAVE (Phase 5) ──────────── */}
      {step === 'save' && (
        /* `data-panel-kind="save"` flips this Save panel to the
            near-white `--bubble-chrome-bg` fill in light theme — the
            same Swing color the /live/training Save Clips panel +
            the Position picker + Setup Record / camera column wear. */
        <section className={trainingStyles.panel} data-panel-kind="save">
          <div className={trainingStyles.panelHead}>
            <h2 className={trainingStyles.panelTitle}>Save Recordings</h2>
            <span className={trainingStyles.countChip}>
              {clips.length} recording{clips.length === 1 ? '' : 's'}
            </span>
          </div>
          {clips.length === 0 ? (
            <div className={trainingStyles.dim}>No clips recorded.</div>
          ) : (
            <div className={styles.saveList}>
              {clips.map(clip => {
                const reportSel = clipReportSel[clip.clientId] ?? REPORT_NONE;
                const hitterReports = reportsByHitter[clip.hitterId] ?? [];
                return (
                  <div key={clip.clientId} className={styles.saveRow}>
                    <video src={clip.previewUrl} controls className={styles.savePreview} />
                    <div className={styles.saveMeta}>
                      <div className={styles.saveMatchup}>
                        <strong>{clip.hitterName}</strong>
                        <span className={trainingStyles.dim}>vs</span>
                        <span>{clip.pitcherName}</span>
                      </div>
                      <div className={trainingStyles.dim}>
                        {clip.durationSec}s · {Math.round(clip.blob.size / 1024)} KB
                      </div>
                      {clip.decision === 'pending' && (
                        <label className={styles.savePickerRow}>
                          <span className={trainingStyles.dim}>Attach to:</span>
                          <select
                            className={styles.savePickerSelect}
                            value={reportSel}
                            disabled={!!clip.uploading}
                            onChange={(e) => setClipReportSel(prev => ({ ...prev, [clip.clientId]: e.target.value }))}
                          >
                            <option value={REPORT_NONE}>At-Bat only (no report)</option>
                            {hitterReports.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.title || `Hitting Report — ${new Date(r.createdAt).toLocaleDateString()}`}
                              </option>
                            ))}
                            <option value={REPORT_CREATE}>+ Create new Hitting Report</option>
                          </select>
                        </label>
                      )}
                      {clip.uploadError && (
                        <div className={styles.saveErr}>Upload failed: {clip.uploadError}</div>
                      )}
                    </div>
                    <div className={styles.saveActions}>
                      {clip.decision === 'pending' && (
                        <>
                          <button
                            type="button"
                            className={trainingStyles.primaryBtn}
                            disabled={!!clip.uploading}
                            onClick={() => handleSaveClip(clip.clientId)}
                          >
                            {clip.uploading ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className={trainingStyles.secondaryBtn}
                            disabled={!!clip.uploading}
                            onClick={() => handleDiscardClip(clip.clientId)}
                          >
                            Discard
                          </button>
                        </>
                      )}
                      {clip.decision === 'saved' && (
                        <div className={styles.saveDone}>✓ Saved</div>
                      )}
                      {clip.decision === 'discarded' && (
                        <div className={styles.saveDiscarded}>Discarded</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className={trainingStyles.actionsRow}>
            <button
              type="button"
              className={trainingStyles.secondaryBtn}
              onClick={() => setStep('tracker')}
            >
              ← Back to tracker
            </button>
            <button
              type="button"
              className={trainingStyles.primaryBtn}
              disabled={!allDecisionsMade && clips.length > 0}
              onClick={handleFinishSession}
            >
              Finish Session
            </button>
          </div>
        </section>
      )}

      {/* ──────────── STEP 2 — TRACKER ──────────── */}
      {step === 'tracker' && (
        <div className={styles.trackerLayout}>
          {/* Pitchers column — `metaById` surfaces a per-pitcher
             session pitch count under each name (e.g. "P: 5" =
             5 pitches thrown by this pitcher across all ABs in
             this session). Defaults to "P: 0" so the sub-line
             always appears (matches the Hitters column's "0-0"
             treatment); the tally increments on every successful
             pitch submit. Reset on End Session. */}
          <RosterColumn
            title="Pitchers"
            players={sessionPitchers}
            activeId={activePitcherId}
            onPick={handlePickPitcher}
            handednessFromThrows
            metaById={Object.fromEntries(
              sessionPitchers.map(p => [p.id, `P: ${pitchCountByPitcher[p.id] ?? 0}`])
            )}
          />
          {/* Hitters column — `metaById` surfaces a per-hitter
             outcome ratio under each name (e.g. "2-4" = 2 productive
             outcomes in 4 completed ABs this session). Defaults to
             "0-0" for every session hitter so the sub-line always
             appears (matches the pitcher "P: 0" treatment in the
             matchup row); the tally increments as ABs close. */}
          <RosterColumn
            title="Hitters"
            players={sessionHitters}
            activeId={activeHitterId}
            onPick={handlePickHitter}
            metaById={Object.fromEntries(
              sessionHitters.map(h => {
                const o = hitterOutcomes[h.id];
                return [h.id, `${o?.good ?? 0}-${o?.total ?? 0}`];
              })
            )}
          />

          {/* At-Bat tracker — fills remaining width. Panel head
             retired per spec: the "At-Bat Tracker" title is gone
             and the "End Session" button moved up to the PageHeader's
             `actions` slot at the top of the page, freeing this
             column to lead with the matchup row. */}
          <section className={styles.trackerPanel}>
            {!activePitcher || !activeHitter ? (
              <div className={trainingStyles.dim}>
                Pick a pitcher and a hitter from the lists on the left to start an at-bat.
              </div>
            ) : (
              <>
                <div className={styles.matchupRow}>
                  <div className={styles.matchupCell}>
                    <div className={styles.matchupLabel}>Pitcher</div>
                    <div className={styles.matchupName}>
                      {activePitcher.firstName} {activePitcher.lastName}
                      {activePitcher.throws && <span className={styles.matchupHand}>{activePitcher.throws === 'L' ? 'LHP' : 'RHP'}</span>}
                    </div>
                    {/* "P: N" sub-line retired from the matchup cell —
                       the per-pitcher session pitch count now lives
                       under each pitcher's name in the Pitchers
                       roster column (mirrors the Hitters column's
                       outcome-ratio treatment). Keeps the matchup
                       row symmetric (Pitcher name + Hitter name
                       only) and avoids duplicating the readout. */}
                  </div>
                  <div className={styles.matchupVs}>vs</div>
                  <div className={styles.matchupCell}>
                    <div className={styles.matchupLabel}>Hitter</div>
                    <div className={styles.matchupName}>
                      {activeHitter.firstName} {activeHitter.lastName}
                      {activeHitter.bats && <span className={styles.matchupHand}>{activeHitter.bats}HB</span>}
                    </div>
                  </div>
                  <div className={styles.matchupCount}>
                    {/* Only the balls-strikes count remains here; the
                       per-pitch "Pitch #N" sub-line moved up under
                       the pitcher's name as "P: N" (per-pitcher
                       session total). */}
                    <span className={styles.matchupCountBig}>{liveCount.balls}-{liveCount.strikes}</span>
                  </div>
                </div>

                {/* Pitch-type picker — three rows: fastballs, breaking balls, offspeed. */}
                <div className={styles.pickerBlock}>
                  <div className={styles.pickerLabel}>Pitch Type</div>
                  <div className={styles.pickerRows}>
                    {PITCH_TYPE_ROWS.map((row, i) => (
                      <div key={i} className={styles.pickerRow}>
                        {row.map(t => {
                          const active = draftType === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              className={`${styles.pickerBtn} ${active ? styles.pickerBtnActive : ''}`}
                              onClick={() => setDraftType(active ? null : t)}
                            >
                              {fmtPitchType(t)}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Ball/Strike toggle — now REQUIRED. Drives in-zone
                    swing-percentage tracking downstream; the Result
                    picker stays disabled until a ball/strike call is
                    selected. */}
                <div className={styles.pickerBlock}>
                  <div className={styles.pickerLabel}>Umpire Call</div>
                  <div className={styles.pickerToggle}>
                    {(['BALL', 'STRIKE'] as const).map(c => {
                      const active = draftCall === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          className={`${styles.pickerBtn} ${active ? styles.pickerBtnActive : ''}`}
                          onClick={() => setDraftCall(active ? null : c)}
                        >
                          {c === 'BALL' ? 'Ball' : 'Strike'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Result picker — only enabled when a pitchType is picked.
                    Buttons are styled as "terminal" (red) when tapping
                    them WOULD end the at-bat under the current count:
                    in-play results are always terminal; STRIKE_* with
                    2 strikes already on the board would force a K;
                    BALL with 3 balls would force a walk. The terminal
                    styling is dynamic so the coach can see at a glance
                    which tap will end the AB. */}
                <div className={styles.pickerBlock}>
                  <div className={styles.pickerLabel}>
                    Result
                    {!draftType && <span className={styles.pickerHint}> · pick a pitch type first</span>}
                    {draftType && !draftCall && <span className={styles.pickerHint}> · pick an umpire call</span>}
                  </div>
                  <div className={styles.pickerRows}>
                    {PITCH_RESULT_ROWS.map((row, i) => (
                      <div key={i} className={styles.pickerRow}>
                        {row.map(r => {
                          const wouldEndAB =
                            TERMINAL_PITCH_RESULTS.has(r) ||
                            ((r === 'STRIKE_LOOKING' || r === 'STRIKE_SWINGING') && liveCount.strikes >= 2) ||
                            (r === 'BALL' && liveCount.balls >= 3);
                          return (
                            <button
                              key={r}
                              type="button"
                              className={`${styles.pickerBtn} ${wouldEndAB ? styles.pickerBtnTerminal : ''}`}
                              /* Disabled until BOTH `draftType` and
                                 `draftCall` are picked — umpire call
                                 is now required to compute in-zone
                                 swing percentages. */
                              disabled={!draftType || !draftCall || submittingPitch}
                              onClick={() => submitPitch(r)}
                            >
                              {fmtResult(r)}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mini spray field — lives under the Result picker
                   and replaces the retired "Close At-Bat" button as
                   the canonical close-the-AB UX for in-play
                   outcomes. Strikeouts and walks auto-close
                   immediately in `submitPitch` above; in-play
                   outcomes (BARREL / FLY_BALL / GROUND_BALL /
                   LINE_DRIVE) park the outcome in
                   `pendingInPlayOutcome` and wait for the coach to
                   tap a point on this field. The click captures
                   normalized [0,1] coords that get saved on the
                   AtBat row via `closeAtBat` so the Hitting tab's
                   Spray Chart can render the point — and the
                   AtBat's existing `videoId` link makes clicking
                   that spray point open the recorded clip when one
                   exists. */}
                <MiniSprayField
                  pending={pendingInPlayOutcome}
                  disabled={submittingPitch}
                  onPick={(x, y) => finalizeInPlayAtBat(x, y)}
                />

                {/* Current AB pitch log */}
                {currentPitches.length > 0 && (
                  <div className={styles.pitchLog}>
                    <div className={styles.pickerLabel}>This At-Bat</div>
                    <ul className={styles.pitchLogList}>
                      {currentPitches.map(p => (
                        <li key={p.id}>
                          <span className={styles.pitchLogNum}>P{p.pitchNumber}</span>
                          <span>{fmtPitchType(p.pitchType)}</span>
                          {p.callBallStrike && <span className={styles.pitchLogCall}>{p.callBallStrike === 'BALL' ? 'Ball' : 'Strike'}</span>}
                          {p.result && <span>· {fmtResult(p.result)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* "Close At-Bat" button retired — strikeouts / walks
                   auto-close in `submitPitch`, in-play outcomes
                   close via the mini-field click above. The fallback
                   "Skip AB" button below lets the coach abandon an
                   in-progress AB without recording an outcome. */}
                <div className={styles.trackerFooter}>
                  <button
                    type="button"
                    className={trainingStyles.secondaryBtn}
                    onClick={handleNextAtBat}
                  >
                    {currentAB ? 'Skip AB' : 'Next At-Bat'}
                  </button>
                </div>
              </>
            )}

            {/* Recent at-bats for this hitter — context surface */}
            {activeHitter && (
              <div className={styles.recentBlock}>
                <div className={styles.recentHead}>
                  <span className={trainingStyles.dim}>
                    Recent at-bats — {activeHitter.firstName} {activeHitter.lastName}
                  </span>
                  <div className={styles.recentChips}>
                    {[25, 50, 100].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.recentChip} ${recentFilterLimit === n ? styles.recentChipActive : ''}`}
                        onClick={() => setRecentFilterLimit(n)}
                      >
                        Last {n}
                      </button>
                    ))}
                  </div>
                </div>
                {recentAtBats.length === 0 ? (
                  <div className={trainingStyles.dim}>No at-bats recorded yet.</div>
                ) : (
                  <ul className={styles.recentList}>
                    {recentAtBats.map(ab => (
                      <li key={ab.id} className={styles.recentRow}>
                        <span className={styles.recentDate}>
                          {new Date(ab.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <span className={styles.recentVs}>
                          vs {ab.pitcher ? `${ab.pitcher.lastName}` : '—'}
                          {ab.pitcherHandedness && <span className={styles.recentHand}>{ab.pitcherHandedness}HP</span>}
                        </span>
                        <span className={styles.recentOutcome}>
                          {ab.outcome ? fmtResult(ab.outcome) : <em>open</em>}
                        </span>
                        <span className={trainingStyles.dim}>{ab.pitches.length} pitch{ab.pitches.length === 1 ? '' : 'es'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* ── 4th column — Video panel ──
              Lifted out of `.trackerPanel` so the video preview +
              recording controls have their own dedicated lane,
              wider than the pitches column. The panel still gates
              its content on `activePitcher && activeHitter` — until
              both are picked there's no AB to record, so the panel
              shows a quiet placeholder instead of the live preview. */}
          <section className={styles.videoPanel}>
            <div className={trainingStyles.panelHead}>
              <h2 className={trainingStyles.panelTitle}>Video</h2>
            </div>

            {!activePitcher || !activeHitter ? (
              <div className={trainingStyles.dim}>
                Pick a pitcher and a hitter to start recording.
              </div>
            ) : (
              <div className={styles.videoBubble}>
                {!cameraOn ? (
                  <button
                    type="button"
                    className={`${trainingStyles.primaryBtn} ${styles.videoEnableBtn}`}
                    onClick={() => setCameraOn(true)}
                  >
                    ▶ Start Video
                  </button>
                ) : (
                  <>
                    <div className={styles.videoFrame}>
                      {cameraError ? (
                        <div className={styles.videoErr}>
                          <strong>Camera blocked:</strong> {cameraError}
                        </div>
                      ) : (
                        <video
                          ref={videoElRef}
                          autoPlay
                          playsInline
                          muted
                          className={styles.videoEl}
                        />
                      )}
                      {recording && <span className={styles.videoRecDot}>● REC</span>}
                    </div>
                    <div className={styles.videoControls}>
                      {!recording ? (
                        <button
                          type="button"
                          className={trainingStyles.primaryBtn}
                          disabled={!currentAB || !!cameraError}
                          onClick={startRecording}
                        >
                          ● Record At-Bat
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={trainingStyles.dangerBtn}
                          onClick={() => stopRecording()}
                        >
                          ■ Stop Recording
                        </button>
                      )}
                      <button
                        type="button"
                        className={trainingStyles.secondaryBtn}
                        onClick={() => setCameraOn(false)}
                      >
                        Turn off camera
                      </button>
                      <span className={trainingStyles.dim}>
                        {clips.length} clip{clips.length === 1 ? '' : 's'} captured
                        {!currentAB && !recording && ' · waiting for next at-bat'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/* ── Setup-step roster picker (multi-select w/ count chip) ── */
function RosterPicker({
  title, countLabel, players, selected, loading, emptyHint, onToggle,
}: {
  title: string;
  countLabel: string;
  players: Player[];
  selected: Set<string>;
  loading: boolean;
  emptyHint: string;
  onToggle: (id: string) => void;
}) {
  return (
    /* `data-panel-kind="players"` flips this Setup-step roster picker
        (Pitchers / Hitters) to the cool-slate `--panel-bg-light` fill
        in light theme — same Player Name bubble color the /live/training
        Athletes panel + the /videos & /training picker bubbles use, so
        every player-select surface across the coaching app reads in
        one unified outer tone. */
    <section className={trainingStyles.panel} data-panel-kind="players">
      <div className={trainingStyles.panelHead}>
        <h2 className={trainingStyles.panelTitle}>{title}</h2>
        <span className={trainingStyles.countChip}>{countLabel}</span>
      </div>
      {loading ? (
        <div className={trainingStyles.dim}>Loading roster…</div>
      ) : players.length === 0 ? (
        <div className={trainingStyles.dim}>{emptyHint}</div>
      ) : (
        <div className={trainingStyles.rosterGrid}>
          {players.map(p => {
            const checked = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`${trainingStyles.rosterRow} ${checked ? trainingStyles.rosterRowActive : ''}`}
                onClick={() => onToggle(p.id)}
              >
                <span className={trainingStyles.rosterCheck}>{checked ? '✓' : ''}</span>
                <span className={trainingStyles.rosterName}>{p.firstName} {p.lastName}</span>
                <span className={trainingStyles.rosterMeta}>{p.positions || '—'}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── Tracker-step compact roster column ── */
function RosterColumn({
  title, players, activeId, onPick, handednessFromThrows = false, metaById,
}: {
  title: string;
  players: Player[];
  activeId: string | null;
  onPick: (id: string) => void;
  /** When true, suffix the player name with L/R from `throws`
   *  (used for the Pitchers column). Hitters column uses `bats`. */
  handednessFromThrows?: boolean;
  /** Optional per-player meta string rendered as a sub-line below
   *  the player name. Used by the Hitters column to show the
   *  "good-total" outcome ratio (barrels + line drives over total
   *  closed ABs in this session). Omitted columns / players just
   *  render the name + handedness chip. */
  metaById?: Record<string, string>;
}) {
  return (
    <aside className={trainingStyles.rosterColumn}>
      <div className={trainingStyles.rosterColumnHead}>{title}</div>
      <div className={trainingStyles.rosterColumnList}>
        {players.length === 0 ? (
          <div className={trainingStyles.dim}>No {title.toLowerCase()} in this session.</div>
        ) : (
          players.map(p => {
            const active = p.id === activeId;
            const hand = handednessFromThrows ? p.throws : p.bats;
            const meta = metaById?.[p.id];
            return (
              <button
                key={p.id}
                type="button"
                className={`${trainingStyles.rosterColumnRow} ${active ? trainingStyles.rosterColumnRowActive : ''}`}
                onClick={() => onPick(p.id)}
              >
                <span className={trainingStyles.rosterColumnName}>{p.firstName} {p.lastName}</span>
                {hand && <span className={trainingStyles.rosterColumnCount}>{hand}</span>}
                {meta && (
                  <span
                    className={trainingStyles.rosterColumnCount}
                    style={{
                      /* Drop the meta chip below the name + handedness
                         row by spanning a fresh flex line; mono numerals
                         + muted color so the ratio reads as a sub-line
                         rather than competing with the player name. */
                      flexBasis: '100%',
                      marginTop: 2,
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {meta}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

/* ── MiniSprayField ────────────────────────────────────────────
   Inline SVG baseball-field diagram rendered under the Result
   picker. Click captures normalized (x,y) in [0,1]:
     • x — horizontal axis, 0 = left foul line, 1 = right foul line.
     • y — depth axis,      0 = home plate,     1 = deep outfield.
   Only fires `onPick` when `pending` is set (i.e. the coach has
   already tapped an in-play Result and the AB is waiting for a
   field location). Clicks while `pending` is null are no-ops, so
   the chart can stay rendered as a visual reference between
   at-bats. */
function MiniSprayField({
  pending, disabled, onPick,
}: {
  pending: PitchResult | null;
  disabled: boolean;
  onPick: (x: number, y: number) => void;
}) {
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pending || disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    /* Invert Y so home plate (visually at the bottom of the SVG)
       maps to y=0 and the outfield wall (top of SVG) maps to y=1. */
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    onPick(x, y);
  };
  return (
    <div className={styles.pickerBlock}>
      <div className={styles.pickerLabel}>
        Spray Location
        {pending && (
          <span className={styles.pickerHint}> · tap where the ball landed</span>
        )}
        {!pending && (
          <span className={styles.pickerHint}> · enabled after an in-play result</span>
        )}
      </div>
      <svg
        viewBox="0 0 100 100"
        onClick={handleClick}
        style={{
          width: '100%',
          maxWidth: 320,
          aspectRatio: '1 / 1',
          alignSelf: 'center',
          borderRadius: 10,
          background: '#0a0e14',
          border: '1px solid var(--border)',
          cursor: pending && !disabled ? 'crosshair' : 'default',
          opacity: pending ? 1 : 0.55,
          transition: 'opacity 0.15s ease',
        }}
      >
        {/* Outfield grass — fan shape between the foul lines, capped
           by a curved wall at the deep end. */}
        <path
          d="M 50 95 L 8 8 A 60 60 0 0 1 92 8 Z"
          fill="#1a3a1f"
          stroke="var(--border)"
          strokeWidth="0.4"
        />
        {/* Infield dirt — diamond bounded by the 4 bases. */}
        <path
          d="M 35 78 L 50 60 L 65 78 L 50 92 Z"
          fill="#5c3d2e"
          stroke="var(--border-strong)"
          strokeWidth="0.4"
        />
        {/* Foul lines — from home plate diagonally out to the
           outfield corners. */}
        <line x1="50" y1="93" x2="8" y2="8" stroke="rgba(255,255,255,0.45)" strokeWidth="0.4" />
        <line x1="50" y1="93" x2="92" y2="8" stroke="rgba(255,255,255,0.45)" strokeWidth="0.4" />
        {/* Pitcher's mound — small circle at the centre of the
           diamond, between home and second base. */}
        <circle cx="50" cy="76" r="2.5" fill="#8a6248" stroke="var(--border-strong)" strokeWidth="0.3" />
        {/* Bases — small white squares at 1B / 2B / 3B; home plate
           is the pentagon below. */}
        <rect x="63.5" y="76.5" width="3" height="3" fill="var(--text-bright)" />
        <rect x="48.5" y="58.5" width="3" height="3" fill="var(--text-bright)" />
        <rect x="33.5" y="76.5" width="3" height="3" fill="var(--text-bright)" />
        {/* Home plate — pentagonal */}
        <polygon points="47,91 53,91 53,93 50,95 47,93" fill="var(--text-bright)" />
        {/* Reticle when waiting for a spray pick — subtle pulsing
           dot at the centre of the diamond invites the click. */}
        {pending && (
          <circle cx="50" cy="76" r="1.2" fill="#7eb6ff">
            <animate attributeName="r" values="1.2;2.6;1.2" dur="1.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.2s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </div>
  );
}
