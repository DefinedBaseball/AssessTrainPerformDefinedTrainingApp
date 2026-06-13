'use client';

/* ─────────────────────────────────────────────────────────────────────
   VideoStopwatch — a stopwatch that measures elapsed VIDEO time off a
   target <video> element rather than the wall clock.

   Why video-time and not wall-clock:
     • It "counts normally" at 1× (1 played second = 1 stopwatch second).
     • It "adjusts to the playback speed" for free — at 0.5× two real
       seconds pass for one video second, at 2× the reverse — because we
       read `video.currentTime`, which only advances by the amount of
       footage that actually played.
     • It "only counts when the video is moving" — paused video holds
       `currentTime` steady, so the readout freezes; play, scrub, or
       frame-step (forward OR backward) and it tracks the change.
     • Frame-by-frame works at any speed: each frame-step nudges
       `currentTime`, and the rAF sampler picks it up the next frame.

   Model: while running, elapsed = currentTime − anchor (clamped ≥ 0).
   Start anchors at the current frame (continuing from any frozen value
   on resume); Stop freezes the reading; Reset zeroes it.

   Reusable across every playback surface — drop it into VideoControlBar
   (so it rides along in every tab's player + the bundle viewer) and
   onto the recording-preview <video> in the Coach Review save panel.
   ───────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@/lib/theme-context';

interface Props {
  /** Ref to the <video> whose elapsed playback time is measured. May be
   *  null while the parent is still mounting. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Optional inline-style overrides for the outer chip group. */
  style?: React.CSSProperties;
  /** Videos the on-screen mirror timer should be painted over while running.
   *  Defaults to just `videoRef`. The synced bundle viewer passes a getter
   *  for every VISIBLE angle so the timer appears on all of them (and keeps
   *  showing even if the master angle is hidden). Off-screen / hidden videos
   *  report a zero-size rect and are skipped automatically. */
  overlayTargets?: () => (HTMLVideoElement | null)[];
}

/** Cheap frame-to-frame equality so the 60 fps sampler only re-renders when a
 *  tracked video actually moves on screen. */
function sameRects(a: { top: number; left: number }[], b: { top: number; left: number }[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].top - b[i].top) > 0.5 || Math.abs(a[i].left - b[i].left) > 0.5) return false;
  }
  return true;
}

/** Format video-elapsed seconds. Under a minute → "2.05s" (hundredths,
 *  finer than a 30 fps frame); a minute or more → "1:05.30". */
