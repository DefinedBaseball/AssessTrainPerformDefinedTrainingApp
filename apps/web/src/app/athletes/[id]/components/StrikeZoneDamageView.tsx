'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────────────────
   STRIKE ZONE DAMAGE MAP

   Averages exit velocity and launch angle per HitTrax strike-zone number so a
   coach can read at a glance WHERE in the zone a hitter does damage.

   Zone numbering is HitTrax's own and is NOT row-major — the in-zone 3x3 runs
   right-to-left across each row (top row reads 3 · 2 · 1 on screen), and the
   four out-of-zone quadrants wrap the box:

        11                     10
             ┌────┬────┬────┐
             │  3 │  2 │  1 │
             ├────┼────┼────┤
             │  6 │  5 │  4 │
             ├────┼────┼────┤
             │  9 │  8 │  7 │
             └────┴────┴────┘
        13                     12

   Source of truth is the zone diagram supplied by the coach; the layout
   constants below transcribe it directly, so re-check them against that
   diagram (not against intuition) if HitTrax ever renumbers.
   ─────────────────────────────────────────────────────────────────────────── */

/** In-zone 3x3, in screen reading order (left→right, top→bottom). */
const IN_ZONE_ROWS: number[][] = [
  [3, 2, 1],
  [6, 5, 4],
  [9, 8, 7],
];

/** The four out-of-zone quadrants, keyed by their corner position. */
const OUT_ZONES = {
  topLeft: 11,
  topRight: 10,
  bottomLeft: 13,
  bottomRight: 12,
} as const;

export type ZoneStat = {
  zone: number;
  /** Batted balls recorded in this zone. */
  n: number;
  /** Mean exit velocity (mph), or null when no ball carried an EV. */
  avgEv: number | null;
  /** Mean launch angle (deg), or null when no ball carried an LA. */
  avgLa: number | null;
};

/* ── Colour scheme ──
   Per coach spec the map is a RANK split, not a value ramp: sort the zones by
   average exit velocity and paint the bottom four blue, the middle five white
   and the top four red. Ranking (rather than absolute mph) means the scheme
   reads the same for a 12-year-old and a college bat — it always answers
   "which of HIS zones does he do the most damage in".

   Fills are solid, so each cell carries its own text colours: white type on
   the blue/red cells, dark type on the white ones. */
export type ZoneTone = {
  bg: string;
  /** Exit-velo number. */
  text: string;
  /** Launch-angle line. */
  sub: string;
  /** Units, ball count, zone tag. */
  muted: string;
};

/* Blue and red per coach spec: 30% darker than the first pass, then 15% back
   up (channels x 0.7, then x 1.15) — net ~19.5% darker than the originals
   rgb(52,108,190) / rgb(198,52,52). White type still clears contrast on both. */
const TONE_COLD: ZoneTone = {
  bg: 'rgba(41, 87, 153, 0.88)',
  text: '#ffffff',
  sub: 'rgba(255, 255, 255, 0.90)',
  muted: 'rgba(255, 255, 255, 0.74)',
};
/* The middle bucket is off-white rather than paper white: 10% off the
   original rgb(240,242,246). A first pass at 20% off (rgb 192,194,197) read
   as too grey, so this sits halfway between that and pure white. */
const TONE_MID: ZoneTone = {
  bg: 'rgba(216, 218, 221, 0.94)',
  text: '#12151c',
  sub: 'rgba(18, 21, 28, 0.84)',
  muted: 'rgba(18, 21, 28, 0.60)',
};
const TONE_HOT: ZoneTone = {
  bg: 'rgba(160, 41, 41, 0.90)',
  text: '#ffffff',
  sub: 'rgba(255, 255, 255, 0.90)',
  muted: 'rgba(255, 255, 255, 0.74)',
};
/** Zones with no batted ball stay unpainted — they are absent, not cold. */
const TONE_EMPTY: ZoneTone = {
  bg: 'rgba(255, 255, 255, 0.02)',
  text: 'var(--text-muted)',
  sub: 'var(--text-muted)',
  muted: 'var(--text-muted)',
};

