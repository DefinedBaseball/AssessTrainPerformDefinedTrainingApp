/* ─────────────────────────────────────────────────────────────────────────
   "The Big One" — time-range aggregation math for the profile charts.

   Pure functions only (no React) so the numbers are headless-testable.
   Consumed by PitchingTab (movement / release / zone) and the hitting
   spray chart when the ReportSelector is in an aggregation mode:
     - combine → charts just receive the merged raw pitches (no math here)
     - average → charts receive the outputs below
   ───────────────────────────────────────────────────────────────────────── */
import type { TrackmanPitch } from './api';

/** A synthetic per-pitch-type "pitch" whose numeric fields are the MEANS of
 *  the real pitches of that type. Shaped as a TrackmanPitch so the existing
 *  Movement / Release plots render it with zero changes (one dot per type).
 *  `aggCount` / `aggReleaseSpread` carry the aggregate-only extras. */
export type AggPitch = TrackmanPitch & {
  aggCount: number;
  /** RMS distance (ft) of real release points from the mean release point —
   *  a tighter (more consistent) release produces a SMALLER value. Null when
   *  fewer than 2 pitches carry release data. */
  aggReleaseSpread: number | null;
};

/* Numeric TrackmanPitch fields that average meaningfully. plateLoc* is
   deliberately EXCLUDED — an "average location" is meaningless; the zone
   plot switches to percentage mode instead (zoneAggregate below). */
const MEAN_KEYS = [
  'velocity', 'relSpeed', 'spinRate', 'spinAxis', 'relHeight', 'relSide',
  'extension', 'vertBreak', 'inducedVertBreak', 'horzBreak', 'zoneSpeed',
  'effectiveVelo', 'vertApprAngle', 'horzApprAngle',
] as const;

const meanOf = (vals: number[]): number | null =>
  vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

/** One averaged synthetic pitch per pitch type, sorted by count desc so the
 *  most-thrown pitch leads legends. Types with zero usable rows are skipped. */
export function averagePitchesByType(pitches: TrackmanPitch[]): AggPitch[] {
  const byType = new Map<string, TrackmanPitch[]>();
  for (const p of pitches) {
    const t = p.pitchType || 'Unknown';
    const arr = byType.get(t) ?? [];
    arr.push(p);
    byType.set(t, arr);
  }

  const out: AggPitch[] = [];
  for (const [type, rows] of byType) {
    const agg: any = {
      id: `agg-${type}`,
      pitchType: type,
      recordedAt: rows.map(r => r.recordedAt).sort().at(-1) ?? rows[0].recordedAt,
      tilt: null,
      pitchCall: null,
      plateLocHeight: null,
      plateLocSide: null,
      aggCount: rows.length,
      aggReleaseSpread: null,
    };
    for (const k of MEAN_KEYS) {
      const vals = rows
        .map(r => (r as any)[k])
        .filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v));
      agg[k] = meanOf(vals);
    }
    // `velocity` is non-nullable on TrackmanPitch — fall back to 0 if a type
    // somehow has no numeric velocities (keeps the shape valid).
    if (agg.velocity == null) agg.velocity = 0;
    // Majority handedness so the release plot keeps its lefty X-flip.
    const hands = rows.map(r => (r.pitcherThrows || '').toLowerCase().trim()).filter(Boolean);
    agg.pitcherThrows = hands.length
      ? (hands.filter(h => h === 'left').length > hands.length / 2 ? 'Left' : 'Right')
      : null;

    // Release consistency: RMS distance from the mean release point.
    const rel = rows.filter(
      r => typeof r.relSide === 'number' && typeof r.relHeight === 'number',
    );
    if (rel.length >= 2 && agg.relSide != null && agg.relHeight != null) {
      const msq =
        rel.reduce((s, r) => {
          const dx = (r.relSide as number) - agg.relSide;
          const dy = (r.relHeight as number) - agg.relHeight;
          return s + dx * dx + dy * dy;
        }, 0) / rel.length;
      agg.aggReleaseSpread = Math.sqrt(msq);
    }
    out.push(agg as AggPitch);
  }
  return out.sort((a, b) => b.aggCount - a.aggCount);
}

/* ── Zone percentages ──
   Geometry mirrors PitchLocationPlot exactly: strike zone x∈[-0.83,0.83]ft,
   y∈[1.5,3.5]ft, 3×3 cells numbered 1..9 row-major from TOP-LEFT (catcher's
   view). Pitches outside the zone roll up into `outsidePct`. */
export const ZONE = { left: -0.83, right: 0.83, bottom: 1.5, top: 3.5 } as const;

export interface ZoneAggregate {
  /** pcts[0..8] = zones 1..9, share of ALL located pitches, 0–100. */
  pcts: number[];
  outsidePct: number;
  /** Number of pitches that had plate-location data. */
  total: number;
}

export function zoneAggregate(pitches: TrackmanPitch[]): ZoneAggregate | null {
  const located = pitches.filter(
    p => typeof p.plateLocSide === 'number' && typeof p.plateLocHeight === 'number',
  );
  if (located.length === 0) return null;
  const counts = new Array(9).fill(0);
  let outside = 0;
  const cellW = (ZONE.right - ZONE.left) / 3;
  const cellH = (ZONE.top - ZONE.bottom) / 3;
  for (const p of located) {
    const x = p.plateLocSide as number;
    const y = p.plateLocHeight as number;
    if (x < ZONE.left || x > ZONE.right || y < ZONE.bottom || y > ZONE.top) {
      outside++;
      continue;
    }
    const col = Math.min(2, Math.floor((x - ZONE.left) / cellW));
    const row = Math.min(2, Math.floor((ZONE.top - y) / cellH));
    counts[row * 3 + col]++;
  }
  const total = located.length;
  return {
    pcts: counts.map(c => (c / total) * 100),
    outsidePct: (outside / total) * 100,
    total,
  };
}

/* ── Spray-chart slice percentages (Hitting) ──
   Five equal 18° slices across the 90° of fair territory, left-field line →
   right-field line. Input angles are measured in DEGREES where 0° = straight
   up the middle, negative = pull side toward LEFT field line (-45°), positive
   = RIGHT field line (+45°) — callers convert their coordinate system to
   this convention before calling. Out-of-range angles clamp into the edge
   slices (foul-line hugging balls still count toward the corner). */
export const SPRAY_SLICES = ['Left', 'Left Center', 'Center', 'Right Center', 'Right'] as const;

export interface SprayAggregate {
  /** pcts[0..4] = LF, LC, CF, RC, RF share of all batted balls, 0–100. */
  pcts: number[];
  total: number;
}

export function spraySliceAggregate(anglesDeg: number[]): SprayAggregate | null {
  const valid = anglesDeg.filter(a => Number.isFinite(a));
  if (valid.length === 0) return null;
  const counts = new Array(5).fill(0);
  for (const a of valid) {
    const clamped = Math.max(-45, Math.min(45, a));
    const idx = Math.min(4, Math.floor((clamped + 45) / 18));
    counts[idx]++;
  }
  return { pcts: counts.map(c => (c / valid.length) * 100), total: valid.length };
}