function fmtElapsed(sec: number): string {
  const a = Math.max(0, sec);
  if (a < 60) return `${a.toFixed(2)}s`;
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function VideoStopwatch({ videoRef, style, overlayTargets }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [running, setRunning] = useState(false);
  const [display, setDisplay] = useState(0);
  /* On-video overlay placements — the second (mirror) timer rendered in the
     top corner of EACH target <video> while running. One entry per visible
     video. Tracked in viewport coords (position: fixed) so each lands on the
     right corner regardless of how the host positions its video container. */
  const [overlays, setOverlays] = useState<{ top: number; left: number }[]>([]);
  /* `anchor` = the video currentTime that maps to the current reading of
     0 (offset back by any frozen value so Resume continues seamlessly).
     `frozen` = the last reading captured on Stop. */
  const anchorRef = useRef(0);
  const frozenRef = useRef(0);

  /* Hold the LATEST `videoRef` prop in a ref refreshed every render.
     Some hosts (the synced bundle viewer) pass a fresh `{ current: node }`
     object on each render rather than a stable React ref — capturing one
     such object in a closure can freeze a null `.current`. Reading through
     this always resolves the live <video> regardless of how it's passed. */
  const propRef = useRef(videoRef);
  propRef.current = videoRef;
  const getVideo = useCallback(() => propRef.current?.current ?? null, []);

  /* Latest `overlayTargets` getter, refreshed each render (hosts pass a fresh
     closure when their visible-pane set changes). */
  const targetsRef = useRef(overlayTargets);
  targetsRef.current = overlayTargets;

  /* Resolve the live, VISIBLE target videos + their top-left rects (defaults
     to just our own video). Hidden/off-screen videos report a zero-size rect
     and drop out. The first entry is the timeline reference for the readout —
     reading a still-visible synced angle (rather than the master, which the
     bundle remounts at t=0 when eye-hidden) keeps the elapsed value stable. */
  const collectVisible = useCallback(() => {
    const fn = targetsRef.current;
    const vids = fn ? fn() : [getVideo()];
    const out: { v: HTMLVideoElement; top: number; left: number }[] = [];
    for (const v of vids) {
      if (!v) continue;
      const r = v.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ v, top: r.top, left: r.left });
    }
    return out;
  }, [getVideo]);

  /* The video whose currentTime drives the readout: first visible target,
     falling back to our own video (covers the moment all panes are hidden). */
  const getTimeVideo = useCallback(() => {
    const vis = collectVisible();
    return vis.length ? vis[0].v : getVideo();
  }, [collectVisible, getVideo]);

  /* Live sampler — while running, read currentTime every animation frame
     so the readout reflects play, pause-hold, scrub, and frame-step.
     Gated only on `running` so the loop survives prop-identity churn. */
  useEffect(() => {
    if (!running) { setOverlays((o) => (o.length ? [] : o)); return; }
    let raf = 0;
    const tick = () => {
      const vis = collectVisible();
      const ref = vis.length ? vis[0].v : getVideo();
      if (ref) setDisplay(Math.max(0, ref.currentTime - anchorRef.current));
      const rects = vis.map(({ top, left }) => ({ top, left }));
      setOverlays((prev) => (sameRects(prev, rects) ? prev : rects));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, getVideo, collectVisible]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = getTimeVideo();
    const now = v ? v.currentTime : 0;
    if (running) {
      frozenRef.current = Math.max(0, now - anchorRef.current);
      setDisplay(frozenRef.current);
      setRunning(false);
    } else {
      // Resume continues from the frozen reading rather than restarting.
      anchorRef.current = now - frozenRef.current;
      setRunning(true);
    }
  }, [running, getTimeVideo]);

  const reset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    frozenRef.current = 0;
    const v = getTimeVideo();
    anchorRef.current = v ? v.currentTime : 0;
    setDisplay(0);
    setRunning(false);
  }, [getTimeVideo]);

  const hasValue = display > 0 || running;
  const accent = '#7eb6ff';

  /* Second timer — a mirror of the readout pinned to the top-left corner of
     the video itself, shown only while the stopwatch is running. One chip per
     visible target video (all synced angles in the bundle viewer; a single
     video everywhere else). Portaled to <body> with position:fixed at each
     video's live rect so it floats above the player chrome in every surface.
     pointerEvents:none keeps the video and its controls interactive beneath. */
  const overlayTimer = running && overlays.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <>
          {overlays.map((o, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                position: 'fixed',
                top: o.top + 10,
                left: o.left + 10,
                zIndex: 2000,
                pointerEvents: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 9px',
                borderRadius: 7,
                background: 'rgba(10, 14, 20, 0.72)',
                border: '1px solid rgba(126, 182, 255, 0.55)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: '0.02em',
                color: '#eaf2ff',
                lineHeight: 1,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="#7eb6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" focusable="false">
                <line x1="9" y1="2" x2="15" y2="2" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <circle cx="12" cy="14" r="7" />
                <line x1="12" y1="14" x2="12" y2="10" />
              </svg>
              {fmtElapsed(display)}
            </div>
          ))}
        </>,
        document.body,
      )
    : null;

  return (
    <>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...style,
      }}
    >
      {/* Start / Stop toggle — stopwatch glyph. Tints accent-blue while
          running so it reads as "armed and tracking". */}
      <button
        type="button"
        onClick={toggle}
        aria-label={running ? 'Stop stopwatch' : 'Start stopwatch'}
        title={running ? 'Stop stopwatch' : 'Start stopwatch (measures elapsed video time)'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 33,
          height: 33,
          padding: 0,
          borderRadius: 5,
          background: running ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.04)',
          border: '1px solid ' + (running ? 'rgba(126,182,255,0.55)' : 'var(--border)'),
          color: running ? 'var(--text-bright)' : (isLight ? 'var(--text)' : 'var(--text)'),
          cursor: 'pointer',
          transition: 'background 0.12s ease, border-color 0.12s ease',
        }}
      >
        {/* Stopwatch icon — dial + crown + hand. */}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false">
          <line x1="9" y1="2" x2="15" y2="2" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <circle cx="12" cy="14" r="7" />
          <line x1="12" y1="14" x2="12" y2="10" />
        </svg>
      </button>

      {/* Live readout — tabular-nums so digits don't jitter. */}
      <span
        style={{
          minWidth: 58,
          textAlign: 'right',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: '0.02em',
          color: running ? accent : (hasValue ? 'var(--text-bright)' : 'var(--text-muted)'),
        }}
      >
        {fmtElapsed(display)}
      </span>

      {/* Reset — only once there's something to clear. */}
      {hasValue && (
        <button
          type="button"
          onClick={reset}
          aria-label="Reset stopwatch"
          title="Reset stopwatch"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            padding: 0,
            borderRadius: 5,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" focusable="false">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <polyline points="3 3 3 8 8 8" />
          </svg>
        </button>
      )}
    </div>
    {overlayTimer}
    </>
  );
}
