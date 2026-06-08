'use client';

/* ─────────────────────────────────────────────────────────────────────
   LiveAtBatsList — Phase 6 consumer of the LiveSessions/AtBat data
   captured via the /live tools. Renders a filterable list of recent
   at-bats for either a hitter (Hitting tab → Swing Decision sub-tab)
   or a pitcher (Pitching tab → Live Results bubble) with the user-
   requested filter chips:
     • Last 25 / 50 / 100  → server-side `limit` query
     • Last Year           → server-side `since = now - 365d`
     • All Time            → server-side `limit = 1000` (no `since`)

   The hitter variant additionally shows a `vs LHP / vs RHP` chip
   pair so the coach can split the same hitter's at-bats by pitcher
   handedness — driven by the `pitcherHandedness` snapshot the
   LiveSession capture stamps onto each AtBat row.
   ───────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import type { AtBatDetail } from '@/lib/api';
import styles from './LiveAtBatsList.module.css';
import { PlaybackSpeedControl } from './PlaybackSpeedControl';
import { VideoDrawingOverlay } from './VideoDrawingOverlay';

interface Props {
  /** Required — pass exactly one of `hitterId` or `pitcherId`. The
   *  other side determines whether the list reads as the hitter's
   *  recent ABs (vs all pitchers) or the pitcher's (vs all hitters). */
  hitterId?: string;
  pitcherId?: string;
  /** When provided, used as the bubble's title. Defaults to "Live
   *  At-Bats" so the component is drop-in. */
  title?: string;
  /** When true, surface the vs-LHP / vs-RHP handedness chips (only
   *  makes sense in the hitter context). Defaults to true when
   *  `hitterId` is set, false when `pitcherId` is set. */
  showHandednessFilter?: boolean;
}

/* ── Filter-chip values ──
   The `limit` chips share a server `limit` query; the "Last Year"
   chip adds a `since` cutoff and a permissive limit (so the chip
   shows up to a year's worth regardless of count); "All Time"
   removes the date cutoff and uses the API's max limit. */
type LimitChipKey = 'L25' | 'L50' | 'L100' | 'YEAR' | 'ALL';
const LIMIT_CHIPS: { key: LimitChipKey; label: string }[] = [
  { key: 'L25',  label: 'Last 25' },
  { key: 'L50',  label: 'Last 50' },
  { key: 'L100', label: 'Last 100' },
  { key: 'YEAR', label: 'Last Year' },
  { key: 'ALL',  label: 'All Time' },
];

function buildFetchArgs(chip: LimitChipKey): { limit: number; since?: string } {
  switch (chip) {
    case 'L25':  return { limit: 25 };
    case 'L50':  return { limit: 50 };
    case 'L100': return { limit: 100 };
    case 'YEAR': {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return { limit: 1000, since: d.toISOString() };
    }
    case 'ALL':  return { limit: 1000 };
  }
}

/* ── Display helpers — mirror /live/at-bat/page.tsx so result
       strings read identically across the app. */
function fmtOutcome(o: string | null): string {
  if (!o) return '—';
  const map: Record<string, string> = {
    STRIKE_OUT_LOOKING:  'Strikeout — Looking',
    STRIKE_OUT_SWINGING: 'Strikeout — Swinging',
    WALK:        'Walk',
    FLY_BALL:    'Fly Ball',
    GROUND_BALL: 'Ground Ball',
    LINE_DRIVE:  'Line Drive',
    BARREL:      'Barrel',
  };
  return map[o] ?? o;
}

/* Pretty-print pitch types the same way the live tracker does. */
function fmtPitchType(t: string | null | undefined): string {
  if (!t) return '—';
  const map: Record<string, string> = {
    FASTBALL: 'Fastball',  SINKER: 'Sinker',    CUTTER: 'Cutter',
    SLIDER:   'Slider',    CURVEBALL: 'Curveball', SWEEPER: 'Sweeper',
    CHANGEUP: 'Changeup',  SPLITTER: 'Splitter',  KNUCKLEBALL: 'Knuckleball',
  };
  return map[t] ?? t;
}

