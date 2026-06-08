'use client';

/* ─────────────────────────────────────────────────────────────────────
   VideoControlBar — custom playback bar that sits BELOW the native
   <video> element (which keeps its own seek / volume / fullscreen
   controls). This bar adds:

     • Play / Pause toggle (mirrors the video's actual state via
       `play` / `pause` event listeners so the icon stays in sync
       when the user interacts with the native controls too).

     • Frame-by-frame stepper — two buttons (←‖ and ‖→) that pause
       the video and advance `currentTime` by 1/30 sec (≈ one frame
       at 30 fps; matches most baseball video). Holds the user a
       single frame at a time so they can scrub a swing or release.

     • Two preset speeds — 0.5× and 0.25× — for quick toggling
       between common slow-motion playback rates.

     • Continuous speed slider — 0.10× to 2.00× in 0.05 steps so the
       user can dial in any speed they want, not just the presets.
       Selecting a preset jumps the slider; dragging the slider
       updates the rate live.

   `PlaybackSpeedControl` is kept as a named export for backward
   compatibility with existing callers (it now resolves to the full
   `VideoControlBar`). New callers should import `VideoControlBar`
   directly for clarity.
   ───────────────────────────────────────────────────────────────── */

import { useEffect, useState, type RefObject } from 'react';
import { useTheme } from '@/lib/theme-context';

interface Props {
  /** Ref to the HTMLVideoElement whose `playbackRate` / `currentTime`
   *  / `paused` state should be controlled. May be `null` while the
   *  parent is still mounting. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Optional inline-style overrides — the host can reposition or
   *  re-skin the bar (e.g., flush to the bottom of an overlay). */
  style?: React.CSSProperties;
}

/** Assumed frame rate for the frame-by-frame stepper. 30 fps is the
 *  baseball-vendor default (HitTrax / iPhone / GoPro standard mode);
 *  60 fps clips just step 2 frames per click, which is still useful. */
const FRAME_DURATION_SEC = 1 / 30;

const PRESET_SPEEDS = [0.5, 0.25] as const;

const SLIDER_MIN = 0.1;
const SLIDER_MAX = 2.0;
const SLIDER_STEP = 0.05;