/** Bucket sizes at a full 13-zone board. Scaled proportionally below when
 *  fewer zones carry data, so the split stays 4 : 5 : 4 in spirit. */
const COLD_SHARE = 4 / 13;
const HOT_SHARE  = 4 / 13;

/**
 * Assign each zone its tone by EV rank.
 *
 * Zone number breaks ties so the blue/white/red split is stable across
 * reloads. Note the consequence of a rank split: two zones with the SAME
 * average EV can land on opposite sides of a bucket edge.
 */
export function buildZoneTones(stats: ZoneStat[]): Map<number, ZoneTone> {
  const ranked = stats
    .filter(s => s.avgEv != null)
    .sort((a, b) => (b.avgEv! - a.avgEv!) || (a.zone - b.zone));
  const n = ranked.length;
  const hot  = Math.round(n * HOT_SHARE);
  const cold = Math.round(n * COLD_SHARE);
  const out = new Map<number, ZoneTone>();
  ranked.forEach((s, i) => {
    // Hot is tested first, so the two ends can never claim the same zone.
    out.set(s.zone, i < hot ? TONE_HOT : i >= n - cold ? TONE_COLD : TONE_MID);
  });
  return out;
}

/**
 * Pair every HitTrax metric row back into per-batted-ball records.
 *
 * The parser stamps every metric a single CSV row emits with ONE synthetic
 * timestamp (`rowDate + i`), so grouping by `recordedAt` reassembles the row.
 * This is the same contract the Spray Chart Metric Readout relies on.
 *
 * Uploads parsed BEFORE `strike_zone` existed simply return no zone rows, so
 * `stats` comes back empty and the host hides the section.
 */
export function buildZoneStats(
  rows: { metricType: string; value: number; recordedAt: string }[],
): ZoneStat[] {
  type Ball = { zone?: number; ev?: number; la?: number };
  const byStamp = new Map<string, Ball>();
  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue;
    let ball = byStamp.get(r.recordedAt);
    if (!ball) { ball = {}; byStamp.set(r.recordedAt, ball); }
    if (r.metricType === 'strike_zone')   ball.zone = r.value;
    if (r.metricType === 'max_exit_velo') ball.ev   = r.value;
    if (r.metricType === 'launch_angle')  ball.la   = r.value;
  }

  const acc = new Map<number, { n: number; ev: number[]; la: number[] }>();
  for (const ball of byStamp.values()) {
    if (ball.zone == null) continue;
    const zone = Math.round(ball.zone);
    if (zone < 1 || zone > 13) continue;
    let a = acc.get(zone);
    if (!a) { a = { n: 0, ev: [], la: [] }; acc.set(zone, a); }
    a.n++;
    /* EV of exactly 0 means "no batted ball" in a HitTrax export. The parser
       already drops those rows, but guard here too so a hand-edited CSV can't
       drag a zone average toward zero. */
    if (ball.ev != null && ball.ev > 0) a.ev.push(ball.ev);
    if (ball.la != null) a.la.push(ball.la);
  }

  const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
  return [...acc.entries()]
    .map(([zone, a]) => ({
      zone,
      n: a.n,
      avgEv: a.ev.length ? Math.round(mean(a.ev) * 10) / 10 : null,
      avgLa: a.la.length ? Math.round(mean(a.la) * 10) / 10 : null,
    }))
    .sort((a, b) => a.zone - b.zone);
}

/* ── Figure proportions ──
   Transcribed from the coach's HitTrax zone diagram. The whole thing is ONE
   bounded figure — an outer rectangle split into four quadrants by a cross
   through the centre, with the nine-cell strike zone laid on top of the
   middle. It is deliberately NOT stretched to the bubble width: a spray-chart
   -style bounded drawing, centred, so the box keeps its shape at any width.

   The box is taller than it is wide, the way a real strike zone is (17 in
   across, roughly 20 in of vertical window). */
const FIGURE_MAX_W = 430;      // px cap on the whole figure
const FIGURE_ASPECT = '300 / 322';
const BOX_W = '55%';           // strike-zone box, as a share of the figure
const BOX_H = '63%';