/* Resolve the row's strike/ball tone from the AB outcome.
   - 'strike' → AB ended on a strike (strikeout, or contact —
     fly ball / ground ball / line drive / barrel — all happen on
     a pitched strike the batter swung at).
   - 'ball'   → AB ended on a fourth ball (WALK).
   - null     → in-progress or unknown; no tint applied. */
function outcomeTone(outcome: string | null): 'strike' | 'ball' | null {
  if (!outcome) return null;
  if (outcome === 'WALK') return 'ball';
  if (
    outcome === 'STRIKE_OUT_LOOKING'  ||
    outcome === 'STRIKE_OUT_SWINGING' ||
    outcome === 'FLY_BALL'            ||
    outcome === 'GROUND_BALL'         ||
    outcome === 'LINE_DRIVE'          ||
    outcome === 'BARREL'
  ) return 'strike';
  return null;
}

/* ── Rollup stats computed from the visible at-bat list. Drives
       the chip strip across the top: AB count + per-outcome %s.
       The denominator for percentages is the AB count INCLUDING
       in-progress (outcome == null) so the percentages reflect
       what's currently shown; in-progress ABs are surfaced as the
       "Open" stat. */
interface Rollup {
  totalAB: number;
  open: number;
  barrels: number;
  flyBalls: number;
  groundBalls: number;
  lineDrives: number;
  strikeouts: number;
  walks: number;
}

function computeRollup(rows: AtBatDetail[]): Rollup {
  let open = 0, barrels = 0, fb = 0, gb = 0, ld = 0, k = 0, bb = 0;
  for (const r of rows) {
    if (!r.outcome) { open++; continue; }
    switch (r.outcome) {
      case 'BARREL':      barrels++;     break;
      case 'FLY_BALL':    fb++;          break;
      case 'GROUND_BALL': gb++;          break;
      case 'LINE_DRIVE':  ld++;          break;
      case 'STRIKE_OUT_LOOKING':
      case 'STRIKE_OUT_SWINGING': k++; break;
      case 'WALK':        bb++;          break;
    }
  }
  return { totalAB: rows.length, open, barrels, flyBalls: fb, groundBalls: gb, lineDrives: ld, strikeouts: k, walks: bb };
}