export function VideoControlBar({ videoRef, style }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  /* Theme-aware bar chrome — flips the playback bar from its dark-
     navy chip to a near-white `--bubble-chrome-bg` surface in light
     theme so it matches the rest of the light palette. Inner button
     accents (the blue active states, the per-preset chips) stay
     theme-neutral via their existing rgba accents — those translate
     to either backdrop. The host can still pass `style` to override
     these per call site (the synced master bar in the bundle modal
     overrides bg to transparent so the bar sits flush inside the
     unified bottom toolbar). */
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const barBg = isLight ? 'var(--bubble-chrome-bg)' : 'rgba(10, 14, 20, 0.85)';
  const barShadow = isLight
    ? '0 2px 8px rgba(0, 0, 0, 0.10)'
    : '0 2px 8px rgba(0, 0, 0, 0.40)';
  const barTextColor = isLight ? 'var(--text)' : 'var(--text-bright)';

  /* Sync `isPlaying` with the video's actual paused state so the
     Play/Pause toggle reflects user interaction with the native
     controls bar too. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    setIsPlaying(!v.paused);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [videoRef]);

  /* Apply the selected rate to the video element whenever:
       - the user picks a different rate, OR
       - the video element itself changes (re-mount).
     Idempotent — only touches `playbackRate` when it differs. */
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.playbackRate !== rate) v.playbackRate = rate;
  });

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => { /* swallow autoplay-block */ });
    else v.pause();
  };

  const stepFrame = (dir: 1 | -1) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) v.pause();
    const target = v.currentTime + dir * FRAME_DURATION_SEC;
    v.currentTime = Math.max(0, Math.min(v.duration || target, target));
  };

  const pickPreset = (s: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setRate(s);
    const v = videoRef.current;
    /* Auto-play when a slow-motion preset is picked so the user
       sees the effect immediately without a second tap. */
    if (v && v.paused) v.play().catch(() => { /* ignore */ });
  };

  /* Second sizing pass — bar is now 30 % taller AND 50 % wider than
     the previous round (which was already 1.4× the original):
       padding:        4px 7px   → 5px 11px      (×1.3 vert / ×1.5 horiz)
       font-size:      13        → 17            (×1.3)
       gap:            6         → 9             (×1.5)
       icon buttons:   25×25     → 33×33         (×1.3 — kept square)
       play button:    28×25     → 38×33         (×1.36 / ×1.3)
       preset padding: 3px 7px   → 4px 11px      (×1.3 / ×1.5)
       slider track:   105w/17h  → 158w/22h      (×1.5 / ×1.3)
       readout:        42w/13fs  → 63w/17fs      (×1.5 / ×1.3)
     SVG icons inside the buttons enlarged proportionally so they
     don't look lost against the taller hit-targets. */
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '5px 11px',
        borderRadius: 10,
        background: barBg,
        border: '1px solid var(--border-light)',
        boxShadow: barShadow,
        fontFamily: 'var(--font-mono)',
        fontSize: 17,
        fontWeight: 700,
        letterSpacing: '0.04em',
        color: barTextColor,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {/* Play / Pause toggle */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        style={{
          ...iconBtnStyle,
          background: 'rgba(126,182,255,0.18)',
          border: '1px solid rgba(126,182,255,0.55)',
          color: 'var(--text-bright)',
          width: 38, height: 33,
        }}
      >
        {isPlaying ? (
          <svg width="13" height="14" viewBox="0 0 10 12" fill="currentColor">
            <rect x="0" y="0" width="3.5" height="12" />
            <rect x="6.5" y="0" width="3.5" height="12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="2,1 2,11 11,6" />
          </svg>
        )}
      </button>

      {/* Frame-by-frame stepper — two buttons sit close together so
         they read as a paired control. */}
      <div style={{ display: 'inline-flex', gap: 2 }}>
        <button
          type="button"
          onClick={stepFrame(-1)}
          aria-label="Step back one frame"
          title="Step back one frame"
          style={iconBtnStyle}
        >
          <svg width="18" height="14" viewBox="0 0 14 12" fill="currentColor">
            <rect x="1" y="1" width="2" height="10" />
            <polygon points="13,1 13,11 5,6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={stepFrame(1)}
          aria-label="Step forward one frame"
          title="Step forward one frame"
          style={iconBtnStyle}
        >
          <svg width="18" height="14" viewBox="0 0 14 12" fill="currentColor">
            <polygon points="1,1 1,11 9,6" />
            <rect x="11" y="1" width="2" height="10" />
          </svg>
        </button>
      </div>

      {/* Preset speed buttons */}
      {PRESET_SPEEDS.map(s => {
        const active = s === rate;
        return (
          <button
            key={s}
            type="button"
            onClick={pickPreset(s)}
            style={{
              padding: '4px 11px',
              borderRadius: 5,
              border: '1px solid ' + (active ? 'rgba(126,182,255,0.55)' : 'rgba(255,255,255,0.10)'),
              background: active ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.03)',
              color: active ? 'var(--text-bright)' : 'var(--text-muted)',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              letterSpacing: 'inherit',
              cursor: 'pointer',
              transition: 'background 0.12s ease, color 0.12s ease, border-color 0.12s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {s}×
          </button>
        );
      })}

      {/* Vertical separator before the continuous slider */}
      <span style={{ width: 1, height: 22, background: 'var(--border-light)', alignSelf: 'center' }} />

      {/* Continuous speed slider — track 158 px (1.5× the 105 px
         second-pass width). Coaches now have even more travel for
         fine-tuned slow-mo dialing. */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        flex: '0 0 auto',
      }}>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          aria-label="Playback speed"
          style={{
            width: 158,
            cursor: 'pointer',
            accentColor: '#7eb6ff',
            height: 22,
          }}
        />
        <span style={{
          minWidth: 63,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-bright)',
          fontSize: 17,
        }}>
          {rate.toFixed(2)}×
        </span>
      </div>
    </div>
  );
}

/** Square icon-button style shared by Play/Pause and the frame
 *  steppers. Sizes were bumped from 25 × 25 → 33 × 33 in this
 *  second pass (the previous pass was 18 → 25 from the original). */
const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 33, height: 33,
  padding: 0,
  borderRadius: 5,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
  transition: 'background 0.12s ease, border-color 0.12s ease',
};

/** Backward-compat re-export — older imports of `PlaybackSpeedControl`
 *  resolve to the new full-featured bar. */
export const PlaybackSpeedControl = VideoControlBar;
