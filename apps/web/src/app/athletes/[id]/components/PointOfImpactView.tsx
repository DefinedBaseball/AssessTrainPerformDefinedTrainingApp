'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────────────────
   POINT OF IMPACT

   A top-down view of home plate showing where each ball was hit. Read from
   the report's HitTrax uploads (since 2026-11 the HitTrax card saves POI
   X/Y/Z too) AND its older "HitTrax POI" card uploads; the two were copies
   of the same export, so a swing found in both is shown once. Rebuilt from
   HitTrax's own Point of Impact screen; every number below matched HitTrax
   on two real sessions:

     depth (in front of the plate) = POI Z - 17   (stored as poi_depth)
     side to side                  = POI X        (rawData.x)

   • Avg POI          — mean depth of FAIR balls (fouls left out).
   • Band readouts    — 6" depth bands: mean exit velo of the fair balls in
                        each band.
   • Dots             — shaded by exit velo on a blue -> white -> red
                        gradient (the Strike Zone's colours): 75 and under
                        blue, 82.5 white, 90 and up red, blended between.

   Side to side is drawn the way HitTrax draws it (+X to the right). It is
   not yet confirmed whether HitTrax mirrors X for left-handed hitters.
   ─────────────────────────────────────────────────────────────────────────── */

type Swing = {
  depth: number;
  x: number;
  velo: number;
  la: number | null;
  res: string | null;
  kind: ResultKind;
};

type ResultKind = 'single' | 'double' | 'triple' | 'hr' | 'out' | 'foul';

/* Result labels -- only for a dot's hover text now that colour = exit velo. */
const RESULT_LABEL: Record<ResultKind, string> = {
  single: '1B', double: '2B', triple: '3B', hr: 'HR', out: 'Out', foul: 'Foul',
};

/* Exit-velo shading (coach spec): a gradient in the Strike Zone's colours.
   75 mph and under = full blue, 90 and up = full red, white halfway
   (82.5); anything between blends -- closer to 90 = redder, closer to
   75 = bluer. */
const EV_LO = 75;
const EV_HI = 90;
const BLUE: [number, number, number] = [47, 107, 196];   // #2f6bc4
const WHITE: [number, number, number] = [244, 245, 247]; // #f4f5f7
const RED: [number, number, number] = [210, 52, 52];     // #d23434
const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ')})`;
function veloColor(v: number): string {
  const t = Math.max(0, Math.min(1, (v - EV_LO) / (EV_HI - EV_LO)));
  return t < 0.5 ? mix(BLUE, WHITE, t / 0.5) : mix(WHITE, RED, (t - 0.5) / 0.5);
}
const rgb = (c: number[]) => `rgb(${c.join(', ')})`;

function resultKind(res: string | null): ResultKind {
  const s = (res || '').trim().toUpperCase();
  if (s.startsWith('FOUL')) return 'foul';
  if (s.startsWith('1B')) return 'single';
  if (s.startsWith('2B')) return 'double';
  if (s.startsWith('3B')) return 'triple';
  if (s.startsWith('HR')) return 'hr';
  return 'out';
}

function toSwings(rows: any[]): Swing[] {
  const out: Swing[] = [];
  /* The same export uploaded to both cards gives identical readings (the
     server reads a swing the same way for both), so a swing whose contact
     point AND exit velo match one already seen is the same ball -- skip it.
     Two genuinely different swings agreeing to 0.01" on X, Y and Z and
     0.01 mph doesn't happen. */
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.metricType !== 'poi_depth') continue;
    let raw: any = {};
    try { raw = r.rawData ? JSON.parse(r.rawData) : {}; } catch { /* ignore */ }
    const x = Number(raw.x);
    const velo = Number(raw.velo);
    if (!Number.isFinite(r.value) || !Number.isFinite(x)) continue;
    const key = `${raw.x}|${raw.y}|${raw.z}|${raw.velo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      depth: r.value,
      x,
      velo: Number.isFinite(velo) ? velo : 0,
      la: Number.isFinite(Number(raw.la)) && raw.la != null ? Number(raw.la) : null,
      res: raw.res ?? null,
      kind: resultKind(raw.res ?? null),
    });
  }
  return out;
}

/* ── Figure geometry (SVG units; 1 unit ≈ 1 px at the 330-wide cap) ── */
const BAND = 6;                 // inches per depth band
const PX = 5;                   // units per inch
const HALF_W_IN = 12;           // inches drawn either side of the plate centre (wider contacts pin to the edge)
/* Equal gutters either side, so home plate sits dead centre in the bubble
   and the band lines stop the same distance short of the depth labels
   (left) as of the Avg EV readouts (right). */
const GUTTER = 50;
const LEFT = GUTTER;            // depth labels live in here
const RIGHT = GUTTER;           // Avg EV readouts live in here
const PAD_Y = 8;

export function PointOfImpactView({
  playerId, refreshKey, hittraxUploadIds, poiUploadIds, onEmptyChange,
}: {
  playerId: string;
  refreshKey?: number;
  /** The report's HitTrax (Batted Ball) upload ids -- POI saved since 2026-11. */
  hittraxUploadIds: string[];
  /** The report's older "HitTrax POI" card upload ids. */
  poiUploadIds: string[];
  /** `true` while loading or when there is nothing to plot, so the host
   *  can keep its bubble hidden until there is a chart to frame (no flash
   *  of an empty column on reports without POI). */
  onEmptyChange?: (empty: boolean) => void;
}) {
  const [swings, setSwings] = useState<Swing[]>([]);
  const [loading, setLoading] = useState(true);
  const htKey = hittraxUploadIds.join(',');
  const poiKey = poiUploadIds.join(',');

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    if (!htKey && !poiKey) {
      setSwings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const read = (source: string, key: string) => (key
      ? api.getSessionData(playerId, source, ['poi_depth'], { uploadIds: key.split(',') }).catch(() => [] as any[])
      : Promise.resolve([] as any[]));
    Promise.all([read('HITTRAX', htKey), read('HITTRAX_POI', poiKey)]).then(([fromHitTrax, fromPoiCard]) => {
      if (cancelled) return;
      setSwings(toSwings([...fromHitTrax, ...fromPoiCard]));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [playerId, refreshKey, htKey, poiKey]);

  const isEmpty = loading || swings.length === 0;
  useEffect(() => { onEmptyChange?.(isEmpty); }, [isEmpty, onEmptyChange]);

  const fair = useMemo(() => swings.filter(s => s.kind !== 'foul'), [swings]);
  const avgDepth = fair.length ? fair.reduce((s, w) => s + w.depth, 0) / fair.length : null;

  /* Depth range: HitTrax's -18" to 30", stretched by whole bands when a
     contact lands outside it. */
  const { lo, hi } = useMemo(() => {
    let l = -18, h = 30;
    for (const s of swings) {
      while (s.depth < l) l -= BAND;
      while (s.depth >= h) h += BAND;
    }
    return { lo: l, hi: h };
  }, [swings]);

  const bands = useMemo(() => {
    const out: { from: number; ev: number | null }[] = [];
    for (let from = hi - BAND; from >= lo; from -= BAND) {
      const inBand = swings.filter(s => s.depth >= from && s.depth < from + BAND);
      const fairIn = inBand.filter(s => s.kind !== 'foul');
      out.push({
        from,
        ev: fairIn.length ? fairIn.reduce((s, w) => s + w.velo, 0) / fairIn.length : null,
      });
    }
    return out;
  }, [swings, lo, hi]);

  if (isEmpty) return null;

  const plotW = HALF_W_IN * 2 * PX;
  const W = LEFT + plotW + RIGHT;
  const H = PAD_Y * 2 + (hi - lo) * PX;
  const cx = LEFT + plotW / 2;
  /* Centre line of the Avg EV column -- readouts and their header are both
     centred on it, so the header sits squarely over the numbers. */
  const readoutX = W - 22;
  const yOf = (d: number) => PAD_Y + (hi - d) * PX;
  const xOf = (x: number) => cx + Math.max(-HALF_W_IN, Math.min(HALF_W_IN, x)) * PX;
  const plate = [
    [-8.5, 0], [8.5, 0], [8.5, -8.5], [0, -17], [-8.5, -8.5],
  ].map(([x, d]) => `${cx + x * PX},${yOf(d)}`).join(' ');

  /* Fouls first so fair balls paint on top of them. */
  const drawOrder = [...swings].sort((a, b) => (a.kind === 'foul' ? 0 : 1) - (b.kind === 'foul' ? 0 : 1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0 }}>
      {/* Summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: rem(9.5), color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Avg POI</span>
          <span style={{ fontSize: rem(17), fontWeight: 800, color: 'var(--text-bright)', fontVariantNumeric: 'tabular-nums' }}>
            {avgDepth == null ? '—' : `${avgDepth.toFixed(1)}"`}
          </span>
          <span style={{ fontSize: rem(9.5), color: 'var(--text-muted)' }}>
            {fair.length} fair / {swings.length} {swings.length === 1 ? 'contact' : 'contacts'}
          </span>
        </span>
      </div>

      {/* Chart + legend sit centred in whatever height the bubble has
          (it is stretched to match the spray chart beside it). */}
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Point of impact relative to home plate"
        style={{ display: 'block', maxWidth: 420, margin: '0 auto', overflow: 'visible' }}
      >
        {/* Home plate, front edge at depth 0. */}
        <polygon points={plate} style={{ fill: 'var(--border)', opacity: 0.55 }} />

        {/* Band lines + labels (each band is labelled by its near edge,
            as HitTrax does) + the readouts on the right. */}
        {Array.from({ length: (hi - lo) / BAND + 1 }, (_, i) => lo + i * BAND).map(d => (
          <line key={`l${d}`} x1={LEFT} x2={W - RIGHT} y1={yOf(d)} y2={yOf(d)}
            style={{ stroke: 'var(--text-muted)', opacity: d === 0 ? 0.6 : 0.35 }}
            strokeWidth={d === 0 ? 1 : 0.8} strokeDasharray={d === 0 ? undefined : '1.5 3'} />
        ))}
        {bands.map(b => {
          const y = yOf(b.from + BAND / 2) + 3.5;
          const empty = b.ev == null;
          return (
            <g key={`b${b.from}`}>
              <text x={4} y={y} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-secondary)' }}>{b.from}&quot;</text>
              <text x={readoutX} y={y} fontSize={10} fontWeight={700} textAnchor="middle"
                style={{ fill: empty ? 'var(--text-muted)' : 'var(--text-bright)', fontVariantNumeric: 'tabular-nums' }}>
                {b.ev == null ? '—' : b.ev.toFixed(1)}
                {b.ev != null && (
                  <tspan dx={1} fontSize={6.5} fontWeight={500} style={{ fill: 'var(--text-muted)' }}>mph</tspan>
                )}
              </text>
            </g>
          );
        })}
        {/* Column headers: POI over the depth labels, Avg EV centred over
            the readouts (both share the readouts' centre line). */}
        <text x={4} y={PAD_Y - 1} fontSize={8} style={{ fill: 'var(--text-muted)', letterSpacing: '0.04em' }}>
          POI
        </text>
        <text x={readoutX} y={PAD_Y - 1} fontSize={8} textAnchor="middle" style={{ fill: 'var(--text-muted)', letterSpacing: '0.04em' }}>
          Avg EV
        </text>

        {/* Average contact depth. */}
        {avgDepth != null && (
          <g>
            <line x1={LEFT} x2={LEFT + plotW} y1={yOf(avgDepth)} y2={yOf(avgDepth)}
              style={{ stroke: 'var(--accent-light, #7aa7ff)' }} strokeWidth={1} strokeDasharray="5 3" opacity={0.9} />
            <text x={LEFT + 2} y={yOf(avgDepth) - 3} fontSize={8.5} fontWeight={700} style={{ fill: 'var(--accent-light, #7aa7ff)' }}>
              AVG {avgDepth.toFixed(1)}&quot;
            </text>
          </g>
        )}

        {drawOrder.map((s, i) => (
          <circle key={i} cx={xOf(s.x)} cy={yOf(s.depth)} r={4.2}
            fill={veloColor(s.velo)}
            stroke="rgba(0,0,0,0.55)" strokeWidth={0.9}>
            <title>
              {`${s.res || RESULT_LABEL[s.kind]} · ${s.velo.toFixed(1)} mph${s.la != null ? ` · ${s.la.toFixed(1)}°` : ''}\n${s.depth.toFixed(1)}" in front of the plate · ${Math.abs(s.x).toFixed(1)}" ${s.x >= 0 ? 'right' : 'left'} of centre`}
            </title>
          </circle>
        ))}
      </svg>

      {/* Legend -- the gradient the dots are shaded on. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: rem(9.5), color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{EV_LO}</span>
        <span style={{
          width: 140, height: 9, borderRadius: 5,
          background: `linear-gradient(to right, ${rgb(BLUE)}, ${rgb(WHITE)}, ${rgb(RED)})`,
          border: '1px solid rgba(0,0,0,0.3)',
        }} />
        <span style={{ fontSize: rem(9.5), color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{EV_HI}+ mph</span>
      </div>
      </div>
    </div>
  );
}

export default PointOfImpactView;