function pct(n: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

export function LiveAtBatsList({
  hitterId,
  pitcherId,
  title,
  showHandednessFilter,
}: Props) {
  const [chip, setChip] = useState<LimitChipKey>('L50');
  // 'ALL' → no handedness filter; 'L' / 'R' apply the
  // `pitcherHandedness` server query.
  const [hand, setHand] = useState<'ALL' | 'L' | 'R'>('ALL');
  const [rows, setRows] = useState<AtBatDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Map of videoId → Video for every AB row that has one. Populated
     after `rows` settles via parallel `api.getVideo(id)` calls so each
     play-icon button can render the inline `<video src>` without
     another round-trip when clicked. */
  const [videos, setVideos] = useState<Map<string, api.Video>>(new Map());
  /* The AB row currently expanded to show its inline video player
     (atBat.id) — or `null` if no row is expanded. Clicking the play
     icon on a row toggles this; clicking the icon on the already-open
     row collapses it. */
  const [activeVideoAbId, setActiveVideoAbId] = useState<string | null>(null);
  /* Ref to the active inline <video> element. Re-attached each time
     a new row is expanded (only one player ever renders at a time,
     so the ref tracks whichever row is currently open). Passed into
     `PlaybackSpeedControl` so users can scrub playback speed
     (0.25×–2×) directly from the inline player without diving into
     browser overflow menus. */
  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);

  // Default `showHandednessFilter` based on which side we're scoped to.
  const handChipsVisible = showHandednessFilter ?? !!hitterId;

  useEffect(() => {
    if (!hitterId && !pitcherId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { limit, since } = buildFetchArgs(chip);
    api.listAtBats({
      hitterId,
      pitcherId,
      ...(handChipsVisible && hand !== 'ALL' ? { pitcherHandedness: hand } : {}),
      limit,
      since,
    })
      .then(list => { if (!cancelled) setRows(list); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Failed to load at-bats'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hitterId, pitcherId, chip, hand, handChipsVisible]);

  /* Fetch the linked Video for every AB row that has a `videoId`.
     Runs after `rows` settles; fans out parallel `api.getVideo(id)`
     calls (deduped by ID) and stores results in a Map<videoId,
     Video>. Each play-icon button below renders straight from this
     cache — no per-click round-trip. Failed fetches are silently
     omitted (the row just won't show a play icon). */
  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.videoId).filter((x): x is string => !!x)));
    if (ids.length === 0) { setVideos(new Map()); return; }
    let cancelled = false;
    Promise.all(ids.map(id => api.getVideo(id).catch(() => null)))
      .then(results => {
        if (cancelled) return;
        const next = new Map<string, api.Video>();
        for (const v of results) {
          if (v) next.set(v.id, v);
        }
        setVideos(next);
      });
    return () => { cancelled = true; };
  }, [rows]);

  /* Reset the inline-player toggle whenever the row set changes
     so an expanded video for a previous filter doesn't bleed onto
     a new query result. */
  useEffect(() => { setActiveVideoAbId(null); }, [rows]);

  const rollup = useMemo(() => computeRollup(rows), [rows]);
  // The denominator for outcome % excludes "open" ABs so percentages
  // reflect completed at-bats only (and 0% doesn't tick up just
  // because the coach hasn't closed yesterday's AB yet).
  const completed = rollup.totalAB - rollup.open;

  return (
    <div className={styles.bubble}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title ?? 'Live At-Bats'}</h2>
        <span className={styles.count}>
          {rollup.totalAB} AB{rollup.totalAB === 1 ? '' : 's'}
          {rollup.open > 0 && <span className={styles.openTag}> · {rollup.open} open</span>}
        </span>
      </div>

      {/* Filter chips row */}
      <div className={styles.chipsRow}>
        <div className={styles.chipGroup}>
          {LIMIT_CHIPS.map(c => (
            <button
              key={c.key}
              type="button"
              className={`${styles.chip} ${chip === c.key ? styles.chipActive : ''}`}
              onClick={() => setChip(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {handChipsVisible && (
          <div className={styles.chipGroup}>
            {(['ALL', 'L', 'R'] as const).map(h => (
              <button
                key={h}
                type="button"
                className={`${styles.chip} ${hand === h ? styles.chipActive : ''}`}
                onClick={() => setHand(h)}
              >
                {h === 'ALL' ? 'All Pitchers' : `vs ${h}HP`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Rollup stat strip */}
      <div className={styles.statStrip}>
        <Stat label="Barrel %"     value={pct(rollup.barrels,     completed)} />
        <Stat label="Line Drive %" value={pct(rollup.lineDrives,  completed)} />
        <Stat label="Fly Ball %"   value={pct(rollup.flyBalls,    completed)} />
        <Stat label="Ground %"     value={pct(rollup.groundBalls, completed)} />
        <Stat label="K %"          value={pct(rollup.strikeouts,  completed)} />
        <Stat label="BB %"         value={pct(rollup.walks,       completed)} />
      </div>

      {/* AB list */}
      {error ? (
        <div className={styles.error}>{error}</div>
      ) : loading ? (
        <div className={styles.dim}>Loading at-bats…</div>
      ) : rows.length === 0 ? (
        <div className={styles.dim}>No at-bats recorded yet.</div>
      ) : (
        <ul className={styles.list}>
          {rows.map(ab => {
            const opponent = pitcherId
              ? (ab.hitter ? `${ab.hitter.firstName[0]}. ${ab.hitter.lastName}` : '—')
              : (ab.pitcher ? `${ab.pitcher.firstName[0]}. ${ab.pitcher.lastName}` : '—');
            /* The "final pitch" is the last entry in `ab.pitches` —
               that's the pitch that triggered the terminal outcome
               (or the most recent pitch on an in-progress AB).
               Showing the pitch type alongside the outcome answers
               "what pitch did X finish on?" without having to expand
               the row. */
            const finalPitch = ab.pitches.length > 0 ? ab.pitches[ab.pitches.length - 1] : null;
            /* Strike/ball tint — `outcomeTone` returns 'strike' for
               strikeouts + balls-in-play, 'ball' for WALK, or null
               for in-progress / unknown. The two tint classes paint
               a soft green / red wash over the row so the coach can
               scan results at a glance. */
            const tone = outcomeTone(ab.outcome);
            /* Inline-video state: present a play icon at the end of
               the row when this AB has a linked, playable video; on
               click, toggle the expanded player below the row. */
            const linkedVideo = ab.videoId ? videos.get(ab.videoId) : undefined;
            const videoSrc = linkedVideo
              ? (linkedVideo.originalUrl || linkedVideo.hlsUrl || null)
              : null;
            const playerOpen = activeVideoAbId === ab.id;
            return (
              <li
                key={ab.id}
                className={`${styles.row} ${
                  tone === 'strike' ? styles.rowStrike :
                  tone === 'ball'   ? styles.rowBall   : ''
                }`}
                style={playerOpen ? {
                  /* Expanded row — switch from the default flex grid
                     to a flex column so the inline player can occupy
                     a full-width slot below the at-bat-info row. */
                  display: 'flex', flexDirection: 'column', gap: 8,
                  alignItems: 'stretch',
                } : undefined}
              >
                <div style={playerOpen ? {
                  /* Re-create the original horizontal row layout for
                     just the info strip when the player is open. */
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 1fr auto auto',
                  gap: 10, alignItems: 'center',
                } : { display: 'contents' }}>
                  <span className={styles.rowDate}>
                    {new Date(ab.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <span className={styles.rowOpponent}>
                    {pitcherId ? 'vs' : 'vs'} {opponent}
                    {ab.pitcherHandedness && (
                      <span className={styles.rowHand}>{ab.pitcherHandedness}HP</span>
                    )}
                  </span>
                  <span className={styles.rowOutcome}>
                    {fmtOutcome(ab.outcome)}
                    {finalPitch && (
                      <span className={styles.rowFinalPitch}>
                        · {fmtPitchType(finalPitch.pitchType)}
                      </span>
                    )}
                  </span>
                  <span className={styles.rowPitchCount}>
                    {ab.pitches.length} pitch{ab.pitches.length === 1 ? '' : 'es'}
                  </span>
                  {/* Play icon — end-of-row affordance. Renders ONLY
                     when this AB has a linked, playable video. Click
                     toggles the inline player below; the icon flips
                     to a "close" glyph while open. */}
                  {videoSrc ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveVideoAbId(playerOpen ? null : ab.id);
                      }}
                      aria-label={playerOpen ? 'Hide video' : 'Play video'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28, height: 28,
                        padding: 0,
                        borderRadius: 6,
                        background: playerOpen
                          ? 'rgba(126,182,255,0.20)'
                          : 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(126,182,255,0.40)',
                        color: 'var(--accent-bright, #7eb6ff)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease',
                      }}
                    >
                      {playerOpen ? (
                        /* "Close" glyph — small × */
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="2" y1="2" x2="10" y2="10" />
                          <line x1="10" y1="2" x2="2" y2="10" />
                        </svg>
                      ) : (
                        /* Play glyph — filled triangle */
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <polygon points="3,2 3,10 10,6" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    /* Width-matched spacer so rows without a video
                       still left-align with rows that have one. */
                    <span style={{ width: 28 }} aria-hidden="true" />
                  )}
                </div>
                {playerOpen && videoSrc && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ position: 'relative' }}>
                      <video
                        ref={inlineVideoRef}
                        src={videoSrc}
                        controls
                        autoPlay
                        preload="metadata"
                        style={{
                          width: '100%',
                          /* Player size bumped 360 → 70vh so the inline
                             clip fills most of the viewport when opened.
                             Width still constrained to the row's natural
                             width (=`100%` of the list bubble), so a
                             16:9 clip caps at whichever is shorter:
                             the bubble's width-derived height OR 70 %
                             of the viewport's height. */
                          maxHeight: '70vh',
                          borderRadius: 6,
                          background: '#000',
                          display: 'block',
                        }}
                      />
                      {/* Drawing overlay — canvas + tool palette
                         layered over the inline player so coaches
                         can annotate live-at-bat clips without
                         opening the central modal. Click-through
                         when no tool is selected. */}
                      <VideoDrawingOverlay videoRef={inlineVideoRef} />
                    </div>
                    {/* Compact playback-control bar — same shrunken
                       bar used by the central VideoPlayerModal so
                       the playback UX is consistent everywhere
                       across the app. */}
                    <PlaybackSpeedControl videoRef={inlineVideoRef} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