/* Home plate width, as a share of the figure — NOT a px cap, so it keeps
   its relationship to the strike-zone box (55%) once the figure shrinks on a
   phone. A hair wider than the box, so the box reads as sitting OVER the
   plate, the way it does from the mound. */
const PLATE_W = '58%';

/* ── Home plate ──
   Purely an orientation cue: the map is drawn from the pitcher's view, so the
   plate tells a hitter which side of it he is standing on. Proportions are a
   real 17in plate flattened in perspective — a square-on plate is as tall as
   it is wide and would swamp the figure it sits under. */
function HomePlate({ stroke }: { stroke: string }) {
  return (
    <svg
      viewBox="0 0 200 92"
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d="M3 3 H197 V34 L100 89 L3 34 Z"
        fill="rgba(255, 255, 255, 0.045)"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── The stat stack shown inside any zone ── */
function CellBody({ stat, tone, compact }: { stat?: ZoneStat; tone: ZoneTone; compact?: boolean }) {
  if (!stat || stat.n === 0) {
    return (
      <span style={{ fontSize: rem(10), fontWeight: 600, color: tone.muted, opacity: 0.5 }}>—</span>
    );
  }
  return (
    <>
      <span style={{
        display: 'inline-flex', alignItems: 'baseline',
        fontSize: rem(compact ? 16.2 : 18), fontWeight: 700, lineHeight: 1.05,
        color: tone.text,
      }}>
        {stat.avgEv != null ? stat.avgEv.toFixed(1) : '—'}
        <span style={{
          flex: '0 0 0px', width: 0,
          fontSize: rem(7.4), fontWeight: 500,
          color: tone.muted, whiteSpace: 'nowrap',
        }}>mph</span>
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'baseline',
        fontSize: rem(compact ? 11.5 : 12.6), fontWeight: 600, lineHeight: 1.05,
        color: tone.sub,
      }}>
        {stat.avgLa != null ? stat.avgLa.toFixed(1) : '—'}
        <span style={{
          flex: '0 0 0px', width: 0,
          fontSize: rem(7), fontWeight: 500,
          color: tone.muted, whiteSpace: 'nowrap',
        }}>deg</span>
      </span>
    </>
  );
}

/** Small zone-number tag. Pinned to a corner so it never crowds the readings. */
function ZoneTag({ zone, corner, tone }: { zone: number; corner: 'tl' | 'tr' | 'bl' | 'br'; tone: ZoneTone }) {
  const v = corner[0] === 't' ? { top: 4 } : { bottom: 4 };
  const h = corner[1] === 'l' ? { left: 6 } : { right: 6 };
  return (
    <span style={{
      position: 'absolute', ...v, ...h,
      fontSize: rem(8.5), fontWeight: 700, lineHeight: 1,
      color: tone.muted, letterSpacing: '0.02em',
    }}>{zone}</span>
  );
}

/* ── One of the four out-of-zone quadrants ──
   Absolutely positioned over its quarter of the figure. The strike-zone box
   sits on top of the middle, so each quadrant reads as the L-shaped region
   wrapping the box — which is why the readings are pushed out to the OUTER
   corner rather than centred (centred would put them under the box). */
function QuadrantZone({ zone, stat, tone, corner }: {
  zone: number;
  stat?: ZoneStat;
  tone: ZoneTone;
  corner: 'tl' | 'tr' | 'bl' | 'br';
}) {
  const top = corner[0] === 't';
  const left = corner[1] === 'l';
  return (
    <div style={{
      position: 'absolute',
      top: top ? 0 : '50%',
      left: left ? 0 : '50%',
      width: '50%',
      height: '50%',
      background: tone.bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: top ? 'flex-start' : 'flex-end',
      gap: 1,
      /* Readings hug the outer edge of the quadrant, clear of the box. */
      padding: top ? '12px 10px 0' : '0 10px 12px',
      textAlign: 'center',
    }}>
      <ZoneTag zone={zone} corner={corner} tone={tone} />
      <CellBody stat={stat} tone={tone} compact />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   StrikeZoneDamageView — self-contained widget
   ─────────────────────────────────────────────────────────────────────────── */
export function StrikeZoneDamageView({
  playerId, refreshKey, reportUploadIds, onEmptyChange,
}: {
  playerId: string;
  refreshKey?: number;
  /** Same semantics as SprayChartView: `undefined` = all uploads,
   *  `[]` = the active report has none (skip the fetch entirely). */
  reportUploadIds?: string[];
  /** Fires with `true` once we know there is no zone data to show, so the
   *  host can hide its section chrome instead of framing an empty grid. */
  onEmptyChange?: (empty: boolean) => void;
}) {
  const [stats, setStats] = useState<ZoneStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    setLoading(true);

    const csvSkipped = Array.isArray(reportUploadIds) && reportUploadIds.length === 0;
    const ids = reportUploadIds && reportUploadIds.length > 0 ? reportUploadIds : undefined;

    (csvSkipped
      ? Promise.resolve([] as any[])
      : api.getSessionData(
          playerId, 'HITTRAX',
          ['strike_zone', 'max_exit_velo', 'launch_angle'],
          { uploadIds: ids },
        ).catch(() => [] as any[])
    ).then((rows: any[]) => {
      if (cancelled) return;
      setStats(buildZoneStats(rows));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [playerId, refreshKey, reportUploadIds]);

  const byZone = useMemo(() => {
    const m = new Map<number, ZoneStat>();
    for (const s of stats) m.set(s.zone, s);
    return m;
  }, [stats]);

  /* Blue / white / red by EV rank — see buildZoneTones. */
  const toneByZone = useMemo(() => buildZoneTones(stats), [stats]);
  const toneFor = (zone: number) => toneByZone.get(zone) ?? TONE_EMPTY;

  /* Hottest zone by average EV, restricted to zones with enough balls to
     mean something. Falls back to the raw best when nothing clears the bar. */
  const hottest = useMemo(() => {
    const withEv = stats.filter(s => s.avgEv != null);
    if (withEv.length === 0) return null;
    const solid = withEv.filter(s => s.n >= 3);
    const pool = solid.length > 0 ? solid : withEv;
    return pool.reduce((best, s) => (s.avgEv! > best.avgEv! ? s : best));
  }, [stats]);

  const totalBalls = useMemo(() => stats.reduce((s, z) => s + z.n, 0), [stats]);
  const isEmpty = !loading && totalBalls === 0;

  useEffect(() => { onEmptyChange?.(isEmpty); }, [isEmpty, onEmptyChange]);

  if (loading) {
    return (
      <div style={{ padding: '18px 0', textAlign: 'center', fontSize: rem(11), color: 'var(--text-muted)' }}>
        Loading strike zone data…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div style={{ padding: '14px 0', textAlign: 'center' }}>
        <div style={{ fontSize: rem(11.5), color: 'var(--text-secondary)', marginBottom: 4 }}>
          No strike zone data for this report.
        </div>
        <div style={{ fontSize: rem(10), color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Zone numbers come from the <strong>Strike Zone</strong> column of a HitTrax
          CSV. Uploads processed before this section existed do not carry them —
          re-upload the CSV to populate the map.
        </div>
      </div>
    );
  }

  /* Divider colour for the outer frame, the quadrant cross and the box's
     interior hairlines. Deliberately a MID grey rather than a white or black
     tint: with solid blue / white / red fills a white line vanishes where two
     pale zones meet, and a dark line vanishes on the unpainted zones over the
     dark bubble. Mid grey is the only value that stays visible against all
     four fills. */
  const FRAME = 'rgba(150, 158, 172, 0.55)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0 }}>
      {/* Legend / summary strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: rem(9.5), color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Avg Exit Velo · Avg Launch Angle · {totalBalls} batted {totalBalls === 1 ? 'ball' : 'balls'}
        </span>
        {/* Legend spells the rank buckets out — the colours mean "bottom /
            middle / top four by EV", not an absolute mph threshold. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {([
            ['Bottom 4', TONE_COLD],
            ['Middle 5', TONE_MID],
            ['Top 4',    TONE_HOT],
          ] as const).map(([label, tone]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 11, height: 11, borderRadius: 3,
                background: tone.bg,
                border: '1px solid rgba(255, 255, 255, 0.18)',
              }} />
              <span style={{ fontSize: rem(9), color: 'var(--text-muted)', letterSpacing: '0.03em' }}>{label}</span>
            </span>
          ))}
        </span>
      </div>

      {/* ── The figure ──
          Outer rectangle → the four quadrants (10 / 11 / 12 / 13) → the cross
          that divides them → the nine-cell strike zone box laid over the
          middle. Stacking order matters: the box paints last so it masks the
          centre of the cross, exactly as the coach's diagram draws it. */}
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: FIGURE_MAX_W,
        aspectRatio: FIGURE_ASPECT,
        margin: '0 auto',
        border: `1px solid ${FRAME}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <QuadrantZone zone={OUT_ZONES.topLeft} stat={byZone.get(OUT_ZONES.topLeft)} tone={toneFor(OUT_ZONES.topLeft)} corner="tl" />
        <QuadrantZone zone={OUT_ZONES.topRight} stat={byZone.get(OUT_ZONES.topRight)} tone={toneFor(OUT_ZONES.topRight)} corner="tr" />
        <QuadrantZone zone={OUT_ZONES.bottomLeft} stat={byZone.get(OUT_ZONES.bottomLeft)} tone={toneFor(OUT_ZONES.bottomLeft)} corner="bl" />
        <QuadrantZone zone={OUT_ZONES.bottomRight} stat={byZone.get(OUT_ZONES.bottomRight)} tone={toneFor(OUT_ZONES.bottomRight)} corner="br" />

        {/* Cross — the quadrant divider. */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: FRAME }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, marginTop: -0.5, background: FRAME }} />

        {/* Strike zone box — taller than wide, centred, opaque so it masks
            the cross behind it. */}
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: BOX_W, height: BOX_H,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          background: 'var(--bubble-chrome-bg)',
          border: `1px solid ${FRAME}`,
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
          overflow: 'hidden',
        }}>
          {IN_ZONE_ROWS.map((row, r) => row.map((z, c) => {
            const stat = byZone.get(z);
            const tone = toneFor(z);
            return (
              <div key={z} style={{
                background: tone.bg,
                /* Interior hairlines only — the box's own border supplies
                   the outer edge, so no doubled-up lines. */
                borderRight:  c < 2 ? `1px solid ${FRAME}` : undefined,
                borderBottom: r < 2 ? `1px solid ${FRAME}` : undefined,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                minWidth: 0,
                padding: '2px 3px',
              }}>
                <ZoneTag zone={z} corner="bl" tone={tone} />
                <CellBody stat={stat} tone={tone} />
              </div>
            );
          }))}
        </div>
      </div>

      {hottest && (
        <div style={{
          fontSize: rem(10.5), color: 'var(--text-secondary)',
          textAlign: 'center', lineHeight: 1.5,
        }}>
          Most damage in <strong style={{ color: 'var(--text-primary)' }}>Zone {hottest.zone}</strong>
          {' — '}{hottest.avgEv!.toFixed(1)} mph avg
          {hottest.avgLa != null ? ` at ${hottest.avgLa.toFixed(1)}°` : ''}
          {' '}over {hottest.n} {hottest.n === 1 ? 'ball' : 'balls'}.
        </div>
      )}

      {/* Parked in whatever room is left under the figure — the column is
          stretched to the spray chart beside it, so that gap is real estate
          this view would otherwise leave blank. Centred in the space rather
          than pinned to the bottom, so it stays close to the zone when the
          column happens to be tall. */}
      <div style={{
        flex: '1 1 auto', minHeight: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingTop: 2,
      }}>
        {/* Two boxes: the outer one matches the figure's width exactly, the
            inner takes its share of that — so the plate tracks the figure
            instead of the bubble. */}
        <div style={{ width: '100%', maxWidth: FIGURE_MAX_W }}>
          <div style={{ width: PLATE_W, margin: '0 auto' }}>
            <HomePlate stroke={FRAME} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default StrikeZoneDamageView;
